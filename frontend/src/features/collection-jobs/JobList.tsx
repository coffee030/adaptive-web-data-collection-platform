import { useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useResource } from '../../lib/useResource';
import { jobsPath, jobStatuses, listJobs, maxOffset, newJobPath } from './api';
import { Loading, Pagination, RequestProblem, Status, TableRegion, Timestamp } from '../../components/feedback';
import { resultCounts, statusLabels } from './presentation';

const pageSize = 20;

export function JobList() {
  const [search, setSearch] = useSearchParams();
  const requestedStatus = search.get('status');
  const status = jobStatuses.find(value => value === requestedStatus) ?? '';
  const requestedOffset = Number(search.get('offset'));
  const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0
    && requestedOffset <= maxOffset ? requestedOffset : 0;

  const load = useCallback((signal: AbortSignal) => listJobs(pageSize, offset, status, signal), [offset, status]);
  const { result, retry } = useResource(load);
  const toolbar = useRef<HTMLSelectElement>(null);

  function changePage(nextOffset: number) {
    toolbar.current?.focus();
    const next = new URLSearchParams(search);
    if (nextOffset) next.set('offset', String(nextOffset));
    else next.delete('offset');
    setSearch(next);
  }

  return (
    <>
      <div className="page-heading detail-heading">
        <h1>Collection Jobs</h1>
        <Link className="control primary" to={newJobPath} state={{ jobsSearch: search.toString() }}>New Collection Job</Link>
      </div>
      <section className="panel" aria-label="Collection jobs">
        <div className="toolbar">
          <label className="filter">
            <span>Status</span>
            <select ref={toolbar} value={status} onChange={event => {
              const next = new URLSearchParams();
              if (event.target.value) next.set('status', event.target.value);
              setSearch(next);
            }}>
              <option value="">All statuses</option>
              {jobStatuses.map(value => <option key={value} value={value}>{statusLabels[value]}</option>)}
            </select>
          </label>
          <span className="muted timezone">Times in UTC</span>
          <button type="button" onClick={retry} disabled={result.state === 'loading'}>Refresh jobs</button>
        </div>
        {result.state === 'loading' && <Loading>Loading jobs…</Loading>}
        {result.state === 'error' && <RequestProblem error={result.error} resource="jobs" retry={retry} />}
        {result.state === 'ready' && (
          <>
            {result.data.length > 0 ? (
              <TableRegion label="Collection jobs table, scroll horizontally for more columns">
                <table className="jobs-table">
                  <caption className="sr-only">Collection jobs. Timestamps are in UTC.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Job ID</th>
                      <th scope="col">Status and results</th>
                      <th scope="col">Source ID</th>
                      <th scope="col">Created</th>
                      <th scope="col">Started</th>
                      <th scope="col">Finished</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.slice(0, pageSize).map(job => (
                      <tr key={job.job_id}>
                        <th scope="row">
                          <Link className="identifier job-link" to={`${jobsPath}/${job.job_id}`}
                            state={{ jobsSearch: search.toString() }}
                            aria-label={`Open job ${job.job_id}`}>{job.job_id}</Link>
                        </th>
                        <td className="job-results">
                          <Status value={job.status} />
                          <dl className="list-counts">
                            {resultCounts.map(count => (
                              <div key={count.key}><dt>{count.label}</dt><dd>{job[count.key]}</dd></div>
                            ))}
                          </dl>
                        </td>
                        <td className="identifier">{job.source_id}</td>
                        <td><Timestamp value={job.created_at} /></td>
                        <td><Timestamp value={job.started_at} /></td>
                        <td><Timestamp value={job.finished_at} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableRegion>
            ) : (
              <div className="notice" role="status">
                <strong>{offset ? 'This page is empty' : status ? 'No jobs match this status' : 'No collection jobs yet'}</strong>
                <p>{offset ? 'Return to the previous page to see jobs.'
                  : status ? 'Choose another status or show all jobs.'
                  : 'Jobs will appear here after they are submitted to the API.'}</p>
              </div>
            )}
            {(offset > 0 || result.data.length > 0) &&
              <Pagination label="Jobs" offset={offset} size={pageSize} loaded={result.data.length}
                change={changePage} maxOffset={maxOffset} />}
          </>
        )}
      </section>
    </>
  );
}
