import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { CollectionJob } from '../src/features/collection-jobs/api';
import type { Profile } from '../src/features/profiles/api';
import type { EvidenceMetadata, GenericRecord, QuarantineEntry } from '../src/features/results/api';
import type { Source } from '../src/features/sources/api';

const api = '/api/v1';
const jobId = '1b8e00c2-b2f7-4c80-8368-016b42ac249d';
const sourceId = '9580e5c0-9f16-4601-81e8-9b6f8d2ee364';
const profileId = 'a3dc23f2-bbcc-436f-af04-68c1ab1df2c9';
const recordId = '157afbc7-96af-4e84-be5c-a4550be4c2df';
const evidenceId = '0997cc43-81b2-40ed-b41c-93de091a2486';
const timestamp = '2026-09-01T16:20:01Z';
const configHash = 'a'.repeat(64);
const jobPath = `/collection-jobs/${jobId}`;
const recordsPath = '/records';
const recordPath = `${recordsPath}/${recordId}`;
const quarantinePath = `${jobPath}/quarantine`;
const evidencePath = `/evidence/${evidenceId}`;
const sourcePath = `/sources/${sourceId}`;
const profilePath = `${sourcePath}/profiles/${profileId}`;
const lineage = { job_id: jobId, source_id: sourceId, profile_version_id: profileId };

const record: GenericRecord = {
  ...lineage, record_id: recordId, evidence_reference: evidenceId, created_at: timestamp,
  record_type: 'listing', schema_version: '1', source_record_key: 'north',
  source_position: { kind: 'csv_row', index: 2 }, validation_status: 'passed',
  deduplication_key: 'b'.repeat(64), payload: { title: 'North Trail', count: 7, active: true, note: null },
  provenance: { source_id: sourceId, profile_version_id: profileId, run_id: jobId, config_hash: configHash },
};
const evidence: EvidenceMetadata = {
  ...lineage, evidence_id: evidenceId, run_id: jobId, config_hash: configHash,
  captured_at: timestamp, page_number: 1,
  adapter_type: 'web', capture_kind: 'detail', content_hash: 'f'.repeat(64), content_type: 'text/html',
  original_location: 'http://127.0.0.1:8001/collection?token=secret',
  requested_location: 'http://username:password@127.0.0.1:8001/first#fragment', http_status: 200,
};
const job: CollectionJob = {
  ...lineage, config_hash: configHash, status: 'partial', created_at: timestamp, started_at: timestamp,
  finished_at: timestamp, valid_count: 2, invalid_count: 11, duplicate_count: 1, error: null,
  execution_attempt: 1, lease_expires_at: null, next_attempt_at: null, dispatch_due_at: null,
  last_dispatched_at: timestamp, dispatch_attempts: 1, dispatch_error_code: null,
};
const source: Source = {
  source_id: sourceId, source_name: 'Controlled CSV fixture', adapter_type: 'csv',
  approval_status: 'approved', permission_reference: 'Project fixture', allowed_origins: [], allowed_datasets: ['listings'],
};
const profile: Profile = {
  revision: 1,
  source_id: sourceId, profile_version_id: profileId, version: 1, config_hash: configHash,
  approval_status: 'approved', approved_by: 'Test operator', approved_at: timestamp, validation_report_id: 'report',
  configuration: {
    adapter_type: 'csv', config_schema_version: '1',
    record_schema: { record_type: 'listing', schema_version: '1', identity_field: null,
      fields: [{ name: 'title', value_type: 'string', required: true }] },
    columns: [{ name: 'title', column: 'Name' }],
  },
};

const quarantine: QuarantineEntry = {
  ...lineage, record_id: '3fec3d8f-a743-4e39-adaf-a7504d9e9b51', evidence_reference: evidenceId,
  source_position: { kind: 'csv_row', index: 5 }, created_at: timestamp,
  problems: [
    { code: 'required_field', field: 'title', message: 'Required field is missing' },
    { code: 'wrong_type', field: 'count', message: 'Expected integer' },
  ],
};

async function routeJson(page: Page, path: string, json: unknown, status = 200) {
  await page.route(url => url.pathname === api + path, route => route.fulfill({ json, status }));
}

async function mockLineage(page: Page) {
  await routeJson(page, jobPath, job);
  await routeJson(page, jobPath + '/events', []);
  await routeJson(page, jobPath + '/evidence-pages', [evidence]);
  await routeJson(page, '/sources', [source]);
  await routeJson(page, sourcePath, source);
  await routeJson(page, sourcePath + '/versions', [profile]);
  await routeJson(page, sourcePath + '/versions/' + profileId, profile);
  await routeJson(page, recordPath, record);
  await routeJson(page, recordsPath, [record]);
  await routeJson(page, evidencePath, evidence);
}

