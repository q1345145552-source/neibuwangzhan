/**
 * 流程设置第 2、3 期 + 订单提醒（2026-10-16）：导入前后建单一模一样、发布/退回、新单记下天数和版本、
 * 超时现场算和提醒、证书到期 60/30 天提醒、只有管理员能删单。临时库，不连外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-workflow-<新目录>/x.db node --import <tsx loader> scripts/test-workflow-settings.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-workflow-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-workflow-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'workflow-settings-regression-jwt';
process.env.CUSTOMER_SYNC_URL = ''; process.env.SYNC_SECRET = '';
const { getDb, getOrderStepsWithDocs, getLegacyOrderStepsWithDocs, templateSignature } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const { combosOf, buildWorkflowCatalog } = await import('../src/lib/workflow-catalog');
const { publicStepNames } = await import('../src/lib/commerce-fulfillment');
const wfRoute = await import('../src/app/api/workflows/route');
const importRoute = await import('../src/app/api/workflows/import/route');
const publishRoute = await import('../src/app/api/workflows/[id]/publish/route');
const rollbackRoute = await import('../src/app/api/workflows/[id]/rollback/route');
const ordersRoute = await import('../src/app/api/orders/route');
const orderRoute = await import('../src/app/api/orders/[id]/route');
const { currentStepTimings } = await import('../src/lib/step-overdue');
const { runStepOverdueReminders, runCertificateExpiryReminders } = await import('../src/lib/order-reminders');
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
const bts = db.prepare('SELECT id, name FROM business_types ORDER BY id').all() as { id: number; name: string }[];
const allCombos = bts.flatMap(bt => combosOf(bt).map(c => ({ bt: bt.id, sub: c.sub, addr: c.addr })));
const sameAsLegacy = () => allCombos.every(c => templateSignature(getOrderStepsWithDocs(c.bt, c.sub || undefined, c.addr || undefined)) === templateSignature(getLegacyOrderStepsWithDocs(c.bt, c.sub || undefined, c.addr || undefined)));
const TM = (db.prepare("SELECT id FROM business_types WHERE name='商标'").get() as { id: number }).id;
const tmLegacy = getLegacyOrderStepsWithDocs(TM, 'tm-reg');
const tmPublic = publicStepNames(tmLegacy.map(s => s.name));

await check('导入前：系统里没有流程，建单照旧用程序里的；只有管理员能导入', async () => {
  assert.ok(sameAsLegacy());
  const r = await call(wfRoute.GET as never, admin, 'GET', '/api/workflows');
  assert.equal(r.json.imported, false);
  assert.equal((await call(importRoute.POST as never, A, 'POST', '/api/workflows/import', {})).status, 403);
});

let templateId = 0;
await check('导入：每套流程存成第 1 版，导入后每个组合读出来跟程序里一模一样；再导一次不重复', async () => {
  const r = await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', {});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(r.json.imported > 10 && r.json.imported === r.json.total, JSON.stringify(r.json));
  assert.ok(sameAsLegacy());
  const again = await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', {});
  assert.equal(again.json.imported, 0);
  const entry = buildWorkflowCatalog(db).find(e => e.business === '商标' && e.services.includes('TM标注册'))!;
  assert.ok(entry.templateId && entry.version === 1);
  templateId = entry.templateId!;
  assert.deepEqual(publicStepNames(getOrderStepsWithDocs(TM, 'tm-reg').map(s => s.name)), tmPublic, '客户看到的步骤名不变');
});

const editsFrom = (tpl: ReturnType<typeof getOrderStepsWithDocs>) => tpl.map((s, i) => ({ step_order: i + 1, assignee: s.assignee, notes: s.notes || '', docs: s.docs, expected_days: s.expected_days ?? null }));
await check('发布：能改经办人/天数/备注/资料；增删步骤、经办人填非员工、天数不按半天、改第一步、没改动都被拦', async () => {
  const base = editsFrom(getOrderStepsWithDocs(TM, 'tm-reg'));
  const pub = (steps: unknown, who = admin) => call(publishRoute.POST as never, who, 'POST', `/api/workflows/${templateId}/publish`, { steps, note: '测试' }, String(templateId));
  assert.equal((await pub(base, A)).status, 403);
  assert.equal((await pub(base.slice(1))).status, 400);
  assert.equal((await pub(base.map((s, i) => i === 1 ? { ...s, assignee: '不存在的人' } : s))).status, 400);
  assert.equal((await pub(base.map((s, i) => i === 1 ? { ...s, expected_days: 0.3 } : s))).status, 400);
  assert.equal((await pub(base.map((s, i) => i === 0 ? { ...s, assignee: B.name } : s))).status, 400);
  assert.equal((await pub(base)).status, 400, '没改动不用发布');
  const ok = await pub(base.map((s, i) => i === 1 ? { ...s, assignee: B.name, expected_days: 3, docs: [...s.docs, '新加的文件'], notes: '新备注' } : s));
  assert.equal(ok.status, 200, JSON.stringify(ok.json)); assert.equal(ok.json.version, 2);
  const now = getOrderStepsWithDocs(TM, 'tm-reg');
  assert.deepEqual([now[1].assignee, now[1].expected_days, now[1].notes, now[1].docs.includes('新加的文件')], [B.name, 3, '新备注', true]);
  assert.deepEqual(now.map(s => s.name), tmLegacy.map(s => s.name), '步骤名和顺序不变');
});

let newOrder = '';
await check('发布后新建的单按新版本（经办人、天数、资料、版本号都记下）；老单不跟着变', async () => {
  const before = order(TM, 'tm-reg', '老单客户', A.name);
  const r = await call(ordersRoute.POST as never, A, 'POST', '/api/orders', { customer_name: '新单客户', business_type_id: TM, sub_service_type: 'tm-reg', responsible_person: A.name });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  newOrder = r.json.id;
  const st = db.prepare('SELECT step_name, assignee, expected_days, template_version_id FROM order_steps WHERE order_id=? ORDER BY step_order').all(newOrder) as { step_name: string; assignee: string; expected_days: number | null; template_version_id: number | null }[];
  assert.equal(st[1].assignee, B.name); assert.equal(st[1].expected_days, 3); assert.ok(st[1].template_version_id);
  const docs = (db.prepare('SELECT document_name FROM step_documents WHERE order_id=?').all(newOrder) as { document_name: string }[]).map(d => d.document_name);
  assert.ok(docs.includes('新加的文件'));
  const old = db.prepare('SELECT assignee, expected_days FROM order_steps WHERE order_id=? AND step_order=2').get(before) as { assignee: string; expected_days: number | null };
  assert.equal(old.assignee, tmLegacy[1].assignee); assert.equal(old.expected_days, null);
});

function order(bt: number, sub: string, customer: string, owner: string) {
  const id = `ORD-W${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO orders (id, customer_name, business_type_id, sub_service_type, status, responsible_person) VALUES (?,?,?,?,?,?)").run(id, customer, bt, sub, '进行中', owner);
  getLegacyOrderStepsWithDocs(bt, sub).forEach((s, i) => db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status, assignee) VALUES (?,?,?,?,?)").run(id, s.name, i + 1, i === 0 ? '已完成' : '待处理', s.assignee));
  return id;
}

await check('超时：当前这一步超过设定的工作日就算超时；提醒经办人和负责人一次，不重复；列表和月报都标出来', async () => {
  const tenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("UPDATE order_steps SET status='已完成', completed_at=? WHERE order_id=? AND step_order=1").run(tenDaysAgo, newOrder);
  db.prepare("UPDATE order_steps SET status='进行中', started_at=? WHERE order_id=? AND step_order=2").run(tenDaysAgo, newOrder);
  const t = currentStepTimings(db, new Date()).find(x => x.orderId === newOrder)!;
  assert.ok(t.overdue && t.expectedDays === 3 && t.elapsedDays > 3, JSON.stringify(t));
  const before = (db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE title='步骤超时' AND related_id=?").get(newOrder) as { c: number }).c;
  runStepOverdueReminders(db);
  const got = db.prepare("SELECT recipient, body FROM notifications WHERE title='步骤超时' AND related_id=?").all(newOrder) as { recipient: string; body: string }[];
  assert.deepEqual(got.slice(before).map(n => n.recipient).sort(), [A.name, B.name].sort(), JSON.stringify(got));
  assert.match(got[got.length - 1].body, /超过设定的 3 天/);
  runStepOverdueReminders(db);
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE title='步骤超时' AND related_id=?").get(newOrder) as { c: number }).c, got.length, '同一轮不重复');
  const list = (await call(ordersRoute.GET as never, A, 'GET', '/api/orders')).json as { id: string; progress: { overdue: { expected: number } | null } }[];
  assert.equal(list.find(o => o.id === newOrder)!.progress.overdue!.expected, 3);
  const report = buildHandlingReport(db, new Date().toISOString().slice(0, 7), new Date());
  assert.ok(report.overdue.some(r => r.orderId === newOrder && r.bySetting && r.normalDays === 3), JSON.stringify(report.overdue));
});

await check('在办的老单建单时没记天数：不按现在设的天数算超时（老单不跟着流程变，也免得一下子刷屏）', async () => {
  const old = order(TM, 'tm-reg', '老单客户二', A.name);
  const tenDaysAgo = new Date(Date.now() - 14 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("UPDATE order_steps SET completed_at=? WHERE order_id=? AND step_order=1").run(tenDaysAgo, old);
  const t = currentStepTimings(db, new Date()).find(x => x.orderId === old)!;
  assert.equal(t.expectedDays, null); assert.equal(t.overdue, false);
});

await check('两个人同时改：页面打开时的版本跟现在不一样，发布和退回都被拦（409），不会互相盖掉', async () => {
  const cur = (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
  const base = editsFrom(getOrderStepsWithDocs(TM, 'tm-reg'));
  const stale = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/publish`, { steps: base.map((s, i) => i === 2 ? { ...s, notes: 'x' } : s), note: '', base_version_id: cur - 1 }, String(templateId));
  assert.equal(stale.status, 409, JSON.stringify(stale.json)); assert.match(stale.json.error, /别人刚改过/);
  const v1 = (db.prepare('SELECT id FROM workflow_template_versions WHERE template_id=? AND version=1').get(templateId) as { id: number }).id;
  const staleRb = await call(rollbackRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/rollback`, { version_id: v1, base_version_id: cur - 1 }, String(templateId));
  assert.equal(staleRb.status, 409);
});

await check('已离职的人不能当默认经办人：原值是离职员工的要先换人才能发布；下拉只列在岗的（试用期、待离职也算）', async () => {
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('走了的人','gone@example.invalid','employee','x',0,'离职')").run();
  db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('试用的人','trial@example.invalid','employee','x',0,'试用期')").run();
  const cur = (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
  const base = editsFrom(getOrderStepsWithDocs(TM, 'tm-reg'));
  const toGone = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/publish`, { steps: base.map((s, i) => i === 2 ? { ...s, assignee: '走了的人' } : s), base_version_id: cur }, String(templateId));
  assert.equal(toGone.status, 400);
  // 模拟原值就是离职的人（以前设的，后来人走了）
  db.prepare("UPDATE workflow_template_steps SET assignee='走了的人' WHERE version_id=? AND step_order=3").run(cur);
  const keep = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/publish`, { steps: editsFrom(getOrderStepsWithDocs(TM, 'tm-reg')).map((s, i) => i === 1 ? { ...s, notes: '改个备注' } : s), base_version_id: cur }, String(templateId));
  assert.equal(keep.status, 400); assert.match(keep.json.error, /走了的人 已经不在岗/);
  const ok = await call(publishRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/publish`, { steps: editsFrom(getOrderStepsWithDocs(TM, 'tm-reg')).map((s, i) => i === 2 ? { ...s, assignee: '试用的人' } : s), base_version_id: cur }, String(templateId));
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const list = (await call(wfRoute.GET as never, admin, 'GET', '/api/workflows')).json as { staff: string[]; gone: string[] };
  assert.ok(list.staff.includes('试用的人') && !list.staff.includes('走了的人') && list.gone.includes('走了的人'));
});

await check('退回：把第 1 版原样再发布成新版本，建单回到程序里的样子', async () => {
  const versions = db.prepare('SELECT id, version FROM workflow_template_versions WHERE template_id=? ORDER BY version').all(templateId) as { id: number; version: number }[];
  const cur = (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
  const r = await call(rollbackRoute.POST as never, admin, 'POST', `/api/workflows/${templateId}/rollback`, { version_id: versions[0].id, base_version_id: cur }, String(templateId));
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.version, versions.length + 1);
  assert.equal(templateSignature(getOrderStepsWithDocs(TM, 'tm-reg')), templateSignature(tmLegacy));
  assert.equal(getOrderStepsWithDocs(TM, 'tm-reg')[1].expected_days, null);
});

await check('安全闸：系统里的步骤名跟程序里对不上时，照旧用程序里的', () => {
  const cur = (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
  db.prepare("UPDATE workflow_template_steps SET name='被改坏的名字' WHERE version_id=? AND step_order=2").run(cur);
  assert.equal(getOrderStepsWithDocs(TM, 'tm-reg')[1].name, tmLegacy[1].name);
  db.prepare('UPDATE workflow_template_steps SET name=? WHERE version_id=? AND step_order=2').run(tmLegacy[1].name, cur);
});

await check('超时没人接手（没写经办人和负责人）：改发管理员、写明没人接手；补了负责人不会因为占了名额而漏发', () => {
  const o = order(TM, 'tm-reg', '没人管客户', '');
  const old = new Date(Date.now() - 14 * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare("UPDATE order_steps SET completed_at=? WHERE order_id=? AND step_order=1").run(old, o);
  db.prepare("UPDATE order_steps SET assignee='', expected_days=2 WHERE order_id=? AND step_order=2").run(o);
  runStepOverdueReminders(db);
  const got = db.prepare("SELECT recipient, body FROM notifications WHERE title='步骤超时' AND related_id=?").all(o) as { recipient: string; body: string }[];
  const admins = (db.prepare("SELECT DISTINCT name FROM employees WHERE role='admin' AND status='在职' AND name<>''").all() as { name: string }[]).map(r => r.name);
  assert.deepEqual(got.map(n => n.recipient).sort(), admins.sort());
  assert.match(got[0].body, /没人接手/);
});

await check('程序里改过一套流程（指纹变了）：页面列为「不在系统里」，再导入就补进来，以前设的天数带过去', async () => {
  // 模拟：系统里这套流程是按旧指纹存的，程序里已经改了（指纹对不上）
  const cur = (db.prepare('SELECT current_version_id AS v FROM workflow_templates WHERE id=?').get(templateId) as { v: number }).v;
  db.prepare('UPDATE workflow_template_steps SET expected_days=4 WHERE version_id=? AND step_order=2').run(cur);
  db.prepare("UPDATE workflow_templates SET legacy_signature = legacy_signature || ' 旧' WHERE id=?").run(templateId);
  const before = (await call(wfRoute.GET as never, admin, 'GET', '/api/workflows')).json as { entries: { business: string; services: string[]; templateId: number | null }[] };
  assert.equal(before.entries.find(e => e.business === '商标' && e.services.includes('TM标注册'))!.templateId, null);
  const r = await call(importRoute.POST as never, admin, 'POST', '/api/workflows/import', {});
  assert.equal(r.json.imported, 1, JSON.stringify(r.json));
  assert.equal(getOrderStepsWithDocs(TM, 'tm-reg')[1].expected_days, 4, '天数带过来了');
  assert.equal(getOrderStepsWithDocs(TM, 'tm-reg')[1].assignee, tmLegacy[1].assignee, '经办人用程序里现在的');
});

await check('当前步骤口径：公司变更按顺序走；公司注册一步都没开始时算第一个没办完的（列表、超时、月报一致）', () => {
  const CO = (db.prepare("SELECT id FROM business_types WHERE name='公司注册'").get() as { id: number }).id;
  const o = order(CO, 'company-reg', '公司注册客户', A.name);
  const t = currentStepTimings(db, new Date()).filter(x => x.orderId === o);
  assert.equal(t.length, 1); assert.equal(t[0].stepName, getLegacyOrderStepsWithDocs(CO, 'company-reg')[1].name);
});

await check('证书快到期：到期前 60 天、30 天各提醒一次负责人并抄送管理员；已过期、已取消的单不提醒', () => {
  const o = order(TM, 'tm-reg', '证书客户', A.name);
  const cert = Number(db.prepare("INSERT INTO certificates (order_id, certificate_number, expiry_date) VALUES (?, 'TM-001', '2027-01-30')").run(o).lastInsertRowid);
  const sent = () => db.prepare("SELECT recipient, body FROM notifications WHERE title='证书快到期' AND related_id=?").all(o) as { recipient: string; body: string }[];
  runCertificateExpiryReminders(db, '2026-11-15'); // 还剩 76 天：不提醒
  assert.equal(sent().length, 0);
  runCertificateExpiryReminders(db, '2026-12-10'); // 还剩 51 天：第一次
  const admins = (db.prepare("SELECT DISTINCT name FROM employees WHERE role='admin' AND status='在职' AND name<>''").all() as { name: string }[]).map(r => r.name);
  const first = sent();
  assert.deepEqual(first.map(n => n.recipient).sort(), [...new Set([A.name, ...admins])].sort());
  assert.match(first[0].body, /TM-001.*2027-01-30 到期，还剩 51 天/);
  runCertificateExpiryReminders(db, '2026-12-12');
  assert.equal(sent().length, first.length, '60 天那次只发一次');
  runCertificateExpiryReminders(db, '2027-01-05'); // 还剩 25 天：第二次
  assert.equal(sent().length, first.length * 2);
  runCertificateExpiryReminders(db, '2027-02-01'); // 过期了
  assert.equal(sent().length, first.length * 2);
  const c2 = order(TM, 'tm-reg', '取消客户', A.name);
  db.prepare("UPDATE orders SET status='客户取消' WHERE id=?").run(c2);
  db.prepare("INSERT INTO certificates (order_id, certificate_number, expiry_date) VALUES (?, 'TM-002', '2027-01-30')").run(c2);
  runCertificateExpiryReminders(db, '2027-01-05');
  assert.equal((db.prepare("SELECT COUNT(*) AS c FROM notifications WHERE title='证书快到期' AND related_id=?").get(c2) as { c: number }).c, 0);
  void cert;
});

await check('只有管理员能删订单：员工 403，管理员可以', async () => {
  const o = order(TM, 'tm-reg', '删单客户', A.name);
  const r = await call(orderRoute.DELETE as never, A, 'DELETE', `/api/orders/${o}`, undefined, o);
  assert.equal(r.status, 403); assert.match(r.json.error, /只有管理员/);
  assert.equal((await call(orderRoute.DELETE as never, admin, 'DELETE', `/api/orders/${o}`, undefined, o)).status, 200);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
