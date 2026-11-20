import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { adjudicate, capSeconds, journal, loadAttempt, persistStop, requireRecordedResult, stamp, writeEvidence } from './m22c_completion.mjs';

const { chromium } = createRequire(new URL('../../frontend/package.json', import.meta.url))('@playwright/test');
const api = process.env.M22C_API ?? 'http://127.0.0.1:58196';
const dashboard = process.env.M22C_DASHBOARD ?? 'http://127.0.0.1:5224';
const mirror = process.env.M22C_MIRROR ?? 'http://127.0.0.1:58197';
const origin = 'http://collection-fixture:8001';
const evidence = resolve('.local/m22c');
const productSha = '5fcff7a2ac4283cfba69ce6f43e6380be6c8094a';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const reference = { id: 'reference', name: 'M22C Reference', path: '/m22a/cards/reference/', keyword: 'C++ & tea', limit: 4 };
const assignments = [
  { id: 'M22A-01', arm: 'manual', name: 'Cards A', path: '/m22a/cards/a/', keyword: 'spring update', limit: 4 },
  { id: 'M22A-02', arm: 'manual', name: 'Catalog B', path: '/m22a/catalog/b/', keyword: 'autumn update', limit: 5 },
  { id: 'M22A-03', arm: 'assisted', name: 'Cards B', path: '/m22a/cards/b/', keyword: 'autumn update', limit: 4 },
  { id: 'M22A-04', arm: 'assisted', name: 'Catalog A', path: '/m22a/catalog/a/', keyword: 'spring update', limit: 5 },
];

