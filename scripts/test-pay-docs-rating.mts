/**
 * 确认收款 + 订单资料 + 每步打分送特产（2026-10-20 老板 1A 2A 3A 4A）端到端：真客户站进程 ↔ 内部真路由（本进程内小转发服务）。
 * - 1A：内部看客户传的水单；员工不能确认收款、管理员能；业务系统账单变已付款并通知客户；账单新版本回到内部
 * - 2A：流程设置里给这套流程配说明书、资料收集表，客户打开订单能看到、能下载；别的单拿不到；删了就没了；
 *       员工标成合同的文件对客公开后，客户那边放在「合同」一栏，改回普通文件跟着变
 * - 3A 4A：办完的步骤客户才能打分、一步只评一次；按经办人加减积分；员工页面看得到；每一步都评完送特产、管理员收到提醒、员工点已送出
 * 全部是临时目录里的合成库与本机端口，不连任何外部地址。
 * Run (from this repo): CLIENT_SOURCE_ROOT=<客户站源码> node --import <tsx loader> scripts/test-pay-docs-rating.mts
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
const dir = fs.mkdtempSync('/tmp/xt-paydocs-');
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const [clientPort, internalPort] = [await freePort(), await freePort()];
const SECRET = 'paydocs-regression-secret';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'internal-regression-jwt',
  SYNC_SECRET: SECRET, CUSTOMER_SYNC_URL: `http://127.0.0.1:${clientPort}`,
});

// ── 内部：真路由 + 本进程转发服务（客户站会来调的那几条） ──
const [syncOrders, syncKit, syncKitFile, syncDeliveryFile, syncRatings, confirmRoute, stepsRoute, orderRoute, docsRoute, importRoute, filesRoute, paymentRoute, paymentConfirm, receiptRoute, ratingsRoute, giftsRoute,
  { getDb, getLegacyOrderStepsWithDocs, templateSignature }, { signToken }, progress, { uploadsDir }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/sync/order-kit/route'), import('../src/app/api/sync/order-kit/[fileId]/route'),
  import('../src/app/api/sync/deliveries/[deliveryId]/file/route'), import('../src/app/api/sync/step-ratings/route'),
  import('../src/app/api/orders/[id]/confirm/route'), import('../src/app/api/orders/[id]/steps/route'), import('../src/app/api/orders/[id]/route'),
  import('../src/app/api/orders/[id]/documents/route'), import('../src/app/api/workflows/import/route'), import('../src/app/api/workflows/[id]/files/route'),
  import('../src/app/api/orders/[id]/payment/route'), import('../src/app/api/orders/[id]/payment/confirm/route'), import('../src/app/api/orders/[id]/payment/receipts/[rid]/route'),
  import('../src/app/api/customer-ratings/route'), import('../src/app/api/customer-ratings/gifts/route'),
  import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/progress-sync'), import('../src/lib/uploads'),
]);
const internalDir = path.join(dir, 'internal-cwd'); fs.mkdirSync(internalDir); process.chdir(internalDir);
const idb = getDb();
const shim = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const url = new URL(req.url || '/', `http://127.0.0.1:${internalPort}`);
  const nreq = new NextRequest(url.toString(), { method: req.method, headers: req.headers as Record<string, string>, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) });
  let response: Response | null = null;
  if (url.pathname === '/api/sync/orders' && req.method === 'POST') response = await syncOrders.POST(nreq);
  else if (url.pathname === '/api/sync/step-ratings' && req.method === 'POST') response = await syncRatings.POST(nreq);
  else if (url.pathname === '/api/sync/order-kit') response = await syncKit.GET(nreq);
  else if (/^\/api\/sync\/order-kit\/\d+$/.test(url.pathname)) response = await syncKitFile.GET(nreq, { params: Promise.resolve({ fileId: url.pathname.split('/').pop()! }) });
  else if (/^\/api\/sync\/deliveries\/[^/]+\/file$/.test(url.pathname)) response = await syncDeliveryFile.GET(nreq, { params: Promise.resolve({ deliveryId: decodeURIComponent(url.pathname.split('/')[4]) }) });
  if (!response) { res.writeHead(404).end('{}'); return; }
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers.entries())).end(body);
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
cdb.prepare('INSERT INTO users(id,name,email,password,role) VALUES (?,?,?,?,?)').run('buyer', '演练客户', 'buyer@example.invalid', 'fixture-unused', 'customer');
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-com', 'company-services', '公司咨询服务', 'COM-001', '公司注册', 100, 'CNY');
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-mall', 'platform', 'Mall开店', 'PLA-004', '企业店入驻', 500, 'CNY');
const log = fs.openSync(path.join(dir, 'client.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], { cwd: dir, env: clientEnv, stdio: ['ignore', log, log] });
const jwt = (await import(pathToFileURL(path.join(deps, 'server/node_modules/jsonwebtoken/index.js')).href)).default;
const pv = createHmac('sha256', 'client-regression-jwt').update('fixture-unused').digest('hex').slice(0, 16);
async function client(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt.sign({ id: 'buyer', role: 'customer', name: 'buyer', pv }, 'client-regression-jwt')}` };
  if (body !== undefined && !(body instanceof FormData)) headers['content-type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${clientPort}${url}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await r.arrayBuffer());
  let json: any = {}; try { json = JSON.parse(raw.toString('utf8')); } catch { /* 文件 */ }
  return { status: r.status, body: json, raw };
}
async function until<T>(label: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
}
// 内部回传进度：路由里已经在发的那一轮会让这里跳过，所以边等边再发
const untilSent = <T,>(label: string, fn: () => T | undefined | null | false) => until(label, async () => { await progress.flushProgress(); return fn(); });
idb.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string) => idb.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get() as Emp;
const admin = empOf("role='admin' AND status='在职'"), emp = empOf("role='employee' AND status='在职'");
const tokenOf = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
async function call(handler: (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>, who: Emp, method: string, url: string, params: Record<string, string>, body?: unknown) {
  const res = await handler(new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(who)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve(params) });
  const raw = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(raw.toString('utf8')); } catch { /* 文件 */ }
  return { status: res.status, json, raw, type: res.headers.get('content-type') || '' };
}
async function placeOrder(sku: string, productId: string, name: string, price: number) {
  const created = await client('POST', '/api/orders', { serviceName: name, subCategory: '-', skuName: name, skuCode: sku, price, productId, quantity: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const order = cdb.prepare('SELECT id,order_no FROM orders WHERE sku_code=? ORDER BY rowid DESC LIMIT 1').get(sku) as { id: string; order_no: string };
  await until('内部接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order.id)?.receipt);
  const internalId = (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=? LIMIT 1').get(order.order_no) as { id: string }).id;
  return { ...order, internalId };
}
const notes = (title: string, orderNo: string) => (cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title=? AND content LIKE ?").get(title, `%${orderNo}%`) as { n: number }).n;
const stepRows = (orderId: string) => idb.prepare('SELECT id, step_order, assignee FROM order_steps WHERE order_id=? ORDER BY step_order').all(orderId) as { id: number; step_order: number; assignee: string }[];
async function finishStep(orderId: string, stepId: number) {
  const r = await call(stepsRoute.PATCH as never, admin, 'PATCH', `/api/orders/${orderId}/steps`, { id: orderId }, { step_id: stepId, status: '已完成' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
}
// 内部上传目录里放一份假文件，登记成员工上传的（跟 /api/upload 一样）
function fakeUpload(name: string, content: string) {
  fs.mkdirSync(uploadsDir, { recursive: true });
  const safe = `fixture-${Math.random().toString(36).slice(2)}_${name}`;
  fs.writeFileSync(path.join(uploadsDir, safe), content);
  idb.prepare('INSERT INTO file_uploads (filename, uploaded_by_id, uploaded_by_role, mime_type, size) VALUES (?, ?, ?, ?, ?)').run(safe, admin.id, 'admin', 'application/pdf', content.length);
  return `/api/files/${safe}`;
}

const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }
try {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`http://127.0.0.1:${clientPort}/api/subscriptions/products`); if (r.ok) break; } catch {} if (i === 149) throw Error('client boot failed'); await new Promise(r => setTimeout(r, 200)); }
  const co = await placeOrder('COM-001', 'p-com', '公司注册', 100);

  // ───────── 1A 确认收款 ─────────
  await test('payment: before 确认订单 nobody can confirm receipt', async () => {
    const r = await call(paymentConfirm.POST as never, admin, 'POST', `/api/orders/${co.internalId}/payment/confirm`, { id: co.internalId });
    assert.equal(r.status, 409); assert.match(r.json.error, /确认订单/);
  });
  await test('payment: staff see the bill and the slip the customer uploaded; only admins can confirm; customer is told once', async () => {
    assert.equal((await call(confirmRoute.POST as never, emp, 'POST', `/api/orders/${co.internalId}/confirm`, { id: co.internalId })).status, 200);
    await until('客户站已确认', () => cdb.prepare('SELECT status FROM orders WHERE id=?').get(co.id).status === 'confirmed');
    const f = new FormData(); f.append('file', new Blob([Buffer.from('\x89PNG fake slip')], { type: 'image/png' }), 'slip.png');
    assert.equal((await client('POST', `/api/orders/${co.id}/receipt`, f)).status, 200);
    const view = await call(paymentRoute.GET as never, emp, 'GET', `/api/orders/${co.internalId}/payment`, { id: co.internalId });
    assert.equal(view.status, 200, JSON.stringify(view.json));
    assert.equal(view.json.available, true); assert.equal(view.json.can_confirm, false);
    assert.equal(view.json.invoice.status, 'unpaid'); assert.equal(view.json.receipts.length, 1); assert.equal(view.json.receipts[0].name, 'slip.png');
    const file = await call(receiptRoute.GET as never, emp, 'GET', `/api/orders/${co.internalId}/payment/receipts/${view.json.receipts[0].id}`, { id: co.internalId, rid: view.json.receipts[0].id });
    assert.equal(file.status, 200); assert.deepEqual(file.raw, Buffer.from('\x89PNG fake slip'));
    const denied = await call(paymentConfirm.POST as never, emp, 'POST', `/api/orders/${co.internalId}/payment/confirm`, { id: co.internalId });
    assert.equal(denied.status, 403);
    const ok = await call(paymentConfirm.POST as never, admin, 'POST', `/api/orders/${co.internalId}/payment/confirm`, { id: co.internalId });
    assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.invoice.status, 'paid');
    assert.equal(cdb.prepare('SELECT status FROM invoices WHERE order_id=?').get(co.id).status, 'paid');
    assert.equal(notes('已确认收款', co.order_no), 1);
    assert.ok(cdb.prepare("SELECT 1 FROM order_status_history WHERE order_id=? AND remark LIKE '%已确认收款%'").get(co.id));
    const again = await call(paymentConfirm.POST as never, admin, 'POST', `/api/orders/${co.internalId}/payment/confirm`, { id: co.internalId });
    assert.equal(again.status, 200); assert.equal(again.json.already, true);
    assert.equal(notes('已确认收款', co.order_no), 1, 'no second notice');
    // 账单新版本回到内部：订单上「客户站账单」变已付
    await until('内部客户站账单已付', async () => (await call(orderRoute.GET as never, emp, 'GET', `/api/orders/${co.internalId}`, { id: co.internalId })).json.client_billing === 'paid');
  });

  // ───────── 2A 说明书、资料收集表、合同 ─────────
  await test('kit: files set in 流程设置 show on the customer order and download; other orders cannot fetch them; deleting hides them', async () => {
    assert.equal((await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', {}, {})).status, 200);
    const tplId = (idb.prepare('SELECT id FROM workflow_templates WHERE legacy_signature=?').get(templateSignature(getLegacyOrderStepsWithDocs(1, 'company-reg'))) as { id: number }).id;
    const mallTpl = (idb.prepare('SELECT id FROM workflow_templates WHERE legacy_signature=?').get(templateSignature(getLegacyOrderStepsWithDocs(8, 'enterprise'))) as { id: number }).id;
    const denied = await call(filesRoute.POST as never, emp, 'POST', `/api/workflows/${tplId}/files`, { id: String(tplId) }, { kind: '说明书', name: 'x.pdf', file_url: fakeUpload('x.pdf', '%PDF x') });
    assert.equal(denied.status, 403);
    const manual = await call(filesRoute.POST as never, admin, 'POST', `/api/workflows/${tplId}/files`, { id: String(tplId) }, { kind: '说明书', name: '公司注册说明书.pdf', file_url: fakeUpload('manual.pdf', '%PDF manual') });
    assert.equal(manual.status, 200, JSON.stringify(manual.json));
    const form = await call(filesRoute.POST as never, admin, 'POST', `/api/workflows/${tplId}/files`, { id: String(tplId) }, { kind: '资料收集表', name: '注册信息表.xlsx', file_url: fakeUpload('form.xlsx', 'PKform') });
    assert.equal(form.status, 200);
    const other = await call(filesRoute.POST as never, admin, 'POST', `/api/workflows/${mallTpl}/files`, { id: String(mallTpl) }, { kind: '说明书', name: 'Mall说明书.pdf', file_url: fakeUpload('mall.pdf', '%PDF mall') });
    assert.equal(other.status, 200);
    const bad = await call(filesRoute.POST as never, admin, 'POST', `/api/workflows/${tplId}/files`, { id: String(tplId) }, { kind: '合同', name: 'c.pdf', file_url: fakeUpload('c.pdf', '%PDF c') });
    assert.equal(bad.status, 400, 'contracts are per order, not per flow');
    const kit = await client('GET', `/api/orders/${co.id}/kit`);
    assert.equal(kit.status, 200); assert.equal(kit.body.available, true);
    assert.deepEqual(kit.body.files.map((f: { kind: string; name: string }) => `${f.kind}:${f.name}`).sort(), ['说明书:公司注册说明书.pdf', '资料收集表:注册信息表.xlsx']);
    const m = kit.body.files.find((f: { kind: string }) => f.kind === '说明书');
    const dl = await client('GET', `/api/orders/${co.id}/kit/${m.id}`);
    assert.equal(dl.status, 200); assert.equal(dl.raw.toString(), '%PDF manual');
    const mallFileId = other.json.id;
    assert.equal((await client('GET', `/api/orders/${co.id}/kit/${mallFileId}`)).status, 404, 'a file of another flow is not served');
    const del = await call(filesRoute.DELETE as never, admin, 'DELETE', `/api/workflows/${tplId}/files?file_id=${m.id}`, { id: String(tplId) });
    assert.equal(del.status, 200);
    const after = await client('GET', `/api/orders/${co.id}/kit`);
    assert.deepEqual(after.body.files.map((f: { kind: string }) => f.kind), ['资料收集表']);
    assert.equal((await client('GET', `/api/orders/${co.id}/kit/${m.id}`)).status, 404);
    const staffView = await call(orderRoute.GET as never, emp, 'GET', `/api/orders/${co.internalId}`, { id: co.internalId });
    assert.deepEqual(staffView.json.customer_kit.map((f: { kind: string }) => f.kind), ['资料收集表']);
  });
  await test('contract: a file staff mark as 合同 lands in the customer 合同 group; switching back moves it', async () => {
    const add = await call(docsRoute.POST as never, emp, 'POST', `/api/orders/${co.internalId}/documents`, { id: co.internalId }, { name: '服务合同', file_url: fakeUpload('contract.pdf', '%PDF contract'), direction: 'client_to_us', category: '合同' });
    assert.equal(add.status, 201, JSON.stringify(add.json)); assert.equal(add.json.category, '合同');
    const pub = await call(docsRoute.PATCH as never, emp, 'PATCH', `/api/orders/${co.internalId}/documents`, { id: co.internalId }, { document_id: add.json.id, status: '已审核', direction: 'us_to_client' });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const row = await untilSent('客户站收到合同', () => cdb.prepare("SELECT meta FROM order_deliveries WHERE order_id=? AND status='active'").get(co.id));
    assert.equal(JSON.parse(row.meta).category, '合同');
    assert.equal((await call(docsRoute.PATCH as never, emp, 'PATCH', `/api/orders/${co.internalId}/documents`, { id: co.internalId }, { document_id: add.json.id, category: '' })).status, 200);
    await untilSent('客户站改回交付文件', () => JSON.parse(cdb.prepare("SELECT meta FROM order_deliveries WHERE order_id=?").get(co.id).meta).category === undefined);
  });

  // ───────── 3A 4A 每步打分送特产 ─────────
  const mall = await placeOrder('PLA-004', 'p-mall', '企业店入驻', 500);
  assert.equal((await call(confirmRoute.POST as never, emp, 'POST', `/api/orders/${mall.internalId}/confirm`, { id: mall.internalId })).status, 200);
  const steps = stepRows(mall.internalId);
  // 第 2 步给普通员工、第 3 步给两个人（各算一次），第 4 步不写经办人（算订单负责人）
  idb.prepare('UPDATE order_steps SET assignee=? WHERE id=?').run(emp.name, steps[1].id);
  idb.prepare('UPDATE order_steps SET assignee=? WHERE id=?').run(`${emp.name}/${admin.name}`, steps[2].id);
  idb.prepare("UPDATE order_steps SET assignee='' WHERE id=?").run(steps[3].id);
  idb.prepare('UPDATE orders SET responsible_person=? WHERE id=?').run(admin.name, mall.internalId);
  const pointsOf = (name: string) => (idb.prepare("SELECT COALESCE(SUM(points),0) s FROM points_records WHERE employee_name=? AND rule_key='client_step_rating'").get(name) as { s: number }).s;

  await test('rating: only finished steps can be rated', async () => {
    await until('客户站收到进度', () => cdb.prepare('SELECT 1 FROM sync_progress WHERE order_id=?').get(mall.id));
    const r = await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 2, stars: 5, comment: '' });
    assert.equal(r.status, 409); assert.match(r.body.error, /办完/);
  });
  await test('rating: customer rates finished steps once; points go to the step assignee(s); staff see it under the step', async () => {
    await finishStep(mall.internalId, steps[0].id); await finishStep(mall.internalId, steps[1].id);
    await untilSent('第 2 步已完成到客户站', () => JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=?').get(mall.id).steps_json)[1].status === '已完成');
    const r = await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 2, stars: 5, comment: '很专业' });
    assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.gift.qualified, false);
    assert.equal((await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 2, stars: 1, comment: '' })).status, 409, 'one rating per step');
    await until('内部收到评价', () => idb.prepare('SELECT 1 FROM step_ratings WHERE source_order_no=? AND step_order=2').get(mall.order_no));
    assert.equal(pointsOf(emp.name), 3);
    // 积分记在客户打分那一刻（不是送到内部的时刻）
    const r2 = idb.prepare('SELECT rated_at FROM step_ratings WHERE source_order_no=? AND step_order=2').get(mall.order_no) as { rated_at: string };
    assert.equal((idb.prepare("SELECT created_at FROM points_records WHERE rule_key='client_step_rating' AND employee_name=? ORDER BY id LIMIT 1").get(emp.name) as { created_at: string }).created_at, r2.rated_at);
    const detail = await call(orderRoute.GET as never, emp, 'GET', `/api/orders/${mall.internalId}`, { id: mall.internalId });
    assert.deepEqual({ stars: detail.json.steps[1].customer_rating.stars, comment: detail.json.steps[1].customer_rating.comment }, { stars: 5, comment: '很专业' });
    const listed = await client('GET', `/api/orders/${mall.id}/step-ratings`);
    assert.equal(listed.body.ratings.length, 1);
  });
  await test('rating: a 2-star rating takes 3 points from each named assignee; no assignee falls back to the order owner', async () => {
    await finishStep(mall.internalId, steps[2].id);
    await untilSent('第 3 步已完成到客户站', () => JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=?').get(mall.id).steps_json)[2].status === '已完成');
    assert.equal((await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 3, stars: 2, comment: '有点慢' })).status, 200);
    await until('内部收到第 3 步评价', () => idb.prepare('SELECT 1 FROM step_ratings WHERE source_order_no=? AND step_order=3').get(mall.order_no));
    assert.equal(pointsOf(emp.name), 0, '+3 then -3');
    assert.equal(pointsOf(admin.name), -3);
    const mine = await call(ratingsRoute.GET as never, emp, 'GET', '/api/customer-ratings', {});
    assert.equal(mine.json.ratings.length, 2, 'employee sees ratings that name them');
    assert.ok(mine.json.summary.every((p: { person: string }) => p.person === emp.name));
    const all = await call(ratingsRoute.GET as never, admin, 'GET', '/api/customer-ratings', {});
    assert.ok(all.json.summary.some((p: { person: string }) => p.person === admin.name));
  });
  await test('gift: once every step is rated the customer is told, admins get a reminder, staff mark it sent', async () => {
    await finishStep(mall.internalId, steps[3].id);
    await untilSent('全部完成到客户站', () => JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=?').get(mall.id).steps_json).every((s: { status: string }) => s.status === '已完成'));
    assert.equal((await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 1, stars: 4, comment: '' })).status, 200);
    const last = await client('POST', `/api/orders/${mall.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: 4, stars: 5, comment: '谢谢' });
    assert.equal(last.status, 200); assert.equal(last.body.gift.qualified, true);
    await until('内部登记特产', () => idb.prepare('SELECT 1 FROM rating_gifts WHERE source_order_no=?').get(mall.order_no));
    assert.equal(pointsOf(admin.name), -3 + 3 + 3, 'owner gets the no-assignee steps (方案确认 4 星、第 4 步 5 星)');
    assert.ok(idb.prepare("SELECT 1 FROM notifications WHERE title='客户评价送特产' AND recipient=?").get(admin.name));
    const gifts = await call(giftsRoute.GET as never, emp, 'GET', '/api/customer-ratings/gifts', {});
    assert.equal(gifts.json.gifts.length, 1); assert.equal(gifts.json.gifts[0].sent_at, null); assert.equal(gifts.json.gifts[0].rating_count, 4);
    assert.equal((await call(giftsRoute.POST as never, emp, 'POST', '/api/customer-ratings/gifts', {}, { source_order_no: mall.order_no })).status, 200);
    assert.equal((await call(giftsRoute.POST as never, emp, 'POST', '/api/customer-ratings/gifts', {}, { source_order_no: mall.order_no })).status, 409);
    assert.equal((idb.prepare('SELECT sent_by FROM rating_gifts WHERE source_order_no=?').get(mall.order_no) as { sent_by: string }).sent_by, emp.name);
    // 奖惩页「刷新积分」重算本月自动积分：客户评价的积分重算不出来，不能被删掉
    const pointsRoute = await import('../src/app/api/internal/points/route');
    const before = [pointsOf(emp.name), pointsOf(admin.name)];
    const month = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 7);
    assert.equal((await call(pointsRoute.GET as never, admin, 'GET', `/api/internal/points?month=${month}&refresh=1`, {})).status, 200);
    assert.deepEqual([pointsOf(emp.name), pointsOf(admin.name)], before);
  });
  await test('gift: rating every finished step and then skipping the one left still counts — both sides agree', async () => {
    const o = await placeOrder('PLA-004', 'p-mall', '企业店入驻', 500);
    assert.equal((await call(confirmRoute.POST as never, emp, 'POST', `/api/orders/${o.internalId}/confirm`, { id: o.internalId })).status, 200);
    const ss = stepRows(o.internalId);
    for (const st of [ss[0], ss[1], ss[3]]) await finishStep(o.internalId, st.id);
    const done = (x: { status: string }) => x.status === '已完成';
    await untilSent('第 1、2、4 步完成到客户站', () => { const st = JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=?').get(o.id).steps_json); return done(st[0]) && done(st[1]) && done(st[3]); });
    for (const n of [1, 2, 4]) assert.equal((await client('POST', `/api/orders/${o.id}/step-ratings`, { line_no: 1, copy_no: 1, step_order: n, stars: 5, comment: '' })).status, 200);
    await until('内部收到 3 条评价', () => (idb.prepare('SELECT COUNT(*) n FROM step_ratings WHERE source_order_no=?').get(o.order_no) as { n: number }).n === 3);
    assert.equal(idb.prepare('SELECT 1 FROM rating_gifts WHERE source_order_no=?').get(o.order_no), undefined, 'step 3 still open');
    const skip = await call(stepsRoute.PATCH as never, admin, 'PATCH', `/api/orders/${o.internalId}/steps`, { id: o.internalId }, { step_id: ss[2].id, status: '已跳过', reason: '客户自己已经加好仓库地址' });
    assert.equal(skip.status, 200, JSON.stringify(skip.json));
    assert.ok(idb.prepare('SELECT 1 FROM rating_gifts WHERE source_order_no=?').get(o.order_no), 'skipping the open step completes the gift');
    await untilSent('第 3 步跳过到客户站', () => JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=?').get(o.id).steps_json)[2].status === '已跳过');
    assert.equal((await client('GET', `/api/orders/${o.id}/step-ratings`)).body.gift.qualified, true);
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
