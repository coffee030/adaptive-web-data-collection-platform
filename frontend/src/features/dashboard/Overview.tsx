import { Link } from 'react-router';
import { Loading, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { jobPath, jobsPath, listJobs } from '../collection-jobs/api';
import { listRecords, recordPath, recordsPath } from '../results/api';
import { clip, PayloadPreview, recordTitleFields } from '../results/presentation';
import { listSources, sourcesPath } from '../sources/api';
import { newRequestPath } from '../topic-collections/api';

const jobLimit = 5;
const recordLimit = 4;
const recentJobs = (signal: AbortSignal) => listJobs(jobLimit, 0, '', signal, 'newest');
const recentRecords = (signal: AbortSignal) => listRecords('', recordLimit, 0, signal, { order: 'newest' });

const workflow = [
  ['Collect', 'Choose a topic and search its approved sources.'],
  ['Validate', 'Check field values and identify invalid rows and duplicates.'],
  ['Trace', 'Follow each record back to its job, profile version and capture evidence.'],
  ['Use', 'Explore validated records and article history.'],
] as const;

export function Overview() {
  const jobs = useResource(recentJobs);
  const records = useResource(recentRecords);
  const sources = useResource(listSources);
  const names = new Map(sources.result.state === 'ready'
    ? sources.result.data.map(source => [source.source_id.replaceAll('-', '').toLowerCase(), source.source_name])
    : []);
  const latest = jobs.result.state === 'ready' ? jobs.result.data.slice(0, jobLimit) : [];
  const summary = latest.reduce((counts, job) => ({
    accepted: counts.accepted + job.valid_count,
    invalid: counts.invalid + job.invalid_count,
    duplicates: counts.duplicates + job.duplicate_count,
  }), { accepted: 0, invalid: 0, duplicates: 0 });

  return <div className="dashboard">
    <section className="dashboard-intro" aria-labelledby="dashboard-title">
      <div>
        <h1 id="dashboard-title">Data Collection Overview</h1>
        <p>Collect structured information from approved sources, validate data quality, and explore traceable results.</p>
        <Link className="control dashboard-action" to={newRequestPath}>Collect by topic</Link>
      </div>
      <ol className="workflow" aria-label="Platform workflow">
        {workflow.map(([title, description]) => <li key={title}>
          <strong>{title}</strong><span>{description}</span>
        </li>)}
      </ol>
    </section>
    {latest.length > 0 && <section className="panel activity-summary" aria-labelledby="activity-title">
      <div>
        <h2 id="activity-title">Recent activity</h2>
        <p className="muted">Results from the latest {latest.length} submitted {latest.length === 1 ? 'job' : 'jobs'}.</p>
      </div>
      <dl>
        <div><dt>Accepted</dt><dd data-quality="accepted">{summary.accepted}</dd></div>
        <div><dt>Invalid</dt><dd data-quality="invalid">{summary.invalid}</dd></div>
        <div><dt>Duplicates</dt><dd>{summary.duplicates}</dd></div>
      </dl>
    </section>}
    <div className="dashboard-columns">
      <section className="panel" aria-labelledby="recent-jobs-title">
        <div className="panel-heading"><h2 id="recent-jobs-title">Recent collection jobs</h2><Link to={jobsPath}>All jobs</Link></div>
        {jobs.result.state === 'loading' && <Loading>Loading recent jobs…</Loading>}
        {jobs.result.state === 'error' && <RequestProblem error={jobs.result.error} resource="recent jobs" retry={jobs.retry} />}
        {jobs.result.state === 'ready' && (latest.length > 0 ? <>
          <p className="dashboard-list-note muted">Latest submissions · UTC</p>
          <ul className="dashboard-list">
            {latest.map(job => <li key={job.job_id}>
              <div>
                <Link to={jobPath(job.job_id)} className="dashboard-item-title">
                  {names.get(job.source_id.replaceAll('-', '').toLowerCase()) ?? 'Source ' + job.source_id.slice(0, 8)}
                  <span className="sr-only">, open job {job.job_id}</span>
                </Link>
                <p className="muted">{job.valid_count} accepted · {job.invalid_count} invalid · {job.duplicate_count} {job.duplicate_count === 1 ? 'duplicate' : 'duplicates'}</p>
              </div>
              <div className="dashboard-item-meta"><Status value={job.status} /><Timestamp value={job.created_at} /></div>
            </li>)}
          </ul>
        </> : <div className="notice">
          <strong>No collections yet</strong>
          <p>Register a source and confirm its access policy. Then validate and approve a profile to run your first collection.</p>
          <Link to={sourcesPath}>Manage sources</Link>
        </div>)}
      </section>
      <section className="panel" aria-labelledby="recent-records-title">
        <div className="panel-heading"><h2 id="recent-records-title">Recent accepted records</h2><Link to={recordsPath}>Data Explorer</Link></div>
        {records.result.state === 'loading' && <Loading>Loading recent records…</Loading>}
        {records.result.state === 'error' && <RequestProblem error={records.result.error} resource="recent records" retry={records.retry} />}
        {records.result.state === 'ready' && (records.result.data.length > 0 ? <>
          <p className="dashboard-list-note muted">Latest persisted records · UTC</p>
          <ul className="dashboard-list">
            {records.result.data.slice(0, recordLimit).map(record => {
              const titleField = recordTitleFields.find(field => {
                const value = record.payload[field];
                return typeof value === 'string' && value.trim();
              });
              const title = titleField ? clip(String(record.payload[titleField]), 100) : record.record_type;
              return <li key={record.record_id}>
                <div>
                  <Link to={recordPath(record.record_id)} className="dashboard-item-title">
                    {title}<span className="sr-only">, open record {record.record_id}</span>
                  </Link>
                  {titleField && <p className="muted">{record.record_type}</p>}
                  {Object.keys(record.payload).some(field => field !== titleField) &&
                    <PayloadPreview payload={record.payload} omit={titleField} />}
                </div>
                <div className="dashboard-item-meta"><Timestamp value={record.created_at} /></div>
              </li>;
            })}
          </ul>
        </> : <div className="notice">
          <strong>No accepted records yet</strong>
          <p>Accepted records appear after a collection job publishes validated results.</p>
        </div>)}
      </section>
    </div>
  </div>;
}
