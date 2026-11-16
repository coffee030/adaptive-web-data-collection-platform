import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { Status, TableRegion, Timestamp } from '../../components/feedback';
import { apiGet, apiPost } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent, type RequestIntent } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { jobPath, jobsPath, newJobPath } from '../collection-jobs/api';
import { ErrorDetails } from '../collection-jobs/presentation';
import { profilePath } from '../profiles/api';
import { RecordExport } from '../results/RecordExport';
import { quarantinePath, recordsForJob, recordsForRequest } from '../results/api';
import { sourcePath } from '../sources/api';
import { ArticleList } from './Articles';
import {
  bindingsPath, categoriesPath, newRequestPath, requestPath, requestsPath, topicsPath,
  type Binding, type Category, type CollectionRequest, type Topic,
} from './api';
import { ActionFeedback, MoreOptions, Page, Resource, useAction, useOptions } from './support';

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
  const [search] = useSearchParams();
  const topicId = search.get('topic_id');
  return topicId ? <PresetTopicRequest key={topicId} topicId={topicId} /> : <TopicRequestForm />;
}

function PresetTopicRequest({ topicId }: { topicId: string }) {
  const load = useCallback(async (signal: AbortSignal) => {
    const topic = await apiGet<Topic>(topicsPath + '/' + encodeURIComponent(topicId), signal);
    const category = await apiGet<Category>(categoriesPath + '/' + encodeURIComponent(topic.category_id), signal);
    return topic.active && category.active ? { topic, category } : undefined;
  }, [topicId]);
  const preset = useResource(load);

  if (preset.result.state === 'ready' && preset.result.data) {
    return <TopicRequestForm preset={preset.result.data} />;
  }
  return <>
    <div className="page-heading"><h1>Collect by topic</h1></div>
    <Resource label="selected topic" state={preset}>
      {() => <p role="status">The selected topic is no longer available.</p>}
    </Resource>
    <Link to={newRequestPath}>Choose another topic</Link>
  </>;
}

