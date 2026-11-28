import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import {
  amount,
  campaignFields,
  date,
  platformOptions,
  type CampaignRequest,
} from './intelligence';
import { ResearchFindings, type ResearchReport } from './ResearchFindings';
import { ResearchSourceAvailability } from './ResearchSourceAvailability';
import {
  operationalResearchBrief,
  researchRunsPath as route,
  type ResearchRun as Run,
  type ResearchState as State,
} from './researchClient';
import { BriefForm, type BriefSeed } from './ResearchBriefForm';
import { useMarketing, type Draft } from './workspace';
import './research-campaign.css';

const loadHistory = (signal: AbortSignal) => apiGet<Run[]>(route + '?limit=12', signal);
const phases: Record<State, string> = {
  queued: 'Queued',
  collecting: 'Checking sources',
  analyzing: 'Comparing evidence',
  ready: 'Processing complete',
  failed: 'Research interrupted',
  cancelled: 'Cancelled',
};
const active = (state: State) =>
  state === 'queued' || state === 'collecting' || state === 'analyzing';
function failure(error: unknown) {
  if (!(error instanceof ApiError)) return 'Research could not be opened. Try again.';
  if (error.code === 'research_evidence_changed' || error.code === 'catalog_changed')
    return 'The source evidence changed. Refresh the research to review current findings.';
  if (error.code === 'research_capacity')
    return 'Four company research runs are active. Finish or cancel one to start another.';
  if (error.code === 'research_snapshot_invalid')
    return 'The confirmed research brief could not be verified. Reopen the run and contact your workspace administrator if the problem persists.';
  if (error.status === 404)
    return 'This research is unavailable to your company. Open a recent brief or start your own.';
  if (error.status === 401) return 'Sign in to your company to reopen this research.';
  if (error.kind === 'timeout')
    return 'The workspace took too long to respond. Your research can continue in the background.';
  return 'The current research could not be loaded. Try again.';
}

