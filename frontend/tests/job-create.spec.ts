import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { CollectionJob, JobInput } from '../src/features/collection-jobs/api';
import type { ProfileVersion, Source } from '../src/features/sources/api';

const api = '/api/v1';
const jobs = '/collection-jobs';
const create = jobs + '/new';
const id = '14ca7e3e-51ea-43eb-838d-49c37a3e2809';
const versionId = '72cfcdf358034cf7aa469557acf33779';
const timestamp = '2026-11-14T04:00:00Z';
const csv: Source = {
  source_id: '8963d72efa604b24adb9e453eaeb7a9e', source_name: 'CSV fixture', adapter_type: 'csv',
  approval_status: 'approved', allowed_origins: [], allowed_datasets: ['listings', 'archive'], permission_reference: 'FYP',
};
const web: Source = {
  ...csv, source_id: 'd83f7367615a4a30bea8b0d2f970166d', source_name: 'HTML fixture', adapter_type: 'web',
  allowed_datasets: [], allowed_origins: ['http://collection-fixture:8001'],
};
const pending: Source = { ...csv, source_id: '30a9911f87a1432a8771721060d91618',
  source_name: 'Pending fixture', approval_status: 'pending' };
const empty: Source = { ...csv, source_id: '68a9911f87a1432a8771721060d91618',
  source_name: 'Missing policy', allowed_datasets: [] };
const approved: ProfileVersion = {
  profile_version_id: versionId, version: 2, approval_status: 'approved', config_hash: 'a'.repeat(64),
  approved_at: timestamp, approved_by: 'Fixture operator',
};
const draft = { ...approved, profile_version_id: 'draft-1', version: 1, approval_status: 'draft' };
const retired = { ...approved, profile_version_id: 'retired-3', version: 3, approval_status: 'retired' };
const job: CollectionJob = {
  job_id: id, source_id: csv.source_id, profile_version_id: versionId, config_hash: approved.config_hash,
  status: 'partial', created_at: timestamp, finished_at: timestamp, started_at: timestamp,
  valid_count: 2, invalid_count: 3, duplicate_count: 1, error: null, execution_attempt: 1, lease_expires_at: null,
  next_attempt_at: null, dispatch_due_at: null, last_dispatched_at: timestamp, dispatch_attempts: 1, dispatch_error_code: null,
};
type Payload = JobInput & { request_key: string };

async function mock(page: Page, submit: (route: Route, data: Payload) => Promise<void> = (route, data) => (
  route.fulfill({ status: 201, json: { ...job, source_id: data.source_id } })
)) {
  const sent: Payload[] = [];
  await page.route(url => url.pathname === api + '/sources', route => route.fulfill({ json: [csv, web, pending, empty] }));
  await page.route(url => url.pathname.startsWith(api + '/sources/') && url.pathname.endsWith('/versions'),
    route => route.fulfill({ json: [draft, approved, retired] }));
  await page.route(url => url.pathname === api + jobs, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: [] });
    const data = route.request().postDataJSON() as Payload;
    sent.push(data);
    return submit(route, data);
  });
  await page.route(api + jobs + '/' + id, route => route.fulfill({ json: job }));
  await page.route(api + jobs + '/' + id + '/events', route => route.fulfill({ json: [] }));
  await page.route(api + jobs + '/' + id + '/evidence', route => route.fulfill({ json: null }));
  await page.route(url => url.pathname === api + '/records', route => route.fulfill({ json: [] }));
  return sent;
}

const data = 'Name,Count\nNorth,2\n';
const submit = (page: Page) => page.getByRole('button', { name: 'Submit job' });

async function fillCsv(page: Page, content = data) {
  await page.goto(create + '?source_id=' + csv.source_id + '&profile_version_id=' + versionId);
  await page.getByRole('combobox', { name: 'Allowed dataset ID' }).selectOption('listings');
  await page.getByRole('textbox', { name: 'CSV content' }).fill(content);
}

