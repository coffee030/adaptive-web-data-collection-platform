import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loading, RequestProblem, Status, TableRegion, Timestamp } from '../../components/feedback';
import { ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { getMarketingCapability } from '../marketing/api';
import { operationsPath } from './OperationsTasks';
import { channelPattern, researchClient, type Discovery, type ResearchAccount, type ResearchMetric, type ResearchRun } from './researchApi';

const active = (run: ResearchRun) => run.status === 'queued' || run.status === 'running';
const denied = (error: ApiError) => error.status === 403 || error.code === 'research_disabled';
const metricText = (metric: ResearchMetric) => metric.status === 'available' ? metric.value.toLocaleString('en-HK') : metric.status;
const fresh = (date: string, now: number) => Date.parse(date) > now;
const channelLink = (id: string) => 'https://www.youtube.com/channel/' + encodeURIComponent(id);
const videoLink = (id: string) => 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);

function issue(error: ApiError) {
  switch (error.code) {
    case 'operator_required': return 'Operator access denied. Check the token and try again.';
    case 'research_disabled': return 'Research or discovery is disabled on this deployment.';
    case 'account_not_found': return 'This channel has no research watch. Create a watch if its use is authorised.';
    case 'account_withdrawn': return 'This channel was withdrawn from the deployment.';
    case 'watch_limit': return 'The research watch limit has been reached.';
    case 'discovery_queue_full': return 'The discovery queue is full. Try again after the waiting work completes.';
  }
  if (error.status === 403) return 'This action is restricted by the API.';
  if (error.kind === 'timeout') return 'The request timed out. Check the latest status before repeating the action.';
  if (error.kind === 'network' || (error.status ?? 0) >= 500) return 'The research service is unavailable. Check the API connection and try again.';
  return 'The research action could not be completed. Check the input and try again.';
}

