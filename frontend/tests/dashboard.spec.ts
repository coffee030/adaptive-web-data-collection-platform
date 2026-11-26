import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { CollectionJob } from '../src/features/collection-jobs/api';
import type { Profile } from '../src/features/profiles/api';
import type { GenericRecord } from '../src/features/results/api';
import type { Source } from '../src/features/sources/api';

const api = '/api/v1';
const jobs = '/collection-jobs';
const sourceId = 'aaf8d8bfde25419bb873ac970da5ac76';
const profileId = 'e746c95feeff427fbe1c35385632d01a';
const jobId = '19468130-0bb6-4b43-97a7-f02f550b4419';
const timestamp = '2026-09-01T16:20:01Z';
const source: Source = {
  source_id: sourceId, source_name: 'Controlled listings CSV', adapter_type: 'csv',
  permission_reference: 'Fixture', approval_status: 'approved', allowed_origins: [], allowed_datasets: ['listings'],
};
const profile: Profile = {
  source_id: sourceId, profile_version_id: profileId, version: 2, config_hash: 'a'.repeat(64),
  approval_status: 'approved', approved_by: 'Operator', approved_at: timestamp, revision: 1,
  validation_report_id: 'test-report',
  configuration: {
    config_schema_version: '1', adapter_type: 'csv', columns: [{ name: 'title', column: 'Name' }],
    record_schema: { record_type: 'listing', schema_version: '1', identity_field: 'title',
      fields: [{ name: 'title', value_type: 'string', required: true }] },
  },
};
const job: CollectionJob = {
  job_id: jobId, source_id: sourceId, profile_version_id: profileId, config_hash: profile.config_hash,
  status: 'partial', created_at: timestamp, started_at: timestamp, finished_at: timestamp,
  valid_count: 2, invalid_count: 3, duplicate_count: 1, error: null, execution_attempt: 1,
  lease_expires_at: null, next_attempt_at: null, dispatch_due_at: null, last_dispatched_at: timestamp,
  dispatch_attempts: 1, dispatch_error_code: null,
};
const record: GenericRecord = {
  job_id: jobId, source_id: sourceId, profile_version_id: profileId, record_type: 'listing',
  record_id: '593aebc2-02f2-418c-be18-efc6f585e345', schema_version: '1', source_record_key: null,
  deduplication_key: 'b'.repeat(64), created_at: timestamp, validation_status: 'passed',
  payload: { title: 'North Trail', count: 0, active: false, note: null },
  source_position: { kind: 'csv_row', index: 2 }, evidence_reference: 'dc8633d1-bb93-4b72-9f56-e10acd6e2ff7',
  provenance: { source_id: sourceId, profile_version_id: profileId, run_id: jobId, config_hash: profile.config_hash },
};

function route(page: Page, path: string, data: unknown, status = 200) {
  return page.route(url => url.pathname === api + path, request => request.fulfill({ json: data, status }));
}

test.beforeEach(async ({ page }) => {
  await route(page, '/topics', []);
  await route(page, '/collection-requests', []);
});

