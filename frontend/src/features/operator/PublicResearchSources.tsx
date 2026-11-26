import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { apiLocal, ApiError, getOperatorCredential } from '../../lib/api';
import { jobPath } from '../collection-jobs/api';

const feeds = {
  'public-directory': { name: 'Wikidata directory', scope: 'Names and published descriptions of Hong Kong creators.', terms: 'Wikidata CC0 terms', url: 'https://www.wikidata.org/wiki/Wikidata:Licensing' },
  'public-works': { name: 'Wikimedia Commons works', scope: 'Attributed public works with source and license links for individual records.', terms: 'Commons licensing terms', url: 'https://commons.wikimedia.org/wiki/Commons:Licensing' },
};
type Feed = keyof typeof feeds;
interface Preview {
  observed: string; source_id: string; profile_id: string; report_id: string | null; count: number;
  example: { name: string; title?: string; local_name?: string; revision?: string; description?: string; excerpt?: string };
}
interface Receipt { job_id: string; finished_at: string; state: string; accepted: number; invalid: number; duplicates: number }
interface SourceStatus {
  state: string; publication?: 'available' | 'expired' | 'unavailable'; error?: string; collection?: string;
  visible_count?: number; observed?: string; expires?: string; next_check?: string; last_success?: Receipt; last_attempt?: Receipt;
}
const timestamp = (value: string) => new Date(value).toLocaleString('en-HK', {dateStyle: 'medium', timeStyle: 'short'});
const message = (e: unknown) => e instanceof ApiError && [401,403].includes(e.status ?? 0) ? 'Use a system operator credential to manage this source.'
  : e instanceof ApiError && e.code?.endsWith('source_blocked') ? 'The publisher declined access. Review the source terms and access status.'
  : e instanceof ApiError && e.kind === 'timeout' ? 'The source check took too long. Check its current status before trying again.'
  : 'The operation could not finish. Check status and try again.';

function CollectionReceipt({ receipt, title }: { receipt: Receipt; title: string }) {
  return <div><dt>{title}</dt><dd>{timestamp(receipt.finished_at)} · {receipt.state}<br/>
    {receipt.accepted} accepted · {receipt.invalid} held · {receipt.duplicates} duplicates<br/>
    <Link to={jobPath(receipt.job_id)}>Inspect collection</Link></dd></div>;
}