function RunDetail({
  id,
  onRefresh,
  onAdjust,
}: {
  id: string;
  onRefresh: () => void;
  onAdjust: (brief: BriefSeed) => void;
}) {
  const { path, setDraft, campaignReceipt, openDraft } = useMarketing();
  const navigate = useNavigate();
  const [chosen, setChosen] = useState<CampaignRequest | null>(null);
  const load = useCallback(
    (s: AbortSignal) => apiGet<Run>(route + '/' + encodeURIComponent(id), s),
    [id],
  );
  const { result, retry } = useResource(load, 0, true);
  const run = result.state === 'ready' ? result.data : undefined;
  const brief = run ? operationalResearchBrief(run) : null;
  useEffect(() => {
    if (!chosen || !run || !brief || (run.campaign_id && run.campaign_id !== campaignReceipt?.id)) return;
    setDraft((old) => ({
      ...old,
      saved: true,
      brief: {
        ...old.brief,
        name: old.brief.name || brief.product,
        description: chosen.description,
        budget: chosen.budget_minor / 100,
        platform: chosen.platform,
        deliverable: chosen.deliverable,
        objective: chosen.objective,
        ...(run.criteria_version && {
          language: chosen.language ?? '',
          requireCantonese: chosen.require_language,
          market: chosen.market ?? '',
          minAudience: Number(chosen.minimum_market_share ?? 0) * 100,
          creatorCount: chosen.minimum_creators,
          requiredFacts: chosen.required_facts.join(', '),
          preferredFacts: chosen.preferred_facts.join(', '),
          categoryLabels: chosen.category_labels?.join(', ') ?? '',
        }),
      },
      evaluation: chosen,
    }));
    setChosen(null);
    navigate(path('plan'));
  }, [chosen, run, brief, campaignReceipt?.id, setDraft, navigate, path]);
  const reportLoad = useCallback(
    (s: AbortSignal) =>
      apiGet<ResearchReport>(route + '/' + encodeURIComponent(id) + '/results', s, 60000),
    [id],
  );
  const { result: report, retry: readReport } = useResource(
    reportLoad,
    run ? Date.parse(run.updated_at) : 0,
    false,
    !!brief && run?.state === 'ready',
  );
  const [action, setAction] = useState('');
  const [error, setError] = useState('');
  const live = useRef<AbortController | null>(null);
  useEffect(() => {
    if (run) onRefresh();
  }, [run?.state, onRefresh]);
  useEffect(() => () => live.current?.abort(), []);
  useEffect(() => {
    if (!run || !active(run.state)) return;
    const timer = window.setTimeout(retry, 2200);
    return () => window.clearTimeout(timer);
  }, [run, retry]);
  useEffect(() => {
    if (run?.state !== 'ready') return;
    const visible = () => {
      if (document.visibilityState === 'visible') readReport();
    };
    const timer = window.setInterval(visible, 60000);
    window.addEventListener('focus', visible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', visible);
    };
  }, [run?.state, readReport]);
  async function command(name: 'resume' | 'cancel') {
    if (live.current) return;
    const controller = new AbortController();
    live.current = controller;
    setAction(name);
    setError('');
    try {
      await apiPost(route + '/' + id + '/' + name, {}, controller.signal);
      retry();
      onRefresh();
    } catch (cause) {
      if (!controller.signal.aborted) setError(failure(cause));
    } finally {
      if (!controller.signal.aborted) {
        live.current = null;
        setAction('');
        if (name === 'resume') readReport();
      }
    }
  }
  if (result.state === 'error')
    return (
      <section className="rc-message">
        <p role="alert">{failure(result.error)}</p>
        <button className="studio-secondary" onClick={retry}>
          Retry
        </button>
      </section>
    );
  if (!run)
    return (
      <p className="rc-message" role="status">
        Opening your research…
      </p>
    );
  if (!brief)
    return (
      <section className="rc-message">
        <p role="alert">The confirmed research brief could not be verified. Reopen the run and contact your workspace administrator if the problem persists.</p>
        <button className="studio-secondary" onClick={retry}>Retry</button>
      </section>
    );
  return (
    <div className="rc-result">
      <header className="rc-brief-head">
        <h2>{brief.product}</h2>
        <p>{brief.campaign.description}</p>
        <div className="rc-basics">
          {amount(brief.campaign.budget_minor, brief.campaign.currency)} budget{' '}
          <span>·</span> {platformOptions[brief.campaign.platform]} <span>·</span>{' '}
          {brief.campaign.objective === 'awareness' ? 'Awareness' : 'Engagement'} <span>·</span>{' '}
          {date(run.created_at)}
        </div>
      </header>
      {run.state === 'ready' ? (
        <>
          {report.state === 'ready' ? (
            <ResearchFindings
              key={run.updated_at}
              report={report.data}
              brief={brief}
              run={run}
              onRefreshEvidence={() => void command('resume')}
              refreshing={!!action}
              onAdjust={() => onAdjust({ ...brief, previous: run })}
              onUse={(platform, budget_minor) => {
                if (run.campaign_id && run.campaign_id !== campaignReceipt?.id)
                  openDraft(run.campaign_id);
                setChosen({ ...brief.campaign, platform, budget_minor });
              }}
            />
          ) : report.state === 'error' ? (
            <div role="alert" className="rc-message">
              {failure(report.error)}{' '}
              <button className="studio-secondary" onClick={readReport}>
                Retry reading
              </button>
            </div>
          ) : (
            <p role="status" className="rc-message">
              Checking current permissions and opening the findings…
            </p>
          )}
          {report.state !== 'ready' && (
            <ResearchSourceAvailability sources={run.sources} onRefresh={() => void command('resume')} refreshing={!!action} />
          )}
          {run.last_review && report.state === 'error' && (
            <p className="rc-footnote">
              Historical review from {date(run.last_review.analyzed_at)} ·{' '}
              {run.last_review.strategies.length} strategies examined ·{' '}
              {run.last_review.example_count} returned{' '}
              {run.last_review.example_count === 1 ? 'example' : 'examples'} at the time.
            </p>
          )}
          <div className="rc-actions">
            <button className="studio-secondary" onClick={() => onAdjust({ ...brief, previous: run })}>
              Adjust brief
            </button>
            {run.campaign_id && <Link to={path('campaigns')}>Company campaigns</Link>}
          </div>
        </>
      ) : (
        <Panel
          title={phases[run.state]}
          description={
            active(run.state)
              ? 'You can leave this page. The company will keep the brief and its progress.'
              : undefined
          }
        >
          <ol className="rc-steps">
            {(['queued', 'collecting', 'analyzing', 'ready'] as const).map((step, i) => (
              <li key={step} aria-current={step === run.state ? 'step' : undefined}>
                <span>{i + 1}</span>
                {
                  [
                    'Review brief',
                    'Check eligible sources',
                    'Analyze and compare',
                    'Publish findings',
                  ][i]
                }
              </li>
            ))}
          </ol>
          {run.sources.length > 0 && (
            <details className="rc-method" open={run.state === 'collecting'}>
              <summary>Source availability</summary>
              <ul>
                {run.sources.map((s) => (
                  <li key={s.key}>
                    <span>{s.name}</span> ·{' '}
                    {s.error
                      ? 'Retry scheduled or source unavailable'
                      : s.pending
                        ? 'Collection in progress'
                        : s.state.replaceAll('_', ' ')}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="rc-actions">
            {active(run.state) ? (
              <button
                disabled={!!action}
                className="studio-secondary"
                onClick={() => void command('cancel')}
              >
                Cancel research
              </button>
            ) : (
              <button
                disabled={!!action}
                className="studio-primary"
                onClick={() => void command('resume')}
              >
                Resume research
              </button>
            )}
            {run.state === 'failed' && (
              <p role="alert">The last attempt could not finish. Resume with the saved brief.</p>
            )}
          </div>
          {run.error === 'delivery_delayed' && (
            <p role="status" className="rc-inset">
              The research worker is temporarily unavailable. Delivery will retry automatically.
            </p>
          )}
        </Panel>
      )}
      {error && (
        <p className="rc-message" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function SavedCampaignBrief({
  id,
  onOpen,
  onNew,
  onHistory,
}: {
  id: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onHistory: () => void;
}) {
  const { path } = useMarketing();
  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!id) throw new ApiError('http', 404);
      const key = encodeURIComponent(id);
      const { draft } = await apiGet<{ draft: Draft }>('/marketing/companies/campaigns/' + key, signal);
      const brief: BriefSeed = {
        campaign: draft.evaluation ?? campaignFields(draft.brief),
        campaignCurrencySource: draft.evaluation ? 'evaluation' : 'brief-default',
        product: draft.brief.name || draft.research?.title || '',
        scenario: draft.scenario,
      };
      return { brief, required: draft.brief.required, preferred: draft.brief.preferred };
    },
    [id],
  );
  const { result, retry } = useResource(load);
  if (result.state === 'loading')
    return (
      <p role="status" className="rc-message">
        Opening the saved campaign…
      </p>
    );
  if (result.state === 'error') {
    const unavailable = [403, 404, 422].includes(result.error.status ?? 0);
    return (
      <Panel title={unavailable ? 'Campaign unavailable' : 'Could not open the saved campaign'}>
        <p role="alert" className="rc-inset">
          {unavailable
            ? 'This campaign link is unavailable in your company workspace.'
            : result.error.kind === 'timeout'
              ? 'The company workspace took too long to respond.'
              : 'The campaign details could not be loaded.'}
        </p>
        <div className="rc-actions">
          {!unavailable && (
            <button className="studio-secondary" onClick={retry}>
              Try again
            </button>
          )}
          <Link className="studio-secondary" to={path('campaigns')}>
            Open company campaigns
          </Link>
          <button className="studio-secondary" onClick={onNew}>
            Start a new brief
          </button>
        </div>
      </Panel>
    );
  }
  const { brief, required, preferred } = result.data;
  return (
    <>
      <BriefForm initial={brief} initialDestination={id} query="" onOpen={onOpen} onHistory={onHistory} />
      {(required || preferred) && (
        <details className="rc-method">
          <summary>Campaign notes for manual review</summary>
          {required && (
            <p>
              <strong>Requirements</strong> {required}
            </p>
          )}
          {preferred && (
            <p>
              <strong>Preferences</strong> {preferred}
            </p>
          )}
        </details>
      )}
    </>
  );
}

export function ResearchCampaign() {
  const { company, path } = useMarketing();
  const [params, setParams] = useSearchParams();
  const [initial, setInitial] = useState<BriefSeed | null>(null);
  const { result: history, retry } = useResource(loadHistory, 0, true, !!company);
  const selected = params.get('run');
  const campaign = params.get('campaign');
  const open = useCallback(
    (id: string) => {
      setParams({ run: id });
      retry();
    },
    [setParams, retry],
  );
  function fresh(brief: BriefSeed | null = null) {
    setInitial(brief);
    setParams({});
  }
  if (!company)
    return (
      <section className="rc-page">
        <PageHeader
          title="Campaign research"
          description="Sign in to a company workspace to run research with permitted sources and save your findings."
        />
        <Link className="studio-primary" to={path()}>
          Open company access
        </Link>
      </section>
    );
  return (
    <section className="rc-page">
      <PageHeader
        title="Campaign Advisor"
        actions={
          selected || campaign ? (
            <button className="studio-secondary" onClick={() => fresh()}>
              New research
            </button>
          ) : undefined
        }
      />
      <div className="rc-layout">
        <div>
          {selected ? (
            <RunDetail key={selected} id={selected} onAdjust={fresh} onRefresh={retry} />
          ) : campaign !== null ? (
            <SavedCampaignBrief key={campaign} id={campaign} onNew={() => fresh()} onOpen={open} onHistory={retry} />
          ) : (
            <BriefForm
              key={company.id + '/' + company.username + '/' + (initial?.previous?.id ?? '') + '/' + (params.get('q') ?? '')}
              query={params.get('q')?.slice(0, 1000) ?? ''}
              initial={initial}
              initialDestination={initial?.previous ? initial.previous.campaign_id ?? 'standalone' : null}
              onOpen={open}
              onHistory={retry}
            />
          )}
        </div>
        <aside className="rc-history" aria-label="Recent research">
          <h2>Recent research</h2>
          <p>If a previous start was interrupted, check here before starting a replacement.</p>
          {history.state === 'error' ? (
            <button className="studio-secondary" onClick={retry}>
              Retry history
            </button>
          ) : history.state === 'loading' ? (
            <p>Loading…</p>
          ) : history.data.length === 0 ? (
            <p>Your company’s saved research will appear here.</p>
          ) : (
            <ul>
              {history.data.map((run) => (
                <li key={run.id}>
                  <button
                    aria-current={selected === run.id ? 'page' : undefined}
                    onClick={() => open(run.id)}
                  >
                    <strong>{operationalResearchBrief(run)?.product ?? 'Research brief unavailable'}</strong>
                    <span>
                      {phases[run.state]} · {date(run.created_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </section>
  );
}
