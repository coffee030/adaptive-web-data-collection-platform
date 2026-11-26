import { ApiError, apiGet, apiPost } from '../../lib/api';
import type { CollectionInput } from '../sources/collectionInput';

export const jobStatuses = ['pending', 'running', 'pausing', 'paused', 'succeeded', 'partial', 'failed', 'cancelled'] as const;
export type JobStatus = (typeof jobStatuses)[number];
export type JobAction = 'pause' | 'resume' | 'cancel';

export function jobInProgress(status: JobStatus | undefined) {
  return status === 'pending' || status === 'running' || status === 'pausing';
}

export function jobAwaitingOutcome(status: JobStatus | undefined) {
  return jobInProgress(status) || status === 'paused';
}

export type JobOrder = 'oldest' | 'newest';
export type ExecutionOrigin = 'worker' | 'direct';

export interface CollectionError {
  code: string;
  message: string;
  http_status?: number | null;
  retry_after_seconds?: number | null;
}

export interface CollectionJob {
  job_id: string;
  source_id: string;
  profile_version_id: string;
  config_hash: string;
  status: JobStatus;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  error: CollectionError | null;
  execution_attempt: number;
  lease_expires_at: string | null;
  next_attempt_at: string | null;
  dispatch_due_at: string | null;
  last_dispatched_at: string | null;
  dispatch_attempts: number;
  dispatch_error_code: string | null;
}

export interface JobDetailResponse extends CollectionJob {
  latest_claim_worker_instance_id?: string | null;
  latest_claim_execution_origin?: ExecutionOrigin | null;
  latest_worker_heartbeat_at?: string | null;
  latest_worker_offline_detected_at?: string | null;
}

export interface ExecutionEvent {
  event_id: string;
  job_id: string;
  status: JobStatus;
  occurred_at: string;
  kind: string | null;
  execution_attempt: number | null;
  worker_instance_id?: string | null;
  execution_origin?: ExecutionOrigin | null;
  error: CollectionError | null;
}

export const jobsPath = '/collection-jobs';
export const newJobPath = jobsPath + '/new';
export const jobPath = (id: string) => `${jobsPath}/${encodeURIComponent(id)}`;
export const maxOffset = 2_147_483_647;

export interface JobInput {
  source_id: string;
  profile_version_id: string;
  entry: CollectionInput;
}

export function jobSubmissionPath(sourceId: string, profileId?: string) {
  const params = new URLSearchParams({ source_id: sourceId });
  if (profileId) params.set('profile_version_id', profileId);
  return `${newJobPath}?${params}`;
}

export function sameId(value: string | null, id: string) {
  return value?.replaceAll('-', '').toLowerCase() === id.replaceAll('-', '').toLowerCase();
}

export async function createJob(input: JobInput & { request_key: string }, signal: AbortSignal) {
  const job = await apiPost<CollectionJob>(jobsPath, input, signal);
  if (!job || typeof job.job_id !== 'string' || !/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(job.job_id)
    || !jobStatuses.includes(job.status) || typeof job.source_id !== 'string' || typeof job.profile_version_id !== 'string'
    || !sameId(job.source_id, input.source_id) || !sameId(job.profile_version_id, input.profile_version_id)) {
    throw new ApiError('invalid-response');
  }
  return job;
}

export function listJobs(pageSize: number, offset: number, status: JobStatus | '', signal: AbortSignal, order?: JobOrder) {
  const query = new URLSearchParams({ limit: String(pageSize + 1), offset: String(offset) });
  if (order) query.set('order', order);
  if (status) query.set('status', status);
  return apiGet<CollectionJob[]>(`${jobsPath}?${query}`, signal);
}

export function getJob(id: string, signal: AbortSignal) {
  return apiGet<JobDetailResponse>(jobPath(id), signal);
}

export function controlJob(id: string, action: JobAction, signal: AbortSignal) {
  return apiPost<CollectionJob>(`${jobPath(id)}/control`, { action }, signal);
}

export function listEvents(id: string, signal: AbortSignal) {
  return apiGet<ExecutionEvent[]>(`${jobPath(id)}/events`, signal);
}
