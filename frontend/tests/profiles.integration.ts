import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import type { Configuration, Profile, Report } from '../src/features/profiles/api';

const prefix = '/api/v1/sources';
const fixtureOrigin = 'http://collection-fixture:8001';
const csvSample = 'Name,Count\nRiver Walk,2\nLake View,3\n';

for (const adapter of ['web', 'csv'] as const) {
  test(`real ${adapter} draft, preview, validation, and local approval`, async ({ page, request }) => {
    const web = adapter === 'web';
    const created = await request.post(prefix, { data: {
      source_name: `M4-C ${adapter} ${randomUUID().slice(0, 8)}`,
      adapter_type: adapter, permission_reference: 'Project fixture', approval_status: 'approved',
      ...(web ? { allowed_origins: [fixtureOrigin] } : { allowed_datasets: ['listings'] }),
    } });
    expect(created.status()).toBe(201);
    const sourceId: string = (await created.json()).source_id;
    await page.goto(`/sources/${sourceId}`);
    await page.getByRole('link', { name: 'Create draft', exact: true }).click();
    await page.getByRole('textbox', { name: 'Record type' }).fill('listing');
    if (web) await page.getByRole('textbox', { name: 'Item selector' }).fill('#entries tr');
    await page.getByRole('textbox', { name: 'Output field name' }).fill('title');
    await page.getByRole('textbox', { name: web ? 'Field selector' : 'CSV header', exact: true }).fill(web ? 'a' : 'Name');
    await page.getByRole('button', { name: 'Add field' }).click();
    const second = page.getByRole('group', { name: 'Field 2' });
    await second.getByRole('textbox', { name: 'Output field name' }).fill(web ? 'key' : 'count');
    await second.getByRole('textbox', { name: web ? 'Field selector' : 'CSV header', exact: true }).fill(web ? 'a' : 'Count');
    if (web) {
      await second.getByRole('combobox', { name: 'Extraction mode' }).selectOption('attribute');
      await second.getByRole('textbox', { name: 'Attribute name' }).fill('data-code');
    } else {
      await second.getByRole('combobox', { name: 'Value type' }).selectOption('integer');
    }
    await page.getByRole('combobox', { name: 'Identity field' }).selectOption(web ? '1' : '0');
    const draftResponse = page.waitForResponse(response => response.url().endsWith('/versions')
      && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    const draftReply = await draftResponse;
    expect(draftReply.status()).toBe(201);
    const profile: Profile = await draftReply.json();
    const version = `${prefix}/${sourceId}/versions/${profile.profile_version_id}`;
    const detail = `/sources/${sourceId}/profiles/${profile.profile_version_id}`;
    await expect(page).toHaveURL(detail);
    await page.getByRole('textbox', { name: 'Record type' }).fill('listing_item');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Draft saved.' })).toBeVisible();
    const saved: Profile = await (await request.get(version)).json();
    expect(saved.config_hash).not.toBe(profile.config_hash);
    expect(saved.configuration.record_schema.record_type).toBe('listing_item');

    async function fillSample() {
      if (web) await page.getByRole('textbox', { name: 'Document path' }).fill('/table.html');
      else {
        const fixture = await readFile(new URL('../../backend/tests/fixtures/m1/listings.csv', import.meta.url), 'utf-8');
        await page.getByRole('textbox', { name: 'CSV sample' }).fill(fixture);
      }
    }

    await fillSample();
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    await expect(page.getByRole('table', { name: /Preview candidates/ })).toContainText(web ? 'River Walk' : 'North Trail');
    if (!web) {
      await page.getByRole('button', { name: 'Validate sample' }).click();
      await expect(page.getByRole('heading', { name: 'Validation failed' })).toBeVisible();
      await page.getByRole('textbox', { name: 'CSV sample' }).fill(csvSample);
    }
    async function validate() {
      const response = page.waitForResponse(reply => reply.url().endsWith('/validate'));
      await page.getByRole('button', { name: 'Validate sample' }).click();
      const result: Report = await (await response).json();
      await expect(page.getByRole('heading', { name: 'Validation passed' })).toBeVisible();
      expect(result.config_hash).toBe(saved.config_hash);
      return result;
    }
    const passing = await validate();

    async function confirmApproval() {
      await page.getByRole('textbox', { name: 'Approver label' }).fill('M4-C fixture operator');
      await page.getByRole('checkbox', { name: /confirm approval/ }).check();
    }
    if (!web) {
      const changed: Configuration = { ...saved.configuration,
        record_schema: { ...saved.configuration.record_schema, record_type: 'another_revision' } };
      const intervening = await request.put(version, { data: { configuration: changed, expected_revision: saved.revision } });
      expect(intervening.ok()).toBe(true);
      const remote: Profile = await intervening.json();
      expect((await request.put(version, { data: { configuration: saved.configuration, expected_revision: remote.revision } })).ok()).toBe(true);
      await confirmApproval();
      const stale = page.waitForResponse(response => response.url().endsWith('/approve'));
      await page.getByRole('button', { name: 'Approve version' }).click();
      expect((await stale).status()).toBe(409);
      await expect(page.getByRole('alert')).toContainText('out of date');
      await page.getByRole('button', { name: 'Reload server version' }).click();
      await page.getByRole('textbox', { name: 'CSV sample' }).fill(csvSample);
      expect((await validate()).report_id).not.toBe(passing.report_id);
    }
    await confirmApproval();
    const accepted = page.waitForResponse(response => response.url().endsWith('/approve'));
    await page.getByRole('button', { name: 'Approve version' }).click();
    expect((await accepted).status()).toBe(200);
    await expect(page.getByText('Read only', { exact: true })).toBeVisible();
    await expect(page.getByText('M4-C fixture operator', { exact: true })).toBeVisible();
    const persisted: Profile = await (await request.get(version)).json();
    expect(persisted.approval_status).toBe('approved');
    expect(persisted.config_hash).toBe(saved.config_hash);
    expect((await request.put(version, { data: { configuration: saved.configuration } })).status()).toBe(409);
    await page.reload();
    await expect(page.getByRole('table', { name: 'Output fields' })).toBeVisible();
    await page.getByRole('link', { name: 'Source details' }).click();
    await expect(page.getByRole('link', { name: 'Open profile version 1' })).toBeVisible();
    console.log(adapter, persisted.profile_version_id, persisted.config_hash);
  });
}

test('proxy blocks untrusted approval origin and backend refuses a revoked Source', async ({ request }) => {
  const created = await request.post(prefix, { data: {
    source_name: `M4-C revoked ${randomUUID().slice(0, 8)}`, adapter_type: 'csv',
    permission_reference: 'Project fixture', approval_status: 'approved', allowed_datasets: ['listings'],
  } });
  expect(created.status()).toBe(201);
  const sourceId: string = (await created.json()).source_id;
  const result = await request.post(`${prefix}/${sourceId}/versions`, { data: { configuration: {
    adapter_type: 'csv', config_schema_version: '1',
    record_schema: { schema_version: '1', record_type: 'listing', fields: [{ name: 'title' }] },
    columns: [{ name: 'title', column: 'Name' }],
  } } });
  expect(result.status()).toBe(201);
  const profile: Profile = await result.json();
  const path = `${prefix}/${sourceId}/versions/${profile.profile_version_id}`;
  const validated = await request.post(path + '/validate', { data: {
    adapter_type: 'csv', dataset_id: 'listings', content: csvSample,
  } });
  const report: Report = await validated.json();
  expect(report.passed).toBe(true);
  const body = { approver: 'Fixture operator', report_id: report.report_id, config_hash: report.config_hash };
  const denied = await request.post(path + '/approve', { data: body, headers: { Origin: 'http://untrusted.invalid' } });
  expect(denied.status()).toBe(403);
  expect((await denied.json()).error.code).toBe('local_approval_required');
  const revoked = await request.patch(`${prefix}/${sourceId}/authorization`, { data: { approval_status: 'revoked' } });
  expect(revoked.ok()).toBe(true);
  const origin = new URL(denied.url()).origin;
  const rejected = await request.post(path + '/approve', { data: body, headers: { Origin: origin } });
  expect(rejected.status()).toBe(403);
  expect((await rejected.json()).error.code).toBe('source_not_approved');
});
