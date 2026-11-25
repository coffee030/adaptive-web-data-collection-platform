import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TableRegion } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { Overlay } from './components';
import { HistoricMetrics, IntelligenceError, Pending, QuoteEvidence, RefreshOnFocus, SourcePost, SourceRef, SurveyEvidence, measureText } from './IntelligenceEvidence';
import { catalog, compareCreators, creatorDetail, processing, visibleFor, languageOptions, platformOptions, type CreatorDetail,
  type CreatorSummary, type DataMode, type Platform } from './intelligence';
import { useMarketing } from './workspace';

function WorkspaceProcessing({ mode }: { mode: DataMode }) {
  const load = useCallback((signal: AbortSignal) => processing(mode, signal), [mode]);
  const { result, retry } = useResource(load);
  const preparing = result.state === 'ready' && result.data.state === 'preparing';
  useEffect(() => {
    if (!preparing) return;
    const timer = setTimeout(retry, 3000);
    return () => clearTimeout(timer);
  }, [preparing, retry]);
  if (result.state === 'loading') return <p role="status" className="hl-note">Checking research coverage…</p>;
  if (result.state === 'error') return <p className="hl-note">Index status unavailable. <button type="button" onClick={retry}>Refresh coverage</button></p>;
  const { data } = result;
  return <p role="status" className="hl-note">{data.state === 'preparing'
    ? `Semantic indexing in progress · ${data.indexed_datasets} of ${data.eligible_datasets} datasets indexed. Text results are available.`
    : data.state === 'fallback' ? 'Text retrieval is active.'
    : data.state === 'empty' ? 'No eligible datasets are currently available.'
    : `${data.indexed_datasets} of ${data.eligible_datasets} eligible datasets indexed.`}</p>;
}

function Coverage({ creator }: { creator: CreatorSummary }) {
  return <span className="hl-note">{creator.pricing === 'available' ? 'Current quote available' : 'Quote unavailable'} ·
    {' '}{creator.audience === 'available' ? 'Survey evidence available' : 'Audience data unavailable'}</span>;
}

function CreatorRecord({ detail, mode }: { detail: CreatorDetail; mode: DataMode }) {
  const [tab, setTab] = useState<'history' | 'content'>('content');
  return <>
    <p>{detail.profile.data.description}</p>
    <SourceRef evidence={detail.profile.evidence} />
    <div className="hl-actions hl-record-tabs">
      <button type="button" aria-pressed={tab === 'content'} onClick={() => setTab('content')}>Historical content</button>
      <button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>Metrics and quotes</button>
    </div>
    {tab === 'content' ? detail.posts.length ? detail.posts.map(post => <SourcePost key={post.content.data.id} post={post} mode={mode} />)
      : <p>No historical content is available.</p> : <>
      {Object.entries(detail.historical_by_platform).map(([platform, history]) => <section key={platform} className="hl-source-post">
        <h3>{platformOptions[platform as Platform]}</h3><HistoricMetrics history={history} /></section>)}
      <h3>Current firm quotes</h3>
      {detail.quotes.length ? detail.quotes.map(quote => <QuoteEvidence key={quote.evidence.reference} quote={quote} mode={mode} />) : <QuoteEvidence quote={null} mode={mode} />}
      <h3>Audience surveys</h3>
      {detail.audiences.length ? detail.audiences.map(survey => <SurveyEvidence key={survey.evidence.reference} survey={survey} mode={mode} />) : <SurveyEvidence survey={null} mode={mode} />}
    </>}
  </>;
}

function RecordInspector({ mode, id, close }: { mode: DataMode; id: string; close: () => void }) {
  const load = useCallback((signal: AbortSignal) => creatorDetail(mode,id,signal), [mode,id]);
  const request = useResource(load);
  const detail = request.result.state === 'ready' && visibleFor(mode, request.result.data.profile.evidence) ? request.result.data : null;
  return <section className="hl-inspector hl-api-inspector" aria-label="Creator profile">
    <RefreshOnFocus refresh={request.retry} />
    <div className="hl-row-between"><h2>{detail?.profile.data.name ?? 'Creator profile'}</h2><button type="button" onClick={close}>Close profile</button></div>
    {request.result.state === 'loading' ? <Pending>Loading eligible creator evidence…</Pending>
      : request.result.state === 'error' ? <IntelligenceError error={request.result.error} retry={request.retry} />
      : detail ? <CreatorRecord detail={detail} mode={mode} key={id} /> : <p>Creator evidence has expired or is unavailable.</p>}
  </section>;
}

