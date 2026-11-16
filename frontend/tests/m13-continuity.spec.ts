import { expect, test, type Page } from '@playwright/test';
import type { EvidenceMetadata, RecordDetails } from '../src/features/results/api';
import type { ArticleDetail, ArticleVersion, ObservationDetail } from '../src/features/topic-collections/api';

const api = '/api/v1';
const id = (index: number) => '60000000-c0de-4f67-8abc-' + String(index).padStart(12, '0');
const requestId = id(101);
const jobId = id(102);
const sourceId = id(103);
const profileId = id(104);
const evidenceId = id(105);
const articleId = id(106);
const hash = '9'.repeat(64);
const time = '2026-09-10T10:00:00Z';

const records: RecordDetails[] = Array.from({ length: 23 }, (_, index) => ({
  record_id: id(index + 1), job_id: jobId, source_id: sourceId, profile_version_id: profileId,
  evidence_reference: evidenceId, created_at: new Date(Date.parse(time) + index * 1000).toISOString(),
  record_type: index % 2 ? 'listing' : 'event', schema_version: '1',
  source_record_key: null, deduplication_key: hash, request_id: requestId, article_id: null,
  payload: { title: 'Fixture record ' + (index + 1), score: index, active: index % 2 === 0,
    detail: 'Data '.repeat(25), ...(index > 12 ? { z_later: true } : {}) },
  validation_status: 'passed', source_position: { kind: 'html_item', index: index + 1 },
  provenance: { source_id: sourceId, profile_version_id: profileId, run_id: jobId, config_hash: hash },
}));

const evidence: EvidenceMetadata = {
  evidence_id: evidenceId, job_id: jobId, source_id: sourceId, profile_version_id: profileId,
  run_id: jobId, config_hash: hash, captured_at: time, content_hash: hash, page_number: 7,
  capture_kind: 'detail', content_type: 'text/html', adapter_type: 'web', http_status: 200,
  original_location: 'https://fixture.invalid/detail/7?secret=123',
  requested_location: 'https://user:password@fixture.invalid/detail/7#private',
};

async function json(page: Page, path: string, body: unknown, status = 200) {
  await page.route(url => url.pathname === api + path, route => route.fulfill({ json: body, status }));
}

const list = (page: Page) => page.getByRole('list', { name: 'Persisted generic records' });
const row = (page: Page, number: number) => list(page).getByRole('button', { name: 'Inspect Fixture record ' + number, exact: true });

async function mockLedger(page: Page, seen: URLSearchParams[] = []) {
  await json(page, '/sources', [{ source_id: sourceId, source_name: 'Fixture source' }]);
  await json(page, '/sources/' + sourceId, { source_id: sourceId, source_name: 'Fixture source' });
  await json(page, '/collection-requests/' + requestId, {
    id: requestId, topic_name: 'Example topic', keyword: 'fixture', status: 'partial', created_at: time,
    finished_at: time, refresh_of: null, jobs: [{ job: { job_id: jobId, status: 'partial', valid_count: records.length } }],
  });
  await json(page, '/collection-requests/' + id(88), { topic_name: 'Another topic', keyword: 'fixture', status: 'succeeded', jobs: [] });
  await json(page, '/collection-jobs/' + jobId, { job_id: jobId, status: 'partial', valid_count: records.length });
  await json(page, '/evidence/' + evidenceId, evidence);
  await page.route(url => url.pathname === api + '/records', route => {
    const query = new URL(route.request().url()).searchParams;
    seen.push(query);
    const order = query.get('order') === 'newest' ? [...records].reverse() : records;
    const offset = Number(query.get('offset'));
    return route.fulfill({ json: order.slice(offset, offset + Number(query.get('limit'))) });
  });
  await page.route(url => url.pathname.startsWith(api + '/records/'), route => {
    const record = records.find(item => item.record_id === new URL(route.request().url()).pathname.split('/').at(-1));
    return record ? route.fulfill({ json: record }) : route.fulfill({ status: 404, json: { error: { code: 'record_not_found' } } });
  });
}

