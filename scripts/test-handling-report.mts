/**
 * 办理效率月报 + 流程设置只读清单（2026-10-15，第 1 期）：工作日算法、各项口径、只给管理员。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-handling-<新目录>/x.db node --import <tsx loader> scripts/test-handling-report.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-handling-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-handling-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'handling-report-regression-jwt';
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const R = await import('../src/lib/handling-report');
const { buildWorkflowCatalog } = await import('../src/lib/workflow-catalog');
const reportRoute = await import('../src/app/api/internal/handling-report/route');
const workflowRoute = await import('../src/app/api/workflows/route');
const db = getDb();

let pass = 0, fail = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n')[0]); }
}
const holidays = new Set((db.prepare('SELECT date FROM thai_holidays').all() as { date: string }[]).map(h => h.date));
const at = (bkk: string) => new Date(bkk.replace(' ', 'T') + ':00+07:00'); // 曼谷时间 → Date
const utc = (bkk: string) => at(bkk).toISOString().replace('T', ' ').slice(0, 19); // 存库用的 UTC 字符串

await check('工作日：一整个工作日 = 1 天；周日、10-13 法定假日不算', () => {
  assert.equal(R.workDays(at('2026-10-12 08:00'), at('2026-10-12 17:00'), holidays), 1); // 周一
  assert.equal(R.workDays(at('2026-10-10 17:00'), at('2026-10-12 08:00'), holidays), 0); // 周六下班到周一上班：中间只有周日
  assert.equal(R.workDays(at('2026-10-12 17:00'), at('2026-10-14 08:00'), holidays), 0); // 10-13 是假日
  assert.equal(R.workDays(at('2026-10-14 08:00'), at('2026-10-21 08:00'), holidays), 6); // 周三到下周三：周日不算
  assert.equal(R.workDays(at('2026-10-14 12:00'), at('2026-10-14 13:30'), holidays), 1.5 / 9);
});

await check('外部等待：以「等待」「再次等待」开头才算，名字中间提到等待的不算', () => {
  assert.ok(R.isExternalWait('等待官方审核'));
  assert.ok(R.isExternalWait('再次等待官方审核'));
  assert.ok(R.isExternalWait('等待客户签署授权书和同意书'));
  assert.ok(!R.isExternalWait('做账报税：Eve每月整理账目（当前零申报，等待老板安排改正常报税）'));
});

await check('库里两种时间写法都认，按 UTC 解析', () => {
  assert.equal(R.parseDbTime('2026-10-15 05:04:33')?.toISOString(), '2026-10-15T05:04:33.000Z');
  assert.equal(R.parseDbTime('2026-10-15T05:04:33.694Z')?.toISOString(), '2026-10-15T05:04:33.694Z');
  assert.equal(R.bkkMonthKey(new Date('2026-09-30T20:00:00Z')), '2026-10'); // 曼谷已是 10-01 03:00
});

// ---------- 造数据 ----------
const bt = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
const TM = bt('商标'), SOC = bt('社保开户'), CO = bt('公司注册');
const staff = (db.prepare("SELECT name FROM employees WHERE role='employee' AND status='在职' ORDER BY id").all() as { name: string }[]).map(e => e.name);
const [A, B] = staff;
let seq = 0;
function order(btId: number, sub: string, status: string, createdBkk: string, steps: { name: string; status: string; assignee?: string; start?: string; done?: string }[]) {
  const id = `ORD-T${++seq}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, `客户${seq}`, btId, sub, status, at(createdBkk).toISOString());
  steps.forEach((s, i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee, started_at, completed_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, s.name, i + 1, s.status, s.assignee ?? '', s.start ? utc(s.start) : null, s.done ? utc(s.done) : null));
  return id;
}
// 商标：9 月办完 3 单（周期 5、10、15 个工作日左右），用来算中间值
const tmDone = (created: string, finish: string) => order(TM, 'tm-reg', '已完成', created, [
  { name: '方案确认', status: '已完成', start: created, done: created.replace(/\d\d:\d\d$/, '10:00') },
  { name: '提交申请', status: '已完成', assignee: A, start: created.replace(/\d\d:\d\d$/, '10:00'), done: finish },
]);
tmDone('2026-09-01 09:00', '2026-09-07 09:00');
tmDone('2026-09-02 09:00', '2026-09-14 09:00');
tmDone('2026-09-03 09:00', '2026-09-21 09:00');
// 再造 3 单「提交申请」样本（8 月完成），凑够 5 个样本才能判断平时多久
for (let k = 0; k < 3; k++) tmDone(`2026-08-0${3 + k} 09:00`, `2026-08-1${0 + k} 09:00`);
// 9 月最后一刻曼谷时间完成的单：算 9 月；UTC 已是 9 月 30 日、曼谷已是 10 月 1 日的：算 10 月
order(SOC, '', '已完成', '2026-09-20 09:00', [{ name: '方案确认', status: '已完成', start: '2026-09-20 09:00', done: '2026-09-21 09:00' }, { name: '交付客户', status: '已完成', assignee: B, start: '2026-09-21 09:00', done: '2026-10-01 03:00' }]);
// 公司注册办完：周期不算，只计单数
order(CO, 'company-reg', '已完成', '2026-09-05 09:00', [{ name: '方案确认', status: '已完成', start: '2026-09-05 09:00', done: '2026-09-05 10:00' }, { name: '全套文件交付客户', status: '已完成', assignee: A, start: '2026-09-05 10:00', done: '2026-09-25 10:00' }]);
// 取消的单：不进任何统计
order(TM, 'tm-reg', '客户取消', '2026-09-04 09:00', [{ name: '方案确认', status: '已完成', start: '2026-09-04 09:00', done: '2026-09-04 10:00' }, { name: '提交申请', status: '进行中', assignee: A, start: '2026-09-04 10:00' }]);
// 在办：A 手上停了很久的「提交申请」（应判超时）、外部等待、没指派
const stuck = order(TM, 'tm-reg', '进行中', '2026-09-08 09:00', [{ name: '方案确认', status: '已完成', start: '2026-09-08 09:00', done: '2026-09-08 10:00' }, { name: '提交申请', status: '阻塞', assignee: A, start: '2026-09-08 10:00' }]);
order(TM, 'tm-reg', '进行中', '2026-10-01 09:00', [{ name: '方案确认', status: '已完成', start: '2026-10-01 09:00', done: '2026-10-01 10:00' }, { name: '等待官方审核', status: '进行中', start: '2026-10-01 10:00' }]);
order(SOC, '', '待处理', '2026-10-02 09:00', [{ name: '方案确认', status: '待处理' }, { name: '收集公司资料', status: '待处理', assignee: B }]);
// 连着点完的步骤（1 分钟）：不进耗时
order(TM, 'tm-reg', '进行中', '2026-09-10 09:00', [{ name: '方案确认', status: '已完成', start: '2026-09-10 09:00', done: '2026-09-10 09:01' }, { name: '提交申请', status: '待处理', assignee: B }]);

const now = at('2026-10-15 12:00');
const sep = R.buildHandlingReport(db, '2026-09', now);

await check('9 月办完：商标 3 单 + 公司注册 1 单；跨月边界的那单算 10 月；取消的不算', () => {
  assert.equal(sep.summary.done, 4, JSON.stringify(sep.groups));
  const tm = sep.groups.find(g => g.group === '商标 · TM标注册')!;
  assert.equal(tm.done, 3);
  assert.ok(tm.medianDays != null && tm.medianDays > 5 && tm.medianDays < 12, String(tm.medianDays));
  const co = sep.groups.find(g => g.group.startsWith('公司注册'))!;
  assert.equal(co.done, 1); assert.equal(co.medianDays, null); assert.match(co.note, /共用一套流程/);
  const oct = R.buildHandlingReport(db, '2026-10', now);
  assert.equal(oct.groups.find(g => g.group === '社保开户')?.done, 1);
  assert.equal(sep.summary.cancelledTotal, 1);
});

await check('最慢的几步：样本够 5 个才列，几分钟内连着点完的不算', () => {
  const sub = sep.slowSteps.find(x => x.step === '提交申请');
  assert.ok(sub && sub.samples === 6, JSON.stringify(sep.slowSteps));
  assert.ok(!sep.slowSteps.some(x => x.step === '方案确认' && x.samples < 5));
  assert.ok(sep.summary.batchSteps >= 1);
});

await check('每人手上的单：按当前步骤算；外部等待、未指定单列；阻塞和没开始计数', () => {
  const a = sep.load.find(r => r.person === A)!;
  assert.equal(a.orders, 1); assert.equal(a.blocked, 1);
  assert.ok(sep.load.some(r => r.kind === 'external' && r.orders === 1), JSON.stringify(sep.load));
  assert.ok(sep.load.some(r => r.kind === 'unassigned' && r.orders === 1));   // 社保那单当前步是没指派的「方案确认」
  const b = sep.load.find(r => r.person === B)!;
  assert.equal(b.orders, 1); assert.equal(b.notStarted, 1);                   // 连着点完那单，B 的「提交申请」没开始
});

await check('超时：停在「提交申请」远超平时的单被列出；样本不够的步骤不判', () => {
  assert.ok(sep.overdue.some(r => r.orderId === stuck && r.step === '提交申请'), JSON.stringify(sep.overdue));
  assert.ok(!sep.overdue.some(r => r.step === '等待官方审核'));
  assert.equal(sep.summary.overdue, sep.overdue.length);
});

await check('流程清单：商标已核对客户名、FDA 代理原来客户看到「办理事项」现在是统一子标题、地址认证分两套、公司注册几种服务合并', () => {
  const list = buildWorkflowCatalog(db);
  const tm = list.find(e => e.business === '商标' && e.services.includes('TM标注册'))!;
  assert.ok(tm.reviewed); assert.equal(tm.steps[0].name, '方案确认'); assert.ok(tm.steps[0].locked);
  // 2026-10-20：流程设置显示客户实际看到的（统一子标题 + 说明）
  assert.equal(tm.steps.find(s => s.name === '收费开票')?.publicName, '收费与开票');
  assert.ok((tm.steps.find(s => s.name === '收费开票')?.publicDesc || '').length > 5);
  const agency = list.find(e => e.services.includes('FDA代理'))!;
  assert.ok(!agency.reviewed);
  assert.equal(agency.neutralSteps, 0, '2026-10-20 起有统一子标题，客户不再看到「办理事项」');
  assert.equal(agency.copiedSteps, agency.steps.length);
  assert.equal(list.filter(e => e.business === '地址认证').length, 2);
  const co = list.find(e => e.business === '公司注册' && e.services.includes('新公司注册'))!;
  assert.ok(co.services.includes('VAT注册') && co.services.length >= 4, co.services.join('/'));
  assert.ok(list.find(e => e.business === 'FDA认证' && e.services.includes('化妆品认证'))!.personNames.includes('Ing'));
});

// ---------- 复核后修的几处 ----------
await check('撤回后重新开始的步骤：从最近一次开始算，不会把刚撤回的单判成停了几十天', () => {
  // 「提交申请」9-01 开始、9-02 完成、10-15 09:00 被撤回（改回进行中）
  const id = order(TM, 'tm-reg', '进行中', '2026-09-01 09:00', [
    { name: '方案确认', status: '已完成', start: '2026-09-01 09:00', done: '2026-09-01 10:00' },
    { name: '提交申请', status: '进行中', assignee: A, start: '2026-09-01 10:00' },
  ]);
  const stepId = (db.prepare("SELECT id FROM order_steps WHERE order_id=? AND step_name='提交申请'").get(id) as { id: number }).id;
  db.prepare("INSERT INTO audit_logs (actor, action, target_type, target_id, detail, created_at) VALUES ('x','更新步骤:进行中','step',?,?,?)").run(String(stepId), `订单:${id}`, utc('2026-10-15 09:00'));
  const r = R.buildHandlingReport(db, '2026-10', at('2026-10-15 09:30'));
  assert.ok(!r.overdue.some(o => o.orderId === id), JSON.stringify(r.overdue));
  const a = r.load.find(x => x.person === A)!;
  assert.ok(a.longestDays >= 25, '卡住那单本来就停了很久'); // stuck 单仍在
});

await check('公司变更是自己的 4 步流程：照常算周期，不写「共用一套流程」', () => {
  for (let k = 0; k < 3; k++) order(CO, 'change', '已完成', `2026-09-0${1 + k} 09:00`, [
    { name: '方案确认', status: '已完成', start: `2026-09-0${1 + k} 09:00`, done: `2026-09-0${1 + k} 10:00` },
    { name: '递交官方办理变更', status: '已完成', assignee: A, start: `2026-09-0${1 + k} 10:00`, done: `2026-09-1${1 + k} 10:00` },
  ]);
  const g = R.buildHandlingReport(db, '2026-09', now).groups.find(x => x.group === '公司注册 · 公司变更')!;
  assert.equal(g.done, 3); assert.ok(g.medianDays != null); assert.doesNotMatch(g.note, /共用/);
});

await check('离职员工手上的单单独标出来要改派', () => {
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('Leaver', 'leaver@example.invalid', 'employee', 'x', 0, '离职')").run();
  order(SOC, '', '进行中', '2026-10-06 09:00', [{ name: '方案确认', status: '已完成', start: '2026-10-06 09:00', done: '2026-10-06 10:00' }, { name: '收集公司资料', status: '进行中', assignee: 'Leaver', start: '2026-10-06 10:00' }]);
  const r = R.buildHandlingReport(db, '2026-10', now);
  assert.ok(r.load.some(x => x.person === 'Leaver（离职，要改派）' && x.kind === 'other'), JSON.stringify(r.load.map(x => x.person)));
});

await check('流程清单：客户站/商城来的社保单（子服务 social-security）也算进「还在办」', () => {
  const before = buildWorkflowCatalog(db).find(e => e.business === '社保开户')!.inProgress;
  order(SOC, 'social-security', '进行中', '2026-10-07 09:00', [{ name: '方案确认', status: '进行中', start: '2026-10-07 09:00' }]);
  assert.equal(buildWorkflowCatalog(db).find(e => e.business === '社保开户')!.inProgress, before + 1);
});

await check('经办人不能指派给客户账号；只改经办人不再多记一条「已撤回」', async () => {
  const stepsRoute = await import('../src/app/api/orders/[id]/steps/route');
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('客户甲', 'clienta@example.invalid', 'client', 'x', 0, '在职')").run();
  const e = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='employee' AND status='在职' LIMIT 1").get() as { id: number; name: string; role: string; auth_version: number };
  db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(e.id);
  const token = await signToken({ id: e.id, name: e.name, role: 'employee', auth_version: e.auth_version, must_change_password: 0 });
  const oid = order(TM, 'tm-reg', '进行中', '2026-10-08 09:00', [{ name: '方案确认', status: '进行中', start: '2026-10-08 09:00' }, { name: '等待官方审核', status: '待处理' }]);
  const stepId = (db.prepare("SELECT id FROM order_steps WHERE order_id=? AND step_name='等待官方审核'").get(oid) as { id: number }).id;
  const patch = (assignee: string) => stepsRoute.PATCH(new NextRequest(`http://127.0.0.1/api/orders/${oid}/steps`, { method: 'PATCH', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ step_id: stepId, assignee }) }), { params: Promise.resolve({ id: oid }) });
  assert.equal((await patch('客户甲')).status, 400);
  assert.equal((await patch(B)).status, 200);
  const logs = (db.prepare("SELECT action FROM audit_logs WHERE target_type='step' AND target_id=?").all(String(stepId)) as { action: string }[]).map(l => l.action);
  assert.deepEqual(logs, ['修改负责人'], JSON.stringify(logs));
});

await check('只有管理员能看：员工、客户 403，管理员 200', async () => {
  const emp = (role: string) => db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role=? AND status='在职' LIMIT 1").get(role) as { id: number; name: string; role: string; auth_version: number };
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('测试客户', 'client@example.invalid', 'client', 'x', 0, '在职')").run();
  db.prepare('UPDATE employees SET must_change_password=0').run();
  const call = async (handler: (req: NextRequest) => Promise<Response>, role: string, url: string) => {
    const e = emp(role);
    const token = await signToken({ id: e.id, name: e.name, role: e.role as 'admin', auth_version: e.auth_version, must_change_password: 0 });
    return (await handler(new NextRequest(`http://127.0.0.1${url}`, { headers: { authorization: `Bearer ${token}` } }))) as Response;
  };
  for (const [h, url] of [[reportRoute.GET, '/api/internal/handling-report?month=2026-09'], [workflowRoute.GET, '/api/workflows']] as const) {
    assert.equal((await call(h, 'admin', url)).status, 200, url);
    assert.equal((await call(h, 'employee', url)).status, 403, url);
    assert.equal((await call(h, 'client', url)).status, 403, url);
  }
  assert.equal((await call(reportRoute.GET, 'admin', '/api/internal/handling-report?month=2026-13')).status, 400);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
