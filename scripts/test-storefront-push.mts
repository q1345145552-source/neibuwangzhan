/**
 * 线下单推到业务系统（2026-10-22 老板选 B，金额账单客户看得到）两边联调：
 * 真起一个业务系统（临时目录合成库），内部用真的接口找/建客户账号、推单；
 * 核对内部编号整个换成业务系统单号、记成同步单并已确认；客户用新账号登录能按链接打开这张单、看到账单和进度；
 * 内部点确认收款后业务系统发来的账单新版本内部认得出；本地失败时业务系统那边撤回；别的账号打不开。不连外部地址。
 * Run (from this repo): node --import <tsx loader> scripts/test-storefront-push.mts
 * 业务系统代码默认取 /Users/liuyujiang/湘泰业务网站-order-confirm，可用 CLIENT_SOURCE_ROOT 指定。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { NextRequest } from 'next/server';

const clientRoot = path.resolve(process.env.CLIENT_SOURCE_ROOT || '/Users/liuyujiang/湘泰业务网站-order-confirm');
const deps = '/Users/liuyujiang/湘泰业务网站';
const dir = fs.mkdtempSync('/tmp/xt-storefront-push-');
const SECRET = 'storefront-push-secret';
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const clientPort = await freePort(), bridgePort = await freePort();
const CLIENT = `http://127.0.0.1:${clientPort}`;

Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), SYNC_SECRET: SECRET, JWT_SECRET: 'storefront-push-jwt', CUSTOMER_SYNC_URL: CLIENT });
const [{ POST: syncPost }, ordersRoute, pushRoute, customersRoute, paymentConfirm, { getDb }, { signToken }, { flushProgress }, { subServices }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/route'), import('../src/app/api/orders/[id]/storefront-push/route'),
  import('../src/app/api/storefront/customers/route'), import('../src/app/api/orders/[id]/payment/confirm/route'),
  import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/progress-sync'), import('../src/lib/constants'),
]);
const db = getDb();
db.prepare('UPDATE employees SET must_change_password=0').run();
const adminRow = db.prepare("SELECT id, name, auth_version FROM employees WHERE role='admin' AND status='在职' ORDER BY id LIMIT 1").get() as { id: number; name: string; auth_version: number };
const adminToken = await signToken({ id: adminRow.id, name: adminRow.name, role: 'admin', auth_version: adminRow.auth_version, must_change_password: 0 });
const emp = db.prepare("SELECT id, name, auth_version FROM employees WHERE role='employee' AND status='在职' ORDER BY id LIMIT 1").get() as { id: number; name: string; auth_version: number } | undefined;
const empId = emp?.id ?? Number(db.prepare("INSERT INTO employees(name, role, status, password, must_change_password) VALUES ('演练员工','employee','在职','x',0)").run().lastInsertRowid);
const empRow = db.prepare('SELECT id, name, auth_version FROM employees WHERE id=?').get(empId) as { id: number; name: string; auth_version: number };
const empToken = await signToken({ id: empRow.id, name: empRow.name, role: 'employee', auth_version: empRow.auth_version, must_change_password: 0 });

// 业务系统 → 内部：账单新版本走真的接单入口（业务系统的发送程序发到这里，再转给内部的处理函数）
const bridge = http.createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (req.method === 'POST' && req.url === '/api/sync/orders') {
    const r = await syncPost(new NextRequest('http://internal.invalid/api/sync/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: String(req.headers.authorization || '') }, body: Buffer.concat(chunks).toString() }));
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(await r.text()); return;
  }
  res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"not in fixture"}');
});
await new Promise<void>(r => bridge.listen(bridgePort, '127.0.0.1', () => r()));

// 起业务系统
const server = path.join(dir, 'server'); fs.mkdirSync(server);
for (const entry of fs.readdirSync(path.join(clientRoot, 'server'))) if (/\.(?:ts|cts|cjs)$/.test(entry)) fs.copyFileSync(path.join(clientRoot, 'server', entry), path.join(server, entry));
fs.writeFileSync(path.join(server, 'package.json'), '{"type":"commonjs"}');
fs.symlinkSync(path.join(deps, 'server/node_modules'), path.join(server, 'node_modules'));
const log = fs.openSync(path.join(dir, 'client-server.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], {
  cwd: dir, stdio: ['ignore', log, log],
  env: { ...process.env, PORT: String(clientPort), HOST: '127.0.0.1', XIANGTAI_DB_PATH: path.join(dir, 'client.db'), JWT_SECRET: 'client-jwt',
    INTERNAL_SYNC_URL: `http://127.0.0.1:${bridgePort}`, INTERNAL_SYNC_SECRET: SECRET, DB_PATH: '' },
});
process.on('exit', () => child.kill());
const realFetch = globalThis.fetch;
for (let i = 0; i < 200; i++) { try { if ((await realFetch(`${CLIENT}/api/subscriptions/products`)).ok) break; } catch { /* 还在启动 */ } if (i === 199) throw new Error('业务系统没起来，见 ' + path.join(dir, 'client-server.log')); await new Promise(r => setTimeout(r, 100)); }

