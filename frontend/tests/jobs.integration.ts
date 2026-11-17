import { expect, test } from '@playwright/test';
import type { CollectionJob, ExecutionEvent } from '../src/features/collection-jobs/api';
import type { GenericRecord } from '../src/features/results/api';
import type { CollectionRequest } from '../src/features/topic-collections/api';
import { captureM15 } from './m15Capture';

const api = '/api/v1';
const jobsPath = '/collection-jobs';

test('a fresh Normal database has an empty jobs ledger', async ({ page, request }) => {
  test.skip(process.env.M15_EMPTY_NORMAL !== '1', 'Requires a fresh isolated Normal database.');
  const jobs = await request.get(api + jobsPath);
  expect(jobs.status()).toBe(200);
  expect(await jobs.json()).toEqual([]);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(jobsPath);
  await expect(page.getByRole('status')).toContainText('No collection jobs yet');
  await expect(page.getByText('Synthetic Demo.', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Set up a single-source collection' }).click();
  await expect(page.getByText('No eligible sources')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('status')).toContainText('No collection jobs yet');
  await captureM15(page, 'normal-empty');
});

test('existing Synthetic presets link persisted child Jobs back to Requests and captures', async ({ page, request }) => {
  test.skip(process.env.M15_DEMO_READ !== '1', 'Requires a running Synthetic Demo with the three persisted presets.');
  const presets = ['Fixture Listings', 'Influencer Advertising and Sponsorship', 'Market News and Economic Updates'];
  const response = await request.get(api + '/collection-requests?limit=100');
  expect(response.status()).toBe(200);
  const requests: CollectionRequest[] = await response.json();
  for (const name of presets) {
    const parent = requests.find(item => item.topic_name === name && item.jobs.some(({ job }) => job.valid_count > 0));
    expect(parent, name).toBeDefined();
    const job = parent!.jobs.find(({ job }) => job.valid_count > 0)!.job;
    const detailPath = '/collection-requests/' + parent!.id;
    await page.goto(detailPath);
    await expect(page.getByText('Synthetic Demo.', { exact: true })).toBeVisible();
    const link = page.locator('#request-job-' + job.job_id);
    await link.click();
    const jobUrl = page.url();
    await expect(page.getByRole('region', { name: 'Execution events' }).getByRole('listitem').first()).toBeVisible();
    if (name === presets[2]) await expect(page.getByText('SIMULATED DATA — NOT LIVE MARKET PRICES', { exact: true }).first()).toBeVisible();
    const capture = page.getByRole('region', { name: 'Capture evidence' }).getByRole('link').first();
    await capture.click();
    await expect(page.getByRole('heading', { name: 'Evidence Metadata' })).toBeVisible();
    await page.getByRole('link', { name: 'Back to Job', exact: true }).click();
    await expect(page).toHaveURL(jobUrl);
    await expect(capture).toBeFocused();
    await page.getByRole('link', { name: 'View job records', exact: true }).click();
    const row = page.getByRole('list', { name: 'Persisted generic records' }).getByRole('button').first();
    await row.click();
    const evidence = page.getByRole('navigation', { name: 'Record actions' }).getByRole('link', { name: /View capture evidence/ });
    await evidence.click();
    await page.getByRole('link', { name: 'Back to Record Inspector' }).click();
    await expect(evidence).toBeFocused();
    await page.getByRole('button', { name: 'Close inspector' }).click();
    await expect(row).toBeFocused();
    await page.getByRole('link', { name: 'Back to Job', exact: true }).click();
    await expect(page).toHaveURL(jobUrl);
    await page.getByRole('link', { name: 'View parent request' }).click();
    await expect(page).toHaveURL(detailPath);
    await expect(link).toBeFocused();
    console.log(`M15 read-only Demo ${name}: Request ${parent!.id}, Job ${job.job_id}`);
  }
});

test('lists PostgreSQL-backed jobs and follows one through events and records', async ({ page, request }) => {
  const health = await request.get(api + '/health');
  expect(health.ok()).toBe(true);
  expect(await health.json()).toEqual({ status: 'ok' });

  const response = await request.get(api + jobsPath, { params: { status: 'partial', limit: 20 } });
  expect(response.ok()).toBe(true);
  const jobs: CollectionJob[] = await response.json();
  const job = jobs.find(job => job.valid_count > 0 && job.invalid_count > 0);
  if (!job) throw new Error('Seed a controlled CSV partial job before running the real API test');
  const jobId = job.job_id;

  await page.goto(jobsPath);
  await page.getByRole('combobox', { name: 'Status' }).selectOption('partial');
  const link = page.getByRole('link', { name: 'Inspect Job ' + jobId.slice(0, 8) });
  await expect(link).toBeVisible();
  const detailPath = `${jobsPath}/${jobId}`;
  const [detailResponse, eventResponse, recordsResponse] = await Promise.all([
    page.waitForResponse(url => new URL(url.url()).pathname === api + detailPath && url.ok()),
    page.waitForResponse(url => new URL(url.url()).pathname === api + detailPath + '/events' && url.ok()),
    page.waitForResponse(url => new URL(url.url()).pathname === api + '/records' && url.ok()),
    link.click(),
  ]);
  expect(await detailResponse.json()).toEqual(job);
  const events: ExecutionEvent[] = await eventResponse.json();
  const records: GenericRecord[] = await recordsResponse.json();
  expect(new URL(recordsResponse.url()).searchParams.get('job_id')).toBe(jobId);
  expect(events.at(-1)?.status).toBe('partial');
  expect(records.length).toBeGreaterThan(0);

  await expect(page.getByRole('region', { name: 'Run overview' })
    .getByText('Partial result. Validated records are available.', { exact: true })).toBeVisible();
  await page.getByText('Technical metadata', { exact: true }).click();
  await expect(page.getByText(job.profile_version_id)).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' });
  const eventRows = timeline.locator(':scope > li');
  await expect(eventRows).toHaveCount(events.length);
  for (const [index, event] of events.entries()) {
    if (event.kind) await expect(eventRows.nth(index)).toContainText(event.kind);
    if (event.error) await expect(eventRows.nth(index)).toContainText(event.error.code);
  }
  const table = page.getByRole('list', { name: 'Related records preview' });
  await expect(table.getByRole('link', { name: 'Open record ' + records[0]!.record_id })).toBeVisible();
  await expect(table.getByRole('link', { name: 'Open evidence ' + records[0]!.evidence_reference }).first()).toBeVisible();
  await page.getByRole('navigation', { name: 'Breadcrumb' }).getByRole('link').click();
  await expect(page).toHaveURL(jobsPath + '?status=partial');
});

test('handles the real API 404 for an unknown job', async ({ page }) => {
  const path = jobsPath + '/00000000-0000-0000-0000-000000000000';
  const response = page.waitForResponse(response => new URL(response.url()).pathname === api + path);
  await page.goto(path);
  expect((await response).status()).toBe(404);
  await expect(page.getByRole('alert')).toContainText('Job not found');
});
