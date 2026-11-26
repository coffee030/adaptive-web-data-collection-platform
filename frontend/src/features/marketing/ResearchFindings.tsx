import { useState } from 'react';
import { Panel } from '../../components/studio/Workspace';
import {
  amount,
  date,
  platformOptions,
  type CampaignRequest,
  type Observed,
  type ScenarioRequest,
  type ScenarioResult,
} from './intelligence';

export interface BusinessBrief {
  campaign: CampaignRequest;
  product: string;
  audience: string;
  discovery_focus: string | null;
  test_share: number;
  alternative_platforms: CampaignRequest['platform'][];
  scenario?: ScenarioRequest | null;
  discovery_scope?: 'campaign_channels' | 'all_sources';
  max_evidence_age_days?: number | null;
}

interface Finding {
  id: string;
  name: string;
  title: string;
  excerpt?: string;
  url: string;
  profile_url: string;
  platform: string;
  published_at: string | null;
  observed_at: string;
  license_url: string;
  basis: string;
  tier: 'direct' | 'context';
  scope_notes: string[];
  credit_role?: string | null;
  credit_url?: string | null;
  attribution?: string | null;
  series_title?: string | null;
  metrics: { label: string; value: number }[];
  visual_evidence?: { source_text: string; interpretation: string };
}

