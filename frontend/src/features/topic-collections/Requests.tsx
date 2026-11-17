import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { Status, TableRegion, Timestamp } from '../../components/feedback';
import { apiGet, apiPost } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent, type RequestIntent } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { jobPath, jobsPath, newJobPath } from '../collection-jobs/api';
import { ErrorDetails } from '../collection-jobs/presentation';
import { profilePath } from '../profiles/api';
import { RecordExport } from '../results/RecordExport';
import { quarantinePath, recordsForJob, recordsForRequest } from '../results/api';
import { ContextLink, useResultReturn } from '../results/resultNavigation';
import { sourcePath } from '../sources/api';
import { ArticleList } from './Articles';
import {
  newRequestPath, requestPath, requestsPath,
  type CollectionRequest,
} from './api';
import { ActionFeedback, Page, Resource, useAction } from './support';

function useRequestSubmission() {
  const outstanding = useRef(new Map<string, RequestIntent<object>>());
  return async (path: string, body: object, signal: AbortSignal) => {
    const fingerprint = path + JSON.stringify(body);
    const intent = outstanding.current.get(fingerprint) ?? await prepareRequestIntent(path, body);
    outstanding.current.set(fingerprint, intent);
    function forget() {
      outstanding.current.delete(fingerprint);
      forgetRequestIntent(intent);
    }
    try {
      signal.throwIfAborted();
      const request = await apiPost<CollectionRequest>(path, intent.body, signal);
      forget();
      return request;
    } catch (error) {
      if (!isUncertainWrite(error)) forget();
      throw error;
    }
  };
}

export function RequestList() {
  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={jobsPath}>Collection Jobs</Link></nav>
    <div className="page-heading detail-heading">
      <h1>Collection requests</h1>
      <Link className="control primary" to={newRequestPath}>Collect by topic</Link>
    </div>
    <section className="panel detail-panel" aria-label="Collection request history">
      <Page<CollectionRequest> path={requestsPath} label="Requests" empty="No topic collection requests yet.">
        {rows => <TableRegion label="Collection requests">
          <table>
            <thead><tr><th scope="col">Topic and keyword</th><th scope="col">Status</th>
              <th scope="col">Jobs</th><th scope="col">Created (UTC)</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <th scope="row"><Link to={requestPath(row.id)}>{row.topic_name} · {row.keyword}</Link></th>
              <td><Status value={row.status} /></td><td>{row.jobs.length}</td>
              <td><Timestamp value={row.created_at} /></td>
            </tr>)}</tbody>
          </table>
        </TableRegion>}
      </Page>
    </section>
  </>;
}

export function RequestDetails() {
  const { requestId = '' } = useParams();
  return <RequestWorkspace key={requestId} requestId={requestId} />;
}