test('Overview preserves request outcomes and offers scoped results and running jobs', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const requestId = 'd55c5c68-6bbc-482e-98f1-42e24e768f23';
  const failed = { ...job, job_id: 'older-failed-job', status: 'failed', valid_count: 0 };
  await route(page, '/sources', [source]);
  await route(page, '/collection-requests', [{
    id: requestId, topic_name: 'Listings', keyword: 'north', status: 'partial', created_at: timestamp,
    jobs: [{ job }, { job: failed }],
  }]);
  await page.route(url => url.pathname === api + jobs, request => {
    const query = new URL(request.request().url()).searchParams;
    expect(query.get('order')).toBe('newest');
    if (query.get('status') === 'running') return request.fulfill({ json: [{ ...job, status: 'running' }] });
    if (query.has('status')) return request.fulfill({ json: [] });
    expect(Object.fromEntries(query)).toEqual({ offset: '0', limit: '6', order: 'newest' });
    return request.fulfill({ json: [job, ...Array.from({ length: 5 }, (_, index) => ({
      ...failed, job_id: 'job-' + index, error: { message: 'Fixture detail unavailable' },
    }))] });
  });
  await page.route(url => url.pathname === api + '/records', request => {
    const query = new URL(request.request().url()).searchParams;
    if (!query.has('request_id')) expect(query.get('order')).toBe('newest');
    return request.fulfill({ json: [record] });
  });
  await page.goto('/operations');
  const ledger = page.getByRole('region', { name: 'Recent collection requests' });
  await expect(ledger.getByRole('link', { name: 'Running jobs' })).toHaveAttribute('href', jobs + '?status=running');
  await expect(ledger.getByRole('link', { name: 'Listings · north', exact: true })).toHaveAttribute('href', '/collection-requests/' + requestId);
  await expect(ledger).toContainText('2 jobs · 1 partial · 1 failed');
  const resultLabel = ledger.getByText('Validated records', { exact: true });
  await expect(resultLabel).toBeVisible();
  const heading = (await resultLabel.boundingBox())!;
  const resultCell = (await ledger.locator('.request-ledger-result').first().boundingBox())!;
  expect(Math.abs(heading.x - resultCell.x)).toBeLessThan(1);
  const recentJobs = page.getByRole('region', { name: 'Recent jobs' });
  await expect(recentJobs.getByRole('listitem')).toHaveCount(5);
  await expect(recentJobs.getByRole('link', { name: new RegExp(jobId) })).toHaveAttribute('href', jobs + '/' + jobId);
  await expect(recentJobs.getByText('Fixture detail unavailable').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Validated records', exact: true })).toContainText('North Trail');

  await ledger.getByRole('link', { name: /2 records for Listings/ }).click();
  await expect(page).toHaveURL('/records?request_id=' + requestId);
  await expect(page.getByRole('heading', { name: 'Data Explorer', exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('main')).toBeFocused();
  await expect(ledger.getByRole('link', { name: 'Listings · north', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('/records?request_id=' + requestId);
});

test('Overview distinguishes setup, loading, and error and retries an unavailable records list', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await page.route(url => url.pathname === api + '/records', async request => {
    await gate;
    await request.fulfill({ json: { error: { code: 'database_unavailable' } }, status: 503 });
  });
  await page.goto('/operations');
  const topicDirectory = page.getByRole('region', { name: 'Collect by topic', exact: true });
  await expect(topicDirectory.getByText('No eligible topics yet')).toBeVisible();
  await expect(topicDirectory.getByRole('link', { name: 'Manage sources' })).toHaveAttribute('href', '/sources');
  await expect(page.getByText('No collection requests yet')).toBeVisible();
  await expect(page.getByText('No running or pending jobs')).toBeVisible();
  const records = page.getByRole('region', { name: 'Validated records', exact: true });
  await expect(records.getByRole('status')).toHaveText('Loading recent records…');
  release();
  await expect(records.getByRole('alert')).toContainText('Backend unavailable');
  await route(page, '/records', []);
  await records.getByRole('button', { name: 'Retry' }).click();
  await expect(records.getByText('No validated records yet')).toBeVisible();
  await expect(records.getByRole('heading')).toBeFocused();
  const refresh = page.getByRole('button', { name: 'Refresh activity' });
  await refresh.click();
  await expect(page.getByText('Activity refresh finished')).toBeVisible();
  await expect(refresh).toBeFocused();
});

test('An eligible Overview topic opens New Collection with a verified preset and unchecked sources', async ({ page }) => {
  const category = { id: 'listings', name: 'Listings', active: true };
  const topic = { id: 'north', category_id: category.id, name: 'North area', active: true };
  const unavailable = { ...topic, id: 'south', name: 'South area' };
  const binding = { id: 'binding', source_name: source.source_name, profile_version: 2, eligible: true };
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await route(page, '/records', []);
  await route(page, '/categories', [category]);
  await route(page, '/categories/' + category.id, category);
  await route(page, '/topics', [topic, unavailable]);
  await route(page, '/topics/' + topic.id, topic);
  await route(page, '/topics/' + topic.id + '/bindings', [binding]);
  await route(page, '/topics/' + unavailable.id + '/bindings', []);
  await page.goto('/operations');
  const directory = page.getByRole('region', { name: 'Collect by topic', exact: true });
  await expect(directory.getByText('No eligible sources', { exact: true })).toBeVisible();
  await expect(directory.getByRole('link', { name: /South area/ })).toHaveCount(0);
  await directory.getByRole('link', { name: /North area/ }).click();
  await expect(page).toHaveURL('/collection-requests/new?topic_id=north');
  await expect(page.getByRole('region', { name: topic.name, exact: true })).toContainText(category.name);
  await expect(page.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: /Controlled listings CSV/ })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Start topic collection' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
});

test('Narrow navigation exposes operations by keyboard and restores focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await route(page, '/records', []);
  await page.goto('/operations');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  const toggle = nav.getByRole('button', { name: 'Operations' });
  await expect(nav.getByRole('link', { name: 'New Collection' })).toBeVisible();
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveCount(0);
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Tab');
  await expect(nav.getByRole('link', { name: 'Sources' })).toBeFocused();
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape');
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('/sources');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(toggle).toHaveAttribute('data-current', 'true');
  await page.goBack();
  await expect(nav.getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});

test('System theme reacts, and manual light and dark persist across routes and reloads', async ({ page }) => {
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await route(page, '/records', []);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/operations');
  const theme = page.getByRole('combobox', { name: 'Theme' });
  const root = page.locator('html');
  await expect(theme).toHaveValue('dark');
  await theme.selectOption('system');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 251)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveCSS('background-color', 'rgb(20, 26, 28)');
  await theme.selectOption('light');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 251)');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await theme.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Data Explorer' }).click();
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveCSS('background-color', 'rgb(20, 26, 28)');
  await theme.selectOption('system');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 251)');
});