test('Jobs creates one controlled HTML job by keyboard and preserves list filters', async ({ page }) => {
  const sent = await mock(page);
  await page.goto(jobs + '?status=partial&offset=20');
  await page.getByRole('link', { name: 'New Collection Job' }).click();
  await expect(page).toHaveURL(create);
  await page.getByRole('radio', { name: /HTML pages/ }).check();
  await page.getByRole('combobox', { name: '2. Select a source' }).selectOption(web.source_id);
  await expect(page.getByRole('combobox', { name: 'Profile Version' })).toHaveValue(versionId);
  await expect(page.getByRole('combobox', { name: 'Allowed origin' })).toHaveValue(web.allowed_origins[0]!);
  await page.getByRole('textbox', { name: 'Document path' }).fill('/table.html');
  await page.getByRole('textbox', { name: 'Document path' }).press('Enter');
  await expect(page).toHaveURL(jobs + '/' + id);
  await expect(page.getByRole('region', { name: 'Run overview' })).toContainText('Partial');
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ source_id: web.source_id, profile_version_id: versionId,
    entry: { adapter_type: 'web', url: 'http://collection-fixture:8001/table.html' },
    request_key: expect.stringMatching(/^[0-9a-f-]{36}$/) });
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Collection Jobs' }).click();
  await expect(page).toHaveURL(jobs + '?status=partial&offset=20');
});

test('CSV submission pins the requested version and blocks repeated actions while in flight', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const sent = await mock(page, async route => {
    await gate;
    return route.fulfill({ status: 201, json: job });
  });
  await fillCsv(page);
  try {
    await submit(page).focus();
    await page.keyboard.press('Enter');
    await expect(submit(page)).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.entry).toEqual({ adapter_type: 'csv', dataset_id: 'listings', content: data });
  } finally {
    release();
  }
  await expect(page).toHaveURL(jobs + '/' + id);
});

test('Pending access, empty policy, Draft and Retired prevent submission', async ({ page }) => {
  const sent = await mock(page);
  for (const source of [pending, empty]) {
    await page.goto(create + '?source_id=' + source.source_id);
    await expect(page.getByRole('status')).toContainText(source === pending ? 'approved Source access' : 'no permitted inputs');
    await expect(submit(page)).toHaveCount(0);
  }
  for (const version of [draft, retired]) {
    await page.goto(create + '?source_id=' + csv.source_id + '&profile_version_id=' + version.profile_version_id);
    await expect(page.getByRole('combobox', { name: 'Profile Version' })).toHaveValue(version.profile_version_id);
    await expect(page.getByRole('option', { name: `Version ${version.version} · ${version.approval_status}` })).toBeDisabled();
    await expect(page.getByText('The requested version is ineligible.', { exact: false })).toBeVisible();
    await expect(submit(page)).toHaveCount(0);
  }
  expect(sent).toHaveLength(0);
});

test('missing input, unauthorized origin syntax and oversize UTF-8 stay on the form', async ({ page }) => {
  const sent = await mock(page);
  await page.goto(create + '?source_id=' + web.source_id + '&profile_version_id=' + versionId);
  await submit(page).click();
  await expect(page.getByRole('alert')).toBeFocused();
  for (const value of ['http://example.invalid/table', '//example.invalid/table']) {
    await page.getByRole('textbox', { name: 'Document path' }).fill(value);
    await submit(page).click();
    await expect(page.getByRole('alert')).toContainText('single slash');
  }
  await page.goto(create + '?source_id=' + csv.source_id + '&profile_version_id=' + versionId);
  await page.getByRole('textbox', { name: 'CSV content' }).fill(data);
  await submit(page).click();
  await expect(page.getByRole('alert')).toContainText('allowed by the Source policy');
  await page.getByRole('combobox', { name: 'Allowed dataset ID' }).selectOption('listings');
  await page.getByRole('textbox', { name: 'CSV content' }).fill('漢'.repeat(350_000));
  await submit(page).click();
  await expect(page.getByRole('alert')).toContainText('1 MiB');
  expect(sent).toHaveLength(0);
});

for (const [status, code] of [[403, 'source_not_approved'], [409, 'job_request_conflict'], [422, 'invalid_request']] as const) {
  test(`HTTP ${status} leaves a confirmed rejection and permits editing`, async ({ page }) => {
    const sent = await mock(page, route => route.fulfill({ status, json: { error: { code, message: 'private message' } } }));
    await fillCsv(page);
    await submit(page).click();
    await expect(page.getByRole('alert')).toContainText('HTTP ' + status);
    await expect(page.getByText('private message')).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'CSV content' })).toBeEditable();
    await page.getByRole('textbox', { name: 'CSV content' }).fill(data + 'South,3\n');
    await submit(page).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]?.request_key).not.toBe(sent[0]?.request_key);
  });
}

