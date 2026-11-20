import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CollectionJob } from '../src/features/collection-jobs/api';
import type { Profile } from '../src/features/profiles/api';
import type { EvidenceMetadata, GenericRecord, QuarantineEntry } from '../src/features/results/api';

const api = '/api/v1';
const origin = 'http://collection-fixture:8001';
const fixtures = new URL('../../backend/tests/fixtures/', import.meta.url);
const sourcePrefix = api + '/sources';
const jobPrefix = api + '/collection-jobs';

async function read<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(path);
  expect(response.status(), path).toBe(200);
  return response.json();
}

async function collect(request: APIRequestContext, adapter: 'web' | 'csv', baseURL: string) {
  const web = adapter === 'web';
  const bytes = await readFile(new URL(web ? 'm0/table.html' : 'm1/listings.csv', fixtures));
  const entry = web ? { adapter_type: 'web', url: origin + '/table.html' }
    : { adapter_type: 'csv', dataset_id: 'listings', content: bytes.toString('utf-8') };
  const sample = web ? entry : { ...entry, content: 'Key,Name,Count\na0,Sample,1\n' };
  const created = await request.post(sourcePrefix, { data: {
    source_name: `M4-D ${adapter} ${randomUUID().slice(0, 8)}`,
    adapter_type: adapter, permission_reference: 'Project fixture', approval_status: 'approved',
    ...(web ? { allowed_origins: [origin] } : { allowed_datasets: ['listings'] }),
  } });
  expect(created.status()).toBe(201);
  const { source_id: sourceId } = await created.json();
  const schema = { record_type: 'listing', schema_version: '1', identity_field: 'key',
    fields: [{ name: 'key' }, { name: 'title' }, ...(web ? [] : [{ name: 'count', value_type: 'integer' }])],
  };
  const mapping = web ? {
    selector_type: 'css', item_selector: '#entries tr',
    fields: [{ name: 'key', selector: 'a', mode: 'attribute', attribute: 'data-code' },
      { name: 'title', selector: 'a' }],
  } : { columns: [{ name: 'key', column: 'Key' }, { name: 'title', column: 'Name' },
    { name: 'count', column: 'Count' }] };
  const draft = await request.post(`${sourcePrefix}/${sourceId}/versions`, { data: {
    configuration: { adapter_type: adapter, config_schema_version: '1', record_schema: schema, ...mapping },
  } });
  expect(draft.status()).toBe(201);
  const draftProfile: Profile = await draft.json();
  const profileApi = `${sourcePrefix}/${sourceId}/versions/${draftProfile.profile_version_id}`;
  const validation = await request.post(profileApi + '/validate', { data: sample });
  expect(validation.status()).toBe(200);
  const report = await validation.json();
  expect(report.passed).toBe(true);
  const approved = await request.post(profileApi + '/approve', {
    headers: { Origin: baseURL },
    data: { approver: 'M4-D fixture operator', report_id: report.report_id, config_hash: draftProfile.config_hash },
  });
  expect(approved.status()).toBe(200);
  const profile: Profile = await approved.json();
  expect(profile.approval_status).toBe('approved');
  const submission = await request.post(jobPrefix, { data: {
    source_id: sourceId, profile_version_id: profile.profile_version_id, entry, request_key: randomUUID(),
  } });
  expect(submission.status()).toBe(201);
  const { job_id: jobId } = await submission.json();
  const jobPath = '/collection-jobs/' + jobId;
  const terminal = web ? 'succeeded' : 'partial';
  await expect.poll(async () => (await read<CollectionJob>(request, api + jobPath)).status,
    { timeout: 25_000 }).toBe(terminal);
  const job = await read<CollectionJob>(request, api + jobPath);
  const recordsPath = '/records?job_id=' + jobId;
  const records = await read<GenericRecord[]>(request, api + recordsPath);
  expect(records).toHaveLength(2);
  const first = records[0]!;
  const recordPath = '/records/' + first.record_id;
  const evidencePath = '/evidence/' + first.evidence_reference;
  const quarantinePath = jobPath + '/quarantine';
  const snapshot = {
    job,
    record: await read<GenericRecord>(request, api + recordPath),
    evidence: await read<EvidenceMetadata>(request, api + evidencePath),
    quarantine: await read<QuarantineEntry[]>(request, api + quarantinePath),
    profile: await read<Profile>(request, profileApi),
  };
  expect(snapshot.record).toEqual(first);
  const fixtureBytes = web ? [bytes, bytes.toString('utf8').replace(/\r\n/g, '\n')] : [bytes];
  expect(fixtureBytes.map(value => createHash('sha256').update(value).digest('hex'))).toContain(snapshot.evidence.content_hash);
  expect(first.profile_version_id).toBe(job.profile_version_id);
  expect(first.provenance.config_hash).toBe(profile.config_hash);
  expect(snapshot.evidence.profile_version_id).toBe(job.profile_version_id);
  expect(snapshot.evidence.job_id).toBe(jobId);
  expect(snapshot.evidence.config_hash).toBe(profile.config_hash);
  expect(snapshot.profile).toEqual(profile);
  return { jobPath, recordsPath, recordPath, quarantinePath, evidencePath, profileApi, bytes, records, snapshot };
}

