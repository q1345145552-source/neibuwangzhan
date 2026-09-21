#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Persistent standalone browser regression CLI. */
'use strict';

// Use an already-running isolated preview. The only mutations are new purchases and
// adjustments on this run's random sale IDs. Business responses always come from
// the real server; routing only delays delivery or simulates a lost response.
// Required: INTERNAL_SOURCE_ROOT, MERGE_URL, MERGE_BROWSER_OUT.
// Optional: MERGE_ADMIN_EMAIL, MERGE_CUSTOMER_EMAIL, MERGE_ADMIN_PASSWORD,
// MERGE_CUSTOMER_PASSWORD, MERGE_PASSWORD, PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');

function required(name) {
  assert(process.env[name], name + ' is required');
  return process.env[name];
}

const root = path.resolve(required('INTERNAL_SOURCE_ROOT'));
const base = new URL(required('MERGE_URL'));
assert(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Use a loopback isolated preview');
assert.equal(base.protocol, 'http:', 'Use the local HTTP preview');
const url = base.origin;
const out = path.resolve(required('MERGE_BROWSER_OUT'));
fs.mkdirSync(out, { recursive: true });
const localRequire = createRequire(path.join(root, 'package.json'));
const home = os.homedir();

function directories(directory) {
  return fs.existsSync(directory) ? fs.readdirSync(directory) : [];
}

function loadPlaywright() {
  const npx = path.join(home, '.npm', '_npx');
  for (const name of [
    'playwright', 'playwright-core',
    ...directories(npx).map(entry => path.join(npx, entry, 'node_modules', 'playwright')),
  ]) {
    try { return localRequire(name); } catch { /* Try an existing local installation. */ }
  }
  throw new Error('An existing Playwright installation is required; this test does not install dependencies');
}

function chromiumExecutable(playwright) {
  const override = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  if (override) {
    assert(fs.existsSync(override), 'Configured Chromium executable does not exist');
    return override;
  }
  const bundled = playwright.chromium.executablePath();
  if (fs.existsSync(bundled)) return bundled;
  const caches = [path.join(home, 'Library', 'Caches', 'ms-playwright'), path.join(home, '.cache', 'ms-playwright')];
  const tails = [
    'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
    'chrome-linux/chrome', 'chrome-linux64/chrome',
  ];
  for (const cache of caches) {
    for (const folder of directories(cache).filter(entry => /^chromium-\d+$/.test(entry)).sort().reverse()) {
      for (const tail of tails) {
        const candidate = path.join(cache, folder, tail);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  throw new Error('An existing Chromium executable is required; this test does not download browsers');
}

let fixture = {};
const fixtureFile = path.join(root, 'preview-fixture.json');
if (fs.existsSync(fixtureFile)) fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'));
const adminEmail = process.env.MERGE_ADMIN_EMAIL || 'admin@example.test';
const customerEmail = process.env.MERGE_CUSTOMER_EMAIL || (fixture.accounts?.includes('customer@example.test') ? 'customer@example.test' : 'h@example.test');
const password = process.env.MERGE_PASSWORD || fixture.password || 'SyntheticPass!42';
const adminPassword = process.env.MERGE_ADMIN_PASSWORD || password;
const customerPassword = process.env.MERGE_CUSTOMER_PASSWORD || password;

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function deadline(promise, label) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out: ' + label)), 30000);
    })]);
  } finally { clearTimeout(timer); }
}

function sanitized(value) {
  if (Array.isArray(value)) return value.map(sanitized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, /password|token/i.test(key) ? '[test credential omitted]' : sanitized(entry)]));
}

const result = {
  test: 'commerce-aftercare-command-recovery',
  sourceRoot: root, baseURL: url, startedAt: new Date().toISOString(),
  scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
  scope: 'New random-ID sales only; no product or existing sale updates; delayed/dropped transport with real business handlers',
  scenarios: [],
};

