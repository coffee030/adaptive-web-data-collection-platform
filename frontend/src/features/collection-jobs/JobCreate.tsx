import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';
import { Loading, RequestProblem, Status } from '../../components/feedback';
import { useResource } from '../../lib/useResource';
import { profilePath, type Profile } from '../profiles/api';
import { GuidedPicker } from './GuidedPicker';
import { adapterLabels, listSources, listVersions, sourcePath, sourcesPath, type Source } from '../sources/api';
import { allowedInputs, compileCollectionInput } from '../sources/collectionInput';
import { jobsPath, sameId } from './api';
import { newRequestPath } from '../topic-collections/api';
import { useJobSubmission } from './useJobSubmission';

export function JobCreate() {
  const [search, setSearch] = useSearchParams();
  const { state } = useLocation();
  const requestedSource = search.get('source_id');
  const requestedProfile = search.get('profile_version_id');
  const direct = !!requestedSource || !!requestedProfile;
  const sources = useResource(listSources, 0, false, direct);
  const options = sources.result.state === 'ready' ? sources.result.data : [];
  const source = options.find(item => sameId(requestedSource, item.source_id));
  const jobsSearch = typeof state?.jobsSearch === 'string' ? state.jobsSearch : '';
  const write = useJobSubmission(jobsSearch);
  const { locked, pending, problem, recovery, send } = write;
  const writeAlert = useRef<HTMLDivElement>(null);
  useEffect(() => { if (problem) writeAlert.current?.focus(); }, [problem]);
  const previousSource = typeof state?.fromSource === 'string' ? state.fromSource : '';
  const previousProfile = typeof state?.fromProfile === 'string' ? state.fromProfile : '';
  const back = previousSource ? (previousProfile
    ? profilePath(previousSource, previousProfile) : sourcePath(previousSource))
    : { pathname: jobsPath, search: jobsSearch };
  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={back}>{state?.fromProfile ? 'Profile version' : state?.fromSource ? 'Source details' : 'Collection Jobs'}</Link>
      </nav>
      <div className="page-heading">
        <h1>Single-source collection and CSV import</h1>
        <p className="muted">{direct
          ? 'Review the source policy, approved profile and permitted input.'
          : 'Choose an input format and source to run a single collection job.'}</p>
        {!direct && <Link className="control" to={newRequestPath}>Collect by topic</Link>}
      </div>
      {(pending || problem || recovery.submission || recovery.requiresExactInput) && <section className="panel notice job-create job-submission-state"
        aria-label="Submission status">
        {pending && <p role="status">Submitting job…</p>}
        {problem && <div className="form-problem" role="alert" ref={writeAlert} tabIndex={-1}>{problem}</div>}
        {recovery.requiresExactInput && <p role="status">A previous submission is unconfirmed. Re-enter the original Source, Profile Version and input to recover the same Job.</p>}
        {recovery.submission && <>
          {!problem && <p role="status">A previous submission is unconfirmed. Reconcile it before starting a new submission.</p>}
          <div className="profile-actions">
            <button type="button" disabled={pending} onClick={() => void send()}>Retry submission</button>
            <Link to={{ pathname: jobsPath, search: jobsSearch }}>Check Collection Jobs</Link>
          </div>
        </>}
      </section>}
      {!direct ? <GuidedPicker locked={locked}>
        {(source, profiles) => <JobFields key={source.source_id} source={source} requestedProfile={null}
          write={write} guidedVersions={profiles} />}
      </GuidedPicker> :
      <section className="panel detail-panel job-create" aria-labelledby="job-input-heading">
        <div className="panel-heading"><h2 id="job-input-heading">Collection input</h2></div>
        {sources.result.state === 'loading' && <Loading>Loading sources…</Loading>}
        {sources.result.state === 'error' && <RequestProblem error={sources.result.error} resource="sources" retry={sources.retry} />}
        {sources.result.state === 'ready' && (options.length ? (
          <div className="profile-body">
            <div className="profile-form">
              <label>Source
                <select value={source?.source_id ?? ''} disabled={locked}
                  onChange={event => {
                    const next = new URLSearchParams();
                    if (event.target.value) next.set('source_id', event.target.value);
                    if (!requestedSource && requestedProfile) next.set('profile_version_id', requestedProfile);
                    setSearch(next, { replace: true, state });
                  }}>
                  <option value="">Select a Source</option>
                  {options.map(item => <option key={item.source_id} value={item.source_id}>
                    {item.source_name} · {adapterLabels[item.adapter_type]} · {item.approval_status}
                  </option>)}
                </select>
              </label>
            </div>
            {requestedSource && !source && <p role="alert">The selected Source is unavailable. Choose a Source above.</p>}
            {!requestedSource && requestedProfile && <p role="alert">Select the Source associated with the requested Profile Version.</p>}
            {source && <JobFields key={source.source_id + '/' + requestedProfile} source={source} requestedProfile={requestedProfile}
              write={write} />}
          </div>
        ) : <div className="notice"><p role="status">No Sources are registered.</p><Link to={sourcesPath}>Open Sources</Link></div>)}
      </section>}
    </>
  );
}