test('Records navigation opens a keyboard-accessible ledger and optional inspector', async ({ page }) => {
  await mockLineage(page);
  await routeJson(page, '/collection-jobs', []);
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Data Explorer' }).press('Enter');
  await expect(page).toHaveURL(recordsPath);
  await expect(page.getByRole('main')).toBeFocused();
  const row = page.getByRole('list', { name: 'Persisted generic records' }).getByRole('listitem');
  await expect(row).toContainText('listing');
  await expect(row.getByRole('link', { name: source.source_name })).toHaveAttribute('href', sourcePath);
  const trigger = row.getByRole('button', { name: 'Inspect North Trail' });
  await trigger.focus();
  expect(await trigger.evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
  await trigger.press('Enter');
  await expect(page).toHaveURL(recordsPath + '?record_id=' + recordId);
  const inspector = page.getByRole('complementary', { name: 'Record Inspector' });
  await expect(inspector.getByRole('link', { name: 'Open evidence ' + evidenceId })).toBeVisible();
  await expect(inspector.getByRole('link', { name: 'Article history' })).toHaveCount(0);
  await inspector.getByRole('button', { name: 'Close inspector' }).press('Escape');
  await expect(trigger).toBeFocused();
});

test('Records announces loading, ordinary empty and filtered empty states', async ({ page }) => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(url => url.pathname === api + recordsPath, async route => {
    await gate;
    await route.fulfill({ json: [] });
  });
  await page.goto(recordsPath);
  try {
    await expect(page.getByRole('status')).toContainText('Loading records');
  } finally {
    release();
  }
  await expect(page.getByRole('status')).toContainText('No records yet');
  await page.getByRole('textbox', { name: 'Job ID' }).fill(jobId);
  await page.getByRole('button', { name: 'Apply filter' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No records match this Job ID' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filter' }).click();
  await expect(page).toHaveURL(recordsPath);
  await expect(page.getByRole('status')).toContainText('No records yet');
});

