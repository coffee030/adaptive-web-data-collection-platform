import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CollectionJob, ExecutionEvent } from '../src/features/collection-jobs/api';
import type { GenericRecord } from '../src/features/results/api';

const jobId = '1b8e00c2-b2f7-4c80-8368-016b42ac249d';
const sourceId = '9580e5c0-9f16-4601-81e8-9b6f8d2ee364';
const profileId = 'a3dc23f2-bbcc-436f-af04-68c1ab1df2c9';
const instant = '2026-09-01T16:20:01+08:00';
const jobsUrl = '/collection-jobs';
const jobUrl = `${jobsUrl}/${jobId}`;
const api = '/api/v1';

const partialJob: CollectionJob = {
  job_id: jobId, source_id: sourceId, profile_version_id: profileId, config_hash: '0'.repeat(64),
  status: 'partial', created_at: instant, started_at: instant, finished_at: instant,
  valid_count: 1, invalid_count: 3, duplicate_count: 2, error: null, execution_attempt: 1,
  lease_expires_at: null, next_attempt_at: null, dispatch_due_at: null, last_dispatched_at: instant,
  dispatch_attempts: 1, dispatch_error_code: null,
};
const events: ExecutionEvent[] = [
  { event_id: 'e1', job_id: jobId, status: 'pending', occurred_at: instant,
    kind: 'JOB_CREATED', execution_attempt: null, error: null },
  { event_id: 'e2', job_id: jobId, status: 'partial', occurred_at: instant,
    kind: 'PARTIAL', execution_attempt: 1, error: null },
];
const record: GenericRecord = {
  record_id: '157afbc7-96af-4e84-be5c-a4550be4c2df',
  record_type: 'listing', schema_version: '1',
  job_id: jobId, source_id: sourceId, profile_version_id: profileId,
  source_record_key: null, deduplication_key: '1'.repeat(64), created_at: instant,
  source_position: { kind: 'html_item', index: 1 }, validation_status: 'passed',
  provenance: { source_id: sourceId, profile_version_id: profileId, run_id: jobId,
    config_hash: partialJob.config_hash, validation_status: 'passed' },
  evidence_reference: '0997cc43-81b2-40ed-b41c-93de091a2486',
  payload: { title: 'Fixture item', count: 0, optional: null, available: false },
};

async function mockList(page: Page, jobs: CollectionJob[] = [partialJob]) {
  await page.route(url => url.pathname === api + jobsUrl, route => route.fulfill({ json: jobs }));
}

async function mockDetail(page: Page, job = partialJob, related = [record], timeline = events) {
  await page.route(api + jobUrl + '/evidence', route => route.fulfill({ json: null }));
  await page.route(url => url.pathname === api + jobUrl, route => route.fulfill({ json: job }));
  await page.route(url => url.pathname === api + jobUrl + '/events', route => route.fulfill({ json: timeline }));
  await page.route(url => url.pathname === api + '/records', route => route.fulfill({ json: related }));
}

test('invalid timestamps render a fallback and a job can have no capture', async ({ page }) => {
  await mockDetail(page, { ...partialJob, created_at: 'invalid-timestamp' });
  await page.goto(jobUrl);
  await expect(page.getByRole('region', { name: 'Run overview' })).toContainText('Unavailable');
  await expect(page.getByRole('region', { name: 'Capture evidence' })).toContainText('No capture evidence was saved');
});

