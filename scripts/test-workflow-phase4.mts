/**
 * 流程设置第 4 期 + 订单客户从客户管理里选（2026-10-16 老板选 1A、2A）。
 * - 流程能改步骤名、增删、调顺序，每步填「客户看到的名字」；第一步「方案确认」和「待分类」那套结构锁住。
 * - 老单（包括客户看到的名字）一点不变，不给客户发进度通知；新单、商城、客户站同步单、待分类改派按新流程和新名字。
 * - 员工建单/改单的客户要在客户管理里；没有的当场新建眼下只给管理员，建出来算「已合作」、没人认领。
 * 临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-wfphase4-<新目录>/x.db node --import <tsx loader> scripts/test-workflow-phase4.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-wfphase4-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-wfphase4-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'wf-phase4-regression-jwt';
delete process.env.CUSTOMER_SYNC_URL;
process.env.SYNC_SECRET = 'local-regression-secret';
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };

const { getDb, getOrderStepsWithDocs, getLegacyOrderStepsWithDocs, templateSignature } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const { publicStepNames, commerceWorkflow } = await import('../src/lib/commerce-fulfillment');
const { publicSteps } = await import('../src/lib/client-view');
const { queueProgressEventsForOrder } = await import('../src/lib/progress-sync');
const { buildWorkflowCatalog } = await import('../src/lib/workflow-catalog');
const importRoute = await import('../src/app/api/workflows/import/route');
const publishRoute = await import('../src/app/api/workflows/[id]/publish/route');
const rollbackRoute = await import('../src/app/api/workflows/[id]/rollback/route');
const ordersRoute = await import('../src/app/api/orders/route');
const orderRoute = await import('../src/app/api/orders/[id]/route');
// 2026-10-19 起客户站来的单要先点「确认订单」才能改派、办理
const confirmRoute = await import('../src/app/api/orders/[id]/confirm/route');
const syncRoute = await import('../src/app/api/sync/orders/route');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n').slice(0, 3).join(' | ')); }
}
db.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string, ...a: unknown[]) => db.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get(...a) as Emp;
const admin = empOf("role='admin' AND status='在职'"), A = empOf("role='employee' AND status='在职'");
const tokenOf = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
async function call(handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, who: Emp, method: string, url: string, body?: unknown, id = '') {
  const req = new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(who)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve({ id }) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各接口返回结构不同，断言里按需取字段
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
async function sync(no: string, sku: string) {
  const body = { source: 'storefront', source_order_no: no, billing_revision: 1, ordered_at: '2026-10-16T00:00:00.000Z', currency: 'CNY', total_amount: 100, discount: 0,
    customer: { id: 'buyer-phase4', name: 'PHASE4_BUYER', email: 'phase4@example.invalid' }, lines: [{ line_no: 1, sku_code: sku, sku_name: `Synthetic ${sku}`, quantity: 1, amount: 100 }] };
  const r = await syncRoute.POST(new NextRequest('http://fixture.invalid/api/sync/orders', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer local-regression-secret' }, body: JSON.stringify(body) }));
  const json = await r.json(); assert.equal(r.status, 200, JSON.stringify(json));
  return json.results[0].order_id as string;
}
const bt = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
const TM = bt('商标');
const templateIdOf = (btId: number, sub = '', addr = '') =>
  (db.prepare('SELECT id FROM workflow_templates WHERE legacy_signature=?').get(templateSignature(getLegacyOrderStepsWithDocs(btId, sub || undefined, addr || undefined))) as { id: number }).id;
const currentVersion = (templateId: number) => (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
const versionSteps = (vid: number) => db.prepare('SELECT step_order, name, public_name, assignee, notes, docs_json, expected_days FROM workflow_template_steps WHERE version_id=? ORDER BY step_order').all(vid) as
  { step_order: number; name: string; public_name: string | null; assignee: string; notes: string; docs_json: string; expected_days: number | null }[];
const stepsOf = (orderId: string) => db.prepare('SELECT step_order, step_name, public_name, status FROM order_steps WHERE order_id=? ORDER BY step_order').all(orderId) as { step_order: number; step_name: string; public_name: string | null; status: string }[];
const latestPublished = (orderId: string) => {
  const row = db.prepare('SELECT p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1').get(orderId) as { payload: string };
  return (JSON.parse(row.payload).steps as { step_name: string }[]).map(s => s.step_name);
};
const publishedCount = (orderId: string) => (db.prepare('SELECT COUNT(*) AS n FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id WHERE i.internal_order_id=?').get(orderId) as { n: number }).n;
// 页面提交的整套步骤（from = 原来第几步）
type Row = { from: number | null; name: string; public_name: string; assignee: string; notes: string; docs: string[]; expected_days: number | null };
const rowsOf = (templateId: number): Row[] => versionSteps(currentVersion(templateId)).map(s => ({ from: s.step_order, name: s.name, public_name: s.public_name || '', assignee: s.assignee, notes: s.notes, docs: JSON.parse(s.docs_json), expected_days: s.expected_days }));
const publish = (templateId: number, steps: unknown[], who = admin) => call(publishRoute.POST as never, who, 'POST', `/api/workflows/${templateId}/publish`, { steps, base_version_id: currentVersion(templateId) }, String(templateId));

// ---------- 改流程之前：老单 ----------
const families = ['company', 'trademark', 'unclassified', 'social-security', 'trademark-international', 'dld-product', 'nbtc', 'company-change', 'address-cert', 'mall-enterprise', 'trademark-buy-r', 'trademark-th-plus', 'tisi'] as const;
const mallBefore = new Map<string, string[]>();
for (const f of families) mallBefore.set(f, [...commerceWorkflow(db, { quantity_basis: f } as never).publicNames]);
for (const [basis, key, values] of [['mall-store', 'platform', ['shopee', 'lazada', 'tiktok']], ['fda-product', 'category', ['cosmetics', 'food', 'hazard', 'medical']]] as const)
  for (const v of values) mallBefore.set(`${basis}:${v}`, [...commerceWorkflow(db, { quantity_basis: basis, [key]: v } as never).publicNames]);
const oldSynced = await sync('P4-OLD-1', 'TRA-001');
const oldSyncedNames = latestPublished(oldSynced);
const oldStaff = await (async () => {
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status) VALUES ('老客户甲', '已合作')").run();
  const r = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '老客户甲', business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.id as string;
})();
const oldStaffPublic = publicSteps(db.prepare('SELECT * FROM order_steps WHERE order_id=? ORDER BY step_order').all(oldStaff)).map(s => s.step_name);

await check('导入：每一步都记下客户看到的名字，跟导入前客户看到的一模一样；商城每一类服务客户看到的名字也不变', async () => {
  assert.equal((await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', {})).status, 200);
  const rows = db.prepare('SELECT v.id FROM workflow_template_versions v').all() as { id: number }[];
  for (const { id } of rows) {
    const steps = versionSteps(id);
    assert.ok(steps.every(s => (s.public_name || '').trim()), `版本 ${id} 有步骤没记客户名`);
    assert.deepEqual(steps.map(s => s.public_name), publicStepNames(steps.map(s => s.name)));
  }
  for (const f of families) assert.deepEqual(commerceWorkflow(db, { quantity_basis: f } as never).publicNames, mallBefore.get(f), f);
  for (const v of ['shopee', 'lazada', 'tiktok']) assert.deepEqual(commerceWorkflow(db, { quantity_basis: 'mall-store', platform: v } as never).publicNames, mallBefore.get(`mall-store:${v}`), v);
  for (const v of ['cosmetics', 'food', 'hazard', 'medical']) assert.deepEqual(commerceWorkflow(db, { quantity_basis: 'fda-product', category: v } as never).publicNames, mallBefore.get(`fda-product:${v}`), v);
});

const tmId = templateIdOf(TM, 'tm-reg');
const tmV1 = currentVersion(tmId);
const tmBefore = rowsOf(tmId);
await check('发布的规矩：客户名必填；第一步「方案确认」不能改名、挪、删；新步骤经办人只能是在岗员工；步骤对不上、没改动、别人刚改过都拦下', async () => {
  const add = { from: null, name: '新加的一步', public_name: '', assignee: '', notes: '', docs: [], expected_days: null };
  const noPub = await publish(tmId, [...tmBefore.slice(0, 2), add, ...tmBefore.slice(2)]);
  assert.equal(noPub.status, 400); assert.match(noPub.json.error, /客户看到的名字/);
  const renameFirst = await publish(tmId, [{ ...tmBefore[0], name: '先谈方案' }, ...tmBefore.slice(1)]);
  assert.equal(renameFirst.status, 400); assert.match(renameFirst.json.error, /第一步/);
  const moveFirst = await publish(tmId, [tmBefore[1], tmBefore[0], ...tmBefore.slice(2)]);
  assert.equal(moveFirst.status, 400);
  assert.equal((await publish(tmId, tmBefore.slice(1))).status, 400, '删掉第一步不行');
  const outsider = await publish(tmId, [...tmBefore, { ...add, public_name: '新事项', assignee: '外面的人' }]);
  assert.equal(outsider.status, 400); assert.match(outsider.json.error, /在岗员工/);
  assert.equal((await publish(tmId, [...tmBefore, { ...tmBefore[1] }])).status, 400, '同一步用两次');
  assert.equal((await publish(tmId, tmBefore)).status, 400, '没改动');
  const stale = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${tmId}/publish`, { steps: tmBefore.map(s => ({ ...s, notes: 'x' })), base_version_id: tmV1 - 1 }, String(tmId));
  assert.equal(stale.status, 409);
  assert.equal((await publish(tmId, tmBefore.map(s => ({ ...s, notes: 'x' })), A)).status, 403, '员工不能改流程');
  assert.equal(currentVersion(tmId), tmV1, '都没发布出去');
});

let renamed: Row[] = [];
await check('改名、加一步、删一步、调顺序：发布成新版本，新建的单按新流程，客户看到填的名字', async () => {
  const [first, second, third, ...rest] = tmBefore;
  renamed = [first, { ...third, name: `${third.name}（改过）`, public_name: '核对申请资料' },
    { from: null, name: '跟客户确认商标图样', public_name: '确认商标图样', assignee: A.name, notes: '新加的', docs: ['商标图样'], expected_days: 2 },
    second, ...rest.slice(0, -1)];
  const r = await publish(tmId, renamed);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const now = getOrderStepsWithDocs(TM, 'tm-reg');
  assert.deepEqual(now.map(s => s.name), renamed.map(s => s.name));
  assert.deepEqual(now.map(s => s.public_name), renamed.map(s => s.public_name));
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status) VALUES ('新客户乙', '已合作')").run();
  const o = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '新客户乙', business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const steps = stepsOf(o.json.id);
  assert.deepEqual(steps.map(s => s.step_name), renamed.map(s => s.name));
  assert.deepEqual(steps.map(s => s.public_name), renamed.map(s => s.public_name));
  assert.deepEqual(publicSteps(db.prepare('SELECT * FROM order_steps WHERE order_id=? ORDER BY step_order').all(o.json.id)).map(s => s.step_name), renamed.map(s => s.public_name));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM step_documents d JOIN order_steps s ON s.id=d.step_id WHERE d.order_id=? AND s.step_name='跟客户确认商标图样' AND d.document_name='商标图样'").get(o.json.id) as { n: number }).n, 1);
});

await check('老单一点不变：步骤名、客户看到的名字都不变，也不会给客户发新的进度通知', () => {
  const before = publishedCount(oldSynced);
  assert.equal(queueProgressEventsForOrder(oldSynced, db), 0);
  assert.equal(publishedCount(oldSynced), before);
  assert.deepEqual(latestPublished(oldSynced), oldSyncedNames);
  assert.deepEqual(publicSteps(db.prepare('SELECT * FROM order_steps WHERE order_id=? ORDER BY step_order').all(oldStaff)).map(s => s.step_name), oldStaffPublic);
  assert.deepEqual(stepsOf(oldStaff).map(s => s.step_name), getLegacyOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name));
});

await check('客户站同步来的新单：按新流程建，回传给客户站的是填的名字', async () => {
  const o = await sync('P4-NEW-1', 'TRA-001');
  const flow = getOrderStepsWithDocs(TM, '');
  assert.deepEqual(stepsOf(o).map(s => s.step_name), flow.map(s => s.name));
  const pub = publicStepNames(flow.map(x => x.name));
  assert.deepEqual(latestPublished(o), flow.map((s, i) => s.public_name || pub[i]));
});

await check('商城：流程改了名照常接单，按新流程、客户看到填的名字', () => {
  const w = commerceWorkflow(db, { quantity_basis: 'trademark' } as never);
  assert.deepEqual(w.steps.map(s => s.name), renamed.map(s => s.name));
  assert.deepEqual([...w.publicNames], renamed.map(s => s.public_name));
  // 系统里的名字缺了（半截数据）又改过名：照旧用程序里的、核对指纹（这里程序里的原样流程指纹对得上，所以照样能接）
  const v = currentVersion(tmId);
  db.prepare('UPDATE workflow_template_steps SET public_name=NULL WHERE version_id=? AND step_order=2').run(v);
  try {
    const legacy = commerceWorkflow(db, { quantity_basis: 'trademark' } as never);
    assert.deepEqual([...legacy.publicNames], mallBefore.get('trademark'));
    assert.deepEqual(legacy.steps.map(s => s.name), getLegacyOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name));
  } finally {
    db.prepare('UPDATE workflow_template_steps SET public_name=? WHERE version_id=? AND step_order=2').run(renamed[1].public_name, v);
  }
});

await check('只改客户看到的名字（员工步骤名不动）：新单、商城都用新名字', async () => {
  const cur = rowsOf(tmId);
  const r = await publish(tmId, cur.map((s, i) => i === 3 ? { ...s, public_name: '查重核对' } : s));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(commerceWorkflow(db, { quantity_basis: 'trademark' } as never).publicNames[3], '查重核对');
  assert.equal(getOrderStepsWithDocs(TM, 'tm-reg')[3].public_name, '查重核对');
});

await check('待分类：结构锁住（不能改名、加减、调顺序），经办人、天数照样能改；改派到改过名的流程，接上的步骤带新名字', async () => {
  const unId = templateIdOf(bt('待分类'), 'storefront-unclassified');
  const cur = rowsOf(unId);
  assert.equal((await publish(unId, [...cur.slice(0, 2), { ...cur[2], name: '办理交付' }])).status, 400);
  assert.equal((await publish(unId, [...cur, { from: null, name: '多一步', public_name: '多一步', assignee: '', notes: '', docs: [], expected_days: null }])).status, 400);
  assert.equal((await publish(unId, cur.map((s, i) => i === 1 ? { ...s, expected_days: 1 } : s))).status, 200);
  const o = await sync('P4-UNC-1', 'ZZZ-999');
  assert.equal((await call(confirmRoute.POST as never, admin, 'POST', `/api/orders/${o}/confirm`, undefined, o)).status, 200);
  const claimed = stepsOf(o).slice(0, 2);
  const ok = await call(orderRoute.PATCH as never, admin, 'PATCH', `/api/orders/${o}`, { business_type_id: TM, sub_service_type: 'tm-reg', address_type: 'client', description: 'x' }, o);
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const tm = getOrderStepsWithDocs(TM, 'tm-reg');
  assert.deepEqual(stepsOf(o).map(s => s.step_name), [...claimed.map(s => s.step_name), ...tm.slice(1).map(s => s.name)]);
  assert.ok(claimed.every(s => s.public_name), '待分类两步建单时也记下了客户名');
  assert.deepEqual(latestPublished(o), [...claimed.map(s => s.public_name), ...tm.slice(1).map(s => s.public_name)]);
});

await check('流程清单：显示改过的名字、客户看到的名字是在这里填的；待分类标结构锁住', () => {
  const entries = buildWorkflowCatalog(db);
  const tmEntry = entries.find(e => e.templateId === tmId)!;
  assert.deepEqual(tmEntry.steps.map(s => s.name), getOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name));
  assert.equal(tmEntry.customPublicNames, true);
  assert.equal(tmEntry.reviewed, false);
  assert.equal(entries.find(e => e.business === '待分类')!.structureLocked, true);
  const untouched = entries.find(e => e.business === '社保开户')!;
  assert.equal(untouched.customPublicNames, false);
});

await check('老写法（只带 step_order、不带名字）照样能改经办人/天数', async () => {
  const soc = templateIdOf(bt('社保开户'));
  const cur = rowsOf(soc);
  const r = await publish(soc, cur.map((s, i) => ({ step_order: s.from, assignee: s.assignee, notes: s.notes, docs: s.docs, expected_days: i === 1 ? 3 : s.expected_days })));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(versionSteps(currentVersion(soc)).map(s => s.name), cur.map(s => s.name));
  assert.equal(versionSteps(currentVersion(soc))[1].expected_days, 3);
});

await check('退回到第 1 版：建单回到程序里的原样（步骤名、客户看到的名字）', async () => {
  const r = await call(rollbackRoute.POST as never, admin, 'POST', `/api/workflows/${tmId}/rollback`, { version_id: tmV1, base_version_id: currentVersion(tmId) }, String(tmId));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(getOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name), getLegacyOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name));
  assert.deepEqual([...commerceWorkflow(db, { quantity_basis: 'trademark' } as never).publicNames], mallBefore.get('trademark'));
});

// ---------- 2A：客户从客户管理里选 ----------
await check('建单：客户管理里没有的不收；员工当场新建不行（客户管理原来的规矩：只有管理员能建客户）；管理员当场新建跟订单一起存，跟客户管理里新建的一样', async () => {
  const body = { business_type_id: TM, sub_service_type: 'tm-reg' };
  const unknown = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { ...body, customer_name: '没建档的公司' });
  assert.equal(unknown.status, 400); assert.match(unknown.json.error, /客户管理里没有/);
  const staffNew = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { ...body, customer_name: '没建档的公司', new_customer: true });
  assert.equal(staffNew.status, 403); assert.match(staffNew.json.error, /管理员/);
  // 订单本身不合格（缺子类型）时，客户也不会先建出来
  assert.equal((await call(ordersRoute.POST as never, admin, 'POST', '/api/orders', { business_type_id: TM, customer_name: '没建档的公司', new_customer: true })).status, 400);
  assert.equal(db.prepare("SELECT 1 FROM customers WHERE company_name='没建档的公司'").get(), undefined);
  const ok = await call(ordersRoute.POST as never, admin, 'POST', '/api/orders', { ...body, customer_name: '  没建档的公司  ', new_customer: true });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.customer_name, '没建档的公司');
  const c = db.prepare("SELECT status, claimed_by, source_channel FROM customers WHERE company_name='没建档的公司'").get() as { status: string; claimed_by: string; source_channel: string };
  assert.deepEqual([c.status, c.claimed_by, c.source_channel], ['潜在', '', ''], '跟客户管理里新建的客户一样');
  // 再建一张同一客户的单：员工直接选（已在客户管理里）
  const again = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { ...body, customer_name: '没建档的公司' });
  assert.equal(again.status, 201, JSON.stringify(again.json));
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM customers WHERE company_name='没建档的公司'").get() as { n: number }).n, 1);
});

await check('改单：员工建的单改成客户管理里没有的客户不收；没改客户名（老单名字不在客户管理里）照常存；客户站来的单不查', async () => {
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, source_system) VALUES ('ORD-P4-LEGACY', '手打的老名字', ?, 'tm-reg', '进行中', '')").run(TM);
  const keep = await call(orderRoute.PATCH as never, A, 'PATCH', '/api/orders/ORD-P4-LEGACY', { customer_name: '手打的老名字', description: '改备注' }, 'ORD-P4-LEGACY');
  assert.equal(keep.status, 200, JSON.stringify(keep.json));
  const bad = await call(orderRoute.PATCH as never, A, 'PATCH', '/api/orders/ORD-P4-LEGACY', { customer_name: '又一个手打的' }, 'ORD-P4-LEGACY');
  assert.equal(bad.status, 400);
  const good = await call(orderRoute.PATCH as never, A, 'PATCH', '/api/orders/ORD-P4-LEGACY', { customer_name: '新客户乙' }, 'ORD-P4-LEGACY');
  assert.equal(good.status, 200, JSON.stringify(good.json)); assert.equal(good.json.customer_name, '新客户乙');
  const created = await call(orderRoute.PATCH as never, admin, 'PATCH', '/api/orders/ORD-P4-LEGACY', { customer_name: '改单时新建的公司', new_customer: true }, 'ORD-P4-LEGACY');
  assert.equal(created.status, 200, JSON.stringify(created.json));
  assert.equal((db.prepare("SELECT status FROM customers WHERE company_name='改单时新建的公司'").get() as { status: string }).status, '潜在');
  const synced = await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${oldSynced}`, { customer_name: '客户站账号改的名' }, oldSynced);
  assert.equal(synced.status, 200, JSON.stringify(synced.json));
});

await check('员工在客户管理里看不到同事认领的客户（原来的规矩不变）：新建订单打全名能核对到（订单这边的接口，只说有没有），建单照常', async () => {
  const customersRoute = await import('../src/app/api/customers/route');
  const checkRoute = await import('../src/app/api/orders/customer-check/route');
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status, claimed_by, handler_wechat) VALUES ('同事认领的公司', '跟进中', '别的销售', 'wx-secret')").run();
  const list = (await call(customersRoute.GET as never, A, 'GET', '/api/customers')).json as { company_name: string }[];
  assert.ok(!list.some(c => c.company_name === '同事认领的公司'), '员工的客户名单里本来就没有');
  const ex = await call(checkRoute.GET as never, A, 'GET', `/api/orders/customer-check?name=${encodeURIComponent(' 同事认领的公司 ')}`);
  assert.deepEqual(ex.json, { exists: true });
  assert.deepEqual((await call(checkRoute.GET as never, A, 'GET', `/api/orders/customer-check?name=${encodeURIComponent('没有的公司')}`)).json, { exists: false });
  const r = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '同事认领的公司', business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(r.status, 201, JSON.stringify(r.json));
});

await check('复核修正：同一套流程中间改过两次名，按中间那版建的单照样能换成共用这套流程的另一种服务', async () => {
  const CO = bt('公司注册');
  const coId = templateIdOf(CO, 'company-reg');
  const rows = rowsOf(coId);
  assert.equal((await publish(coId, rows.map((s, i) => i === 2 ? { ...s, name: `${s.name}（第二版）`, public_name: '第二版名字' } : s))).status, 200);
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status) VALUES ('公司注册客户', '已合作')").run();
  const o = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '公司注册客户', business_type_id: CO, sub_service_type: 'company-reg' });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  assert.equal((await publish(coId, rowsOf(coId).map((s, i) => i === 2 ? { ...s, name: `${s.name}（第三版）` } : s))).status, 200);
  const sameTpl = templateIdOf(CO, 'bank') === coId;
  const r = await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${o.json.id}`, { business_type_id: CO, sub_service_type: 'bank', address_type: 'client' }, o.json.id);
  assert.equal(r.status, sameTpl ? 200 : 409, JSON.stringify(r.json));
  assert.ok(sameTpl, '公司注册几种服务共用一套流程');
});

await check('复核修正：改单时客户名只多打了空格，库里还是原名；客户管理里只差大小写的不让当场新建；名字带空格的客户也选得上', async () => {
  db.prepare("INSERT OR IGNORE INTO customers (company_name, status) VALUES ('ABC Trading', '已合作'), ('带空格公司 ', '跟进中')").run();
  const o = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: 'ABC Trading', business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(o.status, 201, JSON.stringify(o.json));
  const e = await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${o.json.id}`, { customer_name: 'ABC Trading  ', description: 'x' }, o.json.id);
  assert.equal(e.status, 200, JSON.stringify(e.json)); assert.equal(e.json.customer_name, 'ABC Trading');
  const dup = await call(ordersRoute.POST as never, admin, 'POST', '/api/orders', { customer_name: 'abc trading', new_customer: true, business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(dup.status, 409); assert.match(dup.json.error, /ABC Trading/);
  const sp = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '带空格公司', business_type_id: TM, sub_service_type: 'tm-reg' });
  assert.equal(sp.status, 201, JSON.stringify(sp.json)); assert.equal(sp.json.customer_name, '带空格公司 ');
});

await check('复核修正：发布时名字传 null 当没带（沿用原来的），传数字之类的退回', async () => {
  const soc = templateIdOf(bt('社保开户'));
  const cur = rowsOf(soc);
  const r = await publish(soc, cur.map((s, i) => i === 1 ? { ...s, name: null, public_name: null, notes: 'null 测试' } : s));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const v = versionSteps(currentVersion(soc));
  assert.equal(v[1].name, cur[1].name); assert.equal(v[1].public_name, cur[1].public_name);
  assert.equal((await publish(soc, rowsOf(soc).map((s, i) => i === 1 ? { ...s, public_name: 123, notes: 'x2' } : s))).status, 400);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
