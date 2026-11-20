import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { adjudicate, journal, loadAttempt, persistStop, requireRecordedResult, writeEvidence } from './m22c_completion.mjs';

const stamp = mono_ms => ({ mono_ms, utc: new Date(Date.UTC(2026, 0, 1) + mono_ms).toISOString() });
const dashboard = 'http://localhost:5236';
const version = {
  source_id: 'reference-source', profile_version_id: 'reference-version',
  revision: 2, config_hash: 'reference-hash', validation_report_id: '0123456789abcdef0123456789abcdef',
  approval_status: 'approved',
};
const report = {
  profile_version_id: version.profile_version_id, config_hash: version.config_hash,
  report_id: version.validation_report_id, passed: true,
};
const directoryFor = t => {
  const root = resolve(tmpdir());
  const directory = mkdtempSync(join(root, 'm22c-reference-'));
  t.after(() => {
    assert.equal(dirname(resolve(directory)), root);
    rmSync(directory, { recursive: true });
  });
  return directory;
};

function attempt(t, { signal = 'dashboard_confirmation', stopAt = 600, approvalAt = 500,
  approved = version, validation = report, hasBody = true } = {}) {
  const directory = directoryFor(t);
  const record = journal(directory);
  record('rehearsal', { dashboard, source: { source_id: version.source_id } }, stamp(0));
  const start = stamp(100);
  record('start', {}, start);

  const request = (id, kind, body, at) => record('request', {
    id, kind, body: JSON.stringify(body), method: 'POST',
    url: `${dashboard}/api/v1/sources/${version.source_id}/versions/${version.profile_version_id}/${kind}`,
  }, stamp(at));
  request(1, 'validate', { keyword: 'C++ & tea' }, 200);
  record('response', { id: 1, kind: 'validate', status: 200 }, stamp(300));
  record('api_body', { id: 1, kind: 'validate', result: validation }, stamp(350));
  request(2, 'approve', { report_id: report.report_id, config_hash: version.config_hash }, 400);
  const respond = () => record('response', { id: 2, kind: 'approve', status: 200 }, stamp(approvalAt));
  if (approvalAt < stopAt) respond();
  const stop = persistStop(directory, record, start, stamp(stopAt), signal);
  if (approvalAt >= stopAt) respond();
  // A slow response body may finish after Enter. Only the response event sets its observation time.
  if (hasBody) {
    record('api_body', { id: 2, kind: 'approve', result: approved }, stamp(Math.max(stopAt, approvalAt) + 50));
  }
  return { directory, stop };
}

const verdict = (directory, versions) => {
  const evidence = loadAttempt(directory);
  return adjudicate(evidence.events, versions ?? evidence.versions, evidence);
};

test('timely approval survives delayed parsing and read-only recovery', t => {
  const { directory, stop } = attempt(t);
  const stopFile = join(directory, 'stop.json');
  const original = readFileSync(stopFile, 'utf8');
  assert.equal(verdict(directory).status, 'incomplete');
  writeEvidence(directory, 'versions.json', [version]);
  const result = verdict(directory);
  assert.equal(result.status, 'completed');
  assert.equal(result.elapsed_seconds, 0.5);
  assert.equal(result.elapsed_seconds, stop.elapsed_seconds);
  assert.equal(result.approval_observed_mono_ms, 500);
  assert.equal(readFileSync(stopFile, 'utf8'), original);
  requireRecordedResult(result, 'completed');
});

test('Enter before a successful response remains a failure after approval and readback', t => {
  const { directory } = attempt(t, { approvalAt: 700 });
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /Premature stop/);
  assert.equal(result.elapsed_seconds, 0.5);
  assert.throws(() => requireRecordedResult(result, 'completed'));
});

test('a response at the same monotonic tick but journaled after stop cannot qualify', t => {
  const { directory } = attempt(t, { approvalAt: 600 });
  assert.equal(verdict(directory, [version]).status, 'failed');
});

for (const [key, wrong] of [
  ['source_id', 'another-source'], ['profile_version_id', 'another-version'],
  ['revision', 3], ['config_hash', 'different-hash'], ['validation_report_id', 'other-report'],
]) {
  test(`conflicting approved ${key} is incomplete`, t => {
    const { directory } = attempt(t, { approved: { ...version, [key]: wrong } });
    const result = verdict(directory, [version]);
    assert.equal(result.status, 'incomplete');
    assert.throws(() => requireRecordedResult(result, 'completed'));
  });
}

test('missing approval body and failed validation stay incomplete', t => {
  const noBody = attempt(t, { hasBody: false });
  assert.match(verdict(noBody.directory, [version]).reason, /body is missing/);
  const noPass = attempt(t, { validation: { ...report, passed: false } });
  assert.match(verdict(noPass.directory, [version]).reason, /passing validation/);
});

test('the journal alone preserves a completed stop across a crash before its standalone copy', t => {
  const { directory, stop } = attempt(t);
  rmSync(join(directory, 'stop.json'));
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'completed');
  assert.equal(result.elapsed_seconds, stop.elapsed_seconds);
});

test('interrupted input preserves elapsed and gates out an unverified success', t => {
  const { directory } = attempt(t, { signal: 'interrupted' });
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'incomplete');
  assert.equal(result.elapsed_seconds, 0.5);
  assert.throws(() => requireRecordedResult(result, 'completed'));
});

test('a signal exactly at the cap fails with the original 900 seconds', t => {
  const { directory } = attempt(t, { stopAt: 900_100 });
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'failed');
  assert.equal(result.signal, 'timeout');
  assert.equal(result.elapsed_seconds, 900);
});

test('abandonment fails even if a matching approval exists', t => {
  const { directory } = attempt(t, { signal: 'abandonment' });
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'failed');
  assert.equal(result.signal, 'abandonment');
  assert.equal(result.elapsed_seconds, 0.5);
});

test('a pre-correction completed record cannot pass the next-assignment check', t => {
  const directory = directoryFor(t);
  const record = journal(directory);
  record('operator', { source: { source_id: version.source_id } });
  record('start');
  record('stop', { status: 'completed', elapsed_seconds: 2 });
  const result = verdict(directory, [version]);
  assert.equal(result.status, 'incomplete');
  assert.throws(() => requireRecordedResult(result, 'completed'));
});
