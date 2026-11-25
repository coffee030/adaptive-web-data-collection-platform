import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loading, Status, Timestamp } from '../../components/feedback';
import { ApiError, apiLocal } from '../../lib/api';
import { operationsPath } from './OperationsTasks';

interface DatasetStatus { dataset_id: string; state: string; record_count: number; imported_at: string; expires_at: string | null }

export function IntelligenceDatasets() {
  const [result,setResult] = useState<DatasetStatus>();
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [pending,setPending] = useState(false);
  const request = useRef<AbortController>(undefined);
  useEffect(() => () => request.current?.abort(), []);
  const loopback = window.location.protocol === 'http:' && window.location.hostname === '127.0.0.1';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const form = new FormData(event.currentTarget);
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') ?? 'inspect';
    const mode = String(form.get('mode') ?? '');
    const id = String(form.get('dataset') ?? '');
    const token = String(form.get('token') ?? '').trim();
    if (!['demo','partner'].includes(mode) || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) return;
    setError(''); setNotice(''); setResult(undefined);
    if (action === 'import' && !form.has('grant')) {
      setError('Confirm you reviewed the written grant and its permitted uses before importing.'); return;
    }
    if (action === 'withdraw' && !window.confirm('Withdraw this dataset and remove its stored evidence and search index?')) return;

    const controller = new AbortController();
    request.current = controller; setPending(true);
    const endpoint = '/marketing/intelligence/operator/' + mode + '/datasets/' + encodeURIComponent(id);
    try {
      if (action === 'withdraw') {
        await apiLocal<void>(endpoint,token,controller.signal,'DELETE'); setNotice('Dataset withdrawn from the intelligence workspace.');
      } else if (action === 'import') {
        const file = form.get('file');
        if (!(file instanceof File) || !file.size) {
          setError('Choose an authorized dataset JSON file.'); return;
        }
        let payload: unknown;
        try { payload = JSON.parse(await file.text()); }
        catch { setError('The selected file is not valid JSON.'); return; }
        if (!payload || typeof payload !== 'object' || !('grant' in payload) || !('records' in payload) || !Array.isArray(payload.records)) {
          setError('The JSON file needs a grant and a records list.'); return;
        }
        const saved = await apiLocal<DatasetStatus>(endpoint,token,controller.signal,'PUT',payload);
        setResult(saved); setNotice('Authorized dataset accepted. Review its indexing status below.');
      } else setResult(await apiLocal<DatasetStatus>(endpoint,token,controller.signal));
    } catch (failure) {
      if (controller.signal.aborted) return;
      const problem = failure instanceof ApiError ? failure : new ApiError('invalid-response');
      setError(problem.status === 403 ? 'The operator token, workspace permission or grant was rejected.' : problem.status === 422
        ? 'The API rejected the dataset contract. Check the grant and record fields.' : problem.status === 404
        ? 'Dataset status is unavailable in this workspace.' : 'The dataset request could not be completed. Check the API and try again.');
    } finally {
      if (!controller.signal.aborted) { request.current = undefined; setPending(false); }
    }
  }
  return <div className="operator-research">
    <p className="breadcrumb"><Link to={operationsPath}>Data Operations</Link></p>
    <header className="page-heading"><h1>Intelligence datasets</h1>
      <p>Import a grant-backed partner dataset or an explicitly fictional dataset. Review its status or withdraw it from intelligence reads.</p></header>
    {!loopback ? <p>Open this workspace on 127.0.0.1 to use a local marketing operator token.</p> : <>
      <form className="operator-dataset-form" onSubmit={submit} onChange={() => { setResult(undefined); setNotice(''); }}>
        <label>Workspace<select name="mode"><option value="partner">Partner data</option><option value="demo">Fictional demo</option></select></label>
        <label>Dataset ID<input name="dataset" required minLength={1} maxLength={64} pattern={'[A-Za-z0-9][A-Za-z0-9_.\\-]{0,63}'} /></label>
        <label>Marketing operator token<input type="password" name="token" required minLength={24} maxLength={512} autoComplete="off" /></label>
        <label>Dataset JSON<input type="file" name="file" accept=".json,application/json" /></label>
        <label className="operator-dataset-attest"><input name="grant" type="checkbox" />I reviewed the written grant and its permitted uses for this workspace.</label>
        <div className="operator-research-toolbar">
          <button type="submit" value="inspect" disabled={pending}>Inspect dataset</button>
          <button type="submit" value="import" disabled={pending}>Import dataset</button>
          <button type="submit" value="withdraw" disabled={pending}>Withdraw dataset</button></div>
      </form>
      {pending && <Loading>Contacting the dataset service…</Loading>}
      {error && <p role="alert" className="notice">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {result && <section className="operator-research-result" aria-label="Dataset status"><h2>{result.dataset_id}</h2>
        <p><Status value={result.state} /> · {result.record_count} records</p>
        <p>Imported (UTC) <Timestamp value={result.imported_at} /> · Expires (UTC) <Timestamp value={result.expires_at} /></p></section>}
    </>}
  </div>;
}