function ResearchSession({ token, clear }: { token: string; clear: () => void }) {
  const client = useMemo(() => researchClient(token), [token]);
  const [channel, setChannel] = useState('');
  const [hours, setHours] = useState('24');
  const [account, setAccount] = useState<ResearchAccount>();
  const [run, setRun] = useState<ResearchRun>();
  const [discovery, setDiscovery] = useState<Discovery>();
  const [error, setError] = useState<ApiError>();
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState(false);
  const [pollFailed, setPollFailed] = useState(false);
  const [refreshChannel, setRefreshChannel] = useState('');
  const [now, setNow] = useState(Date.now);
  const request = useRef<AbortController>(undefined);

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    const dates = [account?.snapshot?.provenance.expires_at, ...account?.posts.map(post => post.provenance.expires_at) ?? [],
      ...discovery?.leads.map(lead => lead.provenance.expires_at) ?? []];
    const next = dates.map(date => Date.parse(date ?? '')).filter(time => time > now).sort((a,b) => a-b)[0];
    if (next === undefined) return;
    const timer = window.setTimeout(() => setNow(Date.now()), Math.min(2000000000, Math.max(0, next - Date.now())));
    return () => window.clearTimeout(timer);
  }, [account, discovery, now]);

  useEffect(() => {
    if (!run || !active(run) || pending || pollFailed) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const current = await client.readRun(run.id, controller.signal);
        if (!active(current)) {
          if (current.kind === 'discovery') setDiscovery(await client.readDiscovery(current.id, controller.signal));
          else if (refreshChannel) setAccount(await client.read(refreshChannel, controller.signal));
        }
        if (!controller.signal.aborted) {
          setRun(current);
          setNow(Date.now());
        }
      } catch (problem) {
        if (!controller.signal.aborted) {
          const failure = problem instanceof ApiError ? problem : new ApiError('invalid-response');
          if (denied(failure)) {
            setAccount(undefined); setRun(undefined); setDiscovery(undefined);
          } else setPollFailed(true);
          setError(failure);
        }
      }
    }, 1800);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [client, run, pending, pollFailed, refreshChannel]);

  async function act(action: (signal: AbortSignal) => Promise<void>) {
    if (request.current && !request.current.signal.aborted) return;
    const controller = new AbortController();
    request.current = controller;
    setPending(true); setError(undefined); setNotice('');
    try { await action(controller.signal); }
    catch (problem) {
      if (!controller.signal.aborted) {
        const failure = problem instanceof ApiError ? problem : new ApiError('invalid-response');
        if (denied(failure)) {
          setAccount(undefined); setRun(undefined); setDiscovery(undefined); setPollFailed(false);
        }
        setError(failure);
      }
    } finally {
      if (!controller.signal.aborted) {
        request.current = undefined;
        setPending(false);
        setNow(Date.now());
      }
    }
  }

  function watch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = channel.trim();
    const operation = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
    void act(async signal => {
      const value = operation === 'watch' ? await client.watch(id,Number(hours),signal) : await client.read(id,signal);
      setAccount(value);
      setRun(value.last_run ?? undefined);
      setRefreshChannel(value.channel_id);
      setDiscovery(undefined);
      setPollFailed(false);
      if (operation === 'watch') setNotice('Research watch saved.');
    });
  }
  const snapshot = account?.snapshot && fresh(account.snapshot.provenance.expires_at, now) ? account.snapshot : null;
  const posts = snapshot ? account?.posts.filter(post => fresh(post.provenance.expires_at, now)) ?? [] : [];
  const accountState = account?.state === 'available' && !snapshot ? 'expired' : account?.state;
  const leads = discovery?.leads.filter(lead => fresh(lead.provenance.expires_at, now)) ?? [];

  return <div className="operator-research-session">
    <div className="operator-research-toolbar"><strong>Local research session</strong><button type="button" onClick={clear}>Clear operator token</button></div>
    <form className="operator-research-form" onSubmit={watch}>
      <label>YouTube channel ID<input value={channel} onChange={event => setChannel(event.target.value)}
        required pattern={channelPattern.replace('-', '\\-')} placeholder="UC…" autoComplete="off" /></label>
      <label>Refresh interval (hours)<input type="number" min={6} max={168} required value={hours} onChange={event => setHours(event.target.value)} /></label>
      <div><button type="submit" value="read" disabled={pending}>Inspect watch</button><button type="submit" value="watch" disabled={pending}>Save watch</button></div>
    </form>
    <form className="operator-research-form" onSubmit={event => {
      event.preventDefault();
      const query = String(new FormData(event.currentTarget).get('query') ?? '').trim();
      if (query.length < 2) return;
      void act(async signal => {
        const current = await client.discover(query,signal);
        setRun(current); setPollFailed(false); setDiscovery(undefined);
        if (!active(current)) setDiscovery(await client.readDiscovery(current.id,signal));
      });
    }}>
      <label>Approved research query<input name="query" required minLength={2} maxLength={100} /></label>
      <div><button type="submit" disabled={pending}>Find research leads</button></div>
    </form>
    {pending && <Loading>Contacting research service…</Loading>}
    {notice && <p role="status" className="notice">{notice}</p>}
    {error && <div role="alert" className="notice request-problem"><p>{issue(error)}{error.code && <> · <code>{error.code}</code></>}</p>
      {pollFailed && <button type="button" onClick={() => { setError(undefined); setPollFailed(false); }}>Retry run status</button>}</div>}
    {run && <section className="operator-research-result" aria-label="Research run">
      <h2>{run.kind === 'refresh' ? 'Channel refresh' : 'Lead discovery'}</h2>
      <p role="status"><Status value={run.status} />{run.error_code && <> · <code>{run.error_code}</code></>}</p>
      <p className="muted">{run.attempts} attempts · {run.standard_units} standard units · {run.search_calls} search calls</p>
      {run.available_after && <p>Available after (UTC) <Timestamp value={run.available_after} /></p>}
    </section>}
    {discovery && <section className="operator-research-result"><h2>YouTube research leads</h2>
      <p>Discovery status · {discovery.state === 'available' && discovery.leads.length > 0 && !leads.length ? 'expired' : discovery.state}</p>
      {leads.length > 0 ? <ul>{leads.map(lead => <li key={lead.channel_id}><a href={channelLink(lead.channel_id)}>{lead.title}</a>{' '}
        <button type="button" onClick={() => setChannel(lead.channel_id)}>Use channel ID</button></li>)}</ul>
        : discovery.state === 'available' && !discovery.leads.length && <p>No current research leads were returned.</p>}
    </section>}
    {account && <section className="operator-research-result" aria-label="Research account">
      <h2>{snapshot?.title ?? 'Channel watch'}</h2><p><a href={channelLink(account.channel_id)}>{account.channel_id}</a> · <Status value={accountState ?? 'unavailable'} /></p>
      <p>Next refresh (UTC) <Timestamp value={account.next_refresh_at} /></p>
      {accountState !== 'withdrawn' && <div className="operator-research-toolbar">
        <button type="button" disabled={pending} onClick={() => void act(async signal => {
          const current = await client.refresh(account.channel_id,signal);
          setRefreshChannel(account.channel_id); setRun(current); setPollFailed(false); setDiscovery(undefined);
          if (!active(current)) setAccount(await client.read(account.channel_id,signal));
        })}>Request refresh</button>
        <button type="button" disabled={pending} onClick={() => {
          if (window.confirm('Withdraw this channel and remove its local research data? This also prevents reacquisition.')) {
            void act(async signal => {
              await client.withdraw(account.channel_id,signal);
              setAccount(undefined); setRun(undefined); setDiscovery(undefined); setNotice('Channel withdrawn from local research.');
            });
          }
        }}>Withdraw channel</button></div>}
      {snapshot && <>
        <p>Subscribers · {metricText(snapshot.subscribers)}</p><p>Observed (UTC) <Timestamp value={snapshot.provenance.observed_at} /> · Expires (UTC) <Timestamp value={snapshot.provenance.expires_at} /></p>
        {account.scan_truncated && <p>Partial coverage. The scan reached its configured limit.</p>}
        {posts.length > 0 && <TableRegion label="Current YouTube research posts"><table><thead><tr><th scope="col">Video</th><th scope="col">Published (UTC)</th><th scope="col">Views</th><th scope="col">Likes</th><th scope="col">Comments</th></tr></thead>
          <tbody>{posts.map(post => <tr key={post.video_id}><th scope="row"><a href={videoLink(post.video_id)}>{post.title}</a></th><td><Timestamp value={post.published_at} /></td>
            <td>{metricText(post.views)}</td><td>{metricText(post.likes)}</td><td>{metricText(post.comments)}</td></tr>)}</tbody></table></TableRegion>}
        {!posts.length && <p>No current videos are available for this snapshot.</p>}
      </>}
    </section>}
    <details className="operator-research-result"><summary>Provider access recovery</summary><p>Confirm that publisher access has been restored before clearing an explicit access block.</p>
      <button type="button" disabled={pending} onClick={() => {
        if (window.confirm('Confirm that publisher access has been restored. Resume authorised research?')) {
          void act(async signal => { await client.resume(signal); setNotice('Provider block cleared. Existing cooldowns and quota limits still apply.'); });
        }
      }}>Review and resume provider</button></details>
  </div>;
}

