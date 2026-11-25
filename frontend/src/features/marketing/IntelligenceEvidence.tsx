import { useEffect, type ReactNode } from 'react';
import { Loading, RequestProblem } from '../../components/feedback';
import { ApiError } from '../../lib/api';
import { amount, date, deliverableOptions, languageOptions, platformOptions, visibleFor, isFresh,
  type ContentEvidence, type DataMode, type EvidenceRef, type History, type Measure, type Observed, type Quote, type Survey } from './intelligence';

export function IntelligenceError({ error, retry }: { error: ApiError; retry: () => void }) {
  if (error.status === 403 || error.status === 404 || error.code === 'catalog_changed' || error.status === 422) {
    const message = error.status === 403 ? 'Workspace access is restricted. For partner data, open this workspace through its trusted application host.'
      : error.status === 404 ? 'This creator is unavailable in the current workspace.'
      : error.status === 422 ? 'Review the campaign criteria or search filters before retrying.'
      : 'The eligible catalog changed while this request was running. Retry against the current catalog.';
    return <div className="hl-decision hl-warning"><p role="alert">{message}</p><button type="button" onClick={retry}>Retry</button></div>;
  }
  return <RequestProblem error={error} resource="campaign intelligence" retry={retry} />;
}

export function RefreshOnFocus({ refresh }: { refresh: () => void }) {
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);
  return null;
}

export function Pending({ children }: { children: ReactNode }) {
  return <Loading>{children}</Loading>;
}

export function SourceRef({ evidence }: { evidence: EvidenceRef }) {
  return <span className="hl-note">{evidence.attribution} · Evidence {evidence.reference} · Observed {date(evidence.observed_at)} · Expires {date(evidence.expires_at)}</span>;
}

export function measureText(measure: Measure | null | undefined, percent = false) {
  if (measure?.value == null || !Number.isFinite(Number(measure.value))) return 'Unavailable';
  return new Intl.NumberFormat('en-HK', { maximumFractionDigits: 2, style: percent ? 'percent' : 'decimal' }).format(Number(measure.value));
}

export function HistoricMetrics({ history }: { history: History }) {
  return <div className="hl-history"><strong>Historical {history.window_days}-day observation window</strong>
    <p>Median views {measureText(history.median_views)} · Interaction rate {measureText(history.interaction_rate, true)}</p>
    <p className="hl-note">{history.median_views.observations ?? 0} view observations · {history.interaction_rate.observations ?? 0} comparable interaction observations</p></div>;
}

export function SourcePost({ post, mode }: { post: ContentEvidence; mode: DataMode }) {
  if (!visibleFor(mode, post.content.evidence)) return <p>Supporting content expired or is unavailable.</p>;
  const { data, evidence } = post.content;
  const originalLanguage = data.languages.length === 1 ? data.languages[0] : undefined;
  const performance = post.performance && visibleFor(mode, post.performance.evidence) ? post.performance : null;
  return <article className="hl-source-post">
    <div className="hl-note">{platformOptions[data.platform]} · {date(data.published_at)}{data.languages.length > 0 && ' · ' + data.languages.map(code => languageOptions[code]).join(', ')}</div>
    <blockquote lang={originalLanguage === 'mix' ? undefined : originalLanguage}>{data.text}</blockquote>
    {data.reviewed_facts.length > 0 && <p>Reviewed facts · {data.reviewed_facts.join(', ')}</p>}
    <SourceRef evidence={evidence} />
    {performance && <div className="hl-history"><p>Observed views {performance.data.views ?? 'Unavailable'} · Likes {performance.data.likes ?? 'Unavailable'} · Comments {performance.data.comments ?? 'Unavailable'}</p>
      <SourceRef evidence={performance.evidence} /></div>}
  </article>;
}

export function QuoteEvidence({ quote, mode }: { quote: Observed<Quote> | null; mode: DataMode }) {
  if (!quote || quote.data.amount_minor === null || !visibleFor(mode, quote.evidence) || !isFresh(quote.data.valid_until)) return <p>Current firm quote unavailable.</p>;
  const { data, evidence } = quote;
  return <div><p>{amount(data.amount_minor!, data.currency)} · {platformOptions[data.platform]} · {deliverableOptions[data.deliverable]} · Valid until {date(data.valid_until)}</p>
    <p>{data.terms}</p><SourceRef evidence={evidence} /></div>;
}

export function SurveyEvidence({ survey, mode }: { survey: Observed<Survey> | null; mode: DataMode }) {
  if (!survey || !visibleFor(mode, survey.evidence)) return <p>Audience evidence unavailable.</p>;
  const { data, evidence } = survey;
  return <div><p>{data.data_status === 'suppressed' || data.share === null ? 'Audience share suppressed'
    : new Intl.NumberFormat('en-HK', { style: 'percent', maximumFractionDigits: 1 }).format(Number(data.share))}
    {' · '}{data.market} · {data.denominator === null ? 'Sample size unavailable' : data.denominator + ' opt-in respondents'}</p>
    <p className="hl-note">Survey period {date(data.period_start)} to {date(data.period_end)}</p><SourceRef evidence={evidence} /></div>;
}
