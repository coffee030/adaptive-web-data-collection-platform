import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Profile, Report } from '../src/features/profiles/api';
import type { CollectionRequest, Observation, VersionInfo } from '../src/features/topic-collections/api';

const root = '/api/v1';
const origin = 'http://collection-fixture:8001';

async function post<T>(request: APIRequestContext, path: string, data: object, status = 201, origin?: string): Promise<T> {
  const response = await request.post(root + path, { data, headers: origin ? { Origin: origin } : undefined });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function register(request: APIRequestContext, fixture: 'cards' | 'catalog', suffix: string) {
  const name = `M8 ${fixture} ${suffix}`;
  const source = await post<{ source_id: string }>(request, '/sources', {
    source_name: name, adapter_type: 'web', approval_status: 'approved', permission_reference: 'M8 fixture',
    allowed_origins: [origin], allowed_paths: { [origin]: ['/m7/' + fixture] },
  });
  return { name, id: source.source_id };
}

async function access(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(result.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
}

test('M8 operator catalog and multi-source collection trace history and manual refresh', async ({ page, request, baseURL }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const cards = await register(request, 'cards', suffix);
  const catalog = await register(request, 'catalog', suffix);
  const categoryName = `Test category ${suffix}`;
  const topicName = `Test topic ${suffix}`;

  await page.goto(`/sources/${cards.id}/profiles/new`);
  await page.getByRole('textbox', { name: 'Record type' }).fill('article_fixture');
  await page.getByRole('combobox', { name: 'Collection mode' }).selectOption('search');
  await page.getByRole('textbox', { name: 'Search path' }).fill('/m7/cards/search');
  await page.getByRole('textbox', { name: 'Search result item selector' }).fill('li.result');
  await page.getByRole('textbox', { name: 'Detail link selector' }).fill('a.item');
  await page.getByRole('textbox', { name: 'Detail item selector' }).fill('article');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('headline');
  await page.getByRole('textbox', { name: 'Field selector', exact: true }).fill('h2');
  await page.getByRole('checkbox', { name: 'Store article history' }).check();
  await page.getByRole('combobox', { name: 'Article title' }).selectOption('0');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await page.getByRole('textbox', { name: 'Sample keyword' }).fill('quick');
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('textbox', { name: 'Approver label' }).fill('M8 profile operator');
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();

  const version = await post<Profile>(request, `/sources/${catalog.id}/versions`, {
    configuration: {
      adapter_type: 'web', config_schema_version: '1', selector_type: 'xpath', item_selector: '//main/dl',
      fields: [{ name: 'headline', selector: './dt' }],
      record_schema: { record_type: 'article_fixture', schema_version: '1', fields: [{ name: 'headline' }] },
      search: {
        origin, path: '/m7/catalog/search', keyword_parameter: 'term',
        result_item_selector: '//tbody/tr', detail_link_selector: './td/a',
      },
      article: { title: 'headline' },
    },
  });
  const versionPath = `/sources/${catalog.id}/versions/${version.profile_version_id}`;
  const report = await post<Report>(request, versionPath + '/validate', { adapter_type: 'web', keyword: 'quick' }, 200);
  expect(report.passed).toBe(true);
  await post(request, versionPath + '/approve', {
    approver: 'M8 profile operator', report_id: report.report_id, config_hash: version.config_hash,
  }, 200, baseURL);

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Sources', exact: true }).click();
  await page.getByRole('link', { name: 'Categories and topics' }).click();
  await page.getByRole('textbox', { name: 'Category name' }).fill(categoryName);
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByText('Category created.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Parent category' }).selectOption({ label: categoryName });
  await page.getByRole('textbox', { name: 'Topic name' }).fill(topicName);
  await page.getByRole('button', { name: 'Create topic' }).click();
  await expect(page.getByText('Topic created.')).toBeVisible();
  await access(page);
  await page.screenshot({ path: test.info().outputPath('catalog-light.png'), fullPage: true });
  await page.getByRole('link', { name: 'Manage approved bindings' }).click();
  await page.getByRole('textbox', { name: 'Operator name' }).fill('M8 topic operator');
  for (const source of [cards, catalog]) {
    await page.getByRole('combobox', { name: 'Authorized source' }).selectOption({ value: source.id });
    await page.getByRole('combobox', { name: 'Approved keyword profile' }).selectOption({ label: 'Version 1' });
    await page.getByRole('button', { name: 'Approve binding', exact: true }).click();
    await expect(page.getByRole('link', { name: `${source.name} · Version 1` })).toBeVisible();
  }

  await page.getByRole('link', { name: 'New Collection', exact: true }).click();
  await page.getByRole('link', { name: 'Collect by topic', exact: true }).click();
  await page.getByRole('combobox', { name: 'Topic', exact: true }).selectOption({ label: `${categoryName} / ${topicName}` });
  await page.getByRole('textbox', { name: 'Keyword', exact: true }).fill('quick');
  for (const source of [cards, catalog]) {
    await page.getByRole('checkbox', { name: `${source.name} · Version 1` }).check();
  }
  const created = page.waitForResponse(reply => reply.request().method() === 'POST' &&
    new URL(reply.url()).pathname === root + '/collection-requests');
  await page.getByRole('button', { name: 'Start topic collection' }).click();
  const initialReply = await created;
  expect(initialReply.status()).toBe(201);
  const initial: CollectionRequest = await initialReply.json();
  expect(initial.jobs).toHaveLength(2);
  await expect(page.getByRole('heading', { name: `${topicName} · quick` })).toBeVisible();
  const jobTable = page.getByRole('table').filter({ hasText: cards.name }).first();
  await expect(jobTable.getByText('Succeeded', { exact: true })).toHaveCount(2, { timeout: 65_000 });

  const refresh = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/refresh'));
  await page.getByRole('button', { name: 'Refresh collection' }).click();
  const refreshReply = await refresh;
  expect(refreshReply.status()).toBe(201);
  const second: CollectionRequest = await refreshReply.json();
  expect(second.refresh_of).toBe(initial.id);
  expect(second.jobs.map(item => item.job.profile_version_id)).toEqual(initial.jobs.map(item => item.job.profile_version_id));
  await expect(page.getByRole('link', { name: 'View previous run' })).toHaveAttribute('href', `/collection-requests/${initial.id}`);
  await expect(jobTable.getByText('Succeeded', { exact: true })).toHaveCount(2, { timeout: 65_000 });

  const articles = page.getByRole('region', { name: 'Articles observed by this request' });
  const articleRow = articles.getByRole('row').filter({ hasText: cards.name });
  await articleRow.getByRole('link', { name: 'Alpha' }).click();
  await expect(page.getByRole('heading', { name: 'Latest content' })).toBeVisible();
  const articlePath = new URL(page.url()).pathname;
  const versions: VersionInfo[] = await (await request.get(`${root}${articlePath}/versions`)).json();
  const observations: Observation[] = await (await request.get(`${root}${articlePath}/observations`)).json();
  expect(versions).toHaveLength(1);
  expect(observations).toHaveLength(2);
  expect(observations.map(item => item.content_version_id)).toEqual([versions[0]!.id, versions[0]!.id]);
  expect(new Set(observations.map(item => item.evidence_id)).size).toBe(2);
  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 · Alpha' })).toBeVisible();
  await page.getByRole('button', { name: 'View extracted payload for observation 1 on this page' }).click();
  await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).toContainText('"headline": "Alpha"');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await access(page);
  await page.screenshot({ path: test.info().outputPath('article-dark.png'), fullPage: true });
  await page.getByRole('region', { name: 'Latest content' }).getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Evidence Metadata' })).toBeVisible();
  await expect(page.getByText('Detail page', { exact: true })).toBeVisible();
  console.log(`M8 requests ${initial.id} → ${second.id}, article ${articlePath}, evidence ${observations[0]!.evidence_id}`);
});
