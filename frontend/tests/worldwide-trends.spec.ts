import { expect, test, type Page } from '@playwright/test';

const route = '/operations/worldwide-trends';
const api = '/api/v1/trends/wikimedia';
const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const job = '00000000-0000-4000-8000-000000000003';
const record = '00000000-0000-4000-8000-000000000004';
const evidence = '00000000-0000-4000-8000-000000000005';

function day(ago: number) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - ago);
  return now.toISOString().slice(0, 10);
}
const provider = {
  authorized: true, configured: true, blocked: false, last_error: null, next_request_at: null, source_id: null,
  policy: 'https://example.invalid/controlled-policy', data_license: 'https://example.invalid/controlled-licence',
};

async function isolate(page: Page) {
  await page.route('**/*', async request => {
    expect(new URL(request.request().url()).hostname).toBe('127.0.0.1');
    await request.fallback();
  });
  await page.route('**/api/v1/**', request => request.fulfill({ json: [] }));
}

test('discover published ranks, deliberately approve the source and save a known article independently of its ranking', async ({ page }) => {
  await isolate(page);
  let approved = false;
  let discoveries = 0;
  const writes: Record<string, unknown>[] = [];
  await page.route('**' + api + '/**', async request => {
    const method = request.request().method();
    const endpoint = new URL(request.request().url()).pathname.slice(api.length);
    if (endpoint === '/provider' && method === 'GET') return request.fulfill({ json: { ...provider, authorized: approved, configured: approved } });
    const body = request.request().postDataJSON();
    if (endpoint === '/discover') {
      discoveries++;
      expect(body).toEqual({ project: 'es.wikipedia.org', day: day(2) });
      return request.fulfill({ json: { project: body.project, day_utc: body.day, source_url: 'https://example.invalid/top',
        articles: [{ article: 'Controlled_topic', rank: 7, views: 3210 }] } });
    }
    writes.push({ endpoint, ...body });
    if (endpoint === '/provider') {
      approved = true;
      return request.fulfill({ json: { ...provider, authorized: true } });
    }
    if (endpoint === '/series') return request.fulfill({ json: { id: firstId, ...body } });
    throw Error('Unexpected trend request ' + endpoint);
  });
  await page.goto('/sources');
  await page.getByRole('link', { name: 'Worldwide trends', exact: true }).click();
  await page.getByLabel('Wikipedia edition').fill('es');
  await page.getByRole('button', { name: 'Find articles' }).click();
  const ranked = page.getByRole('row').filter({ hasText: 'Controlled topic' });
  await expect(ranked.getByRole('cell', { name: '7', exact: true })).toBeVisible();
  await expect(ranked.getByText('3,210')).toBeVisible();
  await ranked.getByRole('button', { name: 'Select Controlled topic' }).click();
  await page.getByRole('button', { name: 'Approve source', exact: true }).click();
  expect(writes).toEqual([]);
  await page.getByLabel('Approver name').fill('Controlled operator');
  await page.getByRole('checkbox', { name: /reviewed the/ }).check();
  await page.getByRole('button', { name: 'Approve source', exact: true }).click();
  await expect(page.getByLabel('Topic name')).toBeVisible();
  expect(writes[0]).toEqual({ endpoint: '/provider', project: 'es.wikipedia.org', article: 'Controlled_topic', day: day(2), approver: 'Controlled operator' });
  await page.getByLabel('Find by').selectOption('title');
  await page.getByLabel('Article title', { exact: true }).fill('Another article');
  await page.getByRole('button', { name: 'Review article' }).click();
  await page.getByLabel('Topic name').fill('Research topic');
  await page.getByRole('button', { name: 'Save series' }).click();
  await expect(page.getByRole('status')).toContainText('Saved Research topic');
  expect(discoveries).toBe(1);
  expect(writes[1]).toEqual({ endpoint: '/series', project: 'es.wikipedia.org', article: 'Another article', day: day(2), topic: 'Research topic' });
});

