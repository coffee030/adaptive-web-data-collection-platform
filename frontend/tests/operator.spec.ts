import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { Profile } from '../src/features/profiles/api';
import type { Source } from '../src/features/sources/api';
import type { Binding, Category, Topic } from '../src/features/topic-collections/api';

const root = '/api/v1';
const category: Category = { id: '11111111-1111-4111-8111-111111111111', name: 'Fixture research', active: true };
const topic: Topic = { id: '22222222-2222-4222-8222-222222222222', name: 'Policy notices', category_id: category.id, active: true };
const topicUrl = '/topics/' + topic.id;
const source: Source = { source_id: 'a'.repeat(32), source_name: 'Public Notices Fixture', adapter_type: 'web',
  allowed_origins: ['https://notices.example.test'], allowed_datasets: [], permission_reference: 'Fixture access ticket 146',
  approval_status: 'approved', allowed_paths: { 'https://notices.example.test': ['/notices'] }, min_request_interval_ms: 1500 };
const profile: Profile = { source_id: source.source_id, profile_version_id: 'b'.repeat(32), version: 3, revision: 4,
  configuration: {
    adapter_type: 'web', config_schema_version: '1', selector_type: 'css', item_selector: 'article.notice',
    record_schema: { record_type: 'notice', schema_version: '1', identity_field: 'title',
      fields: [{ name: 'title', value_type: 'string', required: true }] },
    fields: [{ name: 'title', selector: 'h2', selector_type: null, mode: 'text', attribute: null, resolve_url: false }],
    search: { origin: source.allowed_origins[0]!, path: '/notices/search', keyword_parameter: 'q',
      result_item_selector: 'li.result', detail_link_selector: 'a.notice', max_requests: 12, max_detail_pages: 5 },
    article: { title: 'title' },
  }, config_hash: 'c'.repeat(64), approval_status: 'approved', approved_by: 'Fixture profile reviewer',
  approved_at: '2026-11-17T00:52:00Z', validation_report_id: 'd'.repeat(32),
};
const binding: Binding = { id: '33333333-3333-4333-8333-333333333333', source_id: source.source_id,
  source_name: source.source_name, profile_version_id: profile.profile_version_id, profile_version: profile.version,
  config_hash: profile.config_hash, approved_by: 'Fixture binding reviewer', approved_at: '2026-11-17T01:05:00Z',
  disabled_at: null, eligible: true };
const stamp = '2026-11-17T01:30:00Z';
const reject = (route: Route, status: number, code: string) => route.fulfill({ status, json: { error: { code } } });

async function bindingBackend(page: Page, initial?: Binding) {
  const currentSource = { ...source };
  const currentProfile = { ...profile };
  const currentCategory = { ...category };
  let saved = initial;
  const requests: { path: string; body: unknown }[] = [];
  function view(row: Binding) {
    return { ...row, eligible: !row.disabled_at && currentCategory.active
      && currentSource.approval_status === 'approved' && currentProfile.approval_status === 'approved' };
  }
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(root.length);
    const method = route.request().method();
    switch (path) {
      case '/sources': return route.fulfill({ json: [currentSource] });
      case '/sources/' + source.source_id: return route.fulfill({ json: currentSource });
      case '/sources/' + source.source_id + '/versions': return route.fulfill({ json: [currentProfile] });
      case '/sources/' + source.source_id + '/versions/' + profile.profile_version_id:
        return route.fulfill({ json: currentProfile });
      case '/categories/' + category.id: return route.fulfill({ json: currentCategory });
      case '/topics/' + topic.id: return route.fulfill({ json: topic });
    }
    if (path === topicUrl + '/bindings' && method === 'GET') {
      const row = saved && view(saved);
      return route.fulfill({ json: row && (url.searchParams.get('eligible_only') !== 'true' || row.eligible) ? [row] : [] });
    }
    if (path.startsWith(topicUrl + '/bindings') && method === 'POST') {
      const body = route.request().postDataJSON();
      requests.push({ path, body });
      if (!path.endsWith('/disable') && currentSource.approval_status !== 'approved') return reject(route, 403, 'source_not_approved');
      if (!path.endsWith('/disable') && currentProfile.approval_status !== 'approved') return reject(route, 409, 'profile_not_approved');
      if (path.endsWith('/disable')) saved = { ...saved!, disabled_at: stamp };
      else saved = { ...binding, approved_at: stamp, approved_by: body.approved_by };
      return route.fulfill({ json: view(saved), status: path.endsWith('/bindings') ? 201 : 200 });
    }
    return reject(route, 404, 'not_found');
  });
  return { requests, currentSource, currentProfile, currentCategory };
}

