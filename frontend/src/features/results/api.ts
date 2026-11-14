import { apiGet } from '../../lib/api';
import { jobPath } from '../collection-jobs/api';

export type Scalar = string | number | boolean | null;

export interface SourcePosition {
  kind: 'html_item' | 'csv_row';
  index: number;
}

export interface RecordProblem {
  code: 'required_field' | 'wrong_type' | 'invalid_row' | 'unexpected_field' | 'duplicate';
  field?: string | null;
  message: string;
}

export interface Lineage {
  job_id: string;
  source_id: string;
  profile_version_id: string;
}

interface ResultEntry extends Lineage {
  record_id: string;
  evidence_reference: string;
  source_position: SourcePosition;
  created_at: string;
}

export interface GenericRecord extends ResultEntry {
  record_type: string;
  schema_version: string;
  source_record_key: string | null;
  deduplication_key: string;
  payload: Record<string, Scalar>;
  validation_status: 'passed';
  provenance: {
    source_id: string;
    run_id: string;
    profile_version_id: string;
    config_hash: string;
    validation_status?: 'passed';
  };
}

export interface QuarantineEntry extends ResultEntry {
  problems: RecordProblem[];
}

export interface EvidenceMetadata extends Lineage {
  evidence_id: string;
  run_id: string;
  config_hash: string;
  captured_at: string;
  content_hash: string;
  content_type: string | null;
  adapter_type: 'web' | 'csv';
  original_location: string;
  requested_location: string | null;
  http_status: number | null;
}

export const recordsPath = '/records';
export const evidencePath = '/evidence';
export const recordPath = (id: string) => `${recordsPath}/${encodeURIComponent(id)}`;
export const evidenceDetailPath = (id: string) => `${evidencePath}/${encodeURIComponent(id)}`;
export const quarantinePath = (jobId: string) => `${jobPath(jobId)}/quarantine`;

export function recordsForJob(jobId: string) {
  return `${recordsPath}?${new URLSearchParams({ job_id: jobId })}`;
}

function pageQuery(pageSize: number, offset: number) {
  return new URLSearchParams({ limit: String(pageSize + 1), offset: String(offset) });
}

export function listRecords(jobId: string, pageSize: number, offset: number, signal: AbortSignal, order?: 'newest') {
  const query = pageQuery(pageSize, offset);
  if (order) query.set('order', order);
  if (jobId) query.set('job_id', jobId);
  return apiGet<GenericRecord[]>(`${recordsPath}?${query}`, signal);
}

export function getRecord(id: string, signal: AbortSignal) {
  return apiGet<GenericRecord>(recordPath(id), signal);
}

export function getEvidence(id: string, signal: AbortSignal) {
  return apiGet<EvidenceMetadata>(evidenceDetailPath(id), signal);
}

export function getJobEvidence(id: string, signal: AbortSignal) {
  return apiGet<EvidenceMetadata | null>(`${jobPath(id)}/evidence`, signal);
}

export function listQuarantine(id: string, pageSize: number, offset: number, signal: AbortSignal) {
  return apiGet<QuarantineEntry[]>(`${quarantinePath(id)}?${pageQuery(pageSize, offset)}`, signal);
}
