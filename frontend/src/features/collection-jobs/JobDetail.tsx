import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useResource } from '../../lib/useResource';
import { getJob, jobsPath, listEvents, maxOffset } from './api';
import type { CollectionJob, ExecutionEvent } from './api';
import { Loading, Pagination, RequestProblem, Status, TableRegion, Timestamp } from '../../components/feedback';
import { profilePath } from '../profiles/api';
import { listJobEvidence, listRecords, quarantinePath, recordPath, recordsForJob } from '../results/api';
import { EvidenceLink, PayloadPreview } from '../results/presentation';
import { sourcePath } from '../sources/api';
import { ErrorDetails, ResultCounts } from './presentation';

export function JobDetail() {
  const { jobId = '' } = useParams();
  return <JobDetailPage key={jobId} id={jobId} />;
}

function JobDetailPage({ id }: { id: string }) {
  const location = useLocation();
  const search = location.state?.jobsSearch;
  const back = typeof search === 'string' && search ? `${jobsPath}?${search}` : jobsPath;
  const [revision, setRevision] = useState(0);
  const [manualRevision, setManualRevision] = useState(0);
  const [recordOffset, setRecordOffset] = useState(0);
  const load = useCallback((signal: AbortSignal) => getJob(id, signal), [id]);
  const { result, refreshing, resolvedRevision } = useResource(load, revision, true);
  const job = result.state === 'ready' ? result.data : undefined;
  const active = job?.status === 'pending' || job?.status === 'running';
  const readEvents = useCallback((signal: AbortSignal) => listEvents(id, signal), [id]);
  const events = useResource(readEvents, resolvedRevision, true, !!job);
  const poll = useCallback(() => setRevision(current => current + 1), []);

  useEffect(() => {
    if (!active || refreshing || events.refreshing) return;
    let timer: number | undefined;
    function schedule() {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') timer = window.setTimeout(poll, 3000);
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [active, refreshing, events.refreshing, poll, revision]);

  function refresh() {
    setManualRevision(current => current + 1);
    poll();
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <Link to={back}>Collection Jobs</Link>
      </nav>
      <div className="page-heading detail-heading">
        <div>
          <h1>Job Details</h1>
          <p className="identifier muted">{id}</p>
        </div>
        {result.state !== 'error' &&
          <button type="button" onClick={refresh} disabled={refreshing || (!!job && events.refreshing)}>
            Refresh job
          </button>}
      </div>
      {result.state === 'loading' && <div className="panel"><Loading>Loading job details…</Loading></div>}
      {result.state === 'error' && (
        <div className="panel">
          {result.error.status === 404 || result.error.code === 'invalid_request' ? (
            <div className="notice">
              <div role="alert">
                <strong>Job not found</strong>
                <p>Check the job ID or select a job from the list.</p>
              </div>
              <Link to={back}>Back to jobs</Link>
            </div>
          ) : <RequestProblem error={result.error} resource="job details" retry={refresh} />}
        </div>
      )}
      {result.state === 'ready' && (
        <>
          <JobOverview job={result.data} />
          <EventTimeline result={events.result} retry={events.retry} />
          {active ? <section className="panel detail-panel" aria-label="Related records">
            <p className="notice muted">Records appear after the job publishes results.</p>
          </section> : <>
            <JobEvidence id={result.data.job_id} revision={manualRevision} />
            <RecordsPreview id={result.data.job_id} offset={recordOffset} setOffset={setRecordOffset}
              revision={manualRevision} />
          </>}
        </>
      )}
    </>
  );
}

function JobOverview({ job }: { job: CollectionJob }) {
  return (
    <section className="panel detail-panel" aria-labelledby="overview-title">
      <div className="panel-heading">
        <h2 id="overview-title">Run overview</h2>
        <Status value={job.status} />
        <div className="job-result-links">
          <Link className="control" to={recordsForJob(job.job_id)}>View job records</Link>
          <Link className="control" to={quarantinePath(job.job_id)}>View quarantine</Link>
        </div>
      </div>
      {(job.status === 'pending' || job.status === 'running') && (
        <p className="job-monitor" role="status">
          {job.status === 'pending' ? 'Pending. Waiting for execution.' : 'Running. Collection is in progress.'}{' '}
          Status updates while this page is visible.
        </p>
      )}
      <div className="overview-body">
        <dl className="lineage">
          <div><dt>Source ID</dt><dd className="identifier"><Link to={sourcePath(job.source_id)}>{job.source_id}</Link></dd></div>
          <div><dt>Pinned profile version</dt><dd className="identifier">
            <Link to={profilePath(job.source_id, job.profile_version_id)}>{job.profile_version_id}</Link>
          </dd></div>
        </dl>
        <dl className="times">
          <div><dt>Created (UTC)</dt><dd><Timestamp value={job.created_at} /></dd></div>
          <div><dt>Started (UTC)</dt><dd><Timestamp value={job.started_at} /></dd></div>
          <div><dt>Finished (UTC)</dt><dd><Timestamp value={job.finished_at} /></dd></div>
        </dl>
        <ResultCounts job={job} />
      </div>
      {(job.status === 'partial' || job.status === 'failed' || job.error) && (
        <div className="notice outcome" data-status={job.status}>
          <strong>{job.status === 'partial' ? 'Partial result' : job.status === 'failed' ? 'Job failed' : 'Reported error'}</strong>
          {job.status === 'partial' && job.invalid_count > 0 && <p>See quarantine for rejected candidates.</p>}
          {job.error && <ErrorDetails error={job.error} />}
        </div>
      )}
    </section>
  );
}

const eventLabels: ReadonlyMap<string, string> = new Map([
  ['JOB_CREATED', 'Job created'],
  ['DISPATCHED', 'Sent to worker queue'],
  ['DISPATCH_FAILED', 'Dispatch failed'],
  ['CLAIMED', 'Worker started the run'],
  ['RETRY_SCHEDULED', 'Retry scheduled'],
  ['WORKER_LOST', 'Worker lease expired'],
  ['RECOVERY_REQUESTED', 'Recovery requested'],
  ['SUCCEEDED', 'Run succeeded'],
  ['PARTIAL', 'Run produced partial results'],
  ['FAILED', 'Run failed'],
]);

function EventTimeline({ result, retry }: {
  result: ReturnType<typeof useResource<ExecutionEvent[]>>['result']; retry: () => void;
}) {
  return (
    <section className="panel detail-panel" aria-labelledby="events-title">
      <div className="panel-heading">
        <h2 id="events-title">Execution events</h2>
        <span className="muted timezone">Times in UTC</span>
      </div>
      {result.state === 'loading' && <Loading>Loading execution events…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="execution events" retry={retry} />}
      {result.state === 'ready' && (result.data.length === 0
        ? <p className="notice" role="status">No execution events recorded.</p>
        : <ol className="timeline" aria-label="Execution events in API order">
          {result.data.map(event => (
            <li key={event.event_id}>
              <Timestamp value={event.occurred_at} />
              <div className="event-body">
                <div className="event-label">
                  {event.kind && <>
                    <strong>{eventLabels.get(event.kind) ?? 'Execution event'}</strong>
                    <code className="muted">{event.kind}</code>
                  </>}
                  <Status value={event.status} />
                  {!!event.execution_attempt && <span className="muted">Attempt {event.execution_attempt}</span>}
                </div>
                {event.error && <ErrorDetails error={event.error} />}
              </div>
            </li>
          ))}
        </ol>)}
    </section>
  );
}

const recordsPageSize = 10;

function JobEvidence({ id, revision }: { id: string; revision: number }) {
  const load = useCallback((signal: AbortSignal) => listJobEvidence(id, signal), [id]);
  const { result, retry } = useResource(load, revision);
  return (
    <section className="panel detail-panel" aria-labelledby="job-evidence-title">
      <div className="panel-heading"><h2 id="job-evidence-title">Capture evidence</h2></div>
      {result.state === 'loading' && <Loading>Loading capture evidence…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="capture evidence" retry={retry} />}
      {result.state === 'ready' && (result.data.length > 0
        ? <ul className="notice job-evidence-list">
          {result.data.map(evidence => <li key={evidence.evidence_id}>
            {evidence.adapter_type === 'web' ? `Page ${evidence.page_number} ` : ''}
            <EvidenceLink id={evidence.evidence_id} />
          </li>)}
        </ul>
        : <p className="notice">No capture evidence was saved for this job.</p>)}
    </section>
  );
}

function RecordsPreview({ id, offset, setOffset, revision }: {
  id: string; offset: number; setOffset: (offset: number) => void; revision: number;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback((signal: AbortSignal) => listRecords(id, recordsPageSize, offset, signal), [id, offset]);
  const { result, retry } = useResource(load, revision);
  return (
    <section className="panel detail-panel" aria-labelledby="records-title">
      <div className="panel-heading">
        <h2 id="records-title" ref={heading} tabIndex={-1}>Related records</h2>
        <span className="muted timezone">Validated records</span>
      </div>
      {result.state === 'loading' && <Loading>Loading related records…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="related records" retry={retry} />}
      {result.state === 'ready' && (
        <>
          {result.data.length === 0 ? (
            <p className="notice" role="status">{offset ? 'This page is empty.' : 'No validated records for this job.'}</p>
          ) : (
            <TableRegion label="Related records table, scroll horizontally for more columns">
              <table className="records-table">
                <caption className="sr-only">Related records preview</caption>
                <thead><tr>
                  <th scope="col">Record ID</th><th scope="col">Payload preview</th>
                  <th scope="col">Record type</th><th scope="col">Schema version</th><th scope="col">Evidence reference</th>
                </tr></thead>
                <tbody>
                  {result.data.slice(0, recordsPageSize).map(record => (
                    <tr key={record.record_id}>
                      <th scope="row" className="identifier"><Link to={recordPath(record.record_id)}
                        state={{ recordsSearch: new URLSearchParams({ job_id: id, offset: String(offset) }).toString() }}
                        aria-label={`Open record ${record.record_id}`}>{record.record_id}</Link></th>
                      <td className="payload-cell"><PayloadPreview payload={record.payload} /></td>
                      <td>{record.record_type}</td>
                      <td>{record.schema_version}</td>
                      <td className="identifier"><EvidenceLink id={record.evidence_reference} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableRegion>
          )}
          {(offset > 0 || result.data.length > 0) && (
            <Pagination label="Records" offset={offset} size={recordsPageSize} loaded={result.data.length} maxOffset={maxOffset}
              change={next => { heading.current?.focus(); setOffset(next); }} />
          )}
        </>
      )}
    </section>
  );
}
