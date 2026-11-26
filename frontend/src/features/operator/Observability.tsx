import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { MetricStrip, Panel } from '../../components/studio/Workspace';
import { Loading, RequestProblem } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath, jobsPath } from '../collection-jobs/api';
import { sourcesPath } from '../sources/api';

type Window = '24h' | '7d';
interface Quality { accepted: number; quarantined: number; duplicates: number }
interface Bucket extends Quality { starts_at: string; completed: number }
interface Source extends Quality {
  source_id: string; name: string; completed: number; failed: number; partial: number; last_job: string; last_finished: string;
}
interface Pulse {
  observed_at: string; starts_at: string; workers_observed: number;
  queue: { pending: number; running: number; retrying: number; dispatch_errors: number; expired_leases: number; oldest_pending: string | null };
  totals: Quality & { completed: number; failed: number; partial: number; p50_seconds: number | null; p95_seconds: number | null };
  sources: Source[]; series: Bucket[];
}

const number = new Intl.NumberFormat('en-HK', { maximumFractionDigits: 1 });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Hong_Kong' });
const day = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Hong_Kong' });
function moment(value: string) { const instant = new Date(value); return day.format(instant) + ', ' + clock.format(instant) + ' HKT'; }
function duration(seconds: number | null) {
  if (seconds === null) return '—';
  if (seconds < 1) return Math.round(seconds * 1000) + ' ms';
  if (seconds < 60) return number.format(seconds) + ' s';
  return number.format(seconds / 60) + ' min';
}

function Throughput({ rows, period }: { rows: Bucket[]; period: Window }) {
  const [metric, setMetric] = useState<'records' | 'jobs'>('records');
  const records = metric === 'records';
  const total = (row: Bucket) => records ? row.accepted + row.quarantined + row.duplicates : row.completed;
  const peak = Math.max(...rows.map(total));
  const label = (value: string) => (period === '24h' ? clock : day).format(new Date(value));
  const labelAt = (index: number) => index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2);
  const anyJobs = rows.some(row => row.completed > 0);
  return <Panel title="Collection throughput" description={period === '24h' ? 'Two-hour intervals · Hong Kong time' : 'Daily intervals · Hong Kong time'}
    actions={<label className="ops-metric-select"><span className="sr-only">Throughput measure</span>
      <select value={metric} onChange={event => setMetric(event.target.value === 'jobs' ? 'jobs' : 'records')}>
        <option value="records">Records</option><option value="jobs">Finished jobs</option>
      </select></label>}>
    <div className="studio-panel-body ops-throughput">
      {peak > 0 ? <>
        <div className="ops-chart" role="img" aria-label={`Peak ${number.format(peak)} ${records ? 'records' : 'jobs'} in one interval. Exact interval values follow in the data table.`}>
          <div className="ops-chart-scale"><span>{number.format(peak)}</span><span>0</span></div>
          <div className="ops-chart-plot">{rows.map(row => <div className="ops-chart-column" key={row.starts_at}
            title={moment(row.starts_at) + ' · ' + total(row) + (records ? ' records' : ' jobs')}>
            {records ? <>{(['duplicates','quarantined','accepted'] as const).map(key =>
              <i key={key} data-series={key} style={{height: row[key] / peak * 100 + '%'}}/>)}</>
              : <i data-series="jobs" style={{height: row.completed / peak * 100 + '%'}}/>}</div>)}</div>
          <div className="ops-chart-axis">{rows.map((row,index) => <span key={row.starts_at}>{labelAt(index) && label(row.starts_at)}</span>)}</div>
        </div>
        <ul className="ops-chart-legend" aria-label="Chart legend">{(records ? ['Accepted','Quarantined','Duplicates'] : ['Jobs']).map(name =>
          <li key={name}><i data-series={name.toLowerCase()}/>{name}</li>)}</ul>
      </> : <div className="ops-chart-empty"><strong>{anyJobs ? 'No records in completed jobs' : 'No completed jobs in this period'}</strong>
        <p>{anyJobs ? 'Inspect the latest attempt for each source.' : 'Newly finished jobs will appear in this chart.'}</p>
        <Link to={jobsPath}>Inspect collection jobs</Link></div>}
      <details className="ops-data-details"><summary>View interval data</summary><div className="studio-table-scroll" role="region" aria-label="Interval data" tabIndex={0}>
        <table className="studio-table"><thead><tr>{['Interval starts (HKT)','Jobs','Accepted','Quarantined','Duplicates'].map(x => <th scope="col" key={x}>{x}</th>)}</tr></thead>
          <tbody>{rows.map(row => <tr key={row.starts_at}><th scope="row">{moment(row.starts_at)}</th><td>{row.completed}</td><td>{row.accepted}</td><td>{row.quarantined}</td><td>{row.duplicates}</td></tr>)}</tbody></table>
        </div></details>
    </div>
  </Panel>;
}

