import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const capSeconds = 900;
export const stamp = () => ({ mono_ms: performance.now(), utc: new Date().toISOString() });

export function journal(directory) {
  const path = resolve(directory, 'session.jsonl');
  writeFileSync(path, '', { flag: 'wx' });
  return (event, details = {}, observed = stamp()) => {
    appendFileSync(path, JSON.stringify({ ...observed, event, ...details }) + '\n', { flush: true });
  };
}

export function writeEvidence(directory, name, data) {
  writeFileSync(resolve(directory, name), JSON.stringify(data, null, 2), { flag: 'wx', flush: true });
}

export function persistStop(directory, record, start, observed, signal, context = {}) {
  const deadline = start.mono_ms + capSeconds * 1000;
  const cutoff = Math.min(deadline, observed.mono_ms);
  if (observed.mono_ms >= deadline) signal = 'timeout';
  const reasons = {
    dashboard_confirmation: 'Operator signalled Dashboard confirmation',
    timeout: '15-minute cap',
    abandonment: 'Operator abandonment',
    interrupted: 'Input closed before a terminal signal',
  };
  const stop = {
    ...context, schema: 1, signal, reason: reasons[signal], started_at: start.utc,
    cutoff_mono_ms: cutoff,
    cutoff_utc: signal === 'timeout' ? new Date(Date.parse(start.utc) + capSeconds * 1000).toISOString() : observed.utc,
    elapsed_seconds: (cutoff - start.mono_ms) / 1000,
  };
  record('stop', stop, observed);
  writeEvidence(directory, 'stop.json', stop);
  return stop;
}

function requestBody(request) {
  try {
    return JSON.parse(request.body);
  } catch {
    return null;
  }
}

function isForVersion(request, kind, header, versionId) {
  try {
    const url = new URL(request.url);
    return url.origin === header.dashboard && request.method === 'POST'
      && url.pathname === `/api/v1/sources/${header.source.source_id}/versions/${versionId}/${kind}`;
  } catch {
    return false;
  }
}

const approvalFields = ['source_id', 'profile_version_id', 'revision', 'config_hash', 'validation_report_id'];