function SourceControls({ feed, token, trusted }: { feed: Feed; token: string; trusted: boolean }) {
  const [preview,setPreview] = useState<Preview>();
  const [status,setStatus] = useState<SourceStatus>();
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const pending = useRef<AbortController>(undefined);
  const base = '/marketing/intelligence/operator/'+feed+'/';
  const isDirectory = feed === 'public-directory';
  const publication = status?.publication;
  const info = feeds[feed];
  useEffect(() => {
    if (!trusted) return () => pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    apiLocal<SourceStatus>(base+'status',token,controller.signal).then(setStatus).catch(e => {
      if (!controller.signal.aborted) setError(message(e));
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => pending.current?.abort();
  },[base,token,trusted]);

  async function act(action: 'status' | 'prepare' | 'approve' | 'withdraw') {
    if (action === 'withdraw' && !window.confirm('Withdraw '+info.name+' and stop automatic refresh?')) return;
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError('');
    try {
      if (action === 'prepare') {
        setPreview(undefined);
        const result = await apiLocal<Preview>(base+action,token,controller.signal,'POST',{});
        if (!controller.signal.aborted) setPreview(result);
      } else {
        if (action !== 'status') {
          const body = action === 'approve' && preview ? {source_id:preview.source_id,profile_id:preview.profile_id,report_id:preview.report_id} : {};
          await apiLocal(base+action,token,controller.signal,'POST',body);
          setPreview(undefined);
          setStatus(undefined);
        }
        const result = await apiLocal<SourceStatus>(base+'status',token,controller.signal);
        if (!controller.signal.aborted) setStatus(result);
      }
    } catch (e) {
      if (!controller.signal.aborted) {setError(message(e)); if (action === 'status') setStatus(undefined);}
    } finally {if (!controller.signal.aborted) setBusy(false);}
  }

  const prepare = <button disabled={busy || token.length<24} onClick={() => void act('prepare')}>Authorize source and preview fields</button>;
  return <section aria-label={info.name} className="operator-source-control">
    <h2>{info.name}</h2><p>{info.scope} <a href={info.url} target="_blank" rel="noreferrer">{info.terms}</a></p>
    <div className="operator-research-toolbar">
      <button disabled={busy || token.length<24} onClick={() => void act('status')}>Check status</button>
      {status?.state !== 'approved' && prepare}
    </div>
    {busy && <p role="status">Checking source…</p>}{error && <p role="alert">{error}</p>}
    {status && <>
      <h3>Publication status</h3>
      <p role="status">{isDirectory ? 'Directory source' : 'Works source'} · {status.state}</p>
      <dl className="operator-source-status">
        <div><dt>Customer visibility</dt><dd>{publication === 'available' ? (status.visible_count == null ? 'Published' : status.visible_count+' published '+(isDirectory ? 'profiles' : 'contributors')) : publication === 'expired' ? 'Expired · hidden from research' : publication === 'unavailable' ? 'No records published' : 'Publication status unavailable'}
          {status.observed && <><br/>Observed {timestamp(status.observed)}</>}
          {status.expires && <><br/>Expires {timestamp(status.expires)}</>}</dd></div>
        <div><dt>Background collection</dt><dd>{status.collection ?? (status.state === 'approved' ? 'Waiting for the next refresh' : 'Refresh inactive')}
          {status.next_check && status.state === 'approved' && <><br/>Next check {timestamp(status.next_check)}</>}
          {status.error && <><br/>{status.error.replaceAll('_',' ')}</>}</dd></div>
        {status.last_success ? <CollectionReceipt title="Last successful collection" receipt={status.last_success}/> :
          <div><dt>Last successful collection</dt><dd>No accepted collection on record</dd></div>}
        {status.last_attempt && status.last_attempt.job_id !== status.last_success?.job_id && <CollectionReceipt title="Latest completed attempt" receipt={status.last_attempt}/>}
      </dl>
      {publication === 'available' && <Link to={__HARBOURLINE_INSTALLATION__ === 'demo' ? '/demo/connected/directory' : '/directory'}>Open published research</Link>}
    </>}
    {preview && <section className="operator-review"><h3>Review field mapping</h3>
      <p>{preview.count} source items checked on {timestamp(preview.observed)}.{preview.example.revision && ' Example from revision '+preview.example.revision+'.'}</p>
      <p><strong>{preview.example.title ?? preview.example.name}</strong>{preview.example.local_name && ' · '+preview.example.local_name}<br/>{preview.example.excerpt ?? preview.example.description}</p>
      <button disabled={busy} onClick={() => void act('approve')}>Approve mapping and enable refresh</button>
    </section>}
    {status?.state === 'approved' && <details className="operator-source-management"><summary>Manage source approval</summary>
      <div className="operator-research-toolbar">{prepare}<button disabled={busy} className="operator-danger" onClick={() => void act('withdraw')}>{isDirectory ? 'Withdraw public directory' : 'Withdraw public works'}</button></div>
    </details>}
  </section>;
}

export function PublicDirectoryOperations() {
  const [feed,setFeed] = useState<Feed>('public-directory');
  const [entered,setEntered] = useState('');
  const [credentialRevision,setCredentialRevision] = useState(0);
  const credential = getOperatorCredential();
  const token = credential || entered;
  return <section className="operator-page operator-public-sources"><header className="page-heading"><h1>Public research sources</h1>
    <p>Review what companies can see, inspect a collection or manage source approval.</p></header>
    <div className="operator-dataset-form"><label>Research source<select value={feed} onChange={event => setFeed(event.target.value as Feed)}>
      {Object.entries(feeds).map(([id,info]) => <option key={id} value={id}>{info.name}</option>)}</select></label>
      {!credential && <label>System operator credential<input type="password" autoComplete="off" value={entered} onChange={event => {setEntered(event.target.value);setCredentialRevision(value => value+1);}}/></label>}
    </div><SourceControls key={feed+':'+credentialRevision} feed={feed} token={token} trusted={Boolean(credential)}/>
  </section>;
}
