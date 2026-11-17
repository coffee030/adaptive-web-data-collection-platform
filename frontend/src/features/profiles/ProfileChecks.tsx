import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Source } from '../sources/api';
import { allowedInputs, compileCollectionInput } from '../sources/collectionInput';
import { isLocalOperator, localOperatorHelp } from '../operator/operator';
import type { Candidate, Profile, Report, Sample } from './api';
import { ConfigurationSummary, PreviewResults, ValidationResult } from './ProfileResults';

export type Action = 'create' | 'save' | 'preview' | 'validate' | 'approve' | 'reload';
type RunAction = <T>(action: Action, request: (signal: AbortSignal) => Promise<T>, accept: (result: T) => void) => void;

export function ProfileChecks({ source, profile, busy, dirty, locked, run, requests }: {
  source: Source; profile: Profile; busy: boolean; dirty: boolean; locked: boolean;
  run: RunAction;
  requests: {
    preview: (sample: Sample, signal: AbortSignal) => Promise<Candidate[]>;
    validate: (sample: Sample, signal: AbortSignal) => Promise<Report>;
    approve: (report: Report, label: string, signal: AbortSignal) => Promise<Profile>;
  };
}) {
  const web = source.adapter_type === 'web';
  const search = profile.configuration.adapter_type === 'web' ? profile.configuration.search : undefined;
  const allowed = allowedInputs(source);
  const [target, setTarget] = useState(allowed[0] ?? '');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Candidate[]>();
  const [report, setReport] = useState<Report>();
  const [operator, setOperator] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  function clearResults() {
    setPreview(undefined);
    setReport(undefined);
    setConfirmed(false);
    setError('');
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || disabled) return;
    const action = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'validate'
      ? 'validate' : 'preview';
    const input = compileCollectionInput(source, search?.origin ?? target, content, !!search);
    if (!input.entry) {
      setError(input.error);
      return;
    }
    const sample = input.entry;
    setError('');
    if (action === 'preview') {
      setPreview(undefined);
      run(action, signal => requests.preview(sample, signal), setPreview);
    } else {
      setReport(undefined);
      setConfirmed(false);
      run(action, signal => requests.validate(sample, signal), setReport);
    }
  }

  const disabled = dirty || locked || source.approval_status !== 'approved' || !allowed.includes(search?.origin ?? target);
  const localOperator = isLocalOperator();
  const currentReport = report?.config_hash === profile.config_hash && report.profile_version_id === profile.profile_version_id;
  const eligible = report?.passed && currentReport && !disabled;
  const operatorLabel = operator.trim();
  const approveEnabled = !!eligible && localOperator && confirmed && operatorLabel.length > 0
    && Array.from(operatorLabel).length <= 128;

  return <>
    <section className="panel operator-sheet" aria-labelledby="sample-heading">
      <div className="panel-heading"><h2 id="sample-heading" tabIndex={-1}>Preview and validation</h2></div>
      <div className="profile-body">
        <p className="muted">Preview the extracted fields on a sample, then validate saved revision {profile.revision} for approval.</p>
        {source.approval_status !== 'approved' && <p>Sample checks require approved Source access.</p>}
        {dirty && <p>Save the draft to check the updated configuration.</p>}
        {locked && <p>Reload the server version before running sample checks.</p>}
        <form onSubmit={submit}>
          <fieldset className="profile-form" disabled={busy || disabled}>
            {search ? <p className="muted">Samples use the first detail result from {search.origin}.</p> : <label>{web ? 'Allowed origin' : 'Allowed dataset ID'}
              <select value={target} onChange={event => { setTarget(event.target.value); clearResults(); }}>
                {allowed.map((item, index) => <option key={index} value={item}>{item}</option>)}
              </select>
            </label>}
            <label>{search ? 'Sample keyword' : web ? 'Document path' : 'CSV sample'}
              {web ? <input value={content} placeholder={search ? undefined : '/table.html'} aria-invalid={!!error || undefined}
                aria-describedby={error ? 'sample-error' : undefined}
                onChange={event => { setContent(event.target.value); clearResults(); }} />
                : <textarea rows={5} value={content} aria-invalid={!!error || undefined}
                  aria-describedby={error ? 'sample-error' : undefined}
                  onChange={event => { setContent(event.target.value); clearResults(); }} />}
            </label>
            {error && <p id="sample-error" className="field-error" role="alert">{error}</p>}
            <div className="profile-actions">
              <button type="submit" value="preview">Preview</button>
              <button type="submit" value="validate">Validate sample</button>
            </div>
          </fieldset>
        </form>
        {!dirty && !locked && preview && <PreviewResults candidates={preview} configuration={profile.configuration} />}
        {!dirty && !locked && report && (currentReport ? <ValidationResult report={report} />
          : <p role="alert">This report belongs to a different saved configuration. Validate the current draft again.</p>)}
      </div>
    </section>
    <section className="panel operator-sheet" aria-labelledby="approval-heading">
      <div className="panel-heading"><h2 id="approval-heading" tabIndex={-1}>Approval review</h2></div>
      <div className="profile-body">
        <p>Approval locks this configuration. Further changes require a new draft.</p>
        {!localOperator && <p className="muted">{localOperatorHelp}</p>}
        {!eligible && <p className="muted">Validate the saved draft successfully to review it for approval.</p>}
        {eligible && report && <>
          <dl className="source-metadata profile-result-meta">
            <div><dt>Source</dt><dd>{source.source_name} · Approved access</dd></div>
            <div><dt>Profile</dt><dd>Version {profile.version} · Revision {profile.revision}</dd></div>
            <div><dt>Validation</dt><dd>Passed · {report.valid_count} valid</dd></div>
          </dl>
          <details className="profile-options"><summary>Review saved configuration</summary><ConfigurationSummary configuration={profile.configuration} /></details>
          <details className="profile-options"><summary>Approval references</summary>
            <dl className="source-metadata profile-technical">
              <div><dt>Configuration hash</dt><dd className="identifier">{profile.config_hash}</dd></div>
              <div><dt>Passing report ID</dt><dd className="identifier">{report.report_id}</dd></div>
            </dl>
          </details>
          {localOperator && <form onSubmit={event => {
            event.preventDefault();
            if (approveEnabled && !busy) run('approve', signal => requests.approve(report, operatorLabel, signal), () => {
              setConfirmed(false);
            });
          }}>
            <fieldset className="profile-form" disabled={busy}>
              <label>Approver label<input required maxLength={128} value={operator}
                aria-describedby="approver-help" onChange={event => { setOperator(event.target.value); setConfirmed(false); }} />
              </label>
              <p id="approver-help" className="muted">The console records this self-reported label with the approval.</p>
              <label className="check"><input type="checkbox" checked={confirmed}
                onChange={event => setConfirmed(event.target.checked)} />I reviewed this report and confirm approval.</label>
              <div><button type="submit" className="primary" disabled={!approveEnabled}>Approve version</button></div>
            </fieldset>
          </form>}
        </>}
      </div>
    </section>
  </>;
}
