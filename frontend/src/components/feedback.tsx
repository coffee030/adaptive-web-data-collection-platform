import type { ReactNode } from 'react';
import type { ApiError } from '../lib/api';

const date = new Intl.DateTimeFormat('en-GB', {
  year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC',
});
const time = new Intl.DateTimeFormat('en-GB', {
  hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC',
});

export function Timestamp({ value }: { value: string | null }) {
  if (!value) return <span className="muted">Not recorded</span>;
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return <span className="muted">Unavailable</span>;
  return (
    <time className="timestamp" dateTime={value}>
      {date.format(instant)}<span>{time.format(instant)}</span>
    </time>
  );
}

export function Loading({ children }: { children: ReactNode }) {
  return <div className="notice muted" role="status">{children}</div>;
}

export function RequestProblem({
  error, resource, retry,
}: { error: ApiError; resource: string; retry: () => void }) {
  let title = `Could not load ${resource}`;
  let message = 'Retry to request the latest data.';
  if (error.kind === 'network' || error.status === 502 || error.status === 503 || error.status === 504) {
    title = 'Backend unavailable';
    message = `Check the API connection, then retry loading ${resource}.`;
  } else if (error.kind === 'timeout') {
    message = 'The API request timed out. Retry to request the latest data.';
  } else if (error.kind === 'invalid-response') {
    message = 'The API returned an unreadable response. Check the API address and retry.';
  }
  return (
    <div className="notice request-problem">
      <div role="alert">
        <strong>{title}</strong>
        <p>{message}</p>
        {error.status && <p className="muted">HTTP {error.status}{error.code && <> · <code>{error.code}</code></>}</p>}
      </div>
      <button type="button" onClick={retry}>Retry</button>
    </div>
  );
}

export function TableRegion({
  label, children,
}: { label: string; children: ReactNode }) {
  return (
    <>
      <p className="scroll-hint" aria-hidden="true">Scroll sideways to see more columns</p>
      <div className="table-region" role="region" aria-label={label} tabIndex={0}>
        {children}
      </div>
    </>
  );
}

export function Pagination({
  label, offset, size, loaded, change, maxOffset = Infinity,
}: { label: string; offset: number; size: number; loaded: number; change: (offset: number) => void; maxOffset?: number }) {
  const last = offset + Math.min(loaded, size);
  return (
    <nav className="pagination" aria-label={`${label} pagination`}>
      <span role="status">{loaded > 1 ? `${label} ${offset + 1}–${last}`
        : loaded === 1 ? `${label} ${last}` : `No ${label.toLowerCase()} on this page`}</span>
      <div className="page-buttons">
        <button type="button" aria-label={`Previous ${label.toLowerCase()} page`}
          disabled={offset === 0} onClick={() => change(Math.max(offset - size, 0))}>Previous</button>
        <button type="button" aria-label={`Next ${label.toLowerCase()} page`}
          disabled={loaded <= size || offset + size > maxOffset} onClick={() => change(offset + size)}>Next</button>
      </div>
    </nav>
  );
}

export function Status({ value }: { value: string }) {
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  return <span className="status" data-status={value}>{label}</span>;
}
