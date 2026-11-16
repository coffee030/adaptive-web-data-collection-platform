import AxeBuilder from '@axe-core/playwright';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Profile, Report } from '../src/features/profiles/api';
import type { GenericRecord } from '../src/features/results/api';
import type { Source } from '../src/features/sources/api';
import type { ArticleSummary, CollectionRequest, Observation, VersionInfo } from '../src/features/topic-collections/api';

const root = '/api/v1';
const origin = 'http://collection-fixture:8001';

async function post<T>(request: APIRequestContext, path: string, data: object, status = 201, origin?: string): Promise<T> {
  const response = await request.post(root + path, { data, headers: origin ? { Origin: origin } : undefined });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function register(page: Page, fixture: 'cards' | 'catalog', suffix: string) {
  const name = `Topic fixture ${fixture} ${suffix}`;
  await page.goto('/sources/new');
  await page.getByRole('textbox', { name: 'Source name' }).fill(name);
  await page.getByRole('combobox', { name: 'Adapter' }).selectOption('web');
  await page.getByRole('textbox', { name: 'Permission reference' }).fill('Isolated keyword search fixture');
  await page.getByRole('textbox', { name: 'Allowed origins' }).fill(origin);
  await page.getByRole('textbox', { name: /Allowed path prefixes/ }).fill(`${origin}/m7/${fixture}`);
  const posted = page.waitForResponse(reply =>
    reply.request().method() === 'POST' && new URL(reply.url()).pathname === root + '/sources');
  await page.getByRole('button', { name: 'Create source' }).click();
  const reply = await posted;
  expect(reply.status()).toBe(201);
  const source: Source = await reply.json();
  expect(source.approval_status).toBe('pending');
  await page.getByRole('button', { name: 'Authorize Source access' }).click();
  await expect(page.getByRole('button', { name: 'Revoke Source access' })).toBeVisible();
  return { name, id: source.source_id };
}

async function checkLayout(page: Page, checkAxe: boolean) {
  if (checkAxe) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
  expect(await page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement;
    return scrollWidth - clientWidth;
  })).toBe(0);
}

async function persistedRecords(request: APIRequestContext, jobIds: string[]) {
  const records: GenericRecord[] = [];
  for (const jobId of jobIds) {
    for (let offset = 0; ; offset++) {
      const reply = await request.get(root + '/records', { params: { job_id: jobId, limit: 1, offset } });
      expect(reply.ok()).toBe(true);
      const rows: GenericRecord[] = await reply.json();
      if (!rows.length) break;
      records.push(rows[0]!);
    }
  }
  return records.sort((first, second) =>
    Date.parse(first.created_at) - Date.parse(second.created_at) || first.record_id.localeCompare(second.record_id));
}

async function checkDownloads(page: Page, expected: GenericRecord[], filenamePrefix: string) {
  for (const format of ['csv', 'json'] as const) {
    const received = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download ' + format.toUpperCase() }).click();
    const download = await received;
    const filename = filenamePrefix + '-records.' + format;
    expect(download.suggestedFilename()).toBe(filename);
    const file = test.info().outputPath(filename);
    await download.saveAs(file);
    if (format === 'json') {
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual(expected);
    } else {
      const parsed = execFileSync(process.env.M9_TEST_PYTHON || 'python', [
        '-X', 'utf8', '-c',
        'import csv, json, sys; f = open(sys.argv[1], encoding="utf-8", newline=""); print(json.dumps(list(csv.DictReader(f))))',
        file,
      ], { encoding: 'utf8' });
      const rows = JSON.parse(parsed) as Record<string, string>[];
      expect(rows).toHaveLength(expected.length);
      for (const [index, record] of expected.entries()) {
        const row = rows[index]!;
        expect(Object.keys(row).sort()).toEqual(Object.keys(record).sort());
        for (const [key, value] of Object.entries(record)) {
          if (value !== null && typeof value === 'object') {
            expect(JSON.parse(row[key]!)).toEqual(value);
          } else {
            expect(row[key]).toBe(value === null ? '' : String(value));
          }
        }
      }
    }
  }
}