function TopicRequestForm({ preset }: { preset?: { category: Category; topic: Topic } }) {
  const navigate = useNavigate();
  const [category, setCategory] = useState(preset?.category.id ?? '');
  const [topic, setTopic] = useState(preset?.topic.id ?? '');
  const [keyword, setKeyword] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const action = useAction();
  const submitRequest = useRequestSubmission();
  const categories = useOptions<Category>(categoriesPath, 'active_only=true');
  const topics = useOptions<Topic>(topicsPath, `active_only=true&category_id=${encodeURIComponent(category)}`, { enabled: !!category });
  const bindings = useOptions<Binding>(bindingsPath(topic), 'eligible_only=true', { enabled: !!topic });
  const categoryRows = preset && !categories.rows.some(row => row.id === preset.category.id)
    ? [preset.category, ...categories.rows] : categories.rows;
  const topicRows = preset && category === preset.category.id && !topics.rows.some(row => row.id === preset.topic.id)
    ? [preset.topic, ...topics.rows] : topics.rows;
  const chosen = selected.filter(id => bindings.rows.some(binding => binding.id === id)).sort();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!topic || !keyword.trim() || !chosen.length) return;
    void action.run(signal => submitRequest(requestsPath, {
      topic_id: topic, keyword: keyword.trim(), binding_ids: chosen,
    }, signal), request => navigate(requestPath(request.id), { replace: true }));
  }

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={requestsPath}>Collection requests</Link></nav>
    <div className="page-heading"><h1>Collect by topic</h1>
      <p className="muted">Choose a category and topic to search its approved sources with one keyword.</p>
    </div>
    <section className="panel detail-panel" aria-label="New topic collection">
      <form className="profile-body" onSubmit={submit}>
        <fieldset className="profile-form" disabled={action.busy}>
          <Resource label="active categories" state={categories.state}>{() => categoryRows.length ? <label>Category
            <select required value={category} onChange={event => {
              setCategory(event.target.value); setTopic(''); setSelected([]);
            }}>
              <option value="">Select a category</option>
              {categoryRows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label> : <p>No active categories are available. <Link to={topicsPath}>Manage categories and topics</Link></p>}</Resource>
          <MoreOptions label="categories" options={categories} />
          {category && <>
            <Resource label="active topics" state={topics.state}>{() => topicRows.length ? <label>Topic
              <select required value={topic} onChange={event => { setTopic(event.target.value); setSelected([]); }}>
                <option value="">Select a topic</option>
                {topicRows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label> : <p>This category has no active topics.</p>}</Resource>
            <MoreOptions label="topics" options={topics} />
          </>}
          {topic && <Resource label="eligible bindings" state={bindings.state}>{() => bindings.rows.length
            ? <fieldset className="profile-field profile-form">
              <legend>Approved sources</legend>
              <p className="muted">Choose up to {maxBindings}. Each selection starts a separate job.</p>
              {bindings.rows.map(row => {
                const checked = chosen.includes(row.id);
                return <label key={row.id} className="check">
                  <input type="checkbox" checked={checked} disabled={!checked && chosen.length >= maxBindings}
                    onChange={() => setSelected(checked ? chosen.filter(id => id !== row.id) : [...chosen, row.id])} />
                  {row.source_name} · Version {row.profile_version}
                </label>;
              })}
              <MoreOptions label="bindings" options={bindings} />
            </fieldset> : <p role="status">This topic has no approved sources available. <Link to={topicsPath}>Manage topics</Link></p>}</Resource>}
          <label>Keyword<input value={keyword} required maxLength={128} onChange={event => setKeyword(event.target.value)} /></label>
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
    if (!collecting || state.refreshing) return;
    let timer: number | undefined;
    function schedule() {
      window.clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        timer = window.setTimeout(() => setRevision(value => value + 1), 2_000);
      }
    }
    schedule();
    document.addEventListener('visibilitychange', schedule);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, [collecting, state.refreshing, revision]);

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={requestsPath}>Collection requests</Link></nav>
    <Resource state={state} label="collection request">{row => <>
      <div className="page-heading detail-heading">
        <div className="collection-text"><h1>{row.topic_name} · {row.keyword}</h1>
          <p className="request-summary muted">
            <span>{row.jobs.length} {row.jobs.length === 1 ? 'source job' : 'source jobs'}</span>
            <span>Created <Timestamp value={row.created_at} /> UTC</span>
            {row.finished_at && <span>Finished <Timestamp value={row.finished_at} /> UTC</span>}
          </p>
        </div>
        <div className="profile-actions">
          <Status value={row.status} />
          <Link className="control" to={recordsForRequest(row.id)}>View request records</Link>
          <button type="button" className="primary" disabled={action.busy} onClick={() =>
            void action.run(signal => submitRequest(path + '/refresh', {}, signal),
              next => navigate(requestPath(next.id)))}>Refresh collection</button>
        </div>
      </div>
      {collecting && <p className="muted" role="status">Status updates while this page is visible.</p>}
      {row.status === 'partial' && <p className="notice outcome" data-status="partial">
        Some jobs did not complete successfully. Review the available results and job details below.
      </p>}
      {row.refresh_of && <p><Link to={requestPath(row.refresh_of)}>View previous run</Link></p>}
      <ActionFeedback action={action} pending="Starting refresh…" />
      <section className="panel detail-panel" aria-labelledby="request-jobs">
        <div className="panel-heading"><h2 id="request-jobs">Child jobs</h2>
          <button type="button" onClick={state.retry} disabled={state.refreshing}>Reload status</button></div>
        <ul className="request-job-list" aria-label="Source jobs" role="list">
          {row.jobs.map(({ job, source_name, profile_version }) => (
            <li key={job.job_id} className="request-job collection-text">
              <div className="request-job-heading">
                <h3><Link to={sourcePath(job.source_id)}>{source_name}</Link></h3>
                <Status value={job.status} />
              </div>
              <p><Link to={profilePath(job.source_id, job.profile_version_id)}>Pinned profile version {profile_version}</Link></p>
              <p>{job.valid_count} accepted · {job.invalid_count} invalid · {job.duplicate_count} duplicates</p>
              <div className="profile-actions">
                <Link to={jobPath(job.job_id)} state={{ requestId }}>Job details</Link>
                <Link to={recordsForJob(job.job_id)}>Records</Link>
                <Link to={quarantinePath(job.job_id)}>Quarantine</Link>
                {job.finished_at && <Link to={jobPath(job.job_id) + '#job-evidence-title'} state={{ requestId }}>Evidence</Link>}
              </div>
              <div className="request-job-timing muted">
                {job.started_at && <div>Started <Timestamp value={job.started_at} /> UTC</div>}
                {job.finished_at && <div>Finished <Timestamp value={job.finished_at} /> UTC</div>}
                {job.next_attempt_at && <div>Retry scheduled for <Timestamp value={job.next_attempt_at} /> UTC</div>}
                {!job.started_at && !job.finished_at && !job.next_attempt_at && 'Waiting to start'}
              </div>
              {job.error && <ErrorDetails error={job.error} />}
              {job.dispatch_error_code && <p>Dispatch error <code>{job.dispatch_error_code}</code></p>}
            </li>
          ))}
        </ul>
      </section>
      <RecordExport scope="request" id={row.id} pending={collecting} />
      <ArticleList requestId={requestId} revision={row.jobs.reduce((total, { job }) => total + job.valid_count, 0)} />
    </>}</Resource>
  </>;
}
