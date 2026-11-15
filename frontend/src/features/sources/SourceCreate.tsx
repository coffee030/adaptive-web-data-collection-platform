import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '../../lib/api';
import { forgetRequestIntent, isUncertainWrite, prepareRequestIntent, type RequestIntent } from '../../lib/requestIntent';
import { createSource, sourcePath, sourcesPath } from './api';
import type { Adapter, CreateSourceInput } from './api';
import { SourcesBreadcrumb } from './SourceDetail';

type Field = 'source_name' | 'adapter_type' | 'permission_reference' | 'policy' | 'paths' | 'interval';
type Errors = Partial<Record<Field, string>>;
type Problem = { message: string; fields: Errors };

const labels: Record<Field, string> = {
  source_name: 'Source name',
  adapter_type: 'Adapter',
  permission_reference: 'Permission reference',
  policy: 'Allowed inputs',
  paths: 'Allowed path prefixes',
  interval: 'Minimum request interval',
};

function validateName(value: string, label: string) {
  if (!value) return `Enter ${label}.`;
  if (Array.from(value).length > 128) return 'Use 128 characters or fewer.';
}

function validOrigin(value: string) {
  const port = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value)?.[1];
  return /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(value)
    || value === 'http://collection-fixture:8001' || (port !== undefined && Number(port) <= 65535);
}

function submissionProblem(error: unknown): Problem {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return { message: 'A source conflicts with this registration. Review the Sources list before submitting again.', fields: {} };
    }
    if (error.code === 'invalid_source_policy') {
      return { message: 'The backend rejected the access policy.', fields: {
        policy: 'Check the allowed inputs for the selected adapter and environment.',
      } };
    }
    if (error.status === 422) {
      const fields: Errors = {};
      for (const field of error.fields) {
        if (field === 'allowed_origins' || field === 'allowed_datasets') {
          fields.policy = 'Check each policy entry and its length or format.';
        } else if (field === 'source_name' || field === 'permission_reference' || field === 'adapter_type') {
          fields[field] = `Check the value for ${labels[field].toLowerCase()}.`;
        }
      }
      return { message: 'The backend rejected the form. Review the values and submit again.', fields };
    }
    if (error.status === 413) {
      return { message: 'The request is too large. Shorten the allowed input list and submit again.', fields: {} };
    }
    if (error.kind === 'timeout' || error.kind === 'network' || error.kind === 'invalid-response'
      || (error.status !== undefined && error.status >= 500)) {
      const reason = error.kind === 'timeout' ? 'The request timed out.'
        : error.status === 503 ? 'The backend is unavailable (HTTP 503).'
          : 'The registration could not be confirmed.';
      return { message: `${reason} Submit the same values again to recover this registration.`, fields: {} };
    }
  }
  return { message: 'Source registration failed. Review the form and try again.', fields: {} };
}

