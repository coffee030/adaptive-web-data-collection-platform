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

test('Overview uses newest-first sample and scopes counts to visible jobs', async ({ page }) => {
  const ids = Array.from({ length: 6 }, (_, index) => `19468130-0bb6-4b43-97a7-f02f550b441${index}`);
  await route(page, '/sources', [source]);
  await page.route(url => url.pathname === api + jobs, request => {
    const query = new URL(request.request().url()).searchParams;
    expect(Object.fromEntries(query)).toEqual({ offset: '0', limit: '6', order: 'newest' });
    return request.fulfill({ json: ids.map((id, index) => ({ ...job, job_id: id, valid_count: index === 5 ? 99 : 2 })) });
  });
  await page.route(url => url.pathname === api + '/records', request => {
    expect(new URL(request.request().url()).searchParams.get('order')).toBe('newest');
    return request.fulfill({ json: [record] });
  });
  await page.goto('/');
  const summary = page.getByRole('region', { name: 'Recent activity' });
  await expect(summary).toContainText('latest 5 submitted jobs');
  await expect(summary.locator('dd')).toHaveText(['10', '15', '5']);
  const recentJobs = page.getByRole('region', { name: 'Recent collection jobs' });
  await expect(recentJobs.getByRole('listitem')).toHaveCount(5);
  await expect(recentJobs.getByRole('link', { name: new RegExp(ids[0]!) })).toHaveAttribute('href', jobs + '/' + ids[0]);
  await expect(page.getByRole('region', { name: 'Recent accepted records' })).toContainText('North Trail');
});

test('Overview shows real empty states and retries an unavailable records list', async ({ page }) => {
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await route(page, '/records', { error: { code: 'database_unavailable' } }, 503);
  await page.goto('/');
  await expect(page.getByText('No collections yet')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Backend unavailable');
  await route(page, '/records', []);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByText('No accepted records yet')).toBeVisible();
});

test('System theme reacts, and manual light and dark persist across routes and reloads', async ({ page }) => {
  await route(page, '/sources', []);
  await route(page, jobs, []);
  await route(page, '/records', []);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const theme = page.getByRole('combobox', { name: 'Theme' });
  const root = page.locator('html');
  await expect(theme).toHaveValue('system');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 251)');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(root).toHaveCSS('background-color', 'rgb(12, 20, 36)');
  await theme.selectOption('light');
  await expect(root).toHaveCSS('background-color', 'rgb(244, 246, 251)');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await theme.selectOption('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Data Explorer' }).click();
  await page.reload();
  await expect(theme).toHaveValue('dark');
  await expect(root).toHaveCSS('background-color', 'rgb(12, 20, 36)');
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
  await expect(page.getByRole('region', { name: 'Version 2' })).toContainText('title (from Name)');
  await page.getByRole('textbox', { name: 'CSV content' }).fill('Name\nNorth Trail\n');
  await page.getByRole('button', { name: 'Start Collection', exact: true }).click();
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
  await route(page, '/records', [record, { ...record, record_id: 'another', payload: { price: 12, note: '' } }]);
  await page.goto('/records?job_id=' + jobId);
  const table = page.getByRole('table');
  await expect(table.getByRole('cell', { name: '0', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'false', exact: true })).toBeVisible();
  const quality = page.getByRole('region', { name: 'Quality for this job' });
  await expect(quality.locator('dd strong')).toHaveText(['2', '3', '1']);
  await expect(quality.getByRole('link', { name: 'View quarantine' }))
    .toHaveAttribute('href', jobs + '/' + jobId + '/quarantine');
  const before = [...methods];
  await page.getByText('Fields to Display').click();
  await page.getByRole('checkbox', { name: 'price', exact: true }).check();
  await page.getByRole('checkbox', { name: 'note', exact: true }).check();
  await expect(table.getByRole('cell', { name: '12', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'Null', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '(empty)', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '—', exact: true })).toHaveCount(3);
  await expect(table.getByRole('link', { name: 'View record · listing' })).toHaveAttribute('href', '/records/another');
  await page.getByRole('button', { name: 'Reset fields' }).click();
  await expect(table.getByRole('columnheader', { name: 'price' })).toHaveCount(0);
  for (const field of ['title', 'count', 'active']) {
    await page.getByRole('checkbox', { name: field, exact: true }).uncheck();
  }
  await expect(table.getByRole('link', { name: 'listing · View record' }).first())
    .toHaveAttribute('href', '/records/' + record.record_id);
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
    await page.goto('/');
    await expect(page.getByText('North Trail')).toBeVisible();
    await audit();
    await page.goto(jobs + '/new');
    await page.getByRole('radio', { name: /CSV datasets/ }).check();
    await page.getByRole('combobox', { name: '2. Select a source' }).selectOption(sourceId);
    await expect(page.getByRole('button', { name: 'Start Collection', exact: true })).toBeVisible();
    await audit();
    await page.goto('/records?job_id=' + jobId);
    await expect(page.getByRole('region', { name: 'Quality for this job' }).locator('dd strong')).toHaveText(['2', '3', '1']);
    const recordsTable = page.getByRole('table', { name: 'Persisted generic records' });
    await expect(recordsTable.getByRole('columnheader').first()).toHaveText('title');
    const recordLink = recordsTable.getByRole('link', { name: 'North Trail · View record' });
    await expect(recordLink).toBeInViewport();
    const typeCell = recordsTable.getByRole('rowheader');
    expect((await typeCell.boundingBox())?.width).toBeGreaterThanOrEqual(120);
    expect((await typeCell.boundingBox())?.height).toBeLessThan(96);
    await audit();
  });
}
