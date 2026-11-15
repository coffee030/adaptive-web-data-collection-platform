import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { CollectionJob, ExecutionEvent, JobInput } from '../src/features/collection-jobs/api';
import type { Profile, Report } from '../src/features/profiles/api';
import type { EvidenceMetadata, GenericRecord, QuarantineEntry } from '../src/features/results/api';
import type { Source } from '../src/features/sources/api';

const api = '/api/v1';
const jobs = '/collection-jobs';
const origin = 'http://collection-fixture:8001';
const fixture = new URL('../../backend/tests/fixtures/', import.meta.url);
const project = process.env.M4E_COMPOSE_PROJECT;
const captureDirectory = process.env.M4E_CAPTURE_DIR;
type Adapter = 'web' | 'csv';
type JobSubmission = JobInput & { request_key: string };

async function get<T>(request: APIRequestContext, route: string): Promise<T> {
  const response = await request.get(api + route);
  expect(response.status(), route).toBe(200);
  return response.json();
}

async function registerSource(page: Page, adapter: Adapter) {
  const web = adapter === 'web';
  const name = `M4-E ${adapter} ${randomUUID().slice(0, 8)}`;
  await page.goto('/sources/new');
  await page.getByRole('textbox', { name: 'Source name' }).fill(name);
  await page.getByRole('combobox', { name: 'Adapter' }).selectOption(adapter);
  await page.getByRole('textbox', { name: 'Permission reference' }).fill('M4-E controlled fixture');
  await page.getByRole('textbox', { name: web ? 'Allowed origins' : 'Allowed dataset IDs' }).fill(web ? origin : 'listings');
  const response = page.waitForResponse(reply => reply.url().endsWith(api + '/sources') && reply.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create source' }).click();
  const reply = await response;
  expect(reply.status()).toBe(201);
  const source: Source = await reply.json();
  const path = '/sources/' + source.source_id;
  await expect(page).toHaveURL(path);
  await expect(page.getByRole('region', { name: 'Access policy' })).toContainText('Pending');
  await expect(page.getByRole('link', { name: 'New Collection Job' })).toHaveCount(0);
  expect(source.approval_status).toBe('pending');
  return { source, path, name };
}

async function createDraft(page: Page, adapter: Adapter) {
  const web = adapter === 'web';
  await page.getByRole('link', { name: 'Create draft', exact: true }).click();
  await page.getByRole('textbox', { name: 'Record type' }).fill('listing');
  if (web) await page.getByRole('textbox', { name: 'Item selector' }).fill('#entries tr');
  await page.getByRole('textbox', { name: 'Output field name' }).fill(web ? 'title' : 'key');
  const target = web ? 'Field selector' : 'CSV header';
  await page.getByRole('textbox', { name: target, exact: true }).fill(web ? 'a' : 'Key');
  await page.getByRole('button', { name: 'Add field' }).click();
  const second = page.getByRole('group', { name: 'Field 2' });
  await second.getByRole('textbox', { name: 'Output field name' }).fill(web ? 'key' : 'title');
  await second.getByRole('textbox', { name: target, exact: true }).fill(web ? 'a' : 'Name');
  if (web) {
    await second.getByRole('combobox', { name: 'Extraction mode' }).selectOption('attribute');
    await second.getByRole('textbox', { name: 'Attribute name' }).fill('data-code');
  } else {
    await page.getByRole('button', { name: 'Add field' }).click();
    const third = page.getByRole('group', { name: 'Field 3' });
    await third.getByRole('textbox', { name: 'Output field name' }).fill('count');
    await third.getByRole('textbox', { name: target }).fill('Count');
    await third.getByRole('combobox', { name: 'Value type' }).selectOption('integer');
  }
  await page.getByRole('combobox', { name: 'Identity field' }).selectOption(web ? '1' : '0');
  const created = page.waitForResponse(reply => reply.url().endsWith('/versions') && reply.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const draft: Profile = await response.json();
  const path = `/sources/${draft.source_id}/profiles/${draft.profile_version_id}`;
  await expect(page).toHaveURL(path);
  const recordType = page.getByRole('textbox', { name: 'Record type' });
  await recordType.click();
  await recordType.fill('listing_item');
  const saveDraft = page.getByRole('button', { name: 'Save draft' });
  await expect(saveDraft).toBeEnabled();
  await saveDraft.click();
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
  return { path, apiPath: `/sources/${draft.source_id}/versions/${draft.profile_version_id}`, draft };
}

async function scan(page: Page, name: string, widths = [1440, 1280, 768, 390]) {
  if (!captureDirectory) return;
  await mkdir(captureDirectory, { recursive: true });
  for (const width of widths) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), name).toBe(width);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations, name + '-' + width).toEqual([]);
    await page.screenshot({ path: join(captureDirectory, `${name}-${width}.png`), fullPage: true });
  }
}