export function SourceCreate() {
  const [adapter, setAdapter] = useState<Adapter>('csv');
  const [problem, setProblem] = useState<Problem>();
  const [submitting, setSubmitting] = useState(false);
  const unconfirmed = useRef<RequestIntent<CreateSourceInput> | undefined>(undefined);
  const request = useRef<AbortController | null>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { if (problem) errorSummary.current?.focus(); }, [problem]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const values = new FormData(event.currentTarget);
    const name = String(values.get('source_name') ?? '').trim();
    const permission = String(values.get('permission_reference') ?? '').trim();
    const selected = values.get('adapter_type');
    const policy = String(values.get(adapter) ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const prefixes = String(values.get('paths') ?? '').split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const interval = Number(values.get('interval') ?? 1000);
    const allowedPaths: Record<string, string[]> = {};
    const fields: Errors = {};
    const nameError = validateName(name, 'a source name');
    const permissionError = validateName(permission, 'a permission reference');
    if (nameError) fields.source_name = nameError;
    if (permissionError) fields.permission_reference = permissionError;
    if (selected !== 'web' && selected !== 'csv') fields.adapter_type = 'Choose CSV or Controlled web.';
    if (policy.length === 0) fields.policy = adapter === 'web' ? 'Enter an allowed origin.' : 'Enter an allowed dataset ID.';
    else if (new Set(policy).size < policy.length) fields.policy = 'Remove duplicate entries.';
    else if (adapter === 'web' && policy.some(value => !validOrigin(value))) {
      fields.policy = 'Use a controlled origin such as https://example.com or http://127.0.0.1:8001, with no path or trailing slash.';
    } else if (adapter === 'csv' && policy.some(value => Array.from(value).length > 128)) {
      fields.policy = 'Use 128 characters or fewer per dataset ID.';
    }
    if (adapter === 'web') {
      for (const value of prefixes) {
        const origin = policy.find(item => value.startsWith(item + '/'));
        const path = origin && value.slice(origin.length);
        if (!origin || !path || path.includes('//') || /[\x00-\x20?#\\]/.test(path)) {
          fields.paths = 'Enter a registered origin and path, such as https://example.com/catalog.';
          break;
        }
        (allowedPaths[origin] ??= []).push(path);
      }
      if (!Number.isInteger(interval) || interval < 1000 || interval > 10_000) {
        fields.interval = 'Enter a whole number from 1000 to 10000 milliseconds.';
      }
    }
    if (Object.keys(fields).length) {
      setProblem({ message: 'Review the highlighted fields.', fields });
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setProblem(undefined);
    setSubmitting(true);
    let intent: RequestIntent<CreateSourceInput> | undefined;
    try {
      const input: CreateSourceInput = {
        source_name: name, adapter_type: adapter, permission_reference: permission,
        ...(adapter === 'web' ? { allowed_origins: policy } : { allowed_datasets: policy }),
        ...(adapter === 'web' && prefixes.length > 0 && { allowed_paths: allowedPaths }),
        ...(adapter === 'web' && interval !== 1000 && { min_request_interval_ms: interval }),
      };
      const previous = unconfirmed.current;
      const { request_key: _key, ...previousInput } = previous?.body ?? {};
      intent = previous && JSON.stringify(previousInput) === JSON.stringify(input)
        ? previous : await prepareRequestIntent('source-registration', input);
      controller.signal.throwIfAborted();
      const source = await createSource(intent.body, controller.signal);
      if (!controller.signal.aborted) {
        forgetRequestIntent(intent);
        unconfirmed.current = undefined;
        navigate(sourcePath(source.source_id), { replace: true, state: { createdSourceId: source.source_id } });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        if (intent && isUncertainWrite(error)) unconfirmed.current = intent;
        else {
          if (intent) forgetRequestIntent(intent);
          unconfirmed.current = undefined;
        }
        setProblem(submissionProblem(error));
      }
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  function fieldError(field: Field) {
    const message = problem?.fields[field];
    return message && <p id={field + '-error'} className="field-error">{message}</p>;
  }

  function fieldProps(field: Field, help?: string) {
    const invalid = !!problem?.fields[field];
    return {
      id: field, 'aria-invalid': invalid || undefined,
      'aria-describedby': [help, invalid ? field + '-error' : undefined].filter(Boolean).join(' ') || undefined,
    };
  }

  return (
    <>
      <SourcesBreadcrumb />
      <div className="page-heading"><h1>Create source</h1></div>
      <section className="panel source-form-panel" aria-label="Source registration">
        <form className="source-form" noValidate onSubmit={submit}>
          <p className="muted">New sources start with pending access authorization.</p>
          {problem && <div className="form-problem" ref={errorSummary} tabIndex={-1} role="alert">
            <strong>Source registration</strong><p>{problem.message}</p>
            {Object.keys(problem.fields).length > 0 && <ul>
              {(Object.keys(problem.fields) as Field[]).map(field => (
                <li key={field}><a href={'#' + field} onClick={event => {
                  event.preventDefault();
                  document.getElementById(field)?.focus();
                }}>{labels[field]}</a></li>
              ))}
            </ul>}
          </div>}
          <fieldset disabled={submitting}>
            <div className="source-fields">
              <div>
                <label htmlFor="source_name">Source name</label>
                <input name="source_name" required {...fieldProps('source_name')} />
                {fieldError('source_name')}
              </div>
              <div>
                <label htmlFor="adapter_type">Adapter</label>
                <select name="adapter_type" value={adapter} {...fieldProps('adapter_type')}
                  onChange={event => {
                    setAdapter(event.target.value === 'web' ? 'web' : 'csv');
                    setProblem(undefined);
                  }}>
                  <option value="csv">CSV</option>
                  <option value="web">Controlled web</option>
                </select>
                {fieldError('adapter_type')}
              </div>
            </div>
            <div>
              <label htmlFor="permission_reference">Permission reference</label>
              <input name="permission_reference" required {...fieldProps('permission_reference', 'permission-help')} />
              <p id="permission-help" className="muted">Use a permission ticket or agreement reference.</p>
              {fieldError('permission_reference')}
            </div>
            {(['csv', 'web'] as const).map(type => {
              const active = type === adapter;
              return <div key={type} hidden={!active}>
                <label htmlFor={active ? 'policy' : undefined}>{type === 'web' ? 'Allowed origins' : 'Allowed dataset IDs'}</label>
                <textarea name={type} rows={3} required={active} disabled={!active}
                  {...(active ? fieldProps('policy', 'policy-help') : {})} />
                {active && <>
                  <p id="policy-help" className="muted">{type === 'web'
                    ? 'One HTTPS origin per line, such as https://example.com. Loopback and Compose fixture origins are also supported for local tests.'
                    : 'One dataset ID per line. IDs are case-sensitive.'}</p>
                  {fieldError('policy')}
                </>}
              </div>;
            })}
            {adapter === 'web' && <>
              <label htmlFor="paths">Allowed path prefixes (optional)</label>
              <textarea name="paths" rows={2} {...fieldProps('paths', 'paths-help')} />
              <p id="paths-help" className="muted">Enter one origin and path per line. An origin without listed prefixes permits all its paths.</p>
              {fieldError('paths')}
              <label htmlFor="interval">Minimum request interval (ms)</label>
              <input name="interval" type="number" min={1000} max={10000} defaultValue={1000} {...fieldProps('interval')} />
              {fieldError('interval')}
            </>}
            <div className="source-actions">
              <button type="submit" className="primary">Create source</button>
              <Link className="control" to={sourcesPath}>Cancel</Link>
            </div>
          </fieldset>
          {submitting && <p role="status">Registering source…</p>}
        </form>
      </section>
    </>
  );
}
