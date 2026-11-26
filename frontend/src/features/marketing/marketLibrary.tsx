import { useCallback, type ReactNode } from 'react';
import { apiGet, ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { useMarketing } from './workspace';

export const marketBase = '/marketing/intelligence/partner/market';
export const campaignBase = '/marketing/companies/campaigns';
export const formatCount = (n: number) => new Intl.NumberFormat('en-HK').format(n);
export const displayDate = (s: string) =>
  new Intl.DateTimeFormat('en-HK', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Hong_Kong',
  }).format(new Date(s));
export const money = (minor: number) =>
  new Intl.NumberFormat('en-HK', {
    style: 'currency',
    currency: 'HKD',
    maximumFractionDigits: 2,
  }).format(minor / 100);
export const platformName = (value: string) =>
  ({
    inaturalist: 'iNaturalist',
    peertube: 'PeerTube',
    wordpress: 'WordPress',
    global_voices: 'Global Voices',
    wordpress_photos: 'WordPress Photos',
    youtube: 'YouTube',
    instagram: 'Instagram',
    facebook: 'Facebook',
    tiktok: 'TikTok',
  })[value] ?? value.replaceAll('_', ' ');

export interface Measurement {
  key: string;
  label: string;
  value: number;
}
export interface Activity {
  id: string;
  creator_id: string;
  creator_name: string;
  platform: string;
  title: string;
  published_at: string;
  url: string;
  topics: string[];
  license_url: string;
  credit_role?: string;
  credit_url?: string;
  broadcaster_url?: string;
  series_title?: string;
  attribution?: string;
  date_precision?: string;
  affordability_evidence?: string | null;
  metrics: Measurement[];
  observed_at: string;
}
export interface CreatorRecord {
  id: string;
  name: string;
  platform: string;
  profile_url: string;
  activity_count: number;
  latest_published_at: string;
  topics: string[];
  example: Activity | null;
}
export interface CreatorDetail extends CreatorRecord {
  activity: Activity[];
  measurements: { activity_id: string; observed_at: string; metrics: Measurement[] }[];
}
export interface Facet {
  value: string;
  count: number;
}
export interface Results<T> {
  related?: { query: string; topic: string; total: number; basis: string; items: T[] };
  items: T[];
  total: number;
  page: number;
  page_size: number;
  facets: { platforms: Facet[]; topics: Facet[] };
}
export interface MarketSummary {
  creator_count: number;
  activity_count: number;
  platforms: {
    platform: string;
    creator_count: number;
    activity_count: number;
    latest_published_at: string;
    measured_count: number;
    measurement_scope: string;
  }[];
  topics: Facet[];
  months: { month: string; activity_count: number }[];
  latest_observed_at: string | null;
  window_start: string;
  window_end: string;
}
export interface CampaignSummary {
  id: string;
  name: string;
  version: number;
  updated_at: string;
  status: 'planning' | 'active' | 'completed' | 'paused';
}

export function useBusinessResource<T>(path: string, revision = 0, enabled = true) {
  const fetch = useCallback((signal: AbortSignal) => apiGet<T>(path, signal), [path]);
  return useResource(fetch, revision, false, enabled);
}

export function BusinessProblem({ error, retry }: { error: ApiError; retry: () => void }) {
  const missing = error.status === 404;
  return (
    <div className="business-empty" role="alert">
      <strong>
        {missing
          ? 'This record is unavailable'
          : error.kind === 'timeout'
            ? 'The request timed out'
            : 'Couldn’t load this view'}
      </strong>
      <p>
        {missing
          ? 'It may have been withdrawn or belong to another workspace.'
          : 'Your saved work is available when the connection returns.'}
      </p>
      <button className="studio-secondary" onClick={retry}>
        Try again
      </button>
    </div>
  );
}

export function SourceLink({ url, children }: { url: string; children: ReactNode }) {
  let address: URL;
  try {
    address = new URL(url);
  } catch {
    return <span>{children}</span>;
  }
  if (!['http:', 'https:'].includes(address.protocol)) return <span>{children}</span>;
  return (
    <a className="market-source" href={address.href} target="_blank" rel="noopener noreferrer">
      {children} <span aria-hidden="true">↗</span>
    </a>
  );
}

export function Platform({ value }: { value: string }) {
  const color = [...value].reduce((sum, c) => sum + c.codePointAt(0)!, 0) % 6;
  return (
    <span className={'market-platform color-' + color}>
      <i aria-hidden="true" />
      {platformName(value)}
    </span>
  );
}

export function SaveMarketLead({ creator }: { creator: CreatorRecord }) {
  const { draft, setDraft } = useMarketing();
  const selected = draft.market_leads ?? [];
  const saved = selected.includes(creator.id);
  const full = selected.length >= 120 && !saved;
  return (
    <button
      type="button"
      className="studio-secondary"
      disabled={full}
      aria-pressed={saved}
      onClick={() =>
        setDraft((old) => {
          const leads = old.market_leads ?? [];
          const removing = leads.includes(creator.id);
          if (!removing && leads.length >= 120) return old;
          return {
            ...old,
            saved: true,
            brief: { ...old.brief, name: old.brief.name || 'Creator shortlist' },
            market_leads: removing ? leads.filter((id) => id !== creator.id) : [...leads, creator.id],
          };
        })
      }
    >
      {saved ? 'Saved to campaign' : full ? 'Shortlist full' : 'Save to campaign'}
    </button>
  );
}
