#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Persistent checkout recovery browser regression CLI. */
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
const customerEmail = process.env.MERGE_CUSTOMER_EMAIL || (fixture.accounts?.includes('customer@example.test') ? 'customer@example.test' : 'h@example.test');
const password = process.env.MERGE_PASSWORD || fixture.password || 'SyntheticPass!42';
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


const result = { test: 'commerce-checkout-recovery', sourceRoot: root, baseURL: url,
  startedAt: new Date().toISOString(), checks: [], http: [], events: [], pageErrors: [],
  scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex') };
(async () => {
  let browser, context, page;
  try {
    const playwright = loadPlaywright();
    browser = await playwright.chromium.launch({ headless: true, executablePath: chromiumExecutable(playwright) });
    context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, timezoneId: 'Asia/Bangkok' });
    page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on('pageerror', error => result.pageErrors.push(String(error)));
    const posts = [];
    page.on('request', request => {
      if (new URL(request.url()).pathname === '/api/commerce/orders' && request.method() === 'POST') posts.push(request.postDataJSON());
    });
    async function api(route) {
      const token = await page.evaluate(() => sessionStorage.getItem('authToken'));
      const response = await context.request.get(url + route, { headers: { Authorization: 'Bearer ' + token } });
      const output = await response.json();
      result.http.push({ transport: 'API', route, method: 'GET', status: response.status(), output: sanitized(output) });
      assert(response.ok(), JSON.stringify(output));
      return output;
    }
    async function idle() {
      await page.waitForFunction(() => {
        const element = document.querySelector('[aria-label="COM-001 份数"]');
        return element && !element.disabled;
      });
    }
    async function choose() {
      const changed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/commerce/cart' && response.request().method() === 'PUT');
      await page.getByLabel('COM-001 份数', { exact: true }).selectOption('1');
      const response = await changed;
      assert(response.ok(), await response.text());
      await idle();
    }
    async function quote() {
      await page.getByRole('button', { name: '核对当前报价', exact: true }).click();
      await page.getByRole('button', { name: '确认下单', exact: true }).waitFor();
    }
    const check = name => { result.checks.push(name); console.log('PASS ' + name); };
    await page.goto(url + '/shop');
    await page.getByLabel('邮箱', { exact: true }).fill(customerEmail);
    await page.getByLabel('密码', { exact: true }).fill(customerPassword);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('heading', { name: '选择服务', exact: true }).waitFor();
    await idle();
    const user = await page.evaluate(() => JSON.parse(sessionStorage.getItem('currentUser')));
    assert(user?.id, 'Real login must populate the customer session');
    const storage = 'commerce-pending-' + user.id;
    const initialCart = await api('/api/commerce/cart');
    assert.deepEqual(initialCart.lines, [], 'Use a fixture customer with an empty cart; do not overwrite existing selections');
    const initialSales = await api('/api/commerce/orders');
    const initialIDs = initialSales.map(sale => sale.id).sort();
    await choose();
    const selectedCart = await api('/api/commerce/cart');
    check('Real customer login and real server-side saved cart prepared without replacing existing selections');
    const corruptions = [
      ['invalid-json', '{"request_id":'],
      ['invalid-request-id', JSON.stringify({ request_id: null, lines: [] })],
      ['missing-purchase-lines', JSON.stringify({ request_id: 'ui-malformed-' + crypto.randomUUID() })],
    ];
    for (const [name, raw] of corruptions) {
      await page.evaluate(({ key, value }) => sessionStorage.setItem(key, value), { key: storage, value: raw });
      await page.reload();
      await page.getByRole('heading', { name: '选择服务', exact: true }).waitFor();
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storage), raw, name + ': malformed recovery must survive restore verbatim');
      await page.getByRole('alert').filter({ hasText: /原.*记录/ }).waitFor();
      assert.equal(await page.getByLabel('COM-001 份数', { exact: true }).isDisabled(), true, name + ': malformed recovery blocks initial selection');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storage), raw, name + ': reload preserves exact malformed bytes');
      assert.equal(posts.length, 0, name + ': no purchase sent during restore');
      // Explicit cart reload may recover editing, but even a newly quoted checkout
      // must consult the persisted record instead of replacing it with a new ID.
      await page.getByRole('button', { name: '重新加载购物车', exact: true }).click();
      await idle();
      await quote();
      await page.getByRole('button', { name: '确认下单', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: /原.*记录/ }).waitFor();
      assert.equal(posts.length, 0, name + ': malformed pending record prevents an actual new purchase POST');
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storage), raw, name + ': attempted purchase preserves exact recovery bytes');
      assert.deepEqual((await api('/api/commerce/orders')).map(sale => sale.id).sort(), initialIDs, name + ': no new ledger sale');
      assert.deepEqual(await api('/api/commerce/cart'), selectedCart, name + ': server cart is unchanged');
      await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
      check(name + ': recovery bytes preserved, reload/requote cannot create a duplicate sale, cart remains unchanged');
    }
    // Remove only deliberately injected test corruption; this is fixture teardown,
    // not application behavior. Restore normal flow using the same persisted cart.
    await page.evaluate(key => sessionStorage.removeItem(key), storage);
    await page.reload();
    await idle();
    await quote();
    const committed = deferred();
    let dropped = false, routeError;
    await page.route('**/api/commerce/orders', async route => {
      if (route.request().method() !== 'POST') { await route.continue(); return; }
      try {
        const input = route.request().postDataJSON();
        const response = await route.fetch();
        const output = await response.json();
        result.http.push({ transport: 'browser route.fetch', route: '/api/commerce/orders', method: 'POST', input, status: response.status(), output });
        assert(response.ok(), 'Real checkout must succeed: ' + JSON.stringify(output));
        if (!dropped) {
          dropped = true;
          result.events.push({ kind: 'Real checkout committed, response dropped', input, saleId: output.sale.id });
          await route.abort('failed');
          committed.resolve();
        } else await route.fulfill({ response });
      } catch (error) {
        routeError = error;
        committed.resolve();
        await route.abort('failed').catch(() => {});
      }
    });
    await page.getByRole('button', { name: '确认下单', exact: true }).click();
    await deadline(committed.promise, 'checkout committed with response loss');
    if (routeError) throw routeError;
    await page.getByRole('button', { name: '重试确认这笔订单', exact: true }).waitFor();
    const pending = await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storage);
    assert.equal(pending.request_id, posts[0].request_id);
    assert.equal((await api('/api/commerce/orders')).length, initialSales.length + 1);
    await page.reload();
    await page.getByRole('button', { name: '重试确认这笔订单', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '订单已确认' }).waitFor();
    await idle();
    assert.equal(posts[1].request_id, pending.request_id);
    assert.equal((await api('/api/commerce/orders')).length, initialSales.length + 1);
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storage), null);
    assert.deepEqual((await api('/api/commerce/cart')).lines, []);
    check('Lost real checkout response survives refresh; original request_id retry creates exactly one sale and clears only confirmed pending data');
    await choose();
    await quote();
    await page.getByRole('button', { name: '确认下单', exact: true }).click();
    await page.getByRole('status').filter({ hasText: '订单已确认' }).waitFor();
    await idle();
    assert.equal(posts.length, 3, 'Exactly first purchase, same-ID retry, second independent purchase');
    assert.notEqual(posts[2].request_id, pending.request_id);
    assert.equal((await api('/api/commerce/orders')).length, initialSales.length + 2);
    assert.deepEqual((await api('/api/commerce/cart')).lines, []);
    assert.equal(await page.getByLabel('COM-001 份数', { exact: true }).inputValue(), '0');
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), storage), null);
    assert.deepEqual(result.pageErrors, []);
    if (routeError) throw routeError;
    await page.screenshot({ path: path.join(out, 'checkout-follow-up-success.png'), fullPage: true });
    check('Next independent real purchase succeeds exactly once, resets the cart, and leaves no stuck pending state');
    result.passed = true;
  } catch (error) {
    result.passed = false;
    result.failure = { message: String(error), stack: error.stack };
    console.error(error);
    process.exitCode = 1;
    if (page) await page.screenshot({ path: path.join(out, 'checkout-failure.png'), fullPage: true }).catch(() => {});
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'checkout-recovery-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: result.passed, checks: result.checks.length, result: path.join(out, 'checkout-recovery-result.json') }));
  }
})();
