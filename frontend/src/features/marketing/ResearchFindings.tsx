import { useState } from 'react';
import { Panel } from '../../components/studio/Workspace';
import {
  amount,
  date,
  platformOptions,
  type CampaignRequest,
  type ContentEvidence,
  type EvidenceRef,
  type Observed,
  type ScenarioResult,
} from './intelligence';
import { CriteriaSummary } from './ResearchCriteriaReview';
import { ResearchSourceAvailability } from './ResearchSourceAvailability';
import type { BusinessBrief, ResearchCriteriaMetadata, ResearchRun } from './researchClient';

interface Finding {
  id: string;
  name: string;
  title: string;
  excerpt?: string;
  url: string;
  profile_url: string;
  platform: string;
  published_at: string | null;
  observed_at: string | null;
  license_url: string;
  basis: string;
  tier: 'direct' | 'context';
  scope_notes: string[];
  credit_role?: string | null;
  credit_url?: string | null;
  attribution?: string | null;
  series_title?: string | null;
  metrics: { label: string; value: number }[];
  expires_at?: string | null;
  visual_evidence?: { source_text: string; interpretation: string };
}

interface Candidate {
  id: string;
  name: string;
  selected: boolean;
  eligible: boolean;
  limitations: string[];
  content: Observed<{ text: string; published_at: string }> | null;
  performance?: ContentEvidence['performance'];
  other_window?: ContentEvidence['performance'];
  quote: Observed<{ amount_minor: number; valid_until: string; terms: string }> | null;
  audience: Observed<{ market: string; share: string | null }> | null;
  historical: { median_views: { value: string | null; observations: number | null } };
  factors: Record<string, number | null>;
}

interface Strategy {
  name: string;
  platform: CampaignRequest['platform'];
  budget_minor: number;
  currency: string;
  status: string;
  selected: string[];
  allocated_minor: number | null;
  reviewed: number;
  exclusions: Record<string, number>;
  candidates: Candidate[];
  topics: string[];
  topic_basis: string;
}

function EvidenceCitation({ evidence }: { evidence: EvidenceRef }) {
  return (
    <span className="rc-origin">
      {evidence.attribution} {evidence.source_url
        ? <a href={evidence.source_url} target="_blank" rel="noreferrer">{evidence.reference}</a>
        : evidence.reference}
      {' · '}{evidence.observed_at ? 'Observed ' + date(evidence.observed_at) : 'Observation date unknown'}
      {evidence.expires_at && ' · Evidence expires ' + date(evidence.expires_at)}
    </span>
  );
}

function ReportedMeasurement({
  measurement,
  comparable,
}: {
  measurement: NonNullable<ContentEvidence['performance']>;
  comparable: boolean;
}) {
  const { data, evidence } = measurement;
  const counts = (['views', 'likes', 'comments'] as const).flatMap((unit) =>
    data[unit] != null ? [data[unit].toLocaleString() + ' ' + unit] : [],
  );
  return (
    <div className="rc-measurement">
      <strong>{comparable ? 'Seven-day post measurement' : 'Latest other reported window'}</strong>
      <p>
        {counts.length ? counts.join(' · ') : 'Counts unavailable'} · Window ended{' '}
        <time dateTime={data.window_end}>{data.window_end}</time>.
      </p>
      {!comparable && (
        <p>This measurement uses a different cutoff and is excluded from seven-day comparisons.</p>
      )}
      <p><EvidenceCitation evidence={evidence} /></p>
    </div>
  );
}

