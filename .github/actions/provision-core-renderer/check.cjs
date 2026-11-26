const path = require('node:path');
const { launchBrowser } = require(path.resolve('backend/core/render_document.cjs'));

async function check() {
  const start = performance.now();
  const browser = await launchBrowser();
  const launched = performance.now();
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    await page.setContent('<title>Core renderer check</title>');
    if (await page.title() !== 'Core renderer check') throw new Error('The offline document did not open.');
    const launchMs = Math.round(launched - start);
    const documentMs = Math.round(performance.now() - launched);
    process.stdout.write('Sandboxed Chromium ' + browser.version() + ' started in ' + launchMs +
      ' ms and opened the offline document in ' + documentMs + ' ms.\n');
  } finally {
    await browser.close();
  }
}

check().catch(error => {
  const lines = String(error.message).split('\n').filter(line => !line.includes('<launching>'));
  process.stderr.write(lines.join('\n').slice(0, 8000) + '\n');
  process.exitCode = 1;
});