function CompareRecords({ mode, ids, platform, close }: { mode: DataMode; ids: string[]; platform: Platform | ''; close: () => void }) {
  const load = useCallback((signal: AbortSignal) => compareCreators(mode,ids,signal), [mode,ids]);
  const request = useResource(load);
  const result = request.result.state === 'ready' ? request.result.data : undefined;
  const creators = result?.creators.filter(row => visibleFor(mode,row.profile.evidence)) ?? [];
  return <Overlay title="Compare shortlisted creators" close={close} wide>
    {request.result.state === 'loading' && <Pending>Loading the current comparison…</Pending>}
    {request.result.state === 'error' && <IntelligenceError error={request.result.error} retry={request.retry} />}
    {result && <>
      {result.unavailable_ids.length > 0 && <p role="status">{result.unavailable_ids.length} selected creators are unavailable in this workspace.</p>}
      {creators.length === 0 ? <p>No eligible comparison records are available.</p> :
        <TableRegion label="Creator comparison"><table className="hl-comparison"><thead><tr><th scope="col">Creator</th><th scope="col">Platforms</th>
          <th scope="col">Evidence coverage</th>{platform && <th scope="col">{platformOptions[platform]} · Median views (7-day window)</th>}</tr></thead>
          <tbody>{creators.map(creator => <tr key={creator.profile.data.creator_id}><th scope="row">{creator.profile.data.name}</th>
            <td>{creator.profile.data.accounts.map(account => platformOptions[account.platform]).join(', ')}</td><td><Coverage creator={creator} /></td>
            {platform && <td>{measureText(creator.historical_by_platform[platform]?.median_views)}</td>}</tr>)}</tbody></table></TableRegion>}
      {!platform && <p className="hl-note">Filter to one platform to compare historical performance within that platform.</p>}
    </>}
  </Overlay>;
}

