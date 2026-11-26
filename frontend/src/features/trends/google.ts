import { ApiError, apiGet } from '../../lib/api';

export const googleBase = '/trends/google';

export interface GoogleProvider {
  authorized: boolean;
  source_id: string | null;
  source_approval_status?: 'pending' | 'approved' | 'revoked' | null;
  profile_id: string | null;
  policy: string;
  blocked: boolean;
  retry_at: string | null;
  last_error: string | null;
}

export interface MarketSchedule {
  region: string;
  active: boolean;
  interval_minutes: number;
  due_at: string | null;
  claimed_at: string | null;
  last_error: string | null;
  pending_job: string | null;
  last_job: string | null;
  observed_at: string | null;
}

export interface MarketSnapshot {
  region: string;
  observed_at: string | null;
  source_url: string | null;
  response_sha256: string | null;
  events: {
    event_id: string;
    query: string;
    published_at: string;
    observed_at: string;
    traffic_bucket: string | null;
    traffic_lower_bound: number | null;
    record_id: string;
    job_id: string;
    evidence_id: string;
  }[];
}

export const getGoogleProvider = (signal: AbortSignal) => apiGet<GoogleProvider>(googleBase + '/provider', signal);
export const getMarketSchedules = (signal: AbortSignal) => apiGet<MarketSchedule[]>(googleBase + '/schedules', signal);
export const marketPath = (region: string) => googleBase + '/schedules/' + encodeURIComponent(region);

const names = new Intl.DisplayNames('en', { type: 'region', style: 'short', fallback: 'none' });
const fullNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
export function marketName(region: string) {
  if (!/^[A-Z]{2}$/.test(region)) return region;
  const short = names.of(region);
  const name = short && short.length > 2 ? short : fullNames.of(region);
  return name ? name + ' (' + region + ')' : region;
}

const messages: Record<string, string> = {
  publisher_access_blocked: 'Google has stopped access. New checks are suspended pending review of publisher access.',
  source_not_approved: 'Source approval is inactive. Review the Core source before collecting or viewing snapshots.',
  local_approval_required: 'Use the local operator console with source approval enabled.',
  publisher_rate_limited: 'Google has asked Core to wait before checking again.',
  publisher_wait: 'The next permitted publisher check is pending.',
  publisher_unavailable: 'Google could not be reached during the last check.',
  publisher_invalid_response: 'The feed failed validation for this market.',
  publisher_robots_unavailable: 'Core could not verify the publisher’s access instructions.',
  no_data_from_publisher: 'The sample contained no eligible trending searches.',
  schedule_exists: 'This market already has a schedule. Open it to change its interval.',
};

export const googleIssue = (code: string) => messages[code] ?? code.replaceAll('_', ' ');
export function googleActionError(error: unknown) {
  if (!(error instanceof ApiError)) return 'Could not complete this action.';
  if (error.kind === 'timeout') return 'The request timed out. Refresh the current schedule before retrying.';
  if (error.kind === 'network') return 'Core could not be reached. Check the connection and retry.';
  if (error.fields.length) return 'Review the ' + error.fields.join(', ') + ' fields and try again.';
  return error.code ? googleIssue(error.code) : 'Core could not confirm this action.';
}
