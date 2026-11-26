import AxeBuilder from '@axe-core/playwright';
import { chromium, expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { CollectionJob, ExecutionEvent, JobDetailResponse } from '../src/features/collection-jobs/api';
import type { GenericRecord } from '../src/features/results/api';
import type { CollectionRequest } from '../src/features/topic-collections/api';

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

const capture = {
  ...record.provenance, evidence_id: record.evidence_reference, job_id: jobId,
  page_number: 1, capture_kind: 'input', captured_at: instant, adapter_type: 'web',
  original_location: 'https://fixture.example.invalid/listings', requested_location: null,
  content_hash: 'a'.repeat(64), content_type: 'text/html', http_status: 200,
};

async function mockList(page: Page, jobs: CollectionJob[] = [partialJob]) {
  await page.route(url => url.pathname === api + jobsUrl, route => route.fulfill({ json: jobs }));
}

const inspect = (page: Page, id = jobId) => page.getByRole('link', { name: 'Inspect Job ' + id.slice(0, 8) });
const ledger = (page: Page) => page.getByRole('list', { name: 'Jobs on this page' });

async function mockDetail(page: Page, job: JobDetailResponse = partialJob, related = [record], timeline = events) {
  await page.route(api + jobUrl + '/evidence-pages', route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === api + jobUrl, route => route.fulfill({ json: job }));
  await page.route(url => url.pathname === api + jobUrl + '/events', route => route.fulfill({ json: timeline }));
  await page.route(url => url.pathname === api + '/records', route => route.fulfill({ json: related }));
}

const parentId = '23ec0c1c-0eeb-45eb-b6a6-b301a7ae4642';
const parentPath = '/collection-requests/' + parentId;

function parentWith(job: CollectionJob): CollectionRequest {
  return {
    id: parentId, topic_id: parentId, keyword: 'fixtures', topic_name: 'Fixture listings', status: 'partial',
    created_at: instant, finished_at: instant, refresh_of: null,
    jobs: [{ binding_id: parentId, approved_by: 'Fixture operator', approved_at: instant,
      source_name: 'Fixture source', profile_version: 2, job }],
  };
}

test('a verified parent Request restores its Job trigger through Back, Forward and the return link', async ({ page }) => {
  await mockDetail(page);
  await page.route(api + parentPath, route => route.fulfill({ json: parentWith(partialJob) }));
  const requestUrl = parentPath + '?scope=preserved';
  await page.goto(requestUrl);
  const trigger = page.getByRole('link', { name: 'Job details', exact: true });
  await trigger.press('Enter');
  const parent = page.getByRole('link', { name: 'View parent request' });
  await expect(parent).toHaveAttribute('href', requestUrl);
  const jobAddress = page.url();

  await page.goBack();
  await expect(trigger).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL(jobAddress);
  await parent.click();
  await expect(page).toHaveURL(requestUrl);
  await expect(trigger).toBeFocused();

  await page.goto(jobUrl + '?from=' + encodeURIComponent(parentPath));
  await expect(parent).toHaveAttribute('href', parentPath);
});

test('a direct Job ignores a parent Request supplied only by router state', async ({ page }) => {
  await mockDetail(page);
  let parentReads = 0;
  await page.route(api + parentPath, route => {
    parentReads++;
    return route.fulfill({ json: parentWith(partialJob) });
  });
  await page.addInitScript(id => {
    history.replaceState({ idx: 0, usr: { requestId: id } }, '');
  }, parentId);
  await page.goto(jobUrl);
  await expect(page.getByRole('region', { name: 'Run overview' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View parent request' })).toHaveCount(0);
  expect(parentReads).toBe(0);
});

for (const scenario of ['different child', 'missing request', 'mismatched response ID'] as const) {
  test(`a Job suppresses a stale parent hint with a ${scenario}`, async ({ page }) => {
    await mockDetail(page);
    await page.route(api + parentPath, route => {
      if (scenario === 'missing request') return route.fulfill({ status: 404, json: {} });
      if (scenario === 'different child') return route.fulfill({
        json: parentWith({ ...partialJob, job_id: 'c0254d2c-ee51-4c71-8408-65b8561c95bb' }),
      });
      return route.fulfill({ json: { ...parentWith(partialJob), id: 'c0254d2c-ee51-4c71-8408-65b8561c95bb' } });
    });
    await page.addInitScript(id => {
      history.replaceState({ idx: 0, usr: { requestId: id } }, '');
    }, parentId);
    const check = page.waitForResponse(api + parentPath);
    await page.goto(jobUrl + '?from=' + encodeURIComponent(parentPath));
    await check;
    await expect(page.getByRole('region', { name: 'Run overview' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'View parent request' })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Collection request' })).toHaveCount(0);
  });
}

test('invalid timestamps render a fallback and a job can have no capture', async ({ page }) => {
  await mockDetail(page, { ...partialJob, created_at: 'invalid-timestamp' });
  await page.goto(jobUrl);
  await page.getByText('Technical metadata', { exact: true }).click();
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Capture evidence' })).toContainText('No capture evidence was saved');
});

test('shell, persisted fields, and keyboard navigation', async ({ page }) => {
  await mockList(page);
  await mockDetail(page);
  await page.route(api + '/sources/' + sourceId, route => route.fulfill({ json: { source_name: 'Fixture listings' } }));
  await page.route(api + '/sources/' + sourceId + '/versions/' + profileId, route => route.fulfill({ json: { version: 4 } }));
  await page.goto('/operations');
  await expect(page).toHaveURL('/operations');
  await expect(page.getByRole('banner').getByRole('link', { name: 'Harbourline Scraping Operations', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Data Collection Overview' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Collection Jobs' }).click();
  await expect(page).toHaveURL(jobsUrl);
  await expect(page.getByRole('heading', { name: 'Collection Jobs' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Collection Jobs' })).toHaveAttribute('aria-current', 'page');

  await page.goto(jobsUrl);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await expect(ledger(page).getByText('Fixture listings')).toBeVisible();
  await expect(ledger(page).getByText(/Version 4/)).toBeVisible();
  await expect(ledger(page).getByText('08:20:01').first()).toBeVisible();
  await expect(ledger(page).getByText('Partial')).toBeVisible();

  const open = inspect(page);
  await open.focus();
  await expect(open).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(jobUrl + '?from=%2Fcollection-jobs');
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
    await expect(ledger(page)).toBeVisible();
  });
}

test('list pagination requests one extra result and the status filter resets offset', async ({ page }) => {
  const statuses = ['pending', 'running', 'succeeded', 'partial', 'failed'] as const;
  const jobs = Array.from({ length: 21 }, (_, index) => ({
    ...partialJob,
    job_id: `${String(index).padStart(8, '0')}-b2f7-4c80-8368-016b42ac249d`,
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
    const ordered = query.get('order') === 'newest' ? [...jobs].reverse() : jobs;
    const matching = status ? ordered.filter(job => job.status === status) : ordered;
    return route.fulfill({ json: matching.slice(offset, offset + Number(query.get('limit'))) });
  });
  await page.goto(jobsUrl);
  await expect(page.getByText('Jobs 1–20')).toBeVisible();
  for (const status of ['Pending', 'Running', 'Succeeded', 'Partial', 'Failed']) {
    await expect(ledger(page).getByText(status, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next jobs page' }).click();
  await expect(page.getByText('Jobs 21', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next jobs page' })).toBeDisabled();
  await page.getByRole('button', { name: 'Previous jobs page' }).click();
  await expect(page.getByText('Jobs 1–20')).toBeVisible();
  await page.getByRole('button', { name: 'Next jobs page' }).click();
  await page.getByRole('combobox', { name: 'Status' }).selectOption('failed');
  await expect(page.getByText('Jobs 1–4')).toBeVisible();
  expect(requests).toContain('limit=21&offset=20&order=oldest');
  expect(requests.at(-1)).toBe('limit=21&offset=0&order=oldest&status=failed');
  await expect(page).toHaveURL(jobsUrl + '?status=failed');
  for (const status of statuses) {
    await page.getByRole('combobox', { name: 'Status' }).selectOption(status);
    const expected = status[0]!.toUpperCase() + status.slice(1);
    await expect(ledger(page).locator('.status')).toHaveText(jobs.filter(job => job.status === status).map(() => expected));
    expect(new URLSearchParams(requests.at(-1)).get('status')).toBe(status);
  }
  await page.getByRole('combobox', { name: 'Status' }).selectOption('');
  await page.getByRole('button', { name: 'Next jobs page' }).click();
  await page.getByRole('combobox', { name: 'Order' }).selectOption('newest');
  await expect(ledger(page).getByRole('link').first()).toHaveAccessibleName('Inspect Job 00000020');
  expect(requests.at(-1)).toBe('limit=21&offset=0&order=newest');
});

test('partial job shows lineage, UTC times, counts, API-ordered events, and a generic record', async ({ page }) => {
  await mockDetail(page);
  await page.goto(jobUrl);
  const overview = page.getByRole('region', { name: 'Run overview' });
  await expect(overview.getByText('Partial', { exact: true })).toBeVisible();
  await expect(overview.getByText('Partial result')).toBeVisible();
  await expect(overview.getByRole('link', { name: 'Profile ' + profileId.slice(0, 8) })).toHaveAttribute('href', `/sources/${sourceId}/profiles/${profileId}`);
  await expect(overview.getByText('Invalid', { exact: true })).toBeVisible();
  await expect(overview.getByText('3', { exact: true })).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' });
  await expect(timeline.getByRole('listitem').nth(0)).toContainText('JOB_CREATED');
  await expect(timeline.getByRole('listitem').nth(1)).toContainText('Attempt 1');
  await expect(timeline.getByRole('listitem').nth(1)).toContainText('Unknown Worker');
  const table = page.getByRole('list', { name: 'Related records preview' });
  await expect(table.getByRole('link', { name: 'Open record ' + record.record_id })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Open evidence ' + record.evidence_reference })).toBeVisible();
  await expect(table.locator('.payload').getByText('Fixture item')).toBeVisible();
  await expect(table.getByText('null')).toBeVisible();
  await expect(table.getByText('+1 more field')).toBeVisible();
});

test('Job Details distinguishes direct execution and an unclaimed Job', async ({ page }) => {
  const execution = page.getByRole('region', { name: 'Execution and dispatch' });
  await mockDetail(page, { ...partialJob, status: 'pending', execution_attempt: 0 }, [], [events[0]!]);
  await page.goto(jobUrl);
  await expect(execution.getByText('Awaiting first claim')).toBeVisible();
  await mockDetail(page, { ...partialJob, latest_claim_execution_origin: 'direct' }, [], [
    events[0]!, { ...events[1]!, execution_origin: 'direct' },
  ]);
  await page.reload();
  await expect(execution.getByText('Direct execution')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('Direct execution');
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
  await expect(page.getByText('Collection failed.', { exact: false })).toBeVisible();
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
  await expect(page.getByRole('list', { name: 'Related records preview' })).toBeVisible();
  await page.route(url => url.pathname === api + jobUrl + '/events', route => route.fulfill({ json: events }));
  await eventPanel.getByRole('button', { name: 'Retry' }).click();
  await expect(eventPanel.getByText('Job created', { exact: true })).toBeVisible();
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
  await expect(page.getByRole('link', { name: 'Open record ' + record.record_id })).toHaveText('Fixture item');
  await mockDetail(page, { ...partialJob, status: 'succeeded' }, [{ ...record, payload: { title: 'New item' } }], [
    { ...events[1]!, status: 'succeeded', kind: 'SUCCEEDED' },
  ]);
  await page.getByRole('button', { name: 'Refresh job' }).click();
  await expect(page.getByRole('region', { name: 'Run overview' }).getByText('Succeeded')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Execution events' }).getByText('Run succeeded', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open record ' + record.record_id })).toHaveText('New item');
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
  await expect(inspect(page)).toBeVisible();
});

test('long values stay within their regions and axe finds no AA violations', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockList(page);
  const longText = 'filename-'.repeat(150);
  await mockDetail(page, {
    ...partialJob, status: 'failed', error: { code: 'invalid_csv', message: longText },
  }, [{ ...record, payload: { title: longText, [longText]: longText, optional: null } }]);
  await page.goto(jobsUrl);
  await expect(ledger(page).getByText('Partial')).toBeVisible();
  await expect(inspect(page)).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
  expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);

  await page.goto(jobUrl);
  const preview = page.getByRole('list', { name: 'Related records preview' });
  await expect(preview.getByText(longText.slice(0, 96) + '…').first()).toBeVisible();
  await expect(preview.getByText(longText, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Recorded error' }).getByText(longText)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
});

test('invalid list parameters fall back to the first oldest page and preserve the maximum offset', async ({ page }) => {
  const queries: URLSearchParams[] = [];
  await page.route(url => url.pathname === api + jobsUrl, route => {
    queries.push(new URL(route.request().url()).searchParams);
    return route.fulfill({ json: [] });
  });
  await page.goto(jobsUrl + '?status=cancelled&order=other&offset=1e4');
  await expect(page.getByText('No collection jobs yet')).toBeVisible();
  expect(queries.at(-1)?.toString()).toBe('limit=21&offset=0&order=oldest');
  await page.goto(jobsUrl + '?status=failed&offset=2147483647');
  await expect(page.getByText('This page is empty')).toBeVisible();
  expect(queries.at(-1)?.get('offset')).toBe('2147483647');
  await page.getByRole('button', { name: 'First page' }).click();
  await expect(page.getByText('No jobs match this status')).toBeVisible();
  await page.goto(jobsUrl + '/invalid-id');
  await expect(page.getByRole('alert')).toContainText('Invalid Job ID');
});

test('retry and dispatch fields stay distinct and events keep their persisted sequence', async ({ page }) => {
  const retryTime = '2026-09-01T09:00:12Z';
  const failure = { code: 'rate_limited', message: 'Source rate limit', http_status: 429, retry_after_seconds: 40 };
  const failureEvents: ExecutionEvent[] = [
    { ...events[0]!, kind: null },
    { ...events[0]!, event_id: 'new-kind', kind: 'FUTURE_EVENT', occurred_at: '2026-09-01T07:20:01Z' },
    { ...events[0]!, event_id: 'claim-1', status: 'running', kind: 'CLAIMED', execution_attempt: 1 },
    { ...events[0]!, event_id: 'claim-2', status: 'running', kind: 'CLAIMED', execution_attempt: 2 },
    { ...events[0]!, event_id: 'scheduled', kind: 'RETRY_SCHEDULED', execution_attempt: 2, error: failure },
    { ...events[0]!, event_id: 'dispatch-1', kind: 'DISPATCH_FAILED', execution_attempt: 2 },
    { ...events[0]!, event_id: 'dispatch-2', kind: 'DISPATCH_FAILED', execution_attempt: 2 },
  ];
  await mockDetail(page, { ...partialJob, status: 'pending', finished_at: null, started_at: null, error: failure,
    execution_attempt: 2, dispatch_attempts: 5, next_attempt_at: retryTime, dispatch_due_at: retryTime,
    dispatch_error_code: 'broker_unavailable' }, [], failureEvents);
  await page.goto(jobUrl);
  const diagnostics = page.getByRole('region', { name: 'Execution and dispatch' });
  await expect(diagnostics.getByText('Execution attempts').locator('..')).toHaveText('Execution attempts2');
  await expect(diagnostics.getByText('Dispatch attempts').locator('..')).toHaveText('Dispatch attempts5');
  await expect(diagnostics.getByText('Earliest scheduled retry (UTC)').locator('..').locator('time')).toHaveAttribute('datetime', retryTime);
  await expect(diagnostics).toContainText('A previous broker publication could not be confirmed.');
  await expect(page.getByText('Awaiting a scheduled retry.')).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' });
  await expect(timeline.locator('.event-label strong')).toHaveText([
    'Historical status update', 'Unrecognized execution event', 'Execution claimed', 'Execution claimed',
    'Retry scheduled', 'Dispatch failed', 'Dispatch failed',
  ]);
  await expect(timeline.getByText('HTTP 429', { exact: true })).toBeVisible();
  await expect(timeline.getByText('Retry-After 40s', { exact: true })).toBeVisible();
  await timeline.getByRole('listitem').nth(1).getByText('Event metadata').click();
  await expect(timeline.getByText('FUTURE_EVENT')).toBeVisible();

  await mockDetail(page, { ...partialJob, status: 'failed', valid_count: 0, execution_attempt: 3,
    dispatch_attempts: 6, error: failure }, [], [...failureEvents, { ...events[1]!, kind: 'FAILED', status: 'failed',
    execution_attempt: 3, error: failure }]);
  await page.getByRole('button', { name: 'Refresh job' }).click();
  await expect(timeline.locator(':scope > li').last()).toContainText('Failed · Attempt 3');
  await expect(diagnostics.getByText('Earliest scheduled retry (UTC)')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Recorded error' })).toContainText('Rate limiting');
});

test('hidden pages suspend polling and failed refresh preserves the visible Job until recovery', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  });
  await page.clock.install({ time: new Date('2026-11-17T00:00:00Z') });
  await mockDetail(page);
  let reads = 0;
  await page.route(api + jobUrl, route => {
    reads++;
    if (reads === 2) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({ json: { ...partialJob, status: reads < 3 ? 'running' : 'failed',
      finished_at: reads < 3 ? null : instant, lease_expires_at: reads < 3 ? instant : null,
      execution_attempt: 1, valid_count: 0 } });
  });
  await page.goto(jobUrl);
  await expect(page.getByText('Lease deadline passed.', { exact: false })).toBeVisible();
  await page.clock.runFor(9000);
  expect(reads).toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.runFor(3100);
  await expect(page.getByText('Job refresh failed.', { exact: false })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Run overview' })).toContainText('Running');
  await page.clock.runFor(3100);
  await expect(page.getByRole('region', { name: 'Run overview' })).toContainText('Failed');
  await page.clock.runFor(10_000);
  expect(reads).toBe(3);
});

test('failed Job preserves page two and return focus through Quarantine and browser history', async ({ page }) => {
  const failed: CollectionJob = { ...partialJob, status: 'failed', valid_count: 0, invalid_count: 12,
    error: { code: 'no_valid_records', message: 'No candidates passed validation.' } };
  const first = Array.from({ length: 20 }, (_, index) => ({ ...failed,
    job_id: `${String(index).padStart(8, '0')}-b2f7-4c80-8368-016b42ac249d` }));
  await page.route(url => url.pathname === api + jobsUrl, route => route.fulfill({ json:
    new URL(route.request().url()).searchParams.get('offset') === '20' ? [...first.slice(0, 8), failed] : [...first, failed] }));
  await mockDetail(page, failed, []);
  await page.route(url => url.pathname === api + jobUrl + '/quarantine', route => {
    const offset = Number(new URL(route.request().url()).searchParams.get('offset'));
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...record, record_id: 'candidate-' + index, source_position: { kind: 'csv_row', index: index + 2 },
      problems: [{ code: 'wrong_type', field: 'count', message: 'Use an integer.' }],
    }));
    return route.fulfill({ json: rows.slice(offset, offset + 11) });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(jobsUrl + '?status=failed&order=newest&offset=20');
  const selected = inspect(page);
  await selected.focus();
  const ledgerScroll = await page.evaluate(() => window.scrollY);
  expect(ledgerScroll).toBeGreaterThan(0);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Job Details' })).toBeVisible();
  const quarantine = page.getByRole('link', { name: 'View quarantine' });
  await quarantine.click();
  await expect(page.getByRole('heading', { name: 'CSV row 2' })).toBeVisible();
  await expect(page.getByText('Use an integer.').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next quarantine entries page' }).click();
  await expect(page.getByRole('heading', { name: 'CSV row 13' })).toBeVisible();
  await page.goBack();
  await page.getByRole('link', { name: 'Back to Job Details' }).click();
  await expect(quarantine).toBeFocused();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Collection Jobs' }).click();
  await expect(page).toHaveURL(jobsUrl + '?status=failed&order=newest&offset=20');
  await expect(selected).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(ledgerScroll);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Job Details' })).toBeVisible();
});

for (const width of [1440, 900, 768, 390, 320]) {
  test(`M15 ledger and diagnostics reflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: width <= 768 ? 'dark' : 'light', reducedMotion: 'reduce' });
    const populated = ['succeeded', 'partial', 'failed', 'running', 'pending'].map((status, index) => ({
      ...partialJob, status: status as CollectionJob['status'],
      job_id: index === 1 ? jobId : `0000000${index}-b2f7-4c80-8368-016b42ac249d`,
      error: status === 'failed' ? { code: 'no_valid_records', message: 'No candidates passed the pinned validation rules.' } : null,
      valid_count: index < 2 ? 1 : 0, invalid_count: index === 1 ? 3 : index === 2 ? 6 : 0,
      duplicate_count: index === 1 ? 2 : 0, dispatch_attempts: index === 4 ? 0 : 1,
    }));
    await mockDetail(page);
    await page.route(api + jobUrl + '/evidence-pages', route => route.fulfill({ json: [capture] }));
    await page.route(url => url.pathname === api + jobsUrl, route => {
      const status = new URL(route.request().url()).searchParams.get('status');
      return route.fulfill({ json: populated.filter(job => !status || job.status === status) });
    });
    await page.route(api + '/sources/' + sourceId, route => route.fulfill({ json: { source_name: 'Controlled fixture listings' } }));
    await page.route(api + '/sources/' + sourceId + '/versions/' + profileId, route => route.fulfill({ json: { version: 2 } }));
    await page.goto(jobsUrl + '?order=newest');
    await expect(ledger(page).getByText('Controlled fixture listings')).toHaveCount(5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const rules = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
    expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
    if (width === 1440) {
      const filter = page.getByRole('combobox', { name: 'Status' });
      await filter.selectOption('failed');
      await expect(ledger(page).getByRole('listitem')).toHaveCount(1);
      await filter.selectOption('');
    }
    await inspect(page).click();
    await expect(page.getByRole('region', { name: 'Run overview' })).toContainText('Partial result');
    await expect(page.getByRole('region', { name: 'Execution events' })).toContainText('Run produced partial results');
    await expect(page.getByRole('list', { name: 'Saved captures' })).toContainText('HTML input');
    await expect(page.getByRole('list', { name: 'Related records preview' })).toContainText('Fixture item');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect((await new AxeBuilder({ page }).withTags(rules).analyze()).violations).toEqual([]);
  });
}

test('a narrow touch viewport opens the Job and its related Record without horizontal scrolling', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 800 } });
  try {
    const page = await context.newPage();
    await mockList(page);
    await mockDetail(page);
    await page.route(api + '/records/' + record.record_id + '?include_lineage=true', route => route.fulfill({ json: record }));
    await page.goto(jobsUrl);
    await inspect(page).tap();
    const link = page.getByRole('link', { name: 'Open record ' + record.record_id });
    await expect(link).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await link.tap();
    await expect(page.getByRole('heading', { name: 'Record Details' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Job', exact: true }).tap();
    await expect(link).toBeVisible();
  } finally { await context.close(); }
});

test('Chrome native 200 percent zoom keeps Jobs and diagnostics usable', async ({ baseURL, browserName }) => {
  test.skip(browserName !== 'chromium', 'Uses the native Chromium Appearance settings.');
  const context = await chromium.launchPersistentContext('', {
    // The Chromium Headless Shell does not include chrome://settings.
    channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', baseURL, viewport: { width: 1440, height: 900 },
  });
  try {
    const page = context.pages()[0]!;
    await page.goto('chrome://settings/appearance');
    await page.locator('#zoomLevel').selectOption({ label: '200%' });
    await mockList(page);
    await mockDetail(page);
    await page.goto(jobsUrl);
    await expect(inspect(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(720);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
    await inspect(page).click();
    await expect(page.getByRole('region', { name: 'Execution and dispatch' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Related records preview' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(720);
    await page.getByRole('region', { name: 'Execution and dispatch' }).scrollIntoViewIfNeeded();
  } finally { await context.close(); }
});
