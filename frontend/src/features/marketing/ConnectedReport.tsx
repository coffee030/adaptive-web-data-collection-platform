import { useState } from 'react';
import { Link } from 'react-router';
import { EvaluationScope, readable } from './EvaluationScope';
import { useEvaluation } from './useEvaluation';
import { Overlay } from './components';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, SourcePost, SourceRef, SurveyEvidence } from './IntelligenceEvidence';
import { amount, campaignInput, date, type DataMode, type Recommendation } from './intelligence';
import { useMarketing } from './workspace';

export function ConnectedReport({ mode }: { mode: DataMode }) {
  const { draft, path, toggleShortlist } = useMarketing();
  const { current, evaluate, running, error, retry } = useEvaluation(mode);
  const [invalid, setInvalid] = useState('');
  const [selectedId, setSelectedId] = useState<string>();

  function submit(shortlist = false) {
    setInvalid('');
    try {
      if (shortlist && draft.shortlist.length > 40) throw Error('Choose up to 40 shortlisted creators for one campaign evaluation.');
      const payload = campaignInput(draft.brief);
      if (shortlist) payload.shortlist = draft.shortlist;
      setSelectedId(undefined);
      evaluate(payload);
    } catch (error) { setInvalid((error as Error).message); }
  }

  const candidates = current?.recommendations ?? [];
  const selected = candidates.find(candidate => candidate.creator_id === selectedId);
  const eligible = candidates.filter(candidate => candidate.eligible);
  const excluded = candidates.filter(candidate => !candidate.eligible);

  function candidateRow(candidate: Recommendation) {
    return <div key={candidate.creator_id}><span><strong>{candidate.name}</strong><br />
      <span className="hl-note">{candidate.eligible
        ? ['Meets checked requirements', ...candidate.limitations.map(readable)].join(' · ')
        : candidate.limitations.map(readable).join(' · ') || 'Needs eligibility review'}
        {current?.plan.selected.includes(candidate.creator_id) && ' · Selected in plan'}</span></span>
      <span className="hl-actions"><button type="button" onClick={() => setSelectedId(candidate.creator_id)}>Evidence for {candidate.name}</button>
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
      <div className="hl-actions"><button type="button" className="hl-primary" disabled={running} onClick={() => current ? retry() : submit()}>{current ? 'Refresh recommendations' : 'Run Campaign Advisor'}</button>
        {current?.campaign.shortlist?.length ? <button type="button" onClick={() => submit()}>Evaluate all creators</button> : null}
        {draft.shortlist.length > 0 && <button type="button" disabled={running} onClick={() => submit(true)}>Evaluate shortlist</button>}
        {current && <Link className="hl-button" to={path('plan')}>Inspect plan</Link>}</div>
    </div>
    {(draft.brief.required || draft.brief.preferred) && <p className="hl-note">The Advisor checks your selected content criteria. Review any additional notes manually.</p>}
    {invalid && <p role="alert" className="hl-decision hl-warning">{invalid}</p>}
    {running && <Pending>Reviewing eligible campaign evidence…</Pending>}
    {error && <IntelligenceError error={error} retry={retry} />}
    {current && <>
      <EvaluationScope result={current}/>
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
    {selected && current && <Overlay title={'Evidence for ' + selected.name} close={() => setSelectedId(undefined)}>
      <p>Ranking factors describe relative content and campaign fit.</p>
      <SourceRef evidence={selected.profile_evidence} />
      <h3>Supporting posts</h3>
      {selected.evidence.length > 0 ? selected.evidence.map(post => <SourcePost key={post.content.data.id} post={post} mode={mode} />)
        : <p>Supporting content unavailable.</p>}
      {Object.entries(selected.requirement_evidence).map(([rule, evidence]) => <div key={rule}><strong>{readable(rule)}</strong><br /><SourceRef evidence={evidence} /></div>)}
      <HistoricMetrics history={selected.historical} />
      <h3>Audience evidence</h3><SurveyEvidence survey={selected.market_evidence} mode={mode} />
      <h3>Quote</h3><QuoteEvidence quote={selected.quote} mode={mode} />
      <h3>Ranking factors</h3>
      <dl className="hl-facts">{Object.entries(selected.factor_weights).map(([name, weight]) =>
        <div key={name}><dt>{readable(name)}</dt><dd>{selected.factors[name] == null ? 'Unavailable' : 'Used in ranking'} · Weight {weight}</dd></div>)}</dl>
    </Overlay>}
  </div>;
}