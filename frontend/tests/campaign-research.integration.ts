import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { blankBrief } from '../src/features/marketing/contracts';

test('saved campaign research preserves reviewed requirements and editable financial assumptions', async ({
  page,
}) => {
  test.skip(
    process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1',
    'Requires an isolated company pilot with self-registration.',
  );
  const company = '/api/v1/marketing/companies';
  const campaignId = randomUUID();
  const registered = await page.request.post(company + '/register', {
    data: {
      name: 'QA saved research',
      username: 'research-' + randomUUID().slice(0, 12),
      password: randomUUID(),
    },
  });
  expect(registered.status()).toBe(201);
  const { id } = await registered.json();
  const brief = {
    ...blankBrief,
    name: 'Transit launch',
    description: 'Compare Hong Kong transit publications for our launch',
    budget: 14500.75,
    objective: 'engagement',
    platform: 'youtube',
    deliverable: 'dedicated_video',
    creatorCount: 2,
    requiredFacts: 'transport_specialist',
  };
  const stored = await page.request.put(company + '/campaigns/' + campaignId, {
    headers: { 'X-Harbourline-Company': id },
    data: {
      version: 0,
      draft: {
        brief,
        saved: true,
        shortlist: [],
        lines: [],
        explorer: '',
        scenario: { currency: 'HKD', value_per_conversion_minor: 19000 },
      },
    },
  });
  expect(stored.ok()).toBe(true);
  await page.goto('/campaigns/' + campaignId);
  await page.getByRole('link', { name: 'Research this campaign' }).click();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByLabel('Save research to')).toHaveValue(campaignId);
  await expect(page.getByLabel('What are you trying to find?')).toHaveValue(brief.description);
  await expect(page.getByLabel('Budget cap (HK$)')).toHaveValue('14500.75');
  await expect(page.getByLabel('Objective')).toHaveValue('engagement');
  await expect(page.getByLabel('Primary channel')).toHaveValue('youtube');
  await page.getByLabel('Target audience').fill('Hong Kong commuters');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await expect(page.getByLabel('Minimum creators to fund')).toHaveValue('2');
  await expect(page.getByLabel('transport specialist')).toHaveValue('required');
  await page.getByText('Outcome assumptions (optional)', { exact: true }).click();
  await expect(page.getByLabel('Value per conversion (HK$)')).toHaveValue('190');
  await page.getByLabel('Advertising spend (HK$)').fill('412.56');
  await page.getByLabel('Contribution margin (%)').fill('32.5');
  await page.getByRole('button', { name: 'Start research', exact: true }).click();
  await expect(page).toHaveURL(/research\?run=/);
  const runId = new URL(page.url()).searchParams.get('run');
  const run = await page.request.get(company + '/research-runs/' + runId);
  expect(run.ok()).toBe(true);
  const saved = await run.json();
  expect(Number(saved.brief.scenario.contribution_margin)).toBe(0.325);
  expect(saved).toMatchObject({
    campaign_id: campaignId,
    brief: {
      campaign: { budget_minor: 1450075, required_facts: ['transport_specialist'] },
      scenario: { value_per_conversion_minor: 19000, advertising_spend_minor: 41256 },
    },
  });
  await page.getByRole('button', { name: 'New research', exact: true }).click();
  await expect(page.getByLabel('Save research to')).toHaveValue('new');
  await expect(page.getByLabel('Product or campaign')).toHaveValue('');
  await page.goto('/research?campaign=' + randomUUID());
  await expect(page.getByRole('heading', { name: 'Campaign unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new brief' }).click();
  await expect(page.getByLabel('What are you trying to find?')).toHaveValue('');
});

test('the campaign entry describes related dining coverage only when the search returns it', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires a company pilot.');
  const registered = await page.request.post('/api/v1/marketing/companies/register', {
    data: { name: 'QA dining entry', username: 'dining-' + randomUUID().slice(0, 12), password: randomUUID() },
  });
  expect(registered.status()).toBe(201);
  const market = '**/api/v1/marketing/intelligence/partner/market/';
  await page.route(market + 'overview', async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    await route.fulfill({ response, json: { ...overview, topics: [{ value: 'Dining', count: 3 }] } });
  });
  const search = market + 'creators?**';
  let exact = false;
  await page.route(search, (route) => route.fulfill({
    json: {
      items: [], total: exact ? 1 : 0,
      related: exact ? undefined : {
        basis: 'dining_coverage_without_price_evidence', query: 'food', topic: 'Dining', total: 3, items: [],
      },
    },
  }));
  await page.goto('/');
  const link = page.getByRole('link', { name: 'Affordable dining', exact: true });
  await expect(link).toHaveAccessibleDescription(/3 related matches without verified prices/);
  await expect(link).toHaveAttribute('href', '/creators?q=affordable+dining');
  exact = true;
  await Promise.all([page.waitForResponse(search), page.reload()]);
  await expect(link).toBeVisible();
  await expect(link).toHaveAccessibleDescription('');
});
