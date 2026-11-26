const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

async function render(input) {
  const { chromium } = createRequire(path.resolve(__dirname, '../../frontend/package.json'))('playwright-core');
  const { config, html, url, limit } = input;
  const pins = config.script_sha256.map(hash => "'sha256-" + Buffer.from(hash, 'hex').toString('base64') + "'");
  const browser = await chromium.launch({
    chromiumSandbox: true,
    executablePath: process.env.CORE_RENDER_BROWSER || undefined,
    timeout: 4000,
    args: ['--disable-background-networking', '--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
  try {
    const context = await browser.newContext({ offline: true, serviceWorkers: 'block', acceptDownloads: false });
    const page = await context.newPage();
    const policy = "sandbox allow-scripts; default-src 'none'; script-src " + pins.join(' ') +
      "; base-uri 'none'; form-action 'none'; frame-src 'none'; worker-src 'none'; connect-src 'none'";
    let supplied = false;
    let denied = null;
    let block;
    const blocked = new Promise(resolve => { block = resolve; });
    function deny(code) {
      denied = code;
      block({ error: code });
    }
    await context.exposeBinding('__corePolicyViolation', (_, directive) => {
      deny(String(directive).startsWith('script-src') ? 'render_script_denied' : 'render_resource_denied');
    });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => window.__corePolicyViolation(event.effectiveDirective), true);
    });
    await context.route('**/*', async route => {
      const request = route.request();
      if (!supplied && request.isNavigationRequest() && request.method() === 'GET' && request.url() === url &&
          request.frame() === page.mainFrame()) {
        supplied = true;
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
          headers: { 'content-security-policy': policy, 'x-dns-prefetch-control': 'off' }, body: html });
      }
      deny('render_resource_denied');
      await route.abort();
    });
    await context.routeWebSocket('**/*', socket => { deny('render_resource_denied'); socket.close(); });
    context.on('page', popup => { deny('render_resource_denied'); void popup.close(); });
    page.on('framenavigated', frame => {
      if (frame !== page.mainFrame() || frame.url() !== url) deny('render_resource_denied');
    });
    const read = async () => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: config.timeout_ms });
      if (await page.locator('script[src]').count()) return { error: 'render_script_denied' };
      const outcome = await page.waitForFunction(selector => {
        try { return document.querySelector(selector) ? 'ready' : false; }
        catch { return 'invalid'; }
      }, config.ready_selector, { timeout: config.timeout_ms });
      if (await outcome.jsonValue() !== 'ready') return { error: 'invalid_selector' };
      const result = await page.evaluate(max => {
        const dom = document.documentElement.outerHTML;
        return new TextEncoder().encode(dom).length > max ? null : dom;
      }, limit);
      if (denied) return { error: denied };
      return result === null ? { error: 'render_dom_limit' } : { html: result, engine: 'Chromium ' + browser.version() };
    };
    let timer;
    try {
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve({error: 'render_timeout'}), config.timeout_ms); });
      return await Promise.race([read(), blocked, deadline]);
    } catch (error) {
      if (denied) return { error: denied };
      return { error: error.name === 'TimeoutError' ? 'render_timeout' : 'render_unavailable' };
    } finally {
      clearTimeout(timer);
    }
  } finally {
    await browser.close();
  }
}

render(JSON.parse(fs.readFileSync(0, 'utf8')))
  .then(result => process.stdout.write(JSON.stringify(result)))
  .catch(() => { process.stdout.write(JSON.stringify({ error: 'render_unavailable' })); process.exitCode = 1; });
