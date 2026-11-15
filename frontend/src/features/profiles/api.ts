import { apiGet, apiPost, apiPut } from '../../lib/api';
import { sourcePath } from '../sources/api';
import type { ProfileVersion } from '../sources/api';
import type { CollectionInput } from '../sources/collectionInput';

export const valueTypes = ['string', 'integer', 'number', 'boolean'] as const;
export const selectorTypes = ['css', 'xpath'] as const;
export const paginationLimits = [1, 2, 3, 4, 5] as const;
type ValueType = typeof valueTypes[number];
export type SelectorType = typeof selectorTypes[number];
export interface RecordField { name: string; value_type: ValueType; required: boolean }
interface Schema { record_type: string; schema_version: '1'; identity_field: string | null; fields: RecordField[] }
interface Extraction {
  name: string; selector: string; selector_type: SelectorType | null;
  mode: 'text' | 'attribute'; attribute: string | null; resolve_url: boolean;
}
interface BaseConfiguration { config_schema_version: '1'; record_schema: Schema }
export type Configuration = BaseConfiguration & (
  | { adapter_type: 'csv'; columns: { name: string; column: string }[] }
  | {
    adapter_type: 'web'; selector_type: SelectorType; item_selector: string; fields: Extraction[];
    pagination?: { next_link_selector: string; max_pages: number };
  }
);
export interface Profile extends ProfileVersion {
  revision: number;
  configuration: Configuration;
  source_id: string;
  validation_report_id: string | null;
}
export type Sample = CollectionInput;
export interface Rejection {
  source_position: { kind: 'html_item' | 'csv_row'; index: number };
  problems: { code: string; field: string | null; message: string }[];
}
export interface Candidate extends Rejection {
  payload: Record<string, string | number | boolean | null>;
}
export interface Report {
  report_id: string;
  profile_version_id: string;
  config_hash: string;
  sample_location: string | null;
  sample_hash: string | null;
  validated_at: string;
  valid_count: number;
  invalid_count: number;
  duplicate_count: number;
  invalid: Rejection[];
  error: { code: string; message: string } | null;
  passed: boolean;
}

export const profilePath = (source: string, profile: string) =>
  `${sourcePath(source)}/profiles/${encodeURIComponent(profile)}`;
const versions = (source: string) => `${sourcePath(source)}/versions`;
const version = (source: string, id: string) => `${versions(source)}/${encodeURIComponent(id)}`;

export const getProfile = (source: string, id: string, signal: AbortSignal) =>
  apiGet<Profile>(version(source, id), signal);
export const createProfile = (source: string, configuration: Configuration, signal: AbortSignal) =>
  apiPost<Profile>(versions(source), { configuration }, signal);
export const saveProfile = (source: string, id: string, configuration: Configuration,
  expectedRevision: number, signal: AbortSignal) =>
  apiPut<Profile>(version(source, id), { configuration, expected_revision: expectedRevision }, signal);
export const previewProfile = (source: string, id: string, sample: Sample, signal: AbortSignal) =>
  apiPost<Candidate[]>(version(source, id) + '/preview', sample, signal);
export const validateProfile = (source: string, id: string, sample: Sample, signal: AbortSignal) =>
  apiPost<Report>(version(source, id) + '/validate', sample, signal);
export const approveProfile = (source: string, id: string, report: Report, approver: string, signal: AbortSignal) =>
  apiPost<Profile>(version(source, id) + '/approve', {
    approver, report_id: report.report_id, config_hash: report.config_hash,
  }, signal);
