import { useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router';
import { Loading, Pagination, Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getJob, jobPath, maxOffset } from '../collection-jobs/api';
import { ResultCounts } from '../collection-jobs/presentation';
import { listQuarantine, recordsForJob, type RecordProblem } from './api';
import { EvidenceLink, Metadata, ResultProblem, positionLabel } from './presentation';
import { useResultPage } from './useResultPage';

const pageSize = 10;
const problemLabels: Record<RecordProblem['code'], string> = {
  required_field: 'Required field',
  wrong_type: 'Wrong type',
  invalid_row: 'Invalid row',
  unexpected_field: 'Unexpected field',
  duplicate: 'Duplicate',
};

export function QuarantinePage() {
  const { jobId = '' } = useParams();
  const { offset, changePage } = useResultPage();
  const heading = useRef<HTMLHeadingElement>(null);
  const loadJob = useCallback((signal: AbortSignal) => getJob(jobId, signal), [jobId]);
  const loadEntries = useCallback((signal: AbortSignal) => listQuarantine(jobId, pageSize, offset, signal), [jobId, offset]);
  const job = useResource(loadJob);
  const { result, retry } = useResource(loadEntries);

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={jobPath(jobId)}>Back to Job Details</Link></nav>
      <div className="page-heading detail-heading">
        <div><h1 ref={heading} tabIndex={-1}>Quarantine</h1><p className="identifier muted">{jobId}</p></div>
        <Link className="control" to={recordsForJob(jobId)}>View job records</Link>
      </div>
      {job.result.state === 'ready' && (
        <section className="panel detail-panel" aria-labelledby="quarantine-job-title">
          <div className="panel-heading">
            <h2 id="quarantine-job-title">Job results</h2>
            <Status value={job.result.data.status} />
          </div>
          <div className="quarantine-counts"><ResultCounts job={job.result.data} /></div>
        </section>
      )}
      {job.result.state === 'error' && result.state === 'ready' && (
        <div className="panel detail-panel"><ResultProblem error={job.result.error} resource="Job" retry={job.retry} /></div>
      )}
      <section className="panel detail-panel" aria-labelledby="quarantine-list-title">
        <div className="panel-heading"><h2 id="quarantine-list-title">Rejected candidates</h2></div>
        {result.state === 'loading' && <Loading>Loading quarantine…</Loading>}
        {result.state === 'error' && <ResultProblem error={result.error}
          resource={result.error.status === 404 || result.error.status === 422 ? 'Job' : 'Quarantine'}
          retry={() => { retry(); if (job.result.state === 'error') job.retry(); }} />}
        {result.state === 'ready' && (
          <>
            {result.data.length ? (
              <ol className="quarantine-list" aria-label="Quarantine entries">
                {result.data.slice(0, pageSize).map(entry => (
                  <li key={entry.record_id} className="quarantine-entry">
                    <div className="quarantine-entry-meta">
                      <h3>{positionLabel(entry.source_position)}</h3>
                      <p className="muted">{entry.source_position.kind === 'csv_row' ? 'Starting line in source CSV' : 'One-based extraction order'}</p>
                      <dl className="result-metadata">
                        <Metadata label="Evidence ID"><EvidenceLink id={entry.evidence_reference} /></Metadata>
                        <Metadata label="Persisted (UTC)"><Timestamp value={entry.created_at} /></Metadata>
                      </dl>
                    </div>
                    <ul className="quarantine-problems" aria-label="Validation problems">
                      {entry.problems.map((problem, index) => (
                        <li key={index}>
                          <strong>{problemLabels[problem.code]}</strong>
                          {problem.field != null && <> · <code>{problem.field}</code></>}
                          <p>{problem.message}</p>
                          <code className="muted">{problem.code}</code>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            ) : <p className="notice" role="status">{offset ? 'This page is empty.' : 'No quarantine entries for this job.'}</p>}
            {(offset > 0 || result.data.length > 0) && (
              <Pagination label="Quarantine entries" offset={offset} size={pageSize} loaded={result.data.length} maxOffset={maxOffset}
                change={next => { heading.current?.focus(); changePage(next); }} />
            )}
          </>
        )}
      </section>
    </>
  );
}
