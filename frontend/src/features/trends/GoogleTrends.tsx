import { useEffect, useReducer, useRef, type FormEvent } from 'react';
import { Link, useNavigationType, useSearchParams } from 'react-router';
import { Loading, Timestamp } from '../../components/feedback';
import { apiPatch, apiPost } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath } from '../collection-jobs/api';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import { worldwideTrendsPath } from '../operator/OperationsTasks';
import { sourcePath } from '../sources/api';
import { ActionFeedback, Resource, useAction } from '../topic-collections/support';
import { getGoogleProvider, getMarketSchedules, googleActionError, googleBase, googleIssue, marketName, marketPath, type GoogleProvider, type MarketSchedule } from './google';
import { GoogleSnapshot } from './GoogleSnapshot';

const overview = worldwideTrendsPath + '?view=google';

function MarketField() {
  return <label>Market code<input name="region" type="text" defaultValue="HK" autoCapitalize="characters"
    spellCheck={false} required maxLength={2} pattern="[A-Za-z]{2}" title="Two-letter market code, such as HK" /></label>;
}

function IntervalField({ minutes }: { minutes: number }) {
  return <label>Interval (minutes)<input name="minutes" type="number" min={10} max={1440} step={1} required defaultValue={minutes} /></label>;
}

function SourceAccess({ provider, refresh }: { provider: GoogleProvider; refresh: () => void }) {
  const approve = useAction(googleActionError);
  const reviewSource = provider.source_approval_status === 'revoked' || provider.source_approval_status === 'pending' ? provider.source_id : null;
  const checkMapping = provider.source_approval_status === 'approved';
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isLocalOperator() || provider.blocked) return;
    const form = new FormData(event.currentTarget);
    void approve.run(signal => apiPost<GoogleProvider>(googleBase + '/provider', {
      region: String(form.get('region')).toUpperCase(), approver: String(form.get('approver')).trim(),
    }, signal, 45000).catch(cause => { refresh(); throw cause; }), refresh);
  }
  return <div className="trend-source">
    <div className="trend-actions"><strong>Google Trending Now RSS</strong>
      <span>{provider.authorized ? 'Approved source' : provider.source_id ? 'Approval inactive' : 'Awaiting approval'}</span>
      <button type="button" onClick={refresh}>Refresh status</button></div>
    {(provider.blocked || provider.last_error) && <p role="status">{googleIssue(provider.blocked ? 'publisher_access_blocked' : provider.last_error!)}</p>}
    {provider.retry_at && <div>Next permitted publisher check (UTC) <Timestamp value={provider.retry_at} /></div>}
    <details><summary>Source access and attribution</summary><div className="trend-actions">
      <a href={provider.policy}>Google Trends attribution ↗</a>
      {provider.source_id && <Link to={sourcePath(provider.source_id)}>Inspect Core source</Link>}
    </div></details>
    {reviewSource && <p>Core source approval is {provider.source_approval_status}. <Link to={sourcePath(reviewSource)}>Review authorization in Core Sources</Link></p>}
    {!provider.authorized && !provider.blocked && !reviewSource && (isLocalOperator() ? <form className="operator-review trend-fields" onSubmit={submit}>
      <h2>{checkMapping ? 'Verify the source mapping' : 'Approve the Google source'}</h2>
      <p>Review the publisher’s terms and attribution. Core checks the sample market when a verified mapping is needed.</p>
      <MarketField /><label>Approver name<input name="approver" required pattern=".*\S.*" maxLength={128} /></label>
      <label className="trend-choice"><input type="checkbox" required />I reviewed <a href="https://policies.google.com/terms">Google’s terms</a> and the <a href={provider.policy}>attribution requirements</a>.</label>
      <button type="submit" disabled={approve.busy}>{checkMapping ? 'Verify mapping' : 'Approve source'}</button><ActionFeedback action={approve} pending="Checking source approval…" />
    </form> : <p className="notice">{localOperatorHelp}</p>)}
  </div>;
}

function ScheduleOverview({ rows, provider, open }: { rows: MarketSchedule[]; provider: GoogleProvider; open: (market: string) => void }) {
  const create = useAction(googleActionError);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider.authorized || provider.blocked) return;
    const form = new FormData(event.currentTarget);
    void create.run(signal => apiPost<MarketSchedule>(googleBase + '/schedules', {
      region: String(form.get('region')).toUpperCase(), interval_minutes: Number(form.get('minutes')),
    }, signal), row => open(row.region));
  }
  return <section className="panel operator-sheet" aria-labelledby="google-markets">
    <div className="panel-heading"><h2 id="google-markets">Market schedules</h2></div>
    {rows.length ? <table className="operator-ledger"><caption className="sr-only">Google Trending Now regional schedules</caption>
      <thead><tr><th scope="col">Market</th><th scope="col">Collection</th><th scope="col">Last verified (UTC)</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.region}>
        <th scope="row"><Link to={overview + '&market=' + encodeURIComponent(row.region)} preventScrollReset>{marketName(row.region)}</Link></th>
        <td data-label="Collection">{row.active ? 'Scheduled' : 'Paused'}<small>Every {row.interval_minutes} minutes</small>
          {(row.pending_job || row.claimed_at) && <small>{row.pending_job ? 'Job underway' : 'Checking feed'}</small>}</td>
        <td data-label="Last verified (UTC)">{row.observed_at ? <Timestamp value={row.observed_at} /> : 'Awaiting first snapshot'}</td>
      </tr>)}</tbody></table> : <p className="trend-note">No markets scheduled. {provider.blocked ? 'Publisher access is stopped.'
        : provider.authorized ? 'Add a market to start recurring checks.' : 'Source approval is required before scheduling checks.'}</p>}
    {provider.authorized && !provider.blocked && <details className="operator-disclosure" open={!rows.length || undefined}>
      <summary>Add a market schedule</summary>
      <p>The first successful feed check verifies the two-letter market code. Choose an interval from 10 to 1,440 minutes.</p>
      <form className="trend-controls google-inline" onSubmit={submit}><MarketField /><IntervalField minutes={60} />
        <button type="submit" className="primary" disabled={create.busy}>Save schedule</button>
      </form><ActionFeedback action={create} pending="Saving schedule…" />
    </details>}
  </section>;
}

