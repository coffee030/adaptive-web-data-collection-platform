import { useCallback, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loading, Pagination, RequestProblem, Status, TableRegion } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getJob, jobPath, maxOffset, sameId } from '../collection-jobs/api';
import { listSources, sourcePath } from '../sources/api';
import { listRecords, quarantinePath, recordPath, type GenericRecord } from './api';
import { clip, displayValue, EvidenceLink, recordTitleFields } from './presentation';
import { useResultPage } from './useResultPage';
import { articlesPath, newRequestPath, requestArticlesPath, requestPath } from '../topic-collections/api';

const pageSize = 10;

export function RecordsExplorer() {
  const { search, setSearch, offset, changePage } = useResultPage();
  const jobId = search.get('job_id') ?? '';
  const requestId = search.get('request_id') ?? '';
  const load = useCallback((signal: AbortSignal) =>
    listRecords(jobId, pageSize, offset, signal, { requestId }), [jobId, requestId, offset]);
  const { result, retry } = useResource(load);
  const heading = useRef<HTMLHeadingElement>(null);
  const invalidFilter = result.state === 'error' && result.error.status === 422 && Boolean(jobId) && !requestId;
  const [displayFields, setDisplayFields] = useState<Set<string>>();
  const sources = useResource(listSources);

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get('job_id') ?? '').trim();
    heading.current?.focus();
    setSearch(value ? { job_id: value } : {});
  }

  return <>
    <div className="page-heading">
      <h1 ref={heading} tabIndex={-1}>Data Explorer</h1>
      <p className="muted">Browse accepted records and follow their source, collection job and capture evidence.</p>
      <div className="profile-actions">
        {requestId && <Link className="control" to={requestPath(requestId)}>View collection request</Link>}
        <Link className="control" to={requestId ? requestArticlesPath(requestId) : articlesPath}>Browse articles</Link>
      </div>
    </div>
    <section className="panel detail-panel explorer-collection" aria-label="Generic records">
      <form key={jobId} className="toolbar records-filter" onSubmit={applyFilter}>
        {requestId ? <strong>Records from this collection request</strong> : <>
          <label className="filter">
            <span>Job ID</span>
            <input name="job_id" defaultValue={jobId} maxLength={128} aria-invalid={invalidFilter || undefined}
              aria-describedby={invalidFilter ? 'records-filter-error' : undefined} />
          </label>
          <button type="submit">Apply filter</button>
        </>}
        {(jobId || requestId) && <button type="button" onClick={() => { heading.current?.focus(); setSearch({}); }}>Clear filter</button>}
        <button type="button" className="records-refresh" onClick={retry}
          disabled={result.state === 'loading'}>Refresh records</button>
      </form>
      {result.state === 'loading' && <Loading>Loading records…</Loading>}
      {result.state === 'error' && (invalidFilter
        ? <div className="notice" role="alert" id="records-filter-error">
          <strong>Invalid Job ID</strong>
          <p>Enter a valid Job UUID or clear the filter. HTTP 422</p>
        </div>
        : <RequestProblem error={result.error} resource="records" retry={retry} />)}
      {result.state === 'ready' && <>
        {result.data.length > 0 ? <RecordsTable
          rows={result.data.slice(0, pageSize)}
          search={search.toString()}
          selection={displayFields}
          select={setDisplayFields}
          nameFor={id => sources.result.state === 'ready'
            ? sources.result.data.find(source => sameId(id, source.source_id))?.source_name : undefined}
        /> : <div className="notice">
          <div role="status">
            <strong>{offset ? 'This page is empty' : requestId ? 'No records for this collection request'
              : jobId ? 'No records match this Job ID' : 'No records yet'}</strong>
            <p>{offset ? 'Return to the previous page to see records.' : requestId
              ? 'Open the collection request to check the status and results of its jobs.' : jobId
              ? 'This job has no accepted records available. Check the job and its quality summary.'
              : 'Accepted records appear after a collection job publishes validated results.'}</p>
          </div>
          {!offset && !jobId && !requestId && <Link to={newRequestPath}>Start a collection</Link>}
        </div>}
        {(offset > 0 || result.data.length > 0) &&
          <Pagination label="Records" offset={offset} size={pageSize} loaded={result.data.length} maxOffset={maxOffset}
            change={next => { heading.current?.focus(); changePage(next); }} />}
      </>}
    </section>
    {jobId && result.state === 'ready' && <JobQuality key={jobId} id={jobId} />}
    {!requestId && (!jobId || result.state !== 'ready') && <section className="panel detail-panel quality-panel" aria-labelledby="quality-title">
      <div className="panel-heading"><h2 id="quality-title">Data quality</h2></div>
      <p className="notice muted">Open a record’s job or filter by Job ID to see its accepted, invalid and duplicate counts.</p>
    </section>}
  </>;
}

