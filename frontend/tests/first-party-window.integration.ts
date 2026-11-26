import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off' });

test('the operator preserves fractional source times and confirms the seven-day cutoff', async ({
  page,
}) => {
  test.skip(
    process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1',
    'Requires an isolated company pilot.',
  );
  const token = process.env.MARKETING_OPERATOR_TOKEN;
  if (!token) throw Error('An isolated operator credential is required.');
  const base = '/api/v1/marketing';
  const creator = 'window-' + randomUUID().slice(0, 12);
  const registered = await page.request.post(base + '/companies/register', {
    data: { name: 'QA fractional window ' + creator, username: creator, password: randomUUID() },
  });
  expect(registered.status()).toBe(201);
  const { id: company } = await registered.json();
  const intake = base + '/intelligence/operator/partner/receipts?company=' + company;
  const now = new Date();
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const posted = day(-11) + 'T08:30:45.123456+08:00';
  const cutoff = day(-4) + 'T08:30:45.123456+08:00';
  const grant = {
    owner_ref: creator,
    authorization_ref: 'qa-window',
    attribution: 'Controlled QA source',
    expires_at: day(28) + 'T12:00:00Z',
    pilot_analytics: true,
    commercial_display: true,
  };
  const row = { creator_id: creator, evidence_ref: 'qa-source', observed_at: now.toISOString() };
  const response = await page.request.post(intake, {
    headers: { Authorization: 'Bearer ' + token },
    data: {
      grant: { ...grant, origin: 'creator_profile' },
      records: [
        {
          ...row,
          kind: 'profile',
          id: 'qa-profile',
          name: 'Controlled publication',
          accounts: [{ platform: 'instagram', account_id: creator }],
        },
      ],
    },
  });
  expect(response.ok()).toBe(true);
  await page.goto('/operations/intelligence-datasets');
  await page.getByLabel('Workstation operator credential', { exact: true }).fill(token);
  await page.getByRole('button', { name: 'Unlock Data Operations' }).click();
  await page.getByRole('button', { name: 'Load companies' }).click();
  await page.getByLabel('Dataset destination').selectOption(company);
  await page.getByText('Record creator-supplied evidence', { exact: true }).click();
  const form = page.locator('.first-party-entry form');
  await form.getByLabel('Evidence type').selectOption('content');
  await form.getByLabel('Creator reference').fill(creator);
  await form.getByLabel('Record identifier', { exact: true }).fill('qa-post');
  await form.getByLabel('Evidence reference').fill('qa-publication');
  await form.getByLabel('Observed or received at').fill(row.observed_at);
  await form.getByLabel('Platform account identifier').fill(creator);
  await form.getByLabel('Published at').fill(posted);
  await form.getByLabel('Permitted post text').fill('Controlled Hong Kong dining review');
  await form.getByLabel('Permission record identifier').fill('qa-content-grant');
  await form.getByLabel('Required attribution').fill(grant.attribution);
  await form.getByLabel('Permission expires').fill(grant.expires_at);
  await form.getByLabel('Company analysis is authorized.').check();
  await form.getByLabel('Display in this commercial workspace is authorized.').check();
  const submit = form.getByRole('button', { name: 'Register reviewed evidence' });
  await submit.click();
  await expect(form.getByRole('status')).toContainText('Evidence registered');
  await form.getByLabel('Evidence type').selectOption('performance');
  await form.getByLabel('Record identifier', { exact: true }).fill('qa-short');
  await form.getByLabel('Evidence reference').fill('qa-short-source');
  await form.getByLabel('Permission record identifier').fill('qa-performance-grant');
  await form.getByLabel('Published content record identifier').fill('qa-post');
  await form.getByRole('button', { name: 'Check linked content' }).click();
  await expect(form.getByRole('status')).toContainText(cutoff);
  await form.getByLabel('Views', { exact: true }).fill('9000');
  await form.getByLabel('Measurement window ended').fill(cutoff.replace('123456', '123455'));
  await submit.click();
  await expect(form.getByRole('status').filter({ hasText: 'Evidence registered' })).toContainText(
    'outside the seven-day comparison',
  );
  await form.getByLabel('Record identifier', { exact: true }).fill('qa-seven');
  await form.getByLabel('Evidence reference').fill('qa-seven-source');
  await form.getByLabel('Views', { exact: true }).fill('700');
  await form.getByLabel('Likes', { exact: true }).fill('21');
  await form.getByLabel('Comments', { exact: true }).fill('7');
  await form.getByRole('button', { name: 'Use confirmed seven-day cutoff' }).click();
  await expect(form.getByLabel('Measurement window ended')).toHaveValue(cutoff);
  await submit.click();
  await expect(form.getByRole('status').filter({ hasText: 'Evidence registered' })).toContainText(
    'matches the linked publication',
  );
  const result = await page.request.get(base + '/intelligence/partner/creators/' + creator);
  expect(result.ok()).toBe(true);
  const detail = await result.json();
  expect(detail.posts[0]).toMatchObject({
    content: { data: { published_at: posted } },
    performance: {
      data: { views: 700, window_end: cutoff },
      evidence: { reference: 'qa-seven-source' },
    },
    other_window: {
      data: { views: 9000, window_end: cutoff.replace('123456', '123455') },
      evidence: { reference: 'qa-short-source' },
    },
  });
  expect(detail.historical_by_platform.instagram.median_views).toMatchObject({
    value: '700',
    observations: 1,
  });
  expect(Number(detail.historical_by_platform.instagram.interaction_rate.value)).toBe(0.04);
});
