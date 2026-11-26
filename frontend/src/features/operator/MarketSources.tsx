import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Loading, RequestProblem } from '../../components/feedback';
import { PageHeader, Panel } from '../../components/studio/Workspace';
import { ApiError, apiLocal, getOperatorCredential } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath } from '../collection-jobs/api';
import { operationsPath } from './OperationsTasks';

const endpoint = '/marketing/intelligence/operator/market/sources';
type Action = 'refresh' | 'withdraw' | 'restore';
interface Receipt { job_id: string; state: string; accepted: number; invalid: number; duplicates: number; finished_at: string }
interface Source {
  key: string; name: string; platform: string; rights_url: string; state: string; publication: string; observed_at: string | null;
  expires_at: string | null; next_check: string | null; pending: boolean; visible_count: number; creator_count: number;
  last_success: Receipt | null; last_attempt: Receipt | null; error: string | null;
}
const displayState = (state: string) => state.replaceAll('_',' ');
const stamp = (value: string | null) => value
  ? new Intl.DateTimeFormat('en-HK',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Hong_Kong'}).format(new Date(value)) + ' HKT' : 'Unavailable';

function SourceDetail({ source, credential, changed }: { source: Source; credential: string; changed: () => void }) {
  const [confirm,setConfirm] = useState(false);
  const [pending,setPending] = useState<Action>();
  const [message,setMessage] = useState('');
  const controller = useRef<AbortController | null>(null);
  const withdrawButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => () => controller.current?.abort(),[]);
  useEffect(() => { if (confirm) confirmButton.current?.focus(); },[confirm]);

  async function act(action: Action) {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request; setPending(action); setMessage('');
    try {
      await apiLocal(endpoint + '/' + encodeURIComponent(source.key) + '/' + action,credential,request.signal,'POST');
      if (request.signal.aborted) return;
      setMessage(action === 'refresh' ? 'Refresh requested. The source schedule and provider limits determine when collection starts.'
        : action === 'withdraw' ? 'Source withdrawn.' : 'Source approval updated.');
      setConfirm(false); changed();
    } catch (error) {
      if (!request.signal.aborted) {
        setMessage(error instanceof ApiError && error.kind === 'timeout'
          ? 'The request timed out. Check the source status before retrying.'
          : error instanceof ApiError && error.status === 409 ? 'The source changed. Review its updated state before trying again.'
          : 'The change could not be confirmed. Review the source state and try again.');
        changed();
      }
    } finally {
      controller.current = null;
      if (!request.signal.aborted) setPending(undefined);
    }
  }
  const receipt = source.last_attempt;
  return <Panel title={source.name} description={source.platform} actions={/^https:\/\//i.test(source.rights_url) && <a href={source.rights_url} target="_blank" rel="noreferrer">Publisher terms ↗</a>}>
    <div className="studio-panel-body ops-market-detail">
      <dl><div><dt>Authorization</dt><dd>{displayState(source.state)}</dd></div>
        <div><dt>Publication</dt><dd>{displayState(source.publication)}</dd></div>
        <div><dt>Visible to companies</dt><dd>{source.visible_count} records · {source.creator_count} creators</dd></div>
        <div><dt>Last observation</dt><dd>{stamp(source.observed_at)}</dd></div>
        <div><dt>Expires</dt><dd>{stamp(source.expires_at)}</dd></div>
        <div><dt>Next check</dt><dd>{stamp(source.next_check)}</dd></div></dl>
      {source.error && <p className="ops-market-issue" role="status">Source needs attention · {displayState(source.error)}</p>}
      {receipt && <p>Latest collection · <Link to={jobPath(receipt.job_id)}>{displayState(receipt.state)}</Link>
        {' · '}{receipt.accepted} accepted · {receipt.invalid} held · {receipt.duplicates} duplicates</p>}
      <div className="studio-actions">
        {source.state === 'approved' ? <>
          <button disabled={!!pending || source.pending} onClick={() => void act('refresh')}>{source.pending ? 'Collection pending' : pending === 'refresh' ? 'Requesting…' : 'Request refresh'}</button>
          {!confirm && <button ref={withdrawButton} disabled={!!pending} onClick={() => setConfirm(true)}>Review withdrawal</button>}
        </> : <button disabled={!!pending} onClick={() => void act('restore')}>{pending ? 'Checking source…' : 'Validate and authorize'}</button>}
      </div>
      {confirm && <div className="ops-market-confirm"><strong>Withdraw {source.name}?</strong>
        <p>This removes its published records from Marketing and stops scheduled collection for this source.</p>
        <div className="studio-actions"><button ref={confirmButton} type="button" disabled={!!pending}
          onClick={() => { setConfirm(false); requestAnimationFrame(() => withdrawButton.current?.focus()); }}>Keep source</button>
          <button type="button" disabled={!!pending} onClick={() => void act('withdraw')}>{pending === 'withdraw' ? 'Withdrawing…' : 'Withdraw source'}</button></div>
      </div>}
      {message && <p role="status">{message}</p>}
    </div>
  </Panel>;
}

export function MarketSources() {
  const [credential,setCredential] = useState(getOperatorCredential);
  const [revision,setRevision] = useState(0);
  const [choice,setChoice] = useState<string>();
  const trusted = location.protocol === 'http:' && location.hostname === '127.0.0.1';
  const load = useCallback((signal: AbortSignal) => apiLocal<{items: Source[]}>(endpoint,credential,signal),[credential]);
  const { result,retry,refreshing } = useResource(load,revision,true,Boolean(credential) && trusted);
  const refresh = () => setRevision(value => value + 1);
  const selected = result.state === 'ready' && (result.data.items.find(source => source.key === choice) ?? result.data.items[0]);
  return <div className="ops-market">
    <PageHeader title="Market sources" description="Inspect publication rights, collection receipts and the records available to company research."
      actions={<Link className="studio-secondary" to={operationsPath}>Operations overview</Link>}/>
    {!trusted ? <p>Open the local workstation address to manage source publication.</p> : !credential ? <form className="ops-credential" onSubmit={event => {
      event.preventDefault(); const form = event.currentTarget; const value = String(new FormData(form).get('credential') ?? '').trim(); form.reset(); setCredential(value);
    }}><label>Workstation operator credential<input type="password" name="credential" autoComplete="off" required minLength={24}/></label><button>Inspect market sources</button></form>
      : result.state === 'loading' ? <Loading>Checking market sources…</Loading> : result.state === 'error'
        ? <><RequestProblem resource="market sources" error={result.error} retry={retry}/>{!getOperatorCredential() && <button onClick={() => setCredential('')}>Use another credential</button>}</>
        : <><Panel title="Publication register" actions={<button onClick={refresh} disabled={refreshing}>Check status</button>}>
          {result.data.items.length ? <div className="studio-table-scroll" tabIndex={0} role="region" aria-label="Market source register"><table className="studio-table studio-panel-table">
            <thead><tr>{['Source','Publication','Creators','Published records'].map(item => <th key={item} scope="col">{item}</th>)}</tr></thead>
            <tbody>{result.data.items.map(source => <tr key={source.key}><th scope="row"><button className="ops-source-choice"
              aria-pressed={selected && selected.key === source.key} onClick={() => setChoice(source.key)}>{source.name}</button></th>
              <td>{displayState(source.publication)}</td><td>{source.creator_count}</td><td>{source.visible_count}</td></tr>)}</tbody></table></div>
            : <p className="studio-panel-body">No market feeds are configured. <Link to="/operations/public-directory">Manage public directory sources</Link>.</p>}
        </Panel>{selected && <SourceDetail key={selected.key} source={selected} credential={credential} changed={refresh}/>}</>}
  </div>;
}
