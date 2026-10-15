/**
 * 消息中心要能看到客户站来的订单提醒（2026-10-15）：10-08 去掉旧通知中心、10-10 消息中心只认 6 种类型后，
 * order-alerts.ts 写的客户站新订单 / 待分类待领取 / 客户提交了资料 / 客户申请取消（type 为空）列表和角标都看不到。
 * 这里验证：四类提醒进列表、算进未读角标、点开能找到内部办理单；其它空类型和请假类照旧不显示；客户账号照旧 403。
 * 临时库，不连任何外部地址。
 * Run: NODE_ENV=test DB_PATH=/tmp/xt-msgcenter-<新目录>/x.db node --import <tsx loader> scripts/test-message-center-sync-alerts.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

if (process.env.NODE_ENV !== 'test' || !/^\/(?:private\/)?tmp\/xt-msgcenter-[^/]+\/x\.db$/.test(process.env.DB_PATH || '') || fs.existsSync(process.env.DB_PATH!)) {
  throw new Error('需要 NODE_ENV=test 和一个还不存在的 /tmp/xt-msgcenter-<新目录>/x.db');
}
process.env.JWT_SECRET ||= 'msgcenter-regression-jwt';
const { getDb } = await import('../src/lib/db');
const { signToken } = await import('../src/lib/auth');
const alerts = await import('../src/lib/order-alerts');
const listRoute = await import('../src/app/api/notifications/route');
const countRoute = await import('../src/app/api/notifications/unread-count/route');
const db = getDb();

type Emp = { id: number; name: string; role: string; auth_version: number };
const staff = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='employee' AND status='在职' LIMIT 1").get() as Emp;
const admin = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='admin' AND status='在职' LIMIT 1").get() as Emp;
db.prepare("INSERT INTO employees (name, email, role, password, must_change_password, status) VALUES ('测试客户', 'client@example.invalid', 'client', 'x', 0, '在职')").run();
const client = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE email='client@example.invalid'").get() as Emp;
db.prepare('UPDATE employees SET must_change_password=0 WHERE id IN (?, ?, ?)').run(staff.id, admin.id, client.id);
const token = (e: Emp) => signToken({ id: e.id, name: e.name, role: e.role, auth_version: e.auth_version, must_change_password: 0 });

// 一张内部办理单 + 客户站单号到它的对应关系
const bt = db.prepare('SELECT id FROM business_types ORDER BY id LIMIT 1').get() as { id: number };
db.prepare("INSERT INTO orders (id, customer_name, business_type_id) VALUES ('ORD-internal-1', '测试客户公司', ?)").run(bt.id);
db.prepare("INSERT INTO sync_inbox (id, source_order_no, line_no, copy_no, internal_order_id, payload) VALUES ('in-1', 'ORD20261012TEST', 1, 1, 'ORD-internal-1', '{}')").run();

alerts.notifyNewSyncedOrder(db, 'ORD20261012TEST', '客户站新订单 ORD20261012TEST（测试客户）：零申报做账');
alerts.notifyUnclassifiedOrder(db, 'ORD20261012TEST', '客户站同步单 ORD20261012TEST 待确认归属');
alerts.notifyCustomerDocuments(db, 'ORD20261012TEST', '客户交了营业执照');
alerts.notifyCancelRequest(db, 'ORD-internal-1', '客户申请取消零申报做账');
// 不该出现在消息中心的：别的空类型提醒、请假类
db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('', '其它旧提醒', 'x', ?, '1', 'misc')").run(staff.name);
db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES ('leave_requested', '请假申请', 'x', ?, '1', 'leave')").run(staff.name);

const call = async (handler: Function, who: Emp, url: string) => {
  const req = new NextRequest(`http://127.0.0.1${url}`, { method: 'GET', headers: { authorization: `Bearer ${await token(who)}` } });
  return handler(req) as Promise<Response>;
};

let pass = 0, fail = 0;
async function check(name: string, fn: () => Promise<void>) {
  try { await fn(); pass++; console.log('PASS', name); } catch (e) { fail++; console.log('FAIL', name, '-', String(e).split('\n')[0]); }
}

await check('员工能在消息中心看到客户站新订单、待分类、交资料三类（取消只发管理员）', async () => {
  const r = await call(listRoute.GET, staff, '/api/notifications');
  assert.equal(r.status, 200);
  const titles = (await r.json() as { title: string }[]).map(n => n.title).sort();
  assert.deepEqual(titles, ['客户提交了资料', '客户站新订单', '待分类订单待领取'].sort());
});

await check('管理员四类都能看到，且都能找到内部办理单', async () => {
  const rows = await (await call(listRoute.GET, admin, '/api/notifications')).json() as { title: string; order_id: string | null }[];
  const mine = rows.filter(n => ['客户站新订单', '待分类订单待领取', '客户提交了资料', '客户申请取消'].includes(n.title));
  assert.equal(mine.length, 4, JSON.stringify(rows.map(n => n.title)));
  for (const n of mine) assert.equal(n.order_id, 'ORD-internal-1', `${n.title} → ${n.order_id}`);
});

await check('侧栏未读角标与列表口径一致（不算其它空类型和请假类）', async () => {
  const c = await (await call(countRoute.GET, staff, '/api/notifications/unread-count')).json() as { count: number };
  assert.equal(c.count, 3);
});

await check('客户账号照旧看不到消息中心', async () => {
  assert.equal((await call(listRoute.GET, client, '/api/notifications')).status, 403);
  assert.equal((await call(countRoute.GET, client, '/api/notifications/unread-count')).status, 403);
});

console.log(`SUMMARY ${pass}/${pass + fail} passed`);
process.exitCode = fail ? 1 : 0;
