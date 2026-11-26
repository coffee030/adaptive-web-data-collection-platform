import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { getOperatorCredential, apiGet, apiLocal, ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import './public-directory.css';
import { TableRegion } from '../../components/feedback';

interface PublicProfile { record_id: string; evidence_id: string; item: string; revision: string; name: string; local_name: string; description: string; local_description: string }
interface Directory { state: 'available' | 'unavailable' | 'expired'; observed: string | null; expires: string | null; retrieval: string; profiles: PublicProfile[] }
interface Preview { observed: string; source_id: string; profile_id: string; report_id: string | null; count: number; example: PublicProfile }
interface SourceStatus { state: string; error?: string; collection?: string; next_check?: string }
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

export function PublicDirectoryOperations() {
  const [enteredToken,setToken] = useState('');
  const token = getOperatorCredential() || enteredToken;
  const [preview,setPreview] = useState<Preview>();
  const [status,setStatus] = useState<SourceStatus>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const request = useRef<AbortController>(undefined);
  useEffect(() => () => request.current?.abort(),[]);
  async function act(action: 'status' | 'prepare' | 'approve' | 'withdraw') {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError('');
    const base = '/marketing/intelligence/operator/public-directory/';
    try {
      if (action === 'prepare') {
        setPreview(undefined);
        setPreview(await apiLocal<Preview>(base+action,token,controller.signal,'POST',{}));
      } else if (action === 'status') {
        setStatus(await apiLocal<SourceStatus>(base+action,token,controller.signal));
      } else {
        if (action === 'withdraw' && !window.confirm('Withdraw all public profiles and stop their automatic refresh?')) return;
        setStatus(await apiLocal<SourceStatus>(base+action,token,controller.signal,'POST',
          action === 'approve' && preview ? {source_id:preview.source_id,profile_id:preview.profile_id,report_id:preview.report_id} : {}));
        setPreview(undefined);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof ApiError && [401,403].includes(e.status ?? 0) ? 'Use a system operator credential to manage this source.'
        : e instanceof ApiError && e.code === 'directory_source_blocked' ? 'Wikidata declined access. Review the publisher response before enabling refresh.'
        : 'The operation could not finish. Inspect the current status and retry.');
    } finally {if (controller === request.current) setBusy(false);}
  }
  return <section className="operator-page"><header className="page-heading"><h1>Public creator directory</h1><p>{__HARBOURLINE_INSTALLATION__ === 'demo' ? 'Authorize the Wikidata directory for password-free public research on this isolated demo.' : 'Authorize the Wikidata directory for shared company research.'} Only names and descriptions from the reviewed items enter the catalog.</p></header>
    <div className="operator-dataset-form">{!getOperatorCredential() && <label>System operator credential<input type="password" autoComplete="off" value={token} onChange={event => {request.current?.abort();setToken(event.target.value);setPreview(undefined);setStatus(undefined);setError('');}} /></label>}
    <p><a href={license} target="_blank" rel="noreferrer">Review the Wikidata CC0 terms</a>. A dated CC0 snapshot can initialize the first collection. The approved mapping refreshes public directory metadata daily. Unrefreshed listings expire after seven days.</p>
    <div className="operator-research-toolbar"><button disabled={busy || token.length<24} onClick={() => void act('status')}>Check status</button>
      <button disabled={busy || token.length<24} onClick={() => void act('prepare')}>Authorize source and preview fields</button></div>
    {busy && <p role="status">Checking directory…</p>}{error && <p role="alert">{error}</p>}
    {preview && <section><h2>Review field mapping</h2><p>{preview.count} source items checked on {date(preview.observed)}. Example from revision {preview.example.revision}.</p><p><strong>{preview.example.name} · {preview.example.local_name}</strong><br/>{preview.example.description}</p><button disabled={busy} onClick={() => void act('approve')}>Approve mapping and enable refresh</button></section>}
    {status && <p role="status">Directory source · {status.state}{status.collection && ' · Collection '+status.collection}{status.next_check && ' · Next check '+new Date(status.next_check).toLocaleString()}{status.error && ' · '+status.error.replaceAll('_',' ')}</p>}
    {status?.state === 'approved' && <button disabled={busy} onClick={() => void act('withdraw')}>Withdraw public directory</button>}
    </div></section>;
}