export interface ResearchReport extends ResearchCriteriaMetadata {
  run_id: string;
  analyzed_at: string;
  research: {
    focus: string;
    market_ranking: string;
    historical_ranking: string;
    historical_criteria: string;
    examples: Finding[];
    direct_count: number;
    market_candidates_reviewed?: number;
    publication_window_days: number | null;
    requested_channels: string[];
    platform_activity: {
      platform: string;
      activities: number;
      creators: number;
      with_metrics: number;
    }[];
  };
  strategies: Strategy[];
  next_steps: string[];
  outcome_basis: string;
  scenario?: ScenarioResult | null;
  product: string;
  audience: string;
}
const evidences: Record<string, string> = {
  market_activity: 'Published activity',
  related_market_activity: 'Related topic',
  identity_lead: 'Directory identity',
  historical_cost: 'Dated price evidence',
  historical_topic: 'Historical work',
  creator: 'Credited work',
  browse: 'Historical work',
};
const statuses: Record<string, string> = {
  optimal: 'Quoted allocation available',
  needs_evidence: 'Evidence needed',
  infeasible: 'No verified combination fits',
  search_limit: 'Search limit reached',
};
const reasons: Record<string, string> = {
  insufficient_relevant_content: 'Relevant content is missing',
  confirmed_quote_unavailable: 'Current firm quote missing',
  quote_exceeds_budget: 'Firm quote exceeds the cap',
  required_market_share_unverified: 'Required audience share unverified',
  required_market_share_below_minimum: 'Audience share below minimum',
  required_language_unverified: 'Required language unverified',
  comparable_performance_unavailable: 'Comparable performance unavailable',
};
function explain(value: string) {
  return (
    reasons[value] ??
    value.replace('required_fact_unverified:', 'Evidence needed for ').replaceAll('_', ' ')
  );
}