test('Guided collection offers only eligible sources and recovers a lost response with the same key', async ({ page }) => {
  const dirty = { ...source, source_id: 'draft-only', source_name: 'Draft only' };
  const revoked = { ...source, source_id: 'revoked', source_name: 'Revoked CSV', approval_status: 'revoked' };
  await route(page, '/sources', [dirty, source, revoked]);
  await route(page, '/sources/draft-only/versions', [{ ...profile, approval_status: 'draft' }]);
  await route(page, '/sources/' + sourceId + '/versions', [
    { ...profile, profile_version_id: 'retired', approval_status: 'retired' }, profile,
  ]);
  const writes: unknown[] = [];
  await page.route(url => url.pathname === api + jobs, request => {
    writes.push(request.request().postDataJSON());
    return writes.length === 1 ? request.abort() : request.fulfill({ json: job });
  });
  await route(page, jobs + '/' + jobId, job);
  await route(page, jobs + '/' + jobId + '/events', [{ ...job, event_id: jobId, occurred_at: timestamp, kind: 'PARTIAL' }]);
  await route(page, jobs + '/' + jobId + '/evidence-pages', []);
  await route(page, '/records', [record]);
  await page.goto(jobs + '/new');
  await expect(page.getByRole('radio', { name: /HTML pages/ })).toBeDisabled();
  const topic = page.getByRole('radio', { name: /CSV datasets/ });
  await topic.focus();
  await page.keyboard.press('Space');
  const sources = page.getByRole('combobox', { name: '2. Select a source' });
  await expect(sources.locator('option')).toHaveCount(2);
  await sources.selectOption(sourceId);
  await expect(page.getByRole('combobox', { name: 'Profile Version' }).locator('option')).toHaveCount(2);
  await page.getByText('Profile mapping and collection rules').click();
  await expect(page.getByText('title (from Name)', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'CSV content' }).fill('Name\nNorth Trail\n');
  await page.getByRole('button', { name: 'Submit job', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('did not confirm');
  await expect(sources).toBeDisabled();
  await page.getByRole('button', { name: 'Retry submission' }).click();
  await expect(page).toHaveURL(jobs + '/' + jobId);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('PARTIAL');
  await expect(page.getByRole('link', { name: 'View job records' })).toBeVisible();
});

test('Guided collection identifies when profile checks block eligibility', async ({ page }) => {
  await route(page, '/sources', [source]);
  await route(page, '/sources/' + sourceId + '/versions', {}, 503);
  await page.goto(jobs + '/new');
  await expect(page.getByRole('alert')).toContainText('profile versions could not be checked');
  await expect(page.getByText('No eligible sources')).toBeVisible();
  await route(page, '/sources/' + sourceId + '/versions', [profile]);
  await page.getByRole('button', { name: 'Retry source checks' }).click();
  await expect(page.getByRole('radio', { name: /CSV datasets/ })).toBeEnabled();
});

test('Fields to Display handles mixed payloads without API writes or refetching', async ({ page }) => {
  const methods: string[] = [];
  page.on('request', request => { if (request.url().includes('/api/v1/')) methods.push(request.method()); });
  await route(page, '/sources', [source]);
  await route(page, jobs + '/' + jobId, job);
  await route(page, '/records', [record, { ...record, record_id: '9ab8e00c-2b2f-74c8-0836-8016b42ac249', payload: { price: 12, note: '' } }]);
  await page.goto('/records?job_id=' + jobId);
  const ledger = page.getByRole('list', { name: 'Persisted generic records' });
  await expect(ledger.getByText('0', { exact: true })).toBeVisible();
  await expect(ledger.getByText('false', { exact: true })).toBeVisible();
  const quality = page.getByRole('region', { name: 'Quality for this job' });
  await expect(quality.locator('dd strong')).toHaveText(['2', '3', '1']);
  await expect(quality.getByRole('link', { name: 'View quarantine' }))
    .toHaveAttribute('href', jobs + '/' + jobId + '/quarantine');
  const before = [...methods];
  await page.getByText('Fields to Display').click();
  await page.getByRole('checkbox', { name: 'price', exact: true }).check();
  await page.getByRole('checkbox', { name: 'note', exact: true }).check();
  await expect(ledger.getByText('12', { exact: true })).toBeVisible();
  await expect(ledger.getByText('Null', { exact: true })).toBeVisible();
  await expect(ledger.getByText('(empty)', { exact: true })).toBeVisible();
  await expect(ledger.getByText('Missing', { exact: true })).toHaveCount(3);
  await expect(ledger.getByRole('button', { name: 'Inspect listing · 9ab8e00c' })).toBeVisible();
  await page.getByRole('button', { name: 'Reset fields' }).click();
  await expect(page.getByRole('checkbox', { name: 'note', exact: true })).not.toBeChecked();
  for (const field of ['price', 'count', 'active']) {
    await page.getByRole('checkbox', { name: field, exact: true }).uncheck();
  }
  await expect(ledger.getByText('No preview fields selected')).toHaveCount(2);
  await expect(ledger.getByRole('button', { name: 'Inspect North Trail' })).toBeVisible();
  expect(methods).toEqual(before);
  expect(methods.every(method => method === 'GET')).toBe(true);
});

for (const [width, theme] of [[1440, 'light'], [390, 'dark']] as const) {
  test(`Dashboard routes fit ${width}px and pass axe in ${theme} mode`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: theme });
    await route(page, '/sources', [source]);
    await route(page, '/sources/' + sourceId + '/versions', [profile]);
    await route(page, jobs, [job]);
    await route(page, jobs + '/' + jobId, job);
    await route(page, '/records', [record]);
    const audit = async () => {
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
      expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
    };
    await page.goto('/operations');
    await expect(page.getByText('North Trail')).toBeVisible();
    await audit();
    await page.goto(jobs + '/new');
    await page.getByRole('radio', { name: /CSV datasets/ }).check();
    await page.getByRole('combobox', { name: '2. Select a source' }).selectOption(sourceId);
    await expect(page.getByRole('button', { name: 'Submit job', exact: true })).toBeVisible();
    await audit();
    await page.goto('/records?job_id=' + jobId);
    await expect(page.getByRole('region', { name: 'Quality for this job' }).locator('dd strong')).toHaveText(['2', '3', '1']);
    const ledger = page.getByRole('list', { name: 'Persisted generic records' });
    await expect(ledger.getByRole('button', { name: 'Inspect North Trail' })).toBeInViewport();
    await expect(ledger.getByText(/listing · Schema/)).toBeVisible();
    await audit();
  });
}
