import { apiLocal } from '../../lib/api';

export const channelPattern = 'UC[A-Za-z0-9_-]{22}';
const root = '/marketing/research';
type DataState = 'pending' | 'available' | 'expired' | 'unavailable';

interface Provenance {
  provider: 'youtube_data_api';
  endpoint: 'channels' | 'playlistItems' | 'videos' | 'search';
  run_id: string;
  observed_at: string;
  expires_at: string;
}

export type ResearchMetric = { status: 'available'; value: number }
  | { status: 'unavailable' | 'hidden' | 'expired' | 'unsupported'; value: null };

export interface ResearchRun {
  id: string;
  kind: 'refresh' | 'discovery';
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  error_code: string | null;
  available_after: string | null;
  attempts: number;
  standard_units: number;
  search_calls: number;
}

export interface ResearchAccount {
  channel_id: string;
  refresh_hours: number;
  next_refresh_at: string | null;
  state: DataState | 'withdrawn';
  scan_truncated: boolean;
  last_run: ResearchRun | null;
  snapshot: { title: string; subscribers: ResearchMetric; provenance: Provenance } | null;
  posts: { video_id: string; title: string; published_at: string; views: ResearchMetric; likes: ResearchMetric;
    comments: ResearchMetric; provenance: Provenance }[];
}

export interface Discovery {
  run: ResearchRun;
  state: DataState;
  leads: { channel_id: string; title: string; provenance: Provenance }[];
}

export function researchClient(token: string) {
  const account = (channel: string) => root + '/accounts/' + encodeURIComponent(channel);
  return {
    read: (channel: string, signal: AbortSignal) => apiLocal<ResearchAccount>(account(channel), token, signal),
    watch: (channel: string, hours: number, signal: AbortSignal) =>
      apiLocal<ResearchAccount>(account(channel), token, signal, 'PUT', { refresh_hours: hours }),
    refresh: (channel: string, signal: AbortSignal) => apiLocal<ResearchRun>(account(channel) + '/refresh', token, signal, 'POST'),
    withdraw: (channel: string, signal: AbortSignal) => apiLocal<void>(account(channel), token, signal, 'DELETE'),
    discover: (query: string, signal: AbortSignal) => apiLocal<ResearchRun>(root + '/discoveries', token, signal, 'POST', { query }),
    readDiscovery: (run: string, signal: AbortSignal) => apiLocal<Discovery>(root + '/discoveries/' + encodeURIComponent(run), token, signal),
    readRun: (run: string, signal: AbortSignal) => apiLocal<ResearchRun>(root + '/runs/' + encodeURIComponent(run), token, signal),
    resume: (signal: AbortSignal) => apiLocal<void>(root + '/provider/resume', token, signal, 'POST'),
  };
}