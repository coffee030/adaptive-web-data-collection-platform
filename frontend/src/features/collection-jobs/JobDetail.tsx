import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { useResource } from '../../lib/useResource';
import { apiGet } from '../../lib/api';
import { getJob, jobsPath, listEvents, maxOffset, sameId } from './api';
import type { CollectionJob, ExecutionEvent, ExecutionOrigin, JobDetailResponse } from './api';
import { Loading, Pagination, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { profilePath } from '../profiles/api';
import { evidenceDetailPath, listJobEvidence, listRecords, quarantinePath, recordPath, recordsForJob } from '../results/api';
import { captureLabel, clip, marketWarning, PayloadPreview, recordTitle, webLocation } from '../results/presentation';
import { RecordExport } from '../results/RecordExport';
import { contextFrom, ContextLink, readOffset, resultId, ReturnLink, useResultReturn, useReturnPosition } from '../results/resultNavigation';
import { sourcePath } from '../sources/api';
import { requestPath, requestsPath, type CollectionRequest } from '../topic-collections/api';
import { errorCategory, ErrorDetails, ResultCounts, statusLabels } from './presentation';
import { loadJobContext, shortId } from './jobContext';

export function JobDetail() {
  const { jobId = '' } = useParams();
  return <JobDetailPage key={jobId} id={jobId} />;
}

function JobDetailPage({ id }: { id: string }) {
  const location = useLocation();
  const origin = contextFrom(location.search);
  const search = location.state?.jobsSearch;
  const back = origin.split('?')[0] === jobsPath ? origin
    : typeof search === 'string' && search ? `${jobsPath}?${search}` : jobsPath;
  const requestOrigin = origin.startsWith(requestsPath + '/') ? resultId(origin.split(/[?#]/, 1)[0]?.slice(requestsPath.length + 1) ?? null) : '';
  const validId = !!resultId(id);
  const [revision, setRevision] = useState(0);
  const [manualRevision, setManualRevision] = useState(0);
  const load = useCallback((signal: AbortSignal) => getJob(id, signal), [id]);
  const { result, refreshing, resolvedRevision, refreshError } = useResource(load, revision, true, validId, true);
  const job = result.state === 'ready' ? result.data : undefined;
  const loadRequest = useCallback((signal: AbortSignal) => apiGet<CollectionRequest>(requestPath(requestOrigin), signal), [requestOrigin]);
  const parent = useResource(loadRequest, 0, false, !!job && !!requestOrigin).result;
  const requestId = parent.state === 'ready' && sameId(requestOrigin, parent.data.id)
    && parent.data.jobs.some(({ job }) => sameId(id, job.job_id)) ? requestOrigin : '';
  const active = job?.status === 'pending' || job?.status === 'running';
  const readEvents = useCallback((signal: AbortSignal) => listEvents(id, signal), [id]);
  const events = useResource(readEvents, resolvedRevision, true, !!job, true);
  const poll = useCallback(() => setRevision(current => current + 1), []);
  const busy = refreshing || (!!job && events.refreshing);
  useResultReturn(!!job);
  const restoring = useReturnPosition();
  const hasJob = !!job;
  useEffect(() => {
    if (!hasJob || restoring || !['#events-title', '#job-evidence-title'].includes(location.hash)) return;
    const heading = document.getElementById(location.hash.slice(1));
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: 'start' });
  }, [active, hasJob, location.hash, restoring]);

  useEffect(() => {
    if (!active || busy) return;
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
  }, [active, busy, events.refreshError, poll, revision]);

  function refresh() {
    if (busy) return;
    setManualRevision(current => current + 1);
    poll();
  }

  return (
    <>
      <nav aria-label="Breadcrumb" className="breadcrumb">
        <ReturnLink to={back}>Collection Jobs</ReturnLink>
        {requestId && <ReturnLink to={origin}>Collection request</ReturnLink>}
      </nav>
      <div className="page-heading detail-heading">
        <div>
          <h1>Job Details</h1>
          {validId && <p className="muted">Job {shortId(id)}</p>}
        </div>
        {validId && result.state !== 'error' &&
          <button type="button" onClick={refresh} aria-disabled={busy}>
            Refresh job
          </button>}
      </div>
      {location.state?.jobConfirmed && <p className="source-confirmation" role="status">Job submission confirmed. Current status appears below.</p>}
      {!validId && <div className="panel notice">
        <p role="alert">Invalid Job ID. Select a Job from the list.</p><ReturnLink to={back}>Back to jobs</ReturnLink>
      </div>}
      {validId && result.state === 'loading' && <div className="panel"><Loading>Loading job details…</Loading></div>}
      {result.state === 'error' && (
        <div className="panel">
          {result.error.status === 404 || result.error.code === 'invalid_request' ? (
            <div className="notice">
              <div role="alert">
                <strong>Job not found</strong>
                <p>Check the job ID or select a job from the list.</p>
              </div>
              <ReturnLink to={back}>Back to jobs</ReturnLink>
            </div>
          ) : <RequestProblem error={result.error} resource="job details" retry={refresh} />}
        </div>
      )}
      {result.state === 'ready' && (
        <>
          {refreshError && <p className="notice job-stale" role="status">Job refresh failed. Showing the last recorded status. {active && 'Automatic refresh will resume while this page is visible.'}</p>}
          <JobOverview job={result.data} parentRequest={requestId ? origin : ''} />
          <ExecutionDiagnostics job={result.data} active={active} />
          <JobError job={result.data} />
          <EventTimeline resource={events} />
          {active ? <section className="panel detail-panel" aria-label="Related records">
            <p className="notice muted">Records appear after the job publishes results.</p>
          </section> : <>
            <JobEvidence id={result.data.job_id} revision={manualRevision} requestId={requestId} />
            <RecordsPreview id={result.data.job_id} revision={manualRevision} />
          </>}
          <RecordExport scope="job" id={result.data.job_id} pending={active} />
          <JobMetadata job={result.data} />
        </>
      )}
    </>
  );
}

function JobOverview({ job, parentRequest }: { job: CollectionJob; parentRequest: string }) {
  const contextLoad = useCallback((signal: AbortSignal) => loadJobContext([job], signal),
    [job.source_id, job.profile_version_id]);
  const context = useResource(contextLoad).result;
  const source = context.state === 'ready' ? context.data.sources.get(job.source_id) : undefined;
  const profile = context.state === 'ready' ? context.data.profiles.get(job.profile_version_id) : undefined;
  const outcomes: Record<CollectionJob['status'], string> = {
    pending: job.next_attempt_at ? 'Awaiting a scheduled retry.' : 'Waiting for execution.',
    running: 'Collection is in progress.',
    succeeded: 'Collection finished successfully.',
    partial: job.valid_count ? 'Partial result. Validated records are available.' : 'Partial result. Review the recorded results.',
    failed: 'Collection failed. Review the recorded error and execution events.',
  };

  return <section className="panel detail-panel job-outcome" aria-labelledby="overview-title" data-status={job.status}>
    <div className="panel-heading"><h2 id="overview-title">Run overview</h2><Status value={job.status} /></div>
    <div className="job-outcome-body">
      <p className="job-outcome-message" role="status">{outcomes[job.status]}</p>
      <ResultCounts job={job} />
      <div className="job-context">
        <div><span className="muted">Source</span><Link to={sourcePath(job.source_id)}>
          {source?.source_name ?? 'Source ' + shortId(job.source_id)}
        </Link></div>
        <div><span className="muted">Pinned Profile Version</span><Link to={profilePath(job.source_id, job.profile_version_id)}>
          {profile ? 'Version ' + profile.version : 'Profile ' + shortId(job.profile_version_id)}
        </Link></div>
        {parentRequest && <div><span className="muted">Collection Request</span><ReturnLink to={parentRequest}>View parent request</ReturnLink></div>}
      </div>
      <nav className="profile-actions job-outcome-actions" aria-label="Inspect job results">
        <JobSectionLink target="events-title">Execution events</JobSectionLink>
        <ContextLink id="job-records" to={recordsForJob(job.job_id)}>View job records</ContextLink>
        <ContextLink id="job-quarantine" to={quarantinePath(job.job_id)}>View quarantine</ContextLink>
        {job.finished_at && <JobSectionLink target="job-evidence-title">Capture evidence</JobSectionLink>}
      </nav>
    </div>
  </section>;
}

function JobSectionLink({ target, children }: { target: string; children: string }) {
  const { search, state } = useLocation();
  return <Link to={{ search, hash: '#' + target }} state={state} replace>{children}</Link>;
}

function ExecutionOwner({ workerId, origin }: { workerId?: string | null; origin?: ExecutionOrigin | null }) {
  if (workerId) return <>Worker <code className="job-worker-id">{workerId}</code></>;
  return origin === 'direct' ? 'Direct execution' : 'Unknown Worker';
}

function ExecutionDiagnostics({ job, active }: { job: JobDetailResponse; active: boolean }) {
  const pending = job.status === 'pending';
  const lease = job.status === 'running' ? job.lease_expires_at : null;
  const published = job.last_dispatched_at;
  const publishedForRetry = published && (!job.next_attempt_at || Date.parse(published) >= Date.parse(job.next_attempt_at));
  return <section className="panel detail-panel" aria-labelledby="job-execution-title">
    <div className="panel-heading">
      <h2 id="job-execution-title">Execution and dispatch</h2>
      <span className="muted timezone">Times in UTC</span>
    </div>
    <div className="job-diagnostics">
      <section aria-labelledby="attempt-title">
        <h3 id="attempt-title">Execution</h3>
        <dl className="job-facts">
          <div><dt>Execution attempts</dt><dd>{job.execution_attempt}</dd></div>
          <div><dt>Latest claim owner</dt><dd>{job.execution_attempt > 0
            ? <ExecutionOwner workerId={job.latest_claim_worker_instance_id} origin={job.latest_claim_execution_origin} />
            : 'Awaiting first claim'}</dd></div>
          {pending && job.next_attempt_at && <div><dt>Earliest scheduled retry (UTC)</dt>
            <dd><Timestamp value={job.next_attempt_at} /></dd></div>}
          {lease && <div><dt>Execution lease deadline (UTC)</dt><dd><Timestamp value={lease} /></dd></div>}
        </dl>
        {pending && job.next_attempt_at && <p className="muted">A new attempt is recorded when a worker claims this Job.</p>}
        {lease && Date.parse(lease) < Date.now() && <p className="job-lease-note">Lease deadline passed. Check the latest persisted execution events.</p>}
      </section>
      <section aria-labelledby="dispatch-title">
        <h3 id="dispatch-title">Dispatch</h3>
        <dl className="job-facts">
          <div><dt>Dispatch attempts</dt><dd>{job.dispatch_attempts}</dd></div>
          {published && <div><dt>Last confirmed dispatch (UTC)</dt><dd><Timestamp value={published} /></dd></div>}
          {pending && job.dispatch_due_at && <div><dt>{publishedForRetry && !job.dispatch_error_code
            ? 'Next dispatch check (UTC)' : 'Dispatch due (UTC)'}</dt><dd><Timestamp value={job.dispatch_due_at} /></dd></div>}
        </dl>
        {pending && <p className="muted">{publishedForRetry && !job.dispatch_error_code
          ? 'A dispatch was recorded. This Job is waiting for an execution claim.'
          : job.next_attempt_at ? 'The scheduled retry is awaiting confirmed dispatch.'
            : 'This Job is pending and awaiting confirmed dispatch.'}</p>}
        {job.dispatch_error_code && <p className="job-lease-note">
          {job.dispatch_error_code === 'broker_unavailable' ? 'A previous broker publication could not be confirmed.' : 'A dispatch error was recorded.'}
          {' '}<code>{job.dispatch_error_code}</code>
        </p>}
      </section>
    </div>
    {active && <p className="job-monitor muted">Status refreshes while this page is visible.</p>}
  </section>;
}

function JobError({ job }: { job: CollectionJob }) {
  if (!job.error) return null;
  return <section className="panel detail-panel job-error-panel" aria-labelledby="job-error-title">
    <div className="panel-heading"><h2 id="job-error-title">Recorded error</h2></div>
    <div className="notice">
      <strong>{errorCategory(job.error)}</strong>
      <p className="muted">{job.execution_attempt > 0 && `Execution attempt ${job.execution_attempt}`}
        {job.status === 'failed' && `${job.execution_attempt > 0 ? ' · ' : ''}Job ended in Failed`}</p>
      <ErrorDetails error={job.error} />
      <p className="job-error-next">Possible next steps</p>
      <div className="profile-actions">
        <JobSectionLink target="events-title">Review execution events</JobSectionLink>
        <Link to={sourcePath(job.source_id)}>Inspect Source access policy</Link>
        <Link to={profilePath(job.source_id, job.profile_version_id)}>Inspect pinned Profile Version</Link>
      </div>
    </div>
  </section>;
}

function JobMetadata({ job }: { job: CollectionJob }) {
  return <details className="panel detail-panel job-metadata">
    <summary>Technical metadata</summary>
    <dl className="job-facts">
      <div><dt>Job ID</dt><dd><code>{job.job_id}</code></dd></div>
      <div><dt>Source ID</dt><dd><code>{job.source_id}</code></dd></div>
      <div><dt>Profile Version ID</dt><dd><code>{job.profile_version_id}</code></dd></div>
      <div><dt>Configuration hash</dt><dd><code>{job.config_hash}</code></dd></div>
      <div><dt>Created (UTC)</dt><dd><Timestamp value={job.created_at} /></dd></div>
      {job.started_at && <div><dt>Started (UTC)</dt><dd><Timestamp value={job.started_at} /></dd></div>}
      {job.finished_at && <div><dt>Finished (UTC)</dt><dd><Timestamp value={job.finished_at} /></dd></div>}
    </dl>
  </details>;
}

const eventLabels: ReadonlyMap<string, string> = new Map([
  ['JOB_CREATED', 'Job created'],
  ['DISPATCHED', 'Dispatch confirmed'],
  ['DISPATCH_FAILED', 'Dispatch failed'],
  ['CLAIMED', 'Execution claimed'],
  ['RETRY_SCHEDULED', 'Retry scheduled'],
  ['WORKER_LOST', 'Lease expiry recorded'],
  ['RECOVERY_REQUESTED', 'Recovery requested'],
  ['SUCCEEDED', 'Run succeeded'],
  ['PARTIAL', 'Run produced partial results'],
  ['FAILED', 'Run failed'],
]);

const attemptEventKinds = new Set([
  'CLAIMED', 'RETRY_SCHEDULED', 'WORKER_LOST', 'RECOVERY_REQUESTED', 'SUCCEEDED', 'PARTIAL', 'FAILED',
]);

function EventTimeline({ resource }: { resource: ReturnType<typeof useResource<ExecutionEvent[]>> }) {
  const { result, retry, refreshing, refreshError } = resource;
  return (
    <section className="panel detail-panel" aria-labelledby="events-title">
      <div className="panel-heading">
        <h2 id="events-title" tabIndex={-1}>Execution events</h2>
        <span className="muted timezone">Times in UTC</span>
      </div>
      {result.state === 'loading' && <Loading>Loading execution events…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="execution events" retry={retry} />}
      {refreshError && <div className="notice job-stale">
        <p role="status">Timeline refresh failed. Showing the last recorded events.</p>
        <button type="button" disabled={refreshing} onClick={retry}>Reload execution events</button>
      </div>}
      {result.state === 'ready' && (result.data.length === 0
        ? <p className="notice" role="status">No execution events recorded.</p>
        : <ol className="timeline" aria-label="Execution events in API order">
          {result.data.map(event => {
            const attempt = event.kind && attemptEventKinds.has(event.kind) ? event.execution_attempt : null;
            return (
              <li key={event.event_id}>
                <Timestamp value={event.occurred_at} />
                <div className="event-body">
                  <div className="event-label">
                    <strong>{event.kind ? eventLabels.get(event.kind) ?? 'Unrecognized execution event' : 'Historical status update'}</strong>
                    <span className="muted">{statusLabels[event.status]}{attempt ? ` · Attempt ${attempt}` : ''}</span>
                  </div>
                  {!!attempt && <div className="muted">
                    Attempt owner: <ExecutionOwner workerId={event.worker_instance_id} origin={event.execution_origin} />
                  </div>}
                  {event.error && <ErrorDetails error={event.error} />}
                  <details className="event-metadata"><summary>Event metadata</summary>
                    <dl className="job-facts">
                      <div><dt>Event kind</dt><dd><code>{event.kind ?? 'Not recorded'}</code></dd></div>
                      <div><dt>Event ID</dt><dd><code>{event.event_id}</code></dd></div>
                    </dl>
                  </details>
                </div>
              </li>
            );
          })}
        </ol>)}
    </section>
  );
}

const recordsPageSize = 10;

function JobEvidence({ id, revision, requestId }: { id: string; revision: number; requestId: string }) {
  const load = useCallback((signal: AbortSignal) => listJobEvidence(id, signal), [id]);
  const { result, retry } = useResource(load, revision);
  return (
    <section className="panel detail-panel" aria-labelledby="job-evidence-title">
      <div className="panel-heading"><h2 id="job-evidence-title" tabIndex={-1}>Capture evidence</h2></div>
      {result.state === 'loading' && <Loading>Loading capture evidence…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="capture evidence" retry={retry} />}
      {result.state === 'ready' && (result.data.length > 0
        ? <ul className="job-evidence-list" role="list" aria-label="Saved captures">
          {result.data.map(evidence => <li key={evidence.evidence_id}>
            <div>
              <strong>{captureLabel(evidence)}{evidence.adapter_type === 'web' ? ` · Page ${evidence.page_number}` : ''}</strong>
              <p className="muted">{evidence.adapter_type === 'web' ? webLocation(evidence.original_location) : evidence.original_location}</p>
            </div>
            <div className="job-capture-time"><Timestamp value={evidence.captured_at} /> UTC</div>
            <ContextLink id={'job-capture-' + evidence.evidence_id} to={evidenceDetailPath(evidence.evidence_id, requestId)}
              aria-label={`Inspect capture · Open evidence ${evidence.evidence_id}`}>Inspect capture</ContextLink>
          </li>)}
        </ul>
        : <p className="notice">No capture evidence was saved for this job.</p>)}
    </section>
  );
}

function RecordsPreview({ id, revision }: { id: string; revision: number }) {
  const [search, setSearch] = useSearchParams();
  const { state } = useLocation();
  const offset = readOffset(search, 'records_offset');
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
          {__PLATFORM_SYNTHETIC_DEMO__ && result.data.slice(0, recordsPageSize).some(record => record.payload.dataset === marketWarning) &&
            <p className="ledger-warning"><strong>{marketWarning}</strong></p>}
          {result.data.length === 0 ? (
            <p className="notice" role="status">{offset ? 'This page is empty.' : 'No validated records for this job.'}</p>
          ) : (
            <ul className="job-record-list" role="list" aria-label="Related records preview">
              {result.data.slice(0, recordsPageSize).map(record => {
                const title = clip(recordTitle(record), 72);
                return <li key={record.record_id}>
                  <div>
                    <ContextLink className="job-record-title" id={'job-record-' + record.record_id} to={recordPath(record.record_id)}
                      aria-label={`${title} · Open record ${record.record_id}`}>{title}</ContextLink>
                    <p className="muted">{record.record_type} · Schema {record.schema_version}</p>
                  </div>
                  <div><PayloadPreview payload={record.payload} /></div>
                  <ContextLink id={'job-record-capture-' + record.record_id} to={evidenceDetailPath(record.evidence_reference)}
                    aria-label={`View evidence · Open evidence ${record.evidence_reference}`}>View evidence</ContextLink>
                </li>;
              })}
            </ul>
          )}
          {(offset > 0 || result.data.length > 0) && (
            <Pagination label="Records" offset={offset} size={recordsPageSize} loaded={result.data.length} maxOffset={maxOffset}
              change={next => {
                heading.current?.focus();
                const params = new URLSearchParams(search);
                if (next) params.set('records_offset', String(next));
                else params.delete('records_offset');
                void setSearch(params, { state, replace: true, preventScrollReset: true });
              }} />
          )}
        </>
      )}
    </section>
  );
}