export function CreatorResearch() {
  const [token, setToken] = useState('');
  const { result, retry } = useResource(getMarketingCapability);
  const loopback = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';
  return <div className="operator-research">
    <p className="breadcrumb"><Link to={operationsPath}>Data Operations</Link></p>
    <header className="page-heading"><h1>Creator research and refresh</h1>
      <p>Manage approved YouTube research watches, discovery and refresh activity.</p></header>
    <section className="operator-research-result" aria-label="Provider permissions">
      {result.state === 'loading' ? <Loading>Checking research permissions…</Loading>
        : result.state === 'error' ? <RequestProblem error={result.error} retry={retry} resource="research permission status" />
        : <><h2>YouTube permission status</h2><p>Approved research only · Additional permission pending · {result.data.retention_days}-day snapshot retention</p></>}
    </section>
    {!loopback ? <p className="notice">Open Data Operations on 127.0.0.1 to use a local marketing operator token.</p>
      : token ? <ResearchSession token={token} clear={() => setToken('')} />
      : <form className="operator-research-form operator-token" onSubmit={event => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get('token') ?? '').trim();
        if (value.length >= 24 && /^[\x21-\x7e]+$/.test(value)) {
          event.currentTarget.reset(); setToken(value);
        }
      }}>
        <label>Marketing operator token<input name="token" type="password" autoComplete="off" required minLength={24} maxLength={512}
          pattern="[!-~]+" /></label><div><button type="submit">Open research controls</button></div>
        <p className="muted">Use your configured local operator token. It is held only for this page session.</p>
      </form>}
  </div>;
}