import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { Binding, Category, CollectionRequest, Topic } from '../src/features/topic-collections/api';

const root = '/api/v1';
const form = '/collection-requests/new';
const uuid = (n: number) => '6307032e-d307-4d3d-9a78-' + n.toString().padStart(12, '0');
const category = { id: uuid(1), name: 'Research', active: true };
const topic = { id: uuid(2), name: 'Articles', active: true, category_id: category.id };
const binding = (n: number): Binding => ({
  id: uuid(100 + n), source_id: uuid(200 + n), source_name: 'Authorized fixture ' + n,
  profile_version: n, profile_version_id: uuid(300 + n), config_hash: '4'.repeat(64),
  eligible: true, disabled_at: null, approved_by: 'Fixture operator', approved_at: '2026-11-16T01:00:00Z',
});
const result: CollectionRequest = {
  id: uuid(3), topic_id: topic.id, topic_name: topic.name, keyword: 'Example', status: 'pending',
  created_at: '2026-11-16T01:00:00Z', finished_at: null, refresh_of: null, jobs: [],
};
const pinned = (page: Page, n: number) => page.getByRole('checkbox', { name: new RegExp(`Authorized fixture ${n} Approved profile · Version ${n}$`) });
const start = (page: Page) => page.getByRole('button', { name: 'Start topic collection' });
const keyword = (page: Page) => page.getByRole('textbox', { name: 'Keyword', exact: true });
const review = (page: Page) => page.getByRole('button', { name: 'Review collection' });

async function catalog(page: Page, categories: Category[] = [category], topics: Topic[] = [topic]) {
  await page.route('**/api/v1/categories?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('active_only')).toBe('true');
    const offset = Number(params.get('offset'));
    return route.fulfill({ json: categories.filter(row => row.active).slice(offset, offset + Number(params.get('limit'))) });
  });
  await page.route('**/api/v1/topics?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('active_only')).toBe('true');
    const offset = Number(params.get('offset'));
    return route.fulfill({
      json: topics.filter(row => row.active && row.category_id === params.get('category_id'))
        .slice(offset, offset + Number(params.get('limit'))),
    });
  });
  await page.route(/\/api\/v1\/(?:categories|topics)\/[^/?]+$/, route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1);
    const row = [...categories, ...topics].find(item => item.id === id);
    return row ? route.fulfill({ json: row }) : route.fulfill({ status: 404 });
  });
}

async function sources(page: Page, bindings = [binding(1)]) {
  await page.route('**/api/v1/topics/*/bindings?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('eligible_only')).toBe('true');
    const offset = Number(params.get('offset'));
    return route.fulfill({ json: bindings.slice(offset, offset + Number(params.get('limit'))) });
  });
}

async function detail(page: Page) {
  await page.route('**/api/v1/articles?*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/collection-requests/' + result.id, route => route.fulfill({ json: result }));
}

async function openPreset(page: Page) {
  await page.goto(form + '?topic_id=' + topic.id);
  await expect(page.getByRole('heading', { name: topic.name, exact: true })).toBeVisible();
}

async function prepareReview(page: Page) {
  await pinned(page, 1).check();
  await keyword(page).fill(' Example ');
  await review(page).click();
}

test('a lost response replays the exact body with storage blocked, even after Source revocation', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
    });
  });
  await catalog(page);
  const eligible = [binding(1)];
  await sources(page, eligible);
  await detail(page);
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/v1/collection-requests', route => {
    bodies.push(route.request().postDataJSON());
    return bodies.length === 1 ? route.abort('failed') : route.fulfill({ status: 200, json: result });
  });

  await page.goto(form);
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await page.getByRole('button', { name: topic.name, exact: true }).click();
  await prepareReview(page);
  await start(page).click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  eligible.length = 0;
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Confirm your submission' })).toBeVisible();
  await page.goForward();
  await page.getByRole('button', { name: 'Retry submission' }).click();
  await expect(page.getByRole('heading', { name: 'Articles · Example' })).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toEqual({ topic_id: topic.id, binding_ids: [binding(1).id], keyword: 'Example', request_key: expect.stringMatching(/^[a-f0-9-]{36}$/) });
  expect(bodies[0]).toEqual(bodies[1]);
  await page.goBack();
  await expect(page.getByRole('link', { name: 'View submitted request' })).toBeVisible();
  await expect(start(page)).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Articles · Example' })).toBeVisible();
  expect(bodies).toHaveLength(2);
});

