import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { blankBrief } from '../src/features/marketing/contracts';
import type { ResearchPreview, ResearchPreparation } from '../src/features/marketing/researchClient';

const company = '/api/v1/marketing/companies';
const runs = company + '/research-runs';
const campaigns = company + '/campaigns';
const confirm = 'Confirm and start research';
const previewButton = 'Preview research criteria';
const routeFor = (path: string) => '**' + path;
const requestPath = (url: string) => new URL(url).pathname;

test.beforeEach(async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires an isolated company pilot.');
  const suffix = randomUUID().slice(0, 12);
  const response = await page.request.post(company + '/register', {
    data: { name: 'Stage C test company ' + suffix, username: 'pr26c-' + suffix, password: randomUUID() },
  });
  expect(response.status()).toBe(201);
});

async function fill(page: Page, question: string, destination = 'standalone') {
  await page.goto('/research');
  await page.getByLabel('Save research to').selectOption(destination);
  await page.getByLabel('What are you trying to find?').fill(question);
  await page.getByLabel('Product or campaign').fill('Independent café lunch offer');
  await page.getByLabel('Target audience').fill('Local weekday diners');
  await page.getByLabel('Budget cap (HKD)').fill('1200');
}

async function preview(page: Page, action = previewButton): Promise<ResearchPreview> {
  const result = page.waitForResponse((response) => requestPath(response.url()) === runs + '/preview');
  await page.getByRole('button', { name: action, exact: true }).click();
  const response = await result;
  expect(response.status()).toBe(200);
  return response.json();
}

async function assertNoWrites(page: Page) {
  for (const path of [runs, campaigns]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  }
}

for (const wording of ['Compare YouTube and Instagram', 'Compare Instagram and YouTube']) {
  test(wording + ' requires deliberate primary approval before creating a standalone run', async ({ page }) => {
    await fill(page, wording);
    await page.getByText('Research scope and alternatives', { exact: true }).click();
    const pickedAlternative = wording.startsWith('Compare Instagram');
    if (pickedAlternative) await page.getByRole('combobox', { name: 'Also compare', exact: true }).selectOption('youtube');
    let proposal = await preview(page);
    expect(proposal.preparation.provenance).toMatchObject({
      alternative_platforms: pickedAlternative ? 'explicit' : 'application_default', platform: 'application_default',
    });
    expect(proposal.execution.issues.map((issue) => issue.code)).toContain('comparison_primary_required');
    await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Confirm primary channel')).not.toHaveValue('');
    await assertNoWrites(page);

    proposal = await preview(page, 'Use selected primary and preview');
    expect(proposal.execution.status).toBe('ready');
    expect(proposal.preparation.decisions?.platforms?.platform).toBe(proposal.finalized.criteria.platform);
    await assertNoWrites(page);
    const request = page.waitForRequest((item) => item.method() === 'POST' && requestPath(item.url()) === runs);
    await page.getByRole('button', { name: confirm, exact: true }).click();
    expect((await request).postDataJSON()).toEqual({
      ...proposal.preparation,
      request_key: expect.any(String),
      confirmation: { action: 'confirm', version: 'research-criteria-v1', proposal_fingerprint: proposal.fingerprint },
    });
    await expect(page).toHaveURL(/research\?run=/);
    const [stored] = await (await page.request.get(runs)).json();
    expect(stored.campaign_id).toBeNull();
    expect(stored.confirmed_criteria.proposal.fingerprint).toBe(proposal.fingerprint);
    expect(await (await page.request.get(campaigns)).json()).toEqual([]);
  });
}

