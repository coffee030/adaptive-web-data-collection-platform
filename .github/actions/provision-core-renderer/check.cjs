const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium } = createRequire(path.resolve('frontend/package.json'))('playwright-core');

async function check() {
  const browser = await chromium.launch({
    executablePath: process.env.CORE_RENDER_BROWSER,
    chromiumSandbox: true,
    timeout: 4000,
    args: ['--disable-background-networking', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    await page.setContent('<title>Core renderer check</title>');
    if (await page.title() !== 'Core renderer check') throw new Error('The offline document did not open.');
    process.stdout.write('Sandboxed offline Chromium ' + browser.version() + ' opened the local document.\n');
  } finally {
    await browser.close();
  }
}

check().catch(error => {
  const lines = String(error.message).split('\n').filter(line => !line.includes('<launching>'));
  process.stderr.write(lines.join('\n').slice(0, 8000) + '\n');
  process.exitCode = 1;
});