async function sources(path = '', method = 'GET', body) {
  const response = await fetch(api + '/api/v1/sources' + path, {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  assert(response.ok, JSON.stringify({ path, method, status: response.status, result }));
  return result;
}

async function getSource(task, create = false) {
  const matches = (await sources()).filter(row => row.source_name === task.name);
  assert(matches.length <= 1, 'Duplicate assigned Source');
  let [source] = matches;
  const policy = {
    source_name: task.name, adapter_type: 'web', permission_reference: 'Frozen M22A controlled fixture; M22C coordinator authorization',
    allowed_origins: [origin], allowed_paths: { [origin]: [task.path] }, min_request_interval_ms: 2000,
  };
  if (!source && create) source = await sources('', 'POST', policy);
  assert(source, 'Source must be provisioned first');
  for (const [key, value] of Object.entries(policy)) assert.deepEqual(source[key], value);
  if (source.approval_status === 'pending' && create) {
    source = await sources('/' + source.source_id + '/authorization', 'PATCH', { approval_status: 'approved' });
  }
  assert.equal(source.approval_status, 'approved');
  assert.deepEqual(await sources('/' + source.source_id + '/versions'), [], 'Assigned Profile must be blank');
  return source;
}

function observe(context, record, sourceId) {
  const active = new Map();
  const pending = new Set();
  let nextId = 0;
  context.on('request', request => {
    const url = new URL(request.url());
    const sourcePrefix = '/api/v1/sources/' + sourceId + '/';
    const sourceWrite = url.origin === dashboard && url.pathname.startsWith('/api/v1/') && request.method() !== 'GET';
    if (sourceWrite && !url.pathname.startsWith(sourcePrefix)) {
      record('observation_gap', { reason: 'API write outside the assigned Source', url: request.url() });
    }
    const productRequest = url.origin === dashboard && url.pathname.startsWith(sourcePrefix);
    if (!productRequest && (url.origin === dashboard || !['http:', 'https:'].includes(url.protocol))) return;
    if (productRequest && request.method() === 'GET') return;
    const id = ++nextId;
    const kind = productRequest ? url.pathname.split('/').at(-1) : 'site';
    active.set(request, { id, kind });
    record('request', { id, kind, url: request.url(), method: request.method(), ...(productRequest ? { body: request.postData() } : {}) });
  });
  context.on('response', response => {
    const observed = stamp();
    const entry = active.get(response.request());
    if (!entry) return;
    const { id, kind } = entry;
    record('response', { id, kind, status: response.status() }, observed);
    if (kind === 'site') return;
    const capture = (async () => {
      try {
        const result = await response.json();
        record('api_body', { id, kind, result });
      } catch (error) {
        record('observation_gap', { id, reason: String(error) });
      }
    })();
    pending.add(capture);
    void capture.finally(() => pending.delete(capture));
  });
  for (const [event, label] of [['requestfinished', 'request_finished'], ['requestfailed', 'request_failed']]) {
    context.on(event, request => {
      const entry = active.get(request);
      if (!entry) return;
      record(label, { id: entry.id, failure: request.failure()?.errorText });
      active.delete(request);
    });
  }
  return { drain: () => Promise.all([...pending]) };
}

async function startBrowser(record, sourceId, headless) {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge', headless });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const observation = observe(context, record, sourceId);
    const page = await context.newPage();
    page.on('crash', () => record('observation_gap', { reason: 'Dashboard page crashed' }));
    await page.goto(dashboard + '/sources/' + sourceId);
    return { browser, context, page, ...observation };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

function card(task, sourceId) {
  const aid = task.arm === 'manual'
    ? 'Use the Dashboard, browser and DOM inspector to choose the mappings.'
    : 'You may also use Get a profile suggestion with the registered internal origin plus the assigned homepage path. Review the explanations and choose any corrections yourself.';
  return [
    task.id + ' · ' + task.name + ' · ' + task.arm,
    'Dashboard Source  ' + dashboard + '/sources/' + sourceId,
    'Permitted homepage  ' + mirror + task.path,
    'Registered Source origin  ' + origin,
    'Keyword  ' + task.keyword,
    'Choose Create draft and Keyword search and detail pages. ' + aid,
    'Map one publication link per result. Use record type publication, required title (Text) and count (Integer), and title as identity.',
    'Set one detail page, ' + task.limit + ' maximum HTTP requests and a two-second request timeout. Leave the next-link selector blank.',
    'Create the draft, enter the sample keyword, run Preview, inspect its values, and run Validate sample. After a correction, save and rerun both checks.',
    'In Approval review, open Approval references. Capture the matching version, revision, hash and passing report ID. Enter your approver label, confirm and approve.',
    'Signal the coordinator when the Dashboard confirms approval for those references. Stop at 15 minutes or if you abandon.',
    'If blocked, request the permitted examples from the coordinator. The clock continues.',
  ].join('\n');
}

async function trial(id) {
  const index = assignments.findIndex(task => task.id === id);
  assert(index >= 0, 'Select the next frozen assignment');
  const task = assignments[index];
  for (const previous of assignments.slice(0, index)) {
    const attempt = assignedAttempt(previous);
    assert(attempt.events.some(row => row.event === 'start'), 'Previous assignment has no start record');
    const result = readFileSync('docs/evaluation/m22c-onboarding-results.csv', 'utf8').split(/\r?\n/)
      .find(line => line.split(',')[0].replace(/^"|"$/g, '') === previous.id);
    requireRecordedResult(adjudicate(attempt.events, attempt.versions, attempt), result?.split(',')[8]?.replace(/^"|"$/g, ''));
  }
  assert(existsSync(resolve(evidence, 'technical-readiness.json')), 'Reference evidence must be verified first');
  const directory = resolve(evidence, id);
  assert(!existsSync(directory), 'Trial evidence exists. Audit its provenance and preserve the attempt.');
  const source = await getSource(task);
  const input = createInterface({ input: process.stdin, output: process.stdout });
  let session;
  let timer;
  try {
    const operator = (await input.question('Operator alias: ')).trim();
    const dashboardFamiliarity = (await input.question('Dashboard familiarity: ')).trim();
    const layoutFamiliarity = (await input.question('Layout familiarity: ')).trim();
    const exposure = (await input.question('Relevant prior exposure: ')).trim();
    assert(operator && dashboardFamiliarity && layoutFamiliarity && exposure, 'Record all operator context before opening the card');
    for (const previous of assignments.slice(0, index)) {
      assert.equal(assignedAttempt(previous).events[0].operator, operator, 'Primary pilot uses the same operator');
    }
    mkdirSync(directory);
    const record = journal(directory);
    record('operator', { trial_id: id, arm: task.arm, operator, dashboardFamiliarity, layoutFamiliarity, exposure, source,
      product_sha: productSha, evaluation_sha: git('rev-parse', 'HEAD'), dashboard, mirror, api });
    session = await startBrowser(record, source.source_id, false);
    await input.question('Press Enter to open the card and start the clock when ready. ');
    const start = stamp();
    record('start', { startedAt: start.utc }, start);
    const expiry = new AbortController();
    let observed;
    let signal = 'interrupted';
    const halt = () => {
      observed = stamp();
      expiry.abort();
    };
    input.once('close', halt);
    timer = setTimeout(halt, Math.max(0, Math.ceil(start.mono_ms + capSeconds * 1000 - performance.now())));
    console.log(card(task, source.source_id));
    let fallbackUsed = false;
    const seconds = at => (at.mono_ms - start.mono_ms) / 1000;
    try {
      while (seconds(stamp()) < capSeconds) {
        const answer = (await input.question('Press Enter on confirmed approval, A then Enter to abandon, or F then Enter to request fallback: ', { signal: expiry.signal })).trim();
        const received = stamp();
        if (seconds(received) >= capSeconds || expiry.signal.aborted) break;
        if (answer === '') {
          observed = received;
          signal = 'dashboard_confirmation';
          break;
        }
        if (answer.toLowerCase() === 'a') {
          observed = received;
          signal = 'abandonment';
          break;
        }
        if (answer.toLowerCase() === 'f' && !fallbackUsed) {
          const fallbackSeconds = seconds(received);
          const fallbackReason = (await input.question('Fallback reason: ', { signal: expiry.signal })).trim();
          if (seconds(stamp()) >= capSeconds || expiry.signal.aborted) break;
          if (!fallbackReason) continue;
          fallbackUsed = true;
          const search = new URLSearchParams({ [task.path.includes('/cards/') ? 'q' : 'term']: task.keyword });
          const target = task.path.endsWith('/a/') ? 'harbor' : 'solar';
          record('fallback', { elapsed_seconds: fallbackSeconds, reason: fallbackReason });
          for (const siteOrigin of [mirror, origin]) {
            console.log(siteOrigin + task.path + 'search?' + search);
            console.log(siteOrigin + task.path + 'detail/' + target);
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') throw error;
    }
    const stop = persistStop(directory, record, start, observed ?? stamp(), signal, { operator, fallback_used: fallbackUsed });
    clearTimeout(timer);
    input.off('close', halt);
    const capture = captureTerminal(directory, source.source_id, session, record);
    if (stop.signal === 'abandonment') {
      const closed = new AbortController();
      input.once('close', () => closed.abort());
      try {
        const reason = (await input.question('Reason for abandonment: ', { signal: closed.signal })).trim();
        if (reason) record('abandonment_reason', { reason });
      } catch (error) {
        record('observation_gap', { reason: String(error) });
      }
    }
    await capture;
    await session.browser.close();
    printResult(directory);
  } finally {
    clearTimeout(timer);
    input.close();
    await session?.browser.close();
  }
}

async function saveVersions(directory, sourceId) {
  const final = await sources('/' + sourceId + '/versions');
  writeEvidence(directory, 'versions.json', final);
  return final;
}

async function captureTerminal(directory, sourceId, session, record, screenshot = 'terminal.png') {
  for (const capture of [
    () => session.page.screenshot({ path: resolve(directory, screenshot), timeout: 5000 }),
    async () => {
      const versions = await saveVersions(directory, sourceId);
      record('snapshot', { version_count: versions.length });
    },
    () => session.drain(),
  ]) {
    try {
      await capture();
    } catch (error) {
      record('observation_gap', { reason: String(error) });
    }
  }
}

function printResult(directory) {
  const attempt = loadAttempt(directory);
  const result = adjudicate(attempt.events, attempt.versions, attempt);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

function assignedAttempt(task) {
  const attempt = loadAttempt(resolve(evidence, task.id));
  const header = attempt.events[0];
  assert(header?.event === 'operator' && header.trial_id === task.id && header.arm === task.arm
    && header.product_sha === productSha && /^[a-f0-9]{40}$/.test(header.evaluation_sha)
    && header.source?.source_name === task.name && header.source.approval_status === 'approved',
    'Review the provenance of the existing attempt before proceeding');
  assert.deepEqual(header.source.allowed_origins, [origin]);
  assert.deepEqual(header.source.allowed_paths, { [origin]: [task.path] });
  return attempt;
}

async function resume(id) {
  const task = assignments.find(row => row.id === id);
  assert(task, 'Select an existing assignment to audit');
  const directory = resolve(evidence, id);
  const attempt = assignedAttempt(task);
  if (attempt.stop?.schema === 1 && !attempt.evidenceIssue
    && !existsSync(resolve(directory, 'versions.json'))) {
    assert.equal(attempt.events[0].api, api, 'Use the API origin recorded for this attempt');
    try {
      await saveVersions(directory, attempt.events[0].source.source_id);
    } catch (error) {
      console.error('Could not capture the later readback', error.message);
    }
  }
  printResult(directory);
}

async function rehearse(id = 'reference', timing = 'verified') {
  assert(/^reference(?:-[a-z0-9-]+)?$/.test(id), 'Select a reference-only evidence directory');
  assert(['verified', 'early'].includes(timing), 'Select verified or early reference timing');
  const task = id === reference.id ? reference : { ...reference, id, name: `${reference.name} ${id}` };
  const directory = resolve(evidence, id);
  assert(!existsSync(directory), 'Reference evidence directory already exists');
  const source = await getSource(task, true);
  mkdirSync(directory);
  const record = journal(directory);
  record('rehearsal', { source, technical: true, product_sha: productSha, evaluation_sha: git('rev-parse', 'HEAD'), dashboard, api, mirror });
  const session = await startBrowser(record, source.source_id, true);
  const { browser, context, page } = session;
  try {
    const start = stamp();
    record('start', { startedAt: start.utc }, start);
    const site = await context.newPage();
    record('action', { name: 'mirror' });
    const entry = await site.goto(mirror + task.path);
    assert.equal(entry.status(), 200);
    await site.locator('form input[name=q]').fill(task.keyword);
    await Promise.all([site.waitForNavigation(), site.locator('form input[name=q]').press('Enter')]);
    assert.equal(site.url(), mirror + task.path + 'search?q=C%2B%2B+%26+tea');
    await site.locator('a.publication').first().click();
    assert.equal(site.url(), mirror + task.path + 'detail/alpha');
    await site.close();

    await page.getByRole('link', { name: 'Create draft', exact: true }).click();
    await page.getByText('Get a profile suggestion', { exact: true }).click();
    await page.getByRole('textbox', { name: 'Discovery keyword' }).fill(task.keyword);
    async function discover(path) {
      await page.getByRole('textbox', { name: 'Homepage URL' }).fill(origin + path);
      const result = page.waitForResponse(reply => reply.url().endsWith('/profile-suggestions'));
      await page.getByRole('button', { name: 'Find suggestion', exact: true }).click();
      return (await result).json();
    }
    record('action', { name: 'policy rejection' });
    const denied = await discover('/');
    assert.equal(denied.actual_attempts, 0);
    assert(denied.requests.some(entry => entry.state === 'denied_before_send'));
    record('action', { name: 'discovery' });
    const suggested = await discover(task.path);
    assert.equal(suggested.outcome, 'usable');
    assert.equal(suggested.actual_attempts, 4);
    assert.equal(suggested.proposal.search.max_requests, 3);
    await page.getByRole('button', { name: 'Apply to editor' }).click();
    await page.getByText('Pagination and request limits', { exact: true }).click();
    await page.getByRole('spinbutton', { name: 'Maximum HTTP requests' }).fill(String(task.limit));
    const draftResponse = page.waitForResponse(reply => reply.url().endsWith('/versions') && reply.request().method() === 'POST');
    await page.getByRole('button', { name: 'Create draft', exact: true }).click();
    const draft = await (await draftResponse).json();
    assert.equal(draft.configuration.search.max_requests, task.limit);
    await page.getByRole('textbox', { name: 'Sample keyword' }).fill(task.keyword);
    record('action', { name: 'preview' });
    const previewResponse = page.waitForResponse(reply => reply.url().endsWith('/preview'));
    await page.getByRole('button', { name: 'Preview', exact: true }).click();
    assert.equal((await (await previewResponse).json())[0].payload.title, 'Alpha outlook');
    await page.getByRole('table', { name: /Preview candidates/ }).waitFor();
    record('action', { name: 'validate' });
    const validation = page.waitForResponse(reply => reply.url().endsWith('/validate'));
    await page.getByRole('button', { name: 'Validate sample' }).click();
    const report = await (await validation).json();
    assert.equal(report.passed, true);
    assert.equal(report.config_hash, draft.config_hash);
    assert.equal(report.profile_version_id, draft.profile_version_id);
    await page.getByRole('heading', { name: 'Validation passed' }).waitFor();
    await page.getByRole('textbox', { name: 'Approver label' }).fill('M22C technical rehearsal');
    await page.getByRole('checkbox', { name: /confirm approval/ }).check();
    const stopReference = () => persistStop(directory, record, start, stamp(), 'dashboard_confirmation');
    if (timing === 'early') stopReference();
    record('action', { name: 'approval' });
    const approval = page.waitForResponse(reply => reply.url().endsWith('/approve'));
    const clock = performance.now();
    await page.getByRole('button', { name: 'Approve version' }).click();
    assert.equal((await approval).status(), 200);
    await page.getByText('Read only', { exact: true }).waitFor();
    if (timing === 'verified') stopReference();
    record('clock_check', { elapsed_ms: performance.now() - clock });
    const final = await sources('/' + source.source_id + '/versions/' + draft.profile_version_id);
    assert.equal(final.approval_status, 'approved');
    assert.equal(final.revision, draft.revision);
    assert.equal(final.config_hash, report.config_hash);
    assert.equal(final.validation_report_id, report.report_id);
    writeFileSync(resolve(directory, 'artifacts.json'), JSON.stringify({ source, final, report, suggested, denied }, null, 2), { flag: 'wx' });
    await captureTerminal(directory, source.source_id, session, record, 'approved.png');
    const verdict = printResult(directory);
    assert.equal(verdict.status, timing === 'verified' ? 'completed' : 'failed');
    record('rehearsal_finished', { adjudication: verdict });
  } catch (error) {
    record('observation_gap', { reason: String(error) });
    throw error;
  } finally {
    await browser.close();
  }
}

const [action, trialId, timing] = process.argv.slice(2);
mkdirSync(evidence, { recursive: true });
assert.deepEqual(git('diff', '--name-only', productSha, '--', 'backend', 'frontend', 'compose.yaml', 'compose.fixture.yaml', 'alembic.ini')
  .split('\n').filter(path => path && !path.startsWith('backend/experiments/m22c')), [],
  'Product files differ from the pinned revision');
if (action === 'provision') {
  const prepared = [];
  for (const task of assignments) prepared.push({ trial_id: task.id, source: await getSource(task, true), versions: 0 });
  writeFileSync(resolve(evidence, 'sources.json'), JSON.stringify(prepared, null, 2), { flag: 'wx' });
} else if (action === 'rehearse') {
  await rehearse(trialId, timing);
} else if (action === 'trial') {
  await trial(trialId);
} else if (action === 'resume') {
  await resume(trialId);
} else {
  throw new Error('Use provision, rehearse [reference-name] [verified|early], trial <trial_id>, or resume <trial_id>');
}
