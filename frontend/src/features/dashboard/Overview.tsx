import { OperationsTasks } from '../operator/OperationsTasks';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { jobInProgress, jobPath, jobsPath, listJobs, type JobStatus } from '../collection-jobs/api';
import { listRecords, recordPath, recordsForRequest, recordsPath } from '../results/api';
import { clip, recordTitleFields } from '../results/presentation';
import { listSources, sourcesPath } from '../sources/api';
import {
  bindingsPath, listPage, newRequestPath, requestPath, requestsPath, topicsPath,
  type Binding, type CollectionRequest, type Topic,
} from '../topic-collections/api';
import { Resource } from '../topic-collections/support';

const topicLimit = 6;
const requestLimit = 5;
const jobLimit = 5;
const recordLimit = 4;

async function loadTopics(signal: AbortSignal) {
  const topics = await listPage<Topic>(topicsPath, signal, topicLimit + 1, 0, { active_only: 'true' });
  const preview = await Promise.all(topics.slice(0, topicLimit).map(async topic => {
    const bindings = await listPage<Binding>(bindingsPath(topic.id), signal, 1, 0, { eligible_only: 'true' });
    return { topic, eligible: bindings.some(binding => binding.eligible) };
  }));
  return { preview, more: topics.length > topicLimit };
}

const recentRequests = (signal: AbortSignal) => listPage<CollectionRequest>(requestsPath, signal, requestLimit, 0);
const recentJobs = (signal: AbortSignal) => listJobs(jobLimit, 0, '', signal, 'newest');
const recentRecords = (signal: AbortSignal) => listRecords('', recordLimit, 0, signal, { order: 'newest' });
const liveStatuses = ['running', 'pending'] as const;
const loadLiveStates = async (signal: AbortSignal) => {
  const results = await Promise.all(liveStatuses.map(status => listJobs(1, 0, status, signal, 'newest')));
  return liveStatuses.filter((_, index) => results[index]?.length);
};
const jobsWithStatus = (status: JobStatus) => `${jobsPath}?status=${status}`;

function OverviewResource<T>({ state, label, heading, children }: {
  state: ReturnType<typeof useResource<T>>;
  label: string;
  heading: string;
  children: (data: T) => ReactNode;
}) {
  const retry = () => {
    document.getElementById(heading)?.focus();
    state.retry();
  };
  return <Resource label={label} state={{ ...state, retry }}>{children}</Resource>;
}

function TopicDirectory() {
  const topics = useResource(loadTopics);
  const needsSetup = topics.result.state === 'ready' && !topics.result.data.more
    && topics.result.data.preview.every(row => !row.eligible);
  return <section className="topic-directory" aria-labelledby="collect-title">
    <div className="overview-section-heading">
      <h2 id="collect-title" tabIndex={-1}>Collect by topic</h2>
      {needsSetup
        ? <Link className="control primary" to={sourcesPath}>Manage sources</Link>
        : <Link className="control primary" to={newRequestPath}>New Collection</Link>}
    </div>
    <OverviewResource label="collection topics" heading="collect-title" state={topics}>{({ preview, more }) => {
      if (needsSetup) {
        return <div className="collection-setup">
          <p><strong>No eligible topics yet</strong></p>
          <p>Authorize a source, validate and approve its profile, then bind the approved version to an active topic.</p>
          <div><Link to={topicsPath}>Set up topics &amp; bindings</Link></div>
        </div>;
      }

      return <>
        <ul className="topic-index" role="list">
          {preview.map(({ topic, eligible }) => <li key={topic.id}>
            {eligible
              ? <Link to={newRequestPath + '?' + new URLSearchParams({ topic_id: topic.id })}>
                  <span>{topic.name}</span>
                  <span className="topic-arrow" aria-hidden="true">→</span>
                </Link>
              : <div className="unavailable-topic">
                  <span>{topic.name}<small>No eligible sources</small></span>
                </div>}
          </li>)}
        </ul>
        {more && <p className="topic-index-note muted">Showing the first {topicLimit} active topics.{' '}
          <Link to={newRequestPath}>Browse all in New Collection</Link>
        </p>}
      </>;
    }}</OverviewResource>
  </section>;
}

const jobCountLabel = (count: number) => `${count} ${count === 1 ? 'job' : 'jobs'}`;

function RequestRow({ request }: { request: CollectionRequest }) {
  const failed = request.jobs.filter(({ job }) => job.status === 'failed').length;
  const partial = request.jobs.filter(({ job }) => job.status === 'partial').length;
  const active = request.jobs.filter(({ job }) => jobInProgress(job.status)).length;
  const paused = request.jobs.filter(({ job }) => job.status === 'paused').length;
  const accepted = request.jobs.reduce((total, { job }) => total + job.valid_count, 0);
  const jobLabel = [
    jobCountLabel(request.jobs.length),
    active ? `${active} active` : '',
    paused ? `${paused} paused` : '',
    partial ? `${partial} partial` : '',
    failed ? `${failed} failed` : '',
  ].filter(Boolean).join(' · ');

  return <li className="request-ledger-row" data-outcome={request.status}>
    <div className="request-ledger-name">
      <Link to={requestPath(request.id)}>{request.topic_name}<span className="sr-only"> · {request.keyword}</span></Link>
      <p className="muted">{request.keyword}</p>
    </div>
    <div className="request-ledger-state">
      <Status value={request.status} />
      <p className="muted">{jobLabel}</p>
    </div>
    <div className="request-ledger-time"><span className="sr-only">Submitted (UTC) </span><Timestamp value={request.created_at} /></div>
    <div className="request-ledger-result">
      {accepted > 0
        ? <Link to={recordsForRequest(request.id)}>{accepted} {accepted === 1 ? 'record' : 'records'}
            <span className="sr-only"> for {request.topic_name} · {request.keyword}</span>
          </Link>
        : <span className="muted">0 records</span>}
    </div>
  </li>;
}

