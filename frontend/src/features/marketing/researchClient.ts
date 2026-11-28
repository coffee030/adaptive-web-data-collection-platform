import { apiPost } from '../../lib/api';
import { deliverableOptions, languageOptions, platformOptions, type CampaignRequest, type ScenarioRequest } from './intelligence';

export interface BusinessBrief {
  campaign: CampaignRequest;
  product: string;
  audience: string;
  discovery_focus: string | null;
  test_share: number;
  alternative_platforms: CampaignRequest['platform'][];
  scenario?: ScenarioRequest | null;
  discovery_scope?: 'campaign_channels' | 'all_sources';
  max_evidence_age_days?: number | null;
}

type Platform = CampaignRequest['platform'];
type Language = NonNullable<CampaignRequest['language']>;
type PlatformIntent = 'single' | 'comparison' | 'alternatives';
type CriteriaVersion = 'research-criteria-v1';
type StructuredOrigin = 'explicit' | 'application_default' | 'legacy';
type Origin = StructuredOrigin | 'text' | 'absent';
interface CriteriaInputValues {
  platform: Platform | null;
  alternative_platforms: Platform[] | null;
  max_evidence_age_days: number | null;
  deliverable: CampaignRequest['deliverable'] | null;
  language: Language | null;
  require_language: boolean | null;
  market: string | null;
  minimum_market_share: string | null;
  budget_minor: number | null;
  currency: string | null;
  minimum_creators: number | null;
  maximum_creators: number | null;
  required_facts: string[] | null;
  preferred_facts: string[] | null;
}
export type Provenance = Partial<Record<keyof CriteriaInputValues, StructuredOrigin>>;
export interface Criteria extends CriteriaInputValues {
  platform_intent: PlatformIntent | null;
  excluded_platforms: Platform[] | null;
}
interface Reference {
  field: keyof Criteria | 'research_text' | 'product' | 'discovery_focus';
  matched_text: string | null;
}
interface Candidate {
  value: boolean | number | string | string[] | null;
  origin: Exclude<Origin, 'absent'>;
  references: Reference[];
}
export interface Resolution {
  version: CriteriaVersion;
  status: 'ready' | 'needs_review' | 'invalid';
  original_input: CriteriaInputValues & {
    research_text: string;
    product: string | null;
    discovery_focus: string | null;
    audience: string | null;
    provenance: Provenance;
  };
  criteria: Criteria;
  fields: Record<keyof Criteria, {
    state: 'resolved' | 'absent' | 'unresolved' | 'invalid';
    origin: Origin | null;
    references: Reference[];
  }>;
  issues: {
    field: keyof Criteria;
    code: string;
    severity: 'review' | 'invalid' | 'notice';
    explanation: string;
    action: string;
    candidates: Candidate[];
    references: Reference[];
  }[];
  defaults: Partial<Record<keyof CriteriaInputValues, Candidate>>;
  assumptions: string[];
}

export interface ResearchReviewDecisions {
  publication_age?: { max_evidence_age_days: number | null } | null;
  platforms?: {
    platform: Platform;
    alternative_platforms: Platform[];
    platform_intent: PlatformIntent;
    excluded_platforms: Platform[];
  } | null;
  deliverable?: CampaignRequest['deliverable'] | null;
  language?: { language: Language | null; require_language: boolean } | null;
}

export interface ResearchPreparation {
  protocol: 'confirmed-v1';
  brief: BusinessBrief;
  campaign_id?: string | null;
  provenance?: Provenance;
  decisions?: ResearchReviewDecisions;
}

export interface ResearchProposal {
  preparation: ResearchPreparation;
  initial: Resolution;
  finalized: Resolution;
  effective_brief: BusinessBrief | null;
  fingerprint: string;
}

export interface ResearchPreview extends ResearchProposal {
  execution: {
    status: 'ready' | 'blocked';
    issues: { field: keyof Criteria; code: string; explanation: string; action: string }[];
  };
}

export interface ResearchConfirmation {
  action: 'confirm';
  version: CriteriaVersion;
  proposal_fingerprint: string;
}

export interface ResearchCriteriaMetadata {
  criteria_version?: CriteriaVersion;
  confirmed_criteria?: {
    proposal: ResearchProposal;
    confirmation: ResearchConfirmation;
    confirmed_at: string;
  };
}

