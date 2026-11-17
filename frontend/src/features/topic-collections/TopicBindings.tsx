import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { Loading, Pagination, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { ApiError, apiGet, apiPost } from '../../lib/api';
import { isUncertainWrite } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { OperatorLink, OperatorReturn } from '../operator/navigation';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import { profilePath, type Profile } from '../profiles/api';
import { useResultReturn } from '../results/resultNavigation';
import { useResultPage } from '../results/useResultPage';
import { listSources, listVersions, sourcePath, sourcesPath, type Source } from '../sources/api';
import { bindingsPath, categoriesPath, listPage, newRequestPath, topicsPath, type Binding, type Category, type Topic } from './api';
import { BackToCollection } from './CollectionReturn';

const pageSize = 20;
type Review = { kind: 'create'; source: Source; profile: Profile; label: string }
  | { kind: 'disable' | 'restore'; row: Binding };

function bindingProblem(error: unknown) {
  if (isUncertainWrite(error)) return 'The change could not be confirmed. Review the refreshed bindings before trying again.';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'local_approval_required': return localOperatorHelp;
      case 'duplicate_binding': return 'This Source and Profile Version already have a binding. To restore a disabled binding, use its row action.';
      case 'source_not_approved': return 'The selected Source is no longer authorized. Review its access policy.';
      case 'profile_not_approved': return 'The selected Profile Version is no longer approved. Choose a current approved keyword-search version.';
      case 'binding_requires_search': return 'This binding requires an approved keyword-search Profile Version.';
    }
    if (error.status === 404) return 'The Topic, Source, Profile Version, or Binding could not be found.';
    if (error.status === 422) return 'Check the approval label and selected Source and Profile Version.';
  }
  return 'The server declined this change. Review the current bindings before trying again.';
}

export function TopicBindings() {
  const { topicId = '' } = useParams();
  return <BindingWorkspace key={topicId} topicId={topicId} />;
}

