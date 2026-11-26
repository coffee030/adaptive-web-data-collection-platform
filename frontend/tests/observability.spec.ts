import { expect, test } from '@playwright/test';

const bucket = { starts_at: '2026-04-15T00:00:00Z', completed: 1, accepted: 3, quarantined: 2, duplicates: 0 };
const pulse = {
  observed_at: '2026-04-16T00:00:00Z', starts_at: bucket.starts_at, workers_observed: 1,
  queue: { pending: 2, running: 0, retrying: 1, dispatch_errors: 0, expired_leases: 0, oldest_pending: bucket.starts_at },
  totals: { completed: 1, failed: 0, partial: 1, accepted: 3, quarantined: 2, duplicates: 0, p50_seconds: 2, p95_seconds: 2 },
  series: [bucket], sources: [],
};

test('monitoring retains the timestamp on refresh failure and resets when the observation period changes', async ({ page }) => {
  let fail = false;
  const windows: string[] = [];
  await page.route('**/api/v1/**', route => route.fulfill({ json: [] }));
  await page.route('**/api/v1/operations/pulse?*', route => {
    windows.push(new URL(route.request().url()).searchParams.get('window') ?? '');
    return fail ? route.fulfill({ status: 503, json: { error: { code: 'database_unavailable' } } })
      : route.fulfill({ json: pulse });
  });
  await page.goto('/operations');
  const monitor = page.getByRole('region', { name: 'Collection monitoring' });
  await expect(monitor.getByText('Median run time')).toBeVisible();
  await monitor.getByText('View interval data').press('Enter');
  await expect(monitor.getByRole('region', { name: 'Interval data' }).getByRole('row')).toHaveCount(2);
  fail = true;
  await monitor.getByRole('button', { name: 'Refresh metrics' }).click();
  await expect(monitor.getByRole('status')).toContainText('Refresh failed · Last observed');
  await expect(monitor.getByText('Median run time')).toBeVisible();
  await monitor.getByLabel('Observation period').selectOption('7d');
  await expect(monitor.getByRole('alert')).toContainText('Backend unavailable');
  await expect(monitor.getByText('Median run time')).toHaveCount(0);
  fail = false;
  await monitor.getByRole('button', { name: 'Retry' }).click();
  await expect(monitor.getByText('Daily intervals · Hong Kong time')).toBeVisible();
  expect(windows).toContain('7d');
});

test('source search covers subsequent pages, restores its filters, and handles an empty selection', async ({ page }) => {
  const rows = Array.from({length: 45}, (_,index) => ({
    source_id: String(index).padStart(32,'0'), source_name: index === 42 ? 'Dated Commons collection' : 'Publisher ' + index,
    approval_status: index === 42 ? 'approved' : 'revoked', adapter_type: 'csv', permission_reference: 'Controlled catalog fixture',
  }));
  await page.route('**/api/v1/sources', route => route.fulfill({json:rows}));
  await page.goto('/sources?offset=20');
  await page.getByLabel('Source name', {exact:true}).fill('Commons');
  await expect(page).toHaveURL(/\/sources\?q=Commons$/);
  const name = page.getByRole('link',{name:'Dated Commons collection'});
  await expect(name).toBeVisible();
  await page.getByLabel('Authorization',{exact:true}).selectOption('revoked');
  await expect(page.getByText('No matching sources')).toBeVisible();
  await page.getByLabel('Authorization',{exact:true}).selectOption('approved');
  await page.reload();
  await expect(page.getByLabel('Source name',{exact:true})).toHaveValue('Commons');
  await expect(page.getByLabel('Authorization',{exact:true})).toHaveValue('approved');
  await expect(name).toBeVisible();
});
