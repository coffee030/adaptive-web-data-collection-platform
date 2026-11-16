import { useCallback } from 'react';
import { useLocation, useParams } from 'react-router';
import { Loading } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { getRecord, recordsForJob, recordsPath } from './api';
import { ResultProblem } from './presentation';
import { RecordInspection } from './RecordInspector';
import { contextFrom, returnLabel, ReturnLink, useResultReturn } from './resultNavigation';

export function RecordDetail() {
  const { recordId = '' } = useParams();
  const { search, state } = useLocation();
  const load = useCallback((signal: AbortSignal) => getRecord(recordId, signal), [recordId]);
  const { result, retry } = useResource(load);
  const record = result.state === 'ready' ? result.data : null;
  const legacy = typeof state?.recordsSearch === 'string' ? recordsPath + '?' + state.recordsSearch : '';
  const back = contextFrom(search) || legacy || (record ? recordsForJob(record.job_id) : recordsPath);
  useResultReturn(result.state !== 'loading');

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><ReturnLink to={back}>{returnLabel(back)}</ReturnLink></nav>
    <div className="page-heading"><h1>Record Details</h1></div>
    {result.state === 'loading' && <div className="panel"><Loading>Loading record…</Loading></div>}
    {result.state === 'error' && <div className="panel"><ResultProblem error={result.error} resource="Record" retry={retry} /></div>}
    {record && <div className="panel record-detail-surface"><RecordInspection key={record.record_id} record={record} /></div>}
  </>;
}
