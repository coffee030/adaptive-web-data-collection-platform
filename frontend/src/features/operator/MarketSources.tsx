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
const refreshMessages: Record<string,string> = {
  current: 'The last observation is still current. No additional collection was queued.',
  backoff: 'The publisher has a waiting period. Check its next scheduled time below.',
  collecting: 'Collection is already in progress. Check the register for the receipt.',
  scheduled: 'Refresh scheduled. The next collection will produce a receipt.',
};
const sourceIssues: Record<string,string> = {
  publisher_access_blocked: 'The publisher declined access. Review its terms before reauthorizing.',
  publisher_rate_limited: 'The publisher asked Harbourline to wait until the next check.',
  publisher_schema_changed: 'The publisher changed its response. Review the source mapping.',
  publisher_unavailable: 'The publisher could not be reached. The next check is scheduled automatically.',
  publisher_scope_exceeds_limit: 'The response exceeded the permitted collection scope.',
  publisher_response_too_large: 'The response exceeded the permitted size.',
  publisher_cursor_stalled: 'The publisher repeated a page. Collection stopped to avoid duplicate requests.',
  operator_withdrawn: 'An operator withdrew authorization.',
};
interface Receipt { job_id: string; state: string; accepted: number; invalid: number; duplicates: number; finished_at: string }
interface Source {
  key: string; name: string; platform: string; rights_url: string; state: string; publication: string; observed_at: string | null;
  expires_at: string | null; next_check: string | null; pending: boolean; visible_count: number; creator_count: number;
  last_success: Receipt | null; last_attempt: Receipt | null; error: string | null;
  acquisition?: { requests: number; bytes: number; returned?: number } | null;
}
const displayState = (state: string) => state.replaceAll('_',' ');
const publicationCount = (source: Source) => source.visible_count + (source.visible_count === 1 ? ' record' : ' records')
  + ' · ' + source.creator_count + (source.creator_count === 1 ? ' creator' : ' creators');
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
      const result = await apiLocal<{state: string}>(endpoint + '/' + encodeURIComponent(source.key) + '/' + action,credential,request.signal,'POST');
      if (request.signal.aborted) return;
      setMessage(action === 'refresh' ? refreshMessages[result.state] ?? 'Source status updated. Check its collection schedule.'
        : action === 'withdraw' ? 'Source withdrawn.' : 'Source validated and authorized for scheduled collection.');
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
        <div><dt>Visible to companies</dt><dd>{publicationCount(source)}</dd></div>
        <div><dt>Last observation</dt><dd>{stamp(source.observed_at)}</dd></div>
        <div><dt>Expires</dt><dd>{stamp(source.expires_at)}</dd></div>
        <div><dt>Next check</dt><dd>{stamp(source.next_check)}</dd></div></dl>
      {source.error && <p className="ops-market-issue" role="status">{sourceIssues[source.error] ?? 'Inspect the last attempt and the next scheduled check.'}</p>}
      {receipt && <p>Latest collection · <Link to={jobPath(receipt.job_id)}>{displayState(receipt.state)}</Link>
        {' · '}{receipt.accepted} accepted · {receipt.invalid} held · {receipt.duplicates} duplicates</p>}
      {source.last_success && source.last_success.job_id !== receipt?.job_id && <p>Last successful collection · <Link to={jobPath(source.last_success.job_id)}>{stamp(source.last_success.finished_at)}</Link> · {source.last_success.accepted} accepted</p>}
      {source.acquisition && <details><summary>Publisher request receipt</summary><dl>
        <div><dt>HTTP requests</dt><dd>{source.acquisition.requests}</dd></div>
        <div><dt>Downloaded</dt><dd>{new Intl.NumberFormat('en-HK').format(source.acquisition.bytes)} bytes</dd></div>
        {source.acquisition.returned !== undefined && <div><dt>Returned records</dt><dd>{source.acquisition.returned}</dd></div>}
      </dl></details>}
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
  const details = useRef<HTMLDivElement>(null);
  const selectedTrigger = useRef<HTMLButtonElement>(null);
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
          {result.data.items.length ? <div className="studio-table-scroll" tabIndex={0} role="region" aria-label="Market source register"><table className="studio-table studio-panel-table ops-market-register">
            <thead><tr>{['Source','Publication','Creators','Published records'].map(item => <th key={item} scope="col">{item}</th>)}</tr></thead>
            <tbody>{result.data.items.map(source => <tr key={source.key} data-selected={Boolean(selected && selected.key === source.key)}><th scope="row"><button className="ops-source-choice"
              ref={selected && selected.key === source.key ? selectedTrigger : undefined} aria-controls="market-source-detail"
              aria-pressed={selected && selected.key === source.key} onClick={() => {
                setChoice(source.key); requestAnimationFrame(() => details.current?.focus());
              }}>{source.name}</button><small className="ops-source-counts">{publicationCount(source)}</small></th>
              <td>{displayState(source.publication)}</td><td>{source.creator_count}</td><td>{source.visible_count}</td></tr>)}</tbody></table></div>
            : <p className="studio-panel-body">No market feeds are configured. <Link to="/operations/public-directory">Manage public directory sources</Link>.</p>}
        </Panel>{selected && <div className="ops-selected-source" id="market-source-detail" role="group" aria-label="Source details" tabIndex={-1} ref={details}>
          <SourceDetail key={selected.key} source={selected} credential={credential} changed={refresh}/>
          <button className="studio-secondary" onClick={() => selectedTrigger.current?.focus()}>Back to source register</button>
        </div>}</>}
  </div>;
}
