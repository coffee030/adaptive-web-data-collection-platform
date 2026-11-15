import { ApiError, apiGet, apiPatch, apiPost } from '../../lib/api';
import type { Profile } from '../profiles/api';

export const sourcesPath = '/sources';
export type Adapter = 'web' | 'csv';

export interface Source {
  source_id: string;
  source_name: string;
  adapter_type: Adapter;
  permission_reference: string;
  approval_status: 'pending' | 'approved' | 'revoked';
  allowed_origins: string[];
  allowed_datasets: string[];
  allowed_paths?: Record<string, string[]>;
  min_request_interval_ms?: number;
}

export type CreateSourceInput = Pick<Source, 'source_name' | 'adapter_type' | 'permission_reference'>
  & Partial<Pick<Source, 'allowed_origins' | 'allowed_datasets' | 'allowed_paths' | 'min_request_interval_ms'>>;

export interface ProfileVersion {
  profile_version_id: string;
  version: number;
  config_hash: string;
  approval_status: 'draft' | 'approved' | 'retired';
  approved_by: string | null;
  approved_at: string | null;
}

export const sourcePath = (id: string) => `${sourcesPath}/${encodeURIComponent(id)}`;

export const listSources = (signal: AbortSignal) => apiGet<Source[]>(sourcesPath, signal);
export const getSource = (id: string, signal: AbortSignal) => apiGet<Source>(sourcePath(id), signal);
export const setSourceAuthorization = (id: string, approval_status: 'approved' | 'revoked', signal: AbortSignal) =>
  apiPatch<Source>(`${sourcePath(id)}/authorization`, { approval_status }, signal);
export const listVersions = (id: string, signal: AbortSignal) =>
  apiGet<Profile[]>(`${sourcePath(id)}/versions`, signal);

export async function createSource(input: CreateSourceInput & { request_key: string }, signal: AbortSignal) {
  const source = await apiPost<Source>(sourcesPath, { ...input, approval_status: 'pending' }, signal);
  if (!source || typeof source.source_id !== 'string' || !/^[\da-f]{32}$/i.test(source.source_id)) {
    throw new ApiError('invalid-response');
  }
  return source;
}

export const adapterLabels: Record<Adapter, string> = { web: 'Controlled web', csv: 'CSV' };
