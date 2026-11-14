import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { Configuration, Profile, Report } from '../src/features/profiles/api';
import type { Source } from '../src/features/sources/api';

export const source: Source = {
  source_id: '1'.repeat(32), source_name: 'Controlled CSV', adapter_type: 'csv',
  permission_reference: 'Fixture', approval_status: 'approved',
  allowed_datasets: ['listings'], allowed_origins: [],
};
export const configuration: Configuration = {
  adapter_type: 'csv', config_schema_version: '1', columns: [{ name: 'title', column: 'Name' }],
  record_schema: { record_type: 'listing', schema_version: '1', identity_field: null,
    fields: [{ name: 'title', value_type: 'string', required: true }] },
};
export const draft: Profile = {
  source_id: source.source_id, profile_version_id: '2'.repeat(32), version: 1,
  revision: 1,
  configuration, config_hash: 'a'.repeat(64), approval_status: 'draft',
  approved_by: null, approved_at: null, validation_report_id: null,
};
export const report: Report = {
  report_id: '3'.repeat(32), profile_version_id: draft.profile_version_id,
  config_hash: draft.config_hash, validated_at: '2026-11-14T08:00:00Z',
  sample_location: 'listings', sample_hash: 'f'.repeat(64), passed: true,
  valid_count: 1, invalid_count: 0, duplicate_count: 0, invalid: [], error: null,
};
const uiSource = '/sources/' + source.source_id;
const uiDraft = uiSource + '/profiles/' + draft.profile_version_id;
const apiSource = '/api/v1' + uiSource;
const apiVersion = apiSource + '/versions/' + draft.profile_version_id;

async function setup(page: Page, currentSource = source, initial = draft) {
  let saved = initial;
  await page.route(url => url.pathname === apiSource, route => route.fulfill({ json: currentSource }));
  await page.route(url => url.pathname === apiSource + '/versions', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: [saved] })
      : route.fulfill({ status: 201, json: saved }));
  await page.route(url => url.pathname === apiVersion, route => {
    if (route.request().method() === 'PUT') {
      const input = route.request().postDataJSON();
      if (input.expected_revision !== saved.revision) {
        return route.fulfill({ status: 409, json: { error: { code: 'draft_revision_conflict' } } });
      }
      saved = { ...saved, configuration: input.configuration, config_hash: 'b'.repeat(64), revision: saved.revision + 1 };
    }
    return route.fulfill({ json: saved });
  });
  return { persist: (value: Profile) => { saved = value; } };
}

async function fillSample(page: Page) {
  await page.getByRole('textbox', { name: 'CSV sample' }).fill('Name\nRiver Walk\n');
}

test('opens history, validates required fields and creates a structured CSV draft', async ({ page }) => {
  await setup(page);
  await page.goto(uiSource);
  await expect(page.getByRole('link', { name: 'Open profile version 1' })).toHaveAttribute('href', uiDraft);
  await page.getByRole('link', { name: 'Create draft', exact: true }).click();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByText('Enter a record type.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Record type' }).fill('listing');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('title');
  await page.getByRole('textbox', { name: 'CSV header' }).fill('Name');
  const post = page.waitForRequest(request => new URL(request.url()).pathname === apiSource + '/versions'
    && request.method() === 'POST');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  expect((await post).postDataJSON()).toEqual({ configuration });
  await expect(page).toHaveURL(uiDraft);
  await expect(page.getByRole('heading', { name: 'Profile version 1' })).toBeVisible();
});

test('HTML editor validates attribute mode and preserves selector overrides', async ({ page }) => {
  const web: Source = { ...source, adapter_type: 'web', allowed_origins: ['http://127.0.0.1:8001'] };
  await setup(page, web);
  await page.goto(uiSource + '/profiles/new');
  await page.getByRole('textbox', { name: 'Record type' }).fill('listing');
  await page.getByRole('combobox', { name: 'Selector type', exact: true }).selectOption('xpath');
  await page.getByRole('textbox', { name: 'Item selector' }).fill('//tr');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('link');
  await page.getByRole('textbox', { name: 'Field selector', exact: true }).fill('a');
  await page.getByRole('combobox', { name: 'Field selector type' }).selectOption('css');
  await page.getByRole('combobox', { name: 'Extraction mode' }).selectOption('attribute');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByText('Enter an attribute name.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Attribute name' }).fill('href');
  await page.getByRole('checkbox', { name: 'Resolve relative URLs' }).check();
  const post = page.waitForRequest(request => request.method() === 'POST');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  expect((await post).postDataJSON().configuration).toMatchObject({
    adapter_type: 'web', selector_type: 'xpath', item_selector: '//tr',
    fields: [{ name: 'link', selector_type: 'css', mode: 'attribute', attribute: 'href', resolve_url: true }],
  });
});

test('preview, validation, unsaved warning and revision invalidation', async ({ page }) => {
  await setup(page);
  await page.route(url => url.pathname === apiVersion + '/preview', route => route.fulfill({ json: [{
    source_position: { kind: 'csv_row', index: 2 }, payload: { title: 'River Walk' }, problems: [],
  }] }));
  await page.route(url => url.pathname === apiVersion + '/validate', route => route.fulfill({ json: report }));
  await page.goto(uiDraft);
  await fillSample(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText('River Walk');
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Record type' }).fill('updated');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Validate sample' })).toBeDisabled();
  const dialog = page.waitForEvent('dialog');
  const leave = page.getByRole('link', { name: 'Source details' }).click();
  const warning = await dialog;
  expect(warning.message()).toContain('Unsaved');
  await warning.dismiss();
  await leave;
  await expect(page).toHaveURL(uiDraft);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('b'.repeat(64))).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toHaveCount(0);
});

