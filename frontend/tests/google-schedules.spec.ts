import { expect, test, type Page } from '@playwright/test';
import type { GoogleProvider, MarketSchedule, MarketSnapshot } from '../src/features/trends/google';

const route = '/operations/worldwide-trends?view=google';
const api = '/api/v1/trends/google';
const source = '00000000-0000-4000-8000-000000000001';
const job = '00000000-0000-4000-8000-000000000002';
const evidence = '00000000-0000-4000-8000-000000000003';
const record = '00000000-0000-4000-8000-000000000004';
const observed = '2026-11-25T12:00:00Z';
const due = '2026-11-25T13:00:00Z';
const sample: MarketSchedule = { region: 'HK', active: true, interval_minutes: 60, due_at: due,
  observed_at: null, claimed_at: null, pending_job: null, last_job: null, last_error: null };
const empty: MarketSnapshot = { region: 'HK', observed_at: null, source_url: null, response_sha256: null, events: [] };
const feed = 'https://trends.google.com/trending/rss?geo=HK';
const captured: MarketSnapshot = { region: 'HK', observed_at: observed, source_url: feed, response_sha256: 'a'.repeat(64), events: [
  { event_id: 'first', query: '香港餐飲展', published_at: '2026-11-25T08:00:00Z', observed_at: '2026-11-25T09:15:00Z', traffic_bucket: '2K+',
    traffic_lower_bound: 2000, job_id: job, record_id: record, evidence_id: evidence },
  { event_id: 'second', query: 'Controlled search', published_at: '2026-11-25T08:30:00Z', observed_at: observed, traffic_bucket: null,
    traffic_lower_bound: null, job_id: job, record_id: source, evidence_id: evidence },
] };

async function fixture(page: Page) {
  const provider: GoogleProvider = { authorized: false, blocked: false, source_id: null, profile_id: null,
    retry_at: null, last_error: null, policy: 'https://example.invalid/publisher-attribution' };
  const state = { provider, schedules: [] as MarketSchedule[], snapshot: empty, writes: [] as object[] };
  await page.route('**/*', async request => {
    if (new URL(request.request().url()).hostname !== '127.0.0.1') {
      await request.abort(); throw Error('Unexpected external browser request');
    }
    await request.fallback();
  });
  await page.route('**/api/v1/**', request => request.fulfill({ json: [] }));
  await page.route('**' + api + '/**', async request => {
    const method = request.request().method();
    const path = new URL(request.request().url()).pathname.slice(api.length);
    if (method === 'GET') {
      if (path === '/provider') return request.fulfill({ json: provider });
      if (path === '/schedules') return request.fulfill({ json: state.schedules });
      if (path === '/schedules/HK/snapshot') return provider.authorized
        ? request.fulfill({ json: state.snapshot })
        : request.fulfill({ status: 403, json: { error: { code: 'source_not_approved' } } });
    }
    const body = request.request().postDataJSON();
    state.writes.push({ method, path, body });
    if (method === 'POST' && path === '/provider') {
      provider.authorized = true;
      provider.source_id = source;
      return request.fulfill({ json: provider });
    }
    if (method === 'POST' && path === '/schedules') {
      const row = { ...sample, ...body };
      state.schedules = [row];
      return request.fulfill({ status: 201, json: row });
    }
    if (method === 'PATCH' && path === '/schedules/HK') {
      Object.assign(state.schedules[0]!, body);
      return request.fulfill({ json: state.schedules[0] });
    }
    throw Error('Unexpected Google request ' + method + ' ' + path);
  });
  return state;
}

