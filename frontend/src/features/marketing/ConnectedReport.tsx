import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useResource } from '../../lib/useResource';
import { Overlay } from './components';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, SourcePost, SourceRef, SurveyEvidence } from './IntelligenceEvidence';
import { amount, campaignInput, date, runCampaign, visibleFor, isFresh, type CampaignRequest, type CampaignResult, type DataMode, type Recommendation } from './intelligence';
import { useMarketing } from './workspace';

export function reportCurrent(report: CampaignResult) {
  return report.recommendations.every(candidate => visibleFor(report.mode, candidate.profile_evidence)
    && candidate.evidence.every(post => visibleFor(report.mode, post.content.evidence)
      && (!post.performance || visibleFor(report.mode, post.performance.evidence)))
    && Object.values(candidate.requirement_evidence).every(evidence => visibleFor(report.mode, evidence))
    && (!candidate.market_evidence || visibleFor(report.mode, candidate.market_evidence.evidence))
    && (!candidate.quote || (visibleFor(report.mode, candidate.quote.evidence) && isFresh(candidate.quote.data.valid_until))));
}

const readable = (value: string) => {
  if (value.startsWith('required_fact_unverified:')) {
    return 'Required fact unverified (' + value.slice('required_fact_unverified:'.length).replaceAll('_', ' ') + ')';
  }
  return ({
    confirmed_quote_unavailable: 'Current firm quote unavailable',
    target_market_evidence_unavailable: 'Audience evidence unavailable',
    insufficient_relevant_content: 'Insufficient supporting content',
    quote_exceeds_budget: 'Quote exceeds budget',
    required_language_unverified: 'Required language unverified',
    required_market_share_unverified: 'Required audience share unverified',
    required_market_share_below_minimum: 'Audience share below minimum',
  }[value] ?? value.replaceAll('_', ' '));
};