const { default: Database } = await import('better-sqlite3');
const clientDb = new Database(path.join(dir, 'client.db'), { readonly: true });
const results: { name: string; result: 'PASS' | 'FAIL'; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error instanceof Error ? error.stack : error) }); } }
const req = (url: string, token: string, init: { method?: string; body?: unknown } = {}) => new NextRequest(`http://127.0.0.1${url}`, { method: init.method || 'GET',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 两个系统各接口返回结构不同，断言里按需取字段
async function call(res: Response) { return { status: res.status, body: await res.json() as any }; }
const pushState = async (id: string, token = adminToken) => call(await pushRoute.GET(req(`/api/orders/${id}/storefront-push`, token), ctx(id)));
const push = async (id: string, body: unknown, token = adminToken) => call(await pushRoute.POST(req(`/api/orders/${id}/storefront-push`, token, { method: 'POST', body }), ctx(id)));
async function client(method: string, url: string, token?: string, body?: unknown) {
  const r = await realFetch(`${CLIENT}${url}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 两个系统各接口返回结构不同，断言里按需取字段
  return { status: r.status, body: await r.json() as any };
}
async function newInternalOrder(btId: number, sub: string, amount: number, currency: string) {
  const r = await call(await ordersRoute.POST(req('/api/orders', adminToken, { method: 'POST', body: { customer_name: `线下客户${btId}${sub}`, new_customer: true, business_type_id: btId, sub_service_type: sub, total_amount: amount, currency } })));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as string;
}
const hits = (id: string) => {
  const found: string[] = [];
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[])
    for (const { name: col } of db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[])
      if ((db.prepare(`SELECT count(*) AS n FROM "${name}" WHERE typeof("${col}")='text' AND instr("${col}", ?) > 0`).get(id) as { n: number }).n) found.push(`${name}.${col}`);
  return found.sort();
};

const companySub = subServices[1][0].key;
const orderA = await newInternalOrder(1, companySub, 9300, 'THB');
db.prepare("INSERT INTO finances(order_id, type, amount, description, status, currency) VALUES (?, 'income', 9300, '线下收的定金', 'paid', 'THB')").run(orderA);
const stepsBefore = (db.prepare('SELECT count(*) AS n FROM order_steps WHERE order_id=?').get(orderA) as { n: number }).n;
let account: { id: string; name: string; phone: string; email: string };
let pushedA = '';

await test('an internal order can be pushed by any staff member (2026-10-28); a THB order is not prefilled', async () => {
  const s = await pushState(orderA);
  assert.equal(s.status, 200);
  assert.equal(s.body.linked, false); assert.equal(s.body.can_push, true);
  assert.equal(s.body.prefill.amount, null, 'a THB order is not prefilled: staff must convert to CNY');
  assert.deepEqual(s.body.original, { amount: 9300, currency: 'THB' });
  assert.ok(String(s.body.prefill.title).startsWith('公司注册 · '));
  assert.equal((await pushState(orderA, empToken)).body.can_push, true, 'employees can push too since 2026-10-28');
  const noGroup = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: '0811111111', password: '123456' } })));
  assert.equal(noGroup.status, 400, 'a customer group name is required');
  const noLogin = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { group_name: '没登录名', password: '123456' } })));
  assert.equal(noLogin.status, 400); assert.match(noLogin.body.error, /请填登录名/);
  assert.equal((clientDb.prepare("SELECT count(*) AS n FROM users WHERE phone='0811111111'").get() as { n: number }).n, 0, 'nothing created on the customer site');
});

await test('staff open the customer account with login name + group name + password; duplicates are refused; search finds it by number or group name', async () => {
  const created = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: '081-234 5678', group_name: '  甲公司  LINE群 ', password: '24681357' } })));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.email, '', 'placeholder email is not shown to staff');
  assert.equal(created.body.login, '0812345678', 'phone typed with dashes is stored as digits');
  assert.equal(created.body.group_name, '甲公司 LINE群');
  assert.equal(created.body.login_url, `${CLIENT}/login`, 'the login address to hand to the customer (opening an account without an order)');
  account = created.body;
  assert.equal((clientDb.prepare('SELECT name FROM users WHERE id=?').get(account.id) as { name: string }).name, '0812345678', 'the account name is the login; the group name never goes to the customer site');
  const dup = await call(await customersRoute.POST(req('/api/storefront/customers', adminToken, { method: 'POST', body: { login: '0812345678', group_name: '别的群', password: '24681357' } })));
  assert.equal(dup.status, 409);
  const dupGroup = await call(await customersRoute.POST(req('/api/storefront/customers', adminToken, { method: 'POST', body: { login: '0822222222', group_name: '甲公司 line群', password: '24681357' } })));
  assert.equal(dupGroup.status, 409, 'group name taken (ignoring case)');
  assert.equal((clientDb.prepare("SELECT count(*) AS n FROM users WHERE phone='0822222222'").get() as { n: number }).n, 0, 'refused before anything is created on the customer site');
  const bad = await call(await customersRoute.POST(req('/api/storefront/customers', adminToken, { method: 'POST', body: { login: '12ab', group_name: '乙', password: '24681357' } })));
  assert.equal(bad.status, 400, JSON.stringify(bad.body));
  const found = await call(await customersRoute.GET(req('/api/storefront/customers?q=2345', empToken)));
  assert.deepEqual(found.body.customers.map((c: { id: string; group_name: string }) => [c.id, c.group_name]), [[account.id, '甲公司 LINE群']]);
  const byGroup = await call(await customersRoute.GET(req(`/api/storefront/customers?q=${encodeURIComponent('甲公司')}`, empToken)));
  assert.deepEqual(byGroup.body.customers.map((c: { id: string; email: string }) => [c.id, c.email]), [[account.id, '0812345678']], 'the group name lives only internally and is searchable');
  const dashed = await call(await customersRoute.GET(req(`/api/storefront/customers?q=${encodeURIComponent('081-234 5678')}`, adminToken)));
  assert.deepEqual(dashed.body.customers.map((c: { id: string }) => c.id), [account.id], 'a number typed with dashes and spaces still finds the account');
  assert.equal((await client('GET', '/api/sync/customers?q=')).status, 401, 'the customer site endpoint needs the shared secret');
});

await test('pushing with a bad amount is refused before anything is created on the customer site', async () => {
  for (const amount of [0, -5, 1.234, 'abc']) assert.equal((await push(orderA, { customer_id: account.id, amount })).status, 400);
  assert.equal((await client('GET', `/api/sync/customers?q=`, undefined)).status, 401);
});

await test('push: the internal order is renumbered to the customer-site number everywhere and becomes a confirmed synced order in CNY', async () => {
  const r = await push(orderA, { customer_id: account.id, amount: 2000, title: '公司注册（线下）' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  pushedA = r.body.id;
  assert.match(pushedA, /^ORD\d{20}$/);
  assert.equal(r.body.source_order_no, pushedA);
  assert.equal(r.body.link, `${CLIENT}/o/${pushedA}`);
  // 旧编号只留在两处追溯记录里：操作记录「推到业务系统」、同步台账备注「原内部编号 …」
  assert.deepEqual(hits(orderA), ['audit_logs.detail', 'sync_inbox.note'], 'old internal number is gone everywhere else');
  assert.equal((db.prepare('SELECT count(*) AS n FROM order_steps WHERE order_id=?').get(pushedA) as { n: number }).n, stepsBefore);
  assert.equal((db.prepare("SELECT count(*) AS n FROM finances WHERE order_id=?").get(pushedA) as { n: number }).n, 1);
  const o = db.prepare('SELECT source_system, source_customer_id, total_amount, currency, status FROM orders WHERE id=?').get(pushedA) as Record<string, unknown>;
  assert.deepEqual(o, { source_system: 'storefront', source_customer_id: account.id, total_amount: 2000, currency: 'CNY', status: '待处理' });
  assert.ok(db.prepare('SELECT 1 FROM sync_order_confirmations WHERE source_order_no=?').get(pushedA), 'pushed order counts as confirmed');
  assert.deepEqual(db.prepare('SELECT internal_order_id, allocated_cents FROM sync_inbox WHERE source_order_no=?').all(pushedA), [{ internal_order_id: pushedA, allocated_cents: 200000 }]);
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='推到业务系统' AND target_id=? AND detail LIKE ?").get(pushedA, `%原内部编号 ${orderA}%`));
  const s = await pushState(pushedA, empToken);
  assert.deepEqual(s.body, { linked: true, source_order_no: pushedA, link: `${CLIENT}/o/${pushedA}`, customer: { name: '0812345678', login: '0812345678' } });
  assert.equal(r.body.pending, false, 'the customer site created the real order right away');
  assert.equal((await push(pushedA, { customer_id: account.id, amount: 2000 })).status, 409, 'cannot push twice');
});

let customerToken = '';
let clientOrderId = '';
await test('the customer logs in with the phone, opens the link by number and sees the order, the CNY bill and the progress', async () => {
  const login = await client('POST', '/api/auth/login', undefined, { email: '0812345678', password: '24681357' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  customerToken = login.body.token;
  const byNo = await client('GET', `/api/orders/by-no/${pushedA}`, customerToken);
  assert.equal(byNo.status, 200);
  clientOrderId = byNo.body.id;
  const before = await client('GET', `/api/orders/${clientOrderId}`, customerToken);
  assert.equal(before.body.order.order_no, pushedA);
  assert.equal(before.body.order.status, 'confirmed', 'no waiting for confirmation: staff created it');
  assert.equal(before.body.order.sku_name, '公司注册（线下）');
  assert.equal(before.body.invoice.amount, 2000); assert.equal(before.body.invoice.currency, 'CNY'); assert.equal(before.body.invoice.status, 'unpaid');
  assert.equal(before.body.order.sync_status, 'sent');
  assert.deepEqual(before.body.internal_expected.map((e: { line_no: number; copy_no: number }) => [e.line_no, e.copy_no]), [[1, 1]]);
  const list = await client('GET', '/api/orders', customerToken);
  assert.deepEqual(list.body.map((o: { order_no: string }) => o.order_no), [pushedA]);
  // 推完接口已经自己触发过一次进度回传；这里再补一次，等客户站收到
  let after = await client('GET', `/api/orders/${clientOrderId}`, customerToken);
  for (let i = 0; i < 50 && !after.body.internal_progress.length; i++) {
    await flushProgress(); await new Promise(r => setTimeout(r, 100));
    after = await client('GET', `/api/orders/${clientOrderId}`, customerToken);
  }
  assert.equal(after.body.internal_progress.length, 1);
  assert.equal(after.body.internal_progress[0].status, '已确认');
  assert.ok(after.body.internal_progress[0].steps.length > 0);
});

await test('another customer account cannot open the link', async () => {
  const other = await client('POST', '/api/auth/register', undefined, { name: '别的客户', phone: '0899999999', password: '13572468' });
  assert.equal(other.status, 200);
  const r = await client('GET', `/api/orders/by-no/${pushedA}`, other.body.token);
  assert.equal(r.status, 403);
  assert.equal((await client('GET', `/api/orders/${clientOrderId}`, other.body.token)).status, 403);
  assert.equal((await client('GET', '/api/orders/by-no/ORD00000000000000000000', other.body.token)).status, 404);
});

await test('internal "confirm payment" marks the bill paid and the customer site\'s new billing revision is accepted by the internal ledger', async () => {
  const r = await call(await paymentConfirm.POST(req(`/api/orders/${pushedA}/payment/confirm`, adminToken, { method: 'POST' }), ctx(pushedA)));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let rev = 0;
  for (let i = 0; i < 100 && rev < 2; i++) { await new Promise(res => setTimeout(res, 200)); rev = (db.prepare('SELECT billing_revision FROM sync_orders WHERE source_order_no=?').get(pushedA) as { billing_revision: number }).billing_revision; }
  assert.equal(rev, 2, 'billing revision 2 reached the internal ledger (same identity as the push)');
  assert.equal(JSON.parse((db.prepare('SELECT financial_json FROM sync_orders WHERE source_order_no=?').get(pushedA) as { financial_json: string }).financial_json).billingStatus, 'paid');
  assert.equal((db.prepare('SELECT total_amount FROM orders WHERE id=?').get(pushedA) as { total_amount: number }).total_amount, 2000);
  const view = await client('GET', `/api/orders/${clientOrderId}`, customerToken);
  assert.equal(view.body.invoice.status, 'paid');
});

const sync = (method: string, url: string, body?: unknown) => realFetch(`${CLIENT}${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 两个系统各接口返回结构不同，断言里按需取字段
  body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ status: r.status, body: await r.json() as any }));
const reserved = (internalId: string) => clientDb.prepare('SELECT order_no, order_id, payload FROM offline_order_reservations WHERE internal_order_id=? ORDER BY created_at DESC, rowid DESC').get(internalId) as { order_no: string; order_id: string | null; payload: string } | undefined;

await test('if the internal side fails, the customer sees nothing (the number is only held); a retry reuses the held number', async () => {
  const orderB = await newInternalOrder(6, '', 500, 'CNY');
  assert.equal((await pushState(orderB)).body.prefill.amount, 500, 'a CNY order is prefilled');
  db.exec("CREATE TRIGGER fail_push BEFORE INSERT ON sync_orders BEGIN SELECT RAISE(ABORT, 'TEST_PUSH_FAILURE'); END");
  const failed = await push(orderB, { customer_id: account.id, amount: 500 });
  db.exec('DROP TRIGGER fail_push');
  assert.equal(failed.status, 500);
  assert.match(failed.body.error, /没推出去/);
  assert.ok(db.prepare('SELECT 1 FROM orders WHERE id=?').get(orderB), 'internal order untouched');
  const held = reserved(orderB);
  assert.ok(held && held.order_id === null, 'only a held number, no real order');
  assert.equal((await client('GET', '/api/orders', customerToken)).body.length, 1, 'customer does not see a half-pushed order');
  const ok = await push(orderB, { customer_id: account.id, amount: 500 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.id, held!.order_no, 'same number as the first try');
  assert.equal((await client('GET', '/api/orders', customerToken)).body.length, 2);
});

await test('a first try whose reply got lost, then a retry with a different amount/title: a fresh number with what the retry said, the first number stays unused', async () => {
  const orderC = await newInternalOrder(6, '', 0, 'CNY');
  const lost = await sync('POST', '/api/sync/offline-orders', { internal_order_id: orderC, customer_id: account.id, service_name: '清关', sub_category: '', sku_name: '第一次的名字', amount: 100 });
  assert.equal(lost.status, 200, JSON.stringify(lost.body));
  assert.equal(lost.body.held, true);
  const ok = await push(orderC, { customer_id: account.id, amount: 300, title: '第二次的名字' });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.notEqual(ok.body.id, lost.body.order_no, 'changed content gets its own number');
  assert.equal((clientDb.prepare('SELECT order_id FROM offline_order_reservations WHERE order_no=?').get(lost.body.order_no) as { order_id: string | null }).order_id, null);
  assert.equal((await client('GET', `/api/orders/by-no/${lost.body.order_no}`, customerToken)).status, 404, 'the unused number never shows up');
  assert.equal((db.prepare('SELECT total_amount FROM orders WHERE id=?').get(ok.body.id) as { total_amount: number }).total_amount, 300);
  const id = (await client('GET', `/api/orders/by-no/${ok.body.id}`, customerToken)).body.id;
  const view = await client('GET', `/api/orders/${id}`, customerToken);
  assert.equal(view.body.order.sku_name, '第二次的名字'); assert.equal(view.body.invoice.amount, 300);
});

await test('two admins pushing the same order at once: only one goes through', async () => {
  const orderD = await newInternalOrder(6, '', 200, 'CNY');
  const [a, b] = await Promise.all([push(orderD, { customer_id: account.id, amount: 200 }), push(orderD, { customer_id: account.id, amount: 250 })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], JSON.stringify([a.body, b.body]));
  const winner = a.status === 200 ? a.body.id : b.body.id;
  const amount = a.status === 200 ? 200 : 250;
  const id = (await client('GET', `/api/orders/by-no/${winner}`, customerToken)).body.id;
  assert.equal((await client('GET', `/api/orders/${id}`, customerToken)).body.invoice.amount, amount);
  assert.equal((db.prepare('SELECT total_amount FROM orders WHERE id=?').get(winner) as { total_amount: number }).total_amount, amount);
});

await test('two held numbers for one internal order (e.g. two server processes): whichever is committed is created with exactly its own content, the other can never be', async () => {
  const x = await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-RACE-1', customer_id: account.id, service_name: '清关', sku_name: '甲', amount: 100 });
  const y = await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-RACE-1', customer_id: account.id, service_name: '清关', sku_name: '乙', amount: 250 });
  assert.notEqual(x.body.order_no, y.body.order_no);
  const again = await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-RACE-1', customer_id: account.id, service_name: '清关', sku_name: '甲', amount: 100 });
  assert.equal(again.body.order_no, x.body.order_no, 'same content reuses its number');
  const cx = await sync('POST', '/api/sync/offline-orders/commit', { order_no: x.body.order_no });
  assert.equal(cx.status, 200, JSON.stringify(cx.body));
  assert.equal((await sync('POST', '/api/sync/offline-orders/commit', { order_no: x.body.order_no })).status, 200, 'telling it twice is fine');
  const view = await client('GET', `/api/orders/${cx.body.order_id}`, customerToken);
  assert.equal(view.body.order.sku_name, '甲'); assert.equal(view.body.invoice.amount, 100);
  assert.equal((await sync('POST', '/api/sync/offline-orders/commit', { order_no: y.body.order_no })).status, 409);
  assert.equal((await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-RACE-1', customer_id: account.id, service_name: '清关', sku_name: '丙', amount: 1 })).status, 409);
});

await test('a normal order\'s progress still goes through the changed progress endpoint', async () => {
  const p = await sync('POST', '/api/sync/progress', { source_order_no: pushedA, line_no: 1, copy_no: 1, seq: 999, status: '已确认', steps: [{ step_order: 1, step_name: '办理', status: '待处理' }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
});

await test('if the "create it now" call never arrives, the first progress update creates the order on the customer site', async () => {
  const held = await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-PROGRESS-ONLY', customer_id: account.id, service_name: '清关', sub_category: '', sku_name: '只靠进度补建', amount: 80 });
  assert.equal(held.status, 200);
  const before = (await client('GET', '/api/orders', customerToken)).body.length;
  const p = await sync('POST', '/api/sync/progress', { source_order_no: held.body.order_no, line_no: 1, copy_no: 1, seq: 1, status: '已确认', steps: [{ step_order: 1, step_name: '办理', status: '待处理' }] });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal((await client('GET', '/api/orders', customerToken)).body.length, before + 1);
  assert.ok(reserved('ORD-PROGRESS-ONLY')!.order_id);
  assert.equal((await sync('POST', '/api/sync/offline-orders', { internal_order_id: 'ORD-PROGRESS-ONLY', customer_id: account.id, service_name: '清关', sku_name: 'x', amount: 1 })).status, 409, 'cannot be changed once real');
});

await test('an order with an uploaded file named after its number is not pushed (the file would be lost after renumbering)', async () => {
  const orderE = await newInternalOrder(6, '', 100, 'CNY');
  const uploads = path.join(path.dirname(process.env.DB_PATH!), 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, `${orderE}-合同.pdf`), 'x');
  const r = await push(orderE, { customer_id: account.id, amount: 100 });
  assert.equal(r.status, 409); assert.match(r.body.error, /文件名/);
  assert.equal(reserved(orderE), undefined, 'refused before asking the customer site');
});

await test('cancelled, unclassified or customer-site orders cannot be pushed', async () => {
  const c = await newInternalOrder(6, '', 100, 'CNY');
  db.prepare("UPDATE orders SET status='客户取消' WHERE id=?").run(c);
  assert.equal((await pushState(c)).body.can_push, false);
  assert.equal((await push(c, { customer_id: account.id, amount: 100 })).status, 409);
});

const createOrder = async (token: string, body: Record<string, unknown>) => call(await ordersRoute.POST(req('/api/orders', token, { method: 'POST', body })));

await test('new order picks the customer account: it is created and attached right away (renumbered, CNY, customer sees it); the group name becomes the customer name', async () => {
  const before = (await client('GET', '/api/orders', customerToken)).body.length;
  const r = await createOrder(empToken, { storefront_account_id: account.id, business_type_id: 6, sub_service_type: '', total_amount: 1888, currency: 'CNY', description: '建单直接挂账号' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.id, /^ORD\d{20}$/, 'renumbered to the customer-site number');
  assert.equal(r.body.storefront.source_order_no, r.body.id);
  assert.equal(r.body.storefront.link, `${CLIENT}/o/${r.body.id}`);
  assert.equal(r.body.storefront_error, undefined);
  const o = db.prepare('SELECT customer_name, source_system, source_customer_id, total_amount, currency FROM orders WHERE id=?').get(r.body.id) as Record<string, unknown>;
  assert.deepEqual(o, { customer_name: '甲公司 LINE群', source_system: 'storefront', source_customer_id: account.id, total_amount: 1888, currency: 'CNY' });
  assert.ok(db.prepare('SELECT 1 FROM customers WHERE company_name=?').get('甲公司 LINE群'), 'customer list gets the group name automatically');
  assert.ok(db.prepare('SELECT 1 FROM sync_order_confirmations WHERE source_order_no=?').get(r.body.id));
  const list = (await client('GET', '/api/orders', customerToken)).body;
  assert.equal(list.length, before + 1);
  assert.ok(list.some((x: { order_no: string }) => x.order_no === r.body.id), 'the customer sees it at once');
  const again = await createOrder(empToken, { storefront_account_id: account.id, business_type_id: 6, sub_service_type: '', total_amount: 10, currency: 'CNY' });
  assert.equal(again.status, 201);
  assert.equal((db.prepare('SELECT count(*) AS n FROM customers WHERE lower(trim(company_name))=lower(?)').get('甲公司 LINE群') as { n: number }).n, 1, 'no duplicate customer entry');
});

await test('new order with an account: amount must be CNY > 0; an old account without a group name needs one and keeps it', async () => {
  assert.equal((await createOrder(empToken, { storefront_account_id: account.id, business_type_id: 6, total_amount: 500, currency: 'THB' })).status, 400);
  for (const total_amount of [0, -1, 1.234, '']) assert.equal((await createOrder(empToken, { storefront_account_id: account.id, business_type_id: 6, total_amount, currency: 'CNY' })).status, 400);
  const self = await client('POST', '/api/auth/register', undefined, { name: '自己注册的', phone: '0855555555', password: '13572468' });
  const selfId = self.body.user.id as string;
  const missing = await createOrder(empToken, { storefront_account_id: selfId, business_type_id: 6, total_amount: 100, currency: 'CNY' });
  assert.equal(missing.status, 400, 'needs a group name');
  const taken = await createOrder(empToken, { storefront_account_id: selfId, group_name: '甲公司 LINE群', business_type_id: 6, total_amount: 100, currency: 'CNY' });
  assert.equal(taken.status, 409, 'the group name belongs to another account');
  const ok = await createOrder(empToken, { storefront_account_id: selfId, group_name: '丙群', account_login: '0855555555', business_type_id: 6, total_amount: 100, currency: 'CNY' });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.customer_name, '丙群');
  const found = await call(await customersRoute.GET(req(`/api/storefront/customers?q=${encodeURIComponent('丙')}`, empToken)));
  assert.deepEqual(found.body.customers.map((c: { id: string; group_name: string }) => [c.id, c.group_name]), [[selfId, '丙群']]);
  const keep = await createOrder(empToken, { storefront_account_id: selfId, group_name: '想改名', business_type_id: 6, total_amount: 100, currency: 'CNY' });
  assert.equal(keep.body.customer_name, '丙群', 'an existing group name is not changed by an order');
});

await test('a login name that is not a phone or email works: the customer logs in with it (any case)', async () => {
  const created = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: 'Shop_Ding1', group_name: '丁群', password: '11223344' } })));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.login, 'Shop_Ding1');
  const login = await client('POST', '/api/auth/login', undefined, { email: 'shop_ding1', password: '11223344' });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const order = await createOrder(empToken, { storefront_account_id: created.body.id, business_type_id: 6, total_amount: 66, currency: 'CNY' });
  assert.equal(order.status, 201);
  const mine = await client('GET', '/api/orders', login.body.token);
  assert.deepEqual(mine.body.map((x: { order_no: string }) => x.order_no), [order.body.id]);
  assert.equal((await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: 'SHOP_DING1', group_name: '戊群', password: '11223344' } })))).status, 409, 'login names are unique ignoring case');
});

