import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Candidate, Profile, Report, SuggestionResult } from '../src/features/profiles/api';

const origin = 'http://collection-fixture:8001';
const cards = '/m22a/cards/reference';
const catalog = '/m22a/catalog/reference';
const keyword = 'C++ & tea';

async function register(request: APIRequestContext, paths: string[]) {
  const created = await request.post('/api/v1/sources', { data: {
    source_name: 'M22B reference ' + randomUUID().slice(0, 8), adapter_type: 'web',
    permission_reference: 'Controlled reference routes', allowed_origins: [origin],
    allowed_paths: { [origin]: paths }, min_request_interval_ms: 2000,
  } });
  expect(created.status()).toBe(201);
  const { source_id: id } = await created.json();
  const authorised = await request.patch('/api/v1/sources/' + id + '/authorization', { data: { approval_status: 'approved' } });
  expect(authorised.ok()).toBe(true);
  return id as string;
}

test('real reference discovery, fallback, editable draft and approval', async ({ page, request }) => {
  test.setTimeout(110_000);
  const collectionJobs = '/api/v1/collection-jobs';
  const beforeJobs = await request.get(collectionJobs);
  expect(beforeJobs.ok()).toBe(true);
  const existingJobs = await beforeJobs.json();
  const id = await register(request, [cards, catalog]);
  const api = '/api/v1/sources/' + id;
  await page.goto('/sources/' + id);
  await page.getByRole('link', { name: 'Create draft', exact: true }).click();
  const type = page.getByRole('textbox', { name: 'Record type' });
  await expect(type).toHaveValue('');
  const discovery = page.getByText('Get a profile suggestion', { exact: true });
  await discovery.focus();
  await discovery.press('Enter');
  await page.getByRole('textbox', { name: 'Discovery keyword' }).fill(keyword);
  const homepage = page.getByRole('textbox', { name: 'Homepage URL' });
  const mode = page.getByRole('combobox', { name: 'Start from' });

  async function find(expected: SuggestionResult['outcome'], count: number) {
    const response = page.waitForResponse(reply => reply.url().endsWith('/profile-suggestions'));
    await page.getByRole('button', { name: 'Find suggestion', exact: true }).click();
    const reply = await response;
    expect(reply.ok()).toBe(true);
    const result: SuggestionResult = await reply.json();
    expect(result.outcome, result.reason).toBe(expected);
    expect(result.actual_attempts).toBe(count);
    expect(result.reserved_requests).toBe(count);
    console.log(JSON.stringify({ outcome: expected, count, stages: result.requests.map(row => row.stage) }));
    return result;
  }

  await homepage.fill(origin + catalog + '/manual');
  await find('needs_examples', 2);
  await expect(page.getByRole('status').filter({ hasText: 'Permitted examples needed' })).toBeVisible();
  await page.getByRole('button', { name: 'Use permitted examples' }).click();
  await page.getByRole('textbox', { name: 'Results URL', exact: true }).fill(origin + catalog + '/search?term=C%2B%2B+%26+tea');
  await page.getByRole('textbox', { name: 'Representative detail URL' }).fill(origin + catalog + '/detail/alpha');
  await find('usable', 3);
  await expect(page.getByRole('button', { name: 'Apply to editor' })).toBeVisible();
  await mode.selectOption('homepage');
  await homepage.fill(origin + catalog + '/');
  await find('usable', 5);
  await homepage.fill(origin + cards + '/');
  const suggestion = await find('usable', 4);
  expect(suggestion.proposal?.fields.map(field => field.sample)).toEqual([10, 'Alpha outlook']);
  await expect(type).toHaveValue('');
  const unsavedVersions = await request.get(api + '/versions');
  expect(unsavedVersions.ok()).toBe(true);
  expect(await unsavedVersions.json()).toEqual([]);
  const discoveredJobs = await request.get(collectionJobs);
  expect(discoveredJobs.ok()).toBe(true);
  expect(await discoveredJobs.json()).toEqual(existingJobs);

  await page.getByRole('button', { name: 'Apply to editor' }).click();
  await expect(type).toHaveValue('publication');
  const countSelector = page.getByRole('group', { name: 'Field 1' }).getByRole('textbox', { name: 'Field selector', exact: true });
  const proposedSelector = suggestion.proposal?.fields.find(field => field.name === 'count')?.mapping?.selector;
  expect(proposedSelector).toBeTruthy();
  await expect(countSelector).toHaveValue(proposedSelector!);
  const operatorSelector = "./p[@class='count']";
  await countSelector.fill(operatorSelector);
  const savedReply = page.waitForResponse(reply => reply.url().endsWith('/versions') && reply.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  const draft: Profile = await (await savedReply).json();
  expect(draft.configuration).toMatchObject({ fields: [{ name: 'count', selector: operatorSelector }, { name: 'title' }] });
  const version = api + '/versions/' + draft.profile_version_id;
  await expect(page.getByRole('heading', { name: 'Profile version 1' })).toBeVisible();

  async function validate() {
    const response = page.waitForResponse(reply => reply.url().endsWith('/validate'));
    await page.getByRole('button', { name: 'Validate sample' }).click();
    const report: Report = await (await response).json();
    await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
    expect(report.passed).toBe(true);
    expect(report.profile_version_id).toBe(draft.profile_version_id);
    expect(report.sample_location).toBe(origin + cards + '/detail/alpha');
    return report;
  }

  const sample = page.getByRole('textbox', { name: 'Sample keyword' });
  await sample.fill(keyword);
  expect((await validate()).config_hash).toBe(draft.config_hash);
  await type.fill('reference_publication');
  await expect(page.getByRole('button', { name: 'Approve version' })).toHaveCount(0);
  const editedReply = page.waitForResponse(reply => reply.request().method() === 'PUT' && reply.url().endsWith(draft.profile_version_id));
  await page.getByRole('button', { name: 'Save draft' }).click();
  const edited: Profile = await (await editedReply).json();
  expect(edited.revision).toBe(draft.revision + 1);
  expect(edited.config_hash).not.toBe(draft.config_hash);
  await expect(page.getByRole('button', { name: 'Approve version' })).toHaveCount(0);

  await sample.fill(keyword);
  const previewReply = page.waitForResponse(reply => reply.url().endsWith('/preview'));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const candidates: Candidate[] = await (await previewReply).json();
  expect(candidates.map(candidate => candidate.payload)).toEqual([{ count: '10', title: 'Alpha outlook' }]);
  await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText('Alpha outlook');
  const passing = await validate();
  expect(passing.config_hash).toBe(edited.config_hash);
  expect(passing.valid_count).toBe(1);

  await page.getByRole('textbox', { name: 'Approver label' }).fill('M22B reference operator');
  await page.getByRole('checkbox', { name: /confirm approval/ }).check();
  const approval = page.waitForResponse(reply => reply.url().endsWith('/approve'));
  await page.getByRole('button', { name: 'Approve version' }).click();
  expect((await approval).status()).toBe(200);
  await expect(page.getByText('Read only', { exact: true })).toBeVisible();
  const persisted: Profile = await (await request.get(version)).json();
  expect(persisted).toMatchObject({
    approval_status: 'approved', profile_version_id: draft.profile_version_id,
    revision: edited.revision, validation_report_id: passing.report_id, config_hash: edited.config_hash,
    configuration: { record_schema: { record_type: 'reference_publication' },
      fields: [{ name: 'count', selector: operatorSelector }, { name: 'title' }] },
  });
  const capped = await request.post(api + '/profile-suggestions', { data: {
    mode: 'homepage', keyword, homepage_url: origin + cards + '/',
  } });
  expect(capped.ok()).toBe(true);
  expect(await capped.json()).toMatchObject({
    outcome: 'budget_exhausted', actual_attempts: 0, reserved_requests: 0,
    limits: { reviewed_profile_limits: true, max_requests: 3 },
  });
  console.log(JSON.stringify({
    proposedSelector, operatorSelector, preview: candidates[0]?.payload, valid: passing.valid_count,
    version: persisted.profile_version_id, revision: persisted.revision, hash: persisted.config_hash, report: passing.report_id,
  }));
});

test('real manual reference draft still saves and validates', async ({ page, request }) => {
  const id = await register(request, [catalog]);
  const discoveryCalls: string[] = [];
  page.on('request', reply => {
    if (reply.url().endsWith('/profile-suggestions')) discoveryCalls.push(reply.url());
  });
  await page.goto('/sources/' + id);
  await page.getByRole('link', { name: 'Create draft', exact: true }).click();
  await page.getByRole('textbox', { name: 'Record type' }).fill('manual_publication');
  await page.getByRole('combobox', { name: 'Collection mode' }).selectOption('search');
  await page.getByRole('textbox', { name: 'Search path', exact: true }).fill(catalog + '/search');
  await page.getByRole('textbox', { name: 'Keyword parameter' }).fill('term');
  await page.getByRole('textbox', { name: 'Search result item selector' }).fill('tbody > tr');
  await page.getByRole('textbox', { name: 'Detail link selector' }).fill('a.publication');
  await page.getByRole('textbox', { name: 'Detail item selector' }).fill('main');
  await page.getByRole('textbox', { name: 'Output field name' }).fill('title');
  await page.getByRole('textbox', { name: 'Field selector', exact: true }).fill('dt');
  await page.getByRole('button', { name: 'Add field', exact: true }).click();
  const count = page.getByRole('group', { name: 'Field 2' });
  await count.getByRole('textbox', { name: 'Output field name' }).fill('count');
  await count.getByRole('combobox', { name: 'Value type' }).selectOption('integer');
  await count.getByRole('textbox', { name: 'Field selector', exact: true }).fill('dd');
  await count.getByRole('checkbox', { name: 'Required field' }).check();
  await page.getByRole('button', { name: 'Create draft', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Profile version 1' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Sample keyword' }).fill(keyword);
  const preview = page.waitForResponse(reply => reply.url().endsWith('/preview'));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const candidates: Candidate[] = await (await preview).json();
  expect(candidates.map(candidate => candidate.payload)).toEqual([{ title: 'Alpha outlook', count: '10' }]);
  const validated = page.waitForResponse(reply => reply.url().endsWith('/validate'));
  await page.getByRole('button', { name: 'Validate sample' }).click();
  const report: Report = await (await validated).json();
  expect(report.passed).toBe(true);
  expect(report.valid_count).toBe(1);
  expect(report.sample_location).toBe(origin + catalog + '/detail/alpha');
  expect(discoveryCalls).toHaveLength(0);
});
