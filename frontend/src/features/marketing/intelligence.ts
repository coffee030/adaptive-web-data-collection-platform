import { ApiError, apiGet, apiPost } from '../../lib/api';
import type { Brief } from './contracts';

export type DataMode = 'demo' | 'partner';
export const platformOptions = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', other: 'Other platform' } as const;
export const deliverableOptions = { video_integration: 'Video integration', dedicated_video: 'Dedicated video', short_video: 'Short video', social_post: 'Social post' } as const;
export const languageOptions = { en: 'English', 'zh-Hant': 'Traditional Chinese', yue: 'Cantonese', mix: 'Mixed language' } as const;
export type Platform = keyof typeof platformOptions;
type Deliverable = keyof typeof deliverableOptions;
type Language = keyof typeof languageOptions;

export interface EvidenceRef {
  dataset_id: string;
  origin: 'synthetic' | 'creator_profile' | 'creator_authored' | 'creator_quote' | 'creator_first_party_performance' | 'creator_opt_in_survey';
  attribution: string;
  row_id: string;
  reference: string;
  observed_at: string;
  expires_at: string;
}
export interface Observed<T> { data: T; evidence: EvidenceRef }
export interface Measure {
  value: string | null;
  status: 'observed' | 'calculated' | 'estimated' | 'predicted' | 'assumed' | 'unavailable';
  observations: number | null;
}
export interface History {
  window_days: 7;
  median_views: Measure;
  median_interactions: Measure;
  interaction_rate: Measure;
}
export interface Quote {
  platform: Platform;
  deliverable: Deliverable;
  currency: string;
  amount_minor: number | null;
  valid_until: string;
  terms: string;
}
export interface Survey {
  platform: Platform;
  market: string;
  denominator: number | null;
  share: string | null;
  data_status: 'observed' | 'suppressed';
  period_start: string;
  period_end: string;
}
interface Post {
  id: string;
  platform: Platform;
  published_at: string;
  text: string;
  languages: Language[];
  reviewed_facts: string[];
}
export interface ContentEvidence {
  content: Observed<Post>;
  performance: Observed<{ views: number | null; likes: number | null; comments: number | null; window_end: string }> | null;
}
export interface CreatorSummary {
  profile: Observed<{ creator_id: string; name: string; description: string; accounts: { platform: Platform; account_id: string }[] }>;
  post_count: number;
  pricing: 'available' | 'unknown';
  audience: 'available' | 'unknown';
}
export interface CreatorDetail extends CreatorSummary {
  posts: ContentEvidence[];
  historical: History | null;
  historical_by_platform: Partial<Record<Platform, History>>;
  quotes: Observed<Quote>[];
  audiences: Observed<Survey>[];
}
export interface CampaignRequest {
  description: string;
  objective: 'awareness' | 'engagement';
  budget_minor: number;
  currency: 'HKD';
  platform: Platform;
  deliverable: Deliverable;
  market?: string;
  minimum_market_share?: string;
  language?: Language;
  require_language: boolean;
  required_facts: string[];
  preferred_facts: string[];
  minimum_creators: number;
  maximum_creators: number;
  shortlist?: string[];
  category_labels?: string[];
}
export interface Recommendation {
  creator_id: string;
  name: string;
  profile_evidence: EvidenceRef;
  factors: Record<string, number | null>;
  factor_weights: Record<string, number>;
  evidence: ContentEvidence[];
  requirement_evidence: Record<string, EvidenceRef>;
  market_evidence: Observed<Survey> | null;
  quote: Observed<Quote> | null;
  historical: History;
  eligible: boolean;
  limitations: string[];
}
export interface CampaignResult {
  state: 'available' | 'empty' | 'incomplete';
  mode: DataMode;
  as_of: string;
  retrieval: 'granite_int8' | 'character_tfidf';
  indexing: 'ready' | 'preparing' | 'fallback';
  categories: { source: 'suggested' | 'supplied'; labels: string[] };
  recommendations: Recommendation[];
  unavailable_shortlist_ids: string[];
  plan: { status: 'optimal' | 'infeasible' | 'search_limit'; selected: string[]; total_minor: number | null };
  campaign: CampaignRequest;
}
interface ScopeResult { mode: DataMode }
interface CatalogResult extends ScopeResult { state: 'available' | 'empty'; creators: CreatorSummary[] }
export interface ComparisonResult extends ScopeResult { state: 'available' | 'empty' | 'incomplete'; creators: CreatorDetail[]; unavailable_ids: string[] }
interface ProcessingResult extends ScopeResult { state: 'empty' | 'preparing' | 'ready' | 'fallback'; eligible_datasets: number; indexed_datasets: number }
export interface ScenarioRequest {
  currency: 'HKD'; impressions?: number; click_rate?: string; conversion_rate?: string;
  value_per_conversion_minor?: number; spend_minor?: number;
}
export interface ScenarioResult {
  basis: 'assumption_based'; assumptions: ScenarioRequest; clicks: Measure; conversions: Measure;
  attributed_revenue_minor: Measure; roas: Measure; roi: Measure;
}