test('the launcher dashboard displays the three seeded Demo requests and downloads their records', async ({ page }) => {
  const demoUrl = process.env.M10_SYNTHETIC_URL;
  test.skip(!demoUrl, 'Set M10_SYNTHETIC_URL to the running Synthetic Demo launcher Dashboard.');
  const api = page.request;
  await page.goto(demoUrl!);
  await expect(page.getByText('Synthetic Demo.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'View collection requests', exact: true }).click();
  const historyURL = page.url();
  const presets = [
    ['Fixture Listings · quick', 2, 'SYNTHETIC FIXTURE DATA'],
    ['Influencer Advertising and Sponsorship · partnership', 8, 'SYNTHETIC FIXTURE DATA'],
    ['Market News and Economic Updates · market', 8, 'SIMULATED DATA — NOT LIVE MARKET PRICES'],
  ] as const;

  for (const [label, count, dataset] of presets) {
    await page.goto(historyURL);
    await page.getByRole('link', { name: label, exact: true }).last().click();
    await expect(page.getByRole('heading', { name: label })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Source jobs' }).getByText('Succeeded', { exact: true })).toHaveCount(2);
    const id = new URL(page.url()).pathname.split('/').at(-1);
    const response = await api.get(new URL(`${root}/records?request_id=${id}`, demoUrl!).href);
    expect(response.ok()).toBe(true);
    const rows: GenericRecord[] = await response.json();
    expect(rows).toHaveLength(count);
    for (const row of rows) {
      expect(row.payload.dataset).toBe(dataset);
      if (dataset.startsWith('SIMULATED')) expect(typeof row.payload.price).toBe('number');
    }
    await checkDownloads(page, rows, 'request-' + id);
    await page.getByRole('link', { name: 'View request records' }).click();
    await expect(page.getByRole('heading', { name: 'Data Explorer' })).toBeVisible();
    if (dataset.startsWith('SIMULATED')) await expect(page.locator('.ledger-warning')).toHaveText(dataset);
  }
  await page.screenshot({ path: test.info().outputPath('demo-financial-records.png'), fullPage: true });
});

test('operator configures two sources, traces collection history and downloads persisted records', async ({ page, request, baseURL, browserName }) => {
  test.setTimeout(180_000);
  // Keep the interaction and layout checks independent of the axe runtime.
  const checkAxe = browserName === 'chromium';
  const suffix = randomUUID().slice(0, 8);
  const cards = await register(page, 'cards', suffix);
  const catalog = await register(page, 'catalog', suffix);
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
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText('Alpha', { timeout: 15_000 });
  await page.getByRole('button', { name: 'Validate sample' }).click();
  await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('textbox', { name: 'Approver label' }).fill('M8 profile operator');
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  await page.getByRole('button', { name: 'Approve version' }).click();
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();

  const version = await post<Profile>(request, `/sources/${catalog.id}/versions`, {
    configuration: {
      adapter_type: 'web', config_schema_version: '1', selector_type: 'xpath', item_selector: '//main/dl',
      fields: [{ name: 'headline', selector: './dt' }, { name: 'count', selector: './dd' }],
      record_schema: { record_type: 'catalog_fixture', schema_version: '1',
        fields: [{ name: 'headline' }, { name: 'count', value_type: 'integer' }] },
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
  await checkLayout(page, checkAxe);
  await page.screenshot({ path: test.info().outputPath('catalog-light.png'), fullPage: true });
  await page.getByRole('link', { name: 'Manage approved bindings' }).click();
  await page.getByRole('textbox', { name: 'Operator name' }).fill('M8 topic operator');
  for (const source of [cards, catalog]) {
    await page.getByRole('combobox', { name: 'Authorized source' }).selectOption({ value: source.id });
    await page.getByRole('combobox', { name: 'Approved keyword profile' }).selectOption({ label: 'Version 1' });
    await page.getByRole('button', { name: 'Approve binding', exact: true }).click();
    await expect(page.getByRole('link', { name: `${source.name} · Version 1` })).toBeVisible();
  }

  async function prepareCollection(keyword: string) {
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'New Collection' }).click();
    await page.getByRole('button', { name: categoryName, exact: true }).click();
    await page.getByRole('button', { name: topicName, exact: true }).click();
    for (const source of [cards, catalog]) {
      await page.getByRole('checkbox', { name: `${source.name} Approved profile · Version 1` }).check();
    }
    await page.getByRole('textbox', { name: 'Keyword', exact: true }).fill(keyword);
    await page.getByRole('button', { name: 'Review collection' }).click();
  }
  async function submitCollection() {
    const created = page.waitForResponse(reply => reply.request().method() === 'POST' &&
      new URL(reply.url()).pathname === root + '/collection-requests');
    await page.getByRole('button', { name: 'Start topic collection' }).press('Enter');
    const reply = await created;
    expect(reply.status()).toBe(201);
    return await reply.json() as CollectionRequest;
  }
  await page.goto('/');
  await prepareCollection('quick');
  await checkLayout(page, checkAxe);
  const initial = await submitCollection();
  expect(initial.jobs).toHaveLength(2);
  await expect(page.getByRole('heading', { name: `${topicName} · quick` })).toBeVisible();
  const jobs = page.getByRole('list', { name: 'Source jobs' });
  await expect(jobs.getByText('Succeeded', { exact: true })).toHaveCount(2, { timeout: 65_000 });
  expect((await (await request.get(`${root}/collection-requests/${initial.id}`)).json()).status).toBe('succeeded');
  const initialArticles: ArticleSummary[] = await (await request.get(`${root}/articles?request_id=${initial.id}`)).json();
  await expect(page.getByText('2 source jobs', { exact: false })).toBeVisible();
  await page.setViewportSize({ width: 768, height: 900 });
  await checkLayout(page, checkAxe);
  await page.screenshot({ path: test.info().outputPath('request-tablet.png'), fullPage: true });
  await page.getByRole('link', { name: 'View request records' }).click();
  await expect(page.getByText('Records from this Collection Request')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Inspect Alpha', exact: true })).toHaveCount(2);
  await page.getByRole('button', { name: 'Inspect Alpha', exact: true }).first().click();
  await expect(page.getByRole('link', { name: 'Article history' })).toBeVisible();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(new RegExp(`request_id=${initial.id}`));
  await page.getByRole('link', { name: 'Browse articles' }).click();
  await expect(page.getByRole('heading', { name: 'Articles observed in this run' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link', { name: 'Collection request' }).click();

  const refresh = page.waitForResponse(reply => reply.request().method() === 'POST' && reply.url().endsWith('/refresh'));
  await page.getByRole('button', { name: 'Refresh collection' }).click();
  const refreshReply = await refresh;
  expect(refreshReply.status()).toBe(201);
  const second: CollectionRequest = await refreshReply.json();
  expect(second.refresh_of).toBe(initial.id);
  expect(second.jobs.map(item => item.job.profile_version_id)).toEqual(initial.jobs.map(item => item.job.profile_version_id));
  await expect(page.getByRole('link', { name: 'View previous run' })).toHaveAttribute('href', `/collection-requests/${initial.id}`);
  await expect(jobs.getByText('Succeeded', { exact: true })).toHaveCount(2, { timeout: 65_000 });

  await page.getByRole('link', { name: 'View previous run' }).click();
  const refreshedArticles: ArticleSummary[] = await (await request.get(`${root}/articles?request_id=${second.id}`)).json();
  const initialArticle = initialArticles.find(item => item.source_name === cards.name)!;
  const refreshedArticle = refreshedArticles.find(item => item.id === initialArticle.id)!;
  expect(Date.parse(refreshedArticle.captured_at)).toBeGreaterThan(Date.parse(initialArticle.captured_at));
  const articles = page.getByRole('region', { name: 'Articles observed by this request' });
  await expect(articles).toContainText('show the latest capture across all collections');
  const articleRow = articles.getByRole('row').filter({ hasText: cards.name });
  await expect(articleRow.locator('time')).toHaveAttribute('datetime', refreshedArticle.captured_at);
  await articleRow.getByRole('link', { name: 'Alpha' }).click();
  await expect(page.getByText('Latest content across all collections', { exact: true })).toBeVisible();
  const articlePath = new URL(page.url()).pathname;
  const versions: VersionInfo[] = await (await request.get(`${root}${articlePath}/versions`)).json();
  const observations: Observation[] = await (await request.get(`${root}${articlePath}/observations`)).json();
  expect(versions).toHaveLength(1);
  expect(observations).toHaveLength(2);
  expect(observations.map(item => item.content_version_id)).toEqual([versions[0]!.id, versions[0]!.id]);
  expect(new Set(observations.map(item => item.evidence_id)).size).toBe(2);
  const selectedObservation = observations.find(item => item.request_id === initial.id)!;
  const history = page.getByRole('region', { name: 'Observation history', exact: true }).first();
  await expect(history.getByRole('list', { name: 'Observation list' }).getByRole('link', { name: 'Record', exact: true }))
    .toHaveAttribute('href', new RegExp('/records/' + selectedObservation.record_id));
  await page.getByRole('button', { name: 'View version 1' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 · Alpha' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect observation' }).click();
  await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).toContainText('"headline": "Alpha"');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await checkLayout(page, checkAxe);
  await page.screenshot({ path: test.info().outputPath('article-dark.png'), fullPage: true });
  await history.locator('#selected-article-record').click();
  await expect(page.getByRole('heading', { name: 'Record Details' })).toBeVisible();
  await page.getByRole('link', { name: 'Open evidence ' + selectedObservation.evidence_id }).click();
  await expect(page).toHaveURL(new RegExp('/evidence/' + selectedObservation.evidence_id));
  await expect(page.getByRole('heading', { name: 'Evidence Metadata' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Detail page', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Record Details' }).click();
  await page.getByRole('link', { name: 'Back to Article History' }).click();
  await expect(page).toHaveURL(new RegExp('observation_id=' + selectedObservation.record_id));
  await expect(page.getByRole('heading', { name: 'Version 1 · Alpha' })).toBeVisible();
  await expect(page.locator('#selected-article-record')).toBeFocused();

  const jobIds = initial.jobs.map(item => item.job.job_id);
  const persisted = await persistedRecords(request, jobIds);
  expect(persisted).toHaveLength(2);
  expect(persisted.map(row => Object.keys(row.payload).sort())).toEqual(expect.arrayContaining([['headline'], ['count', 'headline']]));
  await page.goto('/collection-requests/' + initial.id);
  await checkLayout(page, checkAxe);
  await checkDownloads(page, persisted, 'request-' + initial.id);
  const cardsJob = initial.jobs.find(item => item.source_name === cards.name)!.job;
  const cardsJobDetails = jobs.getByRole('listitem').filter({ hasText: cards.name });
  await cardsJobDetails.getByRole('link', { name: 'Evidence', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Capture evidence' })).toBeFocused();
  await expect(page.getByRole('region', { name: 'Capture evidence' }).getByRole('link')).not.toHaveCount(0);
  await checkDownloads(page, persisted.filter(row => row.job_id === cardsJob.job_id), 'job-' + cardsJob.job_id);
  await page.getByRole('link', { name: 'Collection request', exact: true }).click();

  await prepareCollection('detail404');
  const partial = await submitCollection();
  await expect(page.getByText('Some jobs did not complete successfully.', { exact: false })).toBeVisible({ timeout: 65_000 });
  await expect(jobs.getByText('HTTP 404', { exact: true })).toHaveCount(2);
  await expect(jobs.getByText('Partial', { exact: true })).toHaveCount(2);
  expect((await (await request.get(`${root}/collection-requests/${partial.id}`)).json()).status).toBe('partial');
  await checkLayout(page, checkAxe);
  const partialRecords = await persistedRecords(request, partial.jobs.map(item => item.job.job_id));
  expect(partialRecords).toHaveLength(2);
  await checkDownloads(page, partialRecords, 'request-' + partial.id);
  await page.screenshot({ path: test.info().outputPath('partial-mobile.png'), fullPage: true });
  await page.getByRole('link', { name: 'View request records' }).click();
  await expect(page.getByRole('list', { name: 'Persisted generic records' }).getByRole('listitem')).toHaveCount(2);
  await expect(page.getByRole('link', { name: 'Review child job outcomes' })).toHaveAttribute('href', '/collection-requests/' + partial.id);
  await page.goto('/articles');
  await expect(page.getByRole('heading', { name: 'Articles', exact: true })).toBeVisible();
  await expect(page.locator(`a[href^="${articlePath}?"]`)).toBeVisible();
  await page.goto('/collection-requests');
  await expect(page.getByRole('heading', { name: 'Collection requests' })).toBeVisible();
  await expect(page.locator(`a[href="/collection-requests/${second.id}"]`)).toBeVisible();
  console.log(`M9 requests ${initial.id} → ${second.id}, controlled partial ${partial.id}, article ${articlePath}, evidence ${selectedObservation.evidence_id}, exported ${persisted.length} records`);
});

test('M12 shows setup in an isolated empty Normal database', async ({ page, request }) => {
  test.skip(process.env.M12_EMPTY_NORMAL !== '1', 'Run against a freshly migrated isolated Normal database.');
  for (const endpoint of ['categories', 'topics', 'sources', 'collection-requests', 'collection-jobs', 'records', 'articles']) {
    const response = await request.get(`${root}/${endpoint}`);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/collection-requests/new');
  await expect(page.getByText('No active categories', { exact: true })).toBeVisible();
  await expect(page.getByText('Synthetic Demo.', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await checkLayout(page, true);
  await page.screenshot({ path: test.info().outputPath('normal-empty.png'), fullPage: true });
  await page.getByRole('link', { name: 'Manage categories and topics' }).click();
  await expect(page.getByRole('heading', { name: 'Categories and topics' })).toBeVisible();
});

test('M12 collects all three existing Synthetic Demo presets and replays a committed request', async ({ page }) => {
  const demoUrl = process.env.M10_SYNTHETIC_URL;
  test.skip(!demoUrl, 'Set M10_SYNTHETIC_URL to an isolated Synthetic Demo Dashboard.');
  test.setTimeout(240_000);
  const api = page.request;
  const presets = [
    ['Core Demonstration', 'Fixture Listings', 'quick', ['Demo Cards', 'Demo Catalog'], 2, 'SYNTHETIC FIXTURE DATA'],
    ['Marketing Intelligence', 'Influencer Advertising and Sponsorship', 'partnership',
      ['Creator Brief (Synthetic)', 'Disclosure Desk (Synthetic)'], 8, 'SYNTHETIC FIXTURE DATA'],
    ['Financial Markets', 'Market News and Economic Updates', 'market',
      ['Market Wire (Simulated)', 'Economic Ledger (Simulated)'], 8, 'SIMULATED DATA — NOT LIVE MARKET PRICES'],
    ['Core Demonstration', 'Fixture Listings', 'detail404', ['Demo Cards', 'Demo Catalog'], 2, 'SYNTHETIC FIXTURE DATA'],
  ] as const;

  async function configure(preset: typeof presets[number]) {
    const [group, topic, keyword, sources] = preset;
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'New Collection' }).click();
    await page.getByRole('button', { name: group, exact: true }).click();
    await expect(page.getByRole('button', { name: topic, exact: true })).toBeVisible();
    if (keyword === 'quick') await page.screenshot({ path: test.info().outputPath('topic-browser.png'), fullPage: true });
    await page.getByRole('button', { name: topic, exact: true }).click();
    await expect(page.getByText('0 of 4 selected')).toBeVisible();
    for (const name of sources) {
      const checkbox = page.getByRole('checkbox', { name: name + ' Approved profile · Version 1', exact: true });
      await expect(checkbox).not.toBeChecked();
      await checkbox.check();
      if (keyword === 'quick' && name === sources[0]) {
        await page.screenshot({ path: test.info().outputPath('approved-sources.png'), fullPage: true });
      }
    }
    await page.getByRole('textbox', { name: 'Keyword', exact: true }).fill(keyword);
    await page.getByRole('button', { name: 'Review collection' }).click();
    const review = page.getByRole('region', { name: 'Review collection' });
    for (const item of [group, topic, keyword, ...sources, '2 jobs will search']) await expect(review).toContainText(item);
    await checkLayout(page, true);
    if (keyword === 'quick' || keyword === 'market') await page.screenshot({
      path: test.info().outputPath(keyword === 'quick' ? 'review-desktop.png' : 'review-mobile-dark.png'), fullPage: true,
    });
  }

  await page.setViewportSize({ width: 1440, height: 920 });
  await page.goto(demoUrl!);
  await expect(page.getByText('Synthetic Demo.', { exact: true })).toBeVisible();

  for (const preset of presets) {
    const [, topic, keyword, sources, expected, dataset] = preset;
    if (keyword === 'market') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('combobox', { name: 'Theme' }).selectOption('dark');
    }
    await configure(preset);
    const createdPath = '/api/v1/collection-requests';
    let lost: CollectionRequest | undefined;
    let original: unknown;
    if (keyword === 'quick') {
      await page.route('**' + createdPath, async route => {
        original = route.request().postDataJSON();
        const committed = await route.fetch();
        expect(committed.status()).toBe(201);
        lost = await committed.json() as CollectionRequest;
        await route.abort('failed');
      }, { times: 1 });
    }

    const posted = (status: number) => page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === createdPath && response.status() === status);
    if (keyword !== 'quick') {
      const created = posted(201);
      await page.getByRole('button', { name: 'Start topic collection' }).click();
      await created;
    } else {
      await page.getByRole('button', { name: 'Start topic collection' }).click();
      await expect(page.getByRole('heading', { name: 'Confirm your submission' })).toBeVisible();
      const replayed = posted(200);
      await page.getByRole('button', { name: 'Retry submission' }).click();
      const reply = await replayed;
      expect(reply.request().postDataJSON()).toEqual(original);
      expect((await reply.json()).id).toBe(lost?.id);
    }

    const outcome = keyword === 'detail404' ? 'Partial' : 'Succeeded';
    await expect(page.getByRole('heading', { name: topic + ' · ' + keyword })).toBeVisible();
    await expect(page.getByText('Collection request submitted. Follow the source jobs below.')).toBeVisible();
    const jobs = page.getByRole('list', { name: 'Source jobs' });
    await expect(jobs.getByText(outcome, { exact: true })).toHaveCount(2, { timeout: 70_000 });
    const id = new URL(page.url()).pathname.split('/').at(-1)!;
    const saved = await api.get(new URL(createdPath + '/' + id, demoUrl!).href);
    expect(saved.ok()).toBe(true);
    const run: CollectionRequest = await saved.json();
    expect(run.jobs.map(job => job.source_name).sort()).toEqual([...sources].sort());
    expect(run.jobs.map(job => job.profile_version)).toEqual([1, 1]);
    expect(run.status).toBe(outcome.toLowerCase());
    const response = await api.get(new URL(`${root}/records?request_id=${id}`, demoUrl!).href);
    expect(response.ok()).toBe(true);
    const records: GenericRecord[] = await response.json();
    expect(records).toHaveLength(expected);
    expect(new Set(records.map(record => record.payload.dataset))).toEqual(new Set([dataset]));
    expect(run.jobs.every(({ job }) => records.some(record => record.job_id === job.job_id))).toBe(true);
    await expect(page.getByText(`${expected} validated records available.`, { exact: false })).toBeVisible();
    if (keyword === 'quick' || keyword === 'detail404') {
      await page.screenshot({
        path: test.info().outputPath(keyword === 'quick' ? 'request-succeeded.png' : 'request-partial.png'), fullPage: true,
      });
      const job = jobs.getByRole('link', { name: 'Evidence', exact: true }).first();
      await job.click();
      await expect(page.getByRole('heading', { name: 'Capture evidence' })).toBeFocused();
      await expect(page.getByRole('region', { name: 'Capture evidence' }).getByRole('link')).not.toHaveCount(0);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp('/collection-requests/' + id + '$'));
    }
    if (keyword === 'market') {
      await page.getByRole('link', { name: 'View request records' }).click();
      await expect(page.getByText(dataset, { exact: true })).toBeVisible();
    }
    console.log(`M12 ${topic} · ${keyword}: ${id}, ${outcome}, ${run.jobs.length} jobs, ${records.length} persisted records`);
  }
});
