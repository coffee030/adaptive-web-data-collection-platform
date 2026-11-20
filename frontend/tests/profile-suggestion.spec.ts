import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import type { SuggestionResult } from '../src/features/profiles/api';
import type { Source } from '../src/features/sources/api';

const origin = 'https://publication.example';
const id = '1'.repeat(32);
const source: Source = {
  source_id: id, source_name: 'Publication archive', adapter_type: 'web',
  permission_reference: 'Test policy', approval_status: 'approved',
  allowed_origins: [origin], allowed_datasets: [],
};
const base = '/sources/' + id;
const endpoint = '**/profile-suggestions';
const complete: SuggestionResult = {
  outcome: 'usable', stage: 'mapping', code: 'sample_mapped', reason: 'One sample mapped.',
  limits: null, reserved_requests: 4, actual_attempts: 4, requests: [], retry_after_seconds: null,
  proposal: {
    search: { origin, path: '/find', keyword_parameter: 'phrase', result_item_selector: '//li',
      detail_link_selector: './a', max_detail_pages: 1, max_requests: 3 },
    record_schema: { schema_version: '1', record_type: 'custom_publication', identity_field: null,
      fields: [{ name: 'title', value_type: 'string', required: true }] },
    item_selector: '//article', listing_sample: 'Reference title',
    fields: [{ name: 'title', sample: 'Reference title', reason: 'The listing text matches the heading.',
      mapping: { name: 'title', selector: './h2', selector_type: null, mode: 'text', attribute: null, resolve_url: false } }],
  },
};

async function open(page: Page) {
  await page.route('**/api/v1' + base, route => route.fulfill({ json: source }));
  await page.goto(base + '/profiles/new');
  await page.getByText('Get a profile suggestion', { exact: true }).press('Enter');
  await page.getByRole('textbox', { name: 'Discovery keyword' }).fill('planning');
  await page.getByRole('textbox', { name: 'Homepage URL' }).fill(origin + '/');
}

test('mock suggestion preserves schema and restores the unsaved draft on undo', async ({ page }) => {
  let requested: unknown;
  await page.route(endpoint, route => {
    requested = route.request().postDataJSON();
    return route.fulfill({ json: complete });
  });
  await open(page);
  const type = page.getByRole('textbox', { name: 'Record type' });
  const item = page.locator('#item-selector');
  await type.fill('custom_publication');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('title');
  await item.fill('article.custom');
  await page.getByRole('button', { name: 'Find suggestion' }).click();
  await expect(page.getByText('Suggestion ready for review')).toBeVisible();
  expect(requested).toMatchObject({ keyword: 'planning', record_schema: complete.proposal?.record_schema });
  await expect(item).toHaveValue('article.custom');
  await page.getByRole('button', { name: 'Apply to editor' }).click();
  await expect(type).toHaveValue('custom_publication');
  await expect(item).toHaveValue('//article');
  await page.getByRole('button', { name: 'Undo suggestion' }).click();
  await expect(item).toHaveValue('article.custom');
  await expect(type).toHaveValue('custom_publication');
});

test('mock slow response cannot overlap a second request and is discarded after input changes', async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route(endpoint, async route => {
    requests += 1;
    await pending;
    await route.fulfill({ json: complete });
  });
  await open(page);
  const send = page.getByRole('button', { name: /Find(ing a)? suggestion/ });
  await send.click();
  await expect(send).toBeDisabled();
  const keyword = page.getByRole('textbox', { name: 'Discovery keyword' });
  await keyword.fill('new planning');
  await keyword.press('Enter');
  await expect(send).toBeDisabled();
  release();
  await expect(send).toBeEnabled();
  expect(requests).toBe(1);
  await expect(page.getByRole('button', { name: 'Apply to editor' })).toHaveCount(0);
});

test('mock budget stop offers examples and has no accessibility violations in dark mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.route(endpoint, route => route.fulfill({ json: {
    ...complete, outcome: 'budget_exhausted', code: 'request_limit_reached', stage: 'entry',
    reason: 'The cap cannot cover this homepage attempt.', actual_attempts: 0,
    proposal: null, reserved_requests: 0,
  } satisfies SuggestionResult }));
  await open(page);
  await page.getByRole('button', { name: 'Find suggestion' }).press('Enter');
  await expect(page.getByText('Discovery budget reached')).toBeVisible();
  const results = await new AxeBuilder({ page }).include('.profile-suggestion').analyze();
  expect(results.violations).toEqual([]);
  await page.getByRole('button', { name: 'Use permitted examples' }).press('Enter');
  await expect(page.getByRole('textbox', { name: 'Representative detail URL' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Discovery keyword' })).toHaveValue('planning');
});