test('request records keep page, sort, fields, focus and scroll through repeated inspection', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  await mockLedger(page, seen);
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto('/records?request_id=' + requestId);
  const sort = page.getByRole('combobox', { name: 'Sort by persistence time' });
  await sort.selectOption('newest');
  await expect(row(page, 23)).toBeVisible();
  await page.getByText('Fields to Display').click();
  await page.getByRole('checkbox', { name: 'score', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Next records page' }).click();
  await expect(row(page, 13)).toBeVisible();
  expect(Object.fromEntries(seen.at(-1)!)).toEqual({ limit: '11', offset: '10', order: 'newest', request_id: requestId });
  const url = page.url();
  await row(page, 7).evaluate(button => button.scrollIntoView({ block: 'center' }));
  const top = await page.evaluate(() => window.scrollY);
  expect(top).toBeGreaterThan(100);
  await row(page, 7).press('Enter');
  await expect(page.getByRole('heading', { name: 'Fixture record 7' })).toBeVisible();
  const inspected = page.url();
  expect(new URL(inspected).searchParams.get('record_id')).toBe(id(7));
  const evidenceLink = page.getByRole('link', { name: 'Open evidence ' + evidenceId });
  await evidenceLink.press('Enter');
  await expect(page.getByRole('heading', { name: 'Detail page' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'View collection request' })).toBeVisible();
  await expect(page.getByText(/secret=123|user:password|#private/)).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Record Inspector' }).press('Enter');
  await expect(page).toHaveURL(inspected);
  await expect(evidenceLink).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(url);
  await expect(row(page, 7)).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(top);
  await page.getByText('Fields to Display').click();
  await expect(page.getByRole('checkbox', { name: 'score', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'z_later', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(inspected);
  await expect(page.getByRole('heading', { name: 'Fixture record 7' })).toBeVisible();
  await row(page, 6).click();
  await expect(page.getByRole('heading', { name: 'Fixture record 6' })).toBeVisible();
  await page.getByRole('button', { name: 'Close inspector' }).click();
  await expect(row(page, 6)).toBeFocused();
  await row(page, 5).click();
  await expect(page.getByRole('heading', { name: 'Fixture record 5' })).toBeVisible();
  await sort.selectOption('oldest');
  expect(new URL(page.url()).searchParams.has('offset')).toBe(false);
  expect(new URL(page.url()).searchParams.has('record_id')).toBe(false);
  await expect(row(page, 1)).toBeVisible();
});

test('ledger rejects conflicting scopes and handles stale, off-page and out-of-scope selected IDs', async ({ page }) => {
  const seen: URLSearchParams[] = [];
  await mockLedger(page, seen);
  await page.goto('/records?job_id=' + jobId + '&request_id=' + requestId);
  await expect(page.getByRole('alert')).toContainText('Choose either a Job or a Collection Request');
  await page.goto('/records?request_id=bad');
  await expect(page.getByRole('alert')).toContainText('Invalid Collection Request ID');
  expect(seen).toHaveLength(0);

  await page.goto('/records?record_id=bad&offset=-100');
  await expect(page.getByRole('alert')).toContainText('Invalid Record ID');
  await expect(row(page, 1)).toBeVisible();
  expect(seen.at(-1)?.get('offset')).toBe('0');
  await page.goto('/records?record_id=' + id(99));
  await expect(page.getByRole('alert')).toContainText('Record not found');
  await page.goto('/records?record_id=' + id(23));
  await expect(page.getByText('Record is outside this page')).toBeVisible();
  await page.goto('/records?record_id=' + id(1) + '&request_id=' + id(88));
  await expect(page.getByText('Record is outside this scope')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Fixture record 1' })).toHaveCount(0);
  await page.goto('/records?offset=900');
  await expect(page.getByText('This page is empty')).toBeVisible();
  await page.getByRole('button', { name: 'First page' }).click();
  await expect(row(page, 1)).toBeVisible();
});

test('request observations and their version are independent of latest content and survive nested return', async ({ page }) => {
  await mockLedger(page);
  const versions: ArticleVersion[] = [2, 1].map(version => ({
    id: id(220 + version), version, created_at: time, content_hash: hash,
    content: { title: version === 1 ? 'Captured in request A' : 'Later content from request B',
      author: null, published_at: null, summary: null, body: null },
  }));
  const observed: ObservationDetail = {
    record_id: id(1), job_id: jobId, profile_version_id: profileId, evidence_id: evidenceId,
    config_hash: hash, content_version_id: versions[1]!.id,
    captured_at: time, url: 'https://fixture.invalid/first', request_id: requestId,
    raw_payload: { title: 'Captured in request A', score: 0, active: false },
  };
  const latest = { ...observed, request_id: id(203), record_id: id(2), content_version_id: versions[0]!.id };
  const article: ArticleDetail = { id: articleId, source_id: sourceId, source_name: 'Fixture source',
    title: versions[0]!.content.title, url: latest.url, version: 2, captured_at: time,
    latest_version: versions[0]!, latest_observation: latest };
  const path = '/articles/' + articleId;
  await json(page, path, article);
  await json(page, path + '/versions', versions);
  for (const version of versions) await json(page, path + '/versions/' + version.id, version);
  await page.route(url => url.pathname === api + path + '/observations', route => {
    expect(new URL(route.request().url()).searchParams.get('request_id')).toBe(requestId);
    return route.fulfill({ json: [observed] });
  });
  await json(page, path + '/observations/' + id(1), observed);
  await json(page, path + '/observations/' + id(2), latest);

  await page.goto(path + '?request_id=' + requestId);
  await expect(page.getByText('Latest content across all collections')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Later content from request B' })).toBeVisible();
  await page.getByRole('button', { name: 'View version 2' }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Version 2 · Later content from request B' })).toBeVisible();
  await page.getByRole('button', { name: 'Inspect observation' }).press('Enter');
  await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).toContainText('"active": false');
  await page.getByRole('button', { name: 'View observed version' }).click();
  await expect(page.getByRole('heading', { name: 'Version 1 · Captured in request A' })).toBeVisible();
  const selection = page.url();
  await page.locator('#selected-article-record').press('Enter');
  await expect(page.getByRole('heading', { name: 'Record Details' })).toBeVisible();
  await page.getByRole('link', { name: 'Open evidence ' + evidenceId }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Evidence Metadata' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('link', { name: 'Open evidence ' + evidenceId })).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(selection);
  await expect(page.locator('#selected-article-record')).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Version 1 · Captured in request A' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).toBeVisible();
  await page.goto(path + '?request_id=' + requestId + '&observation_id=' + id(2));
  await expect(page.getByText(/This observation belongs to a different collection/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'Extracted payload JSON' })).toHaveCount(0);
});

test('Article pagination preserves version and observation positions through detail navigation', async ({ page }) => {
  await mockLedger(page);
  const path = '/articles/' + articleId;
  const versions: ArticleVersion[] = Array.from({ length: 21 }, (_, index) => {
    const version = 21 - index;
    return { version, id: id(300 + version), content_hash: hash, created_at: time,
      content: { title: 'Fixture version ' + version, author: null, published_at: null, summary: null, body: null } };
  });
  const observations: ObservationDetail[] = records.slice(0, 21).map(record => ({
    record_id: record.record_id, job_id: jobId, evidence_id: evidenceId, profile_version_id: profileId,
    config_hash: hash, content_version_id: versions.at(-1)!.id, request_id: requestId,
    captured_at: record.created_at, url: 'https://fixture.invalid/first', raw_payload: record.payload,
  }));
  const article: ArticleDetail = { id: articleId, source_id: sourceId, source_name: 'Fixture source',
    title: versions[0]!.content.title, url: observations[0]!.url, version: 21, captured_at: time,
    latest_version: versions[0]!, latest_observation: observations[0]! };
  await json(page, path, article);
  for (const [segment, items] of [['versions', versions], ['observations', observations]] as const) {
    await page.route(url => url.pathname === api + path + '/' + segment, route => {
      const query = new URL(route.request().url()).searchParams;
      expect(query.get('limit')).toBe('21');
      if (segment === 'observations') expect(query.get('request_id')).toBe(requestId);
      return route.fulfill({ json: items.slice(Number(query.get('offset'))) });
    });
  }
  await json(page, path + '/versions/' + versions.at(-1)!.id, versions.at(-1));
  await json(page, path + '/observations/' + observations.at(-1)!.record_id, observations.at(-1));
  await page.goto(path + '?request_id=' + requestId);
  await page.getByRole('button', { name: 'Next versions page' }).click();
  await page.getByRole('button', { name: 'View version 1', exact: true }).click();
  await page.getByRole('button', { name: 'Next observations page' }).click();
  await page.getByRole('button', { name: 'Inspect observation' }).click();
  await expect(page.getByRole('list', { name: 'Content version list' }).getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('list', { name: 'Observation list' }).getByRole('listitem')).toHaveCount(1);
  const before = page.url();
  const url = new URL(before);
  expect(url.searchParams.get('version_offset')).toBe('20');
  expect(url.searchParams.get('observation_offset')).toBe('20');
  await page.locator('#selected-article-record').click();
  await page.getByRole('link', { name: 'Back to Article History' }).click();
  await expect(page).toHaveURL(before);
  await expect(page.locator('#selected-article-record')).toBeFocused();
  await expect(page.getByRole('heading', { name: 'Version 1 · Fixture version 1' })).toBeVisible();
});
