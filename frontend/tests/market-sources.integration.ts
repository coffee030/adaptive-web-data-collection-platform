import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ trace: 'off' });

test('returning from a collection shows its original publisher and unavailable links expose no other controls', async ({ page }) => {
  test.skip(process.env.HARBOURLINE_RESEARCH_TEST_PILOT !== '1', 'Requires an operator-enabled release installation.');
  const key = process.env.MARKETING_OPERATOR_TOKEN;
  if (!key) throw new Error('Release navigation check requires the workstation test credential.');

  const job = randomUUID();
  const sources = ['first-publisher', 'second-publisher'].map((source) => ({
    key: source, name: source, platform: 'controlled-publication', rights_url: '',
    state: 'approved', publication: 'published', visible_count: 1, creator_count: 1,
    last_attempt: { job_id: job, state: 'succeeded', accepted: 1, invalid: 0, duplicates: 0 },
  }));
  await page.route('**/api/v1/marketing/intelligence/operator/market/sources', (route) =>
    route.fulfill({ json: { items: sources } }),
  );
  const register = '/operations/market-sources';
  const unlock = () => page.getByLabel('Choose operator key file').setInputFiles({
    name: 'navigation-test.token', mimeType: 'text/plain', buffer: Buffer.from(key),
  });
  await page.goto(register);
  await unlock();
  const first = page.getByRole('button', { name: 'first-publisher' });
  const second = page.getByRole('button', { name: 'second-publisher' });
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await second.click();
  const detail = page.getByRole('group', { name: 'Source details' });
  await expect(detail.getByRole('heading')).toHaveText('second-publisher');
  await detail.getByRole('link', { name: 'succeeded' }).click();
  await expect(page).toHaveURL(new RegExp('/collection-jobs/' + job + '$'));
  await page.goBack();
  await expect(second).toHaveAttribute('aria-pressed', 'true');
  await expect(detail.getByRole('heading')).toHaveText('second-publisher');
  await page.goto(register + '?source=missing');
  await unlock();
  await expect(page.getByText('This source is unavailable. Choose another source from the register.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Review withdrawal' })).toHaveCount(0);
  await first.click();
  await expect(detail.getByRole('heading')).toHaveText('first-publisher');
});
