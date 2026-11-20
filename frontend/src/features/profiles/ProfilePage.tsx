import { BackToCollection } from '../topic-collections/CollectionReturn';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { Loading, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { ApiError } from '../../lib/api';
import { isUncertainWrite } from '../../lib/requestIntent';
import { useResource } from '../../lib/useResource';
import { adapterLabels, getSource, listVersions, sourcePath, sourcesPath } from '../sources/api';
import type { Source } from '../sources/api';
import { allowedInputs } from '../sources/collectionInput';
import { jobSubmissionPath } from '../collection-jobs/api';
import { approveProfile, createProfile, getProfile, previewProfile, profilePath, saveProfile, validateProfile } from './api';
import type { Profile } from './api';
import { compileDraft, draftFrom } from './configuration';
import { ConfigurationEditor } from './ConfigurationEditor';
import { ProfileChecks } from './ProfileChecks';
import { ProfileSuggestion } from './ProfileSuggestion';
import type { Action } from './ProfileChecks';
import { ConfigurationSummary } from './ProfileResults';
import { BackToBindings, OperatorLink, OperatorReturn } from '../operator/navigation';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import { topicsPath } from '../topic-collections/api';

function problem(error: unknown, action: Action) {
  if (error instanceof ApiError) {
    if (error.code === 'draft_revision_conflict') return 'Another edit was saved first. Your changes are still here. Review them before reloading the server version.';
    if (error.code === 'stale_validation') return 'The report or configuration is out of date. Reload the current draft and validate it again.';
    if (error.code === 'source_not_approved') return 'This Source is no longer authorized. Reload the server version to see its current access status.';
    if (error.code === 'local_approval_required') return localOperatorHelp;
    if (error.code === 'destination_denied' || error.code === 'dataset_not_allowed') return 'This sample is outside the allowed inputs for this Source. Check the access policy and choose a permitted sample.';
    if (error.code === 'robots_denied' || error.code === 'access_blocked') return 'The sample request was blocked. Check the Source and choose a permitted sample.';
    if (error.status === 403) return 'The server denied this request. Check the Source and local console settings.';
    if (error.status === 409) return 'The server rejected this state change. Reload the current version before continuing.';
    if (error.status === 422) return 'The server rejected the request. Check the configuration or sample fields.';
    if (error.kind === 'timeout') return 'The request timed out. Check the server state before retrying a write.';
    if (error.status === 503 || error.status === 502 || error.kind === 'network') return 'Backend unavailable. Check the connection and reload the server state.';
    if (error.status === 404) return 'The Source or Profile Version no longer exists.';
    if (error.code === 'invalid_selector') return 'The selector could not be parsed. Review the selector and its type.';
    if (error.code === 'no_records') return 'No records matched the saved item selector. Review the selector or sample.';
    if (error.code) return `The backend rejected ${action} (${error.code}). Check the saved configuration and sample.`;
  }
  return `Could not complete ${action}. Check the server state before trying again.`;
}

export function ProfilePage() {
  const { sourceId = '', profileId } = useParams();
  return <ProfileLoader key={sourceId + '/' + (profileId ?? 'new')} sourceId={sourceId} profileId={profileId} />;
}

function ProfileLoader({ sourceId, profileId }: { sourceId: string; profileId?: string }) {
  const { state } = useLocation();
  const sourceSearch = typeof state?.sourceSearch === 'string' ? state.sourceSearch : '';
  const sourcesSearch = typeof state?.sourcesSearch === 'string' ? state.sourcesSearch : '';
  const load = useCallback(async (signal: AbortSignal) => {
    const [source, profile] = await Promise.all([
      getSource(sourceId, signal), profileId ? getProfile(sourceId, profileId, signal) : undefined,
    ]);
    return { source, profile };
  }, [sourceId, profileId]);
  const { result, retry } = useResource(load);
  return <>
    <nav className="breadcrumb profile-breadcrumb" aria-label="Breadcrumb">
      <OperatorReturn to={sourcesPath + sourcesSearch}>Sources</OperatorReturn>
      <OperatorReturn to={sourcePath(sourceId) + sourceSearch} state={{ sourcesSearch }}>Source details</OperatorReturn>
      <BackToCollection />
      <BackToBindings />
    </nav>
    {result.state === 'loading' && <div className="panel"><Loading>Loading profile workspace…</Loading></div>}
    {result.state === 'error' && <div className="panel">
      {result.error.status === 404 || result.error.code === 'invalid_request'
        ? <p className="notice" role="alert">Source or profile version not found.</p>
        : <RequestProblem error={result.error} resource="profile workspace" retry={retry} />}
    </div>}
    {result.state === 'ready' && <Workspace initialSource={result.data.source} initial={result.data.profile} />}
  </>;
}

function Workspace({ initialSource, initial }: { initialSource: Source; initial?: Profile }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [source, setSource] = useState(initialSource);
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial?.configuration));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Action>();
  const [locked, setLocked] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [latest, setLatest] = useState<Profile>();
  const [recoveredVersions, setRecoveredVersions] = useState<Profile[]>();
  const request = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const recovery = useRef<HTMLElement>(null);
  const allowNavigation = useRef(false);
  const id = source.source_id;
  const immutable = profile && profile.approval_status !== 'draft';

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (failure) feedback.current?.focus(); }, [failure]);
  useEffect(() => { if (latest || recoveredVersions) recovery.current?.focus(); }, [latest, recoveredVersions]);
  const blocker = useBlocker(() => !allowNavigation.current && (dirty || !!busy));
  useEffect(() => {
    if (blocker.state === 'blocked') {
      if (window.confirm('Leave this profile? Unsaved configuration changes will be lost. A request already sent may still complete.')) {
        blocker.proceed();
      } else blocker.reset();
    }
  }, [blocker]);
  useBeforeUnload(useCallback(event => {
    if (dirty || busy) { event.preventDefault(); event.returnValue = ''; }
  }, [dirty, busy]));

  async function run<T>(action: Action, send: (signal: AbortSignal) => Promise<T>, accept: (data: T) => void) {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(action);
    setStatus('');
    setFailure('');
    try {
      const data = await send(controller.signal);
      if (!controller.signal.aborted) accept(data);
    } catch (error) {
      if (controller.signal.aborted) return;
      setFailure(problem(error, action));
      if ((['create', 'save', 'approve'].includes(action) && isUncertainWrite(error))
        || (error instanceof ApiError && (error.status === 409 || error.status === 404 || error.code === 'source_not_approved'
          || error.code === 'local_approval_required'))) {
        setLocked(true);
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setBusy(undefined);
    }
  }

  function saved(next: Profile, message: string) {
    setProfile(next);
    setDraft(draftFrom(next.configuration));
    setDirty(false);
    setErrors({});
    setStatus(message);
    setCheckRevision(value => value + 1);
  }

  function reloadServer() {
    void run('reload', async signal => {
      const currentSource = await getSource(id, signal);
      const currentProfile = profile ? await getProfile(id, profile.profile_version_id, signal) : undefined;
      const versions = profile ? undefined : await listVersions(id, signal);
      return { currentSource, currentProfile, versions };
    }, ({ currentSource, currentProfile, versions }) => {
      setSource(currentSource);
      if (!currentProfile) {
        setRecoveredVersions(versions?.slice(-10).reverse() ?? []);
        return;
      }
      if (dirty && (profile?.revision !== currentProfile.revision || profile.config_hash !== currentProfile.config_hash
        || currentProfile.approval_status !== 'draft')) {
        setLatest(currentProfile);
        return;
      }
      setLocked(false);
      if (dirty) setStatus(`Server is still at revision ${currentProfile.revision}. Your edits are available to save.`);
      else saved(currentProfile, 'Loaded the current server version.');
    });
  }

  async function checkCurrent(signal: AbortSignal) {
    if (!profile) throw new Error('Save the draft first');
    const current = await getProfile(id, profile.profile_version_id, signal);
    if (current.revision !== profile.revision || current.config_hash !== profile.config_hash || current.approval_status !== 'draft') {
      throw new ApiError('http', 409, 'stale_validation');
    }
    return current;
  }

  async function checkSource(signal: AbortSignal) {
    const current = await getSource(id, signal);
    if (!signal.aborted) setSource(current);
    if (current.approval_status !== 'approved') throw new ApiError('http', 403, 'source_not_approved');
  }

  const eligibleForTopicSetup = profile?.approval_status === 'approved' && source.approval_status === 'approved'
    && profile.configuration.adapter_type === 'web' && !!profile.configuration.search;

  return <div className="profile-workspace">
    <div className="page-heading detail-heading operator-title">
      <div>
        <h1>{profile ? `Profile version ${profile.version}` : 'Create draft profile'}</h1>
        <p className="muted">{source.source_name} · {adapterLabels[source.adapter_type]}</p>
      </div>
      <div className="profile-actions">
        {profile && <Status value={profile.approval_status} />}
        {profile?.approval_status === 'approved' && source.approval_status === 'approved' && allowedInputs(source).length > 0 && (
          <Link className="control" to={jobSubmissionPath(id, profile.profile_version_id)}
            state={{ fromSource: id, fromProfile: profile.profile_version_id }}>New Collection Job</Link>
        )}
      </div>
    </div>
    <section className="panel operator-sheet" aria-label="Profile context">
      <dl className="source-metadata">
        <div><dt>Source access authorization</dt><dd><Status value={source.approval_status} /></dd></div>
        {profile && !immutable && <div><dt>Saved revision</dt><dd>{profile.revision}</dd></div>}
        {immutable && <>
          <div><dt>Approval label</dt><dd>{profile.approved_by ?? 'Not recorded'}</dd></div>
          <div><dt>Approved (UTC)</dt><dd><Timestamp value={profile.approved_at} /></dd></div>
        </>}
      </dl>
      {profile && <details className="operator-disclosure">
        <summary>Version technical details</summary>
        <dl className="source-metadata profile-technical">
          <div><dt>Profile version ID</dt><dd className="identifier">{profile.profile_version_id}</dd></div>
          <div><dt>Saved configuration hash</dt><dd className="identifier">{profile.config_hash}</dd></div>
          {immutable && <div><dt>Validation report ID</dt><dd className="identifier">{profile.validation_report_id ?? 'Not recorded'}</dd></div>}
        </dl>
      </details>}
      {profile && !immutable && <nav className="profile-section-nav operator-action-bar" aria-label="Profile sections">
        <button type="button" onClick={() => document.getElementById('config-heading')?.focus()}>Configuration</button>
        <button type="button" onClick={() => document.getElementById('sample-heading')?.focus()}>Sample checks</button>
        <button type="button" onClick={() => document.getElementById('approval-heading')?.focus()}>Approval review</button>
      </nav>}
      {immutable && <div className="operator-action-bar">
        <p>{profile.approval_status === 'approved'
          ? 'This configuration is locked. To change the extraction rules, create a new draft.'
          : 'This retired version is available for inspection. Future collections require an approved version.'}</p>
        <div className="profile-actions">
          {eligibleForTopicSetup && <OperatorLink id="profile-topics" className="control primary"
            to={topicsPath} state={{ profileSourceId: id, profileVersionId: profile.profile_version_id }}>Choose topic for binding</OperatorLink>}
          <Link to={profilePath(id, 'new')} state={state}>Create another draft</Link>
        </div>
      </div>}
    </section>
    {busy && <p className="source-confirmation" role="status">Working on {busy}…</p>}
    {status && <p className="source-confirmation" role="status">{status}</p>}
    {(failure || locked) && <div className="form-problem profile-feedback" ref={feedback} tabIndex={-1} role="alert">
      <p>{failure || 'Compare with the current server state before making another change.'}</p>
      {locked && <button type="button" disabled={!!busy} onClick={reloadServer}>Reload server version</button>}
    </div>}
    {latest && <section className="panel operator-sheet" aria-labelledby="draft-recovery" ref={recovery} tabIndex={-1}>
      <div className="panel-heading"><h2 id="draft-recovery">Server revision {latest.revision}</h2>
        <Status value={latest.approval_status} />
      </div>
      <div className="profile-body">
        <p>Your edits remain in the editor below. Compare them with the saved configuration before replacing them.</p>
        <details className="profile-options"><summary>Inspect server configuration</summary>
          <ConfigurationSummary configuration={latest.configuration} />
        </details>
        <div><button type="button" disabled={!!busy} onClick={() => {
          if (!window.confirm('Replace your unsaved edits with the server configuration?')) return;
          saved(latest, 'Loaded the current server version.');
          setLatest(undefined);
          setLocked(false);
          setFailure('');
        }}>Use server configuration</button></div>
      </div>
    </section>}
    {recoveredVersions && <section className="panel operator-sheet" aria-labelledby="create-recovery" ref={recovery} tabIndex={-1}>
      <div className="panel-heading"><h2 id="create-recovery">Recent saved versions</h2></div>
      <div className="profile-body">
        <p>Inspect the versions on the server before starting another draft. Your unsaved configuration is below.</p>
        {recoveredVersions.length ? <ul>{recoveredVersions.map(row => <li key={row.profile_version_id}>
          <Link to={profilePath(id, row.profile_version_id)} state={state}>Version {row.version} · {row.approval_status}</Link>
        </li>)}</ul> : <p>No versions were returned for this source.</p>}
      </div>
    </section>}
    <section className="panel operator-sheet" aria-labelledby="config-heading">
      <div className="panel-heading">
        <h2 id="config-heading" tabIndex={-1}>Configuration</h2>
        {immutable ? <span className="muted timezone">Read only</span>
          : <span className="muted timezone" role="status">{dirty ? 'Unsaved changes' : profile ? 'Saved draft' : 'New draft'}</span>}
      </div>
      {!profile && source.adapter_type === 'web' && source.approval_status === 'approved' &&
        <ProfileSuggestion sourceId={id} draft={draft} dirty={dirty} disabled={!!busy || locked}
          change={(next, unsaved) => {
            setDraft(next); setDirty(unsaved); setErrors({}); setStatus(''); setFailure('');
          }} />}
      {immutable ? <ConfigurationSummary configuration={profile.configuration} /> : <form className="profile-body profile-editor" noValidate onSubmit={event => {
        event.preventDefault();
        if (locked || busy) return;
        const { configuration, errors: invalid } = compileDraft(draft, source.adapter_type);
        setErrors(invalid);
        if (Object.keys(invalid).length) {
          setFailure('Review the highlighted configuration fields.');
          requestAnimationFrame(() => {
            const field = document.getElementById(Object.keys(invalid)[0]!);
            const details = field?.closest('details');
            if (details) details.open = true;
            field?.focus();
          });
          return;
        }
        if (!profile) {
          void run('create', signal => createProfile(id, configuration, signal), next => {
            allowNavigation.current = true;
            navigate(profilePath(id, next.profile_version_id), { replace: true, state });
          });
        } else {
          void run('save', signal => saveProfile(id, profile.profile_version_id, configuration, profile.revision, signal),
            current => saved(current, 'Draft saved. Validate the updated configuration before approval.'));
        }
      }}>
        <fieldset className="profile-form" disabled={!!busy}>
          <ConfigurationEditor draft={draft} adapter={source.adapter_type} origins={source.allowed_origins} errors={errors}
            change={next => {
              setDraft(next); setDirty(true); setErrors({}); setStatus('');
              if (!locked) setFailure('');
            }} />
          <div className="profile-actions profile-save-row">
            <button className="primary" type="submit" disabled={locked || (!!profile && !dirty)}>
              {profile ? 'Save draft' : 'Create draft'}
            </button>
            {profile && !dirty && !locked && source.approval_status === 'approved' &&
              <button type="button" onClick={() => document.getElementById('sample-heading')?.focus()}>
                Go to sample checks
              </button>}
          </div>
        </fieldset>
      </form>}
    </section>
    {profile && !immutable && <ProfileChecks key={checkRevision} source={source} profile={profile}
      dirty={dirty} locked={locked} busy={!!busy} run={run}
      requests={{
        preview: async (sample, signal) => {
          await Promise.all([checkCurrent(signal), checkSource(signal)]);
          const candidates = await previewProfile(id, profile.profile_version_id, sample, signal);
          await checkCurrent(signal);
          return candidates;
        },
        validate: async (sample, signal) => {
          await Promise.all([checkCurrent(signal), checkSource(signal)]);
          const report = await validateProfile(id, profile.profile_version_id, sample, signal);
          await checkCurrent(signal);
          return report;
        },
        approve: async (report, operator, signal) => {
          if (!isLocalOperator()) throw new ApiError('http', 403, 'local_approval_required');
          const approved = await approveProfile(id, profile.profile_version_id, report, operator, signal);
          if (!signal.aborted) saved(approved, 'Profile approved. The configuration is now read only.');
          return approved;
        },
      }} />}
  </div>;
}