const prefix = (mode: DataMode) => '/marketing/intelligence/' + mode;
function scoped<T extends ScopeResult>(result: T, mode: DataMode) {
  if (result?.mode !== mode) throw new ApiError('invalid-response');
  return result;
}
export const catalog = async (mode: DataMode, search: URLSearchParams, signal: AbortSignal) =>
  scoped(await apiGet<CatalogResult>(prefix(mode) + '/creators?' + search, signal), mode);
export const creatorDetail = (mode: DataMode, id: string, signal: AbortSignal) =>
  apiGet<CreatorDetail>(prefix(mode) + '/creators/' + encodeURIComponent(id), signal);
export const compareCreators = async (mode: DataMode, ids: string[], signal: AbortSignal) =>
  scoped(await apiPost<ComparisonResult>(prefix(mode) + '/creators/compare', { creator_ids: ids }, signal), mode);
export const runCampaign = async (mode: DataMode, input: CampaignRequest, signal: AbortSignal) =>
  scoped(await apiPost<CampaignResult>(prefix(mode) + '/campaign-briefs', input, signal, 30_000), mode);
export const processing = async (mode: DataMode, signal: AbortSignal) =>
  scoped(await apiGet<ProcessingResult>(prefix(mode) + '/processing', signal), mode);
export const calculateScenario = (mode: DataMode, input: ScenarioRequest, signal: AbortSignal) =>
  apiPost<ScenarioResult>(prefix(mode) + '/scenarios', input, signal);

export function campaignInput(brief: Brief): CampaignRequest {
  const list = (text?: string) => [...new Set((text ?? '').split(',').map(value => value.trim()).filter(Boolean))];
  const platform = brief.platform.toLowerCase() as Platform;
  const deliverable = brief.deliverable as Deliverable;
  const market = brief.market.trim().toLowerCase() === 'hong kong' ? 'HK' : brief.market.trim().toUpperCase();
  const language = (brief.language === 'Cantonese' ? 'yue' : brief.language) as Language;
  const required_facts = list(brief.requiredFacts), preferred_facts = list(brief.preferredFacts);
  const category_labels = list(brief.categoryLabels);
  if (brief.description.length < 2 || !Object.hasOwn(platformOptions, platform) || !Object.hasOwn(deliverableOptions, deliverable)) {
    throw Error('Enter a campaign description, platform and deliverable.');
  }
  if (brief.creatorCount < 1 || brief.creatorCount > 8) throw Error('Choose between one and eight creators.');
  if (market && !/^[A-Z]{2}$/.test(market)) throw Error('Use Hong Kong or a two-letter market code.');
  if (brief.minAudience > 0 && !market) throw Error('Choose a market for the audience minimum.');
  if ((language && !Object.hasOwn(languageOptions, language)) || (brief.requireCantonese && !language)) {
    throw Error('Choose a supported campaign language.');
  }
  if ([required_facts, preferred_facts].some(facts => facts.length > 10 || facts.some(fact => !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(fact)))) {
    throw Error('Use up to ten comma-separated reviewed fact identifiers in each field.');
  }
  if (category_labels.length > 9 || category_labels.some(label => label.length > 120)) {
    throw Error('Use up to nine category labels of 120 characters each.');
  }
  return {
    description: brief.description, objective: brief.objective === 'Engagement' ? 'engagement' : 'awareness',
    budget_minor: brief.budget * 100, currency: 'HKD', platform, deliverable,
    market: market || undefined, minimum_market_share: brief.minAudience > 0 ? String(brief.minAudience / 100) : undefined,
    language: language || undefined, require_language: brief.requireCantonese, required_facts, preferred_facts,
    minimum_creators: brief.creatorCount, maximum_creators: brief.creatorCount,
    category_labels: category_labels.length ? category_labels : undefined,
  };
}

export const amount = (minor: number, currency = 'HKD') =>
  new Intl.NumberFormat('en-HK', { style: 'currency', currency, minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
export const date = (value: string) => new Date(value).toLocaleDateString('en-HK', { dateStyle: 'medium', timeZone: 'Asia/Hong_Kong' });
export const isFresh = (expires: string) => Date.parse(expires) > Date.now();
export const visibleFor = (mode: DataMode, evidence: EvidenceRef) =>
  isFresh(evidence.expires_at) && (mode === 'demo' ? evidence.origin === 'synthetic'
    : ['creator_profile', 'creator_authored', 'creator_quote', 'creator_first_party_performance', 'creator_opt_in_survey'].includes(evidence.origin));

export function campaignExpiry(report: CampaignResult) {
  const times = report.recommendations.flatMap(candidate => [
    candidate.profile_evidence.expires_at,
    ...candidate.evidence.flatMap(post => [post.content.evidence.expires_at, post.performance?.evidence.expires_at]),
    ...Object.values(candidate.requirement_evidence).map(evidence => evidence.expires_at),
    candidate.market_evidence?.evidence.expires_at, candidate.quote?.evidence.expires_at, candidate.quote?.data.valid_until,
  ]).map(value => Date.parse(value ?? '')).filter(Number.isFinite);
  return times.length ? Math.min(...times) : undefined;
}
