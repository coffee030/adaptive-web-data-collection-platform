import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import './public-directory.css';
import { TableRegion } from '../../components/feedback';

interface PublicProfile { record_id: string; evidence_id: string; item: string; revision: string; name: string; local_name: string; description: string; local_description: string }
interface Directory { state: 'available' | 'unavailable' | 'expired'; observed: string | null; expires: string | null; retrieval: string; profiles: PublicProfile[] }
const license = 'https://www.wikidata.org/wiki/Wikidata:Licensing';
const date = (value: string) => new Date(value).toLocaleDateString('en-HK',{day:'numeric',month:'short',year:'numeric'});

export function PublicCreatorDirectory({ isolatedDemo = false }: { isolatedDemo?: boolean }) {
  const [params,setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const endpoint = isolatedDemo ? 'public-research/directory' : 'partner/public-directory';
  const load = useCallback((signal: AbortSignal) => apiGet<Directory>('/marketing/intelligence/'+endpoint+'?q='+encodeURIComponent(query),signal),[endpoint,query]);
  const { result,retry } = useResource(load);
  const [ids,setIds] = useState<string[]>([]);
  const [comparing,setComparing] = useState(false);
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') retry(); };
    const timer = window.setInterval(refresh,30000);
    window.addEventListener('focus',refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus',refresh); };
  },[retry]);
  const data = result.state === 'ready' ? result.data : undefined;
  const expires = data?.expires;
  useEffect(() => {
    if (!expires || data?.state !== 'available') return;
    const timer = window.setTimeout(retry,Math.max(1,Date.parse(expires)-Date.now()));
    return () => window.clearTimeout(timer);
  },[data?.state,expires,retry]);
  const opened = params.get('record');
  const rows = (data?.profiles ?? []).filter(p => !comparing || ids.includes(p.item));
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    setComparing(false); setIds([]); setParams(q ? {q} : {});
  }
  function source(profile: PublicProfile) {
    return <a href={'https://www.wikidata.org/w/index.php?title='+profile.item+'&oldid='+profile.revision} target="_blank" rel="noreferrer">Source revision<span className="sr-only"> for {profile.name}</span> ↗</a>;
  }
  const hasLiteral = rows.some(profile => [profile.name, profile.local_name, profile.description, profile.local_description]
    .some(value => value.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  return <div className="hl-page hl-directory">
    <header className="hl-page-heading"><div><h1>Public creator directory</h1><p>Discover Hong Kong creators through their published Wikidata records.</p></div></header>
    <form className="hl-directory-search" onSubmit={submit} role="search" aria-label="Search public creators">
      <input key={query} name="q" aria-label="Creator name or topic" defaultValue={query} maxLength={120} placeholder="Creator name or topic" />
      <button type="submit" className="hl-primary">Search</button>
      {query && <button type="button" onClick={() => {setComparing(false);setIds([]);setParams({});}}>Clear search</button>}
    </form>
    {result.state === 'loading' && <p role="status">Loading public profiles…</p>}
    {result.state === 'error' && <div role="alert">Public profiles could not be loaded. <button type="button" onClick={retry}>Retry</button></div>}
    {data && data.state !== 'available' && <div className="hl-decision"><h2>{data.state === 'expired' ? 'Directory records have expired' : 'No current public directory'}</h2>
      <p>Ask your workstation operator to check the approved Wikidata source in Data Operations. Try again after a successful collection.</p>
      <button onClick={retry}>Check again</button></div>}
    {data?.state === 'available' && <>
      <div className="hl-row-between"><p role="status">{rows.length} public {rows.length === 1 ? 'profile' : 'profiles'}{data.observed && ' · Checked '+date(data.observed)}{query && (data.retrieval === 'granite_int8' ? ' · Multilingual description search' : ' · Text search')}</p>
        {comparing ? <button type="button" onClick={() => setComparing(false)}>Show all results</button> : <button type="button" disabled={ids.length < 2} onClick={() => setComparing(true)}>Compare selected ({ids.length})</button>}
      </div>
      {query && rows.length > 0 && !hasLiteral && <p className="hl-directory-limit">Related profiles. The published descriptions do not explicitly mention “{query}”. Check a creator’s historical posts before shortlisting.</p>}
      {comparing ? <TableRegion label="Public creator research"><table className="hl-comparison"><thead><tr><th scope="col">Creator</th><th scope="col">Public description</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{rows.map(profile => <tr key={profile.item}><th scope="row">{profile.name}</th><td>{profile.description}</td><td>{source(profile)}</td></tr>)}</tbody></table></TableRegion> :
        <ul className="hl-directory-list">{rows.map(profile => <li key={profile.item}>
          <article><div className="hl-directory-identity"><h2>{profile.name}</h2>{profile.local_name && profile.local_name !== profile.name && <span lang="zh-Hant">{profile.local_name}</span>}</div>
            <p>{profile.description}</p>{profile.local_description && <p lang="zh-Hant">{profile.local_description}</p>}
            <button className="hl-text-button hl-inspect-record" aria-expanded={opened === profile.item} aria-controls={'record-'+profile.item} onClick={() => {
              const next = new URLSearchParams(params);
              if (opened === profile.item) next.delete('record'); else next.set('record',profile.item);
              setParams(next, {preventScrollReset:true});
            }}>Inspect record<span className="sr-only"> for {profile.name}</span></button>
            <div className="hl-record-source" id={'record-'+profile.item} hidden={opened !== profile.item}>
              <h3>Collected source record</h3><p>{profile.description}</p>
              <p>{data.observed && 'Observed '+date(data.observed)+' · '}Wikidata {profile.item} · Revision {profile.revision}</p>{source(profile)}
              <details><summary>Collection references</summary><p>Record {profile.record_id}<br/>Evidence {profile.evidence_id}</p></details>
              <p>Audience, historical performance and firm fees require separate evidence.</p>
              {isolatedDemo ? <p>Ask the creator for relevant posts and a current quote before planning spend.</p> :
                <Link to={'/creators?q='+encodeURIComponent(profile.name)}>Find company evidence</Link>}
            </div>
          </article><label className="hl-check"><input type="checkbox" aria-label={'Compare '+profile.name} checked={ids.includes(profile.item)} onChange={e => setIds(old => e.target.checked ? [...old,profile.item] : old.filter(id => id !== profile.item))}/>Compare</label>
        </li>)}</ul>}
      {!rows.length && <div className="hl-empty"><h2>No public profiles matched</h2><p>Try a broader topic such as cooking, or search the creator’s name.</p><button onClick={() => {setIds([]);setComparing(false);setParams({});}}>Browse all public profiles</button></div>}
      <p className="hl-note">Source · <a href={license} target="_blank" rel="noreferrer">Wikidata · CC0</a></p>
    </>}
  </div>;
}
