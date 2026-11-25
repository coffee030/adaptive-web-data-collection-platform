import { defineConfig } from '@playwright/test';

const integration = process.env.M4_REAL_API === '1';
const deployed = integration && process.env.M4_DEPLOYED_FRONTEND === '1';
const port = Number(process.env.M4_FRONTEND_PORT || 5173);
const baseURL = `http://127.0.0.1:${port}`;
const browserName = process.env.PLAYWRIGHT_BROWSER ?? 'chromium';
if (browserName !== 'chromium' && browserName !== 'firefox' && browserName !== 'webkit') {
  throw new Error('PLAYWRIGHT_BROWSER must be chromium, firefox or webkit');
}

export default defineConfig({
  testDir: './tests',
  testMatch: integration ? '**/*.integration.ts' : '**/*.spec.ts',
  forbidOnly: Boolean(process.env.CI),
  outputDir: 'test-results',
  workers: 2,
  use: {
    baseURL,
    browserName,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer: deployed ? undefined : {
    env: { LOCAL_PROFILE_APPROVAL: integration ? process.env.LOCAL_PROFILE_APPROVAL ?? '0' : '1' },
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
  },
});
