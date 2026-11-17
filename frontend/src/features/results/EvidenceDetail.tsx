import { useCallback } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { Loading, Timestamp } from '../../components/feedback';
import { apiGet } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { jobPath, sameId } from '../collection-jobs/api';
import { requestPath, type CollectionRequest } from '../topic-collections/api';
import { getEvidence, recordsForJob, recordsPath, type EvidenceMetadata } from './api';
import { captureLabel, CopyButton, Metadata, ProvenanceFields, ResultProblem, webLocation } from './presentation';
import { contextFrom, readId, ReturnLink, returnLabel } from './resultNavigation';

export function EvidenceDetail() {
  const { evidenceId = '' } = useParams();
  const { search } = useLocation();
  const [params] = useSearchParams();
  const requestId = readId(params, 'request_id');
  const load = useCallback((signal: AbortSignal) => getEvidence(evidenceId, signal), [evidenceId]);
  const { result, retry } = useResource(load);
  const evidence = result.state === 'ready' ? result.data : null;
  const previous = contextFrom(search);
  const associatedRecords = evidence ? recordsForJob(evidence.job_id) : recordsPath;

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <ReturnLink to={previous || associatedRecords}>{previous ? returnLabel(previous)
        : evidence ? 'Back to Job Records' : 'Back to Records'}</ReturnLink>
    </nav>
    <div className="page-heading detail-heading">
      <div><h1>Evidence Metadata</h1><p className="identifier muted">{evidence?.evidence_id ?? evidenceId}</p></div>
      {evidence && <div className="profile-actions">
        <Link className="control" to={jobPath(evidence.job_id) + '#job-evidence-title'}>View job captures</Link>
        <Link className="control" to={associatedRecords}>View job records</Link>
        {requestId && <EvidenceRequest id={requestId} jobId={evidence.job_id} />}
      </div>}
    </div>
    {result.state === 'loading' && <div className="panel"><Loading>Loading evidence metadata…</Loading></div>}
    {result.state === 'error' && <div className="panel"><ResultProblem error={result.error} resource="Evidence" retry={retry} /></div>}
    {evidence && <EvidenceCapture evidence={evidence} />}
  </>;
}

function EvidenceRequest({ id, jobId }: { id: string; jobId: string }) {
  const load = useCallback((signal: AbortSignal) => apiGet<CollectionRequest>(requestPath(id), signal), [id]);
  const { result } = useResource(load);
  if (result.state !== 'ready' || !result.data.jobs.some(({ job }) => sameId(job.job_id, jobId))) return null;
  return <Link to={requestPath(id)}>View collection request</Link>;
}

function EvidenceCapture({ evidence }: { evidence: EvidenceMetadata }) {
  const kind = captureLabel(evidence);
  return <div className="panel capture-sheet">
    <section aria-labelledby="evidence-capture-title">
      <div className="capture-summary">
        <div><p className="muted">Capture type</p><h2 id="evidence-capture-title">{kind}</h2></div>
        <div><p className="muted">Captured (UTC)</p><Timestamp value={evidence.captured_at} /></div>
      </div>
      <dl className="result-metadata">
        <Metadata label="Adapter">{evidence.adapter_type === 'web' ? 'HTML' : 'CSV'}</Metadata>
        <Metadata label="Page number">{evidence.page_number}</Metadata>
        <Metadata label="Content type">{evidence.content_type ?? 'Not recorded'}</Metadata>
        {evidence.http_status != null && <Metadata label="HTTP status">{evidence.http_status}</Metadata>}
        {evidence.adapter_type === 'csv'
          ? <Metadata label="Dataset ID"><code>{evidence.original_location}</code></Metadata>
          : <Metadata label="Captured location" className="capture-location"><code>{webLocation(evidence.original_location)}</code></Metadata>}
        {evidence.requested_location != null &&
          <Metadata label="Requested location" className="capture-location"><code>{webLocation(evidence.requested_location)}</code></Metadata>}
      </dl>
    </section>
    <section className="capture-integrity" aria-labelledby="evidence-hash-title">
      <div className="capture-hash-heading">
        <h2 id="evidence-hash-title">Content SHA-256</h2>
        <CopyButton key={evidence.evidence_id} label="Copy hash" read={() => evidence.content_hash} />
      </div>
      <code>{evidence.content_hash}</code>
      <p className="muted">Stored hash recorded by the collection backend.</p>
    </section>
    <section className="capture-lineage" aria-labelledby="evidence-provenance-title">
      <div className="panel-heading"><h2 id="evidence-provenance-title">Collection provenance</h2></div>
      <dl className="result-metadata">
        <ProvenanceFields lineage={evidence} />
        <Metadata label="Run ID"><code>{evidence.run_id}</code></Metadata>
        <Metadata label="Profile configuration SHA-256" className="result-hash"><code>{evidence.config_hash}</code></Metadata>
      </dl>
    </section>
  </div>;
}