function SourceHealth({ sources }: { sources: Source[] }) {
  return <Panel title="Source health" description="Up to 12 recently active sources. Failed and partial jobs appear first."
    actions={<Link to={sourcesPath}>All sources</Link>}>
    {sources.length ? <div className="studio-table-scroll" tabIndex={0} role="region" aria-label="Source health results"><table className="studio-table studio-panel-table studio-table-middle">
      <thead><tr>{['Source','Finished jobs','Quality','Accepted','Latest completion'].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
      <tbody>{sources.map(row => <tr key={row.source_id}>
        <th scope="row"><Link to={sourcesPath + '/' + row.source_id}>{row.name}</Link></th><td>{row.completed}</td>
        <td><span className="ops-state" data-issue={row.failed + row.partial > 0}>{row.failed || row.partial ? [row.failed && row.failed + ' failed',row.partial && row.partial + ' partial'].filter(Boolean).join(' · ') : 'Succeeded'}</span></td>
        <td>{number.format(row.accepted)}{(row.quarantined > 0 || row.duplicates > 0) && <small>{row.quarantined} held · {row.duplicates} duplicates</small>}</td>
        <td><Link to={jobPath(row.last_job)} aria-label={moment(row.last_finished) + ' · Inspect latest job for ' + row.name}>{moment(row.last_finished)}</Link></td>
      </tr>)}</tbody></table></div> : <p className="studio-panel-body">No source has a completed job in this period. <Link to={sourcesPath}>Inspect configured sources</Link>.</p>}
  </Panel>;
}

export function Observability() {
  const [period,setPeriod] = useState<Window>('24h');
  const load = useCallback((signal: AbortSignal) => apiGet<Pulse>('/operations/pulse?window=' + period,signal),[period]);
  const { result, retry, refreshing, refreshError } = useResource(load,0,true,true,true);
  return <section className="ops-observability" aria-label="Collection monitoring">
    <div className="ops-timebar"><span role="status">{result.state === 'ready'
      ? (refreshError ? 'Refresh failed · Last observed ' : 'Observed ') + moment(result.data.observed_at) : 'Collection monitoring'}</span>
      <div><label><span className="sr-only">Observation period</span><select value={period} onChange={event => setPeriod(event.target.value === '7d' ? '7d' : '24h')}>
        <option value="24h">Last 24 hours</option><option value="7d">Last 7 days</option></select></label>
        <button type="button" onClick={retry} disabled={refreshing}>Refresh metrics</button></div>
    </div>
    {result.state === 'loading' ? <Loading>Reading collection metrics…</Loading> : result.state === 'error'
      ? <RequestProblem resource="collection metrics" error={result.error} retry={retry}/> : <>
        <MetricStrip items={[
          {label:'Completed jobs',value:number.format(result.data.totals.completed),note:number.format(result.data.totals.completed / (period === '24h' ? 24 : 168)) + ' per hour'},
          {label:'Accepted records',value:number.format(result.data.totals.accepted),note:number.format(result.data.totals.quarantined) + ' held · ' + number.format(result.data.totals.duplicates) + ' duplicates'},
          {label:'Median run time',value:duration(result.data.totals.p50_seconds),note:result.data.totals.p95_seconds === null ? 'No finished attempts' : '95th percentile · ' + duration(result.data.totals.p95_seconds)},
          {label:'Workers observed',value:number.format(result.data.workers_observed),note:'Distinct workers claiming jobs'},
        ]}/>
        <div className="ops-monitor-grid">
          <Throughput rows={result.data.series} period={period}/>
          <Panel title="Queue now" description="Current jobs across all sources" actions={<Link to={jobsPath}>Inspect jobs</Link>}>
            <dl className="ops-queue-list">
              <div><dt><Link to={jobsPath + '?status=running'}>Running</Link></dt><dd>{result.data.queue.running}</dd></div>
              <div><dt><Link to={jobsPath + '?status=pending'}>Pending</Link></dt><dd>{result.data.queue.pending}</dd></div>
              <div><dt>Waiting to retry</dt><dd>{result.data.queue.retrying}</dd></div>
              <div><dt>Dispatch errors</dt><dd data-issue={result.data.queue.dispatch_errors > 0}>{result.data.queue.dispatch_errors}</dd></div>
              <div><dt>Expired worker leases</dt><dd data-issue={result.data.queue.expired_leases > 0}>{result.data.queue.expired_leases}</dd></div>
            </dl>
            {result.data.queue.oldest_pending && <p className="ops-queue-age">Oldest pending job · {moment(result.data.queue.oldest_pending)}</p>}
          </Panel>
        </div>
        <SourceHealth sources={result.data.sources}/>
        <details className="ops-measure-definitions"><summary>How these metrics are counted</summary>
          <p>Completed jobs include successful, partial and failed runs. Run time starts at the final execution attempt and ends at completion.</p>
          <p>Accepted records count each collection. Repeated collections can include the same published work. Workers observed counts distinct workers with a recorded job claim during the selected period.</p>
        </details>
      </>}
  </section>;
}
