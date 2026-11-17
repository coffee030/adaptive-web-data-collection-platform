import { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Loading, Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { jobPath, sameId } from '../collection-jobs/api';
import { profilePath } from '../profiles/api';
import { getSource, sourcePath } from '../sources/api';
import { articlePath, requestPath } from '../topic-collections/api';
import { evidenceDetailPath, getRecord, recordPath, type RecordDetails } from './api';
import { JsonViewer } from './JsonViewer';
import { Metadata, ResultProblem, clip, displayValue, marketWarning, positionLabel, recordTitle } from './presentation';
import { ContextLink, useReturnPosition } from './resultNavigation';

export function RecordInspector({ recordId, fields, name, close, jobId, requestId, pageState, inPage, retryPage }: {
  recordId: string; fields: string[]; name?: string; close: () => void; jobId: string; requestId: string;
  pageState: 'ready' | 'loading' | 'error'; inPage: boolean; retryPage: () => void;
}) {
  const load = useCallback((signal: AbortSignal) => getRecord(recordId, signal), [recordId]);
  const { result, retry } = useResource(load, 0, false, !!recordId);
  const record = result.state === 'ready' ? result.data : undefined;
  const outsideScope = record && ((jobId && !sameId(jobId, record.job_id))
    || (requestId && !sameId(record.request_id, requestId)));
  const heading = useRef<HTMLHeadingElement>(null);
  const returning = useReturnPosition();

  useEffect(() => {
    const title = heading.current;
    if (returning || !title) return;
    const inspector = title.closest('aside');
    const adjacent = inspector && getComputedStyle(inspector).position === 'sticky';
    title.focus({ preventScroll: true });
    title.scrollIntoView({ block: adjacent ? 'nearest' : 'start' });
  }, [recordId, returning]);

  const show = !outsideScope && pageState === 'ready' && inPage ? record : undefined;
  const ready = Boolean(show);
  useEffect(() => {
    const title = heading.current;
    const inspector = title?.closest('aside');
    if (ready && !returning && document.activeElement === title && inspector
      && getComputedStyle(inspector).position !== 'sticky') {
      title?.scrollIntoView({ block: 'start' });
    }
  }, [ready, returning]);

  return <aside id="record-inspector" className="record-inspector panel" aria-labelledby="inspector-title"
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        event.preventDefault();
        close();
      }
    }}>
    <div className="panel-heading inspector-bar">
      <h2 id="inspector-title" ref={heading} tabIndex={-1}>Record Inspector</h2>
      <button type="button" onClick={close}>Close inspector</button>
    </div>
    {!recordId ? <div className="notice" role="alert"><strong>Invalid Record ID</strong><p>Choose a record from the ledger.</p></div>
      : result.state === 'error' ? <ResultProblem error={result.error} resource="Record" retry={retry} />
        : outsideScope ? <div className="notice" role="status">
          <strong>Record is outside this scope</strong><p>Open the record separately, or select one from the current scope.</p>
          <ContextLink id="inspector-open-outside-scope" to={recordPath(recordId)}>Open Record Details</ContextLink>
        </div> : result.state === 'loading' || pageState === 'loading' ? <Loading>Loading selected record…</Loading>
          : pageState === 'error' ? <div className="notice request-problem">
            <p role="status">The ledger is unavailable. Retry to check this record’s place in the current view.</p>
            <button type="button" onClick={() => { heading.current?.focus(); retryPage(); }}>Retry ledger</button>
          </div>
            : show ? <RecordInspection key={show.record_id} record={show} name={name} fields={fields} />
              : <div className="notice" role="status">
                <strong>Record is outside this page</strong><p>This record exists in the scope on another page.</p>
                <ContextLink id="inspector-open-outside-page" to={recordPath(recordId)}>Open Record Details</ContextLink>
              </div>}
  </aside>;
}