test('compare exact dates including observed zero and missing; browser Back restores the selected series and focused count', async ({page}) => {
  await isolate(page);
  const from = day(3), through = day(2);
  const first = { id: firstId, topic: 'First topic', article: 'Article_A', project: 'en.wikipedia.org', active: true, start_day: from,
    next_day: day(1), due_at: through + 'T09:00:00Z', last_capture_at: through + 'T08:00:00Z', last_job: job, pending_job: null, last_error: null };
  const second = { ...first, id: secondId, topic: 'Second topic', article: 'Article_B', project: 'es.wikipedia.org', last_error: 'publisher_dates_missing' };
  const point = { views: 0, job_id: job, evidence_id: evidence, record_id: record, source_url: 'https://example.invalid/pageviews',
    response_sha256: 'a'.repeat(64), capture_at: first.last_capture_at };
  const series = [first, second];
  await page.route('**/api/v1/records/' + record + '?**', request => request.fulfill({ json: {
    record_id: record, record_type: 'wikimedia-daily-article-pageviews', schema_version: '1',
    payload: { article: 'Article_A', day_utc: from, views: 0 }, validation_status: 'passed',
    source_id: firstId, profile_version_id: secondId, job_id: job, evidence_reference: evidence,
    source_position: { kind: 'csv_row', index: 1 }, created_at: point.capture_at, source_record_key: 'test-row',
    deduplication_key: point.response_sha256, provenance: { source_id: firstId, run_id: job,
      profile_version_id: secondId, config_hash: point.response_sha256 }, request_id: null, article_id: null,
  } }));
  await page.route('**' + api + '/**', async request => {
    const url = new URL(request.request().url());
    const endpoint = url.pathname.slice(api.length);
    if (endpoint === '/provider') return request.fulfill({ json: provider });
    if (endpoint === '/series') return request.fulfill({ json: series });
    if (endpoint === '/series/' + firstId) {
      first.active = request.request().postDataJSON().active;
      return request.fulfill({ json: first });
    }
    if (endpoint === '/compare') {
      expect(url.searchParams.getAll('watch_id')).toEqual([firstId, secondId]);
      expect(url.searchParams.get('start')).toBe(from);
      expect(url.searchParams.get('end')).toBe(through);
      return request.fulfill({ json: { days: [from, through], series: [
        { ...first, points: [point, { ...point, record_id: secondId, views: 8 }], coverage: { observed_days: 2, requested_days: 2 } },
        { ...second, points: [null, { ...point, record_id: firstId, views: 27 }], coverage: { observed_days: 1, requested_days: 2 } },
      ] } });
    }
    throw Error('Unexpected trend request ' + endpoint);
  });
  await page.setViewportSize({width:320,height:640});
  await page.goto(route + '?view=saved');
  const schedule = page.getByText('Active · Schedule details', {exact:true}).first();
  await schedule.click();
  await page.getByRole('button', {name:'Pause First topic'}).click();
  await expect(page.getByText('Paused · Schedule details')).toBeVisible();
  await page.getByRole('checkbox',{name:/Compare First topic/}).check();
  await page.getByRole('checkbox',{name:/Compare Second topic/}).check();
  await page.getByLabel('From (UTC)').fill(from);
  await page.getByLabel('Through (UTC)').fill(through);
  await page.getByRole('button',{name:'Compare selected (2)'}).click();
  await expect(page.getByRole('heading',{name:'Daily article pageviews'})).toBeFocused();
  const region = page.getByRole('region',{name:'Daily pageviews aligned by UTC date'});
  const firstDate = region.getByRole('rowheader',{name:from});
  await expect(firstDate).toBeInViewport({ratio:0.95});
  await region.evaluate(element => { element.scrollLeft = element.scrollWidth; });
  await expect(firstDate).toBeInViewport({ratio:0.95});
  const count = page.getByRole('button',{name:'0 pageviews, First topic, en.wikipedia.org, ' + from + ' UTC',exact:true});
  await expect(page.getByRole('cell',{name:'Missing',exact:true})).toBeVisible();
  await expect(page.getByText('1 / 2 days observed')).toBeVisible();
  await count.click();
  await page.getByText('Response fingerprint').click();
  await expect(page.getByText(point.response_sha256)).toBeVisible();
  await expect(page.getByRole('link',{name:'Wikimedia source'})).toHaveAttribute('href',point.source_url);
  const comparisonUrl = page.url();
  await page.getByRole('link',{name:'Validated record'}).click();
  await expect(page).toHaveURL(new RegExp('/records/' + record + '$'));
  await expect(page.getByRole('heading',{name:'Record content'})).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(comparisonUrl);
  await expect(page.getByRole('checkbox',{name:/Compare First topic/})).toBeChecked();
  await expect(page.getByLabel('Through (UTC)')).toHaveValue(through);
  await expect(count).toBeFocused();
  await page.getByRole('button',{name:'Compare selected (2)'}).click();
  await expect(page.getByRole('heading',{name:'Daily article pageviews'})).toBeFocused();
  await expect(firstDate).toBeInViewport({ratio:0.95});
});