test('binding creation, disable and restore require review and use persisted eligibility', async ({ page }) => {
  const backend = await bindingBackend(page);
  await page.goto(topicUrl);
  await expect(page.getByText('No eligible bindings for this topic.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Authorized source' }).selectOption(source.source_id);
  await page.getByRole('combobox', { name: 'Approved keyword profile' }).selectOption(profile.profile_version_id);
  await page.getByRole('textbox', { name: 'Operator name' }).fill('Binding reviewer');
  await page.getByRole('button', { name: 'Review binding', exact: true }).click();
  const review = page.getByRole('form', { name: 'Approve binding' });
  await expect(review).toContainText(topic.name);
  await expect(review).toContainText(profile.version.toString());
  expect(backend.requests).toEqual([]);
  await review.getByRole('button', { name: 'Approve binding' }).click();
  await expect(page.getByText('Eligible', { exact: true })).toBeVisible();
  expect(backend.requests[0]?.body).toEqual({ source_id: source.source_id, profile_version_id: profile.profile_version_id, approved_by: 'Binding reviewer' });
  const inspect = page.getByRole('link', { name: source.source_name, exact: true });
  await inspect.click();
  await page.getByRole('link', { name: 'Back to topic bindings' }).click();
  await expect(inspect).toBeFocused();

  await page.getByRole('button', { name: 'Review disable' }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Review disable' })).toBeFocused();
  expect(backend.requests).toHaveLength(1);
  await page.getByRole('button', { name: 'Review disable' }).click();
  await page.getByRole('button', { name: 'Disable binding', exact: true }).click();
  await expect(page.getByText('Disabled', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue to New Collection' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review restore' }).click();
  await page.getByRole('textbox', { name: 'Restoration approval label' }).fill('Restoration reviewer');
  await page.getByRole('button', { name: 'Restore binding approval' }).click();
  await expect(page.getByText('Restoration reviewer', { exact: true })).toBeVisible();
  const continueLink = page.getByRole('link', { name: 'Continue to New Collection' });
  await continueLink.click();
  await expect(page).toHaveURL('/collection-requests/new?topic_id=' + topic.id);
  await expect(page.getByRole('checkbox', { name: new RegExp(source.source_name) })).not.toBeChecked();
  await page.goBack();
  await expect(continueLink).toBeFocused();
  await page.goForward();
  await expect(page).toHaveURL('/collection-requests/new?topic_id=' + topic.id);
});

test('a stale binding candidate is denied by the server and current availability is loaded', async ({ page }) => {
  const backend = await bindingBackend(page, binding);
  await page.goto(topicUrl);
  await expect(page.getByRole('link', { name: 'Continue to New Collection' })).toBeVisible();
  await page.getByRole('combobox', { name: 'Authorized source' }).selectOption(source.source_id);
  await page.getByRole('combobox', { name: 'Approved keyword profile' }).selectOption(profile.profile_version_id);
  await page.getByRole('textbox', { name: 'Operator name' }).fill('Local reviewer');
  await page.getByRole('button', { name: 'Review binding', exact: true }).click();
  backend.currentProfile.approval_status = 'retired';
  await page.getByRole('button', { name: 'Approve binding', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('no longer approved');
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('No approved keyword-search Profiles', { exact: false })).toBeVisible();
  backend.currentSource.approval_status = 'revoked';
  await page.getByRole('button', { name: 'Refresh bindings' }).click();
  await expect(page.getByText('No authorized web sources', { exact: false })).toBeVisible();
});

test('catalog pages categories and selected topics and protects changes from detectable concurrent edits', async ({ page }) => {
  const categories = Array.from({ length: 20 }, (_, index) => ({
    ...category, id: index.toString(16).padStart(32, '0'), name: 'Category ' + (index + 1),
  })).concat({ ...category });
  const topics = Array.from({ length: 20 }, (_, index) => ({
    ...topic, id: String(index + 100).padStart(32, '0'), name: 'Topic ' + (index + 1),
  })).concat({ ...topic });
  const writes: { path: string; body: unknown }[] = [];
  let pendingConflict = false;
  await page.route('**/api/v1/**', route => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice(root.length);
    const rows = path.startsWith('/categories') ? categories : topics;
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (rows.some(row => row.name === body.name)) return reject(route, 409, 'duplicate_catalog_name');
      const created = { id: (rows === categories ? 'e' : 'f').repeat(32), ...body };
      rows.unshift(created);
      writes.push({ path, body });
      return route.fulfill({ status: 201, json: created });
    }
    if (path.split('/').length > 2) {
      const row = rows.find(row => row.id === path.split('/').at(-1));
      if (!row) return reject(route, 404, 'category_not_found');
      if (route.request().method() === 'PUT') {
        const body = route.request().postDataJSON();
        writes.push({ path, body });
        Object.assign(row, body);
      } else if (pendingConflict) {
        pendingConflict = false;
        row.name = 'Edited elsewhere';
      }
      return route.fulfill({ json: row });
    }
    if (rows === topics) expect(url.searchParams.get('category_id')).toBeTruthy();
    const selectedRows = rows === topics ? topics.filter(item => item.category_id === url.searchParams.get('category_id')) : categories;
    const offset = Number(url.searchParams.get('offset'));
    const limit = Number(url.searchParams.get('limit'));
    return route.fulfill({ json: selectedRows.slice(offset, offset + limit) });
  });
  await page.goto('/topics');
  await page.getByRole('button', { name: 'Next categories page' }).click();
  await page.getByRole('button', { name: category.name, exact: true }).click();
  await page.getByRole('button', { name: 'Next topics page' }).click();
  await page.getByRole('button', { name: 'Edit topic ' + topic.name }).click();
  await expect(page.getByText('Parent category · ' + category.name)).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Parent category' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Active topic' }).uncheck();
  await page.getByRole('button', { name: 'Save topic' }).click();
  await expect(page.getByText('Topic updated.')).toBeVisible();
  expect(writes[0]?.body).toEqual({ name: topic.name, active: false });
  await page.getByRole('button', { name: 'Edit category ' + category.name }).click();
  await page.getByRole('textbox', { name: 'Category name' }).fill('My edit');
  pendingConflict = true;
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByRole('alert')).toContainText('changed since you opened it');
  await expect(page.getByRole('textbox', { name: 'Category name' })).toHaveValue('My edit');
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'New category' }).click();
  await page.getByRole('textbox', { name: 'Category name' }).fill('Edited elsewhere');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('alert')).toContainText('already in use');
  await page.getByRole('textbox', { name: 'Category name' }).fill('Controlled QA');
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Category created.')).toBeVisible();
  await page.getByRole('checkbox', { name: 'Active category' }).uncheck();
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByText('Category updated.')).toBeVisible();
  await expect(page.getByText(/Inactive category · Topics unavailable/)).toBeVisible();
  await page.getByRole('button', { name: 'New topic' }).click();
  await page.getByRole('textbox', { name: 'Topic name' }).fill('QA fixture topic');
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(page.getByText('Topic created.')).toBeVisible();
  expect(writes.at(-1)?.body).toEqual({ name: 'QA fixture topic', active: true, category_id: 'e'.repeat(32) });
  await page.goto('/topics?category_id=' + '9'.repeat(32));
  await expect(page.getByRole('alert')).toContainText('Could not load selected category');
});

