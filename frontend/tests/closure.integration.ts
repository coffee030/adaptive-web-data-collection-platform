import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { CollectionJob } from '../src/features/collection-jobs/api';
import type { Profile } from '../src/features/profiles/api';
import type { Source } from '../src/features/sources/api';

const prefix = '/api/v1';
const sources = prefix + '/sources';
const jobs = prefix + '/collection-jobs';
const entry = { adapter_type: 'csv', dataset_id: 'listings', content: 'Name\nAlpha\n' };

test('real Source replay after a lost response and real two-editor draft conflict', async ({ page, context, request }) => {
  const name = 'Closure replay ' + randomUUID();
  const keys: string[] = [];
  let originalBody: Record<string, unknown> = {};
  let registration: Source | undefined;
  await page.route(url => url.pathname === sources, async route => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    originalBody = body;
    keys.push(body.request_key);
    if (keys.length > 1) return route.continue();
    const persisted = await route.fetch();
    expect(persisted.status()).toBe(201);
    registration = await persisted.json();
    await route.abort();
  });
  await page.goto('/sources/new');
  await page.getByRole('textbox', { name: 'Source name' }).fill(name);
  await page.getByRole('textbox', { name: 'Permission reference' }).fill('Closure fixture');
  await page.getByRole('textbox', { name: 'Allowed dataset IDs' }).fill('listings');
  await page.getByRole('button', { name: 'Create source' }).click();
  await expect(page.getByRole('alert')).toContainText('Submit the same values again');
  const replay = page.waitForResponse(response => response.url().endsWith(sources) && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create source' }).click();
  expect((await replay).status()).toBe(200);
  expect(keys).toEqual([keys[0], keys[0]]);
  expect(registration).toBeDefined();
  const source = registration!;
  await expect(page).toHaveURL('/sources/' + source.source_id);
  await expect(page.getByText('Existing registration recovered.', { exact: false })).toBeVisible();
  const rows: Source[] = await (await request.get(sources)).json();
  expect(rows.filter(row => row.source_name === name).map(row => row.source_id)).toEqual([source.source_id]);
  const conflictingReplay = await request.post(sources, { data: { ...originalBody, source_name: name + ' changed' } });
  expect(conflictingReplay.status()).toBe(409);
  expect((await conflictingReplay.json()).error.code).toBe('source_request_conflict');
  const path = `${sources}/${source.source_id}/versions`;
  const configuration = { adapter_type: 'csv', config_schema_version: '1',
    record_schema: { record_type: 'closure', schema_version: '1', fields: [{ name: 'title' }] },
    columns: [{ name: 'title', column: 'Name' }] };
  const response = await request.post(path, { data: { configuration } });
  expect(response.status()).toBe(201);
  const draft: Profile = await response.json();
  const route = `/sources/${source.source_id}/profiles/${draft.profile_version_id}`;
  const first = page;
  const second = await context.newPage();
  await Promise.all([first.goto(route), second.goto(route)]);
  await first.getByRole('textbox', { name: 'Record type' }).fill('first-edit');
  await second.getByRole('textbox', { name: 'Record type' }).fill('stale-edit');
  await first.getByRole('button', { name: 'Save draft' }).click();
  await expect(first.getByText('Draft saved.', { exact: false })).toBeVisible();
  const conflict = second.waitForResponse(reply => reply.request().method() === 'PUT');
  await second.getByRole('button', { name: 'Save draft' }).click();
  expect((await conflict).status()).toBe(409);
  await expect(second.getByRole('alert')).toContainText('Another edit was saved first');
  await expect(second.getByRole('textbox', { name: 'Record type' })).toHaveValue('stale-edit');
  await second.getByRole('button', { name: 'Reload server version' }).click();
  await expect(second.getByRole('heading', { name: 'Server revision 2' })).toBeVisible();
  await expect(second.getByRole('textbox', { name: 'Record type' })).toHaveValue('stale-edit');
  second.once('dialog', dialog => dialog.accept());
  await second.getByRole('button', { name: 'Use server configuration' }).click();
  await expect(second.getByRole('textbox', { name: 'Record type' })).toHaveValue('first-edit');
});

test('failed capture opens Evidence without records and API rejects foreign Host and Origin', async ({ page, request, baseURL }) => {
  const sourceReply = await request.post(sources, { data: {
    source_name: 'Closure capture ' + randomUUID(), approval_status: 'approved',
    adapter_type: 'csv', allowed_datasets: ['listings'], permission_reference: 'Closure fixture',
  } });
  expect(sourceReply.status()).toBe(201);
  const source: Source = await sourceReply.json();
  const path = `${sources}/${source.source_id}/versions`;
  const draftReply = await request.post(path, { data: { configuration: {
    adapter_type: 'csv', config_schema_version: '1',
    record_schema: { record_type: 'closure', schema_version: '1', fields: [{ name: 'title' }] },
    columns: [{ name: 'title', column: 'Name' }],
  } } });
  expect(draftReply.status()).toBe(201);
  const draft: Profile = await draftReply.json();
  const profile = path + '/' + draft.profile_version_id;
  const report = await request.post(profile + '/validate', { data: entry });
  expect(report.status()).toBe(200);
  expect((await report.json()).passed).toBe(true);
  const approval = await request.post(profile + '/approve', { headers: { Origin: baseURL! },
    data: { approver: 'Closure fixture operator', report_id: (await report.json()).report_id, config_hash: draft.config_hash } });
  expect(approval.status()).toBe(200);
  const submission = { source_id: source.source_id, profile_version_id: draft.profile_version_id,
    entry: { ...entry, content: 'Unexpected\nAlpha\n' }, request_key: randomUUID() };
  const job = await request.post(jobs, { data: submission });
  expect(job.status()).toBe(201);
  const accepted: CollectionJob = await job.json();
  const echo = await request.post(jobs, { data: submission });
  expect(echo.status()).toBe(200);
  expect((await echo.json()).job_id).toBe(accepted.job_id);
  const badReuse = await request.post(jobs, { data: { ...submission, entry } });
  expect(badReuse.status()).toBe(409);
  const ui = '/collection-jobs/' + accepted.job_id;
  await page.goto(ui);
  const capture = page.getByRole('region', { name: 'Capture evidence' });
  await expect(capture.getByRole('link')).toBeVisible({ timeout: 30_000 });
  const metadata = await (await request.get(prefix + ui + '/evidence')).json();
  expect(metadata.storage_reference).toBeUndefined();
  expect(await (await request.get(prefix + ui + '/quarantine')).json()).toEqual([]);
  expect(await (await request.get(prefix + '/records', { params: { job_id: accepted.job_id } })).json()).toEqual([]);
  await capture.getByRole('link').click();
  await expect(page.getByText(metadata.content_hash, { exact: true })).toBeVisible();
  const boundary = process.env.API_PROXY_TARGET;
  if (boundary) {
    const rejectedHeaders: Record<string, string>[] = [{ Host: 'untrusted.invalid' }, { Origin: 'https://untrusted.invalid' }];
    for (const headers of rejectedHeaders) {
      expect((await request.get(boundary + '/api/v1/health', { headers })).status()).toBe(403);
    }
  }
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  expect((await new AxeBuilder({ page }).withTags(tags).analyze()).violations).toEqual([]);
  await page.getByRole('link', { name: 'View job records' }).click();
  await expect(page.getByRole('region', { name: 'Quality for this job' })).toContainText('Failed');
  await expect(page.getByText('No records match this Job ID')).toBeVisible();
  await expect(page.getByRole('list', { name: 'Persisted generic records' })).toHaveCount(0);
});
