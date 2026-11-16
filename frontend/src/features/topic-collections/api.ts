import { apiGet } from '../../lib/api';
import type { CollectionJob, JobStatus } from '../collection-jobs/api';

export const topicsPath = '/topics';
export const requestsPath = '/collection-requests';
export const newRequestPath = requestsPath + '/new';
export const articlesPath = '/articles';
export const requestPath = (id: string) => `${requestsPath}/${encodeURIComponent(id)}`;
export const articlePath = (id: string) => `${articlesPath}/${encodeURIComponent(id)}`;
export const bindingsPath = (id: string) => `${topicsPath}/${encodeURIComponent(id)}/bindings`;

export interface Category {
  id: string;
  name: string;
  active: boolean;
}
export interface Topic extends Category {
  category_id: string;
}
export interface Binding {
  id: string;
  source_id: string;
  source_name: string;
  profile_version_id: string;
  profile_version: number;
  config_hash: string;
  approved_by: string;
  approved_at: string;
  disabled_at: string | null;
  eligible: boolean;
}
export interface CollectionRequest {
  id: string;
  keyword: string;
  topic_name: string;
  status: JobStatus;
  created_at: string;
  finished_at: string | null;
  refresh_of: string | null;
  jobs: { binding_id: string; approved_by: string; approved_at: string;
    source_name: string; profile_version: number; job: CollectionJob }[];
}
export interface ArticleSummary {
  id: string;
  source_id: string;
  source_name: string;
  title: string;
  url: string;
  captured_at: string;
  version: number;
}
export interface VersionInfo {
  id: string;
  version: number;
  content_hash: string;
  created_at: string;
}
export interface ArticleVersion extends VersionInfo {
  content: { title: string; author: string | null; published_at: string | null;
    summary: string | null; body: string | null };
}
export interface Observation {
  record_id: string;
  job_id: string;
  evidence_id: string;
  profile_version_id: string;
  config_hash: string;
  content_version_id: string;
  captured_at: string;
  url: string;
  request_id: string | null;
}
export interface ObservationDetail extends Observation {
  raw_payload: Record<string, string | number | boolean | null>;
}
export interface ArticleDetail extends ArticleSummary {
  latest_version: ArticleVersion;
  latest_observation: Observation;
}

export function listPage<T>(path: string, signal: AbortSignal, limit: number, offset: number,
  filters: Record<string, string> = {}) {
  const params = new URLSearchParams({ ...filters, limit: String(limit), offset: String(offset) });
  return apiGet<T[]>(`${path}?${params}`, signal);
}

export async function listOptions<T>(path: string, signal: AbortSignal, filters?: Record<string, string>) {
  const options: T[] = [];
  for (let offset = 0; ; offset += 100) {
    const page = await listPage<T>(path, signal, 100, offset, filters);
    options.push(...page);
    if (page.length < 100) return options;
  }
}

export const listCategories = (signal: AbortSignal) => listOptions<Category>('/categories', signal);
export const listTopics = (signal: AbortSignal) => listOptions<Topic>(topicsPath, signal);
export const listActiveTopics = (signal: AbortSignal) => listOptions<Topic>(topicsPath, signal, { active_only: 'true' });
