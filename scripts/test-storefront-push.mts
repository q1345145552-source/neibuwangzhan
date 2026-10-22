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

await test('an internal order can be pushed only by an admin; staff see nothing to push', async () => {
  const s = await pushState(orderA);
  assert.equal(s.status, 200);
  assert.equal(s.body.linked, false); assert.equal(s.body.can_push, true);
  assert.equal(s.body.prefill.amount, null, 'a THB order is not prefilled: staff must convert to CNY');
  assert.deepEqual(s.body.original, { amount: 9300, currency: 'THB' });
  assert.ok(String(s.body.prefill.title).startsWith('公司注册 · '));
  assert.equal((await pushState(orderA, empToken)).body.can_push, false);
  assert.equal((await push(orderA, { customer_id: 'x', amount: 1 }, empToken)).status, 403);
  assert.equal((await customersRoute.POST(req('/api/storefront/customers', empToken, { method: 'POST', body: { name: 'x', phone: '0811111111', password: '123456' } }))).status, 403);
});

await test('admin creates the customer account from the internal system (phone only), duplicates are refused, search finds it', async () => {
  const created = await call(await customersRoute.POST(req('/api/storefront/customers', adminToken, { method: 'POST', body: { name: '线下客户甲', phone: '0812345678', email: '', password: '24681357' } })));
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.email, '', 'placeholder email is not shown to staff');
  account = created.body;
  const dup = await call(await customersRoute.POST(req('/api/storefront/customers', adminToken, { method: 'POST', body: { name: '别人', phone: '0812345678', password: '24681357' } })));
  assert.equal(dup.status, 409);
  const found = await call(await customersRoute.GET(req('/api/storefront/customers?q=2345', adminToken)));
  assert.deepEqual(found.body.customers.map((c: { id: string }) => c.id), [account.id]);
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
  assert.deepEqual(s.body, { linked: true, source_order_no: pushedA, link: `${CLIENT}/o/${pushedA}`, customer: { name: '线下客户甲', login: '0812345678' } });
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

for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
child.kill(); bridge.close();
if (failed) { process.exitCode = 1; console.log('临时目录留着看：' + dir); }
else fs.rmSync(dir, { recursive: true, force: true });
process.exit();
