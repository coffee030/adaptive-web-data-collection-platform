import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { ApiError } from '../../lib/api';
import { RequestProblem } from '../../components/feedback';
import { jobPath } from '../collection-jobs/api';
import { profilePath } from '../profiles/api';
import { sourcePath } from '../sources/api';
import type { EvidenceMetadata, GenericRecord, Lineage, SourcePosition } from './api';

export function Metadata({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><dt>{label}</dt><dd>{children}</dd></div>;
}

export function ProvenanceFields({ lineage }: { lineage: Lineage }) {
  const { job_id, source_id, profile_version_id } = lineage;
  return (
    <>
      <Metadata label="Collection Job">
        <Link className="identifier" to={jobPath(job_id)} aria-label={`Open job ${job_id}`}>{job_id}</Link>
      </Metadata>
      <Metadata label="Source">
        <Link className="identifier" to={sourcePath(source_id)} aria-label={`Open source ${source_id}`}>{source_id}</Link>
      </Metadata>
      <Metadata label="Profile Version">
        <Link className="identifier" to={profilePath(source_id, profile_version_id)}
          aria-label={`Open profile version ${profile_version_id}`}>{profile_version_id}</Link>
      </Metadata>
    </>
  );
}

export function positionLabel(position: SourcePosition) {
  return position.kind === 'csv_row' ? `CSV row ${position.index}` : `HTML item ${position.index}`;
}

export function ResultProblem({ error, resource, retry }: {
  error: ApiError; resource: string; retry: () => void;
}) {
  if (error.status === 404 || error.status === 422) {
    const invalid = error.status === 422;
    return (
      <div role="alert" className="notice">
        <strong>{invalid ? `Invalid ${resource} ID` : `${resource} not found`}</strong>
        <p>Check the ID in the address or reopen the linked item.</p>
        <p className="muted">HTTP {error.status}</p>
      </div>
    );
  }
  return <RequestProblem error={error} resource={resource.toLowerCase()} retry={retry} />;
}

export function CopyButton({ label, read }: { label: string; read: () => string }) {
  const [message, setMessage] = useState('');
  async function copy() {
    try {
      await navigator.clipboard.writeText(read());
      setMessage('Copied to clipboard.');
    } catch {
      setMessage('Clipboard unavailable. Select and copy the displayed text.');
    }
  }
  return (
    <div className="result-copy">
      <button type="button" onClick={copy}>{label}</button>
      <span className={message ? 'muted' : 'sr-only'} role="status">{message}</span>
    </div>
  );
}

export function clip(value: string, limit: number) {
  if (value.length <= limit) return value;
  return value.slice(0, limit).replace(/[\uD800-\uDBFF]$/, '') + '…';
}

export const marketWarning = 'SIMULATED DATA — NOT LIVE MARKET PRICES';

export const recordTitleFields = ['title', 'name', 'headline'] as const;

export function recordTitle(record: GenericRecord) {
  for (const field of recordTitleFields) {
    const value = Object.hasOwn(record.payload, field) ? record.payload[field] : undefined;
    if (typeof value === 'string' && value.trim()) return value;
  }
  return `${record.record_type} · ${record.record_id.slice(0, 8)}`;
}

export function displayValue(value: unknown) {
  if (value === '') return '(empty)';
  if (value === null) return 'Null';
  if (value === undefined) return '—';
  return String(value);
}

export function PayloadPreview({ payload, omit }: { payload: Record<string, unknown>; omit?: string }) {
  const keys = Object.keys(payload).filter(name => name !== omit);
  if (!keys.length) return <span className="muted">No fields</span>;
  const extra = keys.length - 3;
  return (
    <>
      <dl className="payload">
        {keys.slice(0, 3).map(name => {
          const value = payload[name];
          const sample = Array.isArray(value) ? '[…]'
            : value !== null && typeof value === 'object' ? '{…}' : clip(displayValue(value), 96);
          return <div key={name}><dt>{clip(name, 36)}</dt><dd>{sample}</dd></div>;
        })}
      </dl>
      {extra > 0 && <span className="muted">+{extra} more {extra === 1 ? 'field' : 'fields'}</span>}
    </>
  );
}

export function webLocation(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
  } catch {
    // Return a neutral label for an unusable location.
  }
  return 'Unavailable';
}

export function captureLabel(evidence: EvidenceMetadata) {
  if (evidence.capture_kind === 'search') return 'Search results page';
  if (evidence.capture_kind === 'detail') return 'Detail page';
  if (evidence.adapter_type === 'csv') return 'CSV input';
  return evidence.capture_kind === 'input' ? 'HTML input' : 'HTML capture';
}
