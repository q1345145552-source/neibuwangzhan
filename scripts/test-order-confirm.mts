/**
 * 订单确认（2026-10-19 老板拍板 1A/2B/3A）端到端：真客户站进程 ↔ 内部真路由（本进程内小转发服务）。
 * 客户下单 → 客户站「待确认」、内部「待确认」；没确认前内部不能办、客户不能传资料/水单；
 * 员工（不必是管理员）在内部点「确认订单」→ 同一笔订单拆出的几张一起确认 → 客户站「已确认」并通知客户 → 客户能传、员工能办。
 * 全部是临时目录里的合成库与本机端口，不连任何外部地址。
 * Run (from this repo): CLIENT_SOURCE_ROOT=<客户站源码> node --import <tsx loader> scripts/test-order-confirm.mts
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
const dir = fs.mkdtempSync('/tmp/xt-confirm-');
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const [clientPort, internalPort] = [await freePort(), await freePort()];
const SECRET = 'confirm-regression-secret';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'internal-regression-jwt',
  SYNC_SECRET: SECRET, CUSTOMER_SYNC_URL: `http://127.0.0.1:${clientPort}`,
});

// ── 内部：真路由 + 本进程转发服务 ──
const [syncOrders, confirmRoute, stepsRoute, orderRoute, ordersRoute, requests, documents, certificates, { getDb }, { signToken }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/[id]/confirm/route'), import('../src/app/api/orders/[id]/steps/route'),
  import('../src/app/api/orders/[id]/route'), import('../src/app/api/orders/route'), import('../src/app/api/orders/[id]/supplement-requests/route'),
  import('../src/app/api/orders/[id]/documents/route'), import('../src/app/api/orders/[id]/certificates/route'),
  import('../src/lib/db'), import('../src/lib/auth'),
]);
const internalDir = path.join(dir, 'internal-cwd'); fs.mkdirSync(internalDir); process.chdir(internalDir);
const idb = getDb();
const shim = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  if (req.url !== '/api/sync/orders' || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
  const response = await syncOrders.POST(new NextRequest(`http://127.0.0.1:${internalPort}${req.url}`, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
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
for (const [id, role] of [['buyer', 'customer'], ['admin', 'admin'], ['clerk', 'staff']]) cdb.prepare('INSERT INTO users(id,name,email,password,role) VALUES (?,?,?,?,?)').run(id, id === 'buyer' ? '演练客户' : id, `${id}@example.invalid`, 'fixture-unused', role);
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-com', 'company-services', '公司咨询服务', 'COM-001', '公司注册', 100, 'CNY');
const log = fs.openSync(path.join(dir, 'client.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], { cwd: dir, env: clientEnv, stdio: ['ignore', log, log] });
const jwt = (await import(pathToFileURL(path.join(deps, 'server/node_modules/jsonwebtoken/index.js')).href)).default;
const pv = createHmac('sha256', 'client-regression-jwt').update('fixture-unused').digest('hex').slice(0, 16);
const roles: Record<string, string> = { buyer: 'customer', admin: 'admin', clerk: 'staff' };
async function client(method: string, url: string, body?: unknown, as = 'buyer') {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt.sign({ id: as, role: roles[as], name: as, pv }, 'client-regression-jwt')}` };
  if (!(body instanceof FormData) && body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${clientPort}${url}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
const pdfForm = (name: string, field = 'file') => { const f = new FormData(); f.append(field, new Blob([Buffer.from('%PDF-1.4 ' + name)], { type: 'application/pdf' }), name); return f; };
async function until<T>(label: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
}
// 2B：普通员工就能确认，用员工账号测
const emp = idb.prepare("SELECT id,name,auth_version FROM employees WHERE role='employee' LIMIT 1").get() as { id: number; name: string; auth_version: number };
idb.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(emp.id);
const empToken = await signToken({ id: emp.id, name: emp.name, role: 'employee', auth_version: emp.auth_version, must_change_password: 0 });
const call = (handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, method: string, orderId: string, sub: string, body?: unknown) =>
  handler(new NextRequest(`http://127.0.0.1/api/orders/${orderId}${sub}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${empToken}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: orderId }) });
const detail = async (orderId: string) => (await (await call(orderRoute.GET, 'GET', orderId, '')).json()) as any;
const firstStep = (orderId: string) => idb.prepare('SELECT id, status FROM order_steps WHERE order_id=? ORDER BY step_order LIMIT 1').get(orderId) as { id: number; status: string };
const lastProgress = (orderId: string) => { const r = idb.prepare('SELECT p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1').get(orderId) as { payload: string } | undefined; return r ? JSON.parse(r.payload) : null; };

const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }
try {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`http://127.0.0.1:${clientPort}/api/subscriptions/products`); if (r.ok) break; } catch {} if (i === 149) throw Error('client boot failed'); await new Promise(r => setTimeout(r, 200)); }
  const created = await client('POST', '/api/orders', { serviceName: '公司咨询服务', subCategory: '注册', skuName: '公司注册', skuCode: 'COM-001', price: 100, productId: 'p-com', quantity: 2 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const order = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='COM-001' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
  await until('内部接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order.id)?.receipt);
  const internal = (idb.prepare('SELECT DISTINCT internal_order_id id FROM sync_inbox WHERE source_order_no=? AND internal_order_id IS NOT NULL ORDER BY line_no, copy_no').all(order.order_no) as { id: string }[]).map(r => r.id);
  const custStatus = () => cdb.prepare('SELECT status FROM orders WHERE id=?').get(order.id).status as string;

  await test('new customer order: 待确认 on both sides, new-order reminder tells staff to confirm first', async () => {
    assert.equal(internal.length, 2);
    assert.equal(custStatus(), 'pending');
    for (const id of internal) {
      const d = await detail(id);
      assert.equal(d.status, '待处理'); assert.equal(d.awaiting_confirmation, true); assert.equal(d.confirmation, null); assert.equal(d.confirm_group_size, 2);
    }
    const list = await (await ordersRoute.GET(new NextRequest('http://127.0.0.1/api/orders', { headers: { authorization: `Bearer ${empToken}` } }))).json() as any[];
    assert(internal.every(id => list.find(o => o.id === id)?.awaiting_confirmation === true));
    const note = idb.prepare("SELECT body AS content FROM notifications WHERE related_id=? AND title='客户站新订单' LIMIT 1").get(internal[0]) as { content: string } | undefined;
    assert(note && note.content.includes('确认订单'), JSON.stringify(note));
  });
  await test('before confirmation the customer cannot upload documents, text or payment slips', async () => {
    for (const [url, body] of [[`/api/orders/${order.id}/documents`, pdfForm('license.pdf')], [`/api/orders/${order.id}/documents/unified`, pdfForm('a.pdf', 'files')],
      [`/api/orders/${order.id}/documents/text`, { text: '公司英文名' }], [`/api/orders/${order.id}/documents/quick`, pdfForm('q.pdf')], [`/api/orders/${order.id}/receipt`, pdfForm('slip.pdf')]] as [string, unknown][]) {
      const r = await client('POST', url, body);
      assert.equal(r.status, 409, `${url} ${JSON.stringify(r.body)}`); assert.equal(r.body.code, 'ORDER_AWAITING_CONFIRMATION');
    }
    assert.equal(cdb.prepare('SELECT COUNT(*) n FROM doc_submissions WHERE order_id=?').get(order.id).n, 0);
    const uploadDir = path.join(dir, 'client-server/uploads/docs');
    assert.equal(fs.existsSync(uploadDir) ? fs.readdirSync(uploadDir).length : 0, 0, 'rejected uploads are not kept on disk');
  });
  await test('before confirmation staff cannot start, send 补件, publish files or add certificates; assignee edits still work', async () => {
    const step = firstStep(internal[0]);
    for (const [handler, method, sub, body] of [
      [stepsRoute.PATCH, 'PATCH', '/steps', { step_id: step.id, status: '进行中' }],
      [stepsRoute.PATCH, 'PATCH', '/steps', { step_id: step.id, status: '已完成' }],
      [requests.POST, 'POST', '/supplement-requests', { name: '营业执照' }],
      [documents.POST, 'POST', '/documents', { name: '回执', direction: 'us_to_client', status: '已审核' }],
      [certificates.POST, 'POST', '/certificates', { certificate_number: 'C-1' }],
    ] as const) {
      const r = await call(handler as never, method, internal[0], sub, body);
      assert.equal(r.status, 409, `${sub} ${await r.clone().text()}`); assert.match((await r.json()).error, /确认订单/);
    }
    assert.equal(firstStep(internal[0]).status, '待处理');
    assert.equal((await call(stepsRoute.PATCH, 'PATCH', internal[0], '/steps', { step_id: step.id, assignee: emp.name })).status, 200);
    assert.equal((await call(documents.POST, 'POST', internal[0], '/documents', { name: '内部存档', direction: 'client_to_us' })).status, 201);
    assert.equal(lastProgress(internal[0])?.status ?? '待处理', '待处理');
  });
  await test('an ordinary employee confirms once: both copies confirmed, customer site shows 已确认 with one clear notice', async () => {
    const r = await call(confirmRoute.POST, 'POST', internal[1], '/confirm');
    assert.equal(r.status, 200, await r.clone().text());
    assert.deepEqual([...(await r.json()).order_ids].sort(), [...internal].sort());
    for (const id of internal) {
      const d = await detail(id);
      assert.equal(d.awaiting_confirmation, false); assert.equal(d.confirmation.confirmed_by, emp.name); assert.equal(d.status, '待处理');
      assert.equal(lastProgress(id).status, '已确认');
    }
    await until('客户站变已确认', () => custStatus() === 'confirmed');
    await until('两份进度都到', () => cdb.prepare("SELECT COUNT(*) n FROM sync_progress WHERE order_id=? AND status='已确认'").get(order.id).n === 2);
    const notes = cdb.prepare("SELECT title, content FROM notifications WHERE user_id='buyer' AND title IN ('订单状态更新','办理进度更新') AND content LIKE ?").all(`%${order.order_no}%`) as { title: string; content: string }[];
    assert.equal(notes.length, 1, JSON.stringify(notes)); assert.match(notes[0].content, /已确认，现在可以上传资料和付款水单/);
    const again = await call(confirmRoute.POST, 'POST', internal[0], '/confirm');
    assert.equal(again.status, 409); assert.match((await again.json()).error, /已经确认过了/);
  });
  await test('after confirmation the customer can upload and staff can work; slowest copy decides the customer status', async () => {
    const up = await client('POST', `/api/orders/${order.id}/documents`, pdfForm('license.pdf'));
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((await client('POST', `/api/orders/${order.id}/receipt`, pdfForm('slip.pdf'))).status, 200);
    assert.equal((await call(stepsRoute.PATCH, 'PATCH', internal[0], '/steps', { step_id: firstStep(internal[0]).id, status: '进行中' })).status, 200);
    await until('第一份进行中到客户站', () => cdb.prepare("SELECT 1 FROM sync_progress WHERE order_id=? AND status='进行中'").get(order.id));
    assert.equal(custStatus(), 'confirmed', 'second copy not started yet');
    assert.equal((await call(stepsRoute.PATCH, 'PATCH', internal[1], '/steps', { step_id: firstStep(internal[1]).id, status: '进行中' })).status, 200);
    await until('客户站变办理中', () => custStatus() === 'processing');
    assert.equal((await call(requests.POST, 'POST', internal[0], '/supplement-requests', { name: '营业执照' })).status, 201);
  });
  await test('orders staff create inside the internal site need no confirmation', async () => {
    const id = 'ORD-local-confirm-test';
    idb.prepare("INSERT INTO orders (id, customer_name, business_type_id, status, created_at, updated_at) VALUES (?, '内部客户', 1, '待处理', datetime('now'), datetime('now'))").run(id);
    idb.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status) VALUES (?, '方案确认', 1, '待处理')").run(id);
    assert.equal((await detail(id)).awaiting_confirmation, false);
    const r = await call(confirmRoute.POST, 'POST', id, '/confirm');
    assert.equal(r.status, 409); assert.match((await r.json()).error, /只有客户网站下的单/);
    assert.equal((await call(stepsRoute.PATCH, 'PATCH', id, '/steps', { step_id: firstStep(id).id, status: '进行中' })).status, 200);
  });
  await test('storefront orders already worked on before this change are not held back', async () => {
    const id = 'ORD-legacy-started';
    idb.prepare("INSERT INTO orders (id, customer_name, business_type_id, status, source_system, created_at, updated_at) VALUES (?, '老客户', 1, '待处理', 'storefront', datetime('now'), datetime('now'))").run(id);
    idb.prepare("INSERT INTO sync_inbox (id, source_order_no, line_no, copy_no, internal_order_id, payload) VALUES ('inbox-legacy', 'ORD-OLD-1', 1, 1, ?, '{}')").run(id);
    idb.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, started_at) VALUES (?, '方案确认', 1, '待处理', datetime('now','-3 day'))").run(id);
    assert.equal((await detail(id)).awaiting_confirmation, false, 'a step was started earlier (then withdrawn)');
  });
  await test('business-site back office (orders not handled by internal): confirm first, then move on; monthly fee orders exempt', async () => {
    const legacy = 'legacy-pending';
    cdb.prepare("INSERT INTO orders (id,order_no,user_id,service_name,sub_category,sku_name,sku_code,price,currency,status,customer_info) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(legacy, 'ORD-LEGACY-1', 'buyer', '商标服务', '泰国商标', '泰国商标注册', 'TRA-001', 2150, 'CNY', 'pending', '{}');
    assert.equal((await client('POST', `/api/orders/${legacy}/documents/text`, { text: '商标名' })).status, 409);
    const skip = await client('PATCH', `/api/admin/orders/${legacy}`, { status: 'processing' }, 'clerk');
    assert.equal(skip.status, 409); assert.equal(skip.body.code, 'ORDER_AWAITING_CONFIRMATION');
    const steps = await client('POST', `/api/admin/orders/${legacy}/steps/init`, {}, 'clerk');
    assert.equal(steps.status, 200);
    const stepId = steps.body.steps[0].id;
    assert.equal((await client('PATCH', `/api/admin/orders/${legacy}/steps/${stepId}`, { status: 'done' }, 'clerk')).status, 409);
    assert.equal((await client('POST', `/api/admin/orders/${legacy}/requirements`, { docName: '营业执照' }, 'clerk')).status, 409);
    assert.equal((await client('PATCH', `/api/admin/orders/${legacy}`, { status: 'confirmed' }, 'clerk')).status, 200, 'any staff can confirm');
    assert.equal(cdb.prepare('SELECT status FROM orders WHERE id=?').get(legacy).status, 'confirmed');
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND content LIKE '%ORD-LEGACY-1 已确认，现在可以上传资料和付款水单%'").get().n, 1);
    assert.equal((await client('POST', `/api/orders/${legacy}/documents/text`, { text: '商标名' })).status, 200);
    assert.equal((await client('PATCH', `/api/admin/orders/${legacy}/steps/${stepId}`, { status: 'done' }, 'clerk')).status, 200);
    assert.equal((await client('PATCH', `/api/admin/orders/${legacy}`, { status: 'processing' }, 'clerk')).status, 200);
    const sub = 'sub-month';
    cdb.prepare("INSERT INTO orders (id,order_no,user_id,service_name,sub_category,sku_name,sku_code,price,currency,status,customer_info) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(sub, 'ORD-SUB-1', 'buyer', '订阅', '月费', '月费', 'SUB-ACC', 500, 'CNY', 'pending', '{}');
    assert.equal((await client('POST', `/api/orders/${sub}/receipt`, pdfForm('month.pdf'))).status, 200, 'monthly fee slip accepted while pending');
    const cancel = 'legacy-cancel';
    cdb.prepare("INSERT INTO orders (id,order_no,user_id,service_name,sub_category,sku_name,sku_code,price,currency,status,customer_info) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(cancel, 'ORD-LEGACY-2', 'buyer', '商标服务', '泰国商标', '泰国商标注册', 'TRA-001', 2150, 'CNY', 'pending', '{}');
    assert.equal((await client('PATCH', `/api/admin/orders/${cancel}`, { status: 'cancelled' }, 'clerk')).status, 200, 'unwanted orders can still be cancelled');
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