test('show displaced defaults, resolve explicit conflicts and preserve age and language provenance', async ({ page }) => {
  await fill(page, 'Find YouTube short videos for local cafés.');
  let proposal = await preview(page);
  expect(proposal.execution.status).toBe('ready');
  expect(proposal.effective_brief?.campaign).toMatchObject({ platform: 'youtube', deliverable: 'short_video' });
  expect(proposal.initial.fields.platform.origin).toBe('text');
  expect(proposal.initial.fields.deliverable.origin).toBe('text');
  expect(proposal.initial.defaults).toMatchObject({ platform: { value: 'instagram' }, deliverable: { value: 'social_post' } });
  expect(proposal.initial.fields.max_evidence_age_days.state).toBe('absent');
  expect(proposal.preparation.provenance).not.toHaveProperty('max_evidence_age_days');
  await page.getByText('Original interpretation and provenance', { exact: true }).click();
  await expect(page.getByText('Application default', { exact: false }).filter({ hasText: 'Instagram' })).toBeVisible();

  await page.getByRole('combobox', { name: 'Primary channel', exact: true }).selectOption('tiktok');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Required deliverable', exact: true }).selectOption('dedicated_video');
  proposal = await preview(page);
  expect(proposal.execution.status).toBe('blocked');
  expect(proposal.initial.issues.filter((issue) => issue.code === 'conflicting_criteria').map((issue) => issue.field)).toEqual(
    expect.arrayContaining(['platform', 'deliverable']),
  );
  await page.getByLabel('Confirm primary channel').selectOption('youtube');
  await preview(page, 'Use selected primary and preview');
  await page.getByLabel('Clarified deliverable').selectOption('short_video');
  proposal = await preview(page, 'Use deliverable and preview');
  expect(proposal.execution.status).toBe('ready');
  expect(proposal.initial.status).toBe('needs_review');
  expect(proposal.preparation.brief.campaign).toMatchObject({ platform: 'tiktok', deliverable: 'dedicated_video' });
  await page.getByRole('button', { name: 'Back to brief', exact: true }).click();
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  await assertNoWrites(page);

  await page.getByLabel('What are you trying to find?').fill('Find local creators with recent publications.');
  proposal = await preview(page);
  expect(proposal.execution.issues.map((issue) => issue.code)).toContain('vague_age');
  expect(proposal.preparation.decisions?.platforms).toBeNull();
  proposal = await preview(page, 'Use no age limit and preview');
  expect(proposal.finalized.fields.max_evidence_age_days).toMatchObject({ state: 'resolved', origin: 'explicit' });
  expect(proposal.finalized.criteria.max_evidence_age_days).toBeNull();
  await page.getByRole('combobox', { name: 'Publication age', exact: true }).selectOption('maximum');
  await page.getByLabel('Maximum publication age (days)', { exact: true }).fill('45');
  proposal = await preview(page);
  expect(proposal.effective_brief?.max_evidence_age_days).toBe(45);
  expect(proposal.preparation.provenance?.max_evidence_age_days).toBe('explicit');

  await page.getByLabel('What are you trying to find?').fill('Find local publications for the café launch.');
  await page.getByRole('combobox', { name: 'Publication age', exact: true }).selectOption('unlimited');
  await page.getByRole('combobox', { name: 'Content language', exact: true }).selectOption('yue');
  proposal = await preview(page);
  expect(proposal.effective_brief?.campaign).toMatchObject({ language: 'yue', require_language: false });
  expect(proposal.preparation.provenance).toMatchObject({ max_evidence_age_days: 'explicit', language: 'explicit', require_language: 'explicit' });
  expect(proposal.finalized.fields.max_evidence_age_days.state).toBe('resolved');
  await page.getByLabel('Require evidence of this language').check();
  proposal = await preview(page);
  expect(proposal.effective_brief?.campaign).toMatchObject({ language: 'yue', require_language: true });
  await page.getByRole('combobox', { name: 'Content language', exact: true }).selectOption('none');
  proposal = await preview(page);
  expect(proposal.preparation.decisions?.language).toEqual({ language: null, require_language: false });
  expect(proposal.initial.criteria.language).toBe('yue');
  expect(proposal.finalized.criteria.language).toBeNull();
  await assertNoWrites(page);
});

test('a 30-day text and 90-day field conflict preserves the audit and persists only the approved age', async ({ page }) => {
  await fill(page, 'Find local café publications from the past 30 days.');
  await page.getByText('Research scope and alternatives', { exact: true }).click();
  await page.getByRole('combobox', { name: 'Publication age', exact: true }).selectOption('maximum');
  await page.getByLabel('Maximum publication age (days)', { exact: true }).fill('90');

  const blocked = await preview(page);
  expect(blocked.execution.status).toBe('blocked');
  expect(blocked.initial.issues).toEqual(expect.arrayContaining([
    expect.objectContaining({
      field: 'max_evidence_age_days',
      code: 'conflicting_criteria',
      candidates: expect.arrayContaining([
        expect.objectContaining({ value: 90, origin: 'explicit' }),
        expect.objectContaining({ value: 30, origin: 'text' }),
      ]),
    }),
  ]));
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Clarified maximum publication age (days)')).toBeVisible();
  await assertNoWrites(page);

  await page.getByLabel('Clarified maximum publication age (days)').fill('30');
  const approved = await preview(page, 'Use maximum age and preview');
  expect(approved.execution.status).toBe('ready');
  expect(approved.initial).toEqual(blocked.initial);
  expect(approved.effective_brief?.max_evidence_age_days).toBe(30);
  await assertNoWrites(page);

  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page).toHaveURL(/research\?run=/);
  const response = await page.request.get(runs);
  expect(response.ok()).toBe(true);
  const stored = await response.json();
  expect(stored).toHaveLength(1);
  expect(stored[0].confirmed_criteria.proposal).toMatchObject({
    fingerprint: approved.fingerprint,
    initial: blocked.initial,
    effective_brief: { max_evidence_age_days: 30 },
  });
  expect(stored[0].brief.max_evidence_age_days).toBe(90);
});