export function ConnectedExplorer({ mode }: { mode: DataMode }) {
  const { draft, setDraft, path, toggleShortlist } = useMarketing();
  const [params,setParams] = useSearchParams();
  const [compare,setCompare] = useState<string[]>();
  const inspector = useRef<HTMLDivElement>(null);
  const serial = params.toString();
  const view = params.get('view') === 'gallery' ? 'gallery' : 'desk';
  const selected = params.get('creator');
  const platform = params.get('platform') as Platform | null;
  const query = params.get('q') ?? '';
  const filters = useMemo(() => {
    const prior = new URLSearchParams(serial);
    const next = new URLSearchParams();
    for (const [key, field] of [['q','query'],['platform','platform'],['language','language'],['market','market']] as const) {
      const value = prior.get(key);
      if (value) next.set(field, value);
    }
    return next.toString();
  }, [serial]);
  const load = useCallback((signal: AbortSignal) => catalog(mode,new URLSearchParams(filters),signal), [mode,filters]);
  const request = useResource(load);
  useEffect(() => {
    setDraft(old => old.explorer === serial ? old : { ...old, explorer: serial });
  }, [serial,setDraft]);

  useEffect(() => {
    if (selected && matchMedia('(max-width: 760px)').matches) inspector.current?.focus();
  }, [selected]);

  const data = request.result.state === 'ready' ? request.result.data : undefined;
  const rows = data?.creators.filter(row => visibleFor(mode,row.profile.evidence)) ?? [];
  if (params.get('sort') === 'posts') rows.sort((a,b) => b.post_count - a.post_count);
  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key,value); else next.delete(key);
    setParams(next,{ preventScrollReset:true });
  }
  function closeProfile() {
    change('creator','');
    window.requestAnimationFrame(() => document.getElementById('profile-trigger-' + selected)?.focus({preventScroll:true}));
  }
  function save(creator: CreatorSummary) {
    const { creator_id: id, name } = creator.profile.data;
    return <button type="button" aria-pressed={draft.shortlist.includes(id)} aria-label={'Shortlist ' + name} onClick={() => toggleShortlist(id)}>Shortlist</button>;
  }
  return <div className="hl-page hl-explore"><RefreshOnFocus refresh={request.retry} />
    <div className="hl-page-heading"><div><h1>Creator Explorer</h1><p>Search eligible profiles and review creator-authored content.</p></div>
      <div className="hl-views"><button type="button" aria-pressed={view === 'desk'} onClick={() => change('view','desk')}>Research desk</button>
        <button type="button" aria-pressed={view === 'gallery'} onClick={() => change('view','gallery')}>Content gallery</button></div></div>
    <div className="hl-explore-tools"><form role="search" aria-label="Search creators" onSubmit={event => {
      event.preventDefault(); change('q',String(new FormData(event.currentTarget).get('q') ?? '').trim());
    }}><input key={query} name="q" aria-label="Creator name or content topic" minLength={2} maxLength={120} defaultValue={query} placeholder="Creator name or content topic" /><button type="submit" className="hl-primary">Search</button></form></div>
    <div className="hl-connected-filters">
      <label>Platform<select value={platform ?? ''} onChange={event => change('platform',event.target.value)}><option value="">All platforms</option>
        {Object.entries(platformOptions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Language<select value={params.get('language') ?? ''} onChange={event => change('language',event.target.value)}><option value="">All languages</option>
        {Object.entries(languageOptions).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Market<select value={params.get('market') ?? ''} onChange={event => change('market',event.target.value)}><option value="">All markets</option><option value="HK">Hong Kong survey evidence</option></select></label>
      <label>Sort<select value={params.get('sort') ?? ''} onChange={event => change('sort',event.target.value)}><option value="">Name</option><option value="posts">Historical content count</option></select></label>
    </div>
    <WorkspaceProcessing mode={mode} />
    {request.result.state === 'loading' && <Pending>Loading creator results…</Pending>}
    {request.result.state === 'error' && <IntelligenceError error={request.result.error} retry={request.retry} />}
    {data && <div className={selected ? 'hl-explore-body hl-has-inspector' : 'hl-explore-body'}>
      <div className="hl-results">
        {rows.length === 0 ? <div className="hl-empty"><h2>No matching creators</h2><p>Change the search or clear filters.</p>
          <button type="button" onClick={() => setParams({}, { preventScrollReset:true })}>Clear search and filters</button></div>
          : view === 'desk' ? <TableRegion label="Eligible creator results"><table className="hl-api-table"><thead><tr>
            <th scope="col">Creator</th><th scope="col">Historical posts</th><th scope="col">Coverage</th><th scope="col">Shortlist</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.profile.data.creator_id}><th scope="row"><button type="button" className="hl-text-button"
              id={'profile-trigger-' + row.profile.data.creator_id} onClick={() => change('creator',row.profile.data.creator_id)}>{row.profile.data.name}</button></th>
              <td>{row.post_count}</td><td><Coverage creator={row} /></td><td>{save(row)}</td></tr>)}</tbody></table></TableRegion>
          : <div className="hl-gallery hl-text-gallery">{rows.map(row => <article key={row.profile.data.creator_id}>
            <h2>{row.profile.data.name}</h2>{row.profile.data.description && <p>{row.profile.data.description}</p>}
            <p>{row.post_count} historical posts</p><Coverage creator={row} /><div className="hl-actions"><button type="button"
              id={'profile-trigger-' + row.profile.data.creator_id} onClick={() => change('creator',row.profile.data.creator_id)}>Inspect content</button>{save(row)}</div>
          </article>)}</div>}
      </div>
      {selected && <div className="hl-inspector-slot" tabIndex={-1} ref={inspector}><RecordInspector mode={mode} id={selected} close={closeProfile} /></div>}
    </div>}
    {data && <div className="hl-short-bar"><strong>{draft.shortlist.length} shortlisted</strong><div className="hl-actions">
      <button type="button" disabled={draft.shortlist.length < 2} onClick={() => setCompare(draft.shortlist.slice(0,12))}>Compare shortlist</button>
      <Link className="hl-button" to={path('advisor')}>Open Campaign Advisor</Link></div></div>}
    {compare && <CompareRecords ids={compare} mode={mode} platform={platform ?? ''} close={() => setCompare(undefined)} />}
  </div>;
}