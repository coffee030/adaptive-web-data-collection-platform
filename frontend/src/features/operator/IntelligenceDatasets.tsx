import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { Loading, Status, Timestamp } from '../../components/feedback';
import { getOperatorCredential, ApiError, apiLocal } from '../../lib/api';
import { CompanyRegistry } from './CompanyRegistry';
import { FirstPartyEvidence } from './FirstPartyEvidence';
import { getMarketingCapability } from '../marketing/api';
import { useResource } from '../../lib/useResource';
import { operationsPath } from './OperationsTasks';

interface DatasetStatus { dataset_id: string; state: string; record_count: number; imported_at: string; expires_at: string | null; refresh_error?: string | null }

const refreshIssues: Record<string, string> = {
  refresh_invalid_dataset: 'Check the delivery JSON, grant, record fields and expected import time.',
  refresh_unreadable: 'Check that the dispatcher can read the delivery file.',
  refresh_file_type: 'Deliver the update as a regular JSON file.',
  refresh_too_large: 'Reduce the delivery file to 1 MiB or less.',
  refresh_conflict: 'Prepare the update from the current refresh version below.',
  refresh_grant_changed: 'Review the changed grant and use the operator import to authorize it.',
  grant_restricted: 'Review whether the grant permits this workspace use.',
  future_observation: 'Check the observation timestamps in the delivery.',
};

