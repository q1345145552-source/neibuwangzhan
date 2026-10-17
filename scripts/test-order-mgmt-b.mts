/**
 * 订单管理继续优化（2026-10-16）：步骤「已跳过」、标阻塞/跳过写原因、上一步办完提醒下一步的人、
 * 订单列表摘要（进度/收款/客户站单号）、负责人只能是员工。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-ordermgmtb-<新目录>/x.db node --import <tsx loader> scripts/test-order-mgmt-b.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-ordermgmtb-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-ordermgmtb-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'order-mgmt-b-regression-jwt';
process.env.CUSTOMER_SYNC_URL = ''; process.env.SYNC_SECRET = '';
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const stepsRoute = await import('../src/app/api/orders/[id]/steps/route');
const ordersRoute = await import('../src/app/api/orders/route');
const orderRoute = await import('../src/app/api/orders/[id]/route');
const assignedRoute = await import('../src/app/api/steps/assigned/route');
const { buildHandlingReport } = await import('../src/lib/handling-report');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n')[0]); }
}
db.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string, ...a: unknown[]) => db.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get(...a) as Emp;
const admin = empOf("role='admin' AND status='在职'"), A = empOf("role='employee' AND status='在职'");
const B = empOf("role='employee' AND status='在职' AND id<>?", A.id);
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
function order(btId: number, owner: string, steps: [string, string, string][], extra: { total?: number; currency?: string } = {}) {
  const id = `ORD-B${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person, total_amount, currency) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, `客户B${seq}`, btId, btId === TM ? 'tm-reg' : 'change', '进行中', owner, extra.total ?? 1000, extra.currency ?? 'CNY');
  steps.forEach(([name, status, assignee], i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(id, name, i + 1, status, assignee));
  return id;
}
const stepId = (o: string, name: string) => (db.prepare('SELECT id FROM order_steps WHERE order_id=? AND step_name=?').get(o, name) as { id: number }).id;
const stepStatus = (o: string, name: string) => (db.prepare('SELECT status FROM order_steps WHERE order_id=? AND step_name=?').get(o, name) as { status: string }).status;
const patch = (who: Emp, o: string, name: string, body: Record<string, unknown>) => call(stepsRoute.PATCH, who, 'PATCH', `/api/orders/${o}/steps`, { step_id: stepId(o, name), ...body }, o);
const notesOf = (o: string) => (db.prepare('SELECT content FROM step_notes WHERE order_id=? ORDER BY id').all(o) as { content: string }[]).map(n => n.content);
const inbox = (name: string) => db.prepare("SELECT body FROM notifications WHERE recipient=? AND title='轮到你了' ORDER BY id").all(name) as { body: string }[];

await check('跳过：要写原因；第一步、最后一步、已完成的步骤不能跳；原因记进备注', async () => {
  const o = order(TM, A.name, [['方案确认', '已完成', ''], ['如需补资料', '待处理', A.name], ['提交申请', '待处理', A.name], ['拿证', '待处理', A.name]]);
  assert.equal((await patch(A, o, '如需补资料', { status: '已跳过' })).status, 400);
  assert.equal((await patch(A, o, '方案确认', { status: '已跳过', reason: 'x' })).status, 400);
  assert.equal((await patch(A, o, '拿证', { status: '已跳过', reason: 'x' })).status, 400);
  // 只能跳「当前这一步」：前面还有没办完的，后面的不能先跳
  const o2 = order(TM, A.name, [['方案确认', '进行中', ''], ['如需补资料', '待处理', A.name], ['提交申请', '待处理', A.name], ['拿证', '待处理', A.name]]);
  const early = await patch(A, o2, '如需补资料', { status: '已跳过', reason: 'x' });
  assert.equal(early.status, 400); assert.match(early.json.error, /前面还有步骤没办完/);
  const r = await patch(A, o, '如需补资料', { status: '已跳过', reason: '客户一次交齐了' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(stepStatus(o, '如需补资料'), '已跳过');
  assert.ok((db.prepare('SELECT completed_at FROM order_steps WHERE id=?').get(stepId(o, '如需补资料')) as { completed_at: string | null }).completed_at, '跳过也记下时刻');
  assert.ok(notesOf(o).includes('跳过原因：客户一次交齐了'), JSON.stringify(notesOf(o)));
  const skipNote = inbox(A.name).length; // A 自己跳的，不提醒自己
  assert.equal(skipNote, inbox(A.name).length);
});

await check('跳过的步骤算「不用办」：后面一步能开始，剩下的办完整单就是已完成', async () => {
  const o = order(TM, B.name, [['方案确认', '已完成', ''], ['如需补资料', '待处理', ''], ['提交申请', '待处理', B.name], ['拿证', '待处理', B.name]]);
  assert.equal((await patch(B, o, '如需补资料', { status: '已跳过', reason: '用不上' })).status, 200);
  const mine = (await call(assignedRoute.GET as never, B, 'GET', `/api/steps/assigned?user=${encodeURIComponent(B.name)}`)).json as { order_id: string; step_name: string; can_start: number }[];
  const rows = mine.filter(x => x.order_id === o);
  assert.deepEqual(rows.map(x => [x.step_name, x.can_start]), [['提交申请', 1], ['拿证', 0]], JSON.stringify(rows));
  await patch(B, o, '提交申请', { status: '已完成' });
  await patch(B, o, '拿证', { status: '已完成' });
  assert.equal((db.prepare('SELECT status FROM orders WHERE id=?').get(o) as { status: string }).status, '已完成');
  const report = buildHandlingReport(db, new Date().toISOString().slice(0, 7), new Date());
  assert.ok(report.summary.done >= 1);
});

await check('标阻塞带原因记进备注；不带原因也照旧能标（老入口兼容）', async () => {
  const o = order(TM, A.name, [['方案确认', '已完成', ''], ['提交申请', '进行中', A.name], ['拿证', '待处理', A.name]]);
  assert.equal((await patch(A, o, '提交申请', { status: '阻塞', reason: '等客户补护照' })).status, 200);
  assert.ok(notesOf(o).includes('卡住原因：等客户补护照'));
  const o2 = order(TM, A.name, [['方案确认', '已完成', ''], ['提交申请', '进行中', A.name], ['拿证', '待处理', A.name]]);
  assert.equal((await patch(A, o2, '提交申请', { status: '阻塞' })).status, 200);
});

await check('上一步办完提醒下一步的人；没写经办人提醒负责人；点完成的本人不提醒；同一条不重复', async () => {
  const o = order(TM, admin.name, [['方案确认', '进行中', ''], ['提交申请', '待处理', B.name], ['等待官方审核', '待处理', ''], ['拿证', '待处理', B.name]]);
  const before = inbox(B.name).length;
  assert.equal((await patch(A, o, '方案确认', { status: '已完成' })).status, 200);
  const got = inbox(B.name).slice(before);
  assert.equal(got.length, 1); assert.match(got[0].body, /「方案确认」已办完，下一步「提交申请」是你的/);
  // B 自己点完：下一步没写经办人 → 提醒负责人 admin，不提醒 B 自己
  const adminBefore = inbox(admin.name).length;
  assert.equal((await patch(B, o, '提交申请', { status: '已完成' })).status, 200);
  const toAdmin = inbox(admin.name).slice(adminBefore);
  assert.equal(toAdmin.length, 1); assert.match(toAdmin[0].body, /下一步「等待官方审核」没写经办人，算你这个负责人的/);
  assert.equal(inbox(B.name).length, before + 1, 'B 不会收到自己点的');
  // 撤回再完成：上一条还没读，不重复
  await patch(B, o, '提交申请', { status: '进行中' });
  await patch(B, o, '提交申请', { status: '已完成' });
  assert.equal(inbox(admin.name).length, adminBefore + 1);
});

await check('跳过以后提醒写「已跳过」；前面还有没办完的步骤时不提醒后面的人', async () => {
  const o = order(TM, admin.name, [['方案确认', '已完成', ''], ['如需补资料', '进行中', A.name], ['提交申请', '待处理', B.name], ['拿证', '待处理', B.name]]);
  const before = inbox(B.name).length;
  assert.equal((await patch(A, o, '如需补资料', { status: '已跳过', reason: '用不上' })).status, 200);
  const got = inbox(B.name).slice(before);
  assert.equal(got.length, 1); assert.match(got[0].body, /「如需补资料」已跳过，下一步「提交申请」是你的/);
  // 中间一步撤回：后面的步骤办完也不提醒再后面的人
  const o2 = order(TM, admin.name, [['方案确认', '已完成', ''], ['准备资料', '进行中', A.name], ['提交申请', '已完成', A.name], ['拿证', '待处理', B.name]]);
  const before2 = inbox(B.name).length;
  await patch(A, o2, '提交申请', { status: '进行中' });
  await patch(A, o2, '提交申请', { status: '已完成' });
  assert.equal(inbox(B.name).length, before2, '「准备资料」还没办完，没轮到「拿证」');
});

await check('待分类单改派后，接上来的第一步经办人也收到「轮到你了」', async () => {
  const UN = bt('待分类');
  const o = `ORD-BU${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person) VALUES (?,?,?,?,?,?)").run(o, '待分类客户', UN, 'storefront-unclassified', '进行中', admin.name);
  const { getOrderStepsWithDocs } = await import('../src/lib/db');
  getOrderStepsWithDocs(0, 'storefront-unclassified').forEach((st, i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(o, st.name, i + 1, i === 0 ? '已完成' : '待处理', ''));
  const firstNew = getOrderStepsWithDocs(TM, 'tm-reg').slice(1)[0];
  const who = (firstNew.assignee || admin.name).split(/[/、,，]/)[0].trim();
  const before = (db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE title='轮到你了' AND related_id=?").get(o) as { c: number }).c;
  const r = await call(orderRoute.PATCH as never, admin, 'PATCH', `/api/orders/${o}`, { business_type_id: TM, sub_service_type: 'tm-reg' }, o);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const after = db.prepare("SELECT recipient, body FROM notifications WHERE title='轮到你了' AND related_id=?").all(o) as { recipient: string; body: string }[];
  assert.equal(after.length - before >= (who === admin.name ? 0 : 1), true, JSON.stringify({ who, after }));
  if (who !== admin.name && db.prepare("SELECT 1 FROM employees WHERE name=? AND status='在职' AND role IN ('admin','employee')").get(who)) {
    assert.ok(after.some(n => n.recipient === who && n.body.includes(`下一步「${firstNew.name}」`)), JSON.stringify(after));
  }
});

await check('公司注册各步互不阻塞，不发「轮到你了」', async () => {
  const o = order(CO, admin.name, [['方案确认', '进行中', ''], ['核名', '待处理', B.name]]);
  // 公司变更（change）按顺序走，照发提醒（10-16 复核修正，见 test-order-mgmt-c）；这里测新注册
  db.prepare("UPDATE orders SET sub_service_type='new' WHERE id=?").run(o);
  const before = inbox(B.name).length;
  await patch(A, o, '方案确认', { status: '已完成' });
  assert.equal(inbox(B.name).length, before);
});

await check('订单列表给员工带进度、收款、客户站单号；客户账号看到的不变', async () => {
  const o = order(TM, A.name, [['方案确认', '已完成', ''], ['如需补资料', '已跳过', ''], ['提交申请', '阻塞', A.name], ['拿证', '待处理', A.name]], { total: 1000, currency: 'CNY' });
  db.prepare("INSERT INTO finances (order_id,type,amount,status,currency) VALUES (?, 'income', 600, 'paid', 'CNY')").run(o);
  db.prepare("INSERT INTO finances (order_id,type,amount,status,currency) VALUES (?, 'income', 400, '待核对', 'CNY')").run(o);
  db.prepare("INSERT INTO finances (order_id,type,amount,status,currency) VALUES (?, 'income', 900, 'paid', 'THB')").run(o);
  db.prepare("INSERT INTO sync_inbox (id, source_order_no, line_no, copy_no, internal_order_id, payload) VALUES ('IB1','ORD20261016000001',1,1,?,'{}')").run(o);
  const r = await call(ordersRoute.GET as never, A, 'GET', '/api/orders');
  const row = (r.json as { id: string; source_order_no: string; progress: { total: number; closed: number; current_step: string; current_assignee: string; blocked: string[] }; payment: { arrived: number; arrived_other: number; waiting: number } }[]).find(x => x.id === o)!;
  assert.equal(row.source_order_no, 'ORD20261016000001');
  assert.deepEqual([row.progress.total, row.progress.closed, row.progress.current_step, row.progress.current_assignee, row.progress.blocked], [4, 2, '提交申请', A.name, ['提交申请']]);
  assert.deepEqual([row.payment.arrived, row.payment.arrived_other, row.payment.waiting], [600, 900, 1]);
  // 金额没填、收入被核成「未到账」：不算收到钱
  const z = order(TM, A.name, [['方案确认', '已完成', '']], { total: 0 });
  db.prepare("INSERT INTO finances (order_id,type,amount,status,currency) VALUES (?, 'income', 500, '未到账', 'CNY')").run(z);
  const zr = ((await call(ordersRoute.GET as never, A, 'GET', '/api/orders')).json as { id: string; payment: { has_income: boolean; has_arrived: boolean } }[]).find(x => x.id === z)!;
  assert.deepEqual([zr.payment.has_income, zr.payment.has_arrived], [true, false]);
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('客户丙','clientc@example.invalid','client','x',0,'在职')").run();
  const c = empOf("name='客户丙'");
  const cr = await call(ordersRoute.GET as never, c, 'GET', '/api/orders');
  assert.ok(Array.isArray(cr.json) && (cr.json as Record<string, unknown>[]).every(x => x.progress === undefined && x.payment === undefined && x.source_order_no === undefined));
});

await check('负责人只能是员工：填客户账号名字被拦，填员工、清空都可以；老单原样保存不受影响；建单也拦', async () => {
  const o = order(TM, A.name, [['方案确认', '进行中', '']]);
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('客户丁','clientd@example.invalid','client','x',0,'在职')").run();
  assert.equal((await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${o}`, { responsible_person: '客户丁' }, o)).status, 400);
  const legacy = order(TM, '客户丁', [['方案确认', '进行中', '']]);
  assert.equal((await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${legacy}`, { responsible_person: '客户丁', description: '改备注' }, legacy)).status, 200, '负责人没变，照常能保存别的');
  assert.equal((await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: 'x', business_type_id: bt('社保开户'), responsible_person: '客户丁' })).status, 400);
  assert.equal((await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${o}`, { responsible_person: B.name }, o)).status, 200);
  assert.equal((await call(orderRoute.PATCH as never, A, 'PATCH', `/api/orders/${o}`, { responsible_person: '' }, o)).status, 200);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
