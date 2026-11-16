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