async function openRecord(page: Page, fixture: Awaited<ReturnType<typeof collect>>) {
  const { record, job } = fixture.snapshot;
  await page.goto(fixture.jobPath);
  await page.getByRole('link', { name: 'View job records' }).click();
  await expect(page).toHaveURL(fixture.recordsPath + '&from=' + encodeURIComponent(fixture.jobPath));
  await expect(page.getByRole('textbox', { name: 'Job ID' })).toHaveValue(job.job_id);
  await expect(page.getByRole('list', { name: 'Persisted generic records' }).getByRole('listitem')).toHaveCount(2);
  await page.locator('#inspect-record-' + record.record_id).click();
  await page.getByRole('link', { name: 'Open Record Details' }).click();
  expect(new URL(page.url()).pathname).toBe(fixture.recordPath);
  const json = page.getByRole('region', { name: 'Record payload JSON' });
  await expect(json).toBeVisible();
  expect(JSON.parse((await json.textContent())!)).toEqual(record.payload);
  await page.getByText('Provenance and identifiers', { exact: true }).click();
  await expect(page.getByText(job.config_hash, { exact: true })).toBeVisible();
}

test('real HTML Job traces the persisted payload through Evidence, Job and approved Profile', async ({ page, request, baseURL }) => {
  test.setTimeout(60_000);
  const fixture = await collect(request, 'web', baseURL!);
  const { job, record, evidence } = fixture.snapshot;
  expect([job.status, job.valid_count, job.invalid_count, job.duplicate_count]).toEqual(['succeeded', 2, 0, 0]);
  expect(new Set(fixture.records.map(row => row.payload.title))).toEqual(new Set(['River Walk', 'Lake View']));
  expect(new Set(fixture.records.map(row => row.source_position.index))).toEqual(new Set([1, 2]));
  expect(fixture.snapshot.quarantine).toEqual([]);
  await openRecord(page, fixture);
  await expect(page.getByText('HTML item ' + record.source_position.index, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open evidence ' + record.evidence_reference }).click();
  expect(new URL(page.url()).pathname).toBe(fixture.evidencePath);
  await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'HTML input' })).toContainText(evidence.original_location);
  await expect(page.getByRole('region', { name: 'HTML input' })).toContainText(evidence.content_type!);
  expect(evidence.http_status).toBe(200);
  await page.getByRole('link', { name: 'Open job ' + job.job_id }).click();
  await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('SUCCEEDED');
  await page.getByRole('link', { name: 'View quarantine' }).click();
  await expect(page.getByText('No quarantine entries for this job.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Job Details' }).click();
  await page.getByRole('region', { name: 'Run overview' }).getByRole('link', { name: 'Version 1', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile version 1' })).toBeVisible();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  console.log('HTML acceptance', job.job_id, record.record_id, evidence.evidence_id, evidence.content_hash);
});

test('real partial CSV preserves physical row positions, evidence and independent duplicate counts', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const fixture = await collect(request, 'csv', baseURL!);
  const { job, record, evidence, quarantine } = fixture.snapshot;
  expect([job.status, job.valid_count, job.invalid_count, job.duplicate_count]).toEqual(['partial', 2, 3, 1]);
  expect(quarantine.map(entry => entry.source_position)).toEqual([5, 6, 7].map(index => ({ kind: 'csv_row', index })));
  expect(quarantine.map(entry => entry.problems[0]?.code)).toEqual(['required_field', 'wrong_type', 'invalid_row']);
  expect(quarantine.every(entry => entry.evidence_reference === evidence.evidence_id)).toBe(true);
  expect(fixture.records.every(row => row.evidence_reference === evidence.evidence_id)).toBe(true);
  await openRecord(page, fixture);
  await page.getByRole('link', { name: 'Open job ' + job.job_id }).click();
  await page.getByRole('link', { name: 'View quarantine' }).click();
  await expect(page).toHaveURL(fixture.quarantinePath + '?from=' + encodeURIComponent('/collection-jobs/' + job.job_id));
  await expect(page.getByRole('region', { name: 'Job results' })).toContainText('Partial');
  for (const [label, count] of [['Accepted', 2], ['Invalid', 3], ['Duplicates', 1]]) {
    await expect(page.getByText(String(label), { exact: true }).locator('..')).toHaveText(`${label}${count}`);
  }
  const entries = page.getByRole('list', { name: 'Quarantine entries' });
  await expect(entries.getByRole('heading')).toHaveCount(3);
  for (const entry of quarantine) {
    await expect(entries.getByRole('heading', { name: 'CSV row ' + entry.source_position.index })).toBeVisible();
    for (const problem of entry.problems) await expect(entries.getByText(problem.message, { exact: true })).toBeVisible();
  }
  await entries.getByRole('link', { name: 'Open evidence ' + evidence.evidence_id }).first().click();
  await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'CSV input' })).toContainText('listings');
  await expect(page.getByText('HTTP status', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'View job records' }).click();
  await expect(page).toHaveURL(fixture.recordsPath);

  if (process.env.M4D_CAPTURE_DIR) await captureViews(page, process.env.M4D_CAPTURE_DIR, fixture);
  console.log('CSV acceptance', job.job_id, record.record_id, evidence.evidence_id, evidence.content_hash);
});