export function Overview() {
  const [revision, setRevision] = useState(0);
  const requests = useResource(recentRequests, revision, true);
  const jobs = useResource(recentJobs, revision, true);
  const liveStates = useResource(loadLiveStates, revision, true);
  const records = useResource(recentRecords, revision, true);
  const sources = useResource(listSources, revision, true);
  const refreshing = [requests, jobs, liveStates, records, sources].some(resource => resource.refreshing);
  const names = new Map(sources.result.state === 'ready'
    ? sources.result.data.map(source => [source.source_id.replaceAll('-', '').toLowerCase(), source.source_name])
    : []);

  return <div className="collection-overview">
    <header className="overview-title">
      <h1>Data Collection Overview</h1>
    </header>
    <OperationsTasks />
    <TopicDirectory />
    <section className="collection-activity" aria-labelledby="request-ledger-title">
      <div className="overview-section-heading">
        <h2 id="request-ledger-title" tabIndex={-1}>Recent collection requests</h2>
        <div className="request-actions">
          <Link to={requestsPath}>View all requests</Link>
          <button type="button" aria-disabled={refreshing} onClick={() => {
            if (!refreshing) setRevision(value => value + 1);
          }}>Refresh activity</button>
        </div>
      </div>
      <div className="live-job-states">
        <OverviewResource label="active job states" heading="request-ledger-title" state={liveStates}>{states => states.length
          ? <ul className="active-job-list" role="list">
              {states.map(status => <li key={status}><Link to={jobsWithStatus(status)}>
                {status === 'running' ? 'Running jobs' : 'Pending jobs'}
              </Link></li>)}
            </ul>
          : <p className="muted">No running or pending jobs</p>}
        </OverviewResource>
        <p className="muted refresh-indicator" role="status">
          {revision > 0 && (refreshing ? 'Refreshing activity…' : 'Activity refresh finished')}
        </p>
      </div>
      <OverviewResource label="recent collection requests" heading="request-ledger-title" state={requests}>{rows => rows.length ? <>
        <div className="request-ledger-columns" aria-hidden="true">
          <span>Topic / keyword</span><span>Request status / jobs</span><span>Submitted (UTC)</span><span>Validated records</span>
        </div>
        <ol className="request-ledger" role="list">
          {rows.map(request => <RequestRow request={request} key={request.id} />)}
        </ol>
      </> : <p className="overview-empty">No collection requests yet</p>}</OverviewResource>
    </section>
    <div className="overview-followup">
      <section className="overview-diagnostics" aria-labelledby="recent-jobs-title">
        <div className="overview-section-heading">
          <h2 id="recent-jobs-title" tabIndex={-1}>Recent jobs</h2>
          <Link to={jobsPath}>All jobs</Link>
        </div>
        <OverviewResource label="recent jobs" heading="recent-jobs-title" state={jobs}>{rows => rows.length ? (
          <ul className="job-summary-list" role="list">
            {rows.slice(0, jobLimit).map(job => {
              const name = names.get(job.source_id.replaceAll('-', '').toLowerCase()) ?? 'Source ' + job.source_id.slice(0, 8);
              return <li key={job.job_id}>
                <div>
                  <Link to={jobPath(job.job_id)}>{name}<span className="sr-only"> · job {job.job_id}</span></Link>
                  <p className="muted">{job.valid_count} accepted · {job.invalid_count} invalid · {job.duplicate_count} duplicates</p>
                  {job.error && <p className="overview-job-error">{job.error.message}</p>}
                </div>
                <Status value={job.status} />
              </li>;
            })}
          </ul>
        ) : <p className="overview-empty">No jobs yet</p>}</OverviewResource>
      </section>
      <section className="overview-records" aria-labelledby="recent-records-title">
        <div className="overview-section-heading">
          <h2 id="recent-records-title" tabIndex={-1}>Validated records</h2>
          <Link to={recordsPath}>Data Explorer</Link>
        </div>
        <OverviewResource label="recent records" heading="recent-records-title" state={records}>{rows => rows.length ? (
          <ul className="record-index" role="list">
            {rows.slice(0, recordLimit).map(record => {
              const titleField = recordTitleFields.find(field => {
                const value = record.payload[field];
                return typeof value === 'string' && value.trim();
              });
              return <li key={record.record_id}>
                <Link to={recordPath(record.record_id)}>
                  {titleField ? clip(String(record.payload[titleField]), 100) : record.record_type}
                  <span className="sr-only"> · record {record.record_id}</span>
                </Link>
                <p className="muted">{record.record_type}</p>
                {typeof record.payload.dataset === 'string' && <p className="record-dataset">{record.payload.dataset}</p>}
              </li>;
            })}
          </ul>
        ) : <p className="overview-empty">No validated records yet</p>}</OverviewResource>
      </section>
    </div>
  </div>;
}
