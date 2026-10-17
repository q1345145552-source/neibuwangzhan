/**
 * 订单管理第三轮复核修复（2026-10-16）：今日待办「能开始」看前面所有步骤、公司变更按顺序走、
 * 「轮到你了」发给在岗员工、回传失败提醒不吞单号、月报超时按单数、客户站来的单带客户站账单状态。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-ordermgmtc-<新目录>/x.db node --import <tsx loader> scripts/test-order-mgmt-c.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-ordermgmtc-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-ordermgmtc-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'order-mgmt-c-regression-jwt';
process.env.CUSTOMER_SYNC_URL = ''; process.env.SYNC_SECRET = '';
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const stepsRoute = await import('../src/app/api/orders/[id]/steps/route');
const ordersRoute = await import('../src/app/api/orders/route');
const assignedRoute = await import('../src/app/api/steps/assigned/route');
const { buildHandlingReport } = await import('../src/lib/handling-report');
const { notifySyncBackFailure } = await import('../src/lib/order-alerts');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n')[0]); }
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
const bt = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
const TM = bt('商标'), CO = bt('公司注册');
let seq = 0;
function order(btId: number, sub: string, owner: string, steps: [string, string, string][], extra: { status?: string; source?: string } = {}) {
  const id = `ORD-C${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person, total_amount, currency, source_system) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, `客户C${seq}`, btId, sub, extra.status ?? '进行中', owner, 1000, 'CNY', extra.source ?? 'manual');
  steps.forEach(([name, status, assignee], i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(id, name, i + 1, status, assignee));
  return id;
}
const stepId = (o: string, name: string) => (db.prepare('SELECT id FROM order_steps WHERE order_id=? AND step_name=?').get(o, name) as { id: number }).id;
const patch = (who: Emp, o: string, name: string, body: Record<string, unknown>) => call(stepsRoute.PATCH, who, 'PATCH', `/api/orders/${o}/steps`, { step_id: stepId(o, name), ...body }, o);
const mine = async (who: Emp, o: string) => ((await call(assignedRoute.GET as never, who, 'GET', `/api/steps/assigned?user=${encodeURIComponent(who.name)}`)).json as { order_id: string; step_name: string; can_start: number }[])
  .filter(x => x.order_id === o).map(x => [x.step_name, x.can_start]);
const turnNotes = (name: string, o: string) => (db.prepare("SELECT body FROM notifications WHERE recipient=? AND title='轮到你了' AND related_id=?").all(name, o) as { body: string }[]).map(r => r.body);

await check('今日待办「能开始」看前面所有步骤：中间那步跳过了、更前面的还没办完，也不能开始', async () => {
  const o = order(TM, 'tm-reg', A.name, [['方案确认', '进行中', admin.name], ['如需补资料', '已跳过', ''], ['提交申请', '待处理', A.name], ['拿证', '待处理', A.name]]);
  assert.deepEqual(await mine(A, o), [['提交申请', 0], ['拿证', 0]]);
});

await check('公司变更按顺序走：后面的步骤不能先开始、不能先跳过；办完一步提醒下一步的人', async () => {
  const o = order(CO, 'change', A.name, [['方案确认', '进行中', admin.name], ['递交变更', '待处理', A.name], ['等待批复', '待处理', A.name], ['交付', '待处理', A.name]]);
  assert.deepEqual(await mine(A, o), [['递交变更', 0], ['等待批复', 0], ['交付', 0]]);
  const early = await patch(A, o, '等待批复', { status: '已跳过', reason: '不用等' });
  assert.equal(early.status, 400); assert.match(early.json.error, /前面还有步骤没办完/);
  assert.equal((await patch(admin, o, '方案确认', { status: '已完成' })).status, 200);
  assert.deepEqual(await mine(A, o), [['递交变更', 1], ['等待批复', 0], ['交付', 0]]);
  const got = turnNotes(A.name, o);
  assert.equal(got.length, 1); assert.match(got[0], /递交变更/);
});

await check('公司注册各步互不阻塞：后面的能开始、能跳过，不发「轮到你了」', async () => {
  const o = order(CO, 'new', A.name, [['方案确认', '进行中', admin.name], ['核名', '待处理', A.name], ['开户', '待处理', A.name], ['交付', '待处理', A.name]]);
  assert.deepEqual(await mine(A, o), [['核名', 1], ['开户', 1], ['交付', 1]]);
  assert.equal((await patch(A, o, '开户', { status: '已跳过', reason: '客户自己开' })).status, 200);
  assert.equal((await patch(admin, o, '方案确认', { status: '已完成' })).status, 200);
  assert.deepEqual(turnNotes(A.name, o), []);
});

await check('「轮到你了」发给在岗的人：试用期也发，离职、停薪留职不发', async () => {
  const add = (name: string, status: string) => db.prepare("INSERT INTO employees (name, email, role, password, status, must_change_password) VALUES (?,?,'employee','x',?,0)").run(name, `${name}@example.invalid`, status);
  add('试用员工C', '试用期'); add('离职员工C', '离职'); add('停薪员工C', '停薪留职');
  for (const [who, expect] of [['试用员工C', 1], ['离职员工C', 0], ['停薪员工C', 0]] as const) {
    const o = order(TM, 'tm-reg', A.name, [['方案确认', '进行中', admin.name], ['提交申请', '待处理', who], ['拿证', '待处理', A.name]]);
    assert.equal((await patch(admin, o, '方案确认', { status: '已完成' })).status, 200);
    assert.equal(turnNotes(who, o).length, expect, who);
  }
});

await check('回传客户站失败：一次断线只留一条没读的提醒，但后面失败的单号补进去不吞掉', async () => {
  notifySyncBackFailure(db, 'XT-FAIL-1', '客户站订单 XT-FAIL-1 的进度一直没送到。');
  notifySyncBackFailure(db, 'XT-FAIL-2', '客户站订单 XT-FAIL-2 的进度一直没送到。');
  notifySyncBackFailure(db, 'XT-FAIL-2', '客户站订单 XT-FAIL-2 的进度一直没送到。');
  const rows = db.prepare("SELECT body FROM notifications WHERE recipient=? AND title='客户站同步失败' AND is_read=0").all(admin.name) as { body: string }[];
  assert.equal(rows.length, 1);
  assert.match(rows[0].body, /XT-FAIL-1/); assert.match(rows[0].body, /XT-FAIL-2/);
  assert.equal(rows[0].body.split('XT-FAIL-2').length - 1, 1, '同一单不重复补');
});

await check('办理月报的「超时」按单数：公司注册两步同时超时只算 1 单，明细照旧两行', async () => {
  const o = order(CO, 'new', A.name, [['方案确认', '已完成', admin.name], ['核名', '进行中', A.name], ['开户', '进行中', A.name], ['交付', '待处理', A.name]]);
  const longAgo = new Date(Date.now() - 20 * 86400000).toISOString();
  db.prepare("UPDATE order_steps SET expected_days=1, started_at=? WHERE order_id=? AND step_name IN ('核名','开户')").run(longAgo, o);
  const report = buildHandlingReport(db, new Date().toISOString().slice(0, 7), new Date());
  assert.equal(report.overdue.filter(r => r.orderId === o).length, 2, JSON.stringify(report.overdue));
  assert.equal(report.summary.overdue, new Set(report.overdue.map(r => r.orderId)).size);
});

await check('客户站来的单在订单列表带上客户站账单付没付；自己建的单没有', async () => {
  const paid = order(TM, 'tm-reg', A.name, [['方案确认', '已完成', admin.name], ['拿证', '已完成', A.name]], { status: '已完成', source: 'storefront' });
  const unpaid = order(TM, 'tm-reg', A.name, [['方案确认', '已完成', admin.name], ['拿证', '已完成', A.name]], { status: '已完成', source: 'storefront' });
  const own = order(TM, 'tm-reg', A.name, [['方案确认', '已完成', admin.name], ['拿证', '已完成', A.name]], { status: '已完成' });
  for (const [no, id, status] of [['XT-PAID', paid, 'paid'], ['XT-UNPAID', unpaid, 'unpaid']] as const) {
    db.prepare(`INSERT INTO sync_orders(source_order_no,source_customer_id,source,currency,billing_revision,total_cents,discount_cents,net_cents,identity_json,financial_json,payload)
      VALUES (?,?,?,?,1,100000,0,100000,'{}',?,'{}')`).run(no, 'cust-c', 'storefront', 'CNY', JSON.stringify({ totalCents: 100000, discountCents: 0, depositCents: 0, billingStatus: status }));
    db.prepare(`INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,sku_code,internal_order_id,note,payload,allocated_cents,allocated_amount,billing_revision)
      VALUES (?,?,1,1,'TM-001',?,'','{}',100000,1000,1)`).run(`inbox-${no}`, no, id);
  }
  const list = (await call(ordersRoute.GET as never, admin, 'GET', '/api/orders')).json as { id: string; source_order_no?: string; payment?: { client_billing?: string | null } }[];
  const of = (id: string) => list.find(o => o.id === id)!;
  assert.equal(of(paid).payment?.client_billing, 'paid');
  assert.equal(of(paid).source_order_no, 'XT-PAID');
  assert.equal(of(unpaid).payment?.client_billing, 'unpaid');
  assert.equal(of(own).payment?.client_billing ?? null, null);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