test('empty preview, invalid selector response and failing report', async ({ page }) => {
  await setup(page);
  await page.route(url => url.pathname === apiVersion + '/preview', route => route.fulfill({ json: [] }));
  await page.route(url => url.pathname === apiVersion + '/validate', route => route.fulfill({ json: {
    ...report, passed: false, invalid_count: 1, invalid: [{
      source_position: { kind: 'csv_row', index: 2 },
      problems: [{ code: 'wrong_type', field: 'title', message: 'Expected a string' }],
    }],
  } }));
  await page.goto(uiDraft);
  await fillSample(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByText('No candidate records were returned.')).toBeVisible();
  await page.route(url => url.pathname === apiVersion + '/preview', route => route.fulfill({
    status: 400, json: { error: { code: 'invalid_selector' } },
  }));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('selector could not be parsed');
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation failed' })).toBeVisible();
  await expect(page.getByText('Expected a string', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Approve version' })).toHaveCount(0);
});

test('revoked Source cannot check a sample or approve a draft', async ({ page }) => {
  await setup(page, { ...source, approval_status: 'revoked' });
  await page.goto(uiDraft);
  await expect(page.getByText('Sample checks require approved Source access.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Validate sample' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Approve version' })).toHaveCount(0);
});

for (const status of ['approved', 'retired'] as const) {
  test(`${status} versions display immutable configuration and approval metadata`, async ({ page }) => {
    await setup(page, source, { ...draft, approval_status: status, approved_by: 'Demo operator',
      approved_at: report.validated_at, validation_report_id: report.report_id });
    await page.goto(uiDraft);
    await expect(page.getByRole('table', { name: 'Output fields' })).toContainText('Name');
    await expect(page.getByText('Demo operator')).toBeVisible();
    await expect(page.getByText(report.report_id)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
  });
}

test('the local operator must confirm approval and a stale report locks further attempts', async ({ page }) => {
  await setup(page);
  await page.route(url => url.pathname === apiVersion + '/validate', route => route.fulfill({ json: report }));
  await page.route(url => url.pathname === apiVersion + '/approve', route => route.fulfill({
    status: 409, json: { error: { code: 'stale_validation' } },
  }));
  await page.goto(uiDraft);
  await fillSample(page);
  await page.getByRole('button', { name: 'Validate sample' }).click();
  const action = page.getByRole('button', { name: 'Approve version' });
  await expect(action).toBeDisabled();
  await page.getByRole('textbox', { name: 'Approver label' }).fill('Operator');
  await expect(action).toBeDisabled();
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  const request = page.waitForRequest(value => value.url().endsWith('/approve'));
  await action.click();
  expect((await request).postDataJSON()).toEqual({
    approver: 'Operator', report_id: report.report_id, config_hash: report.config_hash,
  });
  await expect(page.getByRole('alert')).toContainText('out of date');
  await expect(action).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reload server version' })).toBeVisible();
});

test('a concurrent configuration change blocks PUT and preserves edits', async ({ page }) => {
  const { persist } = await setup(page);
  await page.goto(uiDraft);
  await page.getByRole('textbox', { name: 'Record type' }).fill('my change');
  persist({ ...draft, config_hash: 'c'.repeat(64), revision: 2 });
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByRole('alert')).toContainText('Another edit was saved first');
  await expect(page.getByRole('textbox', { name: 'Record type' })).toHaveValue('my change');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
});

for (const status of [404, 503]) {
  test(`profile GET ${status} renders the appropriate recovery`, async ({ page }) => {
    await setup(page);
    await page.route(url => url.pathname === apiVersion, route => route.fulfill({
      status, json: { error: { code: status === 404 ? 'profile_not_found' : 'database_unavailable' } },
    }));
    await page.goto(uiDraft);
    await expect(page.getByRole('alert')).toContainText(status === 404 ? 'not found' : 'Backend unavailable');
  });
}

test('422 update preserves fields and the mobile editor works with keyboard and axe', async ({ page }) => {
  await setup(page);
  await page.route(url => url.pathname === apiVersion, route => route.request().method() === 'PUT'
    ? route.fulfill({ status: 422, json: { error: { code: 'invalid_request' } } })
    : route.fallback());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(uiDraft);
  await page.getByRole('textbox', { name: 'Record type' }).fill('rejected value');
  await page.getByRole('button', { name: 'Save draft' }).press('Enter');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('server rejected');
  await expect(page.getByRole('textbox', { name: 'Record type' })).toHaveValue('rejected value');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  expect((await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()).violations).toEqual([]);
});

test('a Preview timeout leaves the configuration and sample available', async ({ page }) => {
  await setup(page);
  await page.route(url => url.pathname === apiVersion + '/preview', () => {});
  await page.goto(uiDraft);
  await fillSample(page);
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('timed out', { timeout: 14_000 });
  await expect(page.getByRole('textbox', { name: 'CSV sample' })).toHaveValue('Name\nRiver Walk\n');
});
