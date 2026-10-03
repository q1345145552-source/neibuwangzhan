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
const [orders, documents, docsRoute, { getDb }, { signToken }, certificates, requests, deliveryFile, cancelSync, cancelDecide, orderRoute] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/[id]/documents/route'),
  import('../src/app/api/sync/documents/route'), import('../src/lib/db'), import('../src/lib/auth'),
  import('../src/app/api/orders/[id]/certificates/route'), import('../src/app/api/orders/[id]/supplement-requests/route'),
  import('../src/app/api/sync/deliveries/[deliveryId]/file/route'),
  import('../src/app/api/sync/cancel-requests/route'), import('../src/app/api/orders/[id]/cancel-requests/route'), import('../src/app/api/orders/[id]/route'),
]);
let dropDocsAck = 0; // >0：内部照常收下这批资料，但回给客户站的回执「丢了」（模拟网络断在回程）
const internalDir = path.join(dir, 'internal-cwd'); fs.mkdirSync(internalDir); process.chdir(internalDir); // 内部上传目录 = cwd/uploads
const idb = getDb();
const shim = http.createServer(async (req, res) => {
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  const fileMatch = /^\/api\/sync\/deliveries\/([^/]+)\/file$/.exec(req.url || '');
  if (fileMatch && req.method === 'GET') {
    const response = await deliveryFile.GET(new NextRequest(`http://127.0.0.1:${internalPort}${req.url}`, { headers: req.headers as Record<string, string> }), { params: Promise.resolve({ deliveryId: fileMatch[1] }) });
    res.writeHead(response.status, Object.fromEntries(response.headers.entries())).end(Buffer.from(await response.arrayBuffer())); return;
  }
  const handler = req.url === '/api/sync/orders' ? orders.POST : req.url === '/api/sync/documents' ? docsRoute.POST : req.url === '/api/sync/cancel-requests' ? cancelSync.POST : null;
  if (!handler || req.method !== 'POST') { res.writeHead(404).end('{}'); return; }
  const response = await handler(new NextRequest(`http://127.0.0.1:${internalPort}${req.url}`, { method: 'POST', headers: req.headers as Record<string, string>, body: Buffer.concat(chunks) }));
  if (req.url === '/api/sync/documents' && dropDocsAck > 0) { dropDocsAck--; res.writeHead(502).end('{}'); return; }
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
async function until<T>(label: string, fn: () => T | undefined | null | false | Promise<T | undefined | null | false>, ms = 45_000): Promise<T> {
  const start = Date.now();
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() - start > ms) throw new Error(`等待超时：${label}`); await new Promise(r => setTimeout(r, 300)); }
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
  // ── 补件要求与交付文件回传（2026-10-03，规则 13）──
  const staffCall = async (handler: (r: NextRequest, c: { params: Promise<{ id: string }> }) => Promise<Response>, orderId: string, method: string, body?: unknown) => {
    const r = await handler(new NextRequest(`http://127.0.0.1/api/orders/${orderId}/x`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${staffToken}` },
      body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id: orderId }) });
    return { status: r.status, body: await r.json() as any };
  };
  await test('supplement request: reaches the customer to-do, customer submits against it, internal sees 客户已交', async () => {
    const sent = await staffCall(requests.POST, internalOrders[0], 'POST', { name: '最新营业执照', description: '要 3 个月内开的' });
    assert.equal(sent.status, 201, JSON.stringify(sent.body));
    const reqId = `sreq-${sent.body.id}`;
    await until('补件要求到客户站', () => cdb.prepare('SELECT doc_name,doc_desc,status FROM doc_requirements WHERE id=?').get(reqId));
    assert.deepEqual(cdb.prepare('SELECT doc_name,doc_desc,status FROM doc_requirements WHERE id=?').get(reqId), { doc_name: '最新营业执照', doc_desc: '要 3 个月内开的', status: 'pending' });
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title='资料需求通知' AND content LIKE '%最新营业执照%'").get().n, 1);
    const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.4 new license')], { type: 'application/pdf' }), 'license-new.pdf'); form.append('requirementId', reqId);
    assert.equal((await client('POST', `/api/orders/${order.id}/documents`, form)).status, 200);
    await until('客户按补件交的资料到内部并标已交', () => (idb.prepare('SELECT submitted_at FROM sync_document_requests WHERE id=?').get(sent.body.id) as { submitted_at: string | null }).submitted_at);
    assert(docsOf(internalOrders[0]).some(d => d.name === '最新营业执照 · license-new.pdf'));
    const listed = await staffCall(requests.GET, internalOrders[0], 'GET');
    assert.equal(listed.body[0].submitted_at !== null, true);
  });
  await test('published document is delivered: customer sees and downloads it, others cannot; unpublish hides it', async () => {
    const bytes = Buffer.from('%PDF-1.4 company certificate ' + 'y'.repeat(500));
    fs.mkdirSync(path.join(internalDir, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(internalDir, 'uploads', 'deliv-cert.pdf'), bytes);
    const added = await staffCall(documents.POST, internalOrders[0], 'POST', { name: '公司注册证书', direction: 'client_to_us', file_url: '/api/files/deliv-cert.pdf' });
    assert.equal(added.status, 201);
    assert.equal((await staffCall(documents.PATCH, internalOrders[0], 'PATCH', { document_id: added.body.id, status: '已审核', direction: 'us_to_client' })).status, 200);
    const list = await until('交付到客户站', async () => { const r = await client('GET', `/api/orders/${order.id}/deliveries`); return r.body.length ? r.body : null; });
    const item = (list as any[]).find((d: any) => d.name === '公司注册证书');
    assert(item && item.has_file && item.file_ext === '.pdf', JSON.stringify(list));
    const dl = await fetch(`http://127.0.0.1:${clientPort}/api/orders/${order.id}/deliveries/${item.id}/download`, { headers: { authorization: `Bearer ${clientToken('buyer', 'customer')}` } });
    assert.equal(dl.status, 200); assert.deepEqual(Buffer.from(await dl.arrayBuffer()), bytes);
    cdb.prepare("INSERT INTO users(id,name,email,password,role) VALUES ('other','other','other@example.invalid','fixture-unused','customer')").run();
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/orders/${order.id}/deliveries`, { headers: { authorization: `Bearer ${clientToken('other', 'customer')}` } })).status, 403);
    assert.equal(cdb.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id='buyer' AND title='交付文件' AND content LIKE '%公司注册证书%'").get().n, 1);
    assert.equal((await staffCall(documents.PATCH, internalOrders[0], 'PATCH', { document_id: added.body.id, direction: 'client_to_us' })).status, 200);
    await until('撤回后客户看不到', async () => { const r = await client('GET', `/api/orders/${order.id}/deliveries`); return !r.body.some((d: any) => d.name === '公司注册证书'); });
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/orders/${order.id}/deliveries/${item.id}/download`, { headers: { authorization: `Bearer ${clientToken('buyer', 'customer')}` } })).status, 404);
  });
  await test('certificate is delivered with its dates and file; deleting it withdraws it', async () => {
    fs.writeFileSync(path.join(internalDir, 'uploads', 'fda-cert.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]));
    const cert = await staffCall(certificates.POST, internalOrders[1], 'POST', { certificate_number: 'FDA-123', product_name: '面霜', issue_date: '2026-10-01', expiry_date: '2031-10-01', file_url: '/api/files/fda-cert.png' });
    assert.equal(cert.status, 201);
    const list = await until('证书交付到客户站', async () => { const r = await client('GET', `/api/orders/${order.id}/deliveries`); return r.body.find((d: any) => d.kind === 'certificate'); });
    assert.equal((list as any).name, '证书 · 面霜 · 编号 FDA-123'); assert.equal((list as any).meta.expiry_date, '2031-10-01'); assert.equal((list as any).file_ext, '.png');
    assert.equal((await staffCall(certificates.DELETE, internalOrders[1], 'DELETE', { cert_id: cert.body.id })).status, 200);
    await until('删证书后撤回', async () => { const r = await client('GET', `/api/orders/${order.id}/deliveries`); return !r.body.some((d: any) => d.kind === 'certificate'); });
  });
  await test('internal-only orders: no supplement requests, publishing sends nothing; delivery file endpoint guarded', async () => {
    idb.prepare("INSERT INTO orders(id,customer_name,business_type_id,status) VALUES ('LOCAL-ONLY','本地客户',1,'待处理')").run();
    const r = await staffCall(requests.POST, 'LOCAL-ONLY', 'POST', { name: '护照' });
    assert.equal(r.status, 409);
    const before = (idb.prepare('SELECT COUNT(*) n FROM sync_document_outbox').get() as { n: number }).n;
    const d = await staffCall(documents.POST, 'LOCAL-ONLY', 'POST', { name: '本地文件', direction: 'us_to_client', status: '已审核', file_url: '/api/files/deliv-cert.pdf' });
    assert.equal(d.status, 201);
    assert.equal((idb.prepare('SELECT COUNT(*) n FROM sync_document_outbox').get() as { n: number }).n, before);
    assert.equal((await fetch(`http://127.0.0.1:${internalPort}/api/sync/deliveries/doc-${d.body.id}/file`, { headers: { authorization: `Bearer ${SECRET}` } })).status, 404, 'not a synced order');
    assert.equal((await fetch(`http://127.0.0.1:${internalPort}/api/sync/deliveries/doc-1/file`)).status, 401, 'needs the key');
  });
  await test('stale delivery event does not resurrect a withdrawn file', async () => {
    const r = await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/delivery`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ event: 'delivery', source_order_no: order.order_no, delivery_id: cdb.prepare("SELECT delivery_id FROM order_deliveries WHERE kind='certificate'").get().delivery_id, seq: 1, action: 'upsert', kind: 'certificate', name: '旧事件', meta: {}, has_file: false }) });
    assert.equal(r.status, 200); assert.equal((await r.json() as any).stale, true);
    const list = await client('GET', `/api/orders/${order.id}/deliveries`);
    assert(!list.body.some((d: any) => d.name === '旧事件'));
  });
  await test('a delivery number arriving for another order moves there; the replaced file is removed', async () => {
    const second = await client('POST', '/api/orders', { serviceName: '税务合规', subCategory: '做账', skuName: '做账', skuCode: 'TAX-005', price: 100, productId: 'p-tax', quantity: 1 });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const order2 = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='TAX-005' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string };
    await until('第二张单接单回执', () => cdb.prepare('SELECT receipt FROM sync_outbox WHERE order_id=?').get(order2.id)?.receipt);
    const added = await staffCall(documents.POST, internalOrders[0], 'POST', { name: '换单前的文件', direction: 'us_to_client', status: '已审核', file_url: '/api/files/deliv-cert.pdf' });
    assert.equal(added.status, 201);
    const row = await until('第一张单收到交付', () => cdb.prepare("SELECT delivery_id,seq,file_path FROM order_deliveries WHERE order_id=? AND name='换单前的文件' AND status='active' AND file_path IS NOT NULL").get(order.id) as { delivery_id: string; seq: number; file_path: string } | undefined);
    const oldFile = path.join(server, row.file_path);
    assert(fs.existsSync(oldFile), 'delivered file stored under the client server');
    const r = await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/delivery`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ event: 'delivery', source_order_no: order2.order_no, delivery_id: row.delivery_id, seq: row.seq + 1, action: 'upsert', kind: 'document', name: '另一单的交付', meta: {}, has_file: false }) });
    assert.equal(r.status, 200, await r.clone().text());
    assert(!(await client('GET', `/api/orders/${order.id}/deliveries`)).body.some((d: any) => d.delivery_id === row.delivery_id), 'gone from the first order');
    assert((await client('GET', `/api/orders/${order2.id}/deliveries`)).body.some((d: any) => d.name === '另一单的交付'), 'shown on the second order');
    assert(!fs.existsSync(oldFile), 'replaced file removed');
    assert(cdb.prepare("SELECT 1 FROM notifications WHERE content LIKE '%另一单的交付%' AND link=?").get(`/dashboard/order/${order2.id}`), 'second order owner notified');
  });
  // ── 站内申请取消（2026-10-03，规则 19/20）──
  const copyOrder = (copy: number) => (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=? AND line_no=1 AND copy_no=?').get(order.order_no, copy) as { id: string }).id;
  const admins = (idb.prepare("SELECT COUNT(DISTINCT name) n FROM employees WHERE role='admin' AND status='在职' AND name<>''").get() as { n: number }).n;
  const cancelOf = (copy: number, status = 'pending') => idb.prepare('SELECT * FROM sync_cancel_requests WHERE internal_order_id=? AND status=? ORDER BY rowid DESC').get(copyOrder(copy), status) as any;
  const clientReq = (id: string) => cdb.prepare('SELECT * FROM order_cancel_requests WHERE id=?').get(id) as any;
  await test('customer cancel request reaches internal admins only; the order keeps running', async () => {
    assert.equal((await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 2, reason: '' })).status, 400, 'reason required');
    const r = await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 2, reason: '第二家公司不需要了' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 2, reason: '再点一次' })).status, 409, 'one pending per copy');
    assert.equal((await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 9, reason: '不存在' })).status, 404);
    assert.equal((await fetch(`http://127.0.0.1:${clientPort}/api/orders/${order.id}/cancel-requests`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${clientToken('other', 'customer')}` }, body: JSON.stringify({ line_no: 1, copy_no: 1, reason: 'x' }) })).status, 403);
    const row = await until('申请送到内部', () => cancelOf(2));
    assert.equal(row.id, r.body.id); assert.equal(row.reason, '第二家公司不需要了');
    assert.notEqual((idb.prepare('SELECT status FROM orders WHERE id=?').get(copyOrder(2)) as any).status, '客户取消', 'request alone does not cancel');
    assert.equal((idb.prepare("SELECT COUNT(*) n FROM notifications WHERE title='客户申请取消' AND related_id=?").get(copyOrder(2)) as any).n, admins);
    assert.equal((idb.prepare("SELECT COUNT(*) n FROM notifications n JOIN employees e ON e.name=n.recipient WHERE n.title='客户申请取消' AND e.role<>'admin'").get() as any).n, 0, 'admins only');
    assert.equal(clientReq(r.body.id).send_status, 'sent');
  });
  await test('only an admin decides; rejecting needs a reason and the customer sees it', async () => {
    const row = cancelOf(2);
    const emp = idb.prepare("SELECT id,name,auth_version FROM employees WHERE role='employee' AND status='在职' LIMIT 1").get() as { id: number; name: string; auth_version: number };
    idb.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(emp.id);
    const empToken = await signToken({ id: emp.id, name: emp.name, role: 'employee', auth_version: emp.auth_version, must_change_password: 0 });
    const asEmp = await cancelDecide.POST(new NextRequest('http://127.0.0.1/x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${empToken}` }, body: JSON.stringify({ request_id: row.id, decision: 'approve' }) }), { params: Promise.resolve({ id: copyOrder(2) }) });
    assert.equal(asEmp.status, 403);
    assert.equal((await staffCall(cancelDecide.POST, copyOrder(2), 'POST', { request_id: row.id, decision: 'reject' })).status, 400, 'reason required');
    assert.equal((await staffCall(cancelDecide.POST, copyOrder(2), 'POST', { request_id: row.id, decision: 'reject', note: '材料已递交官方，撤不回来' })).status, 200);
    assert.equal((await staffCall(cancelDecide.POST, copyOrder(2), 'POST', { request_id: row.id, decision: 'approve' })).status, 409, 'decided once');
    await until('驳回回到客户站', () => clientReq(row.id).status === 'rejected');
    assert.equal(clientReq(row.id).decision_note, '材料已递交官方，撤不回来');
    assert(cdb.prepare("SELECT 1 FROM notifications WHERE user_id='buyer' AND title='取消申请结果' AND content LIKE '%材料已递交官方%' AND content LIKE '%继续办理%'").get());
    assert.notEqual((idb.prepare('SELECT status FROM orders WHERE id=?').get(copyOrder(2)) as any).status, '客户取消');
  });
  await test('approving cancels only that copy; the customer sees it cancelled and the other copy continues', async () => {
    const r = await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 2, reason: '还是不要了' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const row = await until('第二次申请送到内部', () => cancelOf(2));
    assert.equal((await staffCall(cancelDecide.POST, copyOrder(2), 'POST', { request_id: row.id, decision: 'approve' })).status, 200);
    const internal = idb.prepare('SELECT status,cancel_reason FROM orders WHERE id=?').get(copyOrder(2)) as any;
    assert.equal(internal.status, '客户取消'); assert.equal(internal.cancel_reason, '客户申请取消：还是不要了');
    await until('同意回到客户站', () => clientReq(row.id).status === 'approved');
    await until('该份进度变客户取消', () => (cdb.prepare('SELECT status FROM sync_progress WHERE order_id=? AND line_no=1 AND copy_no=2').get(order.id) as any)?.status === '客户取消');
    assert.notEqual((idb.prepare('SELECT status FROM orders WHERE id=?').get(copyOrder(1)) as any).status, '客户取消');
    assert.notEqual((cdb.prepare('SELECT status FROM orders WHERE id=?').get(order.id) as any).status, 'cancelled', 'other copy still active');
    assert(cdb.prepare("SELECT 1 FROM notifications WHERE user_id='buyer' AND title='取消申请结果' AND content LIKE '%已同意%' AND content LIKE '%另行%'").get());
    assert.equal((await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 2, reason: '再申请' })).status, 409, 'already cancelled');
  });
  await test('an admin cancelling directly also answers the pending request; all copies cancelled → order cancelled', async () => {
    const r = await client('POST', `/api/orders/${order.id}/cancel-requests`, { line_no: 1, copy_no: 1, reason: '第一家也不要了' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    await until('申请送到内部', () => cancelOf(1));
    assert.equal((await staffCall(orderRoute.PATCH, copyOrder(1), 'PATCH', { cancel: true, cancel_reason: '客户电话确认不做了' })).status, 200);
    await until('直接取消也回传同意', () => clientReq(r.body.id).status === 'approved');
    await until('整单变已取消', () => (cdb.prepare('SELECT status FROM orders WHERE id=?').get(order.id) as any).status === 'cancelled');
  });
  await test('legacy cancel points synced orders to the new flow; a request for an already-cancelled copy is answered at once', async () => {
    const order2 = cdb.prepare("SELECT id,order_no,status FROM orders WHERE sku_code='TAX-005' ORDER BY rowid DESC LIMIT 1").get() as { id: string; order_no: string; status: string };
    const legacy = await client('POST', `/api/orders/${order2.id}/cancel`);
    assert.equal(legacy.status, 409); assert.match(legacy.body.error, /按服务申请取消/);
    const target = (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=? AND line_no=1 AND copy_no=1').get(order2.order_no) as { id: string }).id;
    assert.equal((await staffCall(orderRoute.PATCH, target, 'PATCH', { cancel: true, cancel_reason: '内部先取消' })).status, 200);
    const before = (idb.prepare("SELECT COUNT(*) n FROM notifications WHERE title='客户申请取消'").get() as any).n;
    const resp = await fetch(`http://127.0.0.1:${internalPort}/api/sync/cancel-requests`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ source_order_no: order2.order_no, request_id: 'already-cancelled-1', line_no: 1, copy_no: 1, reason: '晚到的申请' }) });
    const ack = await resp.json() as any;
    assert.equal(resp.status, 200); assert.equal(ack.status, 'approved');
    assert.equal((idb.prepare("SELECT COUNT(*) n FROM notifications WHERE title='客户申请取消'").get() as any).n, before, 'no reminder for a done deal');
    assert.equal((await fetch(`http://127.0.0.1:${internalPort}/api/sync/cancel-requests`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
  });
  // ── 10-03 审查后修的问题 ──
  const taxOrder = cdb.prepare("SELECT id,order_no FROM orders WHERE sku_code='TAX-005' ORDER BY rowid LIMIT 1").get() as { id: string; order_no: string };
  const internalTax = (idb.prepare('SELECT internal_order_id id FROM sync_inbox WHERE source_order_no=?').get(taxOrder.order_no) as { id: string }).id;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('synthetic-2')]);
  await test('a document deleted while its send result was lost is still withdrawn in internal; reviewing it later does not loop', async () => {
    dropDocsAck = 1;
    const form = new FormData(); form.append('images', new Blob([png], { type: 'image/png' }), '回执丢失.png');
    const up = await client('POST', `/api/tax-orders/${taxOrder.id}/supplements`, form);
    assert.equal(up.status, 200, JSON.stringify(up.body));
    const sub = up.body.files[0].id as string;
    await until('内部已收下但客户站没收到回执', () => docsOf(internalTax).some(d => d.name === '补充资料 · 回执丢失.png')
      && (cdb.prepare("SELECT attempts,status FROM sync_doc_outbox WHERE submission_id=? AND kind='submit'").get(sub) as any)?.attempts >= 1);
    assert.equal((await client('DELETE', `/api/tax-orders/${taxOrder.id}/supplements/${sub}`)).status, 200);
    await until('内部标客户已删除', () => docsOf(internalTax).some(d => d.name === '补充资料 · 回执丢失.png（客户已删除）'));
    const doc = docsOf(internalTax).find(d => d.name === '补充资料 · 回执丢失.png（客户已删除）');
    await review(internalTax, doc.id, '已退回', '看不清');
    await until('审核结果被客户站收下（不再无限重试）', () => (idb.prepare("SELECT status FROM sync_document_outbox WHERE submission_id=? AND payload LIKE '%\"seq\"%' ORDER BY rowid DESC").get(sub) as any)?.status === 'sent');
  });
  await test('the review of a supplement text reaches the customer', async () => {
    const doc = docsOf(internalTax).find(d => d.name === '补充说明（文字）');
    assert(doc, JSON.stringify(docsOf(internalTax)));
    await review(internalTax, doc.id, '已退回', '请写清退款日期');
    await until('客户收到补充说明的审核结果', () => cdb.prepare("SELECT 1 FROM notifications WHERE user_id='buyer' AND content LIKE '%补充说明（文字）已驳回%请写清退款日期%'").get());
  });
  await test('a very long account name or file name no longer blocks a customer\'s documents', async () => {
    const before = (cdb.prepare("SELECT name FROM users WHERE id='buyer'").get() as { name: string }).name;
    cdb.prepare("UPDATE users SET name=? WHERE id='buyer'").run('很长的客户名'.repeat(30));
    try {
      const longName = '超长文件名'.repeat(60) + '.pdf';
      const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.4 long')], { type: 'application/pdf' }), longName);
      assert.equal((await client('POST', `/api/orders/${taxOrder.id}/documents`, form)).status, 200);
      await until('长名字资料送到内部', () => docsOf(internalTax).some(d => d.name.startsWith('超长文件名超长文件名') && d.uploaded_by.startsWith('客户站：很长的客户名')));
    } finally { cdb.prepare("UPDATE users SET name=? WHERE id='buyer'").run(before); }
  });
  await test('a requirement of another order is refused and the uploaded file is not left behind', async () => {
    cdb.prepare("INSERT INTO doc_requirements (id,order_id,doc_name,doc_desc,required) VALUES ('req-other-order',?,'别的单的需求','',1)").run(order.id);
    const docsDir = path.join(server, 'uploads', 'docs');
    const count = () => fs.existsSync(docsDir) ? fs.readdirSync(docsDir).length : 0;
    const before = count();
    const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.4 x')], { type: 'application/pdf' }), 'x.pdf'); form.append('requirementId', 'req-other-order');
    assert.equal((await client('POST', `/api/orders/${taxOrder.id}/documents`, form)).status, 400);
    const unified = new FormData(); unified.append('files', new Blob([Buffer.from('%PDF-1.4 y')], { type: 'application/pdf' }), 'y.pdf'); unified.append('requirementId', 'req-other-order');
    assert.equal((await client('POST', `/api/orders/${taxOrder.id}/documents/unified`, unified)).status, 400);
    assert.equal((await client('POST', `/api/orders/${taxOrder.id}/documents/text`, { text: 'z', requirementId: 'req-other-order' })).status, 400);
    assert.equal(count(), before, 'rejected uploads removed');
    assert.equal((cdb.prepare("SELECT status FROM doc_requirements WHERE id='req-other-order'").get() as any).status, 'pending');
  });
  await test('internal only marks 客户已交 for a request of the same customer order', async () => {
    const sent = await staffCall(requests.POST, internalOrders[0], 'POST', { name: '另一份补件' });
    assert.equal(sent.status, 201);
    const r = await docsRoute.POST(new NextRequest('http://127.0.0.1/api/sync/documents', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ source_order_no: taxOrder.order_no, customer: { name: 'x' }, items: [{ kind: 'submit', submission_id: 'foreign-sreq-1', name: '文字', requirement: null, requirement_id: `sreq-${sent.body.id}`, type: 'text', text: 'x' }] }) }));
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal((idb.prepare('SELECT submitted_at FROM sync_document_requests WHERE id=?').get(sent.body.id) as any).submitted_at, null);
  });
  await test('an older review arriving late does not override the newer one on the same requirement', async () => {
    cdb.prepare("INSERT INTO doc_requirements (id,order_id,doc_name,doc_desc,required) VALUES ('req-two-files',?,'护照','',1)").run(taxOrder.id);
    const ids: string[] = [];
    for (const name of ['旧护照.pdf', '新护照.pdf']) {
      const form = new FormData(); form.append('file', new Blob([Buffer.from('%PDF-1.4 ' + name)], { type: 'application/pdf' }), name); form.append('requirementId', 'req-two-files');
      const up = await client('POST', `/api/orders/${taxOrder.id}/documents`, form);
      assert.equal(up.status, 200); ids.push(up.body.id);
      await new Promise(r => setTimeout(r, 1100)); // submitted_at 精确到秒
    }
    await until('两份都已送出', () => ids.every(id => (cdb.prepare("SELECT status FROM sync_doc_outbox WHERE submission_id=? AND kind='submit'").get(id) as any)?.status === 'sent'));
    const post = (submission_id: string, status: string) => fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/review`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ submission_id, seq: 50, status, note: status === 'rejected' ? '新护照过期' : '' }) });
    assert.equal((await post(ids[1], 'rejected')).status, 200);
    assert.equal((await post(ids[0], 'approved')).status, 200, 'older one arrives late');
    assert.equal((cdb.prepare("SELECT status FROM doc_requirements WHERE id='req-two-files'").get() as any).status, 'pending', 'newer rejection stands');
    assert.equal((cdb.prepare('SELECT status FROM doc_submissions WHERE id=?').get(ids[0]) as any).status, 'approved', 'the older file itself still shows its own result');
  });
  await test('long certificate details do not break the delivery dates', async () => {
    const r = await fetch(`http://127.0.0.1:${clientPort}/api/sync/documents/delivery`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${SECRET}` },
      body: JSON.stringify({ event: 'delivery', source_order_no: taxOrder.order_no, delivery_id: 'cert-777777', seq: 1, action: 'upsert', kind: 'certificate', name: '长证书', has_file: false,
        meta: { product_name: '很长的产品名'.repeat(500), issue_date: '2026-01-01', expiry_date: '2031-01-01' } }) });
    assert.equal(r.status, 200, await r.clone().text());
    const item = (await client('GET', `/api/orders/${taxOrder.id}/deliveries`)).body.find((d: any) => d.delivery_id === 'cert-777777');
    assert.equal(item?.meta?.issue_date, '2026-01-01'); assert.equal(item?.meta?.expiry_date, '2031-01-01');
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
