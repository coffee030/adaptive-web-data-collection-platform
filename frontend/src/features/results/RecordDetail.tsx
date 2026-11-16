import { useCallback } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Loading, Status, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getRecord, recordsPath } from './api';
import { JsonViewer } from './JsonViewer';
import { EvidenceLink, Metadata, ProvenanceFields, ResultProblem, clip, displayValue, positionLabel, recordTitleFields } from './presentation';
import { articlePath, requestArticlesPath, requestPath } from '../topic-collections/api';

export function RecordDetail() {
  const { recordId = '' } = useParams();
  const { state } = useLocation();
  const search = typeof state?.recordsSearch === 'string' ? state.recordsSearch : '';
  const load = useCallback((signal: AbortSignal) => getRecord(recordId, signal), [recordId]);
  const { result, retry } = useResource(load);
  const record = result.state === 'ready' ? result.data : null;
  const title = record && recordTitleFields.map(field => record.payload[field])
    .find(value => typeof value === 'string' && value.trim());

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={{ pathname: recordsPath, search }}>Back to Records</Link>
      </nav>
      <div className="page-heading detail-heading">
        <div><h1>Record Details</h1>{title && <p>{clip(String(title), 160)}</p>}</div>
        {record && <div className="profile-actions">
          {record.request_id && <Link to={requestPath(record.request_id)}>Collection request</Link>}
          {record.article_id && <Link to={record.request_id
            ? requestArticlesPath(record.request_id, articlePath(record.article_id)) : articlePath(record.article_id)}>Article history</Link>}
        </div>}
      </div>
      {result.state === 'loading' && <div className="panel"><Loading>Loading record…</Loading></div>}
      {result.state === 'error' && <div className="panel"><ResultProblem error={result.error} resource="Record" retry={retry} /></div>}
      {record && (
        <>
          <section className="panel detail-panel" aria-labelledby="record-overview-title">
            <div className="panel-heading">
              <h2 id="record-overview-title">Record overview</h2>
              <Status value={record.validation_status} />
            </div>
            <dl className="result-metadata">
              <Metadata label="Record type">{record.record_type}</Metadata>
              <Metadata label="Schema version">{record.schema_version}</Metadata>
              <Metadata label="Input position">{positionLabel(record.source_position)}</Metadata>
              <Metadata label="Persisted (UTC)"><Timestamp value={record.created_at} /></Metadata>
            </dl>
          </section>
          <section className="panel detail-panel" aria-labelledby="record-content-title">
            <div className="panel-heading">
              <h2 id="record-content-title">Record content</h2>
              <a href="#payload-title">View full payload</a>
            </div>
            <dl className="result-metadata">
              {Object.entries(record.payload).length === 0 && <Metadata label="Fields">No payload fields</Metadata>}
              {Object.entries(record.payload).map(([name, value]) => <Metadata key={name} label={name}>
                {clip(displayValue(value), 360)}
              </Metadata>)}
            </dl>
          </section>
          <JsonViewer key={record.record_id} value={record.payload} />
          <section className="panel detail-panel" aria-labelledby="record-provenance-title">
            <div className="panel-heading"><h2 id="record-provenance-title">Provenance</h2></div>
            <dl className="result-metadata">
              <ProvenanceFields lineage={record} />
              <Metadata label="Record ID"><code>{record.record_id}</code></Metadata>
              <Metadata label="Evidence ID"><EvidenceLink id={record.evidence_reference}
                state={{ recordId: record.record_id, recordsSearch: search }} /></Metadata>
              <Metadata label="Run ID"><code>{record.provenance.run_id}</code></Metadata>
              {record.source_record_key != null && <Metadata label="Source record key"><code>{record.source_record_key}</code></Metadata>}
              <Metadata label="Profile configuration SHA-256" className="result-hash"><code>{record.provenance.config_hash}</code></Metadata>
              <Metadata label="Deduplication key" className="result-hash"><code>{record.deduplication_key}</code></Metadata>
            </dl>
          </section>
        </>
      )}
    </>
  );
}
