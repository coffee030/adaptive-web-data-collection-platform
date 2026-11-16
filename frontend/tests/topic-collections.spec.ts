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