function MarketDetail({ row, provider, refresh, revision }: { row: MarketSchedule; provider: GoogleProvider; refresh: () => void; revision: number }) {
  const change = useAction(googleActionError, row.region);
  const heading = useRef<HTMLHeadingElement>(null);
  const navigation = useNavigationType();
  useEffect(() => {
    if (navigation === 'PUSH' && heading.current) {
      heading.current.focus({ preventScroll: true });
      heading.current.scrollIntoView({ block: 'start' });
    }
  }, [navigation, row.region]);
  function patch(fields: { active?: boolean; interval_minutes?: number }, confirmation: string) {
    void change.run(signal => apiPatch<MarketSchedule>(marketPath(row.region), fields, signal), refresh, confirmation);
  }
  return <>
    <Link className="google-back" to={overview}>← All market schedules</Link>
    <section className="operator-sheet panel" aria-labelledby="google-market-name">
      <div className="panel-heading"><h2 ref={heading} tabIndex={-1} id="google-market-name">{marketName(row.region)}</h2>
        <span>{row.active ? 'Active' : 'Paused'} · Every {row.interval_minutes} minutes</span></div>
      <div className="trend-body google-schedule-status">
        {row.pending_job ? <Link to={jobPath(row.pending_job)}>Inspect current collection job</Link>
          : row.claimed_at ? <span>Checking feed since (UTC) <Timestamp value={row.claimed_at} /></span>
          : row.active && row.due_at && !provider.blocked && provider.authorized ? <span>Next scheduled check (UTC) <Timestamp value={row.due_at} /></span>
          : <span>{row.active ? 'New checks are suspended.' : 'Scheduled checks are paused.'}</span>}
        <button type="button" disabled={change.busy || (!row.active && (provider.blocked || !provider.authorized))}
          onClick={() => patch({ active: !row.active }, row.active ? 'Schedule paused.' : 'Schedule resumed.')}>
          {row.active ? 'Pause schedule' : 'Resume schedule'}</button>
      </div>
      {row.last_error && <p className="trend-note" role="status">Last check · {googleIssue(row.last_error)}</p>}
      <details className="operator-disclosure"><summary>Schedule settings</summary>
        <form className="trend-controls google-inline" key={row.interval_minutes} onSubmit={event => {
          event.preventDefault();
          patch({ interval_minutes: Number(new FormData(event.currentTarget).get('minutes')) }, 'Interval updated.');
        }}><IntervalField minutes={row.interval_minutes} /><button type="submit" disabled={change.busy}>Update interval</button></form>
        {row.last_job && <Link to={jobPath(row.last_job)}>Inspect last collection job</Link>}
      </details>
      <div className="trend-feedback"><ActionFeedback action={change} pending="Updating schedule…" /></div>
    </section>
    {provider.authorized ? <GoogleSnapshot region={row.region} revision={revision} />
      : <p className="notice" role="status">Snapshot access requires active source approval.</p>}
  </>;
}

export function GoogleTrends() {
  const [params, setParams] = useSearchParams();
  const market = params.get('market');
  const [revision, refresh] = useReducer((value: number) => value + 1, 0);
  const source = useResource(getGoogleProvider, revision, true);
  const schedules = useResource(getMarketSchedules, revision, true);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
    return () => window.clearInterval(timer);
  }, []);
  return <Resource state={source} label="Google source status">{provider => <>
    <SourceAccess provider={provider} refresh={refresh} />
    <Resource state={schedules} label="market schedules">{rows => {
      if (!market) return <ScheduleOverview rows={rows} provider={provider} open={region => {
        refresh(); setParams({ view: 'google', market: region }, { preventScrollReset: true });
      }} />;
      const row = rows.find(item => item.region === market);
      if (row) return <MarketDetail key={row.region} row={row} revision={revision} provider={provider} refresh={refresh} />;
      return schedules.refreshing ? <Loading>Loading market schedule…</Loading> : <p className="notice">
        No saved schedule for this market. <Link to={overview}>Open market schedules</Link></p>;
    }}</Resource>
  </>}</Resource>;
}
