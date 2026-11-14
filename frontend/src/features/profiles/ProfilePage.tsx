import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useBeforeUnload, useBlocker, useLocation, useNavigate, useParams } from 'react-router';
import { Loading, RequestProblem, Status, Timestamp } from '../../components/feedback';
import { ApiError } from '../../lib/api';
import { useResource } from '../../lib/useResource';
import { adapterLabels, getSource, sourcePath, sourcesPath } from '../sources/api';
import type { Source } from '../sources/api';
import { allowedInputs } from '../sources/collectionInput';
import { jobSubmissionPath } from '../collection-jobs/api';
import { approveProfile, createProfile, getProfile, previewProfile, profilePath, saveProfile, validateProfile } from './api';
import type { Profile } from './api';
import { compileDraft, draftFrom } from './configuration';
import { ConfigurationEditor } from './ConfigurationEditor';
import { ProfileChecks } from './ProfileChecks';
import type { Action } from './ProfileChecks';
import { ConfigurationSummary } from './ProfileResults';

function problem(error: unknown, action: Action) {
  if (error instanceof ApiError) {
    if (error.code === 'draft_revision_conflict') return 'Another edit was saved first. Your changes are still here. Review them before reloading the server version.';
    if (error.code === 'stale_validation') return 'The report or configuration is out of date. Reload the current draft and validate it again.';
    if (error.code === 'source_not_approved' || error.status === 403) return 'Source access is unavailable or the local approval request was denied. Check the Source and demo settings.';
    if (error.status === 409) return 'The server rejected this state change. Reload the current version before continuing.';
    if (error.status === 422) return 'The server rejected the request. Check the configuration or sample fields.';
    if (error.kind === 'timeout') return 'The request timed out. Check the server state before retrying a write.';
    if (error.status === 503 || error.status === 502 || error.kind === 'network') return 'Backend unavailable. Check the connection and reload the server state.';
    if (error.status === 404) return 'The Source or Profile Version no longer exists.';
    if (error.code === 'invalid_selector') return 'The selector could not be parsed. Review the selector and its type.';
    if (error.code === 'no_records') return 'No records matched the saved item selector. Review the selector or sample.';
    if (error.code === 'destination_denied') return 'The sample is outside the controlled origins permitted for this Source.';
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
      <Link to={{ pathname: sourcesPath, search: sourcesSearch }}>Sources</Link>
      <Link to={{ pathname: sourcePath(sourceId), search: sourceSearch }} state={{ sourcesSearch }}>Source details</Link>
    </nav>
    {result.state === 'loading' && <div className="panel"><Loading>Loading profile workspace…</Loading></div>}
    {result.state === 'error' && <div className="panel">
      {result.error.status === 404 || result.error.code === 'invalid_request'
        ? <p className="notice" role="alert">Source or profile version not found.</p>
        : <RequestProblem error={result.error} resource="profile workspace" retry={retry} />}
    </div>}
    {result.state === 'ready' && <Workspace source={result.data.source} initial={result.data.profile} reload={retry} />}
  </>;
}

function Workspace({ source, initial, reload }: { source: Source; initial?: Profile; reload: () => void }) {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState(() => draftFrom(initial?.configuration));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<Action>();
  const [locked, setLocked] = useState(false);
  const [checkRevision, setCheckRevision] = useState(0);
  const [status, setStatus] = useState('');
  const [failure, setFailure] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const request = useRef<AbortController | null>(null);
  const feedback = useRef<HTMLDivElement>(null);
  const allowNavigation = useRef(false);
  const id = source.source_id;
  const immutable = profile && profile.approval_status !== 'draft';

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (failure) feedback.current?.focus(); }, [failure]);
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
      const ambiguous = !(error instanceof ApiError) || error.kind !== 'http' || (error.status ?? 0) >= 500;
      if ((['create', 'save', 'approve'].includes(action) && ambiguous)
        || (error instanceof ApiError && (error.status === 409 || error.status === 403))) {
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

  async function checkCurrent(signal: AbortSignal) {
    if (!profile) throw new Error('Save the draft first');
    const current = await getProfile(id, profile.profile_version_id, signal);
    if (current.revision !== profile.revision || current.config_hash !== profile.config_hash || current.approval_status !== 'draft') {
      throw new ApiError('http', 409, 'stale_validation');
    }
    return current;
  }

  return <>
    <div className="page-heading detail-heading">
      <div className="source-heading">
        <h1>{profile ? `Profile version ${profile.version}` : 'Create draft profile'}</h1>
        <p className="muted">{source.source_name} · {adapterLabels[source.adapter_type]}</p>
      </div>
      <div className="profile-actions">
        {profile && <Status value={profile.approval_status} />}
        {profile?.approval_status === 'approved' && source.approval_status === 'approved' && allowedInputs(source).length > 0 && (
          <Link className="control primary" to={jobSubmissionPath(id, profile.profile_version_id)}
            state={{ fromSource: id, fromProfile: profile.profile_version_id }}>New Collection Job</Link>
        )}
      </div>
    </div>
    <section className="panel detail-panel" aria-label="Profile context">
      <dl className="source-metadata">
        <div><dt>Source access authorization</dt><dd><Status value={source.approval_status} /></dd></div>
        {profile && <>
          <div><dt>Profile version ID</dt><dd className="identifier">{profile.profile_version_id}</dd></div>
          <div className="source-policy"><dt>Saved configuration hash</dt><dd className="identifier">{profile.config_hash}</dd></div>
        </>}
        {immutable && <>
          <div><dt>Approver</dt><dd>{profile.approved_by ?? 'Not recorded'}</dd></div>
          <div><dt>Approved (UTC)</dt><dd><Timestamp value={profile.approved_at} /></dd></div>
          <div><dt>Validation report ID</dt><dd className="identifier">{profile.validation_report_id ?? 'Not recorded'}</dd></div>
        </>}
      </dl>
    </section>
    {busy && <p className="source-confirmation" role="status">Working on {busy}…</p>}
    {status && <p className="source-confirmation" role="status">{status}</p>}
    {failure && <div className="form-problem profile-feedback" ref={feedback} tabIndex={-1} role="alert">
      <p>{failure}</p>
      {locked && <button type="button" onClick={() => {
        if (!dirty || window.confirm('Discard unsaved changes and load the server version?')) reload();
      }}>Reload server version</button>}
    </div>}
    <section className="panel detail-panel" aria-labelledby="config-heading">
      <div className="panel-heading">
        <h2 id="config-heading">Configuration</h2>
        {immutable ? <span className="muted timezone">Read only</span>
          : dirty && <span className="muted timezone" role="status">Unsaved changes</span>}
      </div>
      {immutable ? <>
        <ConfigurationSummary configuration={profile.configuration} />
        <p className="source-section-note"><Link to={profilePath(id, 'new')} state={state}>Create another draft</Link></p>
      </> : <form className="profile-body" noValidate onSubmit={event => {
        event.preventDefault();
        if (locked || busy) return;
        const { configuration, errors: invalid } = compileDraft(draft, source.adapter_type);
        setErrors(invalid);
        if (Object.keys(invalid).length) {
          setFailure('Review the highlighted configuration fields.');
          requestAnimationFrame(() => document.getElementById(Object.keys(invalid)[0]!)?.focus());
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
          <ConfigurationEditor draft={draft} adapter={source.adapter_type} errors={errors}
            change={next => {
              setDraft(next); setDirty(true); setErrors({}); setStatus('');
              if (!locked) setFailure('');
            }} />
          <div className="profile-actions">
            <button className="primary" type="submit" disabled={locked || (!!profile && !dirty)}>
              {profile ? 'Save draft' : 'Create draft'}
            </button>
          </div>
        </fieldset>
      </form>}
    </section>
    {profile && !immutable && <ProfileChecks key={checkRevision} source={source} profile={profile}
      dirty={dirty} locked={locked} busy={!!busy} run={run}
      requests={{
        preview: async (sample, signal) => {
          await checkCurrent(signal);
          return previewProfile(id, profile.profile_version_id, sample, signal);
        },
        validate: async (sample, signal) => {
          await checkCurrent(signal);
          return validateProfile(id, profile.profile_version_id, sample, signal);
        },
        approve: async (report, operator, signal) => {
          const approved = await approveProfile(id, profile.profile_version_id, report, operator, signal);
          if (!signal.aborted) saved(approved, 'Profile approved. The configuration is now read only.');
          return approved;
        },
      }} />}
  </>;
}
