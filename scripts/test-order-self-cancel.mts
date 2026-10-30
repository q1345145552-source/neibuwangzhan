/**
 * 还没确认的单客户直接取消（2026-10-30 老板：「没确认的单直接取消」）端到端：真客户站进程 ↔ 内部真路由（本进程内小转发服务）。
 * 客户点「取消订单」→ 客户站当场问内部 → 内部核对还没确认、一步没办 → 拆出的办理单一起改客户取消 → 回执带进度，客户站当场变已取消；
 * 已确认 / 已开始办 / 已付款 / 内部连不上 / 还没传到内部的，都不取消，两边原样。
 * 全部是临时目录里的合成库与本机端口，不连任何外部地址。
 * Run (from this repo): CLIENT_SOURCE_ROOT=<客户站源码> node --import <tsx loader> scripts/test-order-self-cancel.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server';

const clientRoot = path.resolve(process.env.CLIENT_SOURCE_ROOT || '/Users/liuyujiang/湘泰业务网站');
const deps = '/Users/liuyujiang/湘泰业务网站';
const dir = fs.mkdtempSync('/tmp/xt-selfcancel-');
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const [clientPort, internalPort] = [await freePort(), await freePort()];
const SECRET = 'self-cancel-regression-secret';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'internal-regression-jwt',
  SYNC_SECRET: SECRET, CUSTOMER_SYNC_URL: `http://127.0.0.1:${clientPort}`,
});

// ── 内部：真路由 + 本进程转发服务 ──
const [syncOrders, cancelRequests, selfCancel, confirmRoute, orderRoute, { getDb }, { signToken }, { recordConfirmation }, { requestProgressFlush }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/sync/cancel-requests/route'), import('../src/app/api/sync/cancel-unconfirmed/route'),
  import('../src/app/api/orders/[id]/confirm/route'), import('../src/app/api/orders/[id]/route'),
  import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/order-confirm'), import('../src/lib/progress-sync'),
]);
const internalDir = path.join(dir, 'internal-cwd'); fs.mkdirSync(internalDir); process.chdir(internalDir);
const idb = getDb();
// down：内部连不上（取消那一下回 503）；ordersDown：新单传不到内部（客户站一直等回执）
const shimState = { down: false, ordersDown: false };
const routes: Record<string, { POST: (req: NextRequest) => Promise<Response> }> = {
  '/api/sync/orders': syncOrders, '/api/sync/cancel-requests': cancelRequests, '/api/sync/cancel-unconfirmed': selfCancel,
};
const shim = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const route = req.method === 'POST' ? routes[req.url || ''] : undefined;
  if ((shimState.down && req.url === '/api/sync/cancel-unconfirmed') || (shimState.ordersDown && req.url === '/api/sync/orders')) { res.writeHead(503).end('{}'); return; }
  if (!route) { res.writeHead(404).end('{}'); return; }
  const response = await route.POST(new NextRequest(`http://127.0.0.1:${internalPort}${req.url}`, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
  res.writeHead(response.status, { 'content-type': 'application/json' }).end(await response.text());
});
await new Promise<void>(resolve => shim.listen(internalPort, '127.0.0.1', resolve));

// ── 客户站：真进程 ──
const server = path.join(dir, 'client-server'); fs.mkdirSync(server);
for (const entry of fs.readdirSync(path.join(clientRoot, 'server'))) if (/\.(?:ts|cts|cjs)$/.test(entry)) fs.copyFileSync(path.join(clientRoot, 'server', entry), path.join(server, entry));
fs.writeFileSync(path.join(server, 'package.json'), '{"type":"commonjs"}');
fs.symlinkSync(path.join(deps, 'server/node_modules'), path.join(server, 'node_modules'));
const clientEnv: NodeJS.ProcessEnv = { ...process.env, XIANGTAI_DB_PATH: path.join(dir, 'client.db'), JWT_SECRET: 'client-regression-jwt', NODE_ENV: 'test',
  INTERNAL_SYNC_URL: `http://127.0.0.1:${internalPort}`, INTERNAL_SYNC_SECRET: SECRET, PORT: String(clientPort), HOST: '127.0.0.1' };
const prevDbPath = process.env.XIANGTAI_DB_PATH; process.env.XIANGTAI_DB_PATH = clientEnv.XIANGTAI_DB_PATH;
const cdbModule = await import(pathToFileURL(path.join(server, 'db.ts')).href);
const cdb = cdbModule.default?.default || cdbModule.default;
process.env.XIANGTAI_DB_PATH = prevDbPath;
const roles: Record<string, string> = { buyer: 'customer', other: 'customer', admin: 'admin' };
for (const [id, role] of Object.entries(roles)) cdb.prepare('INSERT INTO users(id,name,email,password,role) VALUES (?,?,?,?,?)').run(id, id === 'buyer' ? '演练客户' : id, `${id}@example.invalid`, 'fixture-unused', role);
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-com', 'company-services', '公司咨询服务', 'COM-001', '公司注册', 100, 'CNY');
const log = fs.openSync(path.join(dir, 'client.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], { cwd: dir, env: clientEnv, stdio: ['ignore', log, log] });
const jwt = (await import(pathToFileURL(path.join(deps, 'server/node_modules/jsonwebtoken/index.js')).href)).default;
const pv = createHmac('sha256', 'client-regression-jwt').update('fixture-unused').digest('hex').slice(0, 16);
async function client(method: string, url: string, body?: unknown, as = 'buyer') {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt.sign({ id: as, role: roles[as], name: as, pv }, 'client-regression-jwt')}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${clientPort}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
async function until<T>(label: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
}
const emp = idb.prepare("SELECT id,name,auth_version FROM employees WHERE role='employee' LIMIT 1").get() as { id: number; name: string; auth_version: number };
idb.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(emp.id);
const empToken = await signToken({ id: emp.id, name: emp.name, role: 'employee', auth_version: emp.auth_version, must_change_password: 0 });
const call = (handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, method: string, orderId: string, sub: string, body?: unknown) =>
  handler(new NextRequest(`http://127.0.0.1/api/orders/${orderId}${sub}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${empToken}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: orderId }) });
const syncPost = async (url: string, body: unknown) => {
  const r = await fetch(`http://127.0.0.1:${internalPort}${url}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
};

type Placed = { id: string; order_no: string; internal: string[] };
async function place(quantity: number, waitReceipt = true): Promise<Placed> {
  const created = await client('POST', '/api/orders', { serviceName: '公司咨询服务', subCategory: '注册', skuName: '公司注册', skuCode: 'COM-001', price: 100 * quantity, productId: 'p-com', quantity });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const order = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='COM-001' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
  if (!waitReceipt) return { ...order, internal: [] };
  await until('内部接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order.id)?.receipt);
  const internal = (idb.prepare('SELECT DISTINCT internal_order_id id FROM sync_inbox WHERE source_order_no=? AND internal_order_id IS NOT NULL ORDER BY line_no, copy_no').all(order.order_no) as { id: string }[]).map(r => r.id);
  return { ...order, internal };
}
const custStatus = (o: Placed) => cdb.prepare('SELECT status FROM orders WHERE id=?').get(o.id).status as string;
const intStatus = (id: string) => (idb.prepare('SELECT status, cancel_reason FROM orders WHERE id=?').get(id) as { status: string; cancel_reason: string | null });
const lastProgress = (orderId: string) => { const r = idb.prepare('SELECT p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1').get(orderId) as { payload: string } | undefined; return r ? JSON.parse(r.payload) : null; };
const buyerNotes = (o: Placed) => cdb.prepare("SELECT title, content FROM notifications WHERE user_id='buyer' AND title IN ('订单状态更新','办理进度更新') AND content LIKE ?").all(`%${o.order_no}%`) as { title: string; content: string }[];
// 内部推回客户站的进度全部推完（初始「待处理」那几条也在里面）
const flushAll = () => until('内部进度推完', async () => { requestProgressFlush(); await new Promise(r => setTimeout(r, 200)); return !idb.prepare("SELECT 1 FROM sync_progress_outbox WHERE status <> 'sent'").get() && !idb.prepare("SELECT 1 FROM sync_document_outbox WHERE status <> 'sent'").get(); });
const unchanged = (o: Placed) => {
  assert.equal(custStatus(o), 'pending');
  for (const id of o.internal) assert.equal(intStatus(id).status, '待处理');
};

const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }
try {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`http://127.0.0.1:${clientPort}/api/subscriptions/products`); if (r.ok) break; } catch {} if (i === 149) throw Error('client boot failed'); await new Promise(r => setTimeout(r, 200)); }

  const two = await place(2);
  await test('customer cancels an unconfirmed 2-copy order: both sides cancelled at once, one notice to the customer, all staff told', async () => {
    assert.equal(two.internal.length, 2);
    await flushAll(); // 先把接单时的初始进度推完，后面数通知只数取消带来的
    const before = buyerNotes(two).length;
    const r = await client('POST', `/api/orders/${two.id}/cancel`);
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.status, 'cancelled');
    assert.equal(custStatus(two), 'cancelled', 'customer site changes right away, no waiting for the push');
    for (const id of two.internal) {
      assert.equal(intStatus(id).status, '客户取消'); assert.match(intStatus(id).cancel_reason || '', /还没确认/);
      assert.equal(lastProgress(id).status, '客户取消');
    }
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM sync_progress WHERE order_id=? AND status='客户取消'").get(two.id).n, 2);
    const notes = buyerNotes(two).slice(before);
    assert.equal(notes.length, 1, JSON.stringify(notes)); assert.equal(notes[0].title, '订单状态更新'); assert.match(notes[0].content, /已取消/);
    const history = cdb.prepare("SELECT remark, operator_id FROM order_status_history WHERE order_id=? AND new_status='cancelled'").all(two.id) as { remark: string; operator_id: string }[];
    assert.equal(history.length, 1); assert.equal(history[0].remark, '订单已取消'); assert.equal(history[0].operator_id, 'buyer');
    const staffNotes = idb.prepare("SELECT recipient, body FROM notifications WHERE title='客户取消了订单' AND body LIKE ?").all(`%${two.order_no}%`) as { recipient: string; body: string }[];
    assert(staffNotes.some(n => n.recipient === emp.name), 'ordinary staff told too (they were told to confirm it)');
    assert.match(staffNotes[0].body, /不用再确认/);
    // 内部之后照常把同一份进度推过来：按版本号跳过，不再给客户发通知、状态不动
    await flushAll();
    assert.equal(buyerNotes(two).length, before + 1, 'the later push adds nothing');
    assert.equal(custStatus(two), 'cancelled');
  });
  await test('after the cancel: staff cannot confirm it, a second click says it is already cancelled', async () => {
    const r = await call(confirmRoute.POST, 'POST', two.internal[0], '/confirm');
    assert.equal(r.status, 409); assert.match((await r.json()).error, /已取消/);
    const again = await client('POST', `/api/orders/${two.id}/cancel`);
    assert.equal(again.status, 409); assert.match(again.body.error, /已经取消/);
  });
  await test('receipt lost and asked again: internal answers success with the same latest progress, changes nothing', async () => {
    const seqs = two.internal.map(id => lastProgress(id).seq);
    const r = await syncPost('/api/sync/cancel-unconfirmed', { source_order_no: two.order_no });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.already, true);
    assert.equal(r.body.events.length, 2); assert(r.body.events.every((e: any) => e.status === '客户取消'));
    assert.deepEqual(two.internal.map(id => lastProgress(id).seq), seqs, 'no new progress version');
  });

  const confirmedLate = await place(1);
  await test('staff confirmed a moment ago but the customer site has not heard yet: refused, both sides unchanged', async () => {
    idb.transaction(() => recordConfirmation(idb, confirmedLate.order_no, emp.name))(); // 只记确认、不推进度，模拟客户站还没收到
    const r = await client('POST', `/api/orders/${confirmedLate.id}/cancel`);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_CONFIRMED'); assert.match(r.body.error, /申请取消/);
    unchanged(confirmedLate);
  });

  const started = await place(1);
  await test('an older order already worked on without confirmation: refused the same way', async () => {
    idb.prepare("UPDATE order_steps SET started_at=datetime('now') WHERE order_id=? AND step_order=(SELECT MIN(step_order) FROM order_steps WHERE order_id=?)").run(started.internal[0], started.internal[0]);
    const r = await client('POST', `/api/orders/${started.id}/cancel`);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'ORDER_CONFIRMED');
    unchanged(started);
  });

  const confirmed = await place(1);
  await test('once confirmed on the customer site, direct cancel is gone: back to 按服务申请取消', async () => {
    assert.equal((await call(confirmRoute.POST, 'POST', confirmed.internal[0], '/confirm')).status, 200);
    await until('客户站已确认', () => custStatus(confirmed) === 'confirmed');
    const r = await client('POST', `/api/orders/${confirmed.id}/cancel`);
    assert.equal(r.status, 409); assert.match(r.body.error, /按服务申请取消/);
    assert.equal(intStatus(confirmed.internal[0]).status, '待处理');
  });

  const guarded = await place(1);
  await test('only the customer who placed it: staff on the business site pointed to the internal site, another customer gets 403', async () => {
    const staff = await client('POST', `/api/orders/${guarded.id}/cancel`, undefined, 'admin');
    assert.equal(staff.status, 409); assert.match(staff.body.error, /内部系统/);
    assert.equal((await client('POST', `/api/orders/${guarded.id}/cancel`, undefined, 'other')).status, 403);
    unchanged(guarded);
  });
  await test('a paid order or one with a deposit is not cancelled by the customer (money is handled by people)', async () => {
    cdb.prepare("UPDATE invoices SET status='paid' WHERE order_id=?").run(guarded.id);
    const r = await client('POST', `/api/orders/${guarded.id}/cancel`);
    assert.equal(r.status, 409); assert.equal(r.body.code, 'PAID_OR_RECEIPT');
    unchanged(guarded);
    cdb.prepare("UPDATE invoices SET status='unpaid' WHERE order_id=?").run(guarded.id);
    // 记了定金也算收过钱：客户站先拦；内部按收到的账单再兜一次
    cdb.prepare('UPDATE invoices SET deposit=50 WHERE order_id=?').run(guarded.id);
    const deposit = await client('POST', `/api/orders/${guarded.id}/cancel`);
    assert.equal(deposit.status, 409); assert.equal(deposit.body.code, 'PAID_OR_RECEIPT'); assert.match(deposit.body.error, /定金/);
    cdb.prepare('UPDATE invoices SET deposit=0 WHERE order_id=?').run(guarded.id);
    const fin = (idb.prepare('SELECT financial_json FROM sync_orders WHERE source_order_no=?').get(guarded.order_no) as { financial_json: string }).financial_json;
    for (const money of [{ depositCents: 5000 }, { billingStatus: 'paid' }]) {
      idb.prepare('UPDATE sync_orders SET financial_json=? WHERE source_order_no=?').run(JSON.stringify({ ...JSON.parse(fin), ...money }), guarded.order_no);
      const direct = await syncPost('/api/sync/cancel-unconfirmed', { source_order_no: guarded.order_no });
      assert.equal(direct.status, 409, JSON.stringify(money)); assert.equal(direct.body.code, 'PAID');
    }
    idb.prepare('UPDATE sync_orders SET financial_json=? WHERE source_order_no=?').run(fin, guarded.order_no);
    unchanged(guarded);
  });
  await test('internal site unreachable: nothing changes, the customer is told to try again', async () => {
    shimState.down = true;
    try {
      const r = await client('POST', `/api/orders/${guarded.id}/cancel`);
      assert.equal(r.status, 503); assert.match(r.body.error, /稍后再试/);
      unchanged(guarded);
    } finally { shimState.down = false; }
    const ok = await client('POST', `/api/orders/${guarded.id}/cancel`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(custStatus(guarded), 'cancelled');
  });

  await test('order not yet received by the internal site: asked to wait; works once it arrives', async () => {
    shimState.ordersDown = true;
    let fresh: Placed;
    try {
      fresh = await place(1, false);
      await new Promise(r => setTimeout(r, 500));
      assert.equal(cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(fresh.id)?.receipt ?? null, null);
      const r = await client('POST', `/api/orders/${fresh.id}/cancel`);
      assert.equal(r.status, 409); assert.match(r.body.error, /还在同步/);
      assert.equal(custStatus(fresh), 'pending');
    } finally { shimState.ordersDown = false; }
    await until('补传到内部', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(fresh!.id)?.receipt, 60_000);
    const ok = await client('POST', `/api/orders/${fresh!.id}/cancel`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(custStatus(fresh!), 'cancelled');
  });

  const requested = await place(1);
  await test('a 申请取消 the customer filed earlier is answered (approved) when they then cancel directly', async () => {
    const req = await client('POST', `/api/orders/${requested.id}/cancel-requests`, { line_no: 1, copy_no: 1, reason: '点多了' });
    assert.equal(req.status, 201, JSON.stringify(req.body));
    await until('申请送到内部', () => idb.prepare("SELECT 1 FROM sync_cancel_requests WHERE id=? AND status='pending'").get(req.body.id));
    const r = await client('POST', `/api/orders/${requested.id}/cancel`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const row = idb.prepare('SELECT status, decided_by FROM sync_cancel_requests WHERE id=?').get(req.body.id) as { status: string; decided_by: string };
    assert.equal(row.status, 'approved'); assert.equal(row.decided_by, '客户自己取消');
    await flushAll();
    await until('客户站申请也记同意', () => cdb.prepare("SELECT 1 FROM order_cancel_requests WHERE id=? AND status='approved'").get(req.body.id));
    assert.equal(custStatus(requested), 'cancelled');
  });

  await test('internal route refuses what it should not cancel: unknown order, monthly fee, bad input, no secret', async () => {
    const unknown = await syncPost('/api/sync/cancel-unconfirmed', { source_order_no: 'ORD-NOT-THERE' });
    assert.equal(unknown.status, 409); assert.equal(unknown.body.code, 'NOT_RECEIVED');
    idb.prepare(`INSERT INTO sync_orders (source_order_no, source_customer_id, source, currency, billing_revision, total_cents, discount_cents, net_cents, identity_json, financial_json, payload)
      VALUES ('ORD-SUB-SELF', 'buyer', 'recurring', 'CNY', 1, 50000, 0, 50000, '{}', '{}', '{}')`).run();
    const monthly = await syncPost('/api/sync/cancel-unconfirmed', { source_order_no: 'ORD-SUB-SELF' });
    assert.equal(monthly.status, 409); assert.equal(monthly.body.code, 'NOT_CANCELLABLE');
    assert.equal((await syncPost('/api/sync/cancel-unconfirmed', { source_order_no: 123 })).status, 400);
    const noSecret = await fetch(`http://127.0.0.1:${internalPort}/api/sync/cancel-unconfirmed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source_order_no: confirmedLate.order_no }) });
    assert.equal(noSecret.status, 401);
    unchanged(confirmedLate);
  });

  await test('an internal admin can still restore a self-cancelled order; the customer site follows', async () => {
    const adminRow = idb.prepare("SELECT id,name,auth_version FROM employees WHERE role='admin' LIMIT 1").get() as { id: number; name: string; auth_version: number };
    idb.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(adminRow.id);
    const adminToken = await signToken({ id: adminRow.id, name: adminRow.name, role: 'admin', auth_version: adminRow.auth_version, must_change_password: 0 });
    const r = await orderRoute.PATCH(new NextRequest(`http://127.0.0.1/api/orders/${guarded.internal[0]}`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${adminToken}` }, body: JSON.stringify({ restore: true }) }), { params: Promise.resolve({ id: guarded.internal[0] }) });
    assert.equal(r.status, 200, await r.clone().text());
    await flushAll();
    await until('客户站恢复成待确认', () => custStatus(guarded) === 'pending');
  });
} finally {
  child.kill('SIGTERM');
  shim.close();
}
for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
if (failed) { console.log('client log', path.join(dir, 'client.log')); process.exitCode = 1; }
else fs.rmSync(dir, { recursive: true, force: true });
process.exit();
