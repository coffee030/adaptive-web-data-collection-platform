import { useLayoutEffect, useRef, useState } from 'react';
import { ApiError, getCompanyScope } from '../../lib/api';
import { blankBrief } from './contracts';
import {
  previewResearch,
  submitConfirmedResearch,
  type BusinessBrief,
  type ConfirmedResearchRequest,
  type ResearchPreparation,
  type ResearchPreview,
} from './researchClient';
import { useMarketing, type Draft } from './workspace';

interface Approval {
  request: ConfirmedResearchRequest;
  draft: Draft | null;
}

function companyUnavailable(error?: ApiError) {
  return error?.code === 'company_changed' || [401, 403, 404].includes(error?.status ?? 0);
}

function campaignDraft(brief: BusinessBrief): Draft {
  const c = brief.campaign;
  return {
    brief: {
      ...blankBrief,
      name: brief.product,
      description: c.description,
      budget: c.budget_minor / 100,
      objective: c.objective,
      platform: c.platform,
      deliverable: c.deliverable,
      market: c.market ?? '',
      language: c.language ?? '',
      requireCantonese: c.require_language,
      minAudience: Number(c.minimum_market_share ?? 0) * 100,
      creatorCount: c.minimum_creators,
      requiredFacts: c.required_facts.join(', '),
      preferredFacts: c.preferred_facts.join(', '),
      categoryLabels: c.category_labels?.join(', ') ?? '',
    },
    saved: true,
    shortlist: [],
    explorer: '',
    lines: [],
    evaluation: c,
    scenario: brief.scenario ?? undefined,
  };
}

