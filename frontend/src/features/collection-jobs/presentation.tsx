import type { CollectionError, CollectionJob, JobStatus } from './api';

export const statusLabels: Record<JobStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  succeeded: 'Succeeded',
  partial: 'Partial',
  failed: 'Failed',
};

export const resultCounts = [
  { key: 'valid_count', label: 'Valid' },
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