export function ConnectedReport({ mode }: { mode: DataMode }) {
  const { draft, path, report, setReport, toggleShortlist } = useMarketing();
  const [input, setInput] = useState<CampaignRequest>();
  const [invalid, setInvalid] = useState('');
  const [selected, setSelected] = useState<Recommendation>();
  const load = useCallback((signal: AbortSignal) => runCampaign(mode, input!, signal), [mode, input]);
  const { result, retry } = useResource(load, 0, false, Boolean(input));
  const running = Boolean(input) && result.state === 'loading';

  useEffect(() => {
    if (result.state === 'ready') setReport(result.data);
  }, [result, setReport]);

  function submit(shortlist = false) {
    setInvalid('');
    try {
      if (shortlist && draft.shortlist.length > 40) throw Error('Choose up to 40 shortlisted creators for one campaign evaluation.');
      const payload = campaignInput(draft.brief);
      if (shortlist) payload.shortlist = draft.shortlist;
      setSelected(undefined);
      setReport(undefined);
      setInput(payload);
    } catch (error) { setInvalid((error as Error).message); }
  }

  const current = report?.mode === mode && reportCurrent(report) ? report : undefined;
  const candidates = current?.recommendations ?? [];
  const eligible = candidates.filter(candidate => candidate.eligible);
  const excluded = candidates.filter(candidate => !candidate.eligible);

  function candidateRow(candidate: Recommendation) {
    return <div key={candidate.creator_id}><span><strong>{candidate.name}</strong><br />
      <span className="hl-note">{candidate.eligible
        ? ['Meets checked requirements', ...candidate.limitations.map(readable)].join(' · ')
        : candidate.limitations.map(readable).join(' · ') || 'Needs eligibility review'}
        {current?.plan.selected.includes(candidate.creator_id) && ' · Selected in plan'}</span></span>
      <span className="hl-actions"><button type="button" onClick={() => setSelected(candidate)}>Evidence for {candidate.name}</button>
        <button type="button" aria-pressed={draft.shortlist.includes(candidate.creator_id)} aria-label={'Shortlist ' + candidate.name}
          onClick={() => toggleShortlist(candidate.creator_id)}>Shortlist</button></span></div>;
  }

  return <div className="hl-connected-report">
    <div className="hl-row-between">
      <div><h2>{current?.plan.status === 'optimal' ? 'Recommended creator combination'
        : current?.plan.status === 'infeasible' ? 'No feasible combination under the current requirements'
        : current?.plan.status === 'search_limit' ? 'The selection search reached its limit' : 'Evaluate the campaign brief'}</h2>
      {current && <p className="hl-note">As of {date(current.as_of)} · {current.retrieval === 'granite_int8' ? 'Granite multilingual retrieval' : 'Text retrieval'}
        {current.indexing === 'preparing' ? ' · Semantic indexing in progress' : current.indexing === 'fallback' ? ' · Lexical fallback' : ''}</p>}</div>
      <div className="hl-actions"><button type="button" className="hl-primary" disabled={running} onClick={() => submit()}>{current ? 'Refresh recommendations' : 'Run Campaign Advisor'}</button>
        {draft.shortlist.length > 0 && <button type="button" disabled={running} onClick={() => submit(true)}>Evaluate shortlist</button>}
        {current && <Link className="hl-button" to={path('plan')}>Inspect plan</Link>}</div>
    </div>
    {(draft.brief.required || draft.brief.preferred) && <p className="hl-note">Review free-form notes manually. Reviewed fact identifiers are the structured requirements and preferences sent to the engine.</p>}
    {invalid && <p role="alert" className="hl-decision hl-warning">{invalid}</p>}
    {running && <Pending>Reviewing eligible campaign evidence…</Pending>}
    {input && result.state === 'error' && <IntelligenceError error={result.error} retry={retry} />}
    {report && !current && <p role="status" className="hl-decision hl-warning">The recommendation contains expired or unavailable evidence. Refresh before planning.</p>}
    {current && <>
      {current.categories.labels.length > 0 && <p className="hl-category"><strong>{current.categories.source === 'suggested' ? 'Suggested categories' : 'Your category labels'}</strong> · {current.categories.labels.join(', ')}</p>}
      {current.unavailable_shortlist_ids.length > 0 && <p className="hl-note">{current.unavailable_shortlist_ids.length} shortlisted creators are unavailable.</p>}
      {current.plan.total_minor !== null && <div className="hl-decision"><strong>{amount(current.plan.total_minor)}</strong> · {current.plan.selected.length} {current.plan.selected.length === 1 ? 'quoted allocation' : 'quoted allocations'}
        <p>{candidates.filter(candidate => current.plan.selected.includes(candidate.creator_id)).map(candidate => candidate.name).join(' + ')}</p></div>}
      {candidates.length === 0 ? <p>No eligible catalog records were returned for this brief.</p> : <>
        <section className="hl-candidate-strip" aria-label="Eligible candidates"><h3>Eligible candidates</h3>
          {eligible.length ? eligible.map(candidateRow) : <p>No candidates meet the checked requirements and budget.</p>}
        </section>
        {excluded.length > 0 && <details className="hl-candidate-editor">
          <summary>Excluded candidates · {excluded.length}</summary>
          <div className="hl-candidate-strip">{excluded.map(candidateRow)}</div>
        </details>}
      </>}
    </>}
    {selected && current && <Overlay title={'Evidence for ' + selected.name} close={() => setSelected(undefined)}>
      <p>Ranking factors describe relative content and campaign fit.</p>
      <SourceRef evidence={selected.profile_evidence} />
      <dl className="hl-facts">{Object.entries(selected.factor_weights).map(([name, weight]) =>
        <div key={name}><dt>{readable(name)}</dt><dd>{selected.factors[name] == null ? 'Unavailable' : 'Used in ranking'} · Weight {weight}</dd></div>)}</dl>
      {selected.evidence.length > 0 ? selected.evidence.map(post => <SourcePost key={post.content.data.id} post={post} mode={mode} />)
        : <p>Supporting content unavailable.</p>}
      {Object.entries(selected.requirement_evidence).map(([rule, evidence]) => <div key={rule}><strong>{readable(rule)}</strong><br /><SourceRef evidence={evidence} /></div>)}
      <HistoricMetrics history={selected.historical} />
      <h3>Audience evidence</h3><SurveyEvidence survey={selected.market_evidence} mode={mode} />
      <h3>Quote</h3><QuoteEvidence quote={selected.quote} mode={mode} />
    </Overlay>}
  </div>;
}