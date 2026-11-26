import type { CollectionError, CollectionJob, JobStatus } from './api';

export const statusLabels: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  pausing: 'Pausing',
  paused: 'Paused',
  succeeded: 'Succeeded',
  partial: 'Partial',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const resultCounts = [
  { key: 'valid_count', label: 'Accepted' },
  { key: 'invalid_count', label: 'Invalid' },
  { key: 'duplicate_count', label: 'Duplicates' },
] as const satisfies ReadonlyArray<{ key: keyof CollectionJob; label: string }>;

export function ResultCounts({ job }: { job: CollectionJob }) {
  return (
    <dl className="counts" aria-label="Result counts">
      {resultCounts.map(count => (
        <div key={count.key}><dt>{count.label}</dt><dd className="numeric">{job[count.key]}</dd></div>
      ))}
    </dl>
  );
}

export function ErrorDetails({ error }: { error: CollectionError }) {
  return (
    <div className="error-details">
      <p>{error.message}</p>
      <ul className="error-metadata">
        <li><code>{error.code}</code></li>
        {error.http_status != null && <li>HTTP {error.http_status}</li>}
        {error.retry_after_seconds != null && <li>Retry-After {error.retry_after_seconds}s</li>}
      </ul>
    </div>
  );
}

export function errorCategory(error: CollectionError) {
  if (error.code === 'source_not_approved') return 'Source authorization';
  if (error.http_status === 429 || error.code === 'rate_limited' || error.code === 'origin_rate_busy') return 'Rate limiting';
  if (error.http_status === 401 || error.http_status === 403 ||
    ['destination_denied', 'robots_denied', 'access_denied', 'dataset_not_allowed'].includes(error.code)) return 'Access denied';
  if (['timeout', 'transport_error', 'robots_unavailable'].includes(error.code)) return 'Connection or response failure';
  if (['database_unavailable', 'origin_rate_unavailable'].includes(error.code)) return 'Service unavailable';
  if (error.code.includes('profile') || error.code.includes('config')) return 'Profile or configuration';
  if (['no_valid_records', 'invalid_csv', 'validation_failed'].includes(error.code)) return 'Validation failure';
  if (error.code.includes('evidence') || error.code.includes('persistence')) return 'Evidence or result storage';
  if (error.code === 'retry_exhausted') return 'Retry limit reached';
  return 'Recorded execution error';
}
