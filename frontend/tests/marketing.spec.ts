import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const capabilityPath = '**/api/v1/marketing/capabilities';
const capability = { provider: 'youtube_data_api', policy_url: 'https://developers.google.com/youtube/terms/developer-policies',
  permission_status: 'additional_permission_pending', permitted_purposes: ['research'], retention_days: 28, customer_intelligence: 'unavailable' };

test('live workspace saves a brief and keeps restricted data and the demo out of customer results', async ({ page }) => {
  const protectedRequests: string[] = [];
  await page.route('**/api/v1/marketing/**', route => {
    if (new URL(route.request().url()).pathname.endsWith('/capabilities')) return route.fulfill({ json: capability });
    protectedRequests.push(route.request().url());
    return route.fulfill({ status: 403, json: { error: { code: 'commercial_permission_pending' } } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Plan a creator campaign' })).toBeVisible();
  await expect(page.getByText('Live creator intelligence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Data Operations' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Start a campaign' }).click();
  await page.getByLabel('Campaign name').fill('Harbour launch');
  await page.getByLabel('Describe the campaign').fill('Introduce a new café in Hong Kong.');
  await page.getByRole('button', { name: 'Save brief' }).click();
  await expect(page.getByRole('heading', { name: 'Harbour launch' })).toBeVisible();
  await expect(page.getByText('Live creator intelligence unavailable', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Creator Explorer' }).click();
  await page.getByRole('textbox', { name: 'Creator name, handle or topic' }).fill('café');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText(/Eligible creator search is currently unavailable/)).toBeVisible();
  await expect(page.getByText('Mira Lau')).toHaveCount(0);
  await page.goto('/demo');
  await expect(page.getByRole('link', { name: 'Sheung Wan coffee launch', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Live workspace' }).click();
  await expect(page.getByText('Harbour launch')).toBeVisible();
  expect(protectedRequests).toEqual([]);
});

test('a failed capability request offers retry without loading fictional search results', async ({ page }) => {
  let attempts = 0;
  await page.route(capabilityPath, route => ++attempts === 1
    ? route.fulfill({ status: 503, json: { error: { code: 'backend_unavailable' } } })
    : route.fulfill({ json: capability }));
  await page.goto('/creators');
  await expect(page.getByRole('alert')).toContainText('Backend unavailable');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByText('Live creator intelligence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Mira Lau')).toHaveCount(0);
});

test('fictional evidence, views, comparison and exact budget assessment share a draft', async ({ page }) => {
  await page.goto('/demo/advisor');
  await expect(page.getByRole('heading', { name: 'Start with Mira Lau and Ethan Ko.' })).toBeVisible();
  const evidence = page.getByRole('button', { name: 'Evidence for Mira Lau' });
  await evidence.click();
  await expect(page.getByRole('dialog')).toContainText('上環慢慢行，飲杯咖啡先。');
  await expect(page.getByRole('dialog')).toContainText('Sample transcript · 0:04–0:07');
  await page.keyboard.press('Escape');
  await expect(evidence).toBeFocused();
  await page.getByRole('link', { name: 'Inspect plan' }).click();
  await expect(page.getByText('Feasible within budget', { exact: true })).toBeVisible();
  await page.getByLabel('Budget cap (HK$)').fill('19000');
  await page.getByRole('button', { name: 'Update scope' }).click();
  await expect(page.getByText('HK$0', { exact: true })).toBeVisible();
  await page.getByLabel('Budget cap (HK$)').fill('18000');
  await page.getByRole('button', { name: 'Update scope' }).click();
  await expect(page.getByText('Known fees exceed the cap by HK$1,000.')).toBeVisible();
  await page.getByLabel('Budget cap (HK$)').fill('30000');
  await page.getByRole('button', { name: 'Update scope' }).click();

  await page.getByRole('link', { name: 'Creator Explorer' }).click();
  await page.getByRole('button', { name: 'Try 上環 café tour' }).click();
  await expect(page.getByRole('status').filter({ hasText: '1 creator' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Creator name, handle or topic' }).fill('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Content gallery' }).click();
  await page.getByRole('button', { name: 'Tea and something sweet' }).click();
  await expect(page.getByRole('region', { name: 'Creator profile for Chloe Mak' })).toContainText('Quote missing');
  await page.getByRole('region', { name: 'Creator profile for Chloe Mak' }).getByRole('button', { name: 'Shortlist Chloe Mak' }).click();
  await page.getByRole('button', { name: 'Compare shortlist' }).click();
  await expect(page.getByRole('dialog')).toContainText('Audience data unavailable');
  await page.getByRole('dialog').getByRole('link', { name: 'Open campaign plan' }).click();
  await page.getByRole('checkbox', { name: 'Include Ethan Ko' }).uncheck();
  await page.getByRole('checkbox', { name: 'Include Chloe Mak' }).check();
  await expect(page.getByText('Budget feasibility unknown', { exact: true })).toBeVisible();
  await page.getByLabel('Scenario assumptions').fill('Creator fees only.');
  const promise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export draft CSV' }).click();
  const csv = await readFile((await (await promise).path())!, 'utf8');
  expect(csv).toContain('"Classification","Fictional demo"');
  expect(csv).toContain('"Total creator fees (HKD)","Unavailable"');
  expect(csv).toContain('Creator fees only.');
  await page.getByRole('link', { name: 'Creator Explorer' }).click();
  await expect(page.getByRole('button', { name: 'Content gallery' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Creator profile for Chloe Mak' })).toBeVisible();
});

test('local research respects the bearer boundary and expires protected payloads', async ({ page }) => {
  const token = 'controlled-local-testing-token';
  const channel = 'UC' + 'a'.repeat(22);
  const id = '11111111-1111-4111-8111-111111111111';
  const past = new Date(Date.now() - 10000).toISOString();
  let runReads = 0;
  const pending = { id, kind: 'discovery', status: 'queued', attempts: 0, standard_units: 0, search_calls: 0, error_code: null, available_after: null };
  await page.route(capabilityPath, route => route.fulfill({ json: capability }));
  await page.route('**/api/v1/marketing/research/**', async route => {
    const { pathname } = new URL(route.request().url());
    expect(route.request().headers().authorization).toBe('Bearer ' + token);
    if (pathname.endsWith('/accounts/' + channel)) return route.fulfill({ status: 409, json: { error: { code: 'research_disabled' } } });
    if (route.request().method() === 'POST') return route.fulfill({ status: 202, json: pending });
    if (pathname.includes('/runs/')) { runReads++; return route.fulfill({ json: { ...pending, status: 'succeeded' } }); }
    return route.fulfill({ json: { run: { ...pending, status: 'succeeded' }, state: 'available',
      leads: [{ channel_id: channel, title: 'Expired protected title', provenance: { expires_at: past } }] } });
  });
  await page.goto('/operations/creator-research');
  await expect(page.getByText(/Approved research only/)).toBeVisible();
  await page.getByLabel('Marketing operator token').fill(token);
  await page.getByRole('button', { name: 'Open research controls' }).click();
  await page.getByLabel('YouTube channel ID').fill(channel);
  await page.getByRole('button', { name: 'Inspect watch' }).click();
  await expect(page.getByRole('alert')).toContainText('disabled on this deployment');
  await page.getByLabel('Approved research query').fill('Hong Kong café');
  await page.getByRole('button', { name: 'Find research leads' }).click();
  await expect(page.getByText('Discovery status · expired')).toBeVisible();
  await expect(page.getByText('Expired protected title')).toHaveCount(0);
  expect(runReads).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Clear operator token' }).click();
  await expect(page.getByLabel('Marketing operator token')).toBeEmpty();
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }))).not.toContain(token);
});

test('mobile Advisor and plan have accessible names and fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/demo/advisor');
  await expect(page.getByRole('heading', { name: 'Start with Mira Lau and Ethan Ko.' })).toBeVisible();
  for (const route of ['advisor','plan','creators']) {
    if (route === 'plan') await page.getByRole('link', { name: 'Inspect plan' }).click();
    if (route === 'creators') {
      await page.getByRole('link', { name: 'Creator Explorer' }).click();
      await page.locator('button[data-creator="mira"]').click();
      const inspector = page.getByRole('region', { name: 'Creator profile for Mira Lau' });
      await expect(inspector.getByText('Historical views', { exact: true })).toBeVisible();
      await expect(inspector.getByText(/Sample transcript/)).toHaveCount(0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    const result = await new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});