for (const failure of ['503', 'network', 'timeout'] as const) {
  test(`uncertain ${failure} retries the exact request key and accepts the Job replay`, async ({ page }) => {
    let requests = 0;
    const sent = await mock(page, async route => {
      if (++requests > 1) return route.fulfill({ status: 200, json: job });
      if (failure === '503') return route.fulfill({ status: 503, json: {} });
      if (failure === 'network') return route.abort();
      await new Promise(resolve => setTimeout(resolve, 10_500));
      await route.abort().catch(() => {});
    });
    await fillCsv(page);
    await submit(page).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(failure === 'timeout' ? 'timed out' : 'did not confirm', { timeout: 15_000 });
    await expect(page.getByRole('textbox', { name: 'CSV content' })).toBeDisabled();
    await expect(page.getByRole('combobox', { name: 'Source', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Retry submission' }).click();
    await expect(page).toHaveURL(jobs + '/' + id);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
  });
}

test('matching intent can recover on return to the form and a confirmed job clears the key', async ({ page }) => {
  let requests = 0;
  const sent = await mock(page, route => ++requests === 1 ? route.abort() : route.fulfill({ status: 200, json: job }));
  await fillCsv(page);
  await submit(page).click();
  await page.getByRole('link', { name: 'Check Collection Jobs' }).click();
  await fillCsv(page);
  await submit(page).click();
  await expect(page).toHaveURL(jobs + '/' + id);
  expect(sent[1]).toEqual(sent[0]);
  await fillCsv(page);
  await submit(page).click();
  await expect(page).toHaveURL(jobs + '/' + id);
  expect(sent[2]?.request_key).not.toBe(sent[0]?.request_key);
});

test('active monitoring polls status and events, loads records once pending ends and stops at terminal', async ({ page }) => {
  await mock(page);
  let status: CollectionJob['status'] = 'pending';
  let reads = 0;
  let previews = 0;
  await page.route(api + jobs + '/' + id, route => {
    reads++;
    return route.fulfill({ json: { ...job, status } });
  });
  await page.route(api + jobs + '/' + id + '/events', route => route.fulfill({
    json: [{ event_id: 'first', job_id: id, status: 'pending', occurred_at: timestamp,
      kind: 'JOB_CREATED', execution_attempt: null, error: null },
    ...(status === 'partial' ? [{ event_id: 'last', job_id: id, status: 'partial', occurred_at: timestamp,
      kind: 'PARTIAL', execution_attempt: 1, error: null }] : [])],
  }));
  await page.route(url => url.pathname === api + '/records', route => {
    previews++;
    return route.fulfill({ json: [] });
  });
  await page.goto(jobs + '/' + id);
  await expect(page.getByText('Waiting for execution.', { exact: false })).toBeVisible();
  const overview = page.getByRole('region', { name: 'Run overview' });
  status = 'running';
  await expect(overview.getByText('Running', { exact: true })).toBeVisible({ timeout: 8000 });
  expect(previews).toBe(0);
  status = 'partial';
  await expect(overview).toContainText('Partial result', { timeout: 8000 });
  await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('PARTIAL');
  await expect(page.getByText('No validated records for this job.')).toBeVisible();
  expect(previews).toBeGreaterThan(0);
  const terminalReads = reads;
  const terminalPreviews = previews;
  await page.waitForTimeout(3200);
  expect(reads).toBe(terminalReads);
  expect(previews).toBe(terminalPreviews);
  await page.getByRole('button', { name: 'Refresh job' }).click();
  await expect.poll(() => reads).toBe(terminalReads + 1);
});

for (const width of [1440, 1280, 768, 390]) {
  test(`Job form remains usable with keyboard and axe at ${width}px`, async ({ page }) => {
    await mock(page);
    await page.setViewportSize({ width, height: 900 });
    await fillCsv(page);
    await expect(submit(page)).toBeVisible();
    await page.getByRole('textbox', { name: 'CSV content' }).press('Tab');
    await expect(submit(page)).toBeFocused();
    expect(await submit(page).evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  });
}

test('active Job polling stops when leaving the detail route', async ({ page }) => {
  await mock(page);
  let reads = 0;
  await page.route(api + jobs + '/' + id, route => {
    reads++;
    return route.fulfill({ json: { ...job, status: 'running' } });
  });
  await page.goto(jobs + '/' + id);
  await expect(page.getByText('Collection is in progress.', { exact: false })).toBeVisible();
  const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
  await breadcrumb.getByRole('link', { name: 'Collection Jobs' }).click();
  await expect(page).toHaveURL(jobs);
  const previous = reads;
  await page.waitForTimeout(3200);
  expect(reads).toBe(previous);
});
