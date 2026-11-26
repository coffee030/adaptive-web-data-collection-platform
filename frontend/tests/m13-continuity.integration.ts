import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import type { Profile, Report } from '../src/features/profiles/api';
import type { EvidenceMetadata, GenericRecord, RecordDetails } from '../src/features/results/api';
import type { ArticleDetail, ArticleSummary, Binding, Category, CollectionRequest, Observation, Topic } from '../src/features/topic-collections/api';

const url = process.env.M13_QA_DEMO_URL;
const fixture = process.env.M13_QA_FIXTURE;
test.skip(!url || !fixture, 'Set M13_QA_DEMO_URL and M13_QA_FIXTURE for a dedicated Synthetic Demo database.');

function endpoint(path: string) {
  const base = new URL(url!);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1'
    || !/^collection-m3-test-m10-m13-[a-z0-9-]+-collection-fixture-1$/.test(fixture!)) {
    throw new Error('Select a dedicated M13 loopback Demo environment and fixture.');
  }
  return base.origin + '/api/v1' + path;
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(endpoint(path));
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function post<T>(request: APIRequestContext, path: string, data: object, status = 201): Promise<T> {
  const response = await request.post(endpoint(path), { data, headers: { Origin: new URL(url!).origin } });
  expect(response.status(), await response.text()).toBe(status);
  return response.json();
}

async function markets(request: APIRequestContext) {
  const requests = await get<CollectionRequest[]>(request, '/collection-requests?limit=100');
  const baseline = [...requests].reverse().find(row => row.topic_name === 'Market News and Economic Updates' && !row.refresh_of);
  expect(baseline?.jobs).toHaveLength(2);
  return baseline!;
}

const list = (page: Page) => page.getByRole('list', { name: 'Persisted generic records' });
const trigger = (page: Page, recordId: string) => list(page).locator('#inspect-record-' + recordId);
const ledgerIds = (page: Page) => list(page).getByRole('button').evaluateAll(buttons =>
  buttons.map(button => button.id.replace('inspect-record-', '')));

