import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Source } from '../src/features/sources/api';

const api = '/api/v1/sources';
const id = '3b70bfdd286a4e39b86b33607a0362a6';
const csv: Source = {
  source_id: id, source_name: 'Controlled listings', adapter_type: 'csv',
  permission_reference: 'Ticket 184', approval_status: 'revoked',
  allowed_datasets: ['listings'], allowed_origins: [],
};
const fixture = (page: Page, source: Source = csv, versions: unknown[] = []) => Promise.all([
  page.route(url => url.pathname === api + '/' + id, route => route.fulfill({ json: source })),
  page.route(url => url.pathname === api + '/' + id + '/versions', route => route.fulfill({ json: versions })),
]);

async function fillSource(page: Page) {
  await page.getByRole('textbox', { name: 'Source name' }).fill('Controlled listings');
  await page.getByRole('textbox', { name: 'Permission reference' }).fill('Ticket 184');
  await page.getByRole('textbox', { name: 'Allowed dataset IDs' }).fill('listings');
}

test('Sources navigation, full array, client-side pagination, and revoked access', async ({ page }) => {
  await page.route(url => url.pathname === '/api/v1/collection-jobs', route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === api, route => {
    expect(new URL(route.request().url()).search).toBe('');
    return route.fulfill({ json: [csv, ...Array.from({ length: 20 }, (_, i) => ({
      ...csv, source_id: String(i), source_name: 'Source ' + i,
    }))] });
  });
  await page.goto('/collection-jobs');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await nav.getByRole('link', { name: 'Sources' }).click();
  await expect(page).toHaveURL('/sources');
  await expect(nav.getByRole('link', { name: 'Sources' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('link', { name: csv.source_name })).toHaveAttribute('href', '/sources/' + id);
  await expect(page.getByRole('table').getByText('Revoked').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next sources page' }).click();
  await expect(page.getByText('Sources 21', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Next sources page' })).toBeDisabled();
});

test('loading and empty Sources', async ({ page }) => {
  let resolve!: () => void;
  const response = new Promise<void>(done => { resolve = done; });
  await page.route(url => url.pathname === api, async route => {
    await response;
    await route.fulfill({ json: [] });
  });
  await page.goto('/sources');
  await expect(page.getByRole('status')).toHaveText('Loading sources…');
  resolve();
  await expect(page.getByRole('status')).toContainText('No sources registered');
});

test('503 and retry', async ({ page }) => {
  await page.route(url => url.pathname === api, route => route.fulfill({ status: 503, json: {
    error: { code: 'database_unavailable', message: 'Unavailable' },
  } }));
  await page.goto('/sources');
  await expect(page.getByRole('alert')).toContainText('Backend unavailable');
  await page.route(url => url.pathname === api, route => route.fulfill({ json: [csv] }));
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('table')).toBeVisible();
});

test('404 Source', async ({ page }) => {
  await page.route(url => url.pathname === api + '/' + id, route => route.fulfill({ status: 404, json: {
    error: { code: 'source_not_found', message: 'Source does not exist' },
  } }));
  await page.goto('/sources/' + id);
  await expect(page.getByRole('alert')).toContainText('Source not found');
});

test('revoked Source detail and no versions', async ({ page }) => {
  await fixture(page);
  await page.goto('/sources/' + id);
  await expect(page.getByRole('heading', { name: csv.source_name })).toBeVisible();
  await expect(page.getByText('Collection requires source authorization.')).toBeVisible();
  await expect(page.getByText(csv.permission_reference)).toBeVisible();
  await expect(page.getByText('listings', { exact: true })).toBeVisible();
  await expect(page.getByText('No profile versions registered for this source.')).toBeVisible();
});

test('multiple versions keep approval details read only and long data contained', async ({ page }) => {
  const origin = 'http://' + 'controlled-host'.repeat(20) + ':8001';
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page, { ...csv, adapter_type: 'web', allowed_datasets: [], allowed_origins: [origin] },
    ['draft', 'approved', 'retired'].map((status, i) => ({
      version: i + 1, profile_version_id: 'f'.repeat(31) + i, config_hash: 'a'.repeat(64),
      approval_status: status, approved_by: i ? 'Fixture operator' : null,
      approved_at: i ? '2026-09-01T16:20:01+08:00' : null,
    })));
  await page.goto('/sources/' + id);
  const table = page.getByRole('table', { name: /Profile versions/ });
  await expect(table.getByRole('row')).toHaveCount(4);
  await expect(table.getByText('Retired')).toBeVisible();
  await expect(table.getByText('Draft')).toBeVisible();
  await expect(table.getByText('Approved', { exact: true })).toBeVisible();
  await expect(table.getByText('08:20:01').first()).toBeVisible();
  await expect(page.getByText(origin, { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /edit|approve/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
});

test('keyboard, required fields, duplicate entries, and invalid controlled origin', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/sources/new');
  await page.getByRole('button', { name: 'Create source' }).press('Enter');
  const alert = page.getByRole('alert');
  await expect(alert).toBeFocused();
  await alert.getByRole('link', { name: 'Source name' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Source name' })).toBeFocused();
  await expect(page.getByText('Enter a permission reference.')).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([]);
  await fillSource(page);
  await page.getByRole('textbox', { name: 'Allowed dataset IDs' }).fill('listings\nlistings');
  await page.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByText('Remove duplicate entries.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Adapter' }).selectOption('web');
  await page.getByRole('textbox', { name: 'Allowed origins' }).fill('https://example.com/path');
  await page.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByText('Use a controlled origin such as', { exact: false })).toBeVisible();
});

test('creates pending Source once and navigates to persisted detail', async ({ page }) => {
  let release!: () => void;
  const complete = new Promise<void>(done => { release = done; });
  const created = { ...csv, approval_status: 'pending' } as const;
  await fixture(page, created);
  let requests = 0;
  await page.route(url => url.pathname === api, async route => {
    requests++;
    expect(route.request().method()).toBe('POST');
    expect(route.request().postDataJSON()).toEqual({
      source_name: csv.source_name, permission_reference: csv.permission_reference,
      adapter_type: 'csv', allowed_datasets: ['listings'], approval_status: 'pending',
      request_key: expect.stringMatching(/^[a-f0-9-]{36}$/),
    });
    await complete;
    await route.fulfill({ status: 201, json: created });
  });
  await page.goto('/sources/new');
  await fillSource(page);
  await page.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByRole('button', { name: 'Create source' })).toBeDisabled();
  await page.evaluate(() => {
    const form = document.querySelector('form')!;
    form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });
  release();
  await expect(page).toHaveURL('/sources/' + id);
  expect(requests).toBe(1);
  await expect(page.getByText('Source registered.', { exact: false })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
});

for (const status of [409, 422, 503]) {
  test(`POST ${status} keeps the operator's inputs`, async ({ page }) => {
    await page.route(url => url.pathname === api, route => route.fulfill({ status, json: {
      error: {
        code: status === 422 ? 'invalid_request' : status === 409 ? 'duplicate_source' : 'database_unavailable',
        message: 'Untrusted text',
        fields: [{ location: ['body', 'allowed_datasets', 0], type: 'string_too_long' }],
      },
    } }));
    await page.goto('/sources/new');
    await fillSource(page);
    await page.getByRole('button', { name: 'Create source' }).click();
    await expect(page.getByRole('alert')).toContainText(status === 422
      ? 'backend rejected' : status === 409 ? 'conflicts' : 'HTTP 503');
    await expect(page.getByRole('textbox', { name: 'Allowed dataset IDs' })).toHaveValue('listings');
    if (status === 422) {
      await expect(page.getByRole('textbox', { name: 'Allowed dataset IDs' })).toHaveAttribute('aria-invalid', 'true');
    }
  });
}

test('a request deadline preserves the policy and offers safe replay', async ({ page }) => {
  await page.route(url => url.pathname === api, () => {
    // Leave the HTTP request open until the browser API client cancels it.
  });
  await page.goto('/sources/new');
  await fillSource(page);
  await page.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByRole('alert')).toContainText('The request timed out.', { timeout: 14_000 });
  await expect(page.getByRole('alert')).toContainText('Submit the same values again');
  await expect(page.getByRole('textbox', { name: 'Allowed dataset IDs' })).toHaveValue('listings');
  await expect(page.getByRole('button', { name: 'Create source' })).toBeEnabled();
});

test('Sources browser link returns to the original array page', async ({ page }) => {
  await fixture(page);
  const rows = Array.from({ length: 20 }, (_, index) => ({
    ...csv, source_id: 'previous-' + index, source_name: 'Previous ' + index,
  })).concat(csv);
  await page.route(url => url.pathname === api, route => route.fulfill({ json: rows }));
  await page.goto('/sources?offset=20');
  await page.getByRole('link', { name: csv.source_name }).click();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Sources' }).click();
  await expect(page).toHaveURL('/sources?offset=20');
  await expect(page.getByRole('link', { name: csv.source_name })).toBeVisible();
});
