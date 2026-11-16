import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Status, TableRegion, Timestamp } from '../../components/feedback';
import { apiGet, apiPost } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent, type RequestIntent } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { jobPath, jobsPath, newJobPath } from '../collection-jobs/api';
import { profilePath } from '../profiles/api';
import { ArticleList } from './Articles';
import {
  bindingsPath, listActiveTopics, listCategories, listOptions, newRequestPath,
  requestPath, requestsPath, topicsPath, type Binding, type CollectionRequest,
} from './api';
import { ActionFeedback, Page, Resource, useAction } from './support';

const maxBindings = 4;

function useRequestSubmission() {
  const outstanding = useRef(new Map<string, RequestIntent<object>>());
  return async (path: string, body: object, signal: AbortSignal) => {
    const fingerprint = path + JSON.stringify(body);
    const intent = outstanding.current.get(fingerprint) ?? await prepareRequestIntent(path, body);
    outstanding.current.set(fingerprint, intent);
    function forget() {
      outstanding.current.delete(fingerprint);
      forgetRequestIntent(intent);
    }
    try {
      signal.throwIfAborted();
      const request = await apiPost<CollectionRequest>(path, intent.body, signal);
      forget();
      return request;
    } catch (error) {
      if (!isUncertainWrite(error)) forget();
      throw error;
    }
  };
}

export function NewTopicRequest() {
  const navigate = useNavigate();
  const topics = useResource(listActiveTopics);
  const categories = useResource(listCategories);
  const [topic, setTopic] = useState('');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction();
  const submitRequest = useRequestSubmission();
  const load = useCallback((signal: AbortSignal) => listOptions<Binding>(
    bindingsPath(topic), signal, { eligible_only: 'true' },
  ), [topic]);
  const bindings = useResource(load, 0, false, !!topic);
  const available = bindings.result.state === 'ready' ? bindings.result.data : [];
  const chosen = selected.filter(id => available.some(binding => binding.id === id)).sort();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!topic || !keyword.trim() || !chosen.length) return;
    void action.run(signal => submitRequest(requestsPath, {
      topic_id: topic, keyword: keyword.trim(), binding_ids: chosen,
    }, signal), request => navigate(requestPath(request.id), { replace: true }));
  }

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={requestsPath}>Collection requests</Link></nav>
    <div className="page-heading"><h1>Collect by topic</h1></div>
    <section className="panel detail-panel" aria-label="New topic collection">
      <form className="profile-body" onSubmit={submit}>
        <fieldset className="profile-form" disabled={action.busy}>
          <Resource label="categories" state={categories}>{categoryRows =>
            <Resource label="active topics" state={topics}>{rows => rows.length ? <label>Topic
              <select required value={topic} onChange={event => { setTopic(event.target.value); setSelected([]); }}>
                <option value="">Select a topic</option>
                {rows.map(row => <option key={row.id} value={row.id}>
                  {categoryRows.find(category => category.id === row.category_id)?.name ?? 'Category'} / {row.name}
                </option>)}
              </select>
            </label> : <p>No active topics are available. <Link to={topicsPath}>Manage categories and topics</Link></p>}</Resource>
          }</Resource>
          <label>Keyword<input value={keyword} required maxLength={128} onChange={event => setKeyword(event.target.value)} /></label>
          {topic && <Resource label="eligible bindings" state={bindings}>{rows => rows.length
            ? <fieldset className="profile-field profile-form">
              <legend>Approved sources and profiles</legend>
              <p className="muted">Select up to {maxBindings} bindings.</p>
              {rows.map(row => {
                const checked = chosen.includes(row.id);
                return <label key={row.id} className="check">
                  <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= maxBindings}
                    onChange={() => setSelected(checked ? chosen.filter(id => id !== row.id) : [...chosen, row.id])} />
                  {row.source_name} · Version {row.profile_version}
                </label>;
              })}
            </fieldset> : <p role="status">This topic has no eligible source bindings.</p>}</Resource>}
          <div><button className="primary" type="submit" disabled={!chosen.length || !keyword.trim()}>Start topic collection</button></div>
        </fieldset>
        <ActionFeedback action={action} pending="Submitting collection…" />
      </form>
    </section>
    <p><Link to={newJobPath}>Single-source collection and CSV import</Link></p>
  </>;
}