await test('if attaching fails because the account is gone, the order is still created and the group name is released for a new account', async () => {
  db.prepare("INSERT INTO storefront_accounts (account_id, group_name, login) VALUES ('no-such-account', '没了的群', 'x')").run();
  const r = await createOrder(empToken, { storefront_account_id: 'no-such-account', business_type_id: 6, total_amount: 50, currency: 'CNY' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.storefront_error, /客户账号不存在/);
  assert.match(r.body.storefront_error, /已放开/);
  assert.match(r.body.id, /^ORD-/, 'still the internal number');
  assert.equal(db.prepare("SELECT 1 FROM storefront_accounts WHERE account_id='no-such-account'").get(), undefined, 'the dead account no longer holds the group name');
  assert.ok(db.prepare("SELECT 1 FROM audit_logs WHERE action='放开客户群名' AND target_id='no-such-account'").get());
  const fresh = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: 'newlogin1', group_name: '没了的群', password: '11223344' } })));
  assert.equal(fresh.status, 201, 'the group name can go on a new account: ' + JSON.stringify(fresh.body));
  const st = await pushState(r.body.id, empToken);
  assert.equal(st.body.account.id, fresh.body.id, 'the order now goes to the new account');
  assert.equal((await push(r.body.id, { customer_id: fresh.body.id, amount: 50 }, empToken)).status, 200);
});

