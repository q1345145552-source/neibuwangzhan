/**
 * 资料打通端到端（2026-10-03，规则 12）：真客户站进程 ↔ 内部真路由（本进程内小转发服务）。
 * 客户在客户站交资料 → 内部挂到每一份办理单 → 员工在内部审核/退回 → 结果回到客户站并通知客户。
 * 全部是临时目录里的合成库与本机端口，不连任何外部地址。
 * Run (from this repo): node --import <tsx loader> scripts/test-sync-documents.mts
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
const dir = fs.mkdtempSync('/tmp/xt-docsync-');
const freePort = () => new Promise<number>(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => resolve(p)); }); });
const [clientPort, internalPort] = [await freePort(), await freePort()];
const SECRET = 'docsync-regression-secret';
Object.assign(process.env, {
  NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'internal-regression-jwt',
  SYNC_SECRET: SECRET, CUSTOMER_SYNC_URL: `http://127.0.0.1:${clientPort}`,
});

// ── 内部：真路由 + 本进程转发服务 ──
const [orders, documents, docsRoute, { getDb }, { signToken }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/[id]/documents/route'),
  import('../src/app/api/sync/documents/route'), import('../src/lib/db'), import('../src/lib/auth'),
]);
const internalDir = path.join(dir, 'internal-cwd'); fs.mkdirSync(internalDir); process.chdir(internalDir); // 内部上传目录 = cwd/uploads
const idb = getDb();
const shim = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const handler = req.url === '/api/sync/orders' ? orders.POST : req.url === '/api/sync/documents' ? docsRoute.POST : null;
  if (!handler || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
  const response = await handler(new NextRequest(`http://127.0.0.1:${internalPort}${req.url}`, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
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
for (const [id, role] of [['buyer', 'customer'], ['admin', 'admin']]) cdb.prepare('INSERT INTO users(id,name,email,password,role) VALUES (?,?,?,?,?)').run(id, id === 'buyer' ? '演练客户' : id, `${id}@example.invalid`, 'fixture-unused', role);
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-com', 'company-services', '公司咨询服务', 'COM-001', '公司注册', 100, 'CNY');
cdb.prepare('INSERT INTO products(id,category_id,category_name,sku_code,name,price,currency) VALUES (?,?,?,?,?,?,?)').run('p-tax', 'tax-compliance', '税务合规', 'TAX-005', '做账', 100, 'CNY');
const log = fs.openSync(path.join(dir, 'client.log'), 'w');
const child = spawn(process.execPath, [path.join(deps, 'node_modules/tsx/dist/cli.mjs'), path.join(server, 'index.ts')], { cwd: dir, env: clientEnv, stdio: ['ignore', log, log] });
const jwt = (await import(pathToFileURL(path.join(deps, 'server/node_modules/jsonwebtoken/index.js')).href)).default;
const pv = createHmac('sha256', 'client-regression-jwt').update('fixture-unused').digest('hex').slice(0, 16);
const clientToken = (id: string, role: string) => jwt.sign({ id, role, name: id, pv }, 'client-regression-jwt');
async function client(method: string, url: string, body?: unknown, as = 'buyer') {
  const headers: Record<string, string> = { authorization: `Bearer ${clientToken(as, as === 'buyer' ? 'customer' : as)}` };
  if (!(body instanceof FormData) && body !== undefined) headers['content-type'] = 'application/json';
  const r = await fetch(`http://127.0.0.1:${clientPort}${url}`, { method, headers, body: body instanceof FormData ? body : body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => ({})) as any };
}
async function until<T>(label: string, fn: () => T | undefined | null | false, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
}
const staff = idb.prepare("SELECT id,name,auth_version FROM employees WHERE role='admin' LIMIT 1").get() as { id: number; name: string; auth_version: number };
idb.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(staff.id);
const staffToken = await signToken({ id: staff.id, name: staff.name, role: 'admin', auth_version: staff.auth_version, must_change_password: 0 });
async function review(orderId: string, documentId: number, status: string, note?: string) {
  const r = await documents.PATCH(new NextRequest(`http://127.0.0.1/api/orders/${orderId}/documents`, { method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}` }, body: JSON.stringify({ document_id: documentId, status, ...(note ? { review_note: note } : {}) }) }), { params: Promise.resolve({ id: orderId }) });
  assert.equal(r.status, 200, await r.clone().text());
}
const activeStaff = (idb.prepare("SELECT COUNT(DISTINCT name) n FROM employees WHERE role IN ('admin','employee') AND status='在职' AND name<>''").get() as { n: number }).n;

const results: { name: string; result: string; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }
try {
  for (let i = 0; i < 150; i++) { try { const r = await fetch(`http://127.0.0.1:${clientPort}/api/subscriptions/products`); if (r.ok) break; } catch {} if (i === 149) throw Error('client boot failed'); await new Promise(r => setTimeout(r, 100)); }
  const created = await client('POST', '/api/orders', { serviceName: '公司咨询服务', subCategory: '注册', skuName: '公司注册', skuCode: 'COM-001', price: 100, productId: 'p-com', quantity: 2 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const order = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='COM-001' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
  await until('内部接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order.id)?.receipt);
  const internalOrders = (idb.prepare('SELECT DISTINCT internal_order_id id FROM sync_inbox WHERE source_order_no=? AND internal_order_id IS NOT NULL').all(order.order_no) as { id: string }[]).map(r => r.id);
  assert.equal(internalOrders.length, 2);
  const reqId = 'req-license';
  cdb.prepare("INSERT INTO doc_requirements (id,order_id,doc_name,doc_desc,required) VALUES (?,?,'营业执照','',1)").run(reqId, order.id);
  const pdf = Buffer.from('%PDF-1.4 synthetic license ' + 'x'.repeat(2000));
  const form = new FormData(); form.append('file', new Blob([pdf], { type: 'application/pdf' }), 'license.pdf'); form.append('requirementId', reqId);
  const up = await client('POST', `/api/orders/${order.id}/documents`, form);
  assert.equal(up.status, 200, JSON.stringify(up.body));
  const fileSub = up.body.id as string;
  assert.equal((await client('POST', `/api/orders/${order.id}/documents/text`, { text: '公司英文名：Synthetic Co., Ltd.' })).status, 200);
  cdb.prepare("INSERT INTO doc_submissions (id,requirement_id,order_id,user_id,file_name,file_path) VALUES ('slip-1',NULL,?,'buyer','水单-付款.png','/uploads/docs/none.png')").run(order.id);
  const docsOf = (orderId: string) => idb.prepare("SELECT id,name,status,file_url,uploaded_by,file_type FROM documents WHERE order_id=? ORDER BY id").all(orderId) as any[];

  await test('customer documents reach every internal copy; payment slip stays behind; staff reminded once per batch', async () => {
    await until('资料到内部', () => docsOf(internalOrders[1]).length >= 2 && docsOf(internalOrders[0]).length >= 2);
    for (const id of internalOrders) {
      const docs = docsOf(id);
      assert.equal(docs.length, 2, JSON.stringify(docs));
      const file = docs.find(d => d.name.includes('license.pdf'));
      assert.equal(file.name, '营业执照 · license.pdf'); assert.equal(file.status, '待审核'); assert.equal(file.uploaded_by, '客户站：演练客户');
      assert.deepEqual(fs.readFileSync(path.join(internalDir, 'uploads', path.basename(file.file_url))), pdf, 'file bytes identical');
      const txt = docs.find(d => d.file_type === 'text');
      assert.equal(fs.readFileSync(path.join(internalDir, 'uploads', path.basename(txt.file_url)), 'utf8'), '公司英文名：Synthetic Co., Ltd.');
      assert(!docs.some(d => d.name.includes('水单')));
    }
    const links = idb.prepare('SELECT COUNT(*) n FROM sync_documents WHERE source_order_no=?').get(order.order_no) as { n: number };
    assert.equal(links.n, 4);
    const reminders = (idb.prepare("SELECT COUNT(*) n FROM notifications WHERE related_id=? AND title='客户提交了资料'").get(order.order_no) as { n: number }).n;
    assert(reminders >= activeStaff && reminders % activeStaff === 0, `reminders ${reminders}`);
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM sync_doc_outbox WHERE submission_id='slip-1'").get().n, 0);
  });
  await test('staff approval in internal: sibling copy follows, customer sees 已通过 and is notified', async () => {
    const doc = docsOf(internalOrders[0]).find(d => d.name.includes('license.pdf'));
    await review(internalOrders[0], doc.id, '已审核');
    assert.equal(docsOf(internalOrders[1]).find(d => d.name.includes('license.pdf')).status, '已审核');
    await until('审核结果回到客户站', () => cdb.prepare('SELECT status FROM doc_submissions WHERE id=?').get(fileSub)?.status === 'approved');
    assert.equal(cdb.prepare('SELECT status FROM doc_requirements WHERE id=?').get(reqId).status, 'approved');
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title='资料审核结果' AND content LIKE '%已通过%'").get().n, 1);
  });
  await test('staff return with reason: customer sees 已驳回 + reason, requirement goes back to pending', async () => {
    const doc = docsOf(internalOrders[1]).find(d => d.name.includes('license.pdf'));
    await review(internalOrders[1], doc.id, '已退回', '执照过期，请上传最新的');
    await until('退回结果回到客户站', () => cdb.prepare('SELECT status FROM doc_submissions WHERE id=?').get(fileSub)?.status === 'rejected');
    const sub = cdb.prepare('SELECT status,review_note FROM doc_submissions WHERE id=?').get(fileSub);
    assert.equal(sub.review_note, '执照过期，请上传最新的');
    assert.equal(cdb.prepare('SELECT status FROM doc_requirements WHERE id=?').get(reqId).status, 'pending');
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title='资料审核结果' AND content LIKE '%执照过期%'").get().n, 1);
    assert.equal(cdb.prepare('SELECT seq FROM sync_doc_reviews WHERE submission_id=?').get(fileSub).seq, 2);
  });
  await test('business-site back office can no longer review synced documents', async () => {
    const r = await client('PATCH', `/api/admin/documents/${fileSub}/review`, { status: 'approved' }, 'admin');
    assert.equal(r.status, 409); assert.match(r.body.error, /内部系统审核/);
  });
  await test('file endpoint: needs the service key, never hands out payment slips', async () => {
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/${fileSub}/file`)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/slip-1/file`, { headers: { authorization: `Bearer ${SECRET}` } })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/${fileSub}/file`, { headers: { authorization: `Bearer ${SECRET}` } })).status, 200);
  });
  await test('resending the same batch creates nothing new', async () => {
    const before = (idb.prepare('SELECT COUNT(*) n FROM documents').get() as { n: number }).n;
    const items = (cdb.prepare("SELECT payload FROM sync_doc_outbox WHERE order_id=? AND kind='submit'").all(order.id) as { payload: string }[]).map(r => JSON.parse(r.payload));
    const r = await docsRoute.POST(new NextRequest('http://127.0.0.1/api/sync/documents', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ source_order_no: order.order_no, customer: { id: 'buyer', name: '演练客户' }, items }) }));
    const json = await r.json();
    assert.equal(r.status, 200); assert(json.results.every((x: any) => x.status === 'duplicate'), JSON.stringify(json));
    assert.equal((idb.prepare('SELECT COUNT(*) n FROM documents').get() as { n: number }).n, before);
  });
  await test('tax supplement image + text reach internal; deleting the image marks it 客户已删除', async () => {
    const taxCreated = await client('POST', '/api/orders', { serviceName: '税务合规', subCategory: '做账', skuName: '做账', skuCode: 'TAX-005', price: 100, productId: 'p-tax', quantity: 1 });
    assert.equal(taxCreated.status, 200, JSON.stringify(taxCreated.body));
    const tax = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='TAX-005' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
    await until('税务单接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(tax.id)?.receipt);
    const internalTax = (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=?').get(tax.order_no) as { id: string }).id;
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic')]);
    const form = new FormData(); form.append('images', new Blob([png], { type: 'image/png' }), '银行流水.png');
    const up = await client('POST', `/api/tax-orders/${tax.id}/supplements`, form);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((await client('PATCH', `/api/tax-orders/${tax.id}/supplement-text`, { text: '9 月有两笔退款' })).status, 200);
    await until('补充资料到内部', () => docsOf(internalTax).length >= 2);
    const docs = docsOf(internalTax);
    assert(docs.some(d => d.name === '补充资料 · 银行流水.png'), JSON.stringify(docs));
    assert(docs.some(d => d.name === '补充说明（文字）' && d.file_type === 'text'));
    const imageSub = up.body.files[0].id as string;
    assert.equal((await client('DELETE', `/api/tax-orders/${tax.id}/supplements/${imageSub}`)).status, 200);
    await until('撤回到内部', () => docsOf(internalTax).some(d => d.name === '补充资料 · 银行流水.png（客户已删除）'));
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
