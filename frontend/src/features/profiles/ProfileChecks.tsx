import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Source } from '../sources/api';
import { allowedInputs, compileCollectionInput } from '../sources/collectionInput';
import type { Candidate, Profile, Report, Sample } from './api';
import { ConfigurationSummary, PreviewResults, ValidationResult } from './ProfileResults';

export type Action = 'create' | 'save' | 'preview' | 'validate' | 'approve';
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
    const input = compileCollectionInput(source, target, content);
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

  const disabled = dirty || locked || source.approval_status !== 'approved' || !allowed.includes(target);
  const localDemo = __LOCAL_PROFILE_APPROVAL__ && window.location.protocol === 'http:'
    && window.location.hostname === '127.0.0.1';
  const eligible = report?.passed && report.config_hash === profile.config_hash
    && report.profile_version_id === profile.profile_version_id && !disabled;
  const operatorLabel = operator.trim();
  const approveEnabled = !!eligible && localDemo && confirmed && operatorLabel.length > 0
    && Array.from(operatorLabel).length <= 128;

  return <>
    <section className="panel detail-panel" aria-labelledby="sample-heading">
      <div className="panel-heading"><h2 id="sample-heading">Preview and validation</h2></div>
      <div className="profile-body">
        {source.approval_status !== 'approved' && <p>Sample checks require approved Source access.</p>}
        {dirty && <p>Save the draft to check the updated configuration.</p>}
        {locked && <p>Reload the server version before running sample checks.</p>}
        <form onSubmit={submit}>
          <fieldset className="profile-form" disabled={busy || disabled}>
            <label>{web ? 'Allowed origin' : 'Allowed dataset ID'}
              <select value={target} onChange={event => { setTarget(event.target.value); clearResults(); }}>
                {allowed.map((item, index) => <option key={index} value={item}>{item}</option>)}
              </select>
            </label>
            <label>{web ? 'Document path' : 'CSV sample'}
              {web ? <input value={content} placeholder="/table.html" aria-invalid={!!error || undefined}
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
        {!dirty && !locked && report && <ValidationResult report={report} />}
      </div>
    </section>
    <section className="panel detail-panel" aria-labelledby="approval-heading">
      <div className="panel-heading"><h2 id="approval-heading">Approval review</h2></div>
      <div className="profile-body">
        <p>Approval locks this configuration. Further changes require a new draft.</p>
        {!localDemo && <p className="muted">Approval is available only in the configured local operator demo.</p>}
        {!eligible && <p className="muted">Validate the saved draft successfully to review it for approval.</p>}
        {eligible && report && <>
          <dl className="source-metadata profile-result-meta">
            <div><dt>Source</dt><dd>{source.source_name} · Approved access</dd></div>
            <div><dt>Profile</dt><dd>Version {profile.version} · {profile.configuration.record_schema.record_type}</dd></div>
            <div><dt>Configuration hash</dt><dd className="identifier">{profile.config_hash}</dd></div>
            <div><dt>Passing report</dt><dd className="identifier">{report.report_id}</dd></div>
          </dl>
          <details><summary>Review saved configuration</summary><ConfigurationSummary configuration={profile.configuration} /></details>
          {localDemo && <form onSubmit={event => {
            event.preventDefault();
            if (approveEnabled && !busy) run('approve', signal => requests.approve(report, operatorLabel, signal), () => {
              setConfirmed(false);
            });
          }}>
            <fieldset className="profile-form" disabled={busy}>
              <label>Approver label<input required maxLength={128} value={operator}
                aria-describedby="approver-help" onChange={event => { setOperator(event.target.value); setConfirmed(false); }} />
              </label>
              <p id="approver-help" className="muted">Local demo only. This audit label is self-reported. Production authentication is unavailable.</p>
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
