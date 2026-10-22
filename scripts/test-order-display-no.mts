/**
 * 订单编号跟业务系统一致（2026-10-22 老板：「要显示同一个号」「单号必须要对上」「单号不要-」）。
 * 用真的同步入口建业务系统的单，核对内部「订单管理」列表和订单详情给员工的编号：
 * 一张客户单只建一张内部单 → 内部编号本身就是业务系统单号；拆成几张 → 几张都显示业务系统单号、不加后缀；内部自己建的单还是内部编号；
 * 客户账号看到的不变。全部是临时目录里的合成库，不连外部地址。
 * Run (from this repo): node --import <tsx loader> scripts/test-order-display-no.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const dir = fs.mkdtempSync('/tmp/xt-order-display-no-');
delete process.env.CUSTOMER_SYNC_URL;
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), SYNC_SECRET: 'display-no-secret', JWT_SECRET: 'display-no-jwt' });
globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };
const [{ POST: syncPost }, listRoute, detailRoute, reportSearch, { getDb }, { signToken }] = await Promise.all([
  import('../src/app/api/sync/orders/route'), import('../src/app/api/orders/route'), import('../src/app/api/orders/[id]/route'), import('../src/app/api/work-reports/search/route'),
  import('../src/lib/db'), import('../src/lib/auth'),
]);
process.chdir(dir);
const db = getDb();
db.prepare('UPDATE employees SET must_change_password=0').run();
const admin = db.prepare("SELECT id, name, role, auth_version FROM employees WHERE role='admin' AND status='在职' ORDER BY id LIMIT 1").get() as { id: number; name: string; role: string; auth_version: number };
const token = await signToken({ id: admin.id, name: admin.name, role: 'admin', auth_version: admin.auth_version, must_change_password: 0 });

const buyer = { id: 'display-no-buyer', name: '演练客户', email: 'buyer@example.invalid' };
async function sync(no: string, lines: { qty: number; amount: number }[]) {
  const res = await syncPost(new NextRequest('http://fixture.invalid/api/sync/orders', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer display-no-secret' },
    body: JSON.stringify({ source: 'storefront', source_order_no: no, billing_revision: 1, ordered_at: '2026-10-22T00:00:00.000Z', currency: 'CNY',
      total_amount: lines.reduce((a, l) => a + l.amount, 0), discount: 0, customer: buyer,
      lines: lines.map((l, i) => ({ line_no: i + 1, sku_code: 'COM-001', sku_name: 'Synthetic service', quantity: l.qty, amount: l.amount })) }) }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
}
const internalIds = (no: string) => (db.prepare("SELECT internal_order_id FROM sync_inbox WHERE source_order_no=? AND internal_order_id IS NOT NULL ORDER BY line_no, copy_no").all(no) as { internal_order_id: string }[]).map(r => r.internal_order_id);
const list = async () => {
  const res = await listRoute.GET(new NextRequest('http://127.0.0.1/api/orders', { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(res.status, 200);
  return new Map((await res.json() as { id: string; display_no?: string }[]).map(o => [o.id, o.display_no]));
};
const detail = async (id: string) => {
  const res = await detailRoute.GET(new NextRequest(`http://127.0.0.1/api/orders/${id}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ id }) });
  assert.equal(res.status, 200);
  return (await res.json() as { display_no?: string }).display_no;
};

const results: { name: string; result: 'PASS' | 'FAIL'; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }

await sync('ORD20261022000000000001', [{ qty: 1, amount: 100 }]);
await sync('ORD20261022000000000002', [{ qty: 2, amount: 200 }, { qty: 1, amount: 50 }]);
const own = 'ORD-internal-display-check';
db.prepare("INSERT INTO orders(id,customer_name,business_type_id,status,description,total_amount,currency,created_at,updated_at) VALUES (?,?,1,'待处理','',0,'CNY',datetime('now'),datetime('now'))").run(own, '内部自建客户');

await test('a customer order that becomes one internal order: the internal order id IS the business-system number', async () => {
  const [id] = internalIds('ORD20261022000000000001');
  assert.equal(id, 'ORD20261022000000000001');
  assert.equal((await list()).get(id), 'ORD20261022000000000001');
  assert.equal(await detail(id), 'ORD20261022000000000001');
});

await test('a customer order split into several: every part shows the same business-system number, no suffix', async () => {
  const ids = internalIds('ORD20261022000000000002');
  assert.equal(ids.length, 3);
  assert.ok(ids.every(id => id.startsWith('ORD-')), 'split parts keep separate internal ids underneath');
  const l = await list();
  assert.deepEqual(ids.map(id => l.get(id)), Array(3).fill('ORD20261022000000000002'));
  for (const id of ids) assert.equal(await detail(id), 'ORD20261022000000000002');
});

await test('numbers stay the same when the customer site sends a later billing revision', async () => {
  const res = await syncPost(new NextRequest('http://fixture.invalid/api/sync/orders', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer display-no-secret' },
    body: JSON.stringify({ source: 'storefront', source_order_no: 'ORD20261022000000000002', billing_revision: 2, ordered_at: '2026-10-22T00:00:00.000Z', currency: 'CNY',
      total_amount: 250, discount: 10, customer: buyer,
      lines: [{ line_no: 1, sku_code: 'COM-001', sku_name: 'Synthetic service', quantity: 2, amount: 200 }, { line_no: 2, sku_code: 'COM-001', sku_name: 'Synthetic service', quantity: 1, amount: 50 }] }) }));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));
  const l = await list();
  assert.deepEqual(internalIds('ORD20261022000000000002').map(id => l.get(id)), Array(3).fill('ORD20261022000000000002'));
  assert.equal(internalIds('ORD20261022000000000001')[0], 'ORD20261022000000000001');
});

await test('daily-report order search finds orders by the business-system number and titles them with it', async () => {
  const res = await reportSearch.GET(new NextRequest(`http://127.0.0.1/api/work-reports/search?type=order&q=${encodeURIComponent('ORD20261022000000000002')}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal(res.status, 200);
  const titles = (await res.json() as { title: string }[]).map(r => r.title);
  assert.equal(titles.length, 3);
  assert.equal(new Set(titles).size, 3, 'split parts can be told apart: ' + titles.join(' / '));
  assert.ok(titles.every((t, i) => t.startsWith('订单 ORD20261022000000000002（') && t.endsWith(`第${i + 1}份）`)), titles.join(' / '));
  const one = await reportSearch.GET(new NextRequest(`http://127.0.0.1/api/work-reports/search?type=order&q=${encodeURIComponent('ORD20261022000000000001')}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.deepEqual((await one.json() as { title: string; id: string }[]).map(r => [r.title, r.id]), [['订单 ORD20261022000000000001', 'ORD20261022000000000001']]);
});

await test('spot orders (SPOT-…) keep the business-system number including its own dash', async () => {
  await sync('SPOT-20261022-XYZ', [{ qty: 1, amount: 100 }]);
  assert.deepEqual(internalIds('SPOT-20261022-XYZ'), ['SPOT-20261022-XYZ']);
});

await test('daily-report search lists every part of a customer order split into more than 200', async () => {
  await sync('ORD20261022000000000005', [{ qty: 205, amount: 20500 }]);
  const res = await reportSearch.GET(new NextRequest(`http://127.0.0.1/api/work-reports/search?type=order&q=${encodeURIComponent('ORD20261022000000000005')}`, { headers: { authorization: `Bearer ${token}` } }));
  const titles = (await res.json() as { title: string }[]).map(r => r.title);
  assert.equal(titles.length, 205);
  assert.equal(titles[204], '订单 ORD20261022000000000005（' + titles[204].split('（')[1]);
  assert.ok(titles[204].endsWith('第205份）'));
  const lower = await reportSearch.GET(new NextRequest(`http://127.0.0.1/api/work-reports/search?type=order&q=${encodeURIComponent('ord20261022000000000005')}`, { headers: { authorization: `Bearer ${token}` } }));
  assert.equal((await lower.json() as unknown[]).length, 205, 'case does not matter');
});

await test('orders created inside the internal system keep their own number', async () => {
  assert.equal((await list()).get(own), own);
  assert.equal(await detail(own), own);
});

for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
else fs.rmSync(dir, { recursive: true, force: true });
process.exit();
