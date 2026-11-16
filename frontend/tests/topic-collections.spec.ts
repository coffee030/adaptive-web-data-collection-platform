import { expect, test } from '@playwright/test';

test('a topic submission retries with the same key when session storage is unavailable', async ({ page }) => {
  const id = '6307032e-d307-4d3d-9a78-0fdd7497f0b5';
  const category = { id, name: 'Research', active: true };
  const topic = { id, name: 'Articles', active: true, category_id: id };
  const binding = { id, source_name: 'Authorized fixture', profile_version: 1 };
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      get() { throw new DOMException('Storage unavailable', 'SecurityError'); },
    });
  });
  await page.route('**/api/v1/categories?*', route => route.fulfill({ json: [category] }));
  await page.route('**/api/v1/topics?*', route => route.fulfill({ json: [topic] }));
  await page.route('**/api/v1/topics/*/bindings?*', route => route.fulfill({ json: [binding] }));
  await page.route('**/api/v1/articles?*', route => route.fulfill({ json: [] }));
  const result = {
    id, topic_name: topic.name, keyword: 'Example', status: 'succeeded',
    created_at: '2026-11-16T01:00:00Z', refresh_of: null, jobs: [],
  };
  const keys: string[] = [];
  await page.route('**/api/v1/collection-requests', route => {
    keys.push(route.request().postDataJSON().request_key);
    return keys.length === 1 ? route.abort('failed') : route.fulfill({ status: 200, json: result });
  });
  await page.route('**/api/v1/collection-requests/' + id, route => route.fulfill({ json: result }));

  await page.goto('/collection-requests/new');
  await page.getByRole('combobox', { name: 'Category' }).selectOption(id);
  await page.getByRole('combobox', { name: 'Topic' }).selectOption(id);
  await page.getByRole('textbox', { name: 'Keyword' }).fill('Example');
  await page.getByRole('checkbox', { name: 'Authorized fixture · Version 1' }).check();
  const submit = page.getByRole('button', { name: 'Start topic collection' });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('could not be confirmed');
  await submit.click();
  await expect(page.getByRole('heading', { name: 'Articles · Example' })).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toMatch(/^[a-f0-9-]{36}$/);
  expect(keys[0]).toBe(keys[1]);
});

test('topic selection loads one category page at a time and resets when the category changes', async ({ page }) => {
  const categories = Array.from({ length: 100 }, (_, index) => ({
    id: String(index + 1), name: `Group ${index + 1}`, active: true,
  }));
  const categoryPages: string[] = [];
  await page.route('**/api/v1/categories?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('active_only')).toBe('true');
    expect(params.get('limit')).toBe('100');
    const offset = params.get('offset')!;
    categoryPages.push(offset);
    return route.fulfill({ json: categories.slice(Number(offset)) });
  });
  await page.route('**/api/v1/topics?*', route => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get('active_only')).toBe('true');
    const category = params.get('category_id');
    return route.fulfill({ json: [{ id: `topic-${category}`, name: 'Shared topic name', category_id: category, active: true }] });
  });
  await page.route('**/api/v1/topics/*/bindings?*', route => route.fulfill({
    json: [{ id: 'approved', source_name: 'Approved binding', profile_version: 1 }],
  }));

  await page.goto('/collection-requests/new');
  const category = page.getByRole('combobox', { name: 'Category' });
  const topic = page.getByRole('combobox', { name: 'Topic' });
  await expect(category.locator('option')).toHaveCount(100);
  await expect(topic).toHaveCount(0);
  expect([...new Set(categoryPages)]).toEqual(['0']);
  await page.getByRole('button', { name: 'Load more categories' }).click();
  await expect(category.locator('option')).toHaveCount(101);
  expect(categoryPages.filter(offset => offset !== '0')).toEqual(['99']);
  await expect(page.getByRole('button', { name: 'Load more categories' })).toHaveCount(0);

  await category.selectOption('1');
  await topic.selectOption({ label: 'Shared topic name' });
  await expect(topic).toHaveValue('topic-1');
  await page.getByRole('checkbox', { name: 'Approved binding · Version 1' }).check();
  await page.getByRole('textbox', { name: 'Keyword' }).fill('test');
  await expect(page.getByRole('button', { name: 'Start topic collection' })).toBeEnabled();

  await category.selectOption('100');
  await expect(topic).toHaveValue('');
  await expect(page.getByRole('checkbox', { name: 'Approved binding · Version 1' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start topic collection' })).toBeDisabled();
  await topic.selectOption({ label: 'Shared topic name' });
  await expect(topic).toHaveValue('topic-100');
});

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
