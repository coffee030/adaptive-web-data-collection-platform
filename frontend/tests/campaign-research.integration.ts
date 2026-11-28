import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
      name: 'QA saved research ' + campaignId.slice(0, 12),
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
        evaluation: {
          description: brief.description, objective: 'engagement', budget_minor: 1450075, currency: 'USD',
          platform: 'youtube', deliverable: 'dedicated_video', market: 'HK', minimum_market_share: '0.333333', require_language: false,
          required_facts: ['transport_specialist'], preferred_facts: [], minimum_creators: 2, maximum_creators: 2,
        },
        scenario: { currency: 'USD', value_per_conversion_minor: 0, advertising_spend_minor: 41256, spend_minor: 51234 },
      },
    },
  });
  expect(stored.ok()).toBe(true);
  await page.goto('/campaigns/' + campaignId);
  await page.getByRole('link', { name: 'Research this campaign' }).click();
  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByLabel('Save research to')).toHaveValue(campaignId);
  await expect(page.getByLabel('What are you trying to find?')).toHaveValue(brief.description);
  await expect(page.getByLabel('Budget cap (USD)')).toHaveValue('14500.75');
  await expect(page.getByLabel('Objective')).toHaveValue('engagement');
  await expect(page.getByLabel('Primary channel')).toHaveValue('youtube');
  await page.getByLabel('Target audience').fill('Hong Kong commuters');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await expect(page.getByLabel('Minimum creators to fund')).toHaveValue('2');
  await expect(page.getByLabel('Required market audience share (%)')).toHaveValue('33.3333');
  const fact = page.getByLabel('transport specialist');
  await expect(fact).toHaveValue('required');
  await fact.selectOption('preferred');
  await fact.selectOption('required');
  await page.getByText('Outcome assumptions (optional)', { exact: true }).click();
  await expect(page.getByLabel('Value per conversion (USD)')).toHaveValue('0');
  await expect(page.getByLabel('Advertising spend (USD)')).toHaveValue('412.56');
  await expect(page.getByLabel('Total campaign cost (USD)')).toHaveValue('512.34');
  await page.getByLabel('Contribution margin (%)').fill('32.5');
  const preview = page.waitForResponse((response) => response.url().endsWith('/research-runs/preview'));
  await page.getByRole('button', { name: 'Preview research criteria' }).click();
  const proposed = await (await preview).json();
  expect(proposed.preparation.campaign_id).toBe(campaignId);
  expect(proposed.preparation.brief.scenario).toMatchObject({
    currency: 'USD', value_per_conversion_minor: 0, advertising_spend_minor: 41256, campaign_cost_minor: 51234,
  });
  expect(proposed.preparation.provenance).toMatchObject({
    platform: 'legacy', deliverable: 'legacy', currency: 'legacy', minimum_market_share: 'legacy', required_facts: 'explicit', preferred_facts: 'explicit',
  });
  expect(await (await page.request.get(company + '/research-runs')).json()).toEqual([]);
  expect((await (await page.request.get(company + '/campaigns/' + campaignId)).json()).version).toBe(1);
  const submission = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === company + '/research-runs',
  );
  await page.getByRole('button', { name: 'Confirm and start research', exact: true }).click();
  expect((await submission).postDataJSON()).toEqual({
    ...proposed.preparation,
    request_key: expect.any(String),
    confirmation: { action: 'confirm', version: 'research-criteria-v1', proposal_fingerprint: proposed.fingerprint },
  });
  await expect(page).toHaveURL(/research\?run=/);
  const runId = new URL(page.url()).searchParams.get('run');
  const run = await page.request.get(company + '/research-runs/' + runId);
  expect(run.ok()).toBe(true);
  const saved = await run.json();
  expect(saved.criteria_version).toBe('research-criteria-v1');
  expect(Number(saved.brief.scenario.contribution_margin)).toBe(0.325);
  expect(saved).toMatchObject({
    campaign_id: campaignId,
    brief: {
      campaign: { currency: 'USD', budget_minor: 1450075, minimum_market_share: '0.333333', required_facts: ['transport_specialist'] },
      scenario: { currency: 'USD', value_per_conversion_minor: 0, advertising_spend_minor: 41256, campaign_cost_minor: 51234 },
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

const companiesPath = '/api/v1/marketing/companies';
const researchRunsPath = companiesPath + '/research-runs';
const previewName = 'Preview research criteria';
const currencyName = 'Budget and scenario currency (three-letter code)';
const scenarioName = 'Outcome assumptions (optional)';

async function openSavedCurrencyConflict(page: Page, evaluationPresent: boolean) {
  const suffix = randomUUID().slice(0, 12);
  const company = await page.request.post(companiesPath + '/register', {
    data: { name: 'QA scenario currency ' + suffix, username: 'currency-' + suffix, password: randomUUID() },
  });
  expect(company.status()).toBe(201);
  const id = randomUUID();
  const campaignPath = companiesPath + '/campaigns/' + id;
  const brief = {
    ...blankBrief,
    name: 'Transit launch',
    description: 'Find local transit publications for our launch',
    budget: 14500.75,
    objective: 'engagement',
    platform: 'youtube',
    deliverable: 'dedicated_video',
    creatorCount: 2,
  };
  const scenario = {
    currency: 'USD',
    impressions: 2000,
    value_per_conversion_minor: 19000,
    advertising_spend_minor: 41256,
    ...(evaluationPresent ? { spend_minor: 51234 } : { campaign_cost_minor: 60789 }),
  };
  const evaluation = {
    description: brief.description, objective: brief.objective, budget_minor: 1450075, currency: 'HKD',
    platform: 'youtube', deliverable: 'dedicated_video', minimum_creators: 2, maximum_creators: 2,
  };
  const stored = await page.request.put(campaignPath, { data: { version: 0, draft: {
    brief, scenario, evaluation: evaluationPresent ? evaluation : undefined, saved: true, shortlist: [], lines: [], explorer: '',
  } } });
  expect(stored.status()).toBe(200);
  const savedCampaign = await stored.json();
  const writes: string[] = [];
  let previews = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === researchRunsPath + '/preview') previews++;
    if ((request.method() === 'PUT' && path.startsWith(companiesPath + '/campaigns/')) ||
        (request.method() === 'POST' && path === researchRunsPath)) writes.push(path);
  });
  await page.goto('/campaigns/' + id);
  await page.getByRole('link', { name: 'Research this campaign' }).click();
  await page.getByLabel('Target audience').fill('Hong Kong commuters');
  return {
    id,
    writes,
    previews: () => previews,
    assertCampaignUnchanged: async () => {
      expect(await (await page.request.get(campaignPath)).json()).toEqual(savedCampaign);
    },
  };
}