test('Records fetches one extra, filters on the API and preserves the list page on return', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  const rows = Array.from({ length: 11 }, (_, index) => ({ ...record, record_id: `result-${index}` }));
  await page.route(url => url.pathname === api + recordsPath, route => {
    const search = new URL(route.request().url()).searchParams;
    seen.push(search);
    return route.fulfill({ json: search.get('offset') === '10' ? [record] : rows });
  });
  await routeJson(page, recordPath, record);
  await page.goto(recordsPath + '?offset=10');
  await expect(page.getByRole('button', { name: 'Inspect North Trail' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Job ID' }).fill(jobId);
  await page.getByRole('textbox', { name: 'Job ID' }).press('Enter');
  await expect(page).toHaveURL(recordsPath + '?job_id=' + jobId);
  const recordRows = page.getByRole('list', { name: 'Persisted generic records' }).getByRole('listitem');
  await expect(recordRows).toHaveCount(10);
  expect(seen.at(-1)?.toString()).toBe(`limit=11&offset=0&order=oldest&job_id=${jobId}`);
  await page.getByRole('button', { name: 'Next records page' }).click();
  await expect(page).toHaveURL(recordsPath + '?job_id=' + jobId + '&offset=10');
  await expect(recordRows).toHaveCount(1);
  const trigger = page.getByRole('button', { name: 'Inspect North Trail' });
  await expect(trigger).toBeVisible();
  expect(seen.at(-1)?.get('offset')).toBe('10');
  await expect(page.getByRole('button', { name: 'Next records page' })).toBeDisabled();
  await trigger.click();
  await page.getByRole('link', { name: 'Open Record Details' }).click();
  await expect(page.getByRole('heading', { name: 'Record Details' })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Record Inspector' }).click();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(recordsPath + '?job_id=' + jobId + '&offset=10');
  await expect(trigger).toBeVisible();
  await page.getByRole('button', { name: 'Previous records page' }).click();
  await expect(recordRows).toHaveCount(10);
});

test('Records explains a rejected Job ID without exposing response messages', async ({ page }) => {
  await routeJson(page, recordsPath, { error: { code: 'invalid_request', message: 'SECRET' } }, 422);
  await page.goto(recordsPath + '?job_id=incorrect');
  await expect(page.getByRole('alert')).toContainText('Invalid Job ID');
  await expect(page.getByRole('textbox', { name: 'Job ID' })).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('SECRET')).toHaveCount(0);
});

for (const failure of ['503', 'network'] as const) {
  test(`Records retries ${failure} and preserves the requested offset and filter`, async ({ page }) => {
    await routeJson(page, jobPath, job);
    await routeJson(page, '/sources', [source]);
    let failed = true;
    await page.route(url => url.pathname === api + recordsPath, route => {
      if (!failed) return route.fulfill({ json: [record] });
      if (failure === 'network') return route.abort('failed');
      return route.fulfill({ status: 503, json: { error: { code: 'database_unavailable' } } });
    });
    const path = recordsPath + '?job_id=' + jobId + '&offset=10';
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText('Backend unavailable');
    await expect(page.getByRole('list', { name: 'Persisted generic records' })).toHaveCount(0);
    failed = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('button', { name: 'Inspect North Trail' })).toBeVisible();
    await expect(page).toHaveURL(path);
  });
}

test('Record payload keeps JSON types, literal text and access to long values', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const markup = '<script>window.payloadExecuted = true</script><img src=x>';
  const payload = { nested: { items: [markup, 7, false, null] }, long: '🧪'.repeat(4500) + 'END' };
  await routeJson(page, recordPath, { ...record, payload });
  await page.goto(recordPath);
  const json = page.getByRole('region', { name: 'Record payload JSON' });
  await expect(json).toContainText(markup);
  await expect(json).toContainText('false');
  await expect(json).toContainText('null');
  await expect(json.locator('img, script')).toHaveCount(0);
  expect(await json.evaluate(el => el.textContent?.length)).toBeLessThanOrEqual(4097);
  await expect(json).not.toContainText('END');
  const chunks = [await json.textContent()];
  for (let index = 0; index < 2; index++) {
    await page.getByRole('button', { name: 'Next JSON characters page' }).click();
    chunks.push(await json.textContent());
  }
  await expect(json).toContainText('END');
  expect(chunks.join('')).toBe(JSON.stringify(payload, null, 2));
  await expect(page.getByRole('button', { name: 'Next JSON characters page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous JSON characters page' }).click();
  await expect(json).not.toContainText('END');
  await page.getByRole('button', { name: 'Copy JSON' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard.' })).toBeVisible();
  expect(JSON.parse(await page.evaluate(() => navigator.clipboard.readText()))).toEqual(payload);
});

test('Record lineage opens the actual Job, Source, pinned Profile and Evidence destinations', async ({ page }) => {
  await mockLineage(page);
  await page.goto(recordPath);
  await expect(page.getByText('Passed', { exact: true })).toBeVisible();
  await page.getByText('Provenance and identifiers', { exact: true }).click();
  await expect(page.getByText('CSV row 2', { exact: true })).toBeVisible();
  await expect(page.getByText(configHash, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Open job ' + jobId }).click();
  await expect(page).toHaveURL(jobPath);
  await expect(page.getByRole('heading', { name: 'Execution events' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View quarantine' })).toHaveAttribute('href', quarantinePath + '?from=' + encodeURIComponent(jobPath));
  await page.getByRole('link', { name: 'Open record ' + recordId }).click();
  await page.getByRole('link', { name: new RegExp('Open source ' + sourceId) }).click();
  await expect(page).toHaveURL(sourcePath);
  await expect(page.getByRole('heading', { name: source.source_name })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'Open profile version ' + profileId }).click();
  await expect(page).toHaveURL(profilePath);
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'Open evidence ' + evidenceId }).click();
  await expect(page).toHaveURL(new RegExp(evidencePath + '\\?from='));
  await page.getByRole('link', { name: 'Back to Record Details' }).click();
  await expect(page).toHaveURL(recordPath + '?from=' + encodeURIComponent(jobPath));
  await page.getByRole('link', { name: 'Back to Job' }).click();
  await expect(page).toHaveURL(jobPath);
});

test('Quarantine is empty for a valid job and reports the real zero counts', async ({ page }) => {
  await routeJson(page, jobPath, { ...job, status: 'succeeded', invalid_count: 0, duplicate_count: 0 });
  await routeJson(page, quarantinePath, []);
  await page.goto(quarantinePath);
  await expect(page.getByRole('region', { name: 'Job results' })).toContainText('Succeeded');
  await expect(page.getByRole('status')).toContainText('No quarantine entries for this job.');
  await expect(page.getByText('Invalid', { exact: true }).locator('..')).toHaveText('Invalid0');
  await expect(page.getByText('Duplicates', { exact: true }).locator('..')).toHaveText('Duplicates0');
});

test('Quarantine shows source positions, long validation errors, pagination and separate duplicate counts', async ({ page }) => {
  const long = 'validation-detail-'.repeat(100);
  const html = { ...quarantine, record_id: 'html', source_position: { kind: 'html_item', index: 1 },
    problems: [{ code: 'invalid_row', field: null, message: long }] };
  const entries = Array.from({ length: 11 }, (_, index) => ({
    ...quarantine, record_id: `rejection-${index}`, source_position: { kind: 'csv_row', index: index + 5 },
  }));
  await mockLineage(page);
  await page.route(url => url.pathname === api + quarantinePath, route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('limit')).toBe('11');
    return route.fulfill({ json: params.get('offset') === '10' ? [html] : entries });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(jobPath);
  await page.getByRole('link', { name: 'View quarantine' }).click();
  await expect(page.getByRole('region', { name: 'Job results' })).toContainText('Partial');
  await expect(page.getByText('Accepted', { exact: true }).locator('..')).toHaveText('Accepted2');
  await expect(page.getByText('Invalid', { exact: true }).locator('..')).toHaveText('Invalid11');
  await expect(page.getByText('Duplicates', { exact: true }).locator('..')).toHaveText('Duplicates1');
  await expect(page.getByRole('heading', { name: 'CSV row 5', exact: true })).toBeVisible();
  const first = page.locator('.quarantine-entry').first();
  await expect(first.getByRole('list', { name: 'Validation problems' }).getByRole('listitem')).toHaveCount(2);
  await expect(first).toContainText('title');
  await expect(first).toContainText('Expected integer');
  await expect(page.locator('.quarantine-entry')).toHaveCount(10);
  await page.getByRole('button', { name: 'Next quarantine entries page' }).click();
  const secondPage = quarantinePath + '?from=' + encodeURIComponent(jobPath) + '&offset=10';
  await expect(page).toHaveURL(secondPage);
  await expect(page.getByRole('heading', { name: 'HTML item 1', exact: true })).toBeVisible();
  await expect(page.getByText(long)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.getByRole('link', { name: 'Open evidence ' + evidenceId }).click();
  await expect(page).toHaveURL(evidencePath + '?from=' + encodeURIComponent(secondPage));
  await page.goBack();
  await expect(page).toHaveURL(secondPage);
});

test('Quarantine handles a missing job and a backend failure with retry', async ({ page }) => {
  await routeJson(page, jobPath, { error: { code: 'job_not_found' } }, 404);
  await routeJson(page, quarantinePath, { error: { code: 'job_not_found' } }, 404);
  await page.goto(quarantinePath);
  await expect(page.getByRole('alert')).toContainText('Job not found');
  await routeJson(page, jobPath, job);
  await routeJson(page, quarantinePath, { error: { code: 'database_unavailable' } }, 503);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Job results' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Backend unavailable');
  await routeJson(page, quarantinePath, [quarantine]);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('heading', { name: 'CSV row 5' })).toBeVisible();
});

test('Evidence shows safe stored metadata, preserves lineage and links back to the Job', async ({ page }) => {
  await mockLineage(page);
  await page.goto(evidencePath);
  await expect(page.getByRole('region', { name: 'Detail page' })).toContainText('text/html');
  await expect(page.getByText('http://127.0.0.1:8001/collection', { exact: true })).toBeVisible();
  await expect(page.getByText('http://127.0.0.1:8001/first', { exact: true })).toBeVisible();
  await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
  await expect(page.getByText('Stored hash recorded by the collection backend.')).toBeVisible();
  await expect(page.getByText(/token=secret|username:password|never-render/)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Download/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Open profile version ' + profileId })).toHaveAttribute('href', profilePath);
  await expect(page.getByRole('link', { name: 'View job records' })).toHaveAttribute('href', recordsPath + '?job_id=' + jobId);
  await page.getByRole('link', { name: 'Open job ' + jobId }).click();
  await expect(page).toHaveURL(jobPath);
  await expect(page.getByRole('list', { name: 'Related records preview' })).toBeVisible();
});

for (const [path, label] of [[recordPath, 'Record'], [evidencePath, 'Evidence']] as const) {
  test(`${label} renders a 404 without exposing server messages`, async ({ page }) => {
    await routeJson(page, path, { error: { code: 'not_found', message: 'Internal filesystem path' } }, 404);
    await page.goto(path);
    await expect(page.getByRole('alert')).toContainText(label + ' not found');
    await expect(page.getByText('Internal filesystem path')).toHaveCount(0);
  });
}

for (const width of [1440, 900, 768, 390, 320]) {
  test(`result pages contain long data and pass axe at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const longId = 'result-reference-'.repeat(20);
    const longValue = 'long-value-'.repeat(450);
    await routeJson(page, recordsPath, [{ ...record, record_id: longId, payload: { key: longValue } }]);
    await routeJson(page, recordPath, { ...record, payload: { key: longValue } });
    await routeJson(page, jobPath, job);
    await routeJson(page, quarantinePath, [{ ...quarantine, problems: [
      { code: 'invalid_row', message: longValue },
    ] }]);
    await routeJson(page, evidencePath, evidence);
    for (const [path, landmark] of [
      [recordsPath, page.getByRole('list', { name: 'Persisted generic records' })],
      [recordPath, page.getByRole('region', { name: 'Record payload JSON' })],
      [quarantinePath, page.getByText(longValue, { exact: true })],
      [evidencePath, page.getByText(evidence.content_hash, { exact: true })],
    ] as const) {
      await page.goto(path);
      await expect(landmark).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
      const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
      expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
    }

  });
}