test('real Request page 2 and Job scope agree with Postgres records and Evidence', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await markets(request);
  const suffix = randomUUID().slice(0, 8);
  const original = baseline.jobs[0]!.job;
  const profilePath = '/sources/' + original.source_id + '/versions';
  const profile = await get<Profile>(request, profilePath + '/' + original.profile_version_id);
  const cloned = await post<Profile>(request, profilePath, { configuration: {
    ...profile.configuration,
    record_schema: { ...profile.configuration.record_schema, record_type: 'qa_market_' + suffix },
  } });
  const clonePath = profilePath + '/' + cloned.profile_version_id;
  const report = await post<Report>(request, clonePath + '/validate', { adapter_type: 'web', keyword: 'market' }, 200);
  expect(report.passed).toBe(true);
  await post(request, clonePath + '/approve', {
    approver: 'M13 isolated fixture', report_id: report.report_id, config_hash: cloned.config_hash,
  }, 200);
  const category = await post<Category>(request, '/categories', { name: 'M13 QA ' + suffix });
  const topic = await post<Topic>(request, '/topics', { name: 'Paginated market fixture', category_id: category.id });
  const pins = [...baseline.jobs.map(row => row.job), { ...original, profile_version_id: cloned.profile_version_id }];
  const bindings: Binding[] = [];
  for (const pin of pins) bindings.push(await post<Binding>(request, '/topics/' + topic.id + '/bindings', {
    source_id: pin.source_id, profile_version_id: pin.profile_version_id, approved_by: 'M13 isolated fixture',
  }));
  const parent = await post<CollectionRequest>(request, '/collection-requests', {
    topic_id: topic.id, keyword: 'market', binding_ids: bindings.map(binding => binding.id), request_key: randomUUID(),
  });
  await expect.poll(async () => (await get<CollectionRequest>(request, '/collection-requests/' + parent.id)).status,
    { timeout: 100_000 }).toBe('succeeded');
  const scoped = 'request_id=' + parent.id;
  const oldest = await get<GenericRecord[]>(request, '/records?' + scoped + '&limit=13&order=oldest');
  const newest = await get<GenericRecord[]>(request, '/records?' + scoped + '&limit=13&order=newest');
  expect(oldest).toHaveLength(12);
  expect(newest.map(item => item.record_id)).toEqual(oldest.map(item => item.record_id).reverse());

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url + '/collection-requests/' + parent.id);
  await page.getByRole('link', { name: 'View request records' }).click();
  await expect(list(page).getByRole('listitem')).toHaveCount(10);
  await expect.poll(() => ledgerIds(page)).toEqual(oldest.slice(0, 10).map(item => item.record_id));
  await page.getByRole('combobox', { name: 'Sort by persistence time' }).selectOption('newest');
  await expect.poll(() => ledgerIds(page)).toEqual(newest.slice(0, 10).map(item => item.record_id));
  await page.getByRole('button', { name: 'Next records page' }).click();
  await expect(list(page).getByRole('listitem')).toHaveCount(2);
  const savedPage = page.url();
  const [first, second] = newest.slice(10);
  expect(await ledgerIds(page)).toEqual([first!.record_id, second!.record_id]);

  await trigger(page, first!.record_id).press('Enter');
  const detail = await get<RecordDetails>(request, '/records/' + first!.record_id + '?include_lineage=true');
  expect(detail.request_id).toBe(parent.id);
  const evidence = await get<EvidenceMetadata>(request, '/evidence/' + detail.evidence_reference);
  expect(evidence.job_id).toBe(detail.job_id);
  expect(evidence.capture_kind).toBe('detail');
  const evidenceLink = page.getByRole('link', { name: 'Open evidence ' + detail.evidence_reference });
  await evidenceLink.click();
  await expect(page.getByText(evidence.content_hash, { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Back to Record Inspector' }).click();
  await expect(evidenceLink).toBeFocused();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(page).toHaveURL(savedPage);
  await expect(trigger(page, first!.record_id)).toBeFocused();
  await trigger(page, second!.record_id).click();
  await expect(page.getByRole('link', { name: 'Open evidence ' + second!.evidence_reference })).toBeVisible();

  const jobRecords = await get<GenericRecord[]>(request, '/records?limit=11&job_id=' + detail.job_id);
  await page.goto(url + '/records?job_id=' + detail.job_id);
  await expect.poll(() => ledgerIds(page)).toEqual(jobRecords.map(item => item.record_id));
  expect(jobRecords.every(item => item.job_id === detail.job_id)).toBe(true);
});

function revision(number: 1 | 2) {
  endpoint('/health');
  const result = execFileSync('docker', ['exec', fixture!, 'python', '-c',
    'import sys; from urllib.request import Request, urlopen; print(urlopen(Request("http://127.0.0.1:8001/demo-revision/"+sys.argv[1], method="POST"), timeout=3).status)',
    String(number),
  ], { encoding: 'utf8', timeout: 10_000 });
  expect(result.trim()).toBe('204');
}

test('real financial fixture revision keeps Request observations pinned to the captured version', async ({ page, request }) => {
  test.setTimeout(150_000);
  const baseline = await markets(request);
  const articles = await get<ArticleSummary[]>(request, '/articles?request_id=' + baseline.id);
  const original = articles.find(article => new URL(article.url).pathname.endsWith('/detail/1'))!;
  const path = '/articles/' + original.id;
  const old = (await get<Observation[]>(request, path + '/observations?request_id=' + baseline.id))[0]!;
  revision(2);
  try {
    const later = await post<CollectionRequest>(request, '/collection-requests/' + baseline.id + '/refresh', { request_key: randomUUID() });
    await expect.poll(async () => (await get<CollectionRequest>(request, '/collection-requests/' + later.id)).status,
      { timeout: 100_000 }).toBe('succeeded');
    const current = await get<ArticleDetail>(request, path);
    expect(current.latest_observation.request_id).toBe(later.id);
    expect(current.latest_version.id).not.toBe(old.content_version_id);
    expect(current.latest_version.content.summary).toContain('updated settlement');

    await page.goto(url + path + '?request_id=' + baseline.id);
    await expect(page.getByText('Latest content across all collections')).toBeVisible();
    await page.getByRole('button', { name: 'View version ' + current.version, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Version ' + current.version + ' · ' + current.title })).toBeVisible();
    await page.getByRole('button', { name: 'Inspect observation' }).click();
    await expect(page.locator('#selected-article-record')).toHaveAttribute('href', new RegExp('/records/' + old.record_id));
    await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).not.toContainText('updated settlement');
    await page.getByRole('button', { name: 'View observed version' }).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('version_id')).toBe(old.content_version_id);
    await expect(page.getByRole('heading', { name: 'Version 1 · ' + current.title })).toBeVisible();
    const context = page.url();
    await page.locator('#selected-article-record').click();
    await page.getByRole('link', { name: 'Open evidence ' + old.evidence_id }).click();
    await expect(page.getByRole('heading', { name: 'Detail page' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('link', { name: 'Open evidence ' + old.evidence_id })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(context);
    await expect(page.locator('#selected-article-record')).toBeFocused();
  } finally {
    revision(1);
  }
});