await test('an account disabled on the customer site: pushing to it fails, releases its group name, and the order can then go to a new account', async () => {
  const created = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: '0866666666', group_name: '庚群', password: '11223344' } })));
  assert.equal(created.status, 201);
  const writable = new Database(path.join(dir, 'client.db'));
  writable.prepare("UPDATE users SET status='disabled' WHERE id=?").run(created.body.id); writable.close();
  const r = await createOrder(empToken, { storefront_account_id: created.body.id, business_type_id: 6, total_amount: 40, currency: 'CNY' });
  assert.equal(r.status, 201);
  assert.match(r.body.storefront_error, /已被禁用/);
  assert.equal(db.prepare('SELECT 1 FROM storefront_accounts WHERE account_id=?').get(created.body.id), undefined);
  assert.equal((await pushState(r.body.id, empToken)).body.account, null, 'no longer locked to the disabled account');
  const fresh = await call(await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { login: '0877777777', group_name: '庚群', password: '11223344' } })));
  assert.equal(fresh.status, 201);
  assert.equal((await push(r.body.id, { customer_id: fresh.body.id, amount: 40 }, empToken)).status, 200);
});

await test('an order whose customer is a group name can only be pushed to that account; the push box gets that account preselected', async () => {
  const r = await createOrder(empToken, { customer_name: '甲公司 LINE群', business_type_id: 6, sub_service_type: '', total_amount: 70, currency: 'CNY' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const s = await pushState(r.body.id, empToken);
  assert.equal(s.body.account.id, account.id);
  assert.equal(s.body.account.group_name, '甲公司 LINE群');
  const other = (await call(await customersRoute.GET(req(`/api/storefront/customers?q=${encodeURIComponent('丙')}`, empToken)))).body.customers[0];
  const wrong = await push(r.body.id, { customer_id: other.id, amount: 70 }, empToken);
  assert.equal(wrong.status, 409, JSON.stringify(wrong.body));
  assert.match(wrong.body.error, /只能推给/);
  assert.equal(reserved(r.body.id), undefined, 'refused before asking the customer site');
  assert.equal((await push(r.body.id, { customer_id: account.id, amount: 70 }, empToken)).status, 200);
});

await test('a group name saved while creating an order is dropped again when the account turns out to be gone', async () => {
  const r = await createOrder(empToken, { storefront_account_id: 'gone-account', group_name: '己群', business_type_id: 6, total_amount: 30, currency: 'CNY' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.storefront_error, /客户账号不存在/);
  assert.equal(db.prepare("SELECT 1 FROM storefront_accounts WHERE account_id='gone-account'").get(), undefined, 'the group name is free again');
});

await test('if the customer site is unreachable, the account search still lists the accounts with a group name (with a warning), so orders can still be created', async () => {
  const saved = process.env.CUSTOMER_SYNC_URL;
  process.env.CUSTOMER_SYNC_URL = `http://127.0.0.1:${await freePort()}`;
  try {
    const all = await call(await customersRoute.GET(req('/api/storefront/customers?q=', empToken)));
    assert.equal(all.status, 200, JSON.stringify(all.body));
    assert.match(all.body.warning, /连不上/);
    assert.ok(all.body.customers.some((c: { id: string }) => c.id === account.id), 'linked accounts are still listed');
    const byGroup = await call(await customersRoute.GET(req(`/api/storefront/customers?q=${encodeURIComponent('甲公司')}`, empToken)));
    assert.deepEqual(byGroup.body.customers.map((c: { id: string }) => c.id), [account.id]);
    const order = await createOrder(empToken, { storefront_account_id: account.id, business_type_id: 6, total_amount: 20, currency: 'CNY' });
    assert.equal(order.status, 201);
    assert.match(order.body.storefront_error, /连不上|没有回话/);
    assert.match(order.body.id, /^ORD-/);
    process.env.CUSTOMER_SYNC_URL = saved;
    const retry = await push(order.body.id, { customer_id: account.id, amount: 20 }, empToken);
    assert.equal(retry.status, 200, 'once the customer site is back, the order page push works: ' + JSON.stringify(retry.body));
  } finally { process.env.CUSTOMER_SYNC_URL = saved; }
});

for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
child.kill(); bridge.close();
if (failed) { process.exitCode = 1; console.log('临时目录留着看：' + dir); }
else fs.rmSync(dir, { recursive: true, force: true });
process.exit();