function EvidenceList({ report }: { report: ResearchReport }) {
  const [more, setMore] = useState(false);
  const [context, setContext] = useState(false);
  const { examples, platform_activity } = report.research;
  const direct = examples.filter((e) => e.tier === 'direct'),
    other = examples.filter((e) => e.tier === 'context');
  const visible = context ? [...direct, ...other] : direct;
  return (
    <Panel title="Returned public evidence" description={report.research.focus}>
      <div className="rc-inset">
        <p>Public counts use the source’s measurements and observation window.</p>
      </div>
      {other.length > 0 && (
        <button
          className="rc-context"
          aria-expanded={context}
          onClick={() => {
            setContext(!context);
            setMore(true);
          }}
        >
          {context ? 'Hide' : 'Show'} background examples ({other.length})
        </button>
      )}
      {visible.length > 0 && (
        <ol className="rc-evidence">
          {(more ? visible : visible.slice(0, 5)).map((item) => (
            <li key={item.platform + '/' + item.id}>
              <div className="rc-evidence-meta">
                {evidences[item.basis] ?? 'Published activity'} <span>·</span> {item.platform}{' '}
                <span>·</span> {item.published_at ? 'Published ' + date(item.published_at) : 'Publication date unknown'}
              </div>
              <p className="rc-origin">
                {item.tier === 'context' ? 'Background evidence' : 'Direct example'}
                {item.scope_notes.length > 0 && ' · ' + item.scope_notes.join(' · ')}
              </p>
              <a className="rc-work-title" href={item.url} target="_blank" rel="noreferrer">
                {item.title} <span aria-hidden="true">↗</span>
              </a>
              <div className="rc-byline">
                {item.credit_role ||
                  (item.basis === 'identity_lead'
                    ? 'Directory entry for'
                    : item.basis.includes('market_activity')
                      ? 'Published by'
                      : 'Credited to')}{' '}
                <a href={item.profile_url} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
                {item.credit_url && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={item.credit_url} target="_blank" rel="noreferrer">
                      View credit
                    </a>
                  </>
                )}
              </div>
              {item.excerpt && <p>{item.excerpt}</p>}
              {item.visual_evidence && (
                <p>
                  <strong>In the source</strong> {item.visual_evidence.source_text} ·{' '}
                  {item.visual_evidence.interpretation}
                </p>
              )}
              {item.metrics.length > 0 && (
                <div className="rc-observation">
                  {item.metrics
                    .map((m) => `${m.value.toLocaleString('en-HK')} ${m.label}`)
                    .join(' · ')}
                </div>
              )}
              <div className="rc-origin">
                {item.attribution && <>{item.attribution} · </>}{item.observed_at ? 'Observed ' + date(item.observed_at) : 'Observation date unknown'} ·{' '}
                <a href={item.license_url} target="_blank" rel="noreferrer">
                  Source licence
                </a>
                {item.expires_at && ' · Evidence expires ' + date(item.expires_at)}
              </div>
            </li>
          ))}
        </ol>
      )}
      {visible.length > 5 && (
        <button className="studio-secondary rc-more" onClick={() => setMore(!more)}>
          {more ? 'Show fewer examples' : `Show all ${visible.length} examples`}
        </button>
      )}
      {platform_activity.length > 0 && (
        <div className="rc-inset">
          <h3>Activity retained for market ranking</h3>
          <p>Includes background records and counts before the example display limit.</p>
          <div
            role="region"
            aria-label="Retained market activity by platform"
            tabIndex={0}
            className="studio-table-scroll"
          >
            <table className="studio-table rc-coverage-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Creators in retained activity</th>
                  <th>Retained activities</th>
                  <th>Activities with public metrics</th>
                </tr>
              </thead>
              <tbody>
                {platform_activity.map((p) => (
                  <tr key={p.platform}>
                    <th>{p.platform}</th>
                    <td>{p.creators}</td>
                    <td>{p.activities}</td>
                    <td>{p.with_metrics}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {report.research.market_candidates_reviewed != null && (
        <p className="rc-inset">{report.research.market_candidates_reviewed} market records retained for ranking. Retrieval was bounded.</p>
      )}
      {(report.research.historical_criteria || examples.length > 0) && (
        <details className="rc-method">
          <summary>How sources were matched</summary>
          <p>
            {report.research.historical_criteria} Source-linked market records use{' '}
            {report.research.market_ranking === 'granite_int8'
              ? 'multilingual Granite similarity'
              : report.research.market_ranking === 'character_tfidf'
                ? 'text similarity'
                : 'the publication search'}{' '}
            to order matches. Related topics are labeled separately. A public work establishes
            authorship and content context. Audience and sponsorship terms require separate
            evidence.
          </p>
        </details>
      )}
    </Panel>
  );
}

const hasAllocation = (strategy: Strategy) =>
  (strategy.status === 'optimal' || strategy.status === 'search_limit') &&
  strategy.allocated_minor != null && strategy.selected.length > 0;

type UseOption = (platform: CampaignRequest['platform'], budget: number) => void;

function Options({ report, initialIndex, onUse }: { report: ResearchReport; initialIndex: number; onUse: UseOption }) {
  const [index, setIndex] = useState(initialIndex);
  const option = report.strategies[index];
  if (!option) return null;
  return (
    <Panel
      title="Company-authorized strategy evidence"
      description="Each option uses the same requirements and currency. Only a current firm quote can fund a place."
    >
      <div
        className="studio-table-scroll"
        role="region"
        aria-label="Campaign strategies"
        tabIndex={0}
      >
        <table className="studio-table rc-strategy-table">
          <thead>
            <tr>
              <th>Option</th>
              <th>Budget cap</th>
              <th>Quoted spend</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {report.strategies.map((s, i) => (
              <tr key={s.name + s.platform}>
                <th>
                  <button aria-pressed={i === index} onClick={() => setIndex(i)}>
                    {s.name}
                    <small>{platformOptions[s.platform]}</small>
                  </button>
                </th>
                <td>{amount(s.budget_minor, s.currency)}</td>
                <td>
                  {s.allocated_minor == null
                    ? 'Unavailable'
                    : amount(s.allocated_minor, s.currency)}
                </td>
                <td>{s.status === 'optimal' && !hasAllocation(s) ? 'Allocation details unavailable' : statuses[s.status] ?? 'Decision unavailable'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rc-inset">
        <h3>
          {option.name} · {platformOptions[option.platform]}
        </h3>
        <p>
          {option.reviewed} company-authorized creator profiles reviewed for this strategy.
          {hasAllocation(option) && ' ' + option.selected.length + ' creators in the returned quoted allocation.'}
        </p>
        {option.status === 'search_limit' && (
          <p>{hasAllocation(option) ? 'A quoted allocation was returned within the search limit. A better fit may exist.'
            : 'The search reached its limit before returning a usable allocation. Feasibility remains undetermined.'}</p>
        )}
        {option.status === 'infeasible' && <p>The verified constraints and current quotes do not fit this strategy.</p>}
        {option.status === 'needs_evidence' && <p>Inspect the evidence gaps for this strategy before funding it.</p>}
        {hasAllocation(option) && option.allocated_minor != null && (
          <p>
            {amount(option.budget_minor - option.allocated_minor, option.currency)} remains under
            this option’s cap.
          </p>
        )}
        {Object.entries(option.exclusions).length > 0 && (
          <>
            <p>A profile can appear under several exclusion reasons.</p>
            <ul>
              {Object.entries(option.exclusions).map(([reason, n]) => (
                <li key={reason}>
                  {explain(reason)} · {n}
                </li>
              ))}
            </ul>
          </>
        )}
        {option.candidates.map((c) => (
          <details className="rc-candidate" key={c.id}>
            <summary>
              {c.name}
              <span>{c.selected ? 'Selected' : c.eligible ? 'Eligible' : 'Needs evidence'}</span>
            </summary>
            {c.content && (
              <blockquote>
                {c.content.data.text}
                <footer>
                  {c.content.data.published_at ? 'Published ' + date(c.content.data.published_at) : 'Publication date unknown'} ·{' '}
                  <EvidenceCitation evidence={c.content.evidence} />
                </footer>
              </blockquote>
            )}
            <p>
              {c.quote
                ? `Firm quote ${amount(c.quote.data.amount_minor, option.currency)} · valid through ${date(c.quote.data.valid_until)} · ${c.quote.data.terms}`
                : 'No eligible firm quote.'}
              {c.quote && <> · <EvidenceCitation evidence={c.quote.evidence} /></>}
            </p>
            <p>
              {c.audience?.data.share != null
                ? `${c.audience.data.market} audience share ${(100 * Number(c.audience.data.share)).toFixed(1)}%`
                : 'Audience breakdown unavailable.'}
              {c.audience && <> · <EvidenceCitation evidence={c.audience.evidence} /></>}
            </p>
            {c.historical.median_views.value != null && (
              <p>
                Median seven-day views {Number(c.historical.median_views.value).toLocaleString()} ·{' '}
                  {c.historical.median_views.observations} measured{' '}
                  {c.historical.median_views.observations === 1 ? 'post' : 'posts'}.
              </p>
            )}
            {c.performance && <ReportedMeasurement measurement={c.performance} comparable />}
            {c.other_window && (
              <ReportedMeasurement measurement={c.other_window} comparable={false} />
            )}
            {c.limitations.length > 0 && <p>{c.limitations.map(explain).join(' · ')}</p>}
          </details>
        ))}
        {option.topics.length > 0 && (
          <p>
            {option.topic_basis === 'supplied' ? 'Topics in your brief' : 'Suggested topics'} ·{' '}
            {option.topics.join(', ')}
          </p>
        )}
        <button
          className="studio-secondary"
          onClick={() => onUse(option.platform, option.budget_minor)}
        >
          Use these constraints in the campaign plan
        </button>
      </div>
      {report.scenario && (
        <div className="rc-inset">
          <h3>Company scenario assumptions</h3>
          <p>
            Assumed impressions{' '}
            {report.scenario.assumptions.impressions?.toLocaleString() ?? 'unavailable'} · Assumed
            click rate{' '}
            {report.scenario.assumptions.click_rate != null
              ? (Number(report.scenario.assumptions.click_rate) * 100).toLocaleString() + '%'
              : 'unavailable'}{' '}
            · Assumed conversion rate{' '}
            {report.scenario.assumptions.conversion_rate != null
              ? (Number(report.scenario.assumptions.conversion_rate) * 100).toLocaleString() + '%'
              : 'unavailable'}
            .
          </p>
          <p>
            Calculated clicks{' '}
            {report.scenario.clicks.value == null
              ? 'unavailable'
              : Number(report.scenario.clicks.value).toLocaleString()}{' '}
            · Calculated conversions{' '}
            {report.scenario.conversions.value == null
              ? 'unavailable'
              : Number(report.scenario.conversions.value).toLocaleString()}
            .
          </p>
          <p>These values depend on the rates and volume entered in the brief.</p>
        </div>
      )}
    </Panel>
  );
}

export function ResearchFindings({
  report,
  onUse,
  onAdjust,
  brief,
  run,
  onRefreshEvidence,
  refreshing,
}: {
  report: ResearchReport;
  onUse: UseOption;
  onAdjust: () => void;
  brief: BusinessBrief;
  run: ResearchRun;
  onRefreshEvidence: () => void;
  refreshing: boolean;
}) {
  const [view, setView] = useState<'sources' | 'strategy'>('sources');
  const [messageStatus, setMessageStatus] = useState('');
  const [optionIndex, setOptionIndex] = useState(0);
  const allocationIndex = report.strategies.findIndex(hasAllocation);
  const allocation = report.strategies[allocationIndex];
  const hasCompanyEvidence = report.strategies.some((strategy) => strategy.reviewed > 0);
  const lead = report.research.examples.find((item) => item.tier === 'direct');
  const resolution = run.confirmed_criteria?.proposal.finalized;
  const channels = report.research.requested_channels
    .map((key) => platformOptions[key as keyof typeof platformOptions] ?? key).join(', ');
  function viewStrategy(index = 0) {
    setOptionIndex(index);
    setView('strategy');
  }
  const quoteRequest = lead
    ? [
        `We're researching a campaign for ${brief.product}, aimed at ${brief.audience}.`,
        `We found “${lead.title}” on ${lead.platform} (${lead.url}). Could you confirm your role and whether you offer a ${brief.campaign.deliverable.replaceAll('_', ' ')} on ${platformOptions[brief.campaign.platform]}?`,
        `If so, please provide a firm ${brief.campaign.currency} fee, included usage rights and quote expiry. Please identify any extra production or licensing costs.`,
        'If you are authorized to share audience and performance information, please include the market, observation period, comparable posts, measurement definitions and permission to use them for this campaign review.',
      ].join('\n\n')
    : '';
  return (
    <div className="rc-report">
      <section className="rc-decision">
        <h2>Research findings</h2>
        <p>{report.research.direct_count} direct {report.research.direct_count === 1 ? 'example' : 'examples'} in the returned report.
          {' '}{hasCompanyEvidence ? 'Company-authorized creator profiles were reviewed for one or more strategies.'
            : 'The strategies record no company-authorized profiles reviewed.'}
          {' '}{allocation ? allocation.name + ' returned a quoted allocation.' : 'No usable quoted allocation was returned.'}
        </p>
        <div className="rc-actions">
          {allocation && <button className="studio-primary" onClick={() => viewStrategy(allocationIndex)}>Review quoted allocation</button>}
          {report.strategies.length > 0 && !allocation && (
            <button className="studio-secondary" onClick={() => viewStrategy()}>Compare strategies and evidence gaps</button>
          )}
          {!lead && <button className="studio-secondary" onClick={onAdjust}>Adjust discovery criteria</button>}
        </div>
        {report.next_steps.length > 0 && (
          <details className="rc-request">
            <summary>Evidence still needed</summary>
            <ul>
              {report.next_steps.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
          </details>
        )}
        {!allocation && lead && (
          <details className="rc-request">
            <summary>Prepare a quote and evidence request</summary>
            <label>
              Draft for your review
              <textarea readOnly value={quoteRequest} rows={7} />
            </label>
            <button
              className="studio-secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(quoteRequest);
                  setMessageStatus('Request copied.');
                } catch {
                  setMessageStatus('Select the draft text to copy it.');
                }
              }}
            >
              Copy request
            </button>
            <span role="status">{messageStatus}</span>
          </details>
        )}
      </section>
      <Panel title="Research scope">
        <div className="rc-inset">
          <p>Requested channels · {channels || 'None recorded'}</p>
          <p>Discovery scope · {brief.discovery_scope === 'all_sources' ? 'Any eligible publishing source' :
            brief.discovery_scope === 'campaign_channels' ? 'Requested campaign channels' : 'Unknown'}</p>
          {resolution ? <details className="rc-method">
            <summary>Approved research criteria</summary>
            <CriteriaSummary resolution={resolution} />
          </details> : <p>Publication age · {report.research.publication_window_days != null
            ? 'Past ' + report.research.publication_window_days + ' days' : 'No publication window recorded'}</p>}
        </div>
      </Panel>
      <ResearchSourceAvailability sources={run.sources} onRefresh={onRefreshEvidence} refreshing={refreshing} />
      <div className="rc-switch" aria-label="Report section">
        <button aria-pressed={view === 'sources'} onClick={() => setView('sources')}>
          Public examples <span>{report.research.examples.length}</span>
        </button>
        <button aria-pressed={view === 'strategy'} onClick={() => viewStrategy()}>
          Compare strategies <span>{report.strategies.length}</span>
        </button>
      </div>
      {view === 'sources' ? (
        <EvidenceList report={report} />
      ) : (
        <Options key={optionIndex} report={report} initialIndex={optionIndex} onUse={onUse} />
      )}
      <p className="rc-footnote">
        {report.outcome_basis} Last analyzed {date(report.analyzed_at)}.
      </p>
    </div>
  );
}