async function previewSavedScenario(page: Page) {
  const pending = page.waitForResponse((response) => response.url().endsWith('/research-runs/preview'));
  await page.getByRole('button', { name: previewName, exact: true }).click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const proposal = await response.json();
  expect(proposal.execution.status).toBe('ready');
  return proposal;
}

async function expectNoResearchRuns(page: Page) {
  const response = await page.request.get(researchRunsPath);
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual([]);
}

async function confirmSavedScenario(page: Page, proposal: Awaited<ReturnType<typeof previewSavedScenario>>) {
  const submission = page.waitForRequest((request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === researchRunsPath,
  );
  await page.getByRole('button', { name: 'Confirm and start research', exact: true }).click();
  expect((await submission).postDataJSON()).toEqual({
    ...proposal.preparation,
    request_key: expect.any(String),
    confirmation: { action: 'confirm', version: proposal.finalized.version, proposal_fingerprint: proposal.fingerprint },
  });
  await expect(page).toHaveURL(/research\?run=/);
  const id = new URL(page.url()).searchParams.get('run');
  const response = await page.request.get(researchRunsPath + '/' + id);
  expect(response.status()).toBe(200);
  const run = await response.json();
  expect(run.confirmed_criteria.proposal.preparation).toEqual(proposal.preparation);
  expect(run.brief).toEqual(proposal.preparation.brief);
  const list = await page.request.get(researchRunsPath);
  expect(list.status()).toBe(200);
  expect(await list.json()).toEqual([run]);
  return run;
}

test('a saved evaluation requires explicit scenario denomination and a new budget after changing currency', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires an isolated company pilot.');
  const campaign = await openSavedCurrencyConflict(page, true);
  const conflict = page.getByRole('region', { name: 'Review saved scenario currency' });
  const previewButton = page.getByRole('button', { name: previewName, exact: true });
  const includeHkd = conflict.getByRole('button', { name: 'Use these same amounts in HKD', exact: true });
  const restore = conflict.getByRole('button', { name: 'Restore saved USD assumptions', exact: true });
  await expect(conflict).toBeVisible();
  await expect(conflict).toContainText('Saved scenario currency USD. Campaign currency HKD.');
  for (const value of ['USD 190.00', 'USD 412.56', 'USD 512.34']) await expect(conflict).toContainText(value);
  await expect(page.getByLabel('Budget cap (HKD)')).toHaveValue('14500.75');
  await expect(previewButton).toBeDisabled();
  await page.locator('form.rc-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  expect(campaign.previews()).toBe(0);
  expect(campaign.writes).toEqual([]);
  await expectNoResearchRuns(page);
  await campaign.assertCampaignUnchanged();

  await includeHkd.focus();
  await page.keyboard.press('Enter');
  await expect(conflict).toBeFocused();
  const acknowledged = await previewSavedScenario(page);
  expect(acknowledged.preparation.campaign_id).toBe(campaign.id);
  expect(acknowledged.preparation.provenance).toMatchObject({ currency: 'legacy', budget_minor: 'legacy' });
  expect(acknowledged.preparation.brief.scenario).toMatchObject({
    currency: 'HKD', value_per_conversion_minor: 19000, advertising_spend_minor: 41256, campaign_cost_minor: 51234,
  });
  const review = page.getByLabel('Research criteria preview');
  await expect(review).toContainText('HKD 190.00');
  await expect(review).toContainText('HKD 512.34');

  await page.getByText(scenarioName, { exact: true }).click();
  await page.getByLabel('Total campaign cost (HKD)').fill('900.25');
  await expect(review).toHaveCount(0);
  await restore.click();
  await expect(previewButton).toBeDisabled();
  await expect(conflict).toContainText('USD 512.34');
  await expect(conflict).not.toContainText('900.25');
  await includeHkd.click();
  const restored = await previewSavedScenario(page);
  expect(restored.preparation.brief.scenario.campaign_cost_minor).toBe(51234);

  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await page.getByLabel(currencyName).fill('EUR');
  await expect(review).toHaveCount(0);
  await expect(conflict).toContainText('Saved scenario currency USD. Campaign currency EUR.');
  await expect(conflict).toContainText('USD 412.56');
  await expect(conflict).toContainText('HKD 14,500.75');
  await expect(previewButton).toBeDisabled();
  await expect(page.getByLabel('Budget cap (EUR)')).toHaveValue('');
  await page.getByLabel('Budget cap (EUR)').fill('2000.45');
  await conflict.getByRole('button', { name: 'Use these same amounts in EUR', exact: true }).click();
  await page.getByText(scenarioName, { exact: true }).click();
  await page.getByLabel('Total campaign cost (EUR)').fill('600.75');
  const approved = await previewSavedScenario(page);
  expect(approved.preparation.provenance).toMatchObject({ currency: 'explicit', budget_minor: 'explicit' });
  expect(approved.effective_brief).toMatchObject({
    campaign: { currency: 'EUR', budget_minor: 200045 },
    scenario: { currency: 'EUR', value_per_conversion_minor: 19000, advertising_spend_minor: 41256, campaign_cost_minor: 60075 },
  });
  await expect(review).toContainText('EUR 600.75');
  expect(campaign.writes).toEqual([]);
  await expectNoResearchRuns(page);
  await campaign.assertCampaignUnchanged();

  const run = await confirmSavedScenario(page, approved);
  expect(run.campaign_id).toBe(campaign.id);
  expect(run.brief.scenario).toMatchObject({
    currency: 'EUR', value_per_conversion_minor: 19000, advertising_spend_minor: 41256, campaign_cost_minor: 60075,
  });
  expect(campaign.writes).toEqual([researchRunsPath]);
  await campaign.assertCampaignUnchanged();
});

test('the saved brief HKD fallback requires explicit omission of its USD scenario', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires an isolated company pilot.');
  const campaign = await openSavedCurrencyConflict(page, false);
  const conflict = page.getByRole('region', { name: 'Review saved scenario currency' });
  const previewButton = page.getByRole('button', { name: previewName, exact: true });
  const exclude = conflict.getByRole('button', { name: 'Leave scenario out of this research', exact: true });
  await expect(conflict).toContainText('Saved scenario currency USD. Campaign currency HKD.');
  await expect(conflict).toContainText('The saved brief has no evaluation currency');
  await expect(conflict).toContainText('USD 607.89');
  await expect(previewButton).toBeDisabled();
  expect(campaign.previews()).toBe(0);

  await conflict.getByRole('button', { name: 'Use these same amounts in HKD', exact: true }).click();
  await page.getByText(scenarioName, { exact: true }).click();
  await page.getByLabel('Advertising spend (HKD)').fill('300.90');
  await exclude.click();
  let proposal = await previewSavedScenario(page);
  expect(proposal.preparation.brief.scenario).toBeNull();
  await expect(page.getByLabel('Research criteria preview')).toContainText('Outcome assumptions omitted');
  await page.getByRole('button', { name: 'Back to brief', exact: true }).click();
  await expect(page.getByLabel('Research criteria preview')).toHaveCount(0);
  await conflict.getByRole('button', { name: 'Restore saved USD assumptions', exact: true }).click();
  await expect(previewButton).toBeDisabled();
  await expect(conflict).toContainText('USD 412.56');
  await exclude.click();
  proposal = await previewSavedScenario(page);
  expect(proposal.preparation.brief).toMatchObject({
    campaign: { currency: 'HKD', budget_minor: 1450075 },
    scenario: null,
  });
  expect(campaign.writes).toEqual([]);
  await expectNoResearchRuns(page);
  await campaign.assertCampaignUnchanged();

  const run = await confirmSavedScenario(page, proposal);
  expect(run.campaign_id).toBe(campaign.id);
  expect(run.brief.scenario).toBeNull();
  expect(campaign.writes).toEqual([researchRunsPath]);
  await campaign.assertCampaignUnchanged();
});

