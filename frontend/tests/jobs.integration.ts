import { expect, test } from '@playwright/test';
import type { CollectionJob, ExecutionEvent } from '../src/features/collection-jobs/api';
import type { GenericRecord } from '../src/features/results/api';

const api = '/api/v1';
const jobsPath = '/collection-jobs';

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
  const link = page.getByRole('link', { name: 'Open job ' + jobId });
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
    .getByText('Partial result', { exact: true })).toBeVisible();
  await expect(page.getByText(job.profile_version_id)).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' });
  const eventRows = timeline.locator(':scope > li');
  await expect(eventRows).toHaveCount(events.length);
  for (const [index, event] of events.entries()) {
    if (event.kind) await expect(eventRows.nth(index)).toContainText(event.kind);
    if (event.error) await expect(eventRows.nth(index)).toContainText(event.error.code);
  }
  const table = page.getByRole('table', { name: 'Related records preview' });
  await expect(table.getByText(records[0]!.record_id)).toBeVisible();
  await expect(table.getByText(records[0]!.evidence_reference).first()).toBeVisible();
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
