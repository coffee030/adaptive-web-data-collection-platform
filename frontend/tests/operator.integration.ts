import { expect, test } from '@playwright/test';
import type { Source } from '../src/features/sources/api';
import type { Profile } from '../src/features/profiles/api';
import type { Binding, Topic } from '../src/features/topic-collections/api';

test('a fresh Normal database starts with an empty operator workspace', async ({ page, request }) => {
  test.skip(process.env.M14_EMPTY_NORMAL !== '1', 'Requires a fresh isolated Normal database.');
  for (const entity of ['sources', 'categories', 'topics', 'collection-requests']) {
    const response = await request.get('/api/v1/' + entity);
    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual([]);
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/sources');
  await expect(page.getByText('No sources registered')).toBeVisible();
  await expect(page.getByText('Synthetic Demo.', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('normal-empty.png'), fullPage: true });
  await page.getByRole('link', { name: 'Categories and topics' }).click();
  await expect(page.getByText('No categories on this page.')).toBeVisible();
  await expect(page.getByText('Select a category to view or create its topics.')).toBeVisible();
});

test('three existing Synthetic Demo presets expose persisted eligible bindings and immutable versions', async ({ page }) => {
  const demo = process.env.M10_SYNTHETIC_URL;
  test.skip(!demo, 'Requires the isolated Synthetic Demo frontend.');
  const presets = ['Fixture Listings', 'Influencer Advertising and Sponsorship', 'Market News and Economic Updates'];
  const api = (path: string) => new URL('/api/v1' + path, demo!).href;
  const response = await page.request.get(api('/topics?limit=100'));
  expect(response.status()).toBe(200);
  const topics: Topic[] = await response.json();
  for (const name of presets) {
    const topic = topics.find(row => row.name === name);
    expect(topic?.active).toBe(true);
    const response = await page.request.get(api(`/topics/${topic!.id}/bindings?eligible_only=true`));
    expect(response.status()).toBe(200);
    const bindings: Binding[] = await response.json();
    expect(bindings).toHaveLength(2);
    for (const binding of bindings) {
      const source: Source = await (await page.request.get(api('/sources/' + binding.source_id))).json();
      const profile: Profile = await (await page.request.get(api(
        `/sources/${binding.source_id}/versions/${binding.profile_version_id}`,
      ))).json();
      expect(source.approval_status).toBe('approved');
      expect(profile.approval_status).toBe('approved');
      expect(profile.config_hash).toBe(binding.config_hash);
      expect(binding.approved_by).toBeTruthy();
    }
    await page.goto(new URL('/topics/' + topic!.id, demo!).href);
    await expect(page.getByText('Synthetic Demo.', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue to New Collection' })).toBeVisible();
    await page.getByRole('link', { name: /· Version/ }).first().click();
    await expect(page.getByText('Read only', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Output fields' })).toBeVisible();
  }
});
