import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { ProfileVersion, Source } from '../src/features/sources/api';

test('registers a pending CSV source in PostgreSQL and reads actual profile versions', async ({ page, request, baseURL }) => {
  const api = '/api/v1/sources';
  const health = await request.get('/api/v1/health');
  expect(health.ok()).toBe(true);
  const invalid = await request.post(api, { data: {
    source_name: 'M14 invalid policy fixture', adapter_type: 'web', permission_reference: 'Controlled test',
    allowed_origins: ['https://example.com'], allowed_paths: { 'https://another.example': ['/catalog'] },
  } });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error.code).toBe('invalid_source_policy');
  const fixtureName = 'M4-B approved fixture ' + randomUUID().slice(0, 8);
  const registered = await request.post(api, { data: {
    source_name: fixtureName, adapter_type: 'csv', permission_reference: 'Isolated integration fixture',
    allowed_datasets: ['listings'], approval_status: 'approved',
  } });
  expect(registered.status()).toBe(201);
  const fixture: Source = await registered.json();
  const createdVersion = await request.post(api + '/' + fixture.source_id + '/versions', { data: { configuration: {
    adapter_type: 'csv', config_schema_version: '1',
    record_schema: { record_type: 'listing', schema_version: '1', fields: [{ name: 'title' }] },
    columns: [{ name: 'title', column: 'Name' }],
  } } });
  expect(createdVersion.status()).toBe(201);
  const version = await createdVersion.json();
  const versionPath = api + '/' + fixture.source_id + '/versions/' + version.profile_version_id;
  const validated = await request.post(versionPath + '/validate', { data: {
    adapter_type: 'csv', dataset_id: 'listings', content: 'Name\nFixture\n',
  } });
  expect(validated.status()).toBe(200);
  const report = await validated.json();
  expect(report.passed).toBe(true);
  const approvedResponse = await request.post(versionPath + '/approve', { headers: { Origin: baseURL! }, data: {
    approver: 'M4-B integration operator', report_id: report.report_id, config_hash: version.config_hash,
  } });
  expect(approvedResponse.status()).toBe(200);

  await page.goto('/sources');
  await page.getByRole('link', { name: 'Create source' }).click();
  const name = `M4-B CSV ${randomUUID().slice(0, 8)}`;
  await page.getByRole('textbox', { name: 'Source name' }).fill(name);
  await page.getByRole('textbox', { name: 'Permission reference' }).fill('Isolated integration fixture');
  await page.getByRole('textbox', { name: 'Allowed dataset IDs' }).fill('listings');
  const posted = page.waitForResponse(response => new URL(response.url()).pathname === api
    && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create source' }).click();
  const response = await posted;
  expect(response.status()).toBe(201);
  const source: Source = await response.json();
  expect(source.approval_status).toBe('pending');
  await expect(page).toHaveURL('/sources/' + source.source_id);
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await expect(page.getByText('Source registered.', { exact: false })).toBeVisible();
  await expect(page.getByText('No profile versions registered for this source.')).toBeVisible();
  expect(await (await request.get(api + '/' + source.source_id)).json()).toEqual(source);

  const fixturePath = '/sources/' + fixture.source_id;
  const versions = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + fixturePath + '/versions');
  await page.goto(fixturePath);
  const versionResponse = await versions;
  expect(versionResponse.status()).toBe(200);
  const data: ProfileVersion[] = await versionResponse.json();
  const approved = data.find(version => version.approval_status === 'approved');
  if (!approved) throw new Error('Expected an approved profile from the existing authorized fixture.');
  const versionsTable = page.getByRole('table', { name: /Profile versions/ });
  await versionsTable.getByRole('link', { name: `Open profile version ${approved.version}` }).click();
  await page.getByText('Version technical details', { exact: true }).click();
  await expect(page.getByText(approved.config_hash, { exact: true })).toBeVisible();
  await expect(page.getByText(approved.profile_version_id, { exact: true })).toBeVisible();
});