async function scenario(browser, mode) {
  const record = { name: mode, checks: [], http: [], events: [], pageErrors: [] };
  result.scenarios.push(record);
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, timezoneId: 'Asia/Bangkok' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => record.pageErrors.push(String(error)));
  const releaseA = deferred();
  const firstReceived = deferred();
  const bReceived = deferred();
  const requests = [];
  let routeError;

  async function api(route, method = 'GET', input, token) {
    const response = await context.request.fetch(url + route, {
      method, data: input, headers: token ? { Authorization: 'Bearer ' + token } : {},
    });
    const output = await response.json();
    record.http.push({ transport: 'API', route, method, input: sanitized(input), status: response.status(), output: sanitized(output) });
    assert(response.ok(), 'API ' + method + ' ' + route + ': ' + JSON.stringify(output));
    return output;
  }

  // Observe when the app has received and parsed a real response. A task queued
  // after json() resolves runs after useCommand's awaited continuation; this avoids
  // asserting before the stale callback has had a chance to clear shared storage.
  await page.addInitScript(() => {
    window.__commerceRecoveryResponses = [];
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const requestURL = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      const watched = args[1]?.method === 'POST' && /\/api\/commerce\/orders\/[^/]+\/adjustments$/.test(requestURL || '');
      const body = watched ? JSON.parse(args[1].body) : null;
      const response = await originalFetch(...args);
      if (watched) {
        const originalJSON = response.json.bind(response);
        response.json = async () => {
          const value = await originalJSON();
          setTimeout(() => window.__commerceRecoveryResponses.push({ request_id: body.request_id, status: response.status, code: value.code }), 0);
          return value;
        };
      }
      return response;
    };
  });

  try {
    const admin = await api('/api/auth/login', 'POST', { email: adminEmail, password: adminPassword });
    const customer = await api('/api/auth/login', 'POST', { email: customerEmail, password: customerPassword });
    const product = (await api('/api/commerce/products', 'GET', undefined, customer.token)).find(item => item.sku === 'COM-001');
    assert(product, 'The isolated preview must contain COM-001');
    assert(product.price_cents > 400, 'COM-001 must support ¥4 total test adjustments');
    const sale = (await api('/api/commerce/orders', 'POST', {
      request_id: 'ui-recovery-' + crypto.randomUUID(),
      lines: [{ product_id: product.id, quantity: 1, revision: product.revision, terms_version: product.terms.version }],
    }, customer.token)).sale;
    record.saleId = sale.id;
    record.customerAccountId = customer.user.id;
    const storage = 'commerce-action-' + admin.user.id + '-' + sale.id + '-credit';
    const adjustmentRoute = '/api/commerce/orders/' + sale.id + '/adjustments';

    await page.goto(url + '/login');
    await page.getByLabel('邮箱', { exact: true }).fill(adminEmail);
    await page.getByLabel('密码', { exact: true }).fill(adminPassword);
    await page.getByRole('button', { name: /登录/ }).click();
    await page.waitForURL(url + '/');
    await page.goto(url + '/commerce#' + sale.id);
    const card = page.locator('article[data-sale-id="' + sale.id + '"]');
    await card.waitFor();
    record.checks.push('Created a fresh customer sale and logged in through the real admin UI');

    await page.route('**' + adjustmentRoute, async route => {
      try {
        const input = route.request().postDataJSON();
        const index = requests.push(input);
        record.events.push({ kind: 'browser request', index, input });
        if (index === 1 && mode === 'late-terminal-409') {
          // Advance the real ledger before stale A reaches its actual handler.
          await api(adjustmentRoute, 'POST', {
            revision: sale.billing.revision, request_id: 'ui-intervening-' + crypto.randomUUID(),
            reason: 'Recovery test intervening operation',
            credits: [{ order_id: sale.billing.allocations[0].order_id, credit_cents: 100 }],
          }, admin.token);
        }
        const response = await route.fetch();
        const output = await response.json();
        record.http.push({ transport: 'browser route.fetch', route: adjustmentRoute, method: 'POST', input, status: response.status(), output });
        if (index <= 2 && mode === 'late-terminal-409') {
          assert.equal(response.status(), 409, 'A must hit a real terminal version conflict');
          assert.equal(output.code, 'REVISION_CHANGED');
        } else {
          assert(response.ok(), 'Real adjustment handler must succeed: ' + JSON.stringify(output));
        }
        if (index === 1) {
          record.events.push({ kind: 'A real response held', status: response.status() });
          firstReceived.resolve();
          await releaseA.promise;
          await route.fulfill({ response });
          record.events.push({ kind: 'A real response released', status: response.status() });
        } else if (index === 3) {
          assert.equal(output.billing.credited_cents, 300);
          record.events.push({ kind: 'B committed; only response delivery dropped', request_id: input.request_id });
          await route.abort('failed');
          bReceived.resolve();
        } else {
          await route.fulfill({ response });
        }
      } catch (error) {
        routeError = error;
        record.events.push({ kind: 'route failure', error: String(error) });
        firstReceived.resolve();
        bReceived.resolve();
        await route.abort('failed').catch(() => {});
      }
    });

    const credit = card.locator('details').filter({ hasText: '管理员追加账单减免' });
    const amount = credit.getByLabel('追加减免（元） COM-001 第 1 份', { exact: true });
    const reason = credit.getByLabel('公开减免说明', { exact: true });
    const submit = credit.getByRole('button', { name: '登记账单减免', exact: true, includeHidden: true });
    async function openCredit() {
      if (!await credit.evaluate(element => element.open)) await credit.locator('summary').click();
    }
    async function fill(value, note) {
      await openCredit();
      await amount.fill(value);
      await reason.fill(note);
      await submit.click();
    }
    async function noPending() {
      await page.waitForFunction(key => sessionStorage.getItem(key) === null, storage);
      await submit.waitFor({ state: 'attached' });
    }
    async function readPending() {
      return page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storage);
    }
    async function formReset(label) {
      await openCredit();
      assert.equal(await amount.inputValue(), '', label + ': amount reset');
      assert.equal(await reason.inputValue(), '', label + ': reason reset');
      assert.equal(await submit.isEnabled(), true, label + ': next command enabled');
      record.checks.push(label + ': cleared amount/reason and enabled the next command');
    }

    await fill('1.00', 'Recovery operation A');
    await deadline(firstReceived.promise, 'first actual A response');
    if (routeError) throw routeError;
    await page.getByRole('button', { name: '刷新订单', exact: true }).click();
    await card.getByText(/核对版本 1/).waitFor();
    await card.getByRole('button', { name: '重试确认此操作', exact: true }).click();
    await noPending();
    assert.equal(requests[1].request_id, requests[0].request_id, 'Remounted A retry preserves the original command ID');
    record.checks.push('Refresh remounted the command; retry resolved A using its original request_id');

    await fill('2.00', 'Recovery operation B');
    await deadline(bReceived.promise, 'B commit with lost reply');
    if (routeError) throw routeError;
    const pendingB = await readPending();
    assert(pendingB, 'Committed B must remain recoverable while its response is unconfirmed');
    assert.equal(pendingB.request_id, requests[2].request_id);
    assert.notEqual(pendingB.request_id, requests[0].request_id);
    record.events.push({ kind: 'B persisted before A release', pendingB });
    releaseA.resolve();
    await page.waitForFunction(({ id, count }) => window.__commerceRecoveryResponses.filter(entry => entry.request_id === id).length >= count, { id: requests[0].request_id, count: 2 });
    const afterA = await readPending();
    record.events.push({ kind: 'B storage after stale A handler completed', pendingB: afterA });
    assert.deepEqual(afterA, pendingB, 'Stale A ' + mode + ' must never delete or replace newer pending B');
    record.checks.push('Stale A completion preserved the exact persisted B body and request_id');
    const beforeRefresh = await api('/api/commerce/orders/' + sale.id, 'GET', undefined, admin.token);
    assert.equal(beforeRefresh.billing.credited_cents, 300);
    assert.equal(beforeRefresh.billing.adjustments.length, 2);
    record.checks.push('After lost B reply: real ledger is exactly ¥3 / 2 adjustments');

    await page.reload();
    await card.waitFor();
    await card.getByRole('button', { name: '重试确认此操作', exact: true }).waitFor();
    assert.deepEqual(await readPending(), pendingB, 'Reload must restore the original B command');
    await card.getByRole('button', { name: '重试确认此操作', exact: true }).click();
    await noPending();
    await card.getByText(/累计减免 ¥3.00/).waitFor();
    assert.equal(requests[3].request_id, pendingB.request_id, 'B retry must use its original request_id');
    const confirmed = await api('/api/commerce/orders/' + sale.id, 'GET', undefined, admin.token);
    assert.equal(confirmed.billing.credited_cents, 300);
    assert.equal(confirmed.billing.adjustments.length, 2);
    record.checks.push('Reload/retry B used the original ID: still exactly ¥3 / 2 adjustments');
    await formReset('B confirmed');

    await fill('1.00', 'Recovery operation C');
    await noPending();
    await card.getByText(/累计减免 ¥4.00/).waitFor();
    assert.notEqual(requests[4].request_id, pendingB.request_id, 'C is an independent operation');
    const final = await api('/api/commerce/orders/' + sale.id, 'GET', undefined, admin.token);
    assert.equal(final.billing.credited_cents, 400);
    assert.equal(final.billing.adjustments.length, 3);
    record.checks.push('A subsequent independent C succeeded once: exactly ¥4 / 3 adjustments, no recovery deadlock');
    await formReset('C confirmed');
    assert.deepEqual(record.pageErrors, [], 'No browser JavaScript runtime errors');
    assert.equal(requests.length, 5, 'Exactly A, A retry, B, B retry, C browser submissions');
    if (routeError) throw routeError;
    await card.screenshot({ path: path.join(out, mode + '.png') });
    record.passed = true;
    console.log('PASS ' + mode + ': ' + record.checks.length + ' checks');
  } catch (error) {
    record.passed = false;
    record.failure = { message: String(error), stack: error.stack };
    console.error('FAIL ' + mode + ': ' + String(error));
    await page.screenshot({ path: path.join(out, mode + '-failure.png'), fullPage: true }).catch(() => {});
  } finally {
    releaseA.resolve();
    await page.unrouteAll({ behavior: 'wait' }).catch(() => {});
    await context.close();
    fs.writeFileSync(path.join(out, mode + '.json'), JSON.stringify(record, null, 2));
  }
}

(async () => {
  let browser;
  try {
    const playwright = loadPlaywright();
    browser = await playwright.chromium.launch({ headless: true, executablePath: chromiumExecutable(playwright) });
    for (const mode of ['late-success', 'late-terminal-409']) await scenario(browser, mode);
    result.passed = result.scenarios.every(item => item.passed);
    result.checkCount = result.scenarios.reduce((count, item) => count + item.checks.length, 0);
    if (!result.passed) process.exitCode = 1;
    console.log(JSON.stringify({ passed: result.passed, scenarios: result.scenarios.length, checks: result.checkCount, result: path.join(out, 'recovery-result.json') }));
  } catch (error) {
    result.passed = false;
    result.failure = { message: String(error), stack: error.stack };
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'recovery-result.json'), JSON.stringify(result, null, 2));
  }
})();
