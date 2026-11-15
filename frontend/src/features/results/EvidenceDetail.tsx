import { useCallback } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Loading, Timestamp } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getEvidence, recordPath, recordsForJob } from './api';
import { CopyButton, Metadata, ProvenanceFields, ResultProblem } from './presentation';

function webLocation(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin + url.pathname;
  } catch {
    // The API normally returns a controlled HTTP(S) URL.
  }
  return 'Unavailable';
}

export function EvidenceDetail() {
  const { evidenceId = '' } = useParams();
  const { state } = useLocation();
  const load = useCallback((signal: AbortSignal) => getEvidence(evidenceId, signal), [evidenceId]);
  const { result, retry } = useResource(load);
  const evidence = result.state === 'ready' ? result.data : null;

  return (
    <>
      {typeof state?.recordId === 'string' && (
        <nav className="breadcrumb" aria-label="Breadcrumb">
          <Link to={recordPath(state.recordId)} state={{ recordsSearch: state.recordsSearch }}>Back to Record Details</Link>
        </nav>
      )}
      <div className="page-heading detail-heading">
        <div><h1>Evidence Metadata</h1><p className="identifier muted">{evidence?.evidence_id ?? evidenceId}</p></div>
        {evidence && <Link className="control" to={recordsForJob(evidence.job_id)}>View job records</Link>}
      </div>
      {result.state === 'loading' && <div className="panel"><Loading>Loading evidence metadata…</Loading></div>}
      {result.state === 'error' && <div className="panel"><ResultProblem error={result.error} resource="Evidence" retry={retry} /></div>}
      {evidence && (
        <>
          <section className="panel detail-panel" aria-labelledby="evidence-capture-title">
            <div className="panel-heading"><h2 id="evidence-capture-title">Capture details</h2></div>
            <dl className="result-metadata">
              <Metadata label="Adapter">{evidence.adapter_type === 'web' ? 'HTML' : 'CSV'}</Metadata>
              {evidence.capture_kind === 'search' && <Metadata label="Capture type">Search results page</Metadata>}
              {evidence.capture_kind === 'detail' && <Metadata label="Capture type">Detail page</Metadata>}
              {evidence.adapter_type === 'web' && <Metadata label="Page">{evidence.page_number}</Metadata>}
              <Metadata label="Captured (UTC)"><Timestamp value={evidence.captured_at} /></Metadata>
              {evidence.content_type != null && <Metadata label="Content type">{evidence.content_type}</Metadata>}
              {evidence.adapter_type === 'csv'
                ? <Metadata label="Dataset ID"><code>{evidence.original_location}</code></Metadata>
                : <Metadata label="Captured location"><code>{webLocation(evidence.original_location)}</code></Metadata>}
              {evidence.requested_location != null && (
                <Metadata label="Requested location"><code>{webLocation(evidence.requested_location)}</code></Metadata>
              )}
              {evidence.http_status != null && <Metadata label="HTTP status">{evidence.http_status}</Metadata>}
            </dl>
          </section>
          <section className="panel detail-panel" aria-labelledby="evidence-hash-title">
            <div className="panel-heading">
              <h2 id="evidence-hash-title">Content SHA-256</h2>
              <CopyButton key={evidence.evidence_id} label="Copy hash" read={() => evidence.content_hash} />
            </div>
            <div className="notice evidence-hash">
              <code>{evidence.content_hash}</code>
              <p className="muted">SHA-256 recorded by the collection backend.</p>
            </div>
          </section>
          <section className="panel detail-panel" aria-labelledby="evidence-provenance-title">
            <div className="panel-heading"><h2 id="evidence-provenance-title">Provenance</h2></div>
            <dl className="result-metadata">
              <ProvenanceFields lineage={evidence} />
              <Metadata label="Run ID"><code>{evidence.run_id}</code></Metadata>
              <Metadata label="Profile configuration SHA-256" className="result-hash"><code>{evidence.config_hash}</code></Metadata>
            </dl>
          </section>
        </>
      )}
    </>
  );
}