function RequestWorkspace({ requestId }: { requestId: string }) {
  const navigate = useNavigate();
  const { state: navigationState } = useLocation();
  const path = requestPath(requestId);
  const [revision, setRevision] = useState(0);
  const load = useCallback((signal: AbortSignal) => apiGet<CollectionRequest>(path, signal), [path]);
  const state = useResource(load, revision, true);
  const { result } = state;
  useResultReturn(result.state === 'ready');
  const collecting = result.state === 'ready' && ['pending', 'running'].includes(result.data.status);
  const action = useAction();
  const submitRequest = useRequestSubmission();

  useEffect(() => {
    if (!collecting || state.refreshing) return;
    let timer: number | undefined;
    function schedule() {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(() => setRevision(value => value + 1), 2_000);
      }
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [collecting, state.refreshing, revision]);

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={requestsPath}>Collection requests</Link></nav>
    <Resource state={state} label="collection request">{row => {
      const available = row.jobs.reduce((total, { job }) => total + job.valid_count, 0);
      return <>
        <div className="page-heading detail-heading">
          <div className="collection-text"><h1>{row.topic_name} · {row.keyword}</h1>
            <p className="request-summary muted">
              <span>{row.jobs.length} {row.jobs.length === 1 ? 'source job' : 'source jobs'}</span>
              <span>Created <Timestamp value={row.created_at} /> UTC</span>
              {row.finished_at && <span>Finished <Timestamp value={row.finished_at} /> UTC</span>}
            </p>
          </div>
          <div className="profile-actions">
            <span role="status"><Status value={row.status} /></span>
            <Link className={available > 0 ? "control primary" : "control"} to={recordsForRequest(row.id)}>View request records</Link>
            <button type="button" disabled={action.busy} onClick={() =>
              void action.run(signal => submitRequest(path + '/refresh', {}, signal),
                next => navigate(requestPath(next.id)))}>Refresh collection</button>
          </div>
        </div>
        {navigationState?.collectionCreated && <p className="source-confirmation" role="status">
          Collection request submitted. Follow the source jobs below.
        </p>}
        <p className="request-results muted">
          {available > 0
            ? `${available} validated ${available === 1 ? 'record' : 'records'} available.`
            : collecting ? 'Validated records will appear as jobs publish results.' : 'No validated records for this run.'}
          {' '}<a href="#request-jobs">Go to child jobs</a>
        </p>
        {collecting && <p className="muted">Status updates while this page is visible.</p>}
        {row.status === 'partial' && <p className="notice outcome request-outcome" data-status="partial">
          Some jobs did not complete successfully. Review the available results and job details below.
        </p>}
        {row.status === 'failed' && <p className="notice outcome request-outcome" data-status="failed">
          The collection failed. Open a child job to inspect its error and available evidence.
        </p>}
        {row.refresh_of && <p><Link to={requestPath(row.refresh_of)}>View previous run</Link></p>}
        <ActionFeedback action={action} pending="Starting refresh…" />
        <section className="panel detail-panel" aria-labelledby="request-jobs">
          <div className="panel-heading"><h2 id="request-jobs" tabIndex={-1}>Child jobs</h2>
            <button type="button" onClick={state.retry} disabled={state.refreshing}>Reload status</button></div>
          <ul className="request-job-list" aria-label="Source jobs" role="list">
            {row.jobs.map(({ job, source_name, profile_version }) => (
              <li key={job.job_id} className="request-job collection-text">
                <div className="request-job-heading">
                  <h3><Link to={sourcePath(job.source_id)}>{source_name}</Link></h3>
                  <Status value={job.status} />
                </div>
                <p><Link to={profilePath(job.source_id, job.profile_version_id)}>Pinned profile version {profile_version}</Link></p>
                <p>{job.valid_count} accepted · {job.invalid_count} invalid · {job.duplicate_count} duplicates</p>
                <div className="profile-actions">
                  <ContextLink id={'request-job-' + job.job_id} to={jobPath(job.job_id)}>Job details</ContextLink>
                  <Link to={recordsForJob(job.job_id)}>Records</Link>
                  <Link to={quarantinePath(job.job_id)}>Quarantine</Link>
                  {job.finished_at && <ContextLink id={'request-evidence-' + job.job_id}
                    to={jobPath(job.job_id) + '#job-evidence-title'}>Evidence</ContextLink>}
                </div>
                <div className="request-job-timing muted">
                  {job.started_at && <div>Started <Timestamp value={job.started_at} /> UTC</div>}
                  {job.finished_at && <div>Finished <Timestamp value={job.finished_at} /> UTC</div>}
                  {job.next_attempt_at && <div>Retry scheduled for <Timestamp value={job.next_attempt_at} /> UTC</div>}
                  {!job.started_at && !job.finished_at && !job.next_attempt_at && 'Waiting to start'}
                </div>
                {job.error && <ErrorDetails error={job.error} />}
                {job.dispatch_error_code && <p>Dispatch error <code>{job.dispatch_error_code}</code></p>}
              </li>
            ))}
          </ul>
        </section>
        <RecordExport scope="request" id={row.id} pending={collecting} />
        <ArticleList requestId={requestId} revision={available} />
      </>;
    }}</Resource>
  </>;
}