export function IntelligenceDatasets() {
  const capability = useResource(getMarketingCapability);
  const archiveAvailable = capability.result.state === 'ready' && capability.result.data.demo_intelligence === 'available' && !capability.result.data.company_accounts;
  const [result,setResult] = useState<DatasetStatus>();
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [directory,setDirectory] = useState<string[]>();
  const [more,setMore] = useState(false);
  const [company,setCompany] = useState('');
  const [datasetId,setDatasetId] = useState('');
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
    const token = getOperatorCredential() || String(form.get('token') ?? '').trim();
    const listing = action === 'list' || action === 'more';
    if (!['demo','partner'].includes(mode)) return;
    if (!listing && !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(id)) {
      setError('Choose an existing dataset or enter its identifier.'); return;
    }
    setError(''); setNotice(''); setResult(undefined);
    if (action === 'import' && !form.has('grant')) {
      setError('Confirm you reviewed the written grant and its permitted uses before importing.'); return;
    }
    if (action === 'withdraw' && !window.confirm('Withdraw ' + id + ' and remove its stored evidence and search index?')) return;

    const controller = new AbortController();
    request.current = controller; setPending(true);
    const base = '/marketing/intelligence/operator/' + mode + '/datasets';
    const target = new URLSearchParams();
    if (mode === 'partner' && company) target.set('company',company);
    const endpoint = base + '/' + encodeURIComponent(id) + (target.size ? '?' + target : '');
    try {
      if (listing) {
        const after = action === 'more' ? directory?.at(-1) : undefined;
        if (after) target.set('after',after);
        const ids = await apiLocal<string[]>(base + (target.size ? '?' + target : ''),token,controller.signal);
        setDirectory(previous => after ? [...(previous ?? []), ...ids] : ids);
        setMore(ids.length === 50);
      } else if (action === 'withdraw') {
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
      const reason: Record<string,string> = {
        grant_expired: 'The grant has expired. Obtain current authorization before importing.',
        dataset_withdrawn: 'This identifier has been withdrawn and cannot be reused.',
        grant_restricted: 'The grant does not authorize this workspace. Check the permitted use.',
        operator_required: 'Enter a valid local marketing operator token.',
        identity_conflict: 'One or more record identities conflict with an existing dataset.',
      };
      setError(reason[problem.code ?? ''] ?? (problem.status === 403 ? 'The operator token, workspace permission or grant was rejected.' : problem.status === 422
        ? 'The API rejected the dataset contract. Check the grant and record fields.' : problem.status === 404
        ? 'Dataset status is unavailable in this workspace.' : 'The dataset request could not be completed. Check the API and try again.'));
    } finally {
      if (!controller.signal.aborted) { request.current = undefined; setPending(false); }
    }
  }
  return <div className="operator-research">
    <p className="breadcrumb"><Link to={operationsPath}>Data Operations</Link></p>
    <header className="page-heading"><h1>Intelligence datasets</h1>
      <p>Import a grant-backed partner dataset or an explicitly fictional dataset. Review its status or withdraw it from intelligence reads.</p></header>
    {!loopback ? <p>Open this workspace on 127.0.0.1 to use a local marketing operator token.</p> : <>
      <CompanyRegistry selected={company} onSelect={id=>{
        request.current?.abort();request.current=undefined;setPending(false);setCompany(id);setDatasetId('');
        setDirectory(undefined);setMore(false);setResult(undefined);setNotice('');setError('');
      }}/>
      {company && getOperatorCredential() && <FirstPartyEvidence key={company} company={company}/>}
      <form className="operator-dataset-form" onSubmit={submit} onChange={event => {
        request.current?.abort(); request.current = undefined; setPending(false);
        setResult(undefined); setNotice(''); setError('');
        const field = event.target;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement)) return;
        if (field.name === 'mode' || field.name === 'token') {
          setDirectory(undefined); setMore(false);
          if (field.name === 'mode') setDatasetId('');
        }
      }}>
        <fieldset className="operator-form-block"><legend>Dataset access</legend>
          {archiveAvailable ? <label>Workspace<select name="mode"><option value="partner">Partner data</option><option value="demo">Fictional demo</option></select></label> : <input name="mode" type="hidden" value="partner"/>}
          {!getOperatorCredential() && <label>Marketing operator token<input type="password" name="token" required minLength={24} maxLength={512} autoComplete="off" /></label>}
          <div><button type="submit" value="list" disabled={pending}>List datasets</button></div>
        </fieldset>
        <fieldset className="operator-form-block"><legend>Find a dataset</legend>
          {directory && <div><label>Registered datasets<select value={directory.includes(datasetId) ? datasetId : ''} onChange={event => setDatasetId(event.target.value)}>
          <option value="">{directory.length ? 'Choose a dataset to inspect' : 'No registered datasets'}</option>
          {directory.map(id => <option key={id}>{id}</option>)}</select></label>
          {more && <button type="submit" value="more" disabled={pending}>Load more datasets</button>}</div>}
          <label>Dataset ID<input name="dataset" value={datasetId} onChange={event => setDatasetId(event.target.value)} minLength={1} maxLength={64} pattern={'[A-Za-z0-9][A-Za-z0-9_.\\-]{0,63}'} /></label>
          <div className="operator-research-toolbar"><button type="submit" value="inspect" disabled={pending}>Inspect dataset</button>
            <button type="submit" className="operator-danger" value="withdraw" disabled={pending || !datasetId}>Withdraw dataset</button></div>
        </fieldset>
        <fieldset className="operator-form-block"><legend>Import an authorized file</legend>
          <p>Enter the dataset ID above, then select the partner's JSON delivery.</p>
          <label>Dataset JSON<input type="file" name="file" accept=".json,application/json" /></label>
          <label className="operator-dataset-attest"><input name="grant" type="checkbox" />I reviewed the written grant, including any permission to export a company plan.</label>
          <div><button type="submit" className="primary" value="import" disabled={pending}>Import dataset</button></div>
        </fieldset>
      </form>
      {pending && <Loading>Contacting the dataset service…</Loading>}
      {error && <p role="alert" className="notice">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {result && <section className="operator-research-result" aria-label="Dataset status"><h2>{result.dataset_id}</h2>
        <p><Status value={result.state} /> · {result.record_count} {result.record_count === 1 ? 'record' : 'records'}</p>
        {result.state === 'fallback' && <p>Text search is available. Verify the Granite model and worker in launcher diagnostics.</p>}
        {result.state === 'lexical' && <p>Text search is available. Check again after the indexing worker processes this dataset.</p>}
        {result.state === 'withdrawn' && <p>Removed from customer intelligence. This identifier cannot be imported again.</p>}
        <p>Imported (UTC) <Timestamp value={result.imported_at} /> · Expires (UTC) <Timestamp value={result.expires_at} /></p>
        {result.refresh_error && <p role="status">The last file update was rejected. {refreshIssues[result.refresh_error] ?? "Review the delivery and its grant before retrying."} ({result.refresh_error})</p>}
        <details><summary>Refresh version</summary><p>Use this timestamp as the expected import time for an authorized file update.</p>
          <code>{result.imported_at}</code></details></section>}
    </>}
  </div>;
}
