/**
 * 订单管理优化 A（2026-10-15）：收入只走老板核对、「我的环节」负责人兜底、待分类角标、子类型必选、
 * 建单后不能改业务线、商城/回传失败提醒进消息中心、回传连续失败提醒管理员。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-ordermgmt-<新目录>/x.db node --import <tsx loader> scripts/test-order-mgmt-a.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-ordermgmt-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-ordermgmt-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'order-mgmt-a-regression-jwt';
const { getDb, getOrderStepsWithDocs } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const financesRoute = await import('../src/app/api/orders/[id]/finances/route');
const verifyRoute = await import('../src/app/api/orders/[id]/finances/verify/route');
const assignedRoute = await import('../src/app/api/steps/assigned/route');
const statsRoute = await import('../src/app/api/dashboard/stats/route');
const unclassifiedRoute = await import('../src/app/api/orders/unclassified-count/route');
const ordersRoute = await import('../src/app/api/orders/route');
const orderRoute = await import('../src/app/api/orders/[id]/route');
const notificationsRoute = await import('../src/app/api/notifications/route');
const alerts = await import('../src/lib/order-alerts');
const { buildHandlingReport } = await import('../src/lib/handling-report');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n')[0]); }
}

db.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (role: string) => db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role=? AND status='在职' ORDER BY id LIMIT 1").get(role) as Emp;
const admin = empOf('admin'), staff = empOf('employee');
const staff2 = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='employee' AND status='在职' AND id<>? ORDER BY id LIMIT 1").get(staff.id) as Emp;
const tokenOf = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
async function call(handler: (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, who: Emp, method: string, url: string, body?: unknown, id = '') {
  const req = new NextRequest(`http://127.0.0.1${url}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${await tokenOf(who)}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await handler(req, { params: Promise.resolve({ id }) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 各接口返回结构不同，断言里按需取字段
  return { status: res.status, json: await res.json().catch(() => null) as any };
}
const bt = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
let seq = 0;
function order(btId: number, sub: string, opts: { status?: string; owner?: string; steps?: { name: string; status: string; assignee?: string }[] } = {}) {
  const id = `ORD-A${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person, total_amount, currency) VALUES (?,?,?,?,?,?,1000,'CNY')")
    .run(id, `客户A${seq}`, btId, sub, opts.status || '进行中', opts.owner || '');
  (opts.steps || []).forEach((s, i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(id, s.name, i + 1, s.status, s.assignee || ''));
  return id;
}
const finRow = (id: number) => db.prepare('SELECT * FROM finances WHERE id=?').get(id) as { id: number; type: string; status: string; amount: number; verify_by: string };

// ---------- 收入只走老板核对 ----------
const TM = bt('商标');
const fo = order(TM, 'tm-reg', { steps: [{ name: '方案确认', status: '已完成' }] });
const finUrl = `/api/orders/${fo}/finances`;

await check('员工录收入时传「已付」也只会存成「待核对」；支出可以直接录已付', async () => {
  const r = await call(financesRoute.POST, staff, 'POST', finUrl, { type: 'income', amount: 500, description: '定金', status: 'paid', slip_file: '/u/a.png' }, fo);
  assert.equal(r.status, 201); assert.equal(r.json.status, '待核对');
  const e = await call(financesRoute.POST, staff, 'POST', finUrl, { type: 'expense', amount: 100, description: '官费', status: 'paid' }, fo);
  assert.equal(e.json.status, 'paid');
});

await check('员工不能在编辑里把收入改成已付；收入状态任何人都只能走核对', async () => {
  const inc = db.prepare("SELECT id FROM finances WHERE order_id=? AND type='income'").get(fo) as { id: number };
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: inc.id, status: 'paid' }, fo)).status, 400);
  assert.equal((await call(financesRoute.PATCH, admin, 'PATCH', finUrl, { finance_id: inc.id, status: 'paid' }, fo)).status, 400);
  assert.equal(finRow(inc.id).status, '待核对');
  // 状态没变（编辑表单原样带回来）可以保存别的字段
  const ok = await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: inc.id, status: '待核对', description: '定金（第一笔）', amount: 600 }, fo);
  assert.equal(ok.status, 200); assert.equal(finRow(inc.id).amount, 600);
});

await check('核对过的收入：员工改不了金额、删不了，只能补描述；管理员可以改、可以删；都留记录', async () => {
  const inc = db.prepare("SELECT id FROM finances WHERE order_id=? AND type='income'").get(fo) as { id: number };
  assert.equal((await call(verifyRoute.POST, admin, 'POST', `${finUrl}/verify`, { finance_id: inc.id, action: 'arrived' }, fo)).status, 200);
  assert.equal(finRow(inc.id).status, 'paid');
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: inc.id, amount: 9999 }, fo)).status, 403);
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: inc.id, type: 'expense' }, fo)).status, 403);
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: inc.id, description: '已收定金', amount: 600 }, fo)).status, 200);
  assert.equal((await call(financesRoute.DELETE, staff, 'DELETE', finUrl, { finance_id: inc.id }, fo)).status, 403);
  assert.equal((await call(financesRoute.PATCH, admin, 'PATCH', finUrl, { finance_id: inc.id, amount: 650 }, fo)).status, 200);
  const logs = (db.prepare("SELECT action, detail FROM audit_logs WHERE target_type='finance' AND target_id=? ORDER BY id").all(String(inc.id)) as { action: string; detail: string }[]);
  assert.ok(logs.some(l => l.action === '修改费用' && l.detail.includes('600') && l.detail.includes('650')), JSON.stringify(logs));
  assert.equal((await call(financesRoute.DELETE, admin, 'DELETE', finUrl, { finance_id: inc.id }, fo)).status, 200);
});

await check('支出改成收入要重新等核对；收入改成支出不带走收入状态；核对接口不收支出', async () => {
  const exp = db.prepare("SELECT id FROM finances WHERE order_id=? AND type='expense'").get(fo) as { id: number };
  assert.equal((await call(verifyRoute.POST, admin, 'POST', `${finUrl}/verify`, { finance_id: exp.id, action: 'arrived' }, fo)).status, 400);
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: exp.id, type: 'income' }, fo)).status, 200);
  assert.equal(finRow(exp.id).status, '待核对');
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: exp.id, type: 'expense' }, fo)).status, 200);
  assert.equal(finRow(exp.id).status, 'pending');
  assert.equal((await call(financesRoute.PATCH, staff, 'PATCH', finUrl, { finance_id: exp.id, status: '待核对' }, fo)).status, 400);
});

// ---------- 我的环节：没写经办人的算订单负责人 ----------
const CHG = bt('公司注册');
const loadOf = (name: string) => buildHandlingReport(db, '2026-10', new Date()).load.find(l => l.person === name)?.orders || 0;
const unassignedLoad = () => buildHandlingReport(db, '2026-10', new Date()).load.find(l => l.kind === 'unassigned')?.orders || 0;
const before = { stats: 0, load: loadOf(staff2.name), unassigned: unassignedLoad() };
before.stats = (await call(statsRoute.GET as never, staff2, 'GET', '/api/dashboard/stats')).json.today_todos;
await check('没写经办人的步骤出现在订单负责人的「我的环节」；已取消的单不出现；今日待办只数能动手的', async () => {
  const mine = order(TM, 'tm-reg', { owner: staff2.name, steps: [{ name: '方案确认', status: '进行中' }, { name: '提交申请', status: '待处理', assignee: staff2.name }, { name: '等待官方审核', status: '待处理' }] });
  order(TM, 'tm-reg', { owner: staff2.name, status: '客户取消', steps: [{ name: '方案确认', status: '进行中' }] });
  const r = await call(assignedRoute.GET as never, staff2, 'GET', `/api/steps/assigned?user=${encodeURIComponent(staff2.name)}`);
  const rows = (r.json as { order_id: string; step_name: string; via_owner: number; can_start: number }[]).filter(x => x.order_id.startsWith('ORD-A'));
  assert.deepEqual(rows.map(x => [x.order_id, x.step_name, x.via_owner, x.can_start]), [
    [mine, '方案确认', 1, 1], [mine, '提交申请', 0, 0], [mine, '等待官方审核', 1, 0],
  ]);
  const stats = await call(statsRoute.GET as never, staff2, 'GET', '/api/dashboard/stats');
  assert.equal(stats.json.today_todos - before.stats, 1, JSON.stringify(stats.json));
  // 公司注册各步互不阻塞
  const co = order(CHG, 'company-reg', { owner: staff2.name, steps: [{ name: '方案确认', status: '进行中' }, { name: '收集公司资料', status: '待处理' }] });
  const r2 = await call(assignedRoute.GET as never, staff2, 'GET', `/api/steps/assigned?user=${encodeURIComponent(staff2.name)}`);
  assert.ok((r2.json as { order_id: string; can_start: number }[]).filter(x => x.order_id === co).every(x => x.can_start === 1));
});

await check('办理月报：没写经办人的当前步骤算到订单负责人头上，负责人也没填才算「未指定」', () => {
  // 上一条加了两张负责人是 staff2 的在办单（另一张已取消不算），当前步骤都没写经办人
  assert.equal(loadOf(staff2.name) - before.load, 2);
  assert.equal(unassignedLoad(), before.unassigned);
});

// ---------- 待分类角标 ----------
await check('待分类（待领取）角标只数没人领、没办完没取消的待分类单', async () => {
  const UN = bt('待分类');
  order(UN, 'storefront-unclassified', { steps: [{ name: '方案确认', status: '进行中' }] });
  order(UN, 'storefront-unclassified', { owner: staff.name, steps: [{ name: '方案确认', status: '进行中' }] });
  order(UN, 'storefront-unclassified', { status: '客户取消' });
  const r = await call(unclassifiedRoute.GET as never, staff, 'GET', '/api/orders/unclassified-count');
  assert.equal(r.json.count, 1);
  const client = db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('客户乙','clientb@example.invalid','client','x',0,'在职')").run();
  const c = db.prepare('SELECT id, name, role, auth_version FROM employees WHERE id=?').get(client.lastInsertRowid) as Emp;
  assert.equal((await call(unclassifiedRoute.GET as never, c, 'GET', '/api/orders/unclassified-count')).status, 403);
});

// ---------- 新建订单子类型必选；建单后不能改业务线 ----------
const FDA = bt('FDA认证');
await check('有具体服务的业务线不选子类型建不了单；选了能建', async () => {
  const bad = await call(ordersRoute.POST as never, staff, 'POST', '/api/orders', { customer_name: '新客户', business_type_id: FDA });
  assert.equal(bad.status, 400); assert.match(bad.json.error, /子类型/);
  const good = await call(ordersRoute.POST as never, staff, 'POST', '/api/orders', { customer_name: '新客户', business_type_id: FDA, sub_service_type: 'food' });
  assert.equal(good.status, 201, JSON.stringify(good.json));
  const soc = await call(ordersRoute.POST as never, staff, 'POST', '/api/orders', { customer_name: '新客户', business_type_id: bt('社保开户') });
  assert.equal(soc.status, 201, '没有具体服务的业务线照旧不用选');
});

await check('建单后改业务线被拦；给没选服务的老单补选同一套流程的服务可以', async () => {
  const names = getOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name);
  const tm = order(TM, 'tm-reg', { steps: names.map(n => ({ name: n, status: '待处理' })) });
  const moved = await call(orderRoute.PATCH as never, staff, 'PATCH', `/api/orders/${tm}`, { business_type_id: FDA }, tm);
  assert.equal(moved.status, 409, JSON.stringify(moved.json));
  assert.equal((db.prepare('SELECT business_type_id FROM orders WHERE id=?').get(tm) as { business_type_id: number }).business_type_id, TM);
  const coNames = getOrderStepsWithDocs(CHG, undefined).map(s => s.name);
  const legacy = order(CHG, '', { steps: coNames.map(n => ({ name: n, status: '待处理' })) });
  const filled = await call(orderRoute.PATCH as never, staff, 'PATCH', `/api/orders/${legacy}`, { sub_service_type: 'company-reg' }, legacy);
  assert.equal(filled.status, 200, JSON.stringify(filled.json));
  const same = await call(orderRoute.PATCH as never, staff, 'PATCH', `/api/orders/${tm}`, { business_type_id: TM, sub_service_type: 'tm-reg', description: '改备注' }, tm);
  assert.equal(same.status, 200, '原样带回业务线不算改');
});

// ---------- 提醒进消息中心 ----------
await check('「商城新订单」「客户站同步失败」两类提醒在消息中心看得到，点开能进单', async () => {
  const mall = order(TM, 'tm-reg', { steps: [{ name: '方案确认', status: '待处理' }] });
  alerts.notifyNewMallOrder(db, mall, '商城单测试');
  alerts.notifySyncBackFailure(db, 'ORD-NO-SUCH', '回传测试');
  const s = await call(notificationsRoute.GET as never, staff, 'GET', '/api/notifications');
  const mine = (s.json as { title: string; order_id: string | null }[]).filter(n => n.title === '商城新订单');
  assert.equal(mine.length, 1); assert.equal(mine[0].order_id, mall);
  const staffSees = (s.json as { title: string }[]).some(n => n.title === '客户站同步失败');
  assert.equal(staffSees, false, '回传失败只发管理员');
  const a = await call(notificationsRoute.GET as never, admin, 'GET', '/api/notifications');
  assert.ok((a.json as { title: string }[]).some(n => n.title === '客户站同步失败'));
});

await check('回传客户站连续失败到第 6 次提醒管理员；一次断线只提醒一回，读过之后再失败才再提醒', async () => {
  process.env.CUSTOMER_SYNC_URL = 'http://127.0.0.1:9';
  process.env.SYNC_SECRET = 'test-secret';
  const { flushProgress, flushDocumentReviews } = await import('../src/lib/progress-sync');
  db.prepare("DELETE FROM notifications WHERE title='客户站同步失败'").run();
  const count = () => (db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE title='客户站同步失败'").get() as { c: number }).c;
  const admins = (db.prepare("SELECT COUNT(DISTINCT name) AS c FROM employees WHERE role='admin' AND status='在职' AND name<>''").get() as { c: number }).c;
  db.prepare("INSERT INTO sync_progress_outbox (id, inbox_id, payload, status, attempts) VALUES ('P1','I1',?, 'pending', 5)").run(JSON.stringify({ source_order_no: 'ORD20261015000001', line_no: 1, copy_no: 1, seq: 1 }));
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload, status, attempts) VALUES ('D1','dlv-1',?, 'pending', 5)").run(JSON.stringify({ event: 'delivery', source_order_no: 'ORD20261015000002', delivery_id: 'dlv-1', seq: 1 }));
  await flushProgress();
  assert.equal(count(), admins);
  const body = (db.prepare("SELECT body FROM notifications WHERE title='客户站同步失败' LIMIT 1").get() as { body: string }).body;
  assert.ok(body.includes('ORD20261015000001') && body.includes('办理进度'), body);
  await flushDocumentReviews(); // 另一条也到第 6 次，但管理员手上那条还没读：不再发
  assert.equal(count(), admins);
  db.prepare("UPDATE sync_progress_outbox SET next_attempt_at=NULL").run();
  await flushProgress(); // 第 7 次：不是第 6 次，不发
  assert.equal(count(), admins);
  assert.equal((db.prepare("SELECT attempts FROM sync_progress_outbox WHERE id='P1'").get() as { attempts: number }).attempts, 7);
  db.prepare("UPDATE notifications SET is_read=1 WHERE title='客户站同步失败'").run();
  db.prepare("INSERT INTO sync_document_outbox (id, submission_id, payload, status, attempts) VALUES ('D2','dlv-2',?, 'pending', 5)").run(JSON.stringify({ event: 'cancel', source_order_no: 'ORD20261015000003', request_id: 'c-1' }));
  await flushDocumentReviews();
  assert.equal(count(), 2 * admins, '读过以后新的失败照常提醒');
});

await check('核对上线前留下的 pending 收入算待核对：侧栏角标算它，老板能直接核对', async () => {
  const countRoute = await import('../src/app/api/finances/pending-verify-count/route');
  const o = order(TM, 'tm-reg', { steps: [{ name: '方案确认', status: '已完成' }] });
  const before = (await call(countRoute.GET as never, admin, 'GET', '/api/finances/pending-verify-count')).json.count;
  const fid = Number(db.prepare("INSERT INTO finances (order_id, type, amount, status, currency) VALUES (?, 'income', 300, 'pending', 'CNY')").run(o).lastInsertRowid);
  assert.equal((await call(countRoute.GET as never, admin, 'GET', '/api/finances/pending-verify-count')).json.count, before + 1);
  assert.equal((await call(verifyRoute.POST, admin, 'POST', `/api/orders/${o}/finances/verify`, { finance_id: fid, action: 'arrived' }, o)).status, 200);
  assert.equal(finRow(fid).status, 'paid');
});

await check('有核对过收入的单员工删不了，管理员删时记下带走的收入', async () => {
  const o = order(TM, 'tm-reg', { steps: [{ name: '方案确认', status: '已完成' }] });
  db.prepare("INSERT INTO finances (order_id, type, amount, status, currency, verify_by) VALUES (?, 'income', 800, 'paid', 'THB', 'x')").run(o);
  const r = await call(orderRoute.DELETE as never, staff, 'DELETE', `/api/orders/${o}`, undefined, o);
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.ok(db.prepare('SELECT 1 FROM orders WHERE id=?').get(o));
  assert.equal((await call(orderRoute.DELETE as never, admin, 'DELETE', `/api/orders/${o}`, undefined, o)).status, 200);
  const log = db.prepare("SELECT detail FROM audit_logs WHERE action='删除订单' AND target_id=?").get(o) as { detail: string };
  assert.match(log.detail, /800 泰铢/);
  const o2 = order(TM, 'tm-reg', { steps: [{ name: '方案确认', status: '已完成' }] });
  db.prepare("INSERT INTO finances (order_id, type, amount, status, currency) VALUES (?, 'income', 100, '待核对', 'CNY')").run(o2);
  assert.equal((await call(orderRoute.DELETE as never, staff, 'DELETE', `/api/orders/${o2}`, undefined, o2)).status, 200, '还没核对的照旧能删');
});

await check('负责人兜底只认名字完全一样：Ann 看不到 Anna 的单', async () => {
  for (const name of ['Ann', 'Anna']) db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES (?, ?, 'employee', 'x', 0, '在职')").run(name, `${name}@example.invalid`);
  const ann = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE name='Ann'").get() as Emp;
  const annasOrder = order(TM, 'tm-reg', { owner: 'Anna', steps: [{ name: '方案确认', status: '进行中' }] });
  const shared = order(TM, 'tm-reg', { owner: 'Bob / ann', steps: [{ name: '方案确认', status: '进行中' }] });
  const r = await call(assignedRoute.GET as never, ann, 'GET', '/api/steps/assigned?user=Ann');
  const ids = (r.json as { order_id: string }[]).map(x => x.order_id);
  assert.ok(!ids.includes(annasOrder), JSON.stringify(ids));
  assert.ok(ids.includes(shared), '几个人写在一起、大小写不同也认');
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
