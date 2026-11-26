import { useCallback, useEffect, useRef, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Loading, Pagination, RequestProblem, Status } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { getJob, jobInProgress, jobPath, maxOffset, sameId } from '../collection-jobs/api';
import { listSources, sourcePath } from '../sources/api';
import { articlesPath, newRequestPath, requestArticlesPath, requestPath, type CollectionRequest } from '../topic-collections/api';
import { listRecords, quarantinePath, recordsPath, type GenericRecord } from './api';
import { useDisplayFields } from './displayFields';
import { RecordInspector } from './RecordInspector';
import { clip, displayValue, marketWarning, recordTitle } from './presentation';
import { contextFrom, ContextLink, readId, readOffset, rememberPosition, ReturnLink, useResultReturn } from './resultNavigation';

const pageSize = 10;
const noRecords: GenericRecord[] = [];
const rowTrigger = (id: string) => 'inspect-record-' + id;

export function RecordsExplorer() {
  const [search] = useSearchParams();
  const jobId = readId(search, 'job_id');
  const requestId = readId(search, 'request_id');
  const invalidJob = search.has('job_id') && !jobId;
  const invalidRequest = search.has('request_id') && !requestId;
  const conflict = search.has('job_id') && search.has('request_id');
  const scopeProblem = conflict ? 'Choose either a Job or a Collection Request'
    : invalidJob ? 'Invalid Job ID' : invalidRequest ? 'Invalid Collection Request ID' : '';
  return <Ledger key={scopeProblem || (requestId ? 'request:' + requestId : 'job:' + jobId)}
    jobId={jobId} requestId={requestId} scopeProblem={scopeProblem} invalidJob={invalidJob} />;
}