function RecordsTable({ rows, search, selection, select, nameFor }: {
  rows: GenericRecord[]; search: string; selection: Set<string> | undefined;
  select: (fields: Set<string> | undefined) => void; nameFor: (id: string) => string | undefined;
}) {
  const available = [...new Set(rows.flatMap(record => Object.keys(record.payload)))];
  const headline = recordTitleFields.find(field => available.includes(field));
  const ordered = headline ? [headline, ...available.filter(field => field !== headline)] : available;
  const defaults = ordered.slice(0, 3);
  const selected = ordered.filter(field => selection?.has(field) ?? defaults.includes(field));
  const simulatedMarketLabel = 'SIMULATED DATA — NOT LIVE MARKET PRICES';
  const hasSimulatedMarketPrices = __PLATFORM_SYNTHETIC_DEMO__
    && rows.some(record => record.payload.dataset === simulatedMarketLabel);

  function setField(field: string, show: boolean) {
    const next = new Set(selection ?? defaults);
    if (show) next.add(field);
    else next.delete(field);
    select(next);
  }

  return <>
    {hasSimulatedMarketPrices && <p className="notice"><strong>{simulatedMarketLabel}</strong></p>}
    <details className="display-fields">
      <summary>Fields to Display <span className="muted">({selected.length})</span></summary>
      <p className="muted">Options come from records on this page. Changes affect only the table.</p>
      {available.length > 0
        ? <div className="field-options">
          {ordered.map(field => <label key={field}>
            <input type="checkbox" checked={selected.includes(field)} onChange={event => setField(field, event.target.checked)} />
            {field}
          </label>)}
          <button type="button" onClick={() => select(undefined)}>Reset fields</button>
        </div>
        : <p className="muted">The visible records have no payload fields.</p>}
    </details>
    <TableRegion label="Records table, scroll horizontally for more columns">
      <table className="records-table records-explorer" style={{ '--record-fields': selected.length } as CSSProperties}>
        <caption className="sr-only">Persisted generic records</caption>
        <thead><tr>
          {selected.map(field => <th className="record-value" scope="col" key={field}>{field}</th>)}
          <th scope="col">Type</th><th scope="col">Source</th><th scope="col">Details</th>
        </tr></thead>
        <tbody>
          {rows.map(record => {
            const path = recordPath(record.record_id);
            const state = { recordsSearch: search };
            return <tr key={record.record_id}>
              {selected.map((field, index) => {
                const value = Object.hasOwn(record.payload, field) ? record.payload[field] : undefined;
                const label = clip(displayValue(value), 130);
                return <td key={field} className="record-value">
                  {index > 0 ? label : <>
                    {value === undefined && <span className="muted">{label} </span>}
                    <Link to={path} state={state}>
                      {value === undefined ? 'View record' : label}
                      <span className="sr-only">{value === undefined ? ` · ${record.record_type}` : ' · View record'}</span>
                    </Link>
                  </>}
                </td>;
              })}
              <th scope="row">
                {selected.length ? record.record_type : <Link to={path} state={state}>
                  {record.record_type}<span className="sr-only"> · View record</span>
                </Link>}
                <small className="muted">Schema {record.schema_version}</small>
              </th>
              <td><Link to={sourcePath(record.source_id)}>{nameFor(record.source_id) ?? 'View source'}</Link></td>
              <td className="record-row-actions">
                <Link to={jobPath(record.job_id)}>Job</Link>
                <EvidenceLink id={record.evidence_reference} compact />
              </td>
            </tr>;
          })}
        </tbody>
      </table>
    </TableRegion>
  </>;
}

function JobQuality({ id }: { id: string }) {
  const load = useCallback((signal: AbortSignal) => getJob(id, signal), [id]);
  const { result, retry } = useResource(load);
  return <section className="panel detail-panel quality-panel" aria-labelledby="quality-title">
    <div className="panel-heading">
      <h2 id="quality-title">Quality for this job</h2>
      {result.state === 'ready' && <Status value={result.data.status} />}
    </div>
    {result.state === 'loading' && <Loading>Loading job quality…</Loading>}
    {result.state === 'error' && (result.error.status === 404
      ? <p className="notice">No job exists for this ID.</p>
      : <RequestProblem error={result.error} resource="job quality" retry={retry} />)}
    {result.state === 'ready' && <>
      {(result.data.status === 'pending' || result.data.status === 'running') && <p className="dashboard-list-note muted">
        The job is still in progress. Published results may change.
      </p>}
      <dl className="result-metadata">
        <div><dt>Accepted</dt><dd><strong data-quality="accepted">{result.data.valid_count}</strong> · Published validated records</dd></div>
        <div><dt>Invalid</dt><dd><strong data-quality="invalid">{result.data.invalid_count}</strong> · <Link to={quarantinePath(id)}>View quarantine</Link></dd></div>
        <div><dt>Duplicates</dt><dd><strong>{result.data.duplicate_count}</strong> · Excluded from accepted records</dd></div>
      </dl>
      <p className="quality-actions"><Link to={jobPath(id)}>View job details</Link><button type="button" onClick={retry}>Refresh quality</button></p>
    </>}
  </section>;
}
