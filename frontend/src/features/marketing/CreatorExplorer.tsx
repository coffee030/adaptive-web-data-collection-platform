import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { TableRegion } from '../../components/feedback';
import { audience, compact, eligibility, eligible, type Creator } from './contracts';
import { Compare, CreatorProfile, Evidence, Identity, Overlay, SaveCreator } from './components';
import { demoSearch } from './demo/fixture';
import { useMarketing } from './workspace';

export function CreatorExplorer({ capability }: { capability: ReactNode }) {
  const { draft, setDraft, demo, creators, path } = useMarketing();
  const [params, setParams] = useSearchParams();
  const [comparison, showComparison] = useState(false);
  const [evidence, setEvidence] = useState<Creator>();
  const inspector = useRef<HTMLDivElement>(null);
  const query = params.get('q') ?? '';
  const filter = params.get('filter') ?? 'all';
  const sort = params.get('sort') ?? 'fit';
  const view = params.get('view') === 'gallery' ? 'gallery' : 'desk';
  const selected = creators.find(creator => creator.id === params.get('creator'));
  const shortlisted = creators.filter(creator => draft.shortlist.includes(creator.id));
  const search = params.toString();

  useEffect(() => {
    setDraft(old => old.explorer === search ? old : { ...old, explorer: search });
  }, [search, setDraft]);

  useEffect(() => {
    if (selected && matchMedia('(max-width: 760px)').matches) inspector.current?.focus();
  }, [selected]);

  function change(key: string, value: string, replace = false) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace, preventScrollReset: true });
  }
  function searchFor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    change('q', String(new FormData(event.currentTarget).get('query') ?? '').trim());
  }
  function closeProfile() {
    change('creator', '', true);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-creator="${selected?.id}"]`)?.focus({ preventScroll: true }));
  }

  let results = demo ? [...demoSearch(query)] : [];
  if (filter === 'eligible') results = results.filter(creator => eligible(creator, draft.brief));
  if (filter === 'shortlist') results = results.filter(creator => draft.shortlist.includes(creator.id));
  if (sort === 'views') results.sort((a,b) => b.typicalViews - a.typicalViews);
  if (sort === 'audience') results.sort((a,b) => (b.hk ?? -1) - (a.hk ?? -1));
  const open = (creator: Creator) => change('creator', creator.id);

  return <div className="hl-page hl-explore">
    <div className="hl-page-heading"><div><h1>Creator Explorer</h1><p>Find creators, inspect historical evidence and build a shortlist.</p></div>
      {demo && <div className="hl-views" aria-label="Results view"><button type="button" aria-pressed={view === 'desk'} onClick={() => change('view','desk')}>Research desk</button><button type="button" aria-pressed={view === 'gallery'} onClick={() => change('view','gallery')}>Content gallery</button></div>}
    </div>
    <div className="hl-explore-tools">
      <form role="search" aria-label="Search creators" onSubmit={searchFor}>
        <label className="hl-sr" htmlFor="hl-search">Creator name, handle or topic</label>
        <input id="hl-search" name="query" key={query} defaultValue={query} maxLength={100} placeholder="Creator name, handle or topic" />
        <button className="hl-primary" type="submit">Search</button>
      </form>
      {demo && <div className="hl-actions">
        <label>Filter <select value={filter} onChange={event => change('filter', event.target.value)}><option value="all">All creators</option><option value="eligible">Meets requirements</option><option value="shortlist">Shortlisted</option></select></label>
        <label>Sort <select value={sort} onChange={event => change('sort', event.target.value)}><option value="fit">Content fit</option><option value="views">Typical views</option><option value="audience">HK audience</option></select></label>
      </div>}
    </div>
    {!demo ? <div className="hl-availability">{capability}{query && <p>Search entered for “{query}”. Eligible creator search is currently unavailable.</p>}</div> : <>
      <div className="hl-row-between hl-results-meta"><p role="status">{results.length} {results.length === 1 ? 'creator' : 'creators'} · Fictional Instagram sample</p>
        <button type="button" className="hl-text-button" onClick={() => change('q', '上環 café tour')}>Try <span lang="yue-Hant">上環</span> café tour</button></div>
      <div className={selected ? 'hl-explore-body hl-has-inspector' : 'hl-explore-body'}>
        <div className="hl-results">
          {results.length === 0 ? <section className="hl-empty"><h2>No matching creators</h2><p>Try another topic or clear the current search and filter.</p>
            <button type="button" onClick={() => {
              const next = new URLSearchParams(params); next.delete('q'); next.delete('filter'); setParams(next, { preventScrollReset: true });
            }}>Clear search and filter</button></section> : view === 'desk'
            ? <TableRegion label="Creator results"><table className="hl-creator-table"><thead><tr><th scope="col">Creator</th><th scope="col">HK audience</th><th scope="col">Typical views</th><th scope="col">Shortlist</th></tr></thead>
              <tbody>{results.map(creator => <tr key={creator.id} data-selected={selected?.id === creator.id}>
                <th scope="row"><button data-creator={creator.id} className="hl-identity-button" type="button" onClick={() => open(creator)}><Identity creator={creator} /></button>
                  <span className="hl-row-status">{eligibility(creator, draft.brief)}{creator.quote === null && ' · Quote missing'}{creator.expired && ' · Older snapshot'}</span></th>
                <td>{audience(creator.hk)}</td><td>{compact(creator.typicalViews)}</td><td><SaveCreator creator={creator} /></td>
              </tr>)}</tbody></table></TableRegion>
            : <div className="hl-gallery">{results.map(creator => <article key={creator.id}>
              <button data-creator={creator.id} type="button" className="hl-gallery-image" onClick={() => open(creator)}>
                <img src={creator.post.still} alt="" width="440" height="439" /><span>{creator.post.title}</span></button>
              <Identity creator={creator} /><p className="hl-note">Suggested category · {creator.category}</p>
              <p>{audience(creator.hk)} HK audience · {compact(creator.typicalViews)} historical views</p>
              <p className="hl-row-status">{eligibility(creator, draft.brief)}{creator.quote === null && ' · Quote missing'}{creator.expired && ' · Older snapshot'}</p>
              <SaveCreator creator={creator} />
            </article>)}</div>}
        </div>
        {selected && <div className="hl-inspector-slot" tabIndex={-1} ref={inspector}>
          <CreatorProfile creator={selected} evidence={() => setEvidence(selected)} close={closeProfile} />
        </div>}
      </div>
      <div className="hl-short-bar"><strong>{shortlisted.length} shortlisted</strong><div className="hl-actions">
        <button type="button" disabled={shortlisted.length < 2} onClick={() => showComparison(true)}>Compare shortlist</button>
        <Link className="hl-button hl-primary" to={path('plan')}>Open campaign plan</Link></div></div>
    </>}
    {evidence && <Overlay title={`Evidence for ${evidence.name}`} close={() => setEvidence(undefined)}><Evidence creator={evidence} /></Overlay>}
    {comparison && shortlisted.length > 1 && <Compare creators={shortlisted} close={() => showComparison(false)} />}
  </div>;
}