test('reserve one campaign and replay exact approval after actual lost save and submission responses', async ({ page }) => {
  await fill(page, 'Find YouTube short videos for local cafés.', 'new');
  const calls: string[] = [];
  const saves: unknown[] = [], submissions: unknown[] = [];
  let firstRunId: string | undefined;
  page.on('request', (item) => {
    if (item.method() === 'POST' || item.method() === 'PUT') calls.push(requestPath(item.url()));
  });
  const proposed = await preview(page);
  const id = proposed.preparation.campaign_id;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  await assertNoWrites(page);

  // Both writes reach the real API. The browser loses each first response.
  await page.route(routeFor(campaigns + '/' + id), async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    saves.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    if (saves.length === 1) await route.abort('failed');
    else await route.fulfill({ response });
  });
  await page.route(routeFor(runs), async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    submissions.push(route.request().postDataJSON());
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    const receipt = await response.json();
    if (submissions.length === 1) {
      firstRunId = receipt.id;
      await route.abort('failed');
    } else {
      expect(receipt.id).toBe(firstRunId);
      await route.fulfill({ response });
    }
  });
  const approve = page.getByRole('button', { name: 'Confirm, create campaign and start research', exact: true });
  await approve.evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByRole('alert').filter({ hasText: 'The campaign save could not be confirmed' })).toBeFocused();
  const saved = await (await page.request.get(campaigns)).json();
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ id, version: 1, draft: { evaluation: { platform: 'youtube', deliverable: 'short_video' } } });
  expect(submissions).toHaveLength(0);
  await page.getByRole('button', { name: 'Retry approved research' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'The company campaign was saved. The research start could not be confirmed.' })).toBeFocused();
  await expect(page.getByLabel('What are you trying to find?')).toBeDisabled();
  await page.getByRole('button', { name: 'Retry approved research' }).click();
  await expect(page).toHaveURL(/research\?run=/);
  expect(new URL(page.url()).searchParams.get('run')).toBe(firstRunId);
  expect(saves[0]).toEqual(saves[1]);
  expect(submissions[0]).toEqual(submissions[1]);
  expect(submissions[0]).toEqual({ ...proposed.preparation, request_key: expect.any(String),
    confirmation: { action: 'confirm', version: proposed.finalized.version, proposal_fingerprint: proposed.fingerprint } });
  expect(calls).toEqual([runs + '/preview', campaigns + '/' + id, campaigns + '/' + id, runs, runs]);
  expect((await (await page.request.get(campaigns)).json())).toHaveLength(1);
  const stored = await (await page.request.get(runs)).json();
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({ id: firstRunId, campaign_id: id, criteria_version: 'research-criteria-v1' });
});