function JobFields({ source, requestedProfile, write, guidedVersions }: {
  source: Source; requestedProfile: string | null; write: ReturnType<typeof useJobSubmission>;
  guidedVersions?: Profile[];
}) {
  const load = useCallback((signal: AbortSignal) => listVersions(source.source_id, signal), [source.source_id]);
  const versions = useResource(load, 0, false, !guidedVersions && source.approval_status === 'approved' && allowedInputs(source).length > 0);
  const [chosenProfile, setChosenProfile] = useState<string | null>(requestedProfile ?? (guidedVersions?.length === 1 ? guidedVersions[0]!.profile_version_id : null));
  const allowed = allowedInputs(source);
  const [target, setTarget] = useState(allowed.length === 1 ? allowed[0]! : '');
  const [content, setContent] = useState('');
  const [problem, setProblem] = useState('');
  const [inputError, setInputError] = useState<'target' | 'content'>();
  const alert = useRef<HTMLDivElement>(null);

  useEffect(() => { if (problem) alert.current?.focus(); }, [problem]);

  const all = guidedVersions ?? (versions.result.state === 'ready' ? versions.result.data : []);
  const profile = all.find(item => sameId(chosenProfile, item.profile_version_id));
  const search = profile?.configuration?.adapter_type === 'web' ? profile.configuration.search : undefined;
  const eligible = profile?.approval_status === 'approved';
  const approved = all.some(item => item.approval_status === 'approved');
  const web = source.adapter_type === 'web';
  const targetError = inputError === 'target';
  const contentError = inputError === 'content';

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (write.locked || source.approval_status !== 'approved' || !eligible || !profile) return;
    const input = compileCollectionInput(source, search?.origin ?? target, content, !!search);
    if (input.error) {
      setProblem(input.error);
      setInputError(allowed.includes(search?.origin ?? target) ? 'content' : 'target');
      return;
    }
    if (input.entry) void write.send({
      source_id: source.source_id,
      profile_version_id: profile.profile_version_id,
      entry: input.entry,
    });
  }

  function clearError() {
    setProblem('');
    setInputError(undefined);
  }

  if (source.approval_status !== 'approved' || !allowed.length) return <div className="job-form-note" role="status">
    <p>{source.approval_status !== 'approved'
      ? `Source access is ${source.approval_status}. Job submission requires approved Source access.`
      : 'The Source policy has no permitted inputs.'}</p>
    <Link to={sourcePath(source.source_id)}>View Source access policy</Link>
  </div>;

  return (
    <>
      {!guidedVersions && versions.result.state === 'loading' && <Loading>Loading profile versions…</Loading>}
      {!guidedVersions && versions.result.state === 'error' && <RequestProblem error={versions.result.error} resource="profile versions" retry={versions.retry} />}
      {(guidedVersions || versions.result.state === 'ready') && <>
        <form onSubmit={submit} noValidate>
          <fieldset className="profile-form" disabled={write.locked}>
            <div className="profile-form">
              <label>Profile Version
                <select required value={profile?.profile_version_id ?? ''} aria-describedby="job-version-help"
                  onChange={event => { setChosenProfile(event.target.value); clearError(); }}>
                  <option value="">Select an approved version</option>
                  {all.map(item => <option key={item.profile_version_id} value={item.profile_version_id}
                    disabled={item.approval_status !== 'approved'}>Version {item.version} · {item.approval_status}</option>)}
                </select>
              </label>
              <p className="muted" id="job-version-help">
                {!approved ? 'This Source has no approved Profile Versions.'
                  : chosenProfile && !eligible ? `The requested version is ineligible. ${profile ? 'Its status is ' + profile.approval_status + '.' : 'It is unavailable for this Source.'} Select an approved version.`
                  : 'The Job is pinned to this version.'}
              </p>
            </div>
            {eligible && profile.configuration && <ProfileReview profile={profile} source={source} />}
            {!approved && <div><Link to={sourcePath(source.source_id)}>Open Source profile versions</Link></div>}
            {eligible && <div className="job-entry profile-form">
              {search ? <p className="muted">Search origin {search.origin}</p> : <label>{web ? 'Allowed origin' : 'Allowed dataset ID'}
                <select required value={target} aria-invalid={targetError || undefined}
                  aria-describedby={targetError ? 'job-submit-error' : undefined}
                  onChange={event => { setTarget(event.target.value); clearError(); }}>
                  <option value="">Select a permitted input</option>
                  {allowed.map(item => <option key={item} value={item}>{item}</option>)}
                </select>
              </label>}
              <label>{search ? 'Keyword' : web ? 'Document path' : 'CSV content'}
                {web ? <input required value={content} placeholder={search ? undefined : '/table.html'}
                  aria-invalid={contentError || undefined} aria-describedby={contentError ? 'job-submit-error' : undefined}
                  onChange={event => { setContent(event.target.value); clearError(); }} />
                  : <textarea required rows={7} value={content} aria-invalid={contentError || undefined}
                    aria-describedby={contentError ? 'job-submit-error' : 'job-csv-help'}
                    onChange={event => { setContent(event.target.value); clearError(); }} />}
              </label>
              {!web && <p className="muted" id="job-csv-help">Include the CSV header. UTF-8 limit is 1 MiB.</p>}
              <SubmissionReview source={source} profile={profile} target={search?.origin ?? target} content={content} />
              <div><button type="submit" className="primary">{write.recovery.requiresExactInput ? 'Reconcile submission' : 'Submit job'}</button></div>
            </div>}
          </fieldset>
          {problem && <div className="form-problem job-form-note" role="alert" id="job-submit-error"
            ref={alert} tabIndex={-1}>{problem}</div>}
        </form>
      </>}
    </>
  );
}