test('approve a sample, create a regional schedule and adjust its cadence without losing paused state', async ({ page }) => {
  const state = await fixture(page);
  await page.goto('/operations/worldwide-trends');
  await page.getByRole('link', { name: 'Google Trending Now', exact: true }).click();
  await expect(page.getByText('Source approval is required before scheduling checks.', { exact: false })).toBeVisible();
  await expect(page.getByText('Add a market to start recurring checks.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Approve source' }).click();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel('Approver name').fill('Controlled operator');
  await page.getByRole('checkbox', { name: /reviewed Google/ }).check();
  await page.getByRole('button', { name: 'Approve source' }).click();
  await expect(page.getByText('Approved source', { exact: true })).toBeVisible();
  await page.getByLabel('Market code').fill('hk');
  const interval = page.getByLabel('Interval (minutes)');
  await expect(interval).toHaveValue('60');
  await interval.fill('9');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  expect(state.writes).toHaveLength(1);
  await interval.fill('60');
  await page.getByRole('button', { name: 'Save schedule' }).click();
  await expect(page).toHaveURL(/view=google&market=HK$/);
  await expect(page.getByRole('heading', { name: 'Hong Kong (HK)' })).toBeFocused();
  await expect(page.getByText(/No verified snapshot yet/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause schedule' }).click();
  await expect(page.getByText('Paused · Every 60 minutes')).toBeVisible();
  await page.getByText('Schedule settings', { exact: true }).click();
  await interval.fill('10');
  await page.getByRole('button', { name: 'Update interval' }).click();
  await expect(page.getByText('Paused · Every 10 minutes')).toBeVisible();
  await page.getByRole('button', { name: 'Resume schedule' }).click();
  await expect(page.getByText('Active · Every 10 minutes')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Active · Every 10 minutes')).toBeVisible();
  expect(state.writes).toEqual([
    { method: 'POST', path: '/provider', body: { region: 'HK', approver: 'Controlled operator' } },
    { method: 'POST', path: '/schedules', body: { region: 'HK', interval_minutes: 60 } },
    { method: 'PATCH', path: '/schedules/HK', body: { active: false } },
    { method: 'PATCH', path: '/schedules/HK', body: { interval_minutes: 10 } },
    { method: 'PATCH', path: '/schedules/HK', body: { active: true } },
  ]);
});

test('retain last verified regional evidence through a publisher stop, preserve null traffic and hide withdrawn data on a phone', async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.provider, { authorized: true, source_id: source });
  state.schedules = [{ ...sample, observed_at: observed, last_job: job, pending_job: job }];
  state.snapshot = captured;
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(route + '&market=HK');
  await expect(page.getByRole('link', { name: 'Inspect current collection job' })).toHaveAttribute('href', '/collection-jobs/' + job);
  const table = page.getByRole('table', { name: 'Google Trending Now searches in HK' });
  const first = table.getByRole('row').filter({ hasText: '香港餐飲展' });
  await expect(first.getByRole('link', { name: '香港餐飲展, validated record' })).toHaveAttribute('href', '/records/' + record);
  await expect(first.getByRole('link', { name: 'Normalized evidence for 香港餐飲展' })).toHaveAttribute('href', '/evidence/' + evidence);
  await expect(first.getByRole('link', { name: 'Collection job for 香港餐飲展' })).toHaveAttribute('href', '/collection-jobs/' + job);
  await expect(first.getByRole('cell', { name: /2K\+.*2,000/ })).toBeVisible();
  await expect(first.getByText('Lower bound 2,000')).toBeVisible();
  await expect(first.getByText('Traffic observed (UTC)', { exact: false }).first()).toBeVisible();
  await expect(first.locator('time[datetime="2026-11-25T09:15:00Z"]')).toBeVisible();
  await expect(page.locator('.google-snapshot-summary time')).toHaveAttribute('datetime', observed);
  const missing = table.getByRole('row').filter({ hasText: 'Controlled search' });
  await expect(missing.getByText('Not provided', { exact: true })).toBeVisible();
  await expect(missing.getByText(/Lower bound/)).toHaveCount(0);
  await page.getByText('Snapshot source', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Google Trending Now RSS for HK' })).toHaveAttribute('href', feed);
  await expect(page.getByText(captured.response_sha256!, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  Object.assign(state.provider, { retry_at: due, last_error: 'publisher_rate_limited' });
  Object.assign(state.schedules[0]!, { pending_job: null, last_error: 'publisher_rate_limited' });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText(/Next permitted publisher check/)).toBeVisible();
  await expect(table).toBeVisible();
  Object.assign(state.provider, { blocked: true, last_error: 'publisher_access_blocked', retry_at: null });
  Object.assign(state.schedules[0]!, { active: false, last_error: 'publisher_access_blocked' });
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('button', { name: 'Resume schedule' })).toBeDisabled();
  await expect(table).toBeVisible();
  state.snapshot = { ...captured, events: [] };
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText(/Google returned no trending searches/)).toBeVisible();
  await expect(page.getByText(/No verified snapshot yet/)).toHaveCount(0);
  Object.assign(state.provider, { authorized: false, source_approval_status: 'revoked', blocked: false });
  state.snapshot = captured;
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByText(/Snapshot access requires active source approval/)).toBeVisible();
  await expect(table).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Review authorization in Core Sources' })).toHaveAttribute('href', '/sources/' + source);
  await expect(page.getByRole('button', { name: 'Approve source' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Hong Kong (HK)' })).toBeVisible();
  state.provider.source_approval_status = 'approved';
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await expect(page.getByRole('button', { name: 'Verify mapping' })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});