test('mobile profile keeps the saved revision, configuration and sample controls reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bindingBackend(page);
  const version = '/sources/' + source.source_id + '/versions/' + profile.profile_version_id;
  await page.route(url => url.pathname === root + version, route => route.fulfill({
    json: { ...profile, approval_status: 'draft', approved_at: null, approved_by: null, validation_report_id: null },
  }));
  await page.goto('/sources/' + source.source_id + '/profiles/' + profile.profile_version_id);
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await page.getByRole('button', { name: 'Sample checks', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Preview and validation' })).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Sample keyword' })).toBeVisible();
  await page.getByRole('button', { name: 'Configuration', exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Configuration', exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
  if (process.env.M14_CAPTURE_OPERATOR === '1') {
    await page.getByRole('heading', { name: 'Configuration', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: test.info().outputPath('profile-mobile-dark.png') });
  }
});

test('a narrow touch session can open and cancel binding review', async ({ browser, baseURL }) => {
  const page = await browser.newPage({ baseURL, hasTouch: true, isMobile: true, viewport: { width: 320, height: 780 } });
  try {
    const backend = await bindingBackend(page, binding);
    await page.goto(topicUrl);
    await page.getByRole('button', { name: 'Review disable' }).tap();
    await expect(page.getByRole('form', { name: 'Disable binding' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel', exact: true }).tap();
    await expect(page.getByRole('button', { name: 'Review disable' })).toBeFocused();
    expect(backend.requests).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  } finally {
    await page.close();
  }
});

for (const [width, theme] of [[1440, 'light'], [900, 'dark'], [768, 'system'], [390, 'dark'], [320, 'light']] as const) {
  test(`binding inspection and approval keyboard path at ${width}px in ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await bindingBackend(page, binding);
    const consoleErrors: string[] = [];
    page.on('pageerror', error => consoleErrors.push(error.message));
    await page.goto(topicUrl);
    await page.getByRole('combobox', { name: 'Theme' }).selectOption(theme);
    if (theme === 'system') await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    else await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    if (theme === 'system') expect(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)).toBe(true);
    await page.getByRole('button', { name: 'Review disable' }).press('Enter');
    await expect(page.getByRole('form', { name: 'Disable binding' })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Cancel', exact: true }).press('Enter');
    await expect(page.getByRole('button', { name: 'Review disable' })).toBeFocused();
    expect(consoleErrors).toEqual([]);
    if (process.env.M14_CAPTURE_OPERATOR === '1') {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: test.info().outputPath(`binding-${width}-${theme}.png`) });
    }
  });
}