export function RequestList() {
  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={jobsPath}>Collection Jobs</Link></nav>
    <div className="page-heading detail-heading">
      <h1>Collection requests</h1>
      <Link className="control primary" to={newRequestPath}>Collect by topic</Link>
    </div>
    <section className="panel detail-panel" aria-label="Collection request history">
      <Page<CollectionRequest> path={requestsPath} label="Requests" empty="No topic collection requests yet.">
        {rows => <TableRegion label="Collection requests">
          <table>
            <thead><tr><th scope="col">Topic and keyword</th><th scope="col">Status</th>
              <th scope="col">Jobs</th><th scope="col">Created (UTC)</th></tr></thead>
            <tbody>{rows.map(row => <tr key={row.id}>
              <th scope="row"><Link to={requestPath(row.id)}>{row.topic_name} · {row.keyword}</Link></th>
              <td><Status value={row.status} /></td><td>{row.jobs.length}</td>
              <td><Timestamp value={row.created_at} /></td>
            </tr>)}</tbody>
          </table>
        </TableRegion>}
      </Page>
    </section>
  </>;
}

export function RequestDetails() {
  const { requestId = '' } = useParams();
  return <RequestWorkspace key={requestId} requestId={requestId} />;
}

function RequestWorkspace({ requestId }: { requestId: string }) {
  const navigate = useNavigate();
  const path = requestPath(requestId);
  const [revision, setRevision] = useState(0);
  const load = useCallback((signal: AbortSignal) => apiGet<CollectionRequest>(path, signal), [path]);
  const state = useResource(load, revision, true);
  const { result } = state;
  const collecting = result.state === 'ready' && ['pending', 'running'].includes(result.data.status);
  const action = useAction();
  const submitRequest = useRequestSubmission();

  useEffect(() => {
    if (!collecting) return;
    const timer = window.setInterval(() => setRevision(value => value + 1), 2_000);
    return () => window.clearInterval(timer);
  }, [collecting]);

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={requestsPath}>Collection requests</Link></nav>
    <Resource state={state} label="collection request">{row => <>
      <div className="page-heading detail-heading">
        <div className="collection-text"><h1>{row.topic_name} · {row.keyword}</h1>
          <p className="muted">Created <Timestamp value={row.created_at} /> UTC</p>
        </div>
        <div className="profile-actions">
          <Status value={row.status} />
          <button type="button" className="primary" disabled={action.busy} onClick={() =>
            void action.run(signal => submitRequest(path + '/refresh', {}, signal),
              next => navigate(requestPath(next.id)))}>Refresh collection</button>
        </div>
      </div>
      {row.refresh_of && <p><Link to={requestPath(row.refresh_of)}>View previous run</Link></p>}
      <ActionFeedback action={action} pending="Starting refresh…" />
      <section className="panel detail-panel" aria-labelledby="request-jobs">
        <div className="panel-heading"><h2 id="request-jobs">Child jobs</h2>
          <button type="button" onClick={state.retry}>Reload status</button></div>
        <TableRegion label="Child jobs">
          <table>
            <thead><tr><th scope="col">Source</th><th scope="col">Pinned profile</th>
              <th scope="col">Status</th><th scope="col">Records</th></tr></thead>
            <tbody>{row.jobs.map(({ job, source_name, profile_version }) => <tr key={job.job_id}>
              <th scope="row"><Link to={jobPath(job.job_id)}>{source_name}</Link></th>
              <td><Link to={profilePath(job.source_id, job.profile_version_id)}>Version {profile_version}</Link></td>
              <td><Status value={job.status} />
                {(job.error || job.dispatch_error_code) && <div className="muted">{job.error?.code ?? job.dispatch_error_code}</div>}
              </td>
              <td>{job.valid_count}</td>
            </tr>)}</tbody>
          </table>
        </TableRegion>
      </section>
      <ArticleList requestId={requestId} revision={revision} />
    </>}</Resource>
  </>;
}