export function RecordInspection({ record, fields, name }: { record: RecordDetails; fields?: string[]; name?: string }) {
  const compact = fields !== undefined;
  const Title = compact ? 'h3' : 'h2';
  const SectionTitle = compact ? 'h4' : 'h3';
  const selected = fields ?? Object.keys(record.payload);
  const type = record.record_type;
  const loadSource = useCallback((signal: AbortSignal) => getSource(record.source_id, signal), [record.source_id]);
  const source = useResource(loadSource, 0, false, !name);
  const sourceName = name ?? (source.result.state === 'ready' ? source.result.data.source_name : undefined);
  const articleQuery = new URLSearchParams({ observation_id: record.record_id });
  if (record.request_id) articleQuery.set('request_id', record.request_id);

  return <div className="record-inspection" data-compact={compact}>
    <header className="inspection-identity">
      <div className="inspection-status"><span>{type}</span><Status value={record.validation_status} /></div>
      <Title className="inspection-title">{clip(recordTitle(record), compact ? 160 : 280)}</Title>
      <p><Link to={sourcePath(record.source_id)} aria-label={`${sourceName ?? 'View source'} · Open source ${record.source_id}`}>
        {sourceName ?? 'View source'}
      </Link></p>
    </header>
    <nav className="inspection-actions" aria-label="Record actions">
      <ContextLink className="control" id="record-open-evidence" to={evidenceDetailPath(record.evidence_reference, record.request_id)}
        aria-label={`View capture evidence · Open evidence ${record.evidence_reference}`}>View capture evidence</ContextLink>
      {record.article_id && <ContextLink id="record-open-article" to={articlePath(record.article_id) + '?' + articleQuery}>
        Article history
      </ContextLink>}
      {compact && <ContextLink id="record-open-detail" to={recordPath(record.record_id)}>Open Record Details</ContextLink>}
    </nav>
    {__PLATFORM_SYNTHETIC_DEMO__ && record.payload.dataset === marketWarning &&
      <p className="ledger-warning"><strong>{marketWarning}</strong></p>}
    <div className="inspection-body">
      <section className="inspection-section" aria-labelledby="record-content-title">
        <SectionTitle id="record-content-title">Record content</SectionTitle>
        {!Object.keys(record.payload).length ? <p className="muted">No payload fields</p>
          : !selected.length ? <p className="muted">No preview fields selected</p>
            : <dl className="inspection-payload">
              {selected.map(field => <Metadata key={field} label={field}>
                {Object.hasOwn(record.payload, field) ? clip(displayValue(record.payload[field]), compact ? 260 : 480) : 'Missing'}
              </Metadata>)}
            </dl>}
      </section>
      <section className="inspection-section" aria-labelledby="record-context-title">
        <SectionTitle id="record-context-title">Collection context</SectionTitle>
        <dl className="inspection-lineage">
          <Metadata label="Collection Job"><Link to={jobPath(record.job_id)}
            aria-label={`View job details · Open job ${record.job_id}`}>View job details</Link></Metadata>
          {record.request_id && <Metadata label="Collection Request"><Link to={requestPath(record.request_id)}>
            View collection request
          </Link></Metadata>}
          <Metadata label="Profile Version"><Link to={profilePath(record.source_id, record.profile_version_id)}
            aria-label={`View pinned version · Open profile version ${record.profile_version_id}`}>View pinned version</Link></Metadata>
          <Metadata label="Persisted (UTC)"><Timestamp value={record.created_at} /></Metadata>
          <Metadata label="Schema version">{record.schema_version}</Metadata>
        </dl>
      </section>
    </div>
    <details className="inspection-disclosure">
      <summary>Provenance and identifiers</summary>
      <dl className="inspection-lineage">
        <Metadata label="Record ID"><code>{record.record_id}</code></Metadata>
        <Metadata label="Job ID"><code>{record.job_id}</code></Metadata>
        <Metadata label="Source ID"><code>{record.source_id}</code></Metadata>
        <Metadata label="Profile Version ID"><code>{record.profile_version_id}</code></Metadata>
        <Metadata label="Evidence ID"><code>{record.evidence_reference}</code></Metadata>
        <Metadata label="Input position">{positionLabel(record.source_position)}</Metadata>
        <Metadata label="Run ID"><code>{record.provenance.run_id}</code></Metadata>
        {record.source_record_key != null && <Metadata label="Source record key"><code>{record.source_record_key}</code></Metadata>}
        <Metadata label="Profile configuration SHA-256"><code>{record.provenance.config_hash}</code></Metadata>
        <Metadata label="Deduplication key"><code>{record.deduplication_key}</code></Metadata>
      </dl>
    </details>
    {compact ? <details className="inspection-disclosure">
      <summary>Full JSON payload</summary>
      <JsonViewer value={record.payload} />
    </details> : <JsonViewer value={record.payload} />}
  </div>;
}
