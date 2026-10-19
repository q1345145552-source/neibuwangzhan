/**
 * 客户看到统一子标题和说明（2026-10-20 老板：主标题给员工看，子标题放到业务系统给客户看；选 1A 换掉客户原来看到的名字、2A 老单也换）端到端：
 * 真客户站进程 ↔ 内部真路由（本进程内小转发服务）。
 * - 客户下单 → 客户站进度里每一步是子标题、下面带说明；内部订单详情给员工看的是同一份
 * - 老单（客户站存的还是旧名字）：内部启动时补发一次，客户站换成子标题，不给客户发通知、不改订单状态；再启动不重复发
 * - 状态有变化却没发过的不归补发管
 * - 流程设置里删一步、改一步名、另填客户名字：说明按步骤名对，不错位；改名/另填的照填的、不带说明
 * 全部是临时目录里的合成库与本机端口，不连任何外部地址。
 * Run (from this repo): CLIENT_SOURCE_ROOT=<客户站源码> node --import <tsx loader> scripts/test-step-copy.mts
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
const dir = fs.mkdtempSync('/tmp/xt-stepcopy-');
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const [clientPort, internalPort] = [await freePort(), await freePort()];
const SECRET = 'stepcopy-regression-secret';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'internal-regression-jwt',
  SYNC_SECRET: SECRET, CUSTOMER_SYNC_URL: `http://127.0.0.1:${clientPort}`,
});

// ── 内部：真路由 + 本进程转发服务 ──
const [syncOrders, confirmRoute, stepsRoute, orderRoute, importRoute, publishRoute, { getDb, getLegacyOrderStepsWithDocs, templateSignature }, { signToken }, progress, { publicStepNames }, { COMPANY_REGISTRATION_STEP_COPY: RAW_COPY }, { buildWorkflowCatalog }, { publicNameToSubmit }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/[id]/confirm/route'), import('../src/app/api/orders/[id]/steps/route'),
  import('../src/app/api/orders/[id]/route'), import('../src/app/api/workflows/import/route'), import('../src/app/api/workflows/[id]/publish/route'),
  import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/progress-sync'), import('../src/lib/commerce-fulfillment'),
  import('../src/lib/company-registration-step-copy'), import('../src/lib/workflow-catalog'), import('../src/lib/workflow-public-name'),
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
cdb.prepare('INSERT INTO users(id,name,email,password,role) VALUES (?,?,?,?,?)').run('buyer', '演练客户', 'buyer@example.invalid', 'fixture-unused', 'customer');
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-com', 'company-services', '公司咨询服务', 'COM-001', '公司注册', 100, 'CNY');
const log = fs.openSync(path.join(dir, 'client.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], { cwd: dir, env: clientEnv, stdio: ['ignore', log, log] });
const jwt = (await import(pathToFileURL(path.join(deps, 'server/node_modules/jsonwebtoken/index.js')).href)).default;
const pv = createHmac('sha256', 'client-regression-jwt').update('fixture-unused').digest('hex').slice(0, 16);
async function client(method: string, url: string, body?: unknown) {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt.sign({ id: 'buyer', role: 'customer', name: 'buyer', pv }, 'client-regression-jwt')}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${clientPort}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
async function until<T>(label: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
}
idb.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string) => idb.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get() as Emp;
const admin = empOf("role='admin' AND status='在职'"), emp = empOf("role='employee' AND status='在职'");
const tokenOf = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
async function call(handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, who: Emp, method: string, url: string, id: string, body?: unknown) {
  const res = await handler(new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(who)}` }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ id }) });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
type PStep = { step_order: number; step_name: string; status: string; description?: string };
// 客户端不自称「我」：文案里的「我司」客户看到的是「服务商」
const COPY = RAW_COPY.map(c => ({ title: c.title, description: c.description.replace(/我司|我方|我们/g, '服务商') }));
const legacyNames = getLegacyOrderStepsWithDocs(1, 'company-reg').map(s => s.name);
const legacyPublic = publicStepNames(legacyNames);
const customerSteps = (orderId: string) => (cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=? ORDER BY line_no, copy_no LIMIT 1').get(orderId) as { steps_json: string } | undefined)
  ? JSON.parse(cdb.prepare('SELECT steps_json FROM sync_progress WHERE order_id=? ORDER BY line_no, copy_no LIMIT 1').get(orderId).steps_json) as PStep[] : [];
// 进度类通知（下单成功、请提交资料这类不算）
const notesFor = (orderNo: string) => (cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title IN ('订单状态更新','办理进度更新') AND content LIKE ?").get(`%${orderNo}%`) as { n: number }).n;
const outboxCount = (internalId: string) => (idb.prepare('SELECT COUNT(*) n FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=?').get(internalId) as { n: number }).n;
async function placeOrder() {
  const created = await client('POST', '/api/orders', { serviceName: '公司咨询服务', subCategory: '注册', skuName: '公司注册', skuCode: 'COM-001', price: 100, productId: 'p-com', quantity: 1 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const order = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='COM-001' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
  await until('内部接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order.id)?.receipt);
  const internalId = (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=? LIMIT 1').get(order.order_no) as { id: string }).id;
  return { ...order, internalId };
}

const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }
try {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`http://127.0.0.1:${clientPort}/api/subscriptions/products`); if (r.ok) break; } catch {} if (i === 149) throw Error('client boot failed'); await new Promise(r => setTimeout(r, 200)); }
  const first = await placeOrder();

  await test('customer site: every step shows the unified subtitle with its description; staff detail shows the same copy', async () => {
    const steps = await until('客户站收到进度', () => { const s = customerSteps(first.id); return s.length ? s : null; });
    assert.deepEqual(steps.map(s => s.step_name), COPY.map(c => c.title));
    assert.deepEqual(steps.map(s => s.description), COPY.map(c => c.description));
    assert.equal(steps[4].step_name, '会计专业审核', 'step 5 is what the customer sees, not the internal note');
    assert(RAW_COPY.some(c => c.description.includes('我司')), 'fixture really has 我司');
    assert(steps.every(s => !/我/.test(s.step_name + (s.description || ''))), 'customer never sees 我');
    const api = await client('GET', `/api/orders/${first.id}`);
    assert.equal(api.status, 200);
    const shown = (api.body.internal_progress?.[0]?.steps || []) as PStep[];
    assert.equal(shown[1].step_name, COPY[1].title); assert.equal(shown[1].description, COPY[1].description);
    const detail = await call(orderRoute.GET as never, emp, 'GET', `/api/orders/${first.internalId}`, first.internalId);
    assert.deepEqual(detail.json.steps.map((s: { customer_copy: { title: string } | null }) => s.customer_copy?.title), COPY.map(c => c.title));
    assert.equal(detail.json.steps[0].step_name, legacyNames[0]);
    assert.equal(detail.json.steps[4].step_name, legacyNames[4], 'staff still see the internal step name');
    assert.equal(notesFor(first.order_no), 0, 'initial progress sends no notice (unchanged rule)');
  });

  await test('old orders (2A): one resend on start swaps in the subtitles without a notice or a status change; a second start sends nothing', async () => {
    // 模拟上线前：内部最后一次回传和客户站存的都是旧名字、没说明
    const oldSteps = legacyNames.map((_, i) => ({ step_order: i + 1, step_name: legacyPublic[i], status: '待处理' }));
    const last = idb.prepare('SELECT p.id, p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1').get(first.internalId) as { id: string; payload: string };
    idb.prepare('UPDATE sync_progress_outbox SET payload=? WHERE id=?').run(JSON.stringify({ ...JSON.parse(last.payload), steps: oldSteps }), last.id);
    cdb.prepare('UPDATE sync_progress SET steps_json=? WHERE order_id=?').run(JSON.stringify(oldSteps), first.id);
    // 客户站整单状态故意跟进度对不上（模拟以前某次没同步好）：只换字的补发也不能顺手去改它
    cdb.prepare("UPDATE orders SET status='confirmed' WHERE id=?").run(first.id);
    cdb.prepare("UPDATE sync_progress SET updated_at='2026-10-01 01:00:00' WHERE order_id=?").run(first.id);
    const statusBefore = 'confirmed';
    const notesBefore = notesFor(first.order_no), outBefore = outboxCount(first.internalId);
    assert.equal(progress.resendChangedPublicText(idb), 1);
    assert.equal(outboxCount(first.internalId), outBefore + 1);
    await progress.flushProgress();
    const steps = await until('客户站换成子标题', () => { const s = customerSteps(first.id); return s[1]?.step_name === COPY[1].title ? s : null; });
    assert.equal(steps[1].description, COPY[1].description);
    assert.equal(notesFor(first.order_no), notesBefore, 'no 办理进度更新 notice for a wording-only change');
    assert.equal(cdb.prepare('SELECT status FROM orders WHERE id=?').get(first.id).status, statusBefore, 'wording-only resend never touches the order status');
    assert.equal(cdb.prepare('SELECT updated_at FROM sync_progress WHERE order_id=?').get(first.id).updated_at, '2026-10-01 01:00:00', '「更新于」 stays, nothing really progressed');
    assert.equal(progress.resendChangedPublicText(idb), 0, 'nothing left to resend');
    cdb.prepare("UPDATE orders SET status='pending' WHERE id=?").run(first.id);
  });

  await test('the resend never pushes a real status change that was not sent before', async () => {
    const last = idb.prepare('SELECT p.id, p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1').get(first.internalId) as { id: string; payload: string };
    const payload = JSON.parse(last.payload);
    const oldSteps = legacyNames.map((_, i) => ({ step_order: i + 1, step_name: legacyPublic[i], status: i === 0 ? '进行中' : '待处理' }));
    idb.prepare('UPDATE sync_progress_outbox SET payload=? WHERE id=?').run(JSON.stringify({ ...payload, steps: oldSteps }), last.id);
    try { assert.equal(progress.resendChangedPublicText(idb), 0); }
    finally { idb.prepare('UPDATE sync_progress_outbox SET payload=? WHERE id=?').run(last.payload, last.id); }
  });

  await test('normal work still notifies as before and keeps the descriptions', async () => {
    assert.equal((await call(confirmRoute.POST as never, emp, 'POST', `/api/orders/${first.internalId}/confirm`, first.internalId)).status, 200);
    await until('客户站已确认', () => cdb.prepare('SELECT status FROM orders WHERE id=?').get(first.id).status === 'confirmed');
    const step = idb.prepare('SELECT id FROM order_steps WHERE order_id=? ORDER BY step_order LIMIT 1').get(first.internalId) as { id: number };
    assert.equal((await call(stepsRoute.PATCH as never, emp, 'PATCH', `/api/orders/${first.internalId}/steps`, first.internalId, { step_id: step.id, status: '进行中' })).status, 200);
    await until('客户站办理中', () => cdb.prepare('SELECT status FROM orders WHERE id=?').get(first.id).status === 'processing');
    const steps = customerSteps(first.id);
    assert.equal(steps[0].status, '进行中'); assert.equal(steps[0].description, COPY[0].description);
    assert(notesFor(first.order_no) >= 2, 'confirmation and processing notices still go out');
  });

  await test('flow settings: delete a step, rename one, give one a custom customer name — descriptions follow the step, never shift', async () => {
    assert.equal((await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', '', {})).status, 200);
    const tpl = idb.prepare('SELECT id, current_version_id v FROM workflow_templates WHERE legacy_signature=?').get(templateSignature(getLegacyOrderStepsWithDocs(1, 'company-reg'))) as { id: number; v: number };
    const rows = (idb.prepare('SELECT step_order, name, public_name, assignee, notes, docs_json, expected_days FROM workflow_template_steps WHERE version_id=? ORDER BY step_order').all(tpl.v) as
      { step_order: number; name: string; public_name: string | null; assignee: string; notes: string; docs_json: string; expected_days: number | null }[])
      .map(s => ({ from: s.step_order, name: s.name, public_name: s.public_name || legacyPublic[s.step_order - 1], assignee: s.assignee, notes: s.notes, docs: JSON.parse(s.docs_json), expected_days: s.expected_days }));
    // 页面上点「修改」什么都不动直接发布：交上去的跟原来一样，拦下「没有改动」；只改备注也不把子标题写进流程
    const entry = buildWorkflowCatalog(idb).find(e => e.templateId === tpl.id)!;
    assert.equal(entry.steps[4].publicName, COPY[4].title, '流程设置显示客户实际看到的子标题');
    const pageRows = (notes: (i: number) => string) => entry.steps.map((s, i) => ({ from: i + 1, name: s.name, public_name: publicNameToSubmit(s, { name: s.name, publicName: s.publicName }),
      assignee: s.assignee, notes: notes(i), docs: s.docs, expected_days: s.expectedDays }));
    const noop = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${tpl.id}/publish`, String(tpl.id), { steps: pageRows(i => entry.steps[i].notes), base_version_id: tpl.v });
    assert.equal(noop.status, 400, JSON.stringify(noop.json)); assert.match(noop.json.error, /没有改动/);
    const notesOnly = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${tpl.id}/publish`, String(tpl.id), { steps: pageRows(i => i === 3 ? '备注改了' : entry.steps[i].notes), base_version_id: tpl.v });
    assert.equal(notesOnly.status, 200, JSON.stringify(notesOnly.json));
    tpl.v = (idb.prepare('SELECT current_version_id v FROM workflow_templates WHERE id=?').get(tpl.id) as { v: number }).v;
    const savedNames = (idb.prepare('SELECT public_name FROM workflow_template_steps WHERE version_id=? ORDER BY step_order').all(tpl.v) as { public_name: string | null }[]).map(r => r.public_name || '');
    assert.deepEqual(savedNames.map((n, i) => n || legacyPublic[i]), legacyPublic, 'subtitles are not written into the flow');
    // 删第 2 步（信息采集）；第 3 步改步骤名；第 4 步另填客户名字；其余照旧
    const edited = [rows[0], { ...rows[2], name: `${rows[2].name}（新写法）`, public_name: '开通政府系统账号' }, { ...rows[3], public_name: '本人实名验证' }, ...rows.slice(4)];
    const pub = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${tpl.id}/publish`, String(tpl.id), { steps: edited, base_version_id: tpl.v });
    assert.equal(pub.status, 200, JSON.stringify(pub.json));
    const second = await placeOrder();
    const steps = await until('新单进度到客户站', () => { const s = customerSteps(second.id); return s.length ? s : null; });
    assert.equal(steps.length, COPY.length - 1);
    assert.deepEqual(steps[0], { step_order: 1, step_name: COPY[0].title, status: '待处理', description: COPY[0].description });
    assert.deepEqual(steps[1], { step_order: 2, step_name: '开通政府系统账号', status: '待处理' }, 'renamed step: the filled name, no description');
    assert.deepEqual(steps[2], { step_order: 3, step_name: '本人实名验证', status: '待处理' }, 'custom customer name wins, no description');
    // 后面每一步都还是自己的子标题和说明，没往前错一格
    assert.deepEqual(steps.slice(3).map(s => s.step_name), COPY.slice(4).map(c => c.title));
    assert.deepEqual(steps.slice(3).map(s => s.description), COPY.slice(4).map(c => c.description));
    // 先前那张老单不受流程改动影响
    assert.equal(customerSteps(first.id)[1].step_name, COPY[1].title);
  });
  await test('customer site never rejects progress because of a bad description: wrong type dropped, too long cut', async () => {
    const row = cdb.prepare('SELECT seq FROM sync_progress WHERE order_id=? AND line_no=1 AND copy_no=1').get(first.id) as { seq: number };
    const steps = customerSteps(first.id).map((step, i) => ({ ...step, description: i === 0 ? 123 : i === 1 ? 'x'.repeat(5000) : step.description }));
    const r = await fetch(`http://127.0.0.1:${clientPort}/api/sync/progress`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ source_order_no: first.order_no, line_no: 1, copy_no: 1, seq: row.seq + 1, status: '进行中', steps }) });
    assert.equal(r.status, 200, await r.clone().text());
    const saved = customerSteps(first.id);
    assert.equal(saved[0].description, undefined);
    assert.equal(saved[1].description?.length, 1000);
    assert.equal(saved[2].description, COPY[2].description);
  });
  await test('same-name steps (FDA cosmetics has two 「再次等待官方审核」): delete or swap one, each keeps its own copy', async () => {
    const { resolveStepCopies } = await import('../src/lib/step-public-copy');
    const { FDA_STEP_COPY } = await import('../src/lib/fda-step-copy');
    const fda = FDA_STEP_COPY.cosmetics!;
    const names = getLegacyOrderStepsWithDocs(3, 'cosmetics').map(s => s.name);
    const pubs = publicStepNames(names);
    const dup = names.map((n, i) => n === '再次等待官方审核' ? i : -1).filter(i => i >= 0);
    assert.equal(dup.length, 2, 'fixture really has two same-name steps');
    const key = { business_type_id: 3, sub_service_type: 'cosmetics', address_type: '' };
    const asSaved = (idx: number[]) => idx.map(i => ({ step_name: names[i], public_name: pubs[i] }));
    // 原样（老单没记客户名 / 新单记了）：按第几次出现
    assert.deepEqual(resolveStepCopies(key, names.map(n => ({ step_name: n }))).map(c => c?.title), fda.map(c => c.title));
    assert.deepEqual(resolveStepCopies(key, asSaved(names.map((_, i) => i))).map(c => c?.title), fda.map(c => c.title));
    // 删掉第一个同名步骤：剩下那个还是自己的文案
    const without = names.map((_, i) => i).filter(i => i !== dup[0]);
    const r1 = resolveStepCopies(key, asSaved(without));
    assert.equal(r1[without.indexOf(dup[1])]?.title, fda[dup[1]].title);
    // 两个同名步骤对调：各自跟着自己走
    const swapped = names.map((_, i) => i === dup[0] ? dup[1] : i === dup[1] ? dup[0] : i);
    const r2 = resolveStepCopies(key, asSaved(swapped));
    assert.equal(r2[dup[0]]?.title, fda[dup[1]].title); assert.equal(r2[dup[1]]?.title, fda[dup[0]].title);
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