test('shell, persisted fields, and keyboard navigation', async ({ page }) => {
  await mockList(page);
  await mockDetail(page);
  await page.goto('/');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Data Collection Platform' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data Collection Overview' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Collection Jobs' }).click();
  await expect(page).toHaveURL(jobsUrl);
  await expect(page.getByRole('heading', { name: 'Collection Jobs' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Collection Jobs' })).toHaveAttribute('aria-current', 'page');

  // Use a direct load so the first Tab exercises the skip link from the browser's initial focus.
  await page.goto(jobsUrl);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const table = page.getByRole('table', { name: /Collection jobs/ });
  await expect(table.getByRole('columnheader', { name: 'Source ID' })).toBeVisible();
  await expect(table.getByText(sourceId)).toBeVisible();
  await expect(table.getByText('08:20:01').first()).toBeVisible();
  await expect(table.getByText('Partial')).toBeVisible();

  const open = table.getByRole('link', { name: 'Open job ' + jobId });
  await open.focus();
  await expect(open).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(jobUrl);
  await expect(page.getByRole('main')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Run overview' })).toBeVisible();
});

test('announces loading and an empty job list', async ({ page }) => {
  let resolveResponse!: () => void;
  const response = new Promise<void>(resolve => { resolveResponse = resolve; });
  await page.route(url => url.pathname === api + jobsUrl, async route => {
    await response;
    await route.fulfill({ json: [] });
  });
  await page.goto(jobsUrl);
  await expect(page.getByRole('status')).toHaveText('Loading jobs…');
  resolveResponse();
  await expect(page.getByRole('status')).toContainText('No collection jobs yet');
  await expect(page.getByRole('table')).toHaveCount(0);
});

for (const failure of [500, 502, 503, 'network', 'unreadable'] as const) {
  test(`request failure (${failure}) can be retried`, async ({ page }) => {
    await page.route(url => url.pathname === api + jobsUrl, route => {
      if (failure === 'network') return route.abort('connectionrefused');
      if (failure === 'unreadable') return route.fulfill({ body: '<html>Proxy page</html>' });
      return route.fulfill({
        status: failure,
        json: { error: {
          code: failure === 503 ? 'database_unavailable' : 'internal_error',
          message: 'Do not display raw server messages',
        } },
      });
    });
    await page.goto(jobsUrl);
    const alert = page.getByRole('alert');
    await expect(alert).toContainText(failure === 502 || failure === 503 || failure === 'network'
      ? 'Backend unavailable' : 'Could not load jobs');
    if (typeof failure === 'number') await expect(alert).toContainText(`HTTP ${failure}`);
    if (failure === 'unreadable') await expect(alert).toContainText('unreadable response');
    await expect(page.getByText('Do not display raw server messages')).toHaveCount(0);
    await mockList(page);
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByRole('table')).toBeVisible();
  });
}

test('list pagination requests one extra result and the status filter resets offset', async ({ page }) => {
  const statuses = ['pending', 'running', 'succeeded', 'partial', 'failed'] as const;
  const jobs = Array.from({ length: 21 }, (_, index) => ({
    ...partialJob,
    job_id: `1b8e00c2-b2f7-4c80-8368-${String(index).padStart(12, '0')}`,
    status: statuses[index % statuses.length]!,
    started_at: null,
    finished_at: null,
  }));
  const requests: string[] = [];
  await page.route(url => url.pathname === api + jobsUrl, route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query.toString());
    const offset = Number(query.get('offset'));
    const status = query.get('status');
    const matching = status ? jobs.filter(job => job.status === status) : jobs;
    return route.fulfill({ json: matching.slice(offset, offset + Number(query.get('limit'))) });
  });
  await page.goto(jobsUrl);
  await expect(page.getByText('Jobs 1–20')).toBeVisible();
  for (const status of ['Pending', 'Running', 'Succeeded', 'Partial', 'Failed']) {
    await expect(page.getByRole('table').getByText(status, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('table').getByText('Not recorded').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next jobs page' }).click();
  await expect(page.getByText('Jobs 21', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next jobs page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous jobs page' }).click();
  await expect(page.getByText('Jobs 1–20')).toBeVisible();
  await page.getByRole('button', { name: 'Next jobs page' }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await expect(page.getByText('Jobs 1–4')).toBeVisible();
  expect(requests).toContain('limit=21&offset=20');
  expect(requests.at(-1)).toBe('limit=21&offset=0&status=failed');
  await expect(page).toHaveURL(jobsUrl + '?status=failed');
});

test('partial job shows lineage, UTC times, counts, API-ordered events, and a generic record', async ({ page }) => {
  await mockDetail(page);
  await page.goto(jobUrl);
  const overview = page.getByRole('region', { name: 'Run overview' });
  await expect(overview.getByText('Partial', { exact: true })).toBeVisible();
  await expect(overview.getByText('Partial result')).toBeVisible();
  await expect(overview.getByText(profileId)).toBeVisible();
  await expect(overview.getByText('Invalid', { exact: true })).toBeVisible();
  await expect(overview.getByText('3', { exact: true })).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' });
  await expect(timeline.getByRole('listitem').nth(0)).toContainText('JOB_CREATED');
  await expect(timeline.getByRole('listitem').nth(1)).toContainText('Attempt 1');
  const table = page.getByRole('table', { name: 'Related records preview' });
  await expect(table.getByText(record.record_id)).toBeVisible();
  await expect(table.getByText(record.evidence_reference)).toBeVisible();
  await expect(table.getByText('Fixture item')).toBeVisible();
  await expect(table.getByText('null')).toBeVisible();
  await expect(table.getByText('+1 more field')).toBeVisible();
});

test('job not found avoids fetching dependent resources', async ({ page }) => {
  const paths: string[] = [];
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith(api)) paths.push(new URL(request.url()).pathname);
  });
  await page.route(url => url.pathname === api + jobUrl, route => route.fulfill({
    status: 404, json: { error: { code: 'job_not_found', message: 'Job does not exist' } },
  }));
  await page.goto(jobUrl);
  await expect(page.getByRole('alert')).toContainText('Job not found');
  await expect(page.getByRole('link', { name: 'Back to jobs' })).toHaveAttribute('href', jobsUrl);
  expect(paths.every(path => path === api + jobUrl)).toBe(true);
});

test('failed job shows its technical error and an empty record preview', async ({ page }) => {
  const error = { code: 'invalid_csv', message: 'CSV header is missing required columns' };
  await mockDetail(page, { ...partialJob, status: 'failed', error, valid_count: 0 }, [], [
    { ...events[0]!, kind: null, status: 'failed', error },
  ]);
  await page.goto(jobUrl);
  await expect(page.getByText('Job failed', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Execution events' }).getByText(error.code)).toBeVisible();
  await expect(page.getByText('No validated records for this job.')).toBeVisible();
});

test('a failed event request leaves records and the overview available', async ({ page }) => {
  await mockDetail(page);
  await page.route(url => url.pathname === api + jobUrl + '/events', route => route.fulfill({
    status: 503, json: { error: { code: 'database_unavailable', message: 'Unavailable' } },
  }));
  await page.goto(jobUrl);
  const eventPanel = page.getByRole('region', { name: 'Execution events' });
  await expect(eventPanel.getByRole('alert')).toContainText('Backend unavailable');
  await expect(page.getByRole('region', { name: 'Run overview' })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Related records preview' })).toBeVisible();
  await page.route(url => url.pathname === api + jobUrl + '/events', route => route.fulfill({ json: events }));
  await eventPanel.getByRole('button', { name: 'Retry' }).click();
  await expect(eventPanel.getByText('JOB_CREATED')).toBeVisible();
});

test('records pagination is scoped to the job', async ({ page }) => {
  await mockDetail(page);
  const requests: URLSearchParams[] = [];
  const related = Array.from({ length: 11 }, (_, index) => ({
    ...record, record_id: `record-${index + 1}`,
  }));
  await page.route(url => url.pathname === api + '/records', route => {
    const query = new URL(route.request().url()).searchParams;
    requests.push(query);
    const offset = Number(query.get('offset'));
    return route.fulfill({ json: related.slice(offset, offset + Number(query.get('limit'))) });
  });
  await page.goto(jobUrl);
  await expect(page.getByText('Records 1–10')).toBeVisible();
  await page.getByRole('button', { name: 'Next records page' }).click();
  await expect(page.getByText('Records 11', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next records page' })).toBeDisabled();
  expect([...new Set(requests.map(query => query.get('offset')))]).toEqual(['0', '10']);
  expect(requests.every(query => query.get('job_id') === jobId && query.get('limit') === '11')).toBe(true);
  await page.getByRole('button', { name: 'Refresh job' }).click();
  await expect(page.getByText('Records 11', { exact: true })).toBeVisible();
  expect(requests.at(-1)?.get('offset')).toBe('10');
});

test('job refresh reloads the status, events, and records', async ({ page }) => {
  await mockDetail(page);
  await page.goto(jobUrl);
  await expect(page.getByText('Fixture item')).toBeVisible();
  await mockDetail(page, { ...partialJob, status: 'succeeded' }, [{ ...record, payload: { title: 'New item' } }], [
    { ...events[1]!, status: 'succeeded', kind: 'SUCCEEDED' },
  ]);
  await page.getByRole('button', { name: 'Refresh job' }).click();
  await expect(page.getByRole('region', { name: 'Run overview' }).getByText('Succeeded')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Execution events' }).getByText('SUCCEEDED', { exact: true })).toBeVisible();
  await expect(page.getByText('New item')).toBeVisible();
});

test('an empty filtered offset can return to the previous page', async ({ page }) => {
  await page.route(url => url.pathname === '/api/v1/collection-jobs', route => {
    const offset = new URL(route.request().url()).searchParams.get('offset');
    return route.fulfill({ json: offset === '0' ? [partialJob] : [] });
  });
  await page.goto('/collection-jobs?status=partial&offset=20');
  await expect(page.getByText('This page is empty')).toBeVisible();
  await page.getByRole('button', { name: 'Previous jobs page' }).click();
  await expect(page).toHaveURL('/collection-jobs?status=partial');
  await expect(page.getByRole('link', { name: 'Open job ' + partialJob.job_id })).toBeVisible();
});

test('long values stay within their regions and axe finds no AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockList(page);
  const longText = 'filename-'.repeat(150);
  await mockDetail(page, {
    ...partialJob, status: 'failed', error: { code: 'invalid_csv', message: longText },
  }, [{ ...record, payload: { title: longText, [longText]: longText, optional: null } }]);
  await page.goto(jobsUrl);
  const scroller = page.getByRole('region', { name: /Collection jobs table/ });
  await expect(scroller).toBeVisible();
  const visibleEdge = (await scroller.boundingBox())!;
  const results = (await scroller.getByRole('columnheader', { name: 'Status and results' }).boundingBox())!;
  expect(results.x + results.width).toBeLessThanOrEqual(visibleEdge.x + visibleEdge.width);
  await scroller.focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => scroller.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);

  await page.goto(jobUrl);
  const preview = page.getByRole('table', { name: 'Related records preview' });
  await expect(preview.getByText(longText.slice(0, 96) + '…').first()).toBeVisible();
  await expect(preview.getByText(longText, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Run overview' }).getByText(longText)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
});