interface Candidate {
  id: string;
  name: string;
  selected: boolean;
  eligible: boolean;
  limitations: string[];
  content: Observed<{ text: string; published_at: string }> | null;
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

export interface ResearchReport {
  run_id: string;
  analyzed_at: string;
  research: {
    focus: string;
    market_ranking: string;
    historical_ranking: string;
    historical_criteria: string;
    examples: Finding[];
    direct_count: number;
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
  search_limit: 'Selection limit reached',
};
const reasons: Record<string, string> = {
  insufficient_relevant_content: 'Relevant content is missing',
  confirmed_quote_unavailable: 'Current firm quote missing',
  quote_exceeds_budget: 'Firm quote exceeds the cap',
  required_market_share_unverified: 'Required audience share unverified',
  required_market_share_below_minimum: 'Audience share below minimum',
  required_language_unverified: 'Required language unverified',
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
    <Panel title="Source evidence" description={`Research focus · ${report.research.focus}`}>
      {!direct.length && (
        <p className="rc-inset">
          Channels checked ·{' '}
          {report.research.requested_channels.length
            ? report.research.requested_channels
                .map((key) => platformOptions[key as keyof typeof platformOptions] ?? key)
                .join(', ')
            : 'All eligible sources'}
          . Publication window ·{' '}
          {report.research.publication_window_days
            ? `Past ${report.research.publication_window_days} days`
            : 'Any date'}
          .
        </p>
      )}
      {other.length > 0 && (
        <button
          className="rc-context"
          aria-expanded={context}
          onClick={() => {
            setContext(!context);
            setMore(true);
          }}
        >
          {context ? 'Hide' : 'Show'} background sources ({other.length})
        </button>
      )}
      {visible.length > 0 && (
        <ol className="rc-evidence">
          {(more ? visible : visible.slice(0, 5)).map((item) => (
            <li key={item.platform + '/' + item.id}>
              <div className="rc-evidence-meta">
                {evidences[item.basis] ?? 'Published activity'} <span>·</span> {item.platform}{' '}
                {item.published_at && (
                  <>
                    {' '}
                    <span>·</span> {date(item.published_at)}
                  </>
                )}
              </div>
              {item.tier === 'context' && (
                <p className="rc-origin">Background only · {item.scope_notes.join(' · ')}</p>
              )}
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
                {item.attribution && <>{item.attribution} · </>}Observed {date(item.observed_at)} ·{' '}
                <a href={item.license_url} target="_blank" rel="noreferrer">
                  Source licence
                </a>
              </div>
            </li>
          ))}
        </ol>
      )}
      {visible.length > 5 && (
        <button className="studio-secondary rc-more" onClick={() => setMore(!more)}>
          {more ? 'Show fewer sources' : `Show all ${visible.length} sources`}
        </button>
      )}
      {platform_activity.length > 0 && (
        <div className="rc-inset">
          <h3>Activity in the reviewed results</h3>
          <div
            role="region"
            aria-label="Observed platform coverage"
            tabIndex={0}
            className="studio-table-scroll"
          >
            <table className="studio-table rc-coverage-table">
              <thead>
                <tr>
                  <th>Platform</th>
                  <th>Creators</th>
                  <th>Activities</th>
                  <th aria-label="Activities with measurements">Measured</th>
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

type UseOption = (platform: CampaignRequest['platform'], budget: number) => void;

function Options({ report, onUse }: { report: ResearchReport; onUse: UseOption }) {
  const [index, setIndex] = useState(0);
  const option = report.strategies[index];
  if (!option) return null;
  return (
    <Panel
      title="Strategy comparison"
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
                <td>{statuses[s.status] ?? s.status}</td>
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
          {option.reviewed
            ? `${option.reviewed} creator profiles reviewed for this channel. ${option.selected.length} in the verified allocation.`
            : 'No company-authorized creator profile matches this strategy on the selected channel.'}
        </p>
        {option.allocated_minor != null && (
          <p>
            {amount(option.budget_minor - option.allocated_minor, option.currency)} remains under
            this option’s cap.
          </p>
        )}
        {Object.entries(option.exclusions).length > 0 && (
          <ul>
            {Object.entries(option.exclusions).map(([reason, n]) => (
              <li key={reason}>
                {explain(reason)} · {n}
              </li>
            ))}
          </ul>
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
                  {c.content.evidence.attribution} · {c.content.evidence.reference} ·{' '}
                  {date(c.content.data.published_at)}
                </footer>
              </blockquote>
            )}
            <p>
              {c.quote
                ? `Firm quote ${amount(c.quote.data.amount_minor, option.currency)} · valid through ${date(c.quote.data.valid_until)} · ${c.quote.data.terms} · ${c.quote.evidence.reference}`
                : 'No eligible firm quote.'}
            </p>
            <p>
              {c.audience?.data.share != null
                ? `${c.audience.data.market} audience share ${(100 * Number(c.audience.data.share)).toFixed(1)}% · ${c.audience.evidence.reference}`
                : 'Audience breakdown unavailable.'}
            </p>
            {c.historical.median_views.value != null && (
              <p>
                Median seven-day views {Number(c.historical.median_views.value).toLocaleString()} ·{' '}
                {c.historical.median_views.observations} measured posts.
              </p>
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
}: {
  report: ResearchReport;
  onUse: UseOption;
  onAdjust: () => void;
  brief: BusinessBrief;
}) {
  const [view, setView] = useState<'sources' | 'strategy'>('sources');
  const [messageStatus, setMessageStatus] = useState('');
  const first = report.strategies[0];
  const quoted = first?.status === 'optimal';
  const privateMatch = first?.candidates.some((candidate) => candidate.content);
  const infeasible = first?.status === 'infeasible' && privateMatch;
  const lead = report.research.examples.find((item) => item.tier === 'direct');
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
        <h2>
          {quoted
            ? 'Review the quoted allocation'
            : infeasible
              ? 'No verified combination fits'
              : privateMatch
                ? 'Review the company evidence'
                : report.research.direct_count
                  ? 'Review matched publications'
                  : 'No direct evidence for this brief'}
        </h2>
        <p>
          {quoted && first
            ? `${first.selected.length} selected at ${amount(first.allocated_minor ?? 0, first.currency)} for your full-budget option.`
            : infeasible
              ? 'Current firm quotes and the required creator count do not fit this cap. Compare another channel, change the cap or adjust the count.'
              : privateMatch
                ? 'Relevant company content is available. Compare the options to inspect missing eligibility evidence.'
                : report.research.direct_count
                  ? `${report.research.direct_count} ${report.research.direct_count === 1 ? 'publication matches' : 'publications match'} your discovery criteria. ${first ? statuses[first.status] : 'A firm quote is needed'} for the campaign allocation.`
                  : `No eligible publication supports a direct creator recommendation. ${report.research.examples.length ? 'Background sources are available separately.' : 'Try another channel or a broader discovery focus.'}`}
        </p>
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
        {!quoted && !lead && (
          <button className="studio-secondary rc-next" onClick={onAdjust}>
            Adjust discovery criteria
          </button>
        )}
        {!quoted && lead && (
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
      <div className="rc-switch" aria-label="Report section">
        <button aria-pressed={view === 'sources'} onClick={() => setView('sources')}>
          Source evidence <span>{report.research.examples.length}</span>
        </button>
        <button aria-pressed={view === 'strategy'} onClick={() => setView('strategy')}>
          Compare strategies <span>{report.strategies.length}</span>
        </button>
      </div>
      {view === 'sources' ? (
        <EvidenceList report={report} />
      ) : (
        <Options report={report} onUse={onUse} />
      )}
      <p className="rc-footnote">
        {report.outcome_basis} Last analyzed {date(report.analyzed_at)}.
      </p>
    </div>
  );
}
