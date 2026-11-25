import { expect, test } from '@playwright/test';

test('the M1 server restricts commercial intelligence and the live UI respects its response', async ({ page, request }) => {
  const capabilities = await request.get('/api/v1/marketing/capabilities');
  expect(capabilities.ok()).toBe(true);
  expect(await capabilities.json()).toMatchObject({ permitted_purposes: ['research'], customer_intelligence: 'unavailable' });

  const commercial = await request.post('/api/v1/marketing/intelligence-requests', { data: { query: 'controlled case' } });
  expect(commercial.status()).toBe(403);
  expect(await commercial.json()).toMatchObject({ error: { code: 'commercial_permission_pending' } });
  const account = await request.get('/api/v1/marketing/research/accounts/UC' + 'a'.repeat(22));
  expect(account.status()).toBe(403);
  expect(await account.json()).toMatchObject({ error: { code: 'operator_required' } });

  await page.goto('/creators');
  await expect(page.getByText('Live creator intelligence unavailable', { exact: true })).toBeVisible();
  await expect(page.getByText('Mira Lau')).toHaveCount(0);
  await page.goto('/operations');
  await expect(page.getByText('API and database available', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Creator research and refresh' }).click();
  await expect(page.getByText(/Approved research only/)).toBeVisible();
});
test('the authorised research UI displays the deployment restriction without fetching provider data', async ({ page }) => {
  const token = process.env.HARBOURLINE_TEST_OPERATOR_TOKEN;
  test.skip(!token, 'Requires an isolated research-disabled test deployment with a configured operator token.');
  await page.goto('/operations/creator-research');
  await page.getByLabel('Marketing operator token').fill(token!);
  await page.getByRole('button', { name: 'Open research controls' }).click();
  await page.getByLabel('YouTube channel ID').fill('UC' + 'a'.repeat(22));
  await page.getByRole('button', { name: 'Inspect watch' }).click();
  await expect(page.getByRole('alert')).toContainText('research_disabled');
  await expect(page.getByRole('region', { name: 'Research account' })).toHaveCount(0);
});