test('material edits and delayed previews cannot restore an older approval', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fill(page, 'Find YouTube short videos for local cafés.');
  await page.getByText('Outcome assumptions (optional)', { exact: true }).click();
  let release!: () => void, fetched!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const reached = new Promise<void>((resolve) => { fetched = resolve; });
  let requests = 0;
  await page.route(routeFor(runs + '/preview'), async (route) => {
    const count = ++requests;
    const response = await route.fetch();
    if (count === 1) {
      fetched();
      await held;
    }
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: previewButton }).focus();
  await page.keyboard.press('Enter');
  await reached;
  await page.getByLabel('What are you trying to find?').fill('Find TikTok short videos for local cafés.');
  const second = await preview(page);
  expect(second.effective_brief?.campaign.platform).toBe('tiktok');
  await expect(page.getByLabel('Research criteria preview', { exact: true })).toBeFocused();
  release();
  await expect(page.locator('.rc-criteria')).toContainText('TikTok');
  await expect(page.getByRole('button', { name: confirm, exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByLabel('Impressions', { exact: true }).fill('5200');
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  const edited = await preview(page);
  expect(edited.preparation.brief.scenario?.impressions).toBe(5200);
  await page.getByLabel('Save research to').selectOption('new');
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  const replacement = await preview(page);
  expect(replacement.preparation.campaign_id).not.toBeNull();
  await page.goto('/research?q=another');
  await expect(page.getByRole('heading', { name: 'Review research criteria' })).toHaveCount(0);
  await assertNoWrites(page);
});

test('stale, unresolved, identity and snapshot errors never trigger unattended writes or legacy fallback', async ({ page }) => {
  await fill(page, 'Find YouTube short videos for local cafés.');
  const envelopes: Array<ResearchPreparation & { request_key: string }> = [];
  const failures = ['research_confirmation_stale', 'research_criteria_unresolved', 'research_request_changed', 'research_snapshot_invalid'];
  await page.route(routeFor(runs), async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    envelopes.push(route.request().postDataJSON());
    const code = failures[envelopes.length - 1];
    await route.fulfill({ status: code === 'research_criteria_unresolved' ? 422 : 409, json: { error: { code } } });
  });
  await preview(page);
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Review the current preview and confirm again' })).toBeVisible();
  await expect(page.getByRole('button', { name: confirm, exact: true })).toBeEnabled();
  expect(envelopes).toHaveLength(1);
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'need clarification' })).toBeVisible();
  await expect(page.getByRole('button', { name: confirm, exact: true })).toBeEnabled();
  expect(envelopes).toHaveLength(2);
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'belongs to different research' })).toBeFocused();
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to brief and prepare again' }).click();
  await preview(page);
  await page.getByRole('button', { name: confirm, exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'could not be verified' })).toBeFocused();
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
  expect(envelopes).toHaveLength(4);
  expect(new Set(envelopes.map((envelope) => envelope.request_key)).size).toBe(4);
  expect(envelopes.every((envelope) => envelope.protocol === 'confirmed-v1')).toBe(true);
  await assertNoWrites(page);
});

test('a company switch discards a delayed preview and leaves both companies without writes', async ({ page }) => {
  await fill(page, 'Find YouTube short videos for local cafes.');
  let fetched!: () => void, release!: () => void;
  const reached = new Promise<void>((resolve) => { fetched = resolve; });
  const held = new Promise<void>((resolve) => { release = resolve; });
  const oldCompany = await (await page.request.get(company + '/session')).json();
  await page.route(routeFor(runs + '/preview'), async (route) => {
    const response = await route.fetch();
    expect(response.ok()).toBe(true);
    fetched();
    await held;
    await route.fulfill({ response }).catch(() => {});
  });
  await page.getByRole('button', { name: previewButton }).click();
  await reached;
  await assertNoWrites(page);
  const response = await page.request.post(company + '/register', {
    data: { name: 'Replacement company ' + randomUUID().slice(0, 12), username: 'other-' + randomUUID().slice(0, 12), password: randomUUID() },
  });
  expect(response.status()).toBe(201);
  const active = await response.json();
  expect(active.id).not.toBe(oldCompany.id);
  await page.evaluate(() => window.dispatchEvent(new Event('company-session')));
  await expect(page.getByRole('button', { name: active.name, exact: true })).toBeVisible();
  await expect(page.getByLabel('What are you trying to find?')).toHaveValue('');
  release();
  await expect(page.getByRole('heading', { name: 'Review research criteria' })).toHaveCount(0);
  await assertNoWrites(page);
  const denied = await page.request.get(runs, { headers: { 'X-Harbourline-Company': oldCompany.id } });
  expect(denied.status()).toBe(409);
  expect((await denied.json()).error.code).toBe('company_changed');
});

test('a concurrent campaign save conflict keeps the reservation and opens the current saved campaign', async ({ page }) => {
  await fill(page, 'Find YouTube short videos for local cafes.', 'new');
  const proposed = await preview(page);
  const id = proposed.preparation.campaign_id;
  expect(id).not.toBeNull();
  const current = { ...blankBrief, name: 'Concurrent editor campaign', description: 'Current saved campaign brief' };
  const response = await page.request.put(campaigns + '/' + id, {
    data: { version: 0, draft: { brief: current, saved: true, shortlist: [], explorer: '', lines: [] } },
  });
  expect(response.ok()).toBe(true);
  await page.getByRole('button', { name: 'Confirm, create campaign and start research', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'A different revision exists for this campaign' })).toBeFocused();
  expect(await (await page.request.get(runs)).json()).toEqual([]);
  const [saved] = await (await page.request.get(campaigns)).json();
  expect(saved).toMatchObject({ id, version: 1, draft: { brief: current } });
  await page.getByRole('link', { name: 'Open the current saved campaign' }).click();
  await expect(page.getByLabel('Save research to')).toHaveValue(id!);
  await expect(page.getByLabel('Product or campaign')).toHaveValue(current.name);
  await expect(page.getByRole('button', { name: confirm, exact: true })).toHaveCount(0);
});