function BindingWorkspace({ topicId }: { topicId: string }) {
  const { pathname, search, state } = useLocation();
  const { offset, changePage } = useResultPage();
  const path = bindingsPath(topicId);
  const local = isLocalOperator();
  const [revision, setRevision] = useState(0);
  const [sourceId, selectSource] = useState('');
  const [profileId, selectProfile] = useState('');
  const [operator, setOperator] = useState('');
  const [restoreLabel, setRestoreLabel] = useState('');
  const [review, setReview] = useState<Review>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean }>();
  const request = useRef<AbortController | null>(null);
  const reviewBox = useRef<HTMLFormElement>(null);
  const outcome = useRef<HTMLParagraphElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const loadContext = useCallback(async (signal: AbortSignal) => {
    const topic = await apiGet<Topic>(topicsPath + '/' + encodeURIComponent(topicId), signal);
    const category = await apiGet<Category>(categoriesPath + '/' + encodeURIComponent(topic.category_id), signal);
    return { topic, category };
  }, [topicId]);
  const loadBindings = useCallback(async (signal: AbortSignal) => {
    const [rows, eligible] = await Promise.all([
      listPage<Binding>(path, signal, pageSize + 1, offset),
      listPage<Binding>(path, signal, 1, 0, { eligible_only: 'true' }),
    ]);
    return { rows, canCollect: eligible.some(row => row.eligible) };
  }, [path, offset]);
  const context = useResource(loadContext, revision, true);
  const bindings = useResource(loadBindings, revision);
  const sources = useResource(listSources, revision, false, local);
  const loadVersions = useCallback((signal: AbortSignal) => listVersions(sourceId, signal), [sourceId]);
  const profiles = useResource(loadVersions, revision, false, local && !!sourceId);
  const target = context.result.state === 'ready' ? context.result.data : undefined;
  const availableSources = sources.result.state === 'ready'
    ? sources.result.data.filter(row => row.adapter_type === 'web' && row.approval_status === 'approved') : [];
  const availableProfiles = profiles.result.state === 'ready'
    ? profiles.result.data.filter(row => row.approval_status === 'approved'
      && row.configuration.adapter_type === 'web' && !!row.configuration.search) : [];
  const chosenSource = availableSources.find(row => row.source_id === sourceId);
  const chosenProfile = availableProfiles.find(row => row.profile_version_id === profileId);
  const availableBindings = bindings.result.state === 'ready' ? bindings.result.data : undefined;
  const active = !!target?.topic.active && !!target.category.active;
  const actionsReady = local && !busy && !!availableBindings && !!target && !context.refreshing;
  const catalogSearch = typeof state?.catalogSearch === 'string' ? state.catalogSearch : '';
  const catalogParams = new URLSearchParams(catalogSearch);
  if (!catalogParams.has('category_id') && target) catalogParams.set('category_id', target.category.id);
  const catalog = topicsPath + (catalogParams.size ? '?' + catalogParams : '');
  const origin = pathname + search;
  const matchingReview = review && (review.kind === 'create' || availableBindings?.rows.some(row =>
    row.id === review.row.id && row.disabled_at === review.row.disabled_at));

  useResultReturn(!!availableBindings && !!target);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (review) reviewBox.current?.focus(); }, [review]);
  useEffect(() => { if (message && availableBindings) outcome.current?.focus(); }, [message, availableBindings]);
  useEffect(() => { setReview(undefined); }, [offset]);

  function startReview(next: Review) {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setReview(next);
    setRestoreLabel('');
    setMessage(undefined);
  }

  function cancelReview() {
    setReview(undefined);
    requestAnimationFrame(() => trigger.current?.focus());
  }

  async function confirm() {
    if (!review || !matchingReview || !actionsReady || request.current) return;
    const controller = new AbortController();
    const signal = controller.signal;
    const label = restoreLabel.trim();
    if (review.kind === 'restore' && !label) return;
    request.current = controller;
    setBusy(true);
    setMessage(undefined);
    try {
      const row = review.kind === 'create'
        ? await apiPost<Binding>(path, {
          source_id: review.source.source_id, profile_version_id: review.profile.profile_version_id, approved_by: review.label,
        }, signal)
        : review.kind === 'restore'
          ? await apiPost<Binding>(`${path}/${review.row.id}/approve`, { approved_by: label }, signal)
          : await apiPost<Binding>(`${path}/${review.row.id}/disable`, {}, signal);
      if (!signal.aborted) setMessage({ text: review.kind === 'disable' ? 'Binding disabled.'
        : row.eligible ? 'Binding approved and eligible for collection.' : 'Binding approval recorded. It is currently unavailable for collection.' });
    } catch (error) {
      if (!signal.aborted) setMessage({ text: bindingProblem(error), error: true });
    } finally {
      request.current = null;
      if (!signal.aborted) {
        setReview(undefined);
        setBusy(false);
        setRevision(value => value + 1);
      }
    }
  }

  const reviewTitle = review?.kind === 'disable' ? 'Disable binding'
    : review?.kind === 'restore' ? 'Restore binding approval' : 'Approve binding';

  const reviewForm = target && review && matchingReview && <form className="operator-review binding-review" tabIndex={-1} ref={reviewBox}
    aria-labelledby="binding-review-title" onSubmit={event => { event.preventDefault(); void confirm(); }}>
    <h3 id="binding-review-title">{reviewTitle}</h3>
    <p><strong>{review.kind === 'create' ? review.source.source_name : review.row.source_name}</strong>
      {' · '}Version {review.kind === 'create' ? review.profile.version : review.row.profile_version}
      {' · '}{target.topic.name}</p>
    <p>{review.kind === 'disable'
      ? 'Disabling this binding removes it from future collections for this topic. Past requests remain in collection history.'
      : active ? 'Approval makes it available for this topic while its Source and Profile remain eligible.'
        : 'This topic is inactive or belongs to an inactive category. The binding remains unavailable for collection until both are active.'}</p>
    {review.kind === 'create' && <p>Approval label · {review.label}</p>}
    {review.kind === 'restore' && <label className="binding-restore-label">Restoration approval label
      <input required maxLength={128} value={restoreLabel} disabled={busy} onChange={event => setRestoreLabel(event.target.value)} />
    </label>}
    <div className="profile-actions">
      <button type="submit" className={review.kind === 'disable' ? 'operator-danger' : 'primary'}
        disabled={!actionsReady || (review.kind === 'restore' && !restoreLabel.trim())}>{reviewTitle}</button>
      <button type="button" disabled={busy} onClick={cancelReview}>Cancel</button>
      {busy && <span role="status">Saving binding…</span>}
    </div>
  </form>;

  return <>
    <nav className="breadcrumb" aria-label="Breadcrumb">
      <OperatorReturn to={catalog} state={{ profileSourceId: state?.profileSourceId, profileVersionId: state?.profileVersionId }}>
        Categories and topics
      </OperatorReturn>{' '}<BackToCollection />
    </nav>
    {context.result.state === 'loading' && <Loading>Loading topic…</Loading>}
    {context.result.state === 'error' && <RequestProblem error={context.result.error} resource="topic" retry={context.retry} />}
    {target && <>
      <div className="page-heading operator-title"><h1>{target.topic.name}</h1>
        <p>{target.category.name} · {target.topic.active ? 'Active topic' : 'Inactive topic'}</p>
      </div>
      <section className="panel operator-sheet" aria-labelledby="binding-list">
        <div className="panel-heading"><h2 id="binding-list">Source bindings</h2>
          <button type="button" disabled={busy || bindings.refreshing || context.refreshing} onClick={() => {
            setReview(undefined);
            setMessage(undefined);
            setRevision(value => value + 1);
          }}>Refresh bindings</button>
        </div>
        {!target.category.active && <p className="notice muted">The parent category is inactive. This topic is unavailable for future collection.</p>}
        {target.category.active && !target.topic.active && <p className="notice muted">Activate this topic to make it available for future collection.</p>}
        {message && <p ref={outcome} tabIndex={-1} className={message.error ? 'form-problem binding-feedback' : 'source-confirmation binding-feedback'}
          role={message.error ? 'alert' : 'status'}>{message.text}</p>}
        {bindings.result.state === 'loading' && <Loading>Loading bindings…</Loading>}
        {bindings.result.state === 'error' && <RequestProblem error={bindings.result.error} resource="bindings" retry={bindings.retry} />}
        {availableBindings && <>
          {availableBindings.rows.length ? <table className="operator-ledger binding-ledger" role="table">
            <caption className="sr-only">Topic Source Bindings</caption>
            <thead role="rowgroup"><tr role="row">
              <th scope="col">Source and profile</th><th scope="col">Eligibility</th>
              <th scope="col">Approval (UTC)</th>{local && <th scope="col">Action</th>}
            </tr></thead>
            <tbody role="rowgroup">{availableBindings.rows.slice(0, pageSize).map(row => <tr key={row.id} role="row">
              <th scope="row" role="rowheader">
                <OperatorLink id={'binding-source-' + row.id} to={sourcePath(row.source_id)} state={{ bindingOrigin: origin }}>
                  {row.source_name}
                </OperatorLink>
                <small><OperatorLink id={'binding-version-' + row.id} to={profilePath(row.source_id, row.profile_version_id)}
                  state={{ bindingOrigin: origin }} aria-label={`${row.source_name} · Version ${row.profile_version}`}>Version {row.profile_version}
                </OperatorLink></small>
              </th>
              <td role="cell" data-label="Eligibility"><div>
                <Status value={row.disabled_at ? 'disabled' : row.eligible ? 'eligible' : 'unavailable'} />
                {row.disabled_at && <small>Disabled <Timestamp value={row.disabled_at} /></small>}
                {!row.disabled_at && !row.eligible && <small>{active
                  ? 'Check Source access and Profile status.' : 'Topic or Category is inactive.'}</small>}
              </div></td>
              <td role="cell" data-label="Approval (UTC)"><div><span>{row.approved_by}</span><small><Timestamp value={row.approved_at} /></small></div></td>
              {local && <td role="cell" data-label="Action"><button type="button" disabled={!actionsReady || !!review}
                onClick={() => startReview({ kind: row.disabled_at ? 'restore' : 'disable', row })}>
                {row.disabled_at ? 'Review restore' : 'Review disable'}
              </button></td>}
            </tr>)}</tbody>
          </table> : <p className="notice muted">No bindings on this page.</p>}
          {(offset > 0 || availableBindings.rows.length > pageSize) && <Pagination label="Bindings" offset={offset}
            size={pageSize} loaded={availableBindings.rows.length} change={changePage} />}
          <div className="operator-action-bar">
            {availableBindings.canCollect && active && !context.refreshing
              ? <OperatorLink className="control primary" id="continue-topic-collection"
                to={newRequestPath + '?' + new URLSearchParams({ topic_id: target.topic.id })}>
                Continue to New Collection
              </OperatorLink>
              : <p role="status">No eligible bindings for this topic.</p>}
          </div>
        </>}
        {review?.kind !== 'create' && reviewForm}
      </section>
      <section className="panel operator-sheet" aria-labelledby="approve-binding">
        <div className="panel-heading"><h2 id="approve-binding">Approve a source binding</h2></div>
        {!local ? <p className="notice muted">{localOperatorHelp}</p> :
          <form className="profile-body" onSubmit={event => {
            event.preventDefault();
            if (actionsReady && !review && chosenSource && chosenProfile && operator.trim()) {
              startReview({ kind: 'create', source: chosenSource, profile: chosenProfile, label: operator.trim() });
            }
          }}>
            <fieldset className="profile-form" disabled={busy || !!review}>
              <p className="muted">Choose a Source with approved access and an approved keyword-search Profile Version.</p>
              {sources.result.state === 'error'
                ? <RequestProblem error={sources.result.error} resource="authorized sources" retry={sources.retry} />
                : sources.result.state === 'loading' ? <Loading>Loading authorized sources…</Loading>
                : availableSources.length ? <label>Authorized source
                  <select required value={chosenSource?.source_id ?? ''} onChange={event => {
                    selectSource(event.target.value);
                    selectProfile('');
                  }}>
                    <option value="">Select a source</option>
                    {availableSources.map(row => <option key={row.source_id} value={row.source_id}>{row.source_name}</option>)}
                  </select>
                </label> : <p>No authorized web sources. <Link to={sourcesPath}>Review Sources</Link></p>}
              {chosenSource && (profiles.result.state === 'error'
                ? <RequestProblem error={profiles.result.error} resource="approved profiles" retry={profiles.retry} />
                : profiles.result.state === 'loading' ? <Loading>Loading approved profiles…</Loading>
                : availableProfiles.length ? <label>Approved keyword profile
                  <select required value={chosenProfile?.profile_version_id ?? ''} onChange={event => selectProfile(event.target.value)}>
                    <option value="">Select a profile version</option>
                    {availableProfiles.map(row => <option key={row.profile_version_id} value={row.profile_version_id}>
                      Version {row.version}
                    </option>)}
                  </select>
                </label> : <p>No approved keyword-search Profiles for this Source. <Link to={sourcePath(chosenSource.source_id)}>View Source</Link></p>)}
              <label>Operator name
                <input required maxLength={128} value={operator} aria-describedby="binding-label-help"
                  onChange={event => setOperator(event.target.value)} />
              </label>
              <p id="binding-label-help" className="muted">The approval records this self-reported label.</p>
              <div><button type="submit" disabled={!actionsReady || !chosenSource || !chosenProfile || !operator.trim()}>
                Review binding
              </button></div>
            </fieldset>
          </form>}
        {review?.kind === 'create' && reviewForm}
      </section>
    </>}
  </>;
}