function ProfileReview({ profile, source }: { profile: Profile; source: Source }) {
  const config = profile.configuration;
  const extractionFields = config.adapter_type === 'web'
    ? config.fields.map(field => field.name)
    : config.columns.map(field => `${field.name} (from ${field.column})`);
  return <details className="job-profile-mapping">
    <summary>Profile mapping and collection rules</summary>
    <dl>
      <div>
        <dt>Extraction Fields</dt>
        <dd>{extractionFields.join(', ')}</dd>
      </div>
      <div>
        <dt>Persisted Record Fields</dt>
        <dd>{config.record_schema.fields.map(field => `${field.name} (${field.value_type}${field.required ? '' : ', optional'})`).join(', ')}</dd>
      </div>
    </dl>
    <p className="muted">
      {config.adapter_type === 'web'
        ? config.search
          ? `Uses approved keyword search at ${config.search.path}, with up to ${config.search.max_detail_pages} detail pages and ${config.search.max_requests} requests per attempt.`
          : 'Starts at an approved document path. The pinned profile and Source policy govern any pagination.'
        : 'Imports UTF-8 CSV for a permitted dataset. Use the column headers required by this version.'}
    </p>
    <Link to={profilePath(source.source_id, profile.profile_version_id)}>Open profile version</Link>
  </details>;
}

function SubmissionReview({ source, profile, target, content }: {
  source: Source; profile: Profile; target: string; content: string;
}) {
  const csv = source.adapter_type === 'csv';
  const keyword = profile.configuration?.adapter_type === 'web' && !!profile.configuration.search;
  return <section className="job-submission-review" aria-labelledby="job-review-heading">
    <h3 id="job-review-heading">Review job submission</h3>
    <dl className="job-facts">
      <div><dt>Source</dt><dd>{source.source_name}</dd></div>
      <div><dt>Profile Version</dt><dd>Version {profile.version} · <Status value={profile.approval_status} /></dd></div>
      <div><dt>Input mode</dt><dd>{csv ? 'Inline CSV' : keyword ? 'Keyword search' : 'Controlled document path'}</dd></div>
      <div><dt>{csv ? 'Dataset ID' : 'Permitted origin'}</dt><dd>{target || 'Select an input'}</dd></div>
      <div><dt>{csv ? 'CSV input size' : keyword ? 'Keyword' : 'Document path'}</dt>
        <dd>{content ? csv ? `${new TextEncoder().encode(content).length.toLocaleString('en')} UTF-8 bytes` : content.trim() : 'Enter input above'}</dd></div>
    </dl>
    <p className="muted">Submitting requests one Job. Its status and published results appear in Job Details.</p>
  </section>;
}