test('the campaign entry describes related dining coverage only when the search returns it', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires a company pilot.');
  const registered = await page.request.post('/api/v1/marketing/companies/register', {
    data: { name: 'QA dining entry ' + randomUUID().slice(0, 12), username: 'dining-' + randomUUID().slice(0, 12), password: randomUUID() },
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

test('confirmed research displays and adopts the operational brief while mixed receipts remain safe', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires an isolated company pilot.');
  const confirmedBriefFixture = JSON.parse(readFileSync(new URL('./fixtures/pr26b_confirmed_brief.json', import.meta.url), 'utf8'));
  const company = '/api/v1/marketing/companies';
  const runs = company + '/research-runs';
  const registered = await page.request.post(company + '/register', {
    data: { name: 'QA confirmed research ' + randomUUID().slice(0, 12), username: 'confirmed-' + randomUUID().slice(0, 12), password: randomUUID() },
  });
  expect(registered.status()).toBe(201);
  const campaign = company + '/campaigns/' + randomUUID();
  const input = confirmedBriefFixture.brief.campaign;
  const created = await page.request.put(campaign, { data: { version: 0, draft: {
    brief: { ...blankBrief, name: confirmedBriefFixture.brief.product, description: input.description,
      budget: 1200, objective: 'awareness', platform: input.platform, deliverable: input.deliverable, language: input.language },
    saved: true, shortlist: [], lines: [], explorer: '',
  } } });
  expect(created.ok()).toBeTruthy();
  const campaignId = (await created.json()).id;

  const preview = await page.request.post(runs + '/preview', { data: { ...confirmedBriefFixture, campaign_id: campaignId } });
  expect(preview.ok()).toBeTruthy();
  const proposal = await preview.json();
  expect(proposal.execution.status).toBe('ready');
  expect(proposal.effective_brief.campaign).toMatchObject({ platform: 'youtube', deliverable: 'short_video', language: 'yue' });
  const acceptedKey = randomUUID();
  const accepted = await page.request.post(runs, { data: {
    ...proposal.preparation, request_key: acceptedKey,
    confirmation: { action: 'confirm', version: proposal.finalized.version, proposal_fingerprint: proposal.fingerprint },
  } });
  expect(accepted.ok()).toBeTruthy();
  const confirmed = await accepted.json();
  expect(confirmed.brief.campaign).toMatchObject({ platform: 'instagram', deliverable: 'social_post', language: 'en' });
  const legacyResponse = await page.request.post(runs, { data: { brief: confirmed.brief, request_key: randomUUID() } });
  expect(legacyResponse.ok()).toBeTruthy();
  const legacy = await legacyResponse.json();
  expect(legacy).not.toHaveProperty('confirmed_criteria');

  // The browser reads and writes real company/run records. Control only the completed
  // report and run status to make evidence and strategy actions deterministic.
  const publishedAt = '2026-11-20T00:00:00Z';
  let broken: 'missing' | 'conflicting' | 'alternatives' | undefined;
  let findingsRequests = 0;
  let reportRevoked = false;
  let quotedReportWithoutPublicExamples = false;
  const operatorCalls: string[] = [];
  page.on('request', (request) => {
    if (/marketing\/intelligence\/operator|marketing\/research\/accounts/.test(request.url())) {
      operatorCalls.push(request.url());
    }
  });
  for (const run of [confirmed, legacy]) {
    const platform = run.id === confirmed.id ? 'youtube' : 'instagram';
    await page.route('**' + runs + '/' + run.id, async (route) => {
      const response = await route.fetch();
      const receipt = await response.json();
      if (run.id === confirmed.id && broken === 'missing') delete receipt.confirmed_criteria;
      if (run.id === confirmed.id && broken === 'conflicting') receipt.confirmed_criteria.proposal.effective_brief.campaign.platform = 'instagram';
      if (run.id === confirmed.id && broken === 'alternatives') receipt.confirmed_criteria.proposal.effective_brief.alternative_platforms = ['instagram'];
      await route.fulfill({ response, json: { ...receipt, state: 'ready',
        last_review: { analyzed_at: publishedAt, example_count: 2, strategies: [] }, sources: run.id === legacy.id ? [] : [
        { key: 'pending', name: 'Controlled feed A', state: 'available', pending: true, error: null, observed_at: publishedAt },
        { key: 'unavailable', name: 'Controlled feed B', state: 'unavailable', pending: false, error: 'controlled failure' },
        { key: 'expired', name: 'Controlled feed C', state: 'expired', pending: false, error: null },
      ] } });
    });
    await page.route('**' + runs + '/' + run.id + '/results', (route) => {
      findingsRequests++;
      if (run.id === confirmed.id && reportRevoked) {
        return route.fulfill({ status: 409, json: { error: { code: 'research_evidence_changed' } } });
      }
      const direct = { id: 'published-work', name: 'Controlled creator', title: 'Neighbourhood dining video',
        url: 'https://example.invalid/video', profile_url: 'https://example.invalid/profile',
        platform: platform === 'youtube' ? 'YouTube' : 'Instagram', published_at: publishedAt, observed_at: publishedAt,
        license_url: 'https://example.invalid/license', basis: 'market_activity', tier: 'direct', scope_notes: [], metrics: [] };
      const context = { ...direct, id: 'background', title: 'Undated dining background', tier: 'context', published_at: null };
      const strategy = { platform, budget_minor: 120000, currency: 'HKD', name: 'Full budget', status: 'needs_evidence', selected: [], allocated_minor: null, reviewed: 0, exclusions: {}, candidates: [], topics: [], topic_basis: 'suggested' };
      const examples = quotedReportWithoutPublicExamples ? [] : [direct, context];
      const primary = quotedReportWithoutPublicExamples ? {
        ...strategy, status: 'optimal', selected: ['authorized-creator'], allocated_minor: 96000, reviewed: 1,
      } : strategy;
      return route.fulfill({ json: {
        run_id: run.id, analyzed_at: publishedAt, product: confirmed.brief.product, audience: confirmed.brief.audience,
        research: { focus: 'Dining', queries: ['Dining'], market_ranking: 'source_search', historical_ranking: 'source_search', historical_criteria: 'fixture', direct_count: quotedReportWithoutPublicExamples ? 0 : 1, publication_window_days: null, requested_channels: [platform], platform_activity: [],
          examples, market_candidates_reviewed: 17 },
        strategies: [primary, { ...strategy, name: 'Alternative channel', platform: 'tiktok', budget_minor: 86700,
          status: 'search_limit', reviewed: 2, exclusions: { confirmed_quote_unavailable: 2, required_language_unverified: 2 } },
        { ...strategy, name: 'Lower cap', budget_minor: 60000, status: 'infeasible', reviewed: 1,
          exclusions: { quote_exceeds_budget: 1 } }], next_steps: [], outcome_basis: 'Controlled source-linked evidence.',
      } });
    });
  }

  await page.goto('/research?run=' + confirmed.id);
  await expect(page.locator('.rc-basics')).toContainText('YouTube');
  await expect(page.locator('.rc-basics')).not.toContainText('Instagram');
  await expect(page.getByText('Requested channels', { exact: false }).filter({ hasText: 'YouTube' })).toBeVisible();
  await expect(page.getByText('Channels checked')).toHaveCount(0);
  await expect(page.getByText('Refresh pending', { exact: false })).toBeVisible();
  await expect(page.getByText('Refresh issue recorded', { exact: false })).toBeVisible();
  await expect(page.getByText('Observation date unknown')).toHaveCount(2);
  await expect(page.getByText('17 market records retained for ranking', { exact: false })).toBeVisible();
  await expect(page.getByText('No usable quoted allocation was returned.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Show background examples (1)' }).click();
  await expect(page.getByText('Publication date unknown', { exact: false })).toBeVisible();
  await page.getByText('Prepare a quote and evidence request', { exact: true }).click();
  await expect(page.getByLabel('Draft for your review')).toHaveValue(/offer a short video on YouTube/);
  await page.getByRole('button', { name: 'Adjust brief' }).click();
  await expect(page.getByLabel('Primary channel')).toHaveValue('youtube');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await expect(page.getByLabel('Required deliverable')).toHaveValue('short_video');
  await expect(page.getByLabel('Also compare')).toHaveValue('tiktok');
  await page.getByLabel('Save research to').selectOption('standalone');
  await page.getByRole('button', { name: 'Preview research criteria' }).click();
  await page.getByLabel('Confirm primary channel').selectOption('youtube');
  await page.getByRole('group', { name: 'Comparison channels (up to two)' }).getByRole('checkbox', { name: 'TikTok' }).check();
  await page.getByRole('button', { name: 'Use selected primary and preview' }).click();
  const adjustment = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === runs);
  await page.getByRole('button', { name: 'Confirm and start research', exact: true }).click();
  const adjustmentBody = (await adjustment).postDataJSON();
  expect(adjustmentBody.protocol).toBe('confirmed-v1');
  expect(adjustmentBody.campaign_id).toBeNull();
  expect(adjustmentBody.confirmation.proposal_fingerprint).not.toBe(proposal.fingerprint);
  expect(adjustmentBody.request_key).not.toBe(acceptedKey);
  expect(adjustmentBody.brief.campaign).toMatchObject({ platform: 'youtube', deliverable: 'short_video', language: 'yue', require_language: true });
  await expect(page).toHaveURL(/research\?run=/);

  await page.goto('/research?run=' + confirmed.id);
  await page.getByRole('button', { name: /Compare strategies [0-9]/ }).click();
  await expect(page.getByText('Inspect the evidence gaps for this strategy before funding it.')).toBeVisible();
  await page.getByRole('button', { name: /Lower cap.*YouTube/ }).click();
  const lowerCap = page.getByRole('row').filter({ hasText: 'Lower cap' });
  await expect(lowerCap).toContainText('Unavailable');
  await expect(lowerCap).toContainText('No verified combination fits');
  await expect(page.getByText('The verified constraints and current quotes do not fit this strategy.')).toBeVisible();
  await expect(page.getByText('Firm quote exceeds the cap', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Alternative channel.*TikTok/ }).click();
  await expect(page.getByText('Feasibility remains undetermined', { exact: false })).toBeVisible();
  await expect(page.getByText('A profile can appear under several exclusion reasons.')).toBeVisible();
  await page.getByRole('button', { name: 'Use these constraints in the campaign plan' }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect.poll(async () => (await (await page.request.get(campaign)).json()).draft).toMatchObject({
    brief: { platform: 'tiktok', deliverable: 'short_video', language: 'yue', requireCantonese: true, budget: 867 },
    evaluation: { platform: 'tiktok', deliverable: 'short_video', language: 'yue', require_language: true, budget_minor: 86700 },
  });

  quotedReportWithoutPublicExamples = true;
  await page.goto('/research?run=' + confirmed.id);
  await expect(page.getByText(/0 direct examples.*Company-authorized.*returned a quoted allocation/)).toBeVisible();
  await expect(page.getByText('Prepare a quote and evidence request')).toHaveCount(0);
  await page.getByRole('button', { name: 'Review quoted allocation' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'Full budget' })).toContainText('Quoted allocation available');
  await expect(page.getByText('1 creators in the returned quoted allocation.', { exact: false })).toBeVisible();
  quotedReportWithoutPublicExamples = false;

  await page.goto('/research?run=' + legacy.id);
  await expect(page.locator('.rc-basics')).toContainText('Instagram');
  await expect(page.getByText('Source availability was not recorded for this run.')).toBeVisible();
  await page.getByText('Prepare a quote and evidence request', { exact: true }).click();
  await expect(page.getByLabel('Draft for your review')).toHaveValue(/offer a social post on Instagram/);
  await page.getByRole('button', { name: 'Adjust brief' }).click();
  await expect(page.getByLabel('Primary channel')).toHaveValue('instagram');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await expect(page.getByLabel('Required deliverable')).toHaveValue('social_post');

  await page.goto('/research?run=' + confirmed.id);
  await expect(page.getByRole('heading', { name: 'Returned public evidence' })).toBeVisible();
  reportRevoked = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('alert').filter({ hasText: 'The source evidence changed.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Returned public evidence' })).toHaveCount(0);
  await expect(page.getByText('Historical review from', { exact: false })).toBeVisible();
  expect(operatorCalls).toEqual([]);

  for (const defect of ['missing', 'conflicting', 'alternatives'] as const) {
    broken = defect;
    const previous = findingsRequests;
    await page.goto('/research?run=' + confirmed.id);
    await expect(page.getByRole('alert').filter({ hasText: 'confirmed research brief could not be verified' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Adjust brief' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Compare strategies/ })).toHaveCount(0);
    await expect(page.getByText('Prepare a quote and evidence request')).toHaveCount(0);
    expect(findingsRequests).toBe(previous);
  }
});