export function useResearchPreparation(onOpen: (id: string) => void, onHistory: () => void) {
  const { company, saveResearchCampaign } = useMarketing();
  const companyIsCurrent = () => !!company && company.id === getCompanyScope();
  const [reservation] = useState(() => crypto.randomUUID());
  const savedVersion = useRef(0);
  const [proposal, setProposal] = useState<ResearchPreview | null>(null);
  const [progress, setProgress] = useState<'preview' | 'save' | 'submit' | null>(null);
  const [error, setError] = useState('');
  const [recovery, setRecovery] = useState<'retry' | 'identity' | 'integrity' | 'campaign' | null>(null);
  const approval = useRef<Approval | null>(null);
  const current = useRef<ResearchPreview | null>(null);
  const operation = useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const writing = useRef(false);

  function advance() {
    operation.current.controller?.abort();
    return ++operation.current.generation;
  }

  useLayoutEffect(() => () => {
    operation.current.controller?.abort();
    operation.current.generation++;
  }, []);

  function invalidate() {
    if (writing.current || approval.current) return;
    advance();
    current.current = null;
    setProposal(null);
    setProgress(null);
    setError('');
    setRecovery(null);
  }

  async function preview(body: ResearchPreparation, message = '') {
    if (writing.current || approval.current || !companyIsCurrent()) return;
    const generation = advance();
    const controller = new AbortController();
    operation.current.controller = controller;
    current.current = null;
    setProposal(null);
    setError(message);
    setProgress('preview');
    try {
      const next = await previewResearch(body, controller.signal);
      if (generation !== operation.current.generation || !companyIsCurrent()) return;
      if (
        next.preparation?.protocol !== 'confirmed-v1' ||
        (next.preparation.campaign_id ?? null) !== (body.campaign_id ?? null) ||
        next.finalized?.version !== 'research-criteria-v1' ||
        !['ready', 'blocked'].includes(next.execution?.status)
      ) throw new ApiError('invalid-response');
      current.current = next;
      setProposal(next);
    } catch (cause) {
      if (generation !== operation.current.generation || !companyIsCurrent()) return;
      setError(cause instanceof ApiError && companyUnavailable(cause)
        ? 'This company session or destination is unavailable. Reopen the company workspace.'
        : 'The criteria preview could not be prepared. Check the brief and try again.');
    } finally {
      if (generation === operation.current.generation) setProgress(null);
    }
  }

  async function submit(frozen: Approval) {
    if (writing.current || approval.current !== frozen || !companyIsCurrent()) return;
    writing.current = true;
    const generation = advance();
    const controller = new AbortController();
    operation.current.controller = controller;
    setRecovery(null);
    setError('');
    const { request, draft } = frozen;
    let stage: 'save' | 'submit' = draft ? 'save' : 'submit';
    setProgress(stage);
    try {
      if (draft && request.campaign_id) {
        if (!saveResearchCampaign) throw new ApiError('invalid-response');
        savedVersion.current = await saveResearchCampaign(request.campaign_id, savedVersion.current, draft, controller.signal);
        if (generation !== operation.current.generation || !companyIsCurrent()) return;
        approval.current = { request, draft: null };
      }
      stage = 'submit';
      setProgress(stage);
      const run = await submitConfirmedResearch(request, controller.signal);
      if (generation !== operation.current.generation || !companyIsCurrent()) return;
      approval.current = null;
      current.current = null;
      onOpen(run.id);
    } catch (cause) {
      if (generation !== operation.current.generation || !companyIsCurrent()) return;
      const problem = cause instanceof ApiError ? cause : undefined;
      const saved = request.campaign_id === reservation && savedVersion.current > 0;
      const prefix = saved ? 'The company campaign was saved. ' : '';
      if (stage === 'submit') onHistory();
      if (problem?.code === 'research_confirmation_stale' || problem?.code === 'research_criteria_unresolved') {
        approval.current = null;
        writing.current = false;
        const { confirmation: _confirmation, request_key: _key, ...preparation } = request;
        void preview(preparation, prefix + (problem.code === 'research_confirmation_stale'
          ? 'The interpretation changed. Review the current preview and confirm again.'
          : 'Some criteria need clarification. Review the current preview and resolve the issues.'));
        return;
      }
      if (problem?.code === 'research_snapshot_invalid') {
        approval.current = null;
        current.current = null;
        setProposal(null);
        setRecovery('integrity');
        setError(prefix + 'The saved research could not be verified. Check Recent research and contact your workspace administrator if this persists.');
      } else if (problem?.code === 'research_request_changed') {
        setRecovery('identity');
        setError(prefix + 'This request key already belongs to different research. Check Recent research for the existing attempt before preparing a new one.');
      } else if (problem?.code === 'campaign_changed') {
        setRecovery('campaign');
        setError(prefix + 'A different revision exists for this campaign. Check Company campaigns and choose the intended destination before previewing again.');
      } else if (companyUnavailable(problem)) {
        approval.current = null;
        current.current = null;
        setProposal(null);
        setError(prefix + 'This company session or destination is unavailable. Reopen the company workspace or select an available campaign.');
      } else if (problem?.kind === 'http' && [400, 422].includes(problem.status ?? 0)) {
        approval.current = null;
        current.current = null;
        setProposal(null);
        setError(prefix + (stage === 'save'
          ? 'The campaign could not be saved with these values. Edit the brief and preview it again.'
          : 'The workspace rejected the research details. Edit the brief and preview it again.'));
      } else {
        setRecovery('retry');
        setError(prefix + (stage === 'save'
          ? 'The campaign save could not be confirmed. Retry this approval to save under the same campaign ID.'
          : problem?.code === 'research_capacity'
            ? 'Four company runs are active. Finish or cancel one, then retry this approval.'
            : 'The research start could not be confirmed. Retry this approval to recover the same run. Check Recent research before starting a replacement.'));
      }
    } finally {
      if (generation === operation.current.generation) {
        writing.current = false;
        setProgress(null);
      }
    }
  }

  function confirm(reviewed: ResearchPreview, createCampaign: boolean) {
    if (writing.current || approval.current || !companyIsCurrent() || current.current !== reviewed ||
        reviewed.execution.status !== 'ready' || !reviewed.effective_brief ||
        (createCampaign && reviewed.preparation.campaign_id !== reservation)) return;
    const frozen: Approval = {
      request: {
        ...structuredClone(reviewed.preparation),
        request_key: crypto.randomUUID(),
        confirmation: {
          action: 'confirm',
          version: reviewed.finalized.version,
          proposal_fingerprint: reviewed.fingerprint,
        },
      },
      draft: createCampaign ? campaignDraft(reviewed.effective_brief) : null,
    };
    approval.current = frozen;
    void submit(frozen);
  }

  return {
    reservation, proposal, progress, error, recovery, preview, invalidate, confirm,
    retry: () => {
      if (approval.current) void submit(approval.current);
    },
    restart: () => {
      if (writing.current || (recovery !== 'identity' && recovery !== 'campaign')) return;
      approval.current = null;
      invalidate();
    },
  };
}