function isolatedCompose() {
  if (!/^collection-m3-test-[a-z0-9-]+$/.test(project ?? '')) throw new Error('Select a dedicated M3 Compose test project');
  const root = fileURLToPath(new URL('../../', import.meta.url));
  function compose(...args: string[]) {
    const overlays = (process.env.M4_COMPOSE_OVERLAYS ?? '').split(';').filter(Boolean)
      .flatMap(path => ['-f', path]);
    return execFileSync('docker', ['compose', '-p', project!, '-f', 'compose.yaml', '-f', 'compose.fixture.yaml', ...overlays, ...args],
      { cwd: root, timeout: 60_000 }).toString().trim();
  }
  const published = compose('port', 'api', '8000');
  expect(published).toMatch(/^127\.0\.0\.1:\d+$/);
  expect(process.env.API_PROXY_TARGET).toBe('http://' + published);
  return compose;
}

function jobResponse(page: Page) {
  return page.waitForResponse(reply => new URL(reply.url()).pathname === api + jobs && reply.request().method() === 'POST');
}

test('M6 browser workflow approves pagination and follows page-level evidence', async ({ page, request }) => {
  test.setTimeout(60_000);
  const registered = await registerSource(page, 'web');
  const authorization = await request.patch(api + registered.path + '/authorization', {
    data: { approval_status: 'approved' },
  });
  expect(authorization.status()).toBe(200);
  await page.reload();
  await page.getByRole('link', { name: 'Create draft', exact: true }).click();
  await page.getByRole('textbox', { name: 'Record type' }).fill('paginated_listing');
  await page.getByRole('textbox', { name: 'Item selector' }).fill('article');
  await page.getByRole('textbox', { name: /Next-link selector/ }).fill('a.next');
  await page.getByRole('combobox', { name: 'Maximum HTML pages' }).selectOption('3');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('title');
  await page.getByRole('textbox', { name: 'Field selector', exact: true }).fill('h2');
  await page.getByRole('combobox', { name: 'Identity field' }).selectOption('0');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const sample = page.getByRole('textbox', { name: 'Document path' });
  await sample.fill('/pagination/1');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText('Alpha');
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Approver label' }).fill('M6 fixture operator');
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  await expect(page.getByText('Next-link selector (css)', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'New Collection Job', exact: true }).click();
  await page.getByRole('textbox', { name: 'Document path' }).fill('/pagination/1');
  const submitted = jobResponse(page);
  await page.getByRole('button', { name: 'Submit job', exact: true }).click();
  const confirmation = await submitted;
  expect(confirmation.status()).toBe(201);
  const job: CollectionJob = await confirmation.json();
  const jobPath = `${jobs}/${job.job_id}`;
  await expect(page).toHaveURL(jobPath);
  await expect(page.getByRole('region', { name: 'Run overview' }).getByText('Partial', { exact: true })).toBeVisible();
  const captureList = page.getByRole('region', { name: 'Capture evidence' });
  await expect(captureList.getByRole('listitem')).toHaveText([/^Page 1 /, /^Page 2 /, /^Page 3 /]);
  const captures = await get<EvidenceMetadata[]>(request, jobPath + '/evidence-pages');
  const third = captures[2]!;
  await captureList.getByRole('link', { name: 'Open evidence ' + third.evidence_id }).click();
  await expect(page.getByRole('heading', { name: 'Evidence Metadata' })).toBeVisible();
  await expect(page.getByText(origin + '/pagination/3', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(third.content_hash, { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'View quarantine' }).click();
  await expect(page.getByRole('heading', { name: 'HTML item 2', exact: true })).toHaveCount(2);
  for (const evidence of captures.slice(1)) {
    await expect(page.getByRole('link', { name: 'Open evidence ' + evidence.evidence_id })).toBeVisible();
  }
  const records = await get<GenericRecord[]>(request, `/records?job_id=${job.job_id}`);
  expect(Object.fromEntries(records.map(record => [record.payload.title, record.evidence_reference]))).toEqual({
    Alpha: captures[0]!.evidence_id, Beta: captures[1]!.evidence_id, Gamma: third.evidence_id,
  });
  console.log(`M6 browser Job ${job.job_id}: three evidence pages, three records and two quarantine entries`);
});

for (const adapter of ['web', 'csv'] as const) {
  test(`Core ${adapter} workflow registers, configures, approves, submits and traces a real Job`, async ({ page, request, baseURL }) => {
    test.setTimeout(180_000);
    const web = adapter === 'web';
    if (web && captureDirectory) {
      await page.goto(jobs);
      await expect(page.getByRole('table', { name: /Collection jobs/ })).toBeVisible();
      await scan(page, 'jobs');
      await page.goto('/sources');
      await expect(page.getByRole('heading', { name: 'Sources', exact: true })).toBeVisible();
      await expect(page.getByText('Loading sources…')).toHaveCount(0);
      await scan(page, 'sources');
      await page.goto('/sources/new');
      await scan(page, 'source-create');
    }
    const registered = await registerSource(page, adapter);
    const { source, path: sourcePath } = registered;
    const approval = await request.patch(api + sourcePath + '/authorization', { data: { approval_status: 'approved' } });
    expect(approval.status()).toBe(200);
    await page.reload();
    await expect(page.getByRole('region', { name: 'Access policy' })).toContainText('Approved');
    if (!web) await scan(page, 'source-detail');
    const profile = await createDraft(page, adapter);
    const bytes = await readFile(new URL(web ? 'm0/table.html' : 'm1/listings.csv', fixture));
    const csv = bytes.toString('utf-8');
    const sample = page.getByRole('textbox', { name: web ? 'Document path' : 'CSV sample' });
    await sample.fill(web ? '/table.html' : csv);
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText(web ? 'River Walk' : 'North Trail');
    if (!web) {
      const failed = page.waitForResponse(reply => reply.url().endsWith('/validate'));
      await page.getByRole('button', { name: 'Validate sample' }).click();
      const report: Report = await (await failed).json();
      expect(report.passed).toBe(false);
      await expect(page.getByRole('heading', { name: 'Validation failed' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Approve version' })).toHaveCount(0);
      const denied = await request.post(api + profile.apiPath + '/approve', { headers: { Origin: baseURL! },
        data: { approver: 'M4-E operator', report_id: report.report_id, config_hash: report.config_hash } });
      expect(denied.status()).toBe(409);
      expect((await denied.json()).error.code).toBe('validation_failed');
      await sample.fill('Key,Name,Count\na0,Sample,1\n');
    }
    await page.getByRole('button', { name: 'Validate sample' }).click();
    await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
    if (web) await scan(page, 'profile-approval');
    await page.getByRole('textbox', { name: 'Approver label' }).fill('M4-E fixture operator');
    await page.getByRole('checkbox', { name: /confirm approval/ }).check();
    await page.getByRole('button', { name: 'Approve version' }).click();
    await expect(page.getByText('Read only', { exact: true })).toBeVisible();
    if (web) await scan(page, 'profile-approved');
    const approved = await get<Profile>(request, profile.apiPath);
    expect(approved.approval_status).toBe('approved');
    const put = await request.put(api + profile.apiPath, { data: { configuration: approved.configuration } });
    expect(put.status()).toBe(409);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'New Collection', exact: true }).click();
    await page.getByRole('radio', { name: web ? /HTML pages/ : /CSV datasets/ }).check();
    await page.getByRole('combobox', { name: '2. Select a source' }).selectOption(source.source_id);
    await expect(page.getByRole('combobox', { name: 'Profile Version' })).toHaveValue(approved.profile_version_id);
    await expect(page.getByRole('region', { name: 'Version 1' })).toContainText('Extraction Fields');
    const input = page.getByRole('textbox', { name: web ? 'Document path' : 'CSV content' });
    await input.fill(web ? '/table.html' : csv);
    await scan(page, web ? 'job-form-html' : 'job-form-csv');
    await page.setViewportSize({ width: 1280, height: 900 });
    const response = jobResponse(page);
    await page.getByRole('button', { name: 'Start Collection', exact: true }).click();
    const created = await response;
    expect(created.status()).toBe(201);
    const accepted: CollectionJob = await created.json();
    const body: JobSubmission = created.request().postDataJSON();
    expect(body.profile_version_id).toBe(approved.profile_version_id);
    if (body.entry.adapter_type === 'csv') {
      // Compare fixture rows across browser newline handling. The evidence check uses the exact submitted text.
      const normalizeNewlines = (text: string) => text.replace(/\r\n?/g, '\n');
      expect(normalizeNewlines(body.entry.content)).toBe(normalizeNewlines(csv));
    }
    expect(body.request_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(accepted.status).toBe('pending');
    const jobPath = jobs + '/' + accepted.job_id;
    await expect(page).toHaveURL(jobPath);
    const overview = page.getByRole('region', { name: 'Run overview' });
    const terminal = web ? 'Succeeded' : 'Partial';
    await expect(overview.getByText(terminal, { exact: true })).toBeVisible({ timeout: 30_000 });
    const events = page.getByRole('region', { name: 'Execution events' });
    for (const code of ['JOB_CREATED', 'DISPATCHED', 'CLAIMED', terminal.toUpperCase()]) await expect(events).toContainText(code);
    await scan(page, web ? 'job-html' : 'job-csv');
    const confirmed = await get<CollectionJob>(request, jobPath);
    expect(confirmed.config_hash).toBe(approved.config_hash);
    expect([confirmed.valid_count, confirmed.invalid_count, confirmed.duplicate_count]).toEqual(web ? [2, 0, 0] : [2, 3, 1]);
    const quarantine = await get<QuarantineEntry[]>(request, jobPath + '/quarantine');
    expect(quarantine.map(entry => entry.source_position.index)).toEqual(web ? [] : [5, 6, 7]);
    const history = await get<ExecutionEvent[]>(request, jobPath + '/events');
    expect(history.map(event => event.kind)).toEqual(['JOB_CREATED', 'DISPATCHED', 'CLAIMED', terminal.toUpperCase()]);
    await page.getByRole('link', { name: 'View quarantine' }).click();
    if (web) await expect(page.getByText('No quarantine entries for this job.')).toBeVisible();
    else {
      for (const [index, problem] of ['required_field', 'wrong_type', 'invalid_row'].entries()) {
        await expect(page.getByRole('heading', { name: 'CSV row ' + (index + 5) })).toBeVisible();
        await expect(page.getByText(problem, { exact: true })).toBeVisible();
      }
      await scan(page, 'quarantine');
    }
    await page.getByRole('link', { name: 'View job records' }).click();
    const recordsPath = '/records?job_id=' + accepted.job_id;
    await expect(page).toHaveURL(recordsPath);
    const records = await get<GenericRecord[]>(request, recordsPath);
    expect(records).toHaveLength(2);
    expect(new Set(records.map(item => item.payload.title))).toEqual(new Set(web ? ['River Walk', 'Lake View'] : ['North Trail', 'River Walk']));
    const record = records[0]!;
    const recordsTable = page.getByRole('table', { name: 'Persisted generic records' });
    await expect(recordsTable.getByRole('row')).toHaveCount(3);
    const quality = page.getByRole('region', { name: 'Quality for this job' });
    await expect(quality.locator('dd strong')).toHaveText(web ? ['2', '0', '0'] : ['2', '3', '1']);
    await page.getByText('Fields to Display').click();
    await page.getByRole('checkbox', { name: 'title', exact: true }).uncheck();
    await expect(recordsTable.getByRole('columnheader', { name: 'title' })).toHaveCount(0);
    expect(await get(request, recordsPath)).toEqual(records);
    await page.getByRole('checkbox', { name: 'title', exact: true }).check();
    if (!web) await scan(page, 'records');
    await recordsTable.locator(`a[href="/records/${record.record_id}"]`).click();
    const json = page.getByRole('region', { name: 'Record payload JSON' });
    await expect(json).toBeVisible();
    expect(JSON.parse((await json.textContent())!)).toEqual(record.payload);
    if (!web) await scan(page, 'record');
    const evidencePath = '/evidence/' + record.evidence_reference;
    await page.getByRole('link', { name: 'Open evidence ' + record.evidence_reference }).click();
    const evidence = await get<EvidenceMetadata>(request, evidencePath);
    await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
    const capturedInput = body.entry.adapter_type === 'csv' ? body.entry.content : bytes;
    expect(evidence.content_hash).toBe(createHash('sha256').update(capturedInput).digest('hex'));
    expect(evidence.profile_version_id).toBe(confirmed.profile_version_id);
    expect(quarantine.every(entry => entry.evidence_reference === evidence.evidence_id)).toBe(true);
    if (!web) await scan(page, 'evidence');
    await page.getByRole('link', { name: 'Open source ' + evidence.source_id }).click();
    await expect(page.getByRole('heading', { name: registered.name })).toBeVisible();
    await page.getByRole('link', { name: 'Open profile version 1' }).click();
    await expect(page.getByText('Read only', { exact: true })).toBeVisible();

    if (!web && project) {
      const compose = isolatedCompose();
      const before = [sourcePath, profile.apiPath, jobPath, jobPath + '/events', recordsPath,
        jobPath + '/quarantine', evidencePath];
      const snapshot = await Promise.all(before.map(route => get(request, route)));
      await page.goto(profile.path);
      await page.getByRole('link', { name: 'New Collection Job' }).click();
      await page.getByRole('textbox', { name: 'CSV content' }).fill(csv);
      compose('stop', 'postgres');
      let failedBody: JobSubmission | undefined;
      try {
        const failed = jobResponse(page);
        await page.getByRole('button', { name: 'Submit job' }).click();
        const failure = await failed;
        expect(failure.status()).toBe(503);
        expect((await failure.json()).error.code).toBe('database_unavailable');
        failedBody = failure.request().postDataJSON();
        await expect(page.getByRole('alert')).toContainText('did not confirm');
        await expect(page.getByRole('heading', { name: 'Job Details' })).toHaveCount(0);
      } finally {
        compose('stop', 'api');
        compose('start', '--wait', 'postgres', 'api');
      }
      await expect.poll(async () => (await request.get(api + '/health')).ok(), { timeout: 20_000 }).toBe(true);
      expect(await Promise.all(before.map(route => get(request, route)))).toEqual(snapshot);
      const recovered = jobResponse(page);
      await page.getByRole('button', { name: 'Retry submission' }).click();
      const reply = await recovered;
      expect(reply.status()).toBe(201);
      expect(reply.request().postDataJSON()).toEqual(failedBody);
      const recoveredJob: CollectionJob = await reply.json();
      await expect(page).toHaveURL(jobs + '/' + recoveredJob.job_id);
      await expect(page.getByRole('region', { name: 'Run overview' }).getByText('Partial', { exact: true }))
        .toBeVisible({ timeout: 30_000 });
      const replay = await request.post(api + jobs, { data: failedBody });
      expect(replay.status()).toBe(200);
      expect((await replay.json()).job_id).toBe(recoveredJob.job_id);
      await page.goto(jobPath);
      await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('PARTIAL');
      await page.getByRole('link', { name: 'View quarantine' }).click();
      await expect(page.getByRole('heading', { name: 'CSV row 7' })).toBeVisible();
      await page.getByRole('link', { name: 'Open evidence ' + evidence.evidence_id }).first().click();
      await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
      console.log('M4-E restart and real replay', confirmed.job_id, recoveredJob.job_id);
    }
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Recent collection jobs' })).toContainText(registered.name);
    const latest = page.getByRole('region', { name: 'Recent accepted records' });
    await expect(latest).toContainText(web ? 'River Walk' : 'North Trail');
    if (!web) await scan(page, 'dashboard');
    console.log('M4-E acceptance', adapter, confirmed.job_id, confirmed.created_at, confirmed.finished_at,
      source.source_id, approved.profile_version_id, record.record_id, evidence.evidence_id, evidence.content_hash);
  });
}

test('real Job API rejects pending access, draft versions and unauthorized dataset IDs', async ({ page, request }) => {
  const { source, path } = await registerSource(page, 'csv');
  const profile = await createDraft(page, 'csv');
  const input = { source_id: source.source_id, profile_version_id: profile.draft.profile_version_id,
    entry: { adapter_type: 'csv', dataset_id: 'listings', content: 'Key,Name,Count\na0,Sample,1\n' } };
  async function rejected(data: object, status: number, code: string) {
    const response = await request.post(api + jobs, { data });
    expect(response.status()).toBe(status);
    expect((await response.json()).error.code).toBe(code);
  }
  await rejected(input, 409, 'profile_not_approved');
  const approveSource = await request.patch(api + path + '/authorization', { data: { approval_status: 'approved' } });
  expect(approveSource.status()).toBe(200);
  await rejected(input, 409, 'profile_not_approved');
  await rejected({ ...input, entry: { adapter_type: 'csv' } }, 422, 'invalid_request');
  await page.goto(profile.path);
  await page.getByRole('textbox', { name: 'CSV sample' }).fill(input.entry.content);
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Approver label' }).fill('M4-E fixture operator');
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  await rejected({ ...input, entry: { ...input.entry, dataset_id: 'outside-policy' } }, 403, 'dataset_not_allowed');
  await page.getByRole('link', { name: 'New Collection Job' }).click();
  await page.getByRole('textbox', { name: 'CSV content' }).fill(input.entry.content);
  const reset = await request.patch(api + path + '/authorization', { data: { approval_status: 'pending' } });
  expect(reset.status()).toBe(200);
  const rejectedWrite = jobResponse(page);
  await page.getByRole('button', { name: 'Submit job' }).click();
  const refused = await rejectedWrite;
  expect(refused.status()).toBe(403);
  expect((await refused.json()).error.code).toBe('source_not_approved');
  await expect(page.getByRole('alert')).toContainText('Source access is no longer approved');
  await expect(page.getByRole('heading', { name: 'New Collection', exact: true })).toBeVisible();
});
