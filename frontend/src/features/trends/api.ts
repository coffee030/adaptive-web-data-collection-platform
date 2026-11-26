import { apiGet, ApiError } from '../../lib/api';

export const trendBase = '/trends/wikimedia';

export interface Provider {
  configured: boolean;
  authorized: boolean;
  blocked: boolean;
  source_id: string | null;
  next_request_at: string | null;
  last_error: string | null;
  policy: string;
  data_license: string;
}

export interface RankedArticle {
  article: string;
  rank: number;
  views: number;
}

export interface Discovery {
  project: string;
  day_utc: string;
  source_url: string;
  articles: RankedArticle[];
}

export interface Series {
  id: string;
  topic: string;
  article: string;
  project: string;
  active: boolean;
  start_day: string;
  next_day: string;
  due_at: string;
  last_capture_at: string | null;
  last_error: string | null;
  last_job: string | null;
  pending_job: string | null;
}

export interface Point {
  views: number;
  source_url: string;
  response_sha256: string;
  capture_at: string;
  job_id: string;
  record_id: string;
  evidence_id: string;
}

export interface ComparedSeries extends Series {
  points: (Point | null)[];
  coverage: { observed_days: number; requested_days: number; change_views: number | null };
}

export interface Comparison {
  days: string[];
  series: ComparedSeries[];
}

export const getProvider = (signal: AbortSignal) => apiGet<Provider>(trendBase + '/provider', signal);
export const getSeries = (signal: AbortSignal) => apiGet<Series[]>(trendBase + '/series', signal);
export const articleTitle = (key: string) => key.replaceAll('_', ' ');
export const number = new Intl.NumberFormat('en-GB');

export function daysAgo(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const messages: Record<string, string> = {
  source_not_approved: 'The source needs active approval. Review its source and mapping before continuing.',
  local_approval_required: 'Open the local console with source approval enabled.',
  publisher_access_blocked: 'The publisher has blocked requests. Review its access decision before continuing.',
  publisher_wait: 'The publisher request window is closed. Check the next permitted request time above.',
  publisher_rate_limited: 'Wikimedia limited further requests. Check the next permitted request time above.',
  no_data_from_publisher: 'Wikimedia has no eligible data for this sample. Choose another date or article.',
  publisher_unavailable: 'Wikimedia is temporarily unavailable. Check the source status before retrying.',
  publisher_invalid_response: 'The publisher returned data that could not be validated.',
  publisher_dates_missing: 'Some dates have no reported count.',
  series_already_exists: 'This edition and article already belong to a different topic. Open saved series to inspect it.',
  series_limit: 'The installation already has 32 saved series.',
  invalid_date_window: 'Choose an ordered UTC interval of at most 90 days.',
};

export function problemText(code: string) {
  return messages[code] ?? code.replaceAll('_', ' ');
}

export function actionProblem(cause: unknown) {
  if (!(cause instanceof ApiError)) return 'The request could not be completed.';
  if (cause.kind === 'timeout') return 'The request timed out. Check the current source and saved series before retrying.';
  if (cause.kind === 'network') return 'The Core API could not be reached. Check the connection and retry.';
  if (cause.fields.length) return 'Check the following fields: ' + cause.fields.join(', ') + '.';
  return cause.code ? problemText(cause.code) : 'The Core API could not complete the request.';
}