async function captureViews(page: Page, output: string, fixture: Awaited<ReturnType<typeof collect>>) {
  await mkdir(output, { recursive: true });
  for (const width of [1440, 1280, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const [name, path, content] of [
      ['records', fixture.recordsPath, page.getByRole('list', { name: 'Persisted generic records' })],
      ['record', fixture.recordPath, page.getByRole('region', { name: 'Record payload JSON' })],
      ['quarantine', fixture.quarantinePath, page.getByRole('list', { name: 'Quarantine entries' })],
      ['evidence', fixture.evidencePath, page.getByText(fixture.snapshot.evidence.content_hash, { exact: true })],
    ] as const) {
      await page.goto(path);
      await expect(content).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
      expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
      await page.screenshot({ path: join(output, `${name}-${width}.png`), fullPage: true });
    }
  }
}

const project = process.env.M4D_COMPOSE_PROJECT;

test('isolated API and database recover with identical result snapshots and stored evidence bytes', async ({ page, request, baseURL }) => {
  test.skip(!project, 'Set M4D_COMPOSE_PROJECT for the isolated service restart');
  test.setTimeout(150_000);
  if (!/^collection-m3-test-[a-z0-9-]+$/.test(project!)) throw new Error('Select a dedicated M3 Compose test project');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  function compose(...args: string[]) {
    const overlays = (process.env.M4_COMPOSE_OVERLAYS ?? '').split(';').filter(Boolean)
      .flatMap(path => ['-f', path]);
    return execFileSync('docker', ['compose', '-p', project!, '-f', 'compose.yaml', '-f', 'compose.fixture.yaml', ...overlays, ...args],
      { cwd: root, timeout: 60_000 }).toString().trim();
  }
  const publish = compose('port', 'api', '8000');
  expect(publish).toMatch(/^127\.0\.0\.1:\d+$/);
  expect(process.env.API_PROXY_TARGET).toBe('http://' + publish);
  const postgres = compose('ps', '-q', 'postgres');
  const volumeBefore = execFileSync('docker', ['inspect', '--format',
    '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}', postgres]).toString().trim();
  expect(volumeBefore).toBe(project + '_postgres_data');
  const fixture = await collect(request, 'csv', baseURL!);
  const { record, evidence } = fixture.snapshot;

  compose('stop', 'api', 'postgres');
  try {
    if (process.env.M4_DEPLOYED_FRONTEND === '1') {
      const outage = await request.get(api + '/health', { timeout: 10_000 });
      expect([502, 503, 504]).toContain(outage.status());
    }
    await page.goto(fixture.recordsPath);
    await expect(page.getByRole('alert')).toContainText('Backend unavailable', { timeout: 12_000 });
    await expect(page.getByRole('list', { name: 'Persisted generic records' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Job ID' })).toHaveValue(record.job_id);
  } finally {
    compose('up', '-d', '--no-build', '--no-recreate', '--wait', 'postgres', 'api');
  }
  await expect.poll(async () => (await request.get(api + '/health')).ok(), { timeout: 20_000 }).toBe(true);
  const postgresAfter = compose('ps', '-q', 'postgres');
  const volumeAfter = execFileSync('docker', ['inspect', '--format',
    '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}', postgresAfter]).toString().trim();
  expect(volumeAfter).toBe(volumeBefore);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page).toHaveURL(fixture.recordsPath);
  await page.locator('#inspect-record-' + record.record_id).click();
  await page.getByRole('link', { name: 'Open Record Details' }).click();
  await expect(page.getByRole('region', { name: 'Record payload JSON' })).toBeVisible();
  await page.getByRole('link', { name: 'Open evidence ' + evidence.evidence_id }).click();
  await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open job ' + record.job_id }).click();
  await page.getByRole('link', { name: 'View quarantine' }).click();
  await expect(page.getByRole('heading', { name: 'CSV row 7' })).toBeVisible();
  for (const [key, path] of [
    ['job', api + fixture.jobPath], ['record', api + fixture.recordPath], ['evidence', api + fixture.evidencePath],
    ['quarantine', api + fixture.quarantinePath], ['profile', fixture.profileApi],
  ] as const) {
    expect(await read(request, path)).toEqual(fixture.snapshot[key]);
  }
  const storedHash = compose('exec', '-T', 'api', 'python', '-c',
    'import os,sys; from pathlib import Path; from backend.core.evidence import LocalEvidenceStore; meta,body=LocalEvidenceStore(Path(os.environ["EVIDENCE_ROOT"])).resolve(sys.argv[1]); import hashlib; print(hashlib.sha256(body).hexdigest())',
    evidence.evidence_id.replaceAll('-', ''));
  expect(storedHash).toBe(evidence.content_hash);
  expect(storedHash).toBe(createHash('sha256').update(fixture.bytes).digest('hex'));
  console.log('Restart acceptance', record.job_id, record.record_id, evidence.evidence_id, volumeAfter);
});