export type ResearchState = 'queued' | 'collecting' | 'analyzing' | 'ready' | 'failed' | 'cancelled';
export interface ResearchRun extends ResearchCriteriaMetadata {
  id: string;
  state: ResearchState;
  campaign_id: string | null;
  brief: BusinessBrief;
  created_at: string;
  updated_at: string;
  error: string | null;
  sources: { key: string; name: string; state: string; pending: boolean; error: string | null; observed_at?: string | null }[];
  last_review?: {
    analyzed_at: string;
    example_count: number;
    strategies: { name: string; status: string }[];
  } | null;
}

function sameItems(value: unknown, expected: readonly string[] | null): boolean {
  const items = expected ?? [];
  return Array.isArray(value) && Array.isArray(items) && value.length === items.length &&
    value.every((item, index) => typeof item === 'string' && item === items[index]);
}

export function operationalResearchBrief(run: ResearchRun): BusinessBrief | null {
  if (!('criteria_version' in run) && !('confirmed_criteria' in run)) return run.brief;
  const snapshot = run.confirmed_criteria;
  const proposal = snapshot?.proposal;
  const confirmation = snapshot?.confirmation;
  const brief = proposal?.effective_brief;
  const campaign = brief?.campaign;
  const criteria = proposal?.finalized?.criteria;
  if (
    run.criteria_version !== 'research-criteria-v1' ||
    confirmation?.action !== 'confirm' || confirmation.version !== run.criteria_version ||
    proposal?.preparation?.protocol !== 'confirmed-v1' ||
    proposal.finalized?.status !== 'ready' || proposal.finalized.version !== run.criteria_version ||
    !/^[a-f0-9]{64}$/.test(proposal.fingerprint) || confirmation.proposal_fingerprint !== proposal.fingerprint ||
    !brief || !campaign || !criteria ||
    typeof brief.product !== 'string' || typeof brief.audience !== 'string' ||
    typeof campaign.description !== 'string' ||
    !Object.hasOwn(platformOptions, campaign.platform) || campaign.platform !== criteria.platform ||
    !Object.hasOwn(deliverableOptions, campaign.deliverable) || campaign.deliverable !== criteria.deliverable ||
    !Number.isSafeInteger(campaign.budget_minor) || campaign.budget_minor < 0 || campaign.budget_minor !== criteria.budget_minor ||
    !/^[A-Z]{3}$/.test(campaign.currency) || campaign.currency !== criteria.currency ||
    (campaign.objective !== 'awareness' && campaign.objective !== 'engagement') ||
    (campaign.language != null && !Object.hasOwn(languageOptions, campaign.language)) ||
    typeof campaign.require_language !== 'boolean' ||
    (campaign.language ?? null) !== criteria.language || campaign.require_language !== criteria.require_language ||
    (campaign.market ?? null) !== criteria.market || (campaign.minimum_market_share ?? null) !== criteria.minimum_market_share ||
    !Number.isInteger(campaign.minimum_creators) || !Number.isInteger(campaign.maximum_creators) ||
    campaign.minimum_creators !== criteria.minimum_creators || campaign.maximum_creators !== criteria.maximum_creators ||
    (brief.max_evidence_age_days ?? null) !== criteria.max_evidence_age_days ||
    !sameItems(campaign.required_facts, criteria.required_facts) || !sameItems(campaign.preferred_facts, criteria.preferred_facts) ||
    !sameItems(brief.alternative_platforms, criteria.alternative_platforms) ||
    !brief.alternative_platforms.every((platform) => Object.hasOwn(platformOptions, platform))
  ) return null;
  return brief;
}

export interface ConfirmedResearchRequest extends ResearchPreparation {
  request_key: string;
  confirmation: ResearchConfirmation;
}

export const researchRunsPath = '/marketing/companies/research-runs';
export const previewResearch = (body: ResearchPreparation, signal: AbortSignal) =>
  apiPost<ResearchPreview>(researchRunsPath + '/preview', body, signal);
export const submitConfirmedResearch = (body: ConfirmedResearchRequest, signal: AbortSignal) =>
  apiPost<ResearchRun>(researchRunsPath, body, signal);