test('Category and Topic catalogs page beyond 99 entries without checking bindings for unselected Topics', async ({ page }) => {
  const categories = Array.from({ length: 101 }, (_, index) => ({
    id: uuid(1000 + index), name: `Group ${index + 1}`, active: true,
  }));
  const topics = Array.from({ length: 101 }, (_, index) => ({
    id: uuid(2000 + index), name: `Topic ${index + 1}`, active: true, category_id: categories[100]!.id,
  }));
  await catalog(page, categories, topics);
  await sources(page);
  const offsets = { categories: [] as string[], topics: [] as string[] };
  const reads = new Set<string>();
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/bindings')) reads.add(url.pathname);
    if (url.pathname === root + '/categories') offsets.categories.push(url.searchParams.get('offset')!);
    if (url.pathname === root + '/topics') offsets.topics.push(url.searchParams.get('offset')!);
  });
  await page.goto(form);
  await expect(page.getByText('Select a category to see its topics.')).toBeVisible();
  for (let index = 0; index < 8; index++) {
    await page.getByRole('button', { name: 'Load more categories' }).click();
    await expect(page.getByRole('button', { name: 'Group ' + (12 * (index + 1) + 1), exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Load more categories' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Group 101', exact: true }).click();
  for (let index = 0; index < 8; index++) {
    await page.getByRole('button', { name: 'Load more topics' }).click();
    await expect(page.getByRole('button', { name: 'Topic ' + (12 * (index + 1) + 1), exact: true })).toBeVisible();
  }
  expect(reads.size).toBe(0);
  await expect(page.getByRole('button', { name: 'Load more topics' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Topic 101', exact: true }).click();
  await expect(pinned(page, 1)).toBeVisible();
  expect([...reads]).toEqual([root + '/topics/' + topics[100]!.id + '/bindings']);
  const expected = ['0', '12', '24', '36', '48', '60', '72', '84', '96'];
  expect([...new Set(offsets.categories)]).toEqual(expected);
  expect([...new Set(offsets.topics)]).toEqual(expected);
});

test('late Topic results cannot replace a new category, and changing Topic keeps only the keyword', async ({ page }) => {
  const otherCategory = { id: uuid(111), name: 'Monitoring', active: true };
  const otherTopic = { id: uuid(112), name: 'Reports', category_id: otherCategory.id, active: true };
  await catalog(page, [category, otherCategory], [topic, otherTopic]);
  await sources(page);
  let unblock!: () => void;
  const blocked = new Promise<void>(resolve => { unblock = resolve; });
  await page.route('**/api/v1/topics?*', async route => {
    const isOld = new URL(route.request().url()).searchParams.get('category_id') === category.id;
    if (isOld) await blocked;
    await route.fulfill({ json: [isOld ? topic : otherTopic] });
  });
  await page.goto(form);
  const oldRequest = page.waitForRequest(request => request.url().includes('category_id=' + category.id));
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await oldRequest;
  await page.getByRole('button', { name: otherCategory.name, exact: true }).click();
  await page.getByRole('button', { name: otherTopic.name, exact: true }).click();
  await prepareReview(page);
  unblock();
  await page.getByRole('button', { name: 'Choose another topic' }).click();
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await expect(page.getByRole('button', { name: otherTopic.name, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: topic.name, exact: true }).click();
  await expect(pinned(page, 1)).not.toBeChecked();
  await expect(keyword(page)).toHaveValue(' Example ');
  await expect(start(page)).toHaveCount(0);
});

for (const [label, id, state] of [
  ['malformed', 'invalid-id', 422], ['missing', uuid(99), 404],
  ['inactive', topic.id, 200], ['empty', '', 0],
] as const) {
  test(`${label} Topic links offer the active catalog and do not fetch bindings`, async ({ page }) => {
    await catalog(page);
    const calls: string[] = [];
    await page.route('**/api/v1/topics/*/bindings?*', route => {
      calls.push(route.request().url());
      return route.fulfill({ json: [] });
    });
    if (state) await page.route('**/api/v1/topics/' + id, route => state === 200
      ? route.fulfill({ json: { ...topic, active: false } }) : route.fulfill({ status: state }));
    await page.goto(form + '?topic_id=' + id);
    await expect(page.getByRole('alert')).toContainText('This topic is invalid or is no longer available');
    await expect(page.getByRole('button', { name: category.name, exact: true })).toBeVisible();
    expect(calls).toEqual([]);
  });
}

test('inactive Category makes an active Topic unavailable', async ({ page }) => {
  await catalog(page, [{ ...category, active: false }]);
  await page.goto(form + '?topic_id=' + topic.id);
  await expect(page.getByRole('alert')).toContainText('no longer available');
  await expect(page.getByText('No active categories')).toBeVisible();
});

test('no eligible sources offered and the existing bindings management path is available', async ({ page }) => {
  await catalog(page);
  await sources(page, [{ ...binding(1), eligible: false }, { ...binding(2), disabled_at: result.created_at }]);
  await openPreset(page);
  await expect(page.getByText('No eligible sources for this topic', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View topic bindings' })).toHaveAttribute('href', '/topics/' + topic.id);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(keyword(page)).toHaveCount(0);
});

test('explicit selection, Unicode validation, review, and duplicate-click protection', async ({ page }) => {
  await catalog(page);
  await sources(page, [1, 2, 3, 4, 5].map(binding));
  await detail(page);
  let unblock!: () => void;
  const posted = new Promise<void>(resolve => { unblock = resolve; });
  let submits = 0;
  await page.route('**/api/v1/collection-requests', async route => {
    submits++;
    expect(route.request().postDataJSON()).toMatchObject({
      topic_id: topic.id, keyword: 'Example', binding_ids: [1, 2, 3, 5].map(index => binding(index).id),
    });
    await posted;
    await route.fulfill({ status: 201, json: result });
  });

  await openPreset(page);
  await expect(page.getByText('0 of 4 selected')).toBeVisible();
  for (const n of [3, 2, 1, 4]) await pinned(page, n).check();
  await expect(pinned(page, 5)).toBeDisabled();
  await pinned(page, 4).uncheck();
  await pinned(page, 5).check();
  await expect(page.getByText('4 of 4 selected')).toBeVisible();

  const long = '🐈'.repeat(129);
  await keyword(page).fill(long);
  await review(page).click();
  await expect(keyword(page)).toHaveValue(long);
  await expect(page.getByRole('alert')).toContainText('128 characters or fewer');
  await keyword(page).fill('one\u200Btwo');
  await expect(page.getByRole('alert')).toContainText('printable characters');
  await keyword(page).fill('🐈'.repeat(128));
  await review(page).click();
  await expect(start(page)).toBeVisible();

  await keyword(page).fill(' Example ');
  await expect(start(page)).toHaveCount(0);
  await review(page).click();
  const summary = page.getByRole('region', { name: 'Review collection' });
  for (const item of ['Research', 'Articles', 'Example', '4 selected sources', 'Authorized fixture 5 · Version 5', '4 jobs will search']) {
    await expect(summary).toContainText(item);
  }

  const sent = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/collection-requests'));
  await start(page).dblclick();
  await sent;
  await expect(start(page)).toBeDisabled();
  expect(submits).toBe(1);
  unblock();
  await expect(page.getByText('Collection request submitted. Follow the source jobs below.')).toBeVisible();
  await expect(page.getByText('Validated records will appear as jobs publish results.')).toBeVisible();
  expect(submits).toBe(1);
});

test('binding revoked after review is removed before POST and remaining sources stay selected', async ({ page }) => {
  await catalog(page);
  const current = [binding(1), binding(2)];
  await sources(page, current);
  let submits = 0;
  await page.route('**/api/v1/collection-requests', route => { submits++; return route.abort(); });
  await openPreset(page);
  await pinned(page, 2).check();
  await prepareReview(page);
  current.shift();
  await start(page).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Authorized fixture 1 is no longer available' })).toBeVisible();
  await expect(pinned(page, 2)).toBeChecked();
  await expect(keyword(page)).toHaveValue(' Example ');
  await expect(start(page)).toHaveCount(0);
  await review(page).click();
  await expect(page.getByRole('region', { name: 'Review collection' })).toContainText('1 job will search');
  expect(submits).toBe(0);
});

for (const [status, code, message] of [
  [403, 'source_not_approved', 'Source access was denied'],
  [409, 'collection_request_conflict', 'belongs to another request'],
  [422, 'invalid_request', 'Check the keyword and selected sources'],
  [503, 'internal_error', 'could not be confirmed'],
] as const) {
  test(`POST ${status} offers recovery without losing the collection context`, async ({ page }) => {
    await catalog(page);
    await sources(page);
    let calls = 0;
    await page.route('**/api/v1/collection-requests', route => {
      calls++;
      return route.fulfill({ status, json: { error: { code, message: 'secret upstream text' } } });
    });
    await openPreset(page);
    await prepareReview(page);
    await start(page).click();
    await expect(page.getByRole('alert')).toContainText(message);
    await expect(page.getByText('secret upstream text')).toHaveCount(0);
    if (status === 503) {
      await expect(page.getByRole('button', { name: 'Retry submission' })).toBeEnabled();
      await expect(page.getByRole('region', { name: 'Confirm your submission' })).toContainText('Example');
    } else {
      await expect(keyword(page)).toHaveValue(' Example ');
      await expect(pinned(page, 1)).toBeChecked();
    }
    expect(calls).toBe(1);
  });
}

test('inspect Source and Profile, then return to a revalidated draft', async ({ page }) => {
  await catalog(page);
  const available = [binding(1), binding(2)];
  await sources(page, available);
  const source = binding(1);
  await page.route(root + '/sources/' + source.source_id, route => route.fulfill({ status: 404 }));
  await page.route(root + '/sources/' + source.source_id + '/versions/' + source.profile_version_id,
    route => route.fulfill({ status: 404 }));
  await openPreset(page);
  await pinned(page, 2).check();
  await prepareReview(page);
  const sourceLink = page.getByRole('link', { name: 'Source details for Authorized fixture 1', exact: true });
  await sourceLink.click();
  await expect(page).toHaveURL('/sources/' + source.source_id);
  await page.getByRole('button', { name: 'Back to collection' }).click();
  await expect(sourceLink).toBeFocused();
  await expect(pinned(page, 1)).toBeChecked();
  await expect(start(page)).toBeVisible();
  const profileLink = page.getByRole('link', { name: 'Profile version 1 for Authorized fixture 1', exact: true });
  await profileLink.click();
  await expect(page).toHaveURL('/sources/' + source.source_id + '/profiles/' + source.profile_version_id);
  await expect(page.getByRole('button', { name: 'Back to collection' })).toBeVisible();
  available.shift();
  await page.goBack();
  await expect(page.getByRole('alert')).toContainText('Authorized fixture 1 is no longer available');
  await expect(pinned(page, 2)).toBeChecked();
  await expect(keyword(page)).toHaveValue(' Example ');
  await expect(start(page)).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole('button', { name: 'Back to collection' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Back to collection' }).click();
  await expect(pinned(page, 2)).not.toBeChecked();
  await expect(keyword(page)).toHaveCount(0);
});

for (const [width, theme] of [[1440, 'light'], [900, 'dark'], [390, 'light'], [320, 'dark']] as const) {
  test(`keyboard, axe and reflow at ${width}px in ${theme} with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 840 });
    await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
    await catalog(page);
    await sources(page);
    await page.goto(form);
    const selectCategory = page.getByRole('button', { name: category.name, exact: true });
    await selectCategory.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Topics', exact: true })).toBeFocused();
    await expect(page.getByRole('button', { name: topic.name, exact: true })).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: topic.name, exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: topic.name, exact: true })).toBeFocused();
    await expect(pinned(page, 1)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Choose another topic' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Reload sources' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pinned(page, 1)).toBeFocused();
    await page.keyboard.press('Space');
    await expect(pinned(page, 1)).toBeChecked();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(keyword(page)).toBeFocused();
    await page.keyboard.type('Example');
    await page.keyboard.press('Tab');
    await expect(review(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Review collection' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(start(page)).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(ax.violations).toEqual([]);
  });
}

test('request downloads wait for completion and recover from an export failure', async ({ page }) => {
  const id = '6307032e-d307-4d3d-9a78-0fdd7497f0b5';
  const request = {
    id, topic_name: 'Fixture topic', keyword: 'Example', status: 'pending',
    created_at: '2026-11-16T01:00:00Z', refresh_of: null, jobs: [],
  };
  await page.route('**/api/v1/articles?*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/collection-requests/' + id, route => route.fulfill({ json: request }));
  let attempts = 0;
  await page.route('**/api/v1/collection-requests/' + id + '/records/export?format=json', async route => {
    attempts++;
    if (attempts === 1) {
      await route.fulfill({ status: 413, json: { error: { code: 'record_export_limit' } } });
    } else {
      await route.fulfill({ contentType: 'application/json', body: '[]' });
    }
  });
  await page.goto('/collection-requests/' + id);
  const download = page.getByRole('button', { name: 'Download JSON' });
  await expect(download).toBeDisabled();
  await expect(page.getByText('Downloads are available after the jobs in this collection finish.')).toBeVisible();
  request.status = 'failed';
  await page.getByRole('button', { name: 'Reload status' }).click();
  await expect(download).toBeEnabled();
  await download.click();
  await expect(page.getByRole('alert')).toContainText('5,000 records or 8 MiB');
  await expect(page.getByRole('alert')).toContainText('download records from each child job');
  await expect(page.getByRole('alert')).toContainText('start a new collection with a narrower search or smaller input');
  const saved = page.waitForEvent('download');
  await download.press('Enter');
  expect((await saved).suggestedFilename()).toBe(`request-${id}-records.json`);
});


test('a late binding response for the previous Topic cannot become selectable', async ({ page }) => {
  const secondTopic = { ...topic, id: uuid(50), name: 'Reports' };
  await catalog(page, [category], [topic, secondTopic]);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/topics/*/bindings?*', async route => {
    const old = new URL(route.request().url()).pathname.includes(topic.id);
    if (old) await wait;
    await route.fulfill({ json: [binding(old ? 1 : 2)] });
  });
  const first = page.waitForRequest(request => request.url().includes(topic.id + '/bindings'));
  await openPreset(page);
  await first;
  await page.getByRole('button', { name: 'Choose another topic' }).click();
  await page.getByRole('button', { name: secondTopic.name, exact: true }).click();
  await expect(pinned(page, 2)).toBeVisible();
  release();
  await expect(pinned(page, 1)).toHaveCount(0);
  await expect(pinned(page, 2)).not.toBeChecked();
});

test('source refresh verifies previously browsed pages and preserves a pin on the later page', async ({ page }) => {
  await catalog(page);
  const available = Array.from({ length: 26 }, (_, index) => binding(index + 1));
  await sources(page, available);
  await openPreset(page);
  await pinned(page, 1).check();
  await expect(pinned(page, 25)).toHaveCount(0);
  await page.getByRole('button', { name: 'Load more approved sources' }).click();
  await pinned(page, 26).check();
  await expect(page.getByText('2 of 4 selected')).toBeVisible();
  available.shift();
  await page.getByRole('button', { name: 'Reload sources' }).click();
  await expect(page.getByRole('alert')).toContainText('Authorized fixture 1 is no longer available');
  await expect(pinned(page, 26)).toBeChecked();
  await expect(page.getByText('1 of 4 selected')).toBeVisible();
});

test('an inactive Topic blocks a reviewed request before POST', async ({ page }) => {
  const current = { ...topic };
  await catalog(page, [category], [current]);
  await sources(page);
  let writes = 0;
  await page.route('**/api/v1/collection-requests', route => { writes++; return route.abort(); });
  await openPreset(page);
  await prepareReview(page);
  current.active = false;
  await start(page).click();
  await expect(page.getByText('Choose another topic.', { exact: false })).toBeVisible();
  await expect(start(page)).toHaveCount(0);
  expect(writes).toBe(0);
});

test('availability loading and retry expose no interactive stale bindings', async ({ page }) => {
  await catalog(page);
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  await page.route('**/api/v1/topics/*/bindings?*', async route => {
    calls++;
    if (calls === 1) {
      await wait;
      return route.fulfill({ status: 503 });
    }
    return route.fulfill({ json: [binding(1)] });
  });
  await openPreset(page);
  await expect(page.getByRole('status')).toContainText('Loading approved sources');
  await expect(pinned(page, 1)).toHaveCount(0);
  release();
  await expect(page.getByRole('alert')).toContainText('Backend unavailable');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(pinned(page, 1)).not.toBeChecked();
  await expect(page.getByRole('heading', { name: 'Approved sources' })).toBeFocused();
});

test('Request Detail polls visible work and reports all five persisted outcomes', async ({ page }) => {
  const request = { ...result };
  await page.route('**/api/v1/articles?*', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/collection-requests/' + request.id, route => route.fulfill({ json: request }));
  await page.goto('/collection-requests/' + request.id);
  const state = page.getByRole('status').filter({ hasText: /^(Pending|Running|Partial|Failed|Succeeded)$/ });
  await expect(state).toHaveText('Pending');
  request.status = 'running';
  await expect(state).toHaveText('Running');
  for (const status of ['partial', 'failed', 'succeeded'] as const) {
    request.status = status;
    await page.getByRole('button', { name: 'Reload status' }).click();
    await expect(state).toHaveText(status[0]!.toUpperCase() + status.slice(1));
  }
});