export function adjudicate(events, versions, { evidenceIssue } = {}) {
  const stops = events.filter(row => row.event === 'stop');
  const [stop] = stops;
  const finish = (status, reason, details = {}) => ({
    status, reason, elapsed_seconds: stop?.elapsed_seconds ?? null,
    signal: stop?.signal ?? null, cutoff_utc: stop?.cutoff_utc ?? null, ...details,
  });
  const incomplete = reason => finish('incomplete', reason);
  if (!stop) return incomplete('No durable terminal signal recorded');
  if (stop.schema !== 1) return incomplete('Legacy stop has no independently recorded cutoff');
  const starts = events.filter(row => row.event === 'start');
  const [start] = starts;
  const header = events[0];
  const cutoff = stop.cutoff_mono_ms;
  const deadline = start?.mono_ms + capSeconds * 1000;
  if (stops.length !== 1 || starts.length !== 1 || !header.source?.source_id
    || !Number.isFinite(start?.mono_ms) || !Number.isFinite(stop.mono_ms)
    || events.indexOf(start) >= events.indexOf(stop) || start.utc !== stop.started_at
    || cutoff < start.mono_ms || cutoff !== Math.min(deadline, stop.mono_ms)
    || stop.elapsed_seconds !== (cutoff - start.mono_ms) / 1000
    || (stop.signal === 'timeout') !== (cutoff === deadline)) {
    return incomplete('Conflicting start, cutoff or Source evidence');
  }
  if (stop.signal === 'timeout' || stop.signal === 'abandonment') return finish('failed', stop.reason);
  if (stop.signal !== 'dashboard_confirmation') return incomplete(stop.reason);
  if (evidenceIssue) return incomplete(evidenceIssue);

  const beforeStop = events.slice(events.indexOf(start) + 1, events.indexOf(stop));
  if (beforeStop.some(row => row.event === 'observation_gap'
    || !Number.isFinite(row.mono_ms) || row.mono_ms < start.mono_ms || row.mono_ms > cutoff)) {
    return incomplete('Browser observation within the timing window is incomplete or inconsistent');
  }

  const exchanges = kind => beforeStop.filter(row => row.event === 'request' && row.kind === kind)
    .flatMap(request => beforeStop.filter(row => row.event === 'response' && row.id === request.id
      && row.status >= 200 && row.status < 300 && row.mono_ms >= request.mono_ms)
      .map(response => ({
        request, response,
        bodies: events.slice(events.indexOf(response) + 1)
          .filter(row => row.event === 'api_body' && row.id === request.id && row.kind === kind),
      })));
  const approvals = exchanges('approve');
  const observedApprovals = beforeStop.filter(row => row.event === 'response' && row.kind === 'approve'
    && row.status >= 200 && row.status < 300);
  if (approvals.length !== observedApprovals.length) {
    return incomplete('Approval response is missing its request or has conflicting timing');
  }
  if (!approvals.length) {
    return finish('failed', 'Premature stop: no successful approval response observed by the cutoff');
  }
  if (approvals.length !== 1 || approvals[0].bodies.length !== 1) {
    return incomplete('Successful approval response body is missing or conflicting');
  }
  const [approval] = approvals;
  const approved = approval.bodies[0].result;
  const [version] = Array.isArray(versions) ? versions : [];
  if (!approved || approved.approval_status !== 'approved' || versions?.length !== 1
    || version?.approval_status !== 'approved'
    || version.source_id !== header.source.source_id
    || !Number.isInteger(version.revision) || version.revision < 1
    || approvalFields.some(key => version[key] == null || version[key] !== approved[key])
    || !isForVersion(approval.request, 'approve', header, version.profile_version_id)) {
    return incomplete('Observed approval and persisted approved Source/version/revision/hash/report do not match');
  }
  const submitted = requestBody(approval.request);
  if (submitted?.config_hash !== version.config_hash || typeof submitted.report_id !== 'string'
    || submitted.report_id.replaceAll('-', '') !== version.validation_report_id) {
    return incomplete('Approval request did not identify the persisted hash and report');
  }
  const validations = exchanges('validate').filter(({ request, response, bodies }) => {
    if (events.indexOf(response) >= events.indexOf(approval.request) || bodies.length !== 1
      || !isForVersion(request, 'validate', header, version.profile_version_id)) return false;
    const report = bodies[0].result;
    return report?.passed === true && report.profile_version_id === version.profile_version_id
      && report.config_hash === version.config_hash && report.report_id === version.validation_report_id;
  });
  if (validations.length !== 1) return incomplete('Matching passing validation response could not be verified');
  return finish('completed', 'Matching Dashboard approval was observed by the cutoff', {
    approval_request_id: approval.request.id,
    validation_request_id: validations[0].request.id,
    approval_observed_utc: approval.response.utc,
    approval_observed_mono_ms: approval.response.mono_ms,
    approved: Object.fromEntries(approvalFields.map(key => [key, version[key]])),
  });
}

export function loadAttempt(directory) {
  const journalPath = resolve(directory, 'session.jsonl');
  const events = [];
  let evidenceIssue;
  if (existsSync(journalPath)) {
    for (const line of readFileSync(journalPath, 'utf8').split(/\r?\n/).filter(Boolean)) {
      try {
        events.push(JSON.parse(line));
      } catch {
        evidenceIssue = 'Session journal is interrupted or unreadable';
        break;
      }
    }
  }
  const stop = events.find(row => row.event === 'stop');
  try {
    const stopPath = resolve(directory, 'stop.json');
    if (stop?.schema === 1 && existsSync(stopPath)) {
      const { event, mono_ms, utc, ...signal } = stop;
      assert.deepEqual(JSON.parse(readFileSync(stopPath, 'utf8')), signal);
    }
  } catch {
    evidenceIssue = 'Standalone stop record conflicts with the durable journal';
  }
  let versions;
  const versionsPath = resolve(directory, 'versions.json');
  if (existsSync(versionsPath)) {
    try {
      versions = JSON.parse(readFileSync(versionsPath, 'utf8'));
    } catch {
      evidenceIssue = 'Persisted versions snapshot is unreadable';
    }
  }
  return { events, versions, stop, evidenceIssue };
}

export function requireRecordedResult(result, csvStatus) {
  assert.equal(csvStatus, result.status, 'CSV status must agree with fresh evidence adjudication before opening the next card');
}
