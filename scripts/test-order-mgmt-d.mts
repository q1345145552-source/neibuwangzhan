/**
 * 订单管理第四轮（2026-10-16「继续优化订单吧」）内部站部分：手建单不能选「待分类」、「轮到你了」经办人不在岗改发负责人/管理员、
 * 删步骤备注留记录、收入核对为未到账提醒录入人和负责人、客户站交来的资料不能直接删、「文档」页删已交付的文件同时撤回、
 * 补件被退回后列表显示「已退回」、订单详情带客户站单号和客户站账单、费用列表带订单金额。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-ordermgmtd-<新目录>/x.db node --import <tsx loader> scripts/test-order-mgmt-d.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-ordermgmtd-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-ordermgmtd-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'order-mgmt-d-regression-jwt';
process.env.CUSTOMER_SYNC_URL = ''; process.env.SYNC_SECRET = '';
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const ordersRoute = await import('../src/app/api/orders/route');
const orderRoute = await import('../src/app/api/orders/[id]/route');
const stepsRoute = await import('../src/app/api/orders/[id]/steps/route');
const notesRoute = await import('../src/app/api/orders/[id]/steps/[stepId]/notes/route');
const verifyRoute = await import('../src/app/api/orders/[id]/finances/verify/route');
const financesRoute = await import('../src/app/api/finances/route');
const orderDocsRoute = await import('../src/app/api/orders/[id]/documents/route');
const docsRoute = await import('../src/app/api/documents/route');
const supplementRoute = await import('../src/app/api/orders/[id]/supplement-requests/route');
const { markRequestSubmitted } = await import('../src/lib/delivery-sync');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n').slice(0, 3).join(' | ')); }
}
db.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string, ...a: unknown[]) => db.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get(...a) as Emp;
const admin = empOf("role='admin' AND status='在职'"), A = empOf("role='employee' AND status='在职'");
const B = empOf("role='employee' AND status='在职' AND id<>?", A.id);
const tokenOf = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
type Ctx = { params: Promise<Record<string, string>> };
async function call(handler: (req: NextRequest, ctx: Ctx) => Promise<Response>, who: Emp, method: string, url: string, body?: unknown, params: Record<string, string> = {}) {
  const req = new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(who)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve(params) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各接口返回结构不同，断言里按需取字段
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const bt = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
const TM = bt('商标');
let seq = 0;
function order(owner: string, steps: [string, string, string][], extra: { source?: string; total?: number } = {}) {
  const id = `ORD-D${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person, total_amount, currency, source_system) VALUES (?,?,?,'tm-reg','进行中',?,?,'CNY',?)")
    .run(id, `客户D${seq}`, TM, owner, extra.total ?? 1000, extra.source ?? '');
  steps.forEach(([name, status, assignee], i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(id, name, i + 1, status, assignee));
  return id;
}
const stepId = (o: string, name: string) => (db.prepare('SELECT id FROM order_steps WHERE order_id=? AND step_name=?').get(o, name) as { id: number }).id;
const notes = (recipient: string, title: string, o: string) => (db.prepare('SELECT body FROM notifications WHERE recipient=? AND title=? AND related_id=?').all(recipient, title, o) as { body: string }[]).map(r => r.body);
function linkToSource(orderId: string, no: string, billingStatus = 'unpaid') {
  db.prepare(`INSERT OR IGNORE INTO sync_orders(source_order_no,source_customer_id,source,currency,billing_revision,total_cents,discount_cents,net_cents,identity_json,financial_json,payload)
    VALUES (?,?,?,?,1,100000,0,100000,'{}',?,'{}')`).run(no, 'cust-d', 'storefront', 'CNY', JSON.stringify({ totalCents: 100000, discountCents: 0, depositCents: 0, billingStatus }));
  db.prepare(`INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,allocated_cents,allocated_amount,billing_revision)
    VALUES (?,?,1,1,'TM-001',?,'','{}',100000,1000,1)`).run(`inbox-${orderId}`, no, orderId);
}

await check('手建订单不能选「待分类」（只给客户站、商城转来的单用）', async () => {
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status) VALUES ('手建客户', '潜在')").run();
  const r = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '手建客户', business_type_id: bt('待分类') });
  assert.equal(r.status, 400); assert.match(r.json.error, /待分类/);
  assert.equal((await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '手建客户', business_type_id: TM, sub_service_type: 'tm-reg' })).status, 201);
});

await check('「轮到你了」：下一步经办人已离职 → 发负责人；负责人也没有 → 发管理员写明要派人；经办人是本人在岗就不发', async () => {
  db.prepare("INSERT INTO employees (name, email, role, password, status, must_change_password) VALUES ('走了的经办人', 'gone-d@example.invalid', 'employee', 'x', '离职', 0)").run();
  const o1 = order(B.name, [['方案确认', '进行中', ''], ['提交申请', '待处理', '走了的经办人'], ['拿证', '待处理', A.name]]);
  assert.equal((await call(stepsRoute.PATCH as never, admin, 'PATCH', `/api/orders/${o1}/steps`, { step_id: stepId(o1, '方案确认'), status: '已完成' }, { id: o1 })).status, 200);
  const got = notes(B.name, '轮到你了', o1);
  assert.equal(got.length, 1); assert.match(got[0], /走了的经办人/); assert.match(got[0], /负责人/);
  const o2 = order('', [['方案确认', '进行中', ''], ['提交申请', '待处理', 'Next'], ['拿证', '待处理', A.name]]);
  assert.equal((await call(stepsRoute.PATCH as never, A, 'PATCH', `/api/orders/${o2}/steps`, { step_id: stepId(o2, '方案确认'), status: '已完成' }, { id: o2 })).status, 200);
  const boss = notes(admin.name, '轮到你了', o2);
  assert.equal(boss.length, 1); assert.match(boss[0], /没人接手/);
  const o3 = order(B.name, [['方案确认', '进行中', ''], ['提交申请', '待处理', A.name], ['拿证', '待处理', A.name]]);
  assert.equal((await call(stepsRoute.PATCH as never, A, 'PATCH', `/api/orders/${o3}/steps`, { step_id: stepId(o3, '方案确认'), status: '已完成' }, { id: o3 })).status, 200);
  assert.deepEqual([notes(A.name, '轮到你了', o3).length, notes(B.name, '轮到你了', o3).length, notes(admin.name, '轮到你了', o3).length], [0, 0, 0], '本人点完、下一步就是本人：不提醒任何人');
});

await check('删步骤备注留操作记录（谁删的、原来写的什么）', async () => {
  const o = order(A.name, [['方案确认', '进行中', ''], ['提交申请', '待处理', A.name]]);
  const s = stepId(o, '提交申请');
  const n = db.prepare("INSERT INTO step_notes (step_id, order_id, content, created_by) VALUES (?, ?, '卡住原因：等客户', ?)").run(s, o, A.name).lastInsertRowid;
  const r = await call(notesRoute.DELETE as never, A, 'DELETE', `/api/orders/${o}/steps/${s}/notes`, { note_id: Number(n) }, { id: o, stepId: String(s) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const log = db.prepare("SELECT actor, detail FROM audit_logs WHERE action='删除订单步骤备注' AND target_id=?").get(String(n)) as { actor: string; detail: string } | undefined;
  assert.ok(log, '有记录'); assert.equal(log!.actor, A.name); assert.match(log!.detail, /卡住原因：等客户/);
});

await check('收入核对为「未到账」：提醒录入人和负责人（同一人只一条），点「已到账」不提醒', async () => {
  const o = order(B.name, [['方案确认', '进行中', '']]);
  const f = Number(db.prepare("INSERT INTO finances (order_id, type, amount, status, currency, created_by) VALUES (?, 'income', 600, '待核对', 'CNY', ?)").run(o, A.name).lastInsertRowid);
  const bad = await call(verifyRoute.POST as never, admin, 'POST', `/api/orders/${o}/finances/verify`, { finance_id: f, action: 'not_arrived', note: '银行没看到这笔' }, { id: o });
  assert.equal(bad.status, 200, JSON.stringify(bad.json));
  for (const who of [A.name, B.name]) { const got = notes(who, '收入未到账', o); assert.equal(got.length, 1, who); assert.match(got[0], /银行没看到这笔/); }
  assert.equal(notes(admin.name, '收入未到账', o).length, 0, '不提醒点的人');
  const f2 = Number(db.prepare("INSERT INTO finances (order_id, type, amount, status, currency, created_by) VALUES (?, 'income', 400, '待核对', 'CNY', ?)").run(o, B.name).lastInsertRowid);
  assert.equal((await call(verifyRoute.POST as never, admin, 'POST', `/api/orders/${o}/finances/verify`, { finance_id: f2, action: 'arrived' }, { id: o })).status, 200);
  assert.equal(notes(B.name, '收入未到账', o).length, 1, '到账不另发');
});

await check('客户站交来的资料：订单页、「文档」页都不能直接删（要退回）；客户撤回了的、员工自己加的照常能删', async () => {
  const o = order(A.name, [['方案确认', '进行中', '']], { source: 'storefront' });
  linkToSource(o, 'XT-D-DOC');
  const doc = Number(db.prepare("INSERT INTO documents (order_id, name, status, direction, uploaded_by) VALUES (?, '护照', '待审核', 'client_to_us', '客户站：客户')").run(o).lastInsertRowid);
  db.prepare("INSERT INTO sync_documents (source_order_no, submission_id, internal_order_id, document_id) VALUES ('XT-D-DOC', 'sub-1', ?, ?)").run(o, doc);
  const viaOrder = await call(orderDocsRoute.DELETE as never, A, 'DELETE', `/api/orders/${o}/documents`, { document_id: doc }, { id: o });
  assert.equal(viaOrder.status, 409); assert.match(viaOrder.json.error, /退回/);
  const viaDocs = await call(docsRoute.DELETE as never, A, 'DELETE', `/api/documents?id=${doc}`);
  assert.equal(viaDocs.status, 409);
  // 页面拿到标记就不显示删除按钮；已经退回过的，提示不再叫员工去点「退回」
  const listed = (await call(orderDocsRoute.GET as never, A, 'GET', `/api/orders/${o}/documents`, undefined, { id: o })).json as { id: number; live_submission: number }[];
  assert.equal(listed.find(d => d.id === doc)!.live_submission, 1);
  assert.equal(((await call(docsRoute.GET as never, A, 'GET', '/api/documents')).json as { id: number; live_submission: number }[]).find(d => d.id === doc)!.live_submission, 1);
  db.prepare("UPDATE documents SET status='已退回' WHERE id=?").run(doc);
  const returned = await call(orderDocsRoute.DELETE as never, A, 'DELETE', `/api/orders/${o}/documents`, { document_id: doc }, { id: o });
  assert.equal(returned.status, 409); assert.match(returned.json.error, /已经退回给客户/);
  assert.ok(db.prepare('SELECT 1 FROM documents WHERE id=?').get(doc), '还在');
  db.prepare("UPDATE sync_documents SET withdrawn=1 WHERE document_id=?").run(doc);
  assert.equal((await call(docsRoute.DELETE as never, A, 'DELETE', `/api/documents?id=${doc}`)).status, 200, '客户撤回了的能删');
  const own = Number(db.prepare("INSERT INTO documents (order_id, name, status, direction, uploaded_by) VALUES (?, '内部记录', '待审核', 'client_to_us', ?)").run(o, A.name).lastInsertRowid);
  assert.equal((await call(orderDocsRoute.DELETE as never, A, 'DELETE', `/api/orders/${o}/documents`, { document_id: own }, { id: o })).status, 200);
});

await check('「文档」页删掉已交付给客户的文件：客户站那边同时撤回', async () => {
  const o = order(A.name, [['方案确认', '进行中', '']], { source: 'storefront' });
  linkToSource(o, 'XT-D-DLV');
  const doc = Number(db.prepare("INSERT INTO documents (order_id, name, status, direction, uploaded_by, file_url, publication_verified) VALUES (?, '商标证书', '已审核', 'us_to_client', ?, '/api/files/x.pdf', 1)").run(o, A.name).lastInsertRowid);
  const before = (db.prepare("SELECT COUNT(*) AS n FROM sync_document_outbox WHERE submission_id=?").get(`doc-${doc}`) as { n: number }).n;
  assert.equal((await call(docsRoute.DELETE as never, A, 'DELETE', `/api/documents?id=${doc}`)).status, 200);
  const rows = db.prepare("SELECT payload FROM sync_document_outbox WHERE submission_id=? ORDER BY rowid").all(`doc-${doc}`) as { payload: string }[];
  assert.equal(rows.length, before + 1);
  assert.equal(JSON.parse(rows[rows.length - 1].payload).action, 'withdraw');
  assert.equal((await call(docsRoute.DELETE as never, A, 'DELETE', `/api/documents?id=999999`)).status, 404);
});

await check('补件被退回后，补件列表显示「已退回」；客户重交后时间是最近一次', async () => {
  const o = order(A.name, [['方案确认', '进行中', '']], { source: 'storefront' });
  linkToSource(o, 'XT-D-REQ');
  db.prepare("INSERT INTO sync_document_requests (id, source_order_no, internal_order_id, name) VALUES ('rq1', 'XT-D-REQ', ?, '租房合同')").run(o);
  db.prepare("UPDATE sync_document_requests SET submitted_at='2026-10-01 00:00:00' WHERE id='rq1'").run();
  const doc = Number(db.prepare("INSERT INTO documents (order_id, name, status, direction, uploaded_by) VALUES (?, '租房合同', '已退回', 'client_to_us', '客户站：客户')").run(o).lastInsertRowid);
  db.prepare("INSERT INTO sync_documents (source_order_no, submission_id, internal_order_id, document_id, requirement_id) VALUES ('XT-D-REQ', 'sub-rq1', ?, ?, 'sreq-rq1')").run(o, doc);
  const list = (await call(supplementRoute.GET as never, A, 'GET', `/api/orders/${o}/supplement-requests`, undefined, { id: o })).json as { id: string; latest_status: string | null; submitted_at: string }[];
  assert.equal(list.find(r => r.id === 'rq1')!.latest_status, '已退回');
  markRequestSubmitted(db, 'sreq-rq1', 'XT-D-REQ');
  const again = db.prepare("SELECT submitted_at FROM sync_document_requests WHERE id='rq1'").get() as { submitted_at: string };
  assert.notEqual(again.submitted_at, '2026-10-01 00:00:00', '重交记最近一次的时间');
});

await check('订单详情带客户站单号和客户站账单付没付；费用列表带订单金额', async () => {
  const o = order(A.name, [['方案确认', '进行中', '']], { source: 'storefront', total: 2150 });
  linkToSource(o, 'XT-D-PAID', 'paid');
  const d = await call(orderRoute.GET as never, A, 'GET', `/api/orders/${o}`, undefined, { id: o });
  assert.equal(d.status, 200);
  assert.deepEqual([d.json.source_order_no, d.json.client_billing], ['XT-D-PAID', 'paid']);
  const own = order(A.name, [['方案确认', '进行中', '']]);
  const d2 = await call(orderRoute.GET as never, A, 'GET', `/api/orders/${own}`, undefined, { id: own });
  assert.deepEqual([d2.json.source_order_no, d2.json.client_billing], ['', null]);
  db.prepare("INSERT INTO finances (order_id, type, amount, status, currency, created_by) VALUES (?, 'income', 100, '待核对', 'CNY', ?)").run(o, A.name);
  const fins = (await call(financesRoute.GET as never, admin, 'GET', '/api/finances')).json as { order_id: string; order_total: number; order_currency: string }[];
  const row = fins.find(f => f.order_id === o)!;
  assert.deepEqual([row.order_total, row.order_currency], [2150, 'CNY']);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