function Ledger({ jobId, requestId, scopeProblem, invalidJob }: {
  jobId: string; requestId: string; scopeProblem: string; invalidJob: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const offset = readOffset(search);
  const order = search.get('order') === 'newest' ? 'newest' : 'oldest';
  const recordId = readId(search, 'record_id');
  const inspecting = search.has('record_id') && !scopeProblem;
  const openFrom = location.state?.ledgerOrigin;
  const priorSelection = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const load = useCallback((signal: AbortSignal) =>
    listRecords(jobId, pageSize, offset, signal, { requestId, order }), [jobId, requestId, offset, order]);
  const { result, retry } = useResource(load, 0, true, !scopeProblem);
  const sources = useResource(listSources, 0, true, !scopeProblem);
  const rows = result.state === 'ready' ? result.data.slice(0, pageSize) : noRecords;
  const fields = useDisplayFields(requestId ? 'request:' + requestId : jobId ? 'job:' + jobId : 'all', rows);
  const member = rows.find(record => sameId(recordId, record.record_id));

  function retryRecords() {
    heading.current?.focus({ preventScroll: true });
    retry();
  }

  function sourceName(id: string) {
    return sources.result.state === 'ready'
      ? sources.result.data.find(source => sameId(id, source.source_id))?.source_name : undefined;
  }

  useResultReturn(result.state !== 'loading');

  useEffect(() => {
    if (!inspecting && priorSelection.current && result.state === 'ready') {
      const trigger = document.getElementById(rowTrigger(priorSelection.current));
      const frame = requestAnimationFrame(() => {
        const target = trigger ?? heading.current;
        target?.focus({ preventScroll: true });
        const rect = target?.getBoundingClientRect();
        if (rect && (rect.top < 0 || rect.bottom > window.innerHeight)) target?.scrollIntoView({ block: 'nearest' });
      });
      priorSelection.current = '';
      return () => cancelAnimationFrame(frame);
    }
    if (inspecting && recordId) priorSelection.current = member?.record_id ?? recordId;
  }, [inspecting, member?.record_id, recordId, result.state]);

  function goToScope(nextJob = '') {
    const params = new URLSearchParams();
    if (nextJob) params.set('job_id', nextJob);
    if (order === 'newest') params.set('order', order);
    heading.current?.focus({ preventScroll: true });
    setSearch(params, { preventScrollReset: true });
  }

  function applyFilter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    goToScope(String(new FormData(event.currentTarget).get('job_id') ?? '').trim());
  }

  function changePage(next: number) {
    const params = new URLSearchParams(search);
    if (next) params.set('offset', String(next));
    else params.delete('offset');
    params.delete('record_id');
    heading.current?.focus();
    setSearch(params);
  }

  function inspect(record: GenericRecord) {
    const params = new URLSearchParams(search);
    const origin = params.toString();
    if (sameId(recordId, record.record_id)) {
      closeInspector();
      return;
    }
    rememberPosition(location.key, rowTrigger(record.record_id));
    params.set('record_id', record.record_id);
    setSearch(params, { preventScrollReset: true, state: { ledgerOrigin: origin } });
  }

  function closeInspector() {
    const params = new URLSearchParams(search);
    params.delete('record_id');
    if (openFrom === params.toString()) {
      void navigate(-1);
    } else {
      setSearch(params, { replace: true, preventScrollReset: true });
    }
  }

  const scoped = Boolean(jobId || requestId);
  const previous = contextFrom(location.search);
  const jobOrigin = jobId && previous.split(/[?#]/, 1)[0] === jobPath(jobId) ? previous : '';
  const scopeLabel = requestId ? 'Records from this Collection Request' : jobId ? 'Records from this Job'
    : 'All persisted validated records';

  return <>
    <div className="page-heading detail-heading ledger-heading">
      <div><h1>Data Explorer</h1><p className="muted">{scopeProblem ? 'Record scope needs attention' : scopeLabel}</p></div>
      {!scopeProblem && <div className="ledger-navigation">
        {requestId && <Link to={requestPath(requestId)}>View collection request</Link>}
        {jobId && (jobOrigin ? <ReturnLink to={jobOrigin}>Back to Job</ReturnLink> : <Link to={jobPath(jobId)}>View job details</Link>)}
        <ContextLink id="ledger-browse-articles" to={requestId ? requestArticlesPath(requestId) : articlesPath}>Browse articles</ContextLink>
      </div>}
    </div>
    {!scopeProblem && requestId && <RequestScope id={requestId} clear={() => goToScope()} showError={result.state === 'ready'} />}
    <div className="record-workspace">
      <div className="record-workspace-layout" data-inspecting={inspecting}>
        <section className="panel record-ledger" aria-labelledby="ledger-title">
          <div className="panel-heading ledger-toolbar">
            <h2 id="ledger-title" ref={heading} tabIndex={-1}>Records</h2>
            {!scopeProblem && <div className="ledger-controls">
              <label className="ledger-sort"><span className="ledger-sort-label">Saved</span>
                <select aria-label="Sort by persistence time" value={order} onChange={event => {
                  const params = new URLSearchParams(search);
                  params.delete('offset');
                  params.delete('record_id');
                  params.set('order', event.target.value);
                  setSearch(params, { preventScrollReset: true });
                }}>
                  <option value="oldest">Oldest first</option>
                  <option value="newest">Newest first</option>
                </select>
              </label>
              <button type="button" aria-label="Refresh records" onClick={retry} disabled={result.state === 'loading'}>Refresh</button>
            </div>}
          </div>

          {(!requestId || scopeProblem) &&
            <form className="ledger-scope" key={search.get('job_id') ?? ''} onSubmit={applyFilter}>
              <label className="ledger-job-filter">
                Job ID
                <input name="job_id" defaultValue={search.get('job_id') ?? ''} maxLength={128}
                  placeholder="Enter a Job UUID" aria-invalid={invalidJob || undefined}
                  aria-describedby={scopeProblem ? 'ledger-scope-problem' : undefined} />
              </label>
              <button type="submit">Apply filter</button>
              {(scoped || scopeProblem) && <button type="button" onClick={() => goToScope()}>Clear filter</button>}
            </form>
          }
          {scopeProblem ? <div className="notice" role="alert" id="ledger-scope-problem">
            <strong>{scopeProblem}</strong>
            <p>Enter a valid Job ID, open the Collection Request again, or clear the current scope.</p>
          </div> : <>
            {result.state === 'loading' && <Loading>Loading records…</Loading>}
            {result.state === 'error' && <RequestProblem error={result.error} resource="records" retry={retryRecords} />}
            {result.state === 'ready' && <>
              {rows.length === 0 ? <div className="notice ledger-empty">
                <div role="status">
                  <strong>{offset ? 'This page is empty' : requestId ? 'No records for this collection request'
                    : jobId ? 'No records match this Job ID' : 'No records yet'}</strong>
                  <p>{offset ? 'Return to the first page to see the current results.' : requestId
                    ? 'Check the collection request for its job outcomes.' : jobId
                      ? 'This job has no published validated records. Check its outcome and quality summary.'
                      : 'Validated records appear here after a collection publishes results.'}</p>
                </div>
                {offset ? <button type="button" onClick={() => changePage(0)}>First page</button>
                  : !scoped && <Link to={newRequestPath}>Start a collection</Link>}
              </div> : <>
                {__PLATFORM_SYNTHETIC_DEMO__ && rows.some(record => record.payload.dataset === marketWarning) &&
                  <p className="ledger-warning"><strong>{marketWarning}</strong></p>}
                <DisplayFields {...fields} />
                <div className="ledger-columns" aria-hidden="true">
                  <span>Record</span><span>Source</span><span>Extracted fields</span>
                </div>
                <ul className="ledger-rows" role="list" aria-label="Persisted generic records">
                  {rows.map(record => {
                    const selected = sameId(recordId, record.record_id);
                    const title = recordTitle(record);
                    return <li className="ledger-row" key={record.record_id} data-selected={selected}>
                      <div className="ledger-identity">
                        <button className="ledger-record" type="button" id={rowTrigger(record.record_id)}
                          aria-label={`Inspect ${clip(title, 104)}`} aria-expanded={selected}
                          aria-controls={selected ? 'record-inspector' : undefined} onClick={() => inspect(record)}>
                          {clip(title, 104)}
                        </button>
                        <span className="ledger-type">{record.record_type} <span className="muted">· Schema {record.schema_version}</span></span>
                      </div>
                      <div className="ledger-source">
                        <Link to={sourcePath(record.source_id)}>{sourceName(record.source_id) ?? 'View source'}</Link>
                      </div>
                      <PayloadFields payload={record.payload} fields={fields.selected} />
                    </li>;
                  })}
                </ul>
              </>}
              {(offset > 0 || rows.length > 0) && <Pagination label="Records" offset={offset} size={pageSize}
                loaded={result.data.length} maxOffset={maxOffset} change={changePage} />}
            </>}
          </>}
        </section>
        {inspecting && <RecordInspector recordId={recordId} jobId={jobId} requestId={requestId}
          pageState={result.state} inPage={Boolean(member)} fields={fields.selected}
          name={member && sourceName(member.source_id)} close={closeInspector} retryPage={retry} />}
      </div>
    </div>
    {!scopeProblem && jobId && result.state === 'ready' && <div className="ledger-quality"><JobQuality id={jobId} /></div>}
  </>;
}

function DisplayFields({ available, selected, select, limitReached }: ReturnType<typeof useDisplayFields>) {
  return <details className="display-fields">
    <summary>Fields to Display <span className="muted">({selected.length})</span></summary>
    <p className="muted">Options come from pages you’ve opened in this scope. Selections change the ledger and inspector previews.</p>
    {limitReached && <p className="muted">This list keeps up to 160 field names for the current scope.</p>}
    {available.length ? <>
      <div className="field-options">{available.map(field => <label key={field}>
        <input type="checkbox" checked={selected.includes(field)} onChange={event =>
          select(event.target.checked ? [...selected, field] : selected.filter(name => name !== field))} />
        {field}
      </label>)}</div>
      <button type="button" onClick={() => select(undefined)}>Reset fields</button>
    </> : <p className="muted">The records on this page have no payload fields.</p>}
  </details>;
}

function PayloadFields({ payload, fields }: { payload: GenericRecord['payload']; fields: string[] }) {
  if (!Object.keys(payload).length) return <p className="muted ledger-field-empty">No payload fields</p>;
  if (!fields.length) return <p className="muted ledger-field-empty">No preview fields selected</p>;
  return <dl className="ledger-fields">
    {fields.map(field => <div key={field}><dt>{field}</dt>
      <dd className={Object.hasOwn(payload, field) ? undefined : 'muted'}>
        {Object.hasOwn(payload, field) ? clip(displayValue(payload[field]), 96) : 'Missing'}
      </dd></div>)}
  </dl>;
}

function RequestScope({ id, clear, showError }: { id: string; clear: () => void; showError: boolean }) {
  const load = useCallback((signal: AbortSignal) => apiGet<CollectionRequest>(requestPath(id), signal), [id]);
  const { result, retry } = useResource(load);
  return <div className="ledger-request">
    {result.state === 'loading' && <span role="status">Loading collection request…</span>}
    {showError && result.state === 'error' && <RequestProblem error={result.error} resource="collection request" retry={retry} />}
    {result.state === 'ready' && <>
      <span><strong>{result.data.topic_name}</strong> · {result.data.keyword}</span>
      <Status value={result.data.status} />
      {(result.data.status === 'partial' || result.data.status === 'failed') &&
        <Link to={requestPath(id)}>Review child job outcomes</Link>}
    </>}
    <button className="clear-ledger-scope" type="button" onClick={clear}>Clear filter</button>
  </div>;
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
      {jobInProgress(result.data.status) && <p className="dashboard-list-note muted">
        The job is still in progress. Published results may change.
      </p>}
      {result.data.status === 'paused' && <p className="dashboard-list-note muted">Collection is paused. Resume it from Job Details.</p>}
      <dl className="result-metadata">
        <div><dt>Accepted</dt><dd><strong data-quality="accepted">{result.data.valid_count}</strong> · Published validated records</dd></div>
        <div><dt>Invalid</dt><dd><strong data-quality="invalid">{result.data.invalid_count}</strong> · <Link to={quarantinePath(id)}>View quarantine</Link></dd></div>
        <div><dt>Duplicates</dt><dd><strong>{result.data.duplicate_count}</strong> · Excluded from accepted records</dd></div>
      </dl>
      <p className="quality-actions"><Link to={jobPath(id)}>View job details</Link><button type="button" onClick={retry}>Refresh quality</button></p>
    </>}
  </section>;
}
