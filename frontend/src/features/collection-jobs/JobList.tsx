import { useCallback, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useResource } from '../../lib/useResource';
import { jobPath, jobStatuses, listJobs, maxOffset, newJobPath } from './api';
import type { CollectionJob } from './api';
import { Loading, Pagination, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { ResultCounts, statusLabels } from './presentation';
import { requestsPath } from '../topic-collections/api';
import { ContextLink, readOffset, useResultReturn } from '../results/resultNavigation';
import { loadJobContext, shortId, type JobPin } from './jobContext';
import { useVisibleJobPolling } from './useVisibleJobPolling';

const pageSize = 20;
const noJobs: CollectionJob[] = [];

export function JobList() {
  const [search, setSearch] = useSearchParams();
  const status = jobStatuses.find(value => value === search.get('status')) ?? '';
  const order = search.get('order') === 'newest' ? 'newest' : 'oldest';
  const offset = readOffset(search);
  const live = search.get('live') === '1';
  const load = useCallback((signal: AbortSignal) => listJobs(pageSize, offset, status, signal, order), [offset, status, order]);
  const { result, retry, refreshing, refreshError } = useResource(load, 0, true, true, true);
  const loaded = result.state === 'ready' ? result.data : noJobs;
  const jobs = useMemo(() => loaded.slice(0, pageSize), [loaded]);
  const pins = JSON.stringify(jobs.map(({ source_id, profile_version_id }) => ({ source_id, profile_version_id })));
  const contextLoad = useCallback((signal: AbortSignal) => loadJobContext(JSON.parse(pins) as JobPin[], signal), [pins]);
  const context = useResource(contextLoad, 0, false, jobs.length > 0).result;
  const toolbar = useRef<HTMLSelectElement>(null);
  useResultReturn(result.state === 'ready');
  useVisibleJobPolling(live && result.state === 'ready', refreshing, retry);

  function changeSearch(key: string, value: string, resetOffset = false) {
    const next = new URLSearchParams(search);
    if (resetOffset) next.delete('offset');
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next);
  }

  return <>
    <div className="page-heading detail-heading">
      <h1>Collection Jobs</h1>
      <div className="profile-actions">
        <Link to={requestsPath}>Collection requests</Link>
        <Link className="control primary" to={newJobPath} state={{ jobsSearch: search.toString() }}>
          Single-source collection and CSV import
        </Link>
      </div>
    </div>
    <section className="panel job-ledger" aria-label="Collection jobs ledger">
      <div className="toolbar">
        <label className="filter">
          <span>Status</span>
          <select ref={toolbar} value={status} onChange={event => changeSearch('status', event.target.value, true)}>
            <option value="">All statuses</option>
            {jobStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
          </select>
        </label>
        <label className="filter">
          <span>Order</span>
          <select value={order} onChange={event => changeSearch('order', event.target.value, true)}>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </select>
        </label>
        <label className="job-live-toggle"><input type="checkbox" checked={live} onChange={event => {
          const next = new URLSearchParams(search);
          if (event.target.checked) next.set('live', '1');
          else next.delete('live');
          setSearch(next, { replace: true, preventScrollReset: true });
        }} /> Live updates</label>
        <button type="button" onClick={() => { if (!refreshing) retry(); }}
          aria-disabled={refreshing}>Refresh jobs</button>
      </div>
      {refreshError && <p className="notice job-stale" role="status">Job list refresh failed. Showing the last loaded jobs.</p>}
      {result.state === 'loading' && <Loading>Loading jobs…</Loading>}
      {result.state === 'error' && <RequestProblem error={result.error} resource="jobs" retry={() => {
        toolbar.current?.focus();
        retry();
      }} />}
      {result.state === 'ready' && <>
        {jobs.length > 0 ? <>
          <div className="job-ledger-head" aria-hidden="true">
            <span>Collection</span><span>Status</span><span>Results</span><span>Created (UTC)</span><span />
          </div>
          <ul className="job-ledger-rows" aria-label="Jobs on this page">
            {jobs.map(job => {
              const source = context.state === 'ready' ? context.data.sources.get(job.source_id) : undefined;
              const profile = context.state === 'ready' ? context.data.profiles.get(job.profile_version_id) : undefined;
              return <li className="job-ledger-row" key={job.job_id}>
                <div className="job-ledger-identity">
                  <strong>{source?.source_name ?? 'Source ' + shortId(job.source_id)}</strong>
                  <div className="muted">Job {shortId(job.job_id)} · {profile ? 'Version ' + profile.version
                    : 'Profile ' + shortId(job.profile_version_id)}</div>
                </div>
                <div className="job-ledger-status"><Status value={job.status} /></div>
                <ResultCounts job={job} />
                <div className="job-ledger-date"><span className="sr-only">Created (UTC) </span><Timestamp value={job.created_at} /></div>
                <ContextLink className="job-ledger-inspect" id={'inspect-job-' + job.job_id} to={jobPath(job.job_id)}
                  aria-label={'Inspect Job ' + shortId(job.job_id)}>Inspect Job</ContextLink>
                {(job.error || job.dispatch_error_code) && <p className="job-ledger-error">
                  <strong>{job.error ? 'Recorded error' : 'Recorded dispatch error'}</strong>
                  {' · '}{job.error?.message ?? job.dispatch_error_code}
                </p>}
              </li>;
            })}
          </ul>
        </> : <div className="notice job-empty">
          <div role="status">
            <strong>{offset ? 'This page is empty' : status ? 'No jobs match this status' : 'No collection jobs yet'}</strong>
            <p>{offset ? 'Return to the first page or choose a different filter.'
              : status ? 'Choose another status to check other jobs.'
              : 'Submit a collection using an authorized Source and an approved Profile Version.'}</p>
          </div>
          {offset ? <button type="button" onClick={() => { toolbar.current?.focus(); changeSearch('offset', ''); }}>First page</button>
            : status ? <button type="button" onClick={() => { toolbar.current?.focus(); changeSearch('status', '', true); }}>Show all statuses</button>
            : <Link to={newJobPath}>Set up a single-source collection</Link>}
        </div>}
        {(offset > 0 || jobs.length > 0) &&
          <Pagination label="Jobs" offset={offset} size={pageSize} loaded={loaded.length} maxOffset={maxOffset}
            change={next => { toolbar.current?.focus(); changeSearch('offset', next ? String(next) : ''); }} />}
      </>}
    </section>
  </>;
}
