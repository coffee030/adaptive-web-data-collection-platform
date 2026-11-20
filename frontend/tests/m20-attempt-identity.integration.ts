import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';

const { M20_DASHBOARD_DIR, M20_DASHBOARD_PHASE, M20_REQUEST_ID, M20_JOB_ID, M20_WORKER_A, M20_WORKER_B } = process.env;

test('the Request links to durable Worker attribution in Job Details', async ({ page }) => {
  test.skip(!M20_DASHBOARD_DIR || !M20_REQUEST_ID || !M20_JOB_ID || !M20_WORKER_A || !M20_WORKER_B,
    'Run with the M20 Compose acceptance Job');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 960 });
  const requestPath = '/collection-requests/' + M20_REQUEST_ID;
  await page.goto(requestPath);
  const job = page.getByRole('region', { name: 'Child jobs' }).getByRole('link', { name: 'Job details' });
  await expect(job).toHaveAttribute('href', new RegExp('/collection-jobs/' + M20_JOB_ID));
  await job.press('Enter');
  await expect(page.getByRole('heading', { name: 'Job Details' })).toBeVisible();
  const overview = page.getByRole('region', { name: 'Run overview' });
  await expect(overview.getByText('Partial', { exact: true })).toBeVisible();
  const diagnostics = page.getByRole('region', { name: 'Execution and dispatch' });
  await expect(diagnostics.getByText('Latest claim owner')).toBeVisible();
  await expect(diagnostics.getByText(M20_WORKER_B!, { exact: true })).toBeVisible();
  await expect(diagnostics.getByText('2', { exact: true }).first()).toBeVisible();
  const timeline = page.getByRole('list', { name: 'Execution events in API order' }).locator(':scope > li');
  const expected = [
    ['Job created'],
    ['Dispatch confirmed'],
    ['Execution claimed', 'Attempt 1', M20_WORKER_A!],
    ['Lease expiry recorded', 'Attempt 1', M20_WORKER_A!],
    ['Recovery requested', 'Attempt 1', M20_WORKER_A!],
    ['Dispatch confirmed'],
    ['Execution claimed', 'Attempt 2', M20_WORKER_B!],
    ['Run produced partial results', 'Attempt 2', M20_WORKER_B!],
  ];
  await expect(timeline).toHaveCount(expected.length);
  for (const [index, text] of expected.entries()) {
    for (const value of text) await expect(timeline.nth(index)).toContainText(value);
  }
  await expect(page.getByRole('list', { name: 'Saved captures' }).getByRole('listitem')).toHaveCount(5);
  await expect(page.getByRole('list', { name: 'Related records preview' }).getByRole('listitem')).toHaveCount(2);
  const evidence = page.getByRole('list', { name: 'Saved captures' }).getByRole('link').nth(2);
  const evidenceUrl = await evidence.getAttribute('href');
  await evidence.press('Enter');
  await expect(page).toHaveURL(url => url.pathname === evidenceUrl?.split('?')[0]);
  await page.goBack();
  await expect(evidence).toBeFocused();
  const eventsLink = page.getByRole('link', { name: 'Execution events', exact: true });
  await eventsLink.press('Enter');
  await expect(page.getByRole('heading', { name: 'Execution events' })).toBeFocused();
  const panel = page.getByRole('region', { name: 'Execution events' });
  await panel.screenshot({ path: resolve(M20_DASHBOARD_DIR!, `m20-${M20_DASHBOARD_PHASE}-desktop.png`) });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(timeline.nth(3).getByText(M20_WORKER_A!, { exact: true })).toBeVisible();
  await expect(timeline.nth(7).getByText(M20_WORKER_B!, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await panel.screenshot({ path: resolve(M20_DASHBOARD_DIR!, `m20-${M20_DASHBOARD_PHASE}-mobile.png`) });
  await page.getByRole('link', { name: 'View parent request' }).press('Enter');
  await expect(page).toHaveURL(requestPath);
  await expect(job).toBeFocused();
  expect(errors).toEqual([]);
});
