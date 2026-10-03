/**
 * 客户站同步单：9-22 裁决 SKU 的去向 + 回传给客户的步骤名（2026-10-03）。
 * Isolated: NODE_ENV=test DB_PATH must point to a new /tmp/xt-sync-fix-* file; network disabled.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NextRequest } from 'next/server';

async function main() {
  const dbPath = process.env.DB_PATH;
  assert(typeof dbPath === 'string' && dbPath.startsWith('/tmp/xt-sync-fix-'), 'Use a new /tmp/xt-sync-fix-* DB_PATH');
  assert(!fs.existsSync(dbPath), 'Refusing to reuse a database');
  delete process.env.CUSTOMER_SYNC_URL;
  process.env.SYNC_SECRET = 'local-regression-secret';
  process.env.JWT_SECRET = 'local-regression-jwt';
  globalThis.fetch = async () => { throw new Error('NETWORK_DISABLED_IN_REGRESSION'); };
  const [{ POST }, { getDb, getOrderStepsWithDocs }, { queueProgressEventsForOrder }, notifications, { signToken }, externalDetail, orderDetail] = await Promise.all([
    import('../src/app/api/sync/orders/route'), import('../src/lib/db'), import('../src/lib/progress-sync'),
    import('../src/app/api/notifications/route'), import('../src/lib/auth'),
    import('../src/app/api/external/orders/[id]/route'), import('../src/app/api/orders/[id]/route'),
  ]);
  const [stepRoute, { commerceWorkflow }] = await Promise.all([
    import('../src/app/api/orders/[id]/steps/route'), import('../src/lib/commerce-fulfillment'),
  ]);
  const db = getDb();
  db.prepare("INSERT INTO employees(name,email,role,password,status) VALUES ('LEFT_STAFF','left@example.invalid','employee','x','离职')").run();
  const activeStaff = (db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND status='在职' AND name<>''").all() as { name: string }[]).map(r => r.name).sort();
  const UNCLASSIFIED = '待分类订单待领取';
  const recipients = (no: string, title: string) => (db.prepare('SELECT recipient FROM notifications WHERE related_id=? AND title=? ORDER BY recipient').all(no, title) as { recipient: string }[]).map(r => r.recipient);
  const buyer = { id: 'buyer-public-steps', name: 'SYNTHETIC_BUYER', email: 'buyer@example.invalid' };
  let serial = 0;
  function payload(no: string, skus: string[], source = 'storefront') {
    return { source, source_order_no: no, billing_revision: 1, ordered_at: '2026-10-03T00:00:00.000Z',
      currency: 'CNY', total_amount: 100 * skus.length, discount: 0, customer: buyer,
      lines: skus.map((sku, i) => ({ line_no: i + 1, sku_code: sku, sku_name: `Synthetic ${sku}`, quantity: 1, amount: 100 })) };
  }
  async function send(body: unknown) {
    const response = await POST(new NextRequest('http://fixture.invalid/api/sync/orders', { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer local-regression-secret',
    }, body: JSON.stringify(body) }));
    const json = await response.json();
    assert.equal(response.status, 200, JSON.stringify(json));
    return json;
  }
  const countAlerts = (no: string, title: string) =>
    (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE related_id=? AND title=?').get(no, title) as { n: number }).n;
  async function order(sku: string) {
    const no = `PUB-${++serial}-${sku}`;
    const json = await send(payload(no, [sku]));
    const orderId = json.results[0].order_id as string;
    const row = db.prepare(`SELECT bt.name AS business, o.sub_service_type AS sub, o.address_type AS address FROM orders o
      JOIN business_types bt ON bt.id=o.business_type_id WHERE o.id=?`).get(orderId) as { business: string; sub: string; address: string };
    const steps = (db.prepare('SELECT step_name FROM order_steps WHERE order_id=? ORDER BY step_order').all(orderId) as { step_name: string }[]).map(s => s.step_name);
    return { no, orderId, ...row, steps, alerts: countAlerts(no, UNCLASSIFIED), published: () => latestPublished(orderId) };
  }
  function latestPublished(orderId: string): string[] {
    const row = db.prepare(`SELECT p.payload FROM sync_progress_outbox p JOIN sync_inbox i ON i.id=p.inbox_id
      WHERE i.internal_order_id=? ORDER BY p.rowid DESC LIMIT 1`).get(orderId) as { payload: string };
    return (JSON.parse(row.payload).steps as { step_name: string }[]).map(s => s.step_name);
  }
  // 内部步骤名里出现过的员工名/合作方/内部金额字样（取自 db.ts 现有模板）
  const internalMarkers = /Bam|Pop|Ing[^a-z]|Fern|K\.Fai|Khun|Next|泰铢|代办收|公司代考|确认归属并派单/;

  const results: { name: string; result: string; error?: string }[] = [];
  async function test(name: string, fn: () => Promise<void>) {
    try { await fn(); results.push({ name, result: 'PASS' }); }
    catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); }
  }

  // 期望去向按 2026-09-22 裁决逐条写（不从映射表反推）
  const decided: [string[], string, string, string][] = [
    [['COM-005','COM-006','COM-007','COM-008','COM-009','COM-010','COM-011','COM-012','COM-013'], '公司注册', 'change', 'client'],
    [['COM-018','COM-019'], '公司注册', 'address', 'client'],
    [['OTH-003','OTH-004','OTH-005','OTH-006'], '地址认证', '', 'xiangtai'],
    [['PLA-004','PLA-005','PLA-006'], 'Mall开店', 'enterprise', 'client'],
    [['TRA-008'], '商标', 'buy-r', 'client'],
    [['OTH-013'], 'FDA认证', 'food', 'client'],
  ];
  await test('20 decided SKUs route to their business line, not 待分类, without unclassified alerts', async () => {
    let count = 0;
    for (const [skus, business, sub, address] of decided) for (const sku of skus) {
      const o = await order(sku); count++;
      assert.deepEqual([o.business, o.sub, o.address], [business, sub, address], sku);
      assert.equal(o.alerts, 0, `${sku} should not raise a 待分类 alert`);
    }
    assert.equal(count, 20);
  });
  await test('场地认证 gets the xiangtai branch with the two lease steps', async () => {
    const o = await order('OTH-003');
    assert.equal(o.steps.length, 19);
    assert(o.steps.includes('签订租赁合同') && o.steps.includes('收取首月租金'));
  });
  await test('previously mapped SKUs unchanged', async () => {
    for (const [sku, business, sub] of [['COM-001','公司注册','company-reg'],['TRA-001','商标',''],['PLA-001','Mall开店','shopee'],['OTH-001','TISI','tisi-main']]) {
      const o = await order(sku);
      assert.deepEqual([o.business, o.sub, o.address], [business, sub, 'client'], sku);
    }
  });
  await test('unknown SKU still lands in 待分类; every active staff member gets one 待领取 reminder', async () => {
    const o = await order('TAX-005');
    assert.equal(o.business, '待分类');
    assert.deepEqual(recipients(o.no, UNCLASSIFIED), activeStaff);
    assert(!recipients(o.no, UNCLASSIFIED).includes('') && !recipients(o.no, UNCLASSIFIED).includes('LEFT_STAFF'));
    assert.deepEqual(o.published(), ['方案确认', '确认服务归属', '办理并交付']);
  });
  await test('customer never receives internal staff names, partners or internal amounts', async () => {
    const skus = ['COM-001','TRA-001','TAX-003','PLA-001','PLA-002','PLA-003','TM-PH','OTH-002','CERT-NBTC','OTH-001',
      'FDA-COS-PROD','FDA-FOOD-PROD','FDA-HAZ-PROD','FDA-MED-PROD', ...decided.flatMap(d => d[0])];
    let leakyInternalSteps = 0;
    for (const sku of skus) {
      const o = await order(sku);
      const published = o.published();
      assert.equal(published.length, o.steps.length, sku);
      assert(!published.includes('办理事项'), `${sku}: reviewed template should map every step`);
      for (const name of published) assert(!internalMarkers.test(name), `${sku} leaked: ${name}`);
      leakyInternalSteps += o.steps.filter(name => internalMarkers.test(name)).length;
    }
    assert(leakyInternalSteps > 10, 'fixture must actually contain internal-only step names');
  });
  await test('Shopee payment step is published under its reviewed public name', async () => {
    const o = await order('PLA-001');
    assert.match(o.steps[7], /K\.Fai.*32,100泰铢/);
    assert.equal(o.published()[7], '确认套餐与付款');
  });
  await test('staff-edited step falls back to the neutral name; untouched steps keep public names', async () => {
    const o = await order('PLA-001');
    const step = db.prepare('SELECT id FROM order_steps WHERE order_id=? AND step_order=2').get(o.orderId) as { id: number };
    db.prepare("UPDATE order_steps SET step_name='Bam私下联系Khun Ja报价800泰铢' WHERE id=?").run(step.id);
    db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee) VALUES (?,?,99,'待处理','Pop')").run(o.orderId, 'Pop 临时加的一步');
    queueProgressEventsForOrder(o.orderId, db);
    const published = o.published();
    assert.equal(published[0], '方案确认');
    assert.equal(published[1], '办理事项');
    assert.equal(published[published.length - 1], '办理事项');
    assert.equal(published[7], '确认套餐与付款');
  });
  await test('internal staff still see the original step names', async () => {
    const o = await order('PLA-001');
    assert.deepEqual(o.steps, getOrderStepsWithDocs((db.prepare("SELECT id FROM business_types WHERE name='Mall开店'").get() as { id: number }).id, 'shopee', 'client').map(s => s.name));
  });

  // ── 新单提醒（2026-10-03 老板选 B：对上业务线的新单也提醒全体员工）──
  const NEW_ORDER = '客户站新订单';
  const recipientsOf = (no: string) => recipients(no, NEW_ORDER);
  await test('mapped new order: every active staff member gets exactly one reminder; clients and 离职 excluded', async () => {
    assert(activeStaff.length >= 2, 'fixture needs several staff');
    const no = `NEW-${++serial}`;
    await send(payload(no, ['COM-005', 'OTH-003']));
    assert.deepEqual(recipientsOf(no), activeStaff);
    assert(!recipientsOf(no).includes('LEFT_STAFF') && !recipientsOf(no).includes(''));
    const body = (db.prepare('SELECT body FROM notifications WHERE related_id=? AND title=? LIMIT 1').get(no, NEW_ORDER) as { body: string }).body;
    assert.match(body, /公司注册/); assert.match(body, /地址认证/); assert.match(body, /SYNTHETIC_BUYER/);
    assert.equal(countAlerts(no, UNCLASSIFIED), 0);
  });
  await test('unclassified-only order: no new-order reminder, only the per-staff 待领取 reminder', async () => {
    const no = `NEW-${++serial}`;
    await send(payload(no, ['TAX-005']));
    assert.deepEqual(recipientsOf(no), []);
    assert.deepEqual(recipients(no, UNCLASSIFIED), activeStaff);
  });
  await test('mixed order: each staff member gets one new-order and one 待领取 reminder', async () => {
    const no = `NEW-${++serial}`;
    await send(payload(no, ['COM-001', 'TAX-005', 'OTH-007']));
    assert.deepEqual(recipientsOf(no), activeStaff);
    assert.deepEqual(recipients(no, UNCLASSIFIED), activeStaff);
  });
  await test('resending the same order does not repeat reminders', async () => {
    const no = `NEW-${++serial}`;
    const body = payload(no, ['COM-001']);
    await send(body);
    const again = await send(body);
    assert.equal(again.status, 'duplicate');
    assert.equal(recipientsOf(no).length, activeStaff.length);
  });
  await test('recurring bill creates no reminder', async () => {
    const no = `NEW-${++serial}`;
    await send(payload(no, ['COM-001'], 'recurring'));
    assert.deepEqual(recipientsOf(no), []);
  });
  await test('全部已读 clears only the reader\'s own reminders (new-order and 待领取) and they stay cleared', async () => {
    const no = `NEW-${++serial}`;
    await send(payload(no, ['COM-001', 'TAX-005']));
    const [reader, other] = activeStaff;
    const user = db.prepare('SELECT id,name,role,auth_version FROM employees WHERE name=? LIMIT 1').get(reader) as { id: number; name: string; role: string; auth_version: number };
    db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(user.id);
    const token = await signToken({ id: user.id, name: user.name, role: user.role as 'admin' | 'employee', auth_version: user.auth_version, must_change_password: 0 });
    const response = await notifications.PATCH(new NextRequest('http://fixture.invalid/api/notifications', { method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ markAll: true }) }));
    assert.equal(response.status, 200);
    const unread = (name: string) => (db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE related_id=? AND recipient=? AND is_read=0').get(no, name) as { n: number }).n;
    assert.equal(unread(reader), 0);
    assert.equal(unread(other), 2);
    const list = await notifications.GET(new NextRequest('http://fixture.invalid/api/notifications?unread=1', { headers: { authorization: `Bearer ${token}` } }));
    assert(!(await list.json() as { related_id: string }[]).some(n => n.related_id === no));
  });

  await test('internal-site customer views show public step names, staff views keep originals', async () => {
    const mall = (db.prepare("SELECT id FROM business_types WHERE name='Mall开店'").get() as { id: number }).id;
    db.prepare("INSERT INTO orders(id,customer_name,business_type_id,sub_service_type,status) VALUES ('LEGACY-PUB','LEGACY_CLIENT',?,'shopee','进行中')").run(mall);
    getOrderStepsWithDocs(mall, 'shopee', 'client').forEach((step, i) =>
      db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee) VALUES ('LEGACY-PUB',?,?,'待处理',?)").run(step.name, i + 1, step.assignee));
    const client = db.prepare("INSERT INTO employees(name,email,role,password,must_change_password,auth_version) VALUES ('LEGACY_CLIENT','legacy-client@example.invalid','client','x',0,0)").run();
    const clientId = Number(client.lastInsertRowid);
    db.prepare('INSERT INTO client_account_customers(employee_id,customer_name) VALUES (?,?)').run(clientId, 'LEGACY_CLIENT');
    const token = await signToken({ id: clientId, name: 'LEGACY_CLIENT', role: 'client', auth_version: 0, must_change_password: 0 });
    const headers = { authorization: `Bearer ${token}` };
    const params = { params: Promise.resolve({ id: 'LEGACY-PUB' }) };
    for (const [label, handler, url] of [['external', externalDetail.GET, 'http://fixture.invalid/api/external/orders/LEGACY-PUB'], ['orders', orderDetail.GET, 'http://fixture.invalid/api/orders/LEGACY-PUB']] as const) {
      const response = await handler(new NextRequest(url, { headers }), params);
      assert.equal(response.status, 200, label);
      const steps = (await response.json()).steps as { step_name: string; assignee?: string }[];
      assert.equal(steps[7].step_name, '确认套餐与付款', label);
      for (const step of steps) { assert(!internalMarkers.test(step.step_name), `${label} leaked ${step.step_name}`); assert.equal(step.assignee, undefined); }
    }
    const admin = db.prepare("SELECT id,name,auth_version FROM employees WHERE role='admin' LIMIT 1").get() as { id: number; name: string; auth_version: number };
    db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(admin.id);
    const staffToken = await signToken({ id: admin.id, name: admin.name, role: 'admin', auth_version: admin.auth_version, must_change_password: 0 });
    const staff = await orderDetail.GET(new NextRequest('http://fixture.invalid/api/orders/LEGACY-PUB', { headers: { authorization: `Bearer ${staffToken}` } }), params);
    assert.match((await staff.json()).steps[7].step_name, /K\.Fai/);
  });

  // ── 待分类单：不再"两步即完成"；改派换成正式业务线整套流程（2026-10-03 老板选 A）──
  const adminRow = db.prepare("SELECT id,name,auth_version FROM employees WHERE role='admin' LIMIT 1").get() as { id: number; name: string; auth_version: number };
  db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(adminRow.id);
  const staffHeaders = { 'content-type': 'application/json', authorization: `Bearer ${await signToken({ id: adminRow.id, name: adminRow.name, role: 'admin', auth_version: adminRow.auth_version, must_change_password: 0 })}` };
  const btId = (name: string) => (db.prepare('SELECT id FROM business_types WHERE name=?').get(name) as { id: number }).id;
  const stepsOf = (id: string) => db.prepare('SELECT id,step_order,step_name,status,assignee FROM order_steps WHERE order_id=? ORDER BY step_order').all(id) as { id: number; step_order: number; step_name: string; status: string; assignee: string }[];
  const orderRow = (id: string) => db.prepare('SELECT status,business_type_id,sub_service_type,address_type FROM orders WHERE id=?').get(id) as { status: string; business_type_id: number; sub_service_type: string; address_type: string };
  async function setStep(orderId: string, stepId: number, status: string) {
    const r = await stepRoute.PATCH(new NextRequest(`http://fixture.invalid/api/orders/${orderId}/steps`, { method: 'PATCH', headers: staffHeaders, body: JSON.stringify({ step_id: stepId, status }) }), { params: Promise.resolve({ id: orderId }) });
    assert.equal(r.status, 200, JSON.stringify(await r.clone().json()));
  }
  async function edit(orderId: string, body: Record<string, unknown>) {
    const r = await orderDetail.PATCH(new NextRequest(`http://fixture.invalid/api/orders/${orderId}`, { method: 'PATCH', headers: staffHeaders, body: JSON.stringify(body) }), { params: Promise.resolve({ id: orderId }) });
    return { status: r.status, body: await r.json() };
  }
  const formOf = (id: string) => { const r = orderRow(id); return { business_type_id: r.business_type_id, sub_service_type: r.sub_service_type, address_type: r.address_type, description: 'edited' }; };
  await test('待分类: finishing 方案确认 + 确认归属 no longer marks the order 已完成', async () => {
    const o = await order('TAX-006');
    const [plan, claim, deliver] = stepsOf(o.orderId);
    assert.deepEqual([plan.step_name, deliver.step_name], ['方案确认', '办理并交付']);
    await setStep(o.orderId, plan.id, '已完成'); await setStep(o.orderId, claim.id, '已完成');
    assert.equal(orderRow(o.orderId).status, '进行中');
    await setStep(o.orderId, deliver.id, '已完成');
    assert.equal(orderRow(o.orderId).status, '已完成');
  });
  await test('reassign 待分类 → FDA 食品: full workflow appended, notes kept, customer names right, only once', async () => {
    const o = await order('TAX-007');
    const [plan, claim, deliver] = stepsOf(o.orderId);
    await setStep(o.orderId, plan.id, '已完成');
    db.prepare("INSERT INTO step_notes(step_id,order_id,content,created_by) VALUES (?,?,'NOTE-ON-PLAN','staff'),(?,?,'NOTE-ON-DELIVER','staff')").run(plan.id, o.orderId, deliver.id, o.orderId);
    const missing = await edit(o.orderId, { ...formOf(o.orderId), business_type_id: btId('FDA认证'), sub_service_type: '' });
    assert.equal(missing.status, 400); assert.match(missing.body.error, /具体服务/);
    assert.equal(stepsOf(o.orderId).length, 3, 'rejected reassign changes nothing');
    const ok = await edit(o.orderId, { ...formOf(o.orderId), business_type_id: btId('FDA认证'), sub_service_type: 'food' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const food = getOrderStepsWithDocs(btId('FDA认证'), 'food', 'client');
    const steps = stepsOf(o.orderId);
    assert.deepEqual(steps.map(s => s.step_name), ['方案确认', claim.step_name, ...food.slice(1).map(s => s.name)]);
    assert.deepEqual(steps.map(s => s.step_order), steps.map((_, i) => i + 1));
    assert.equal(steps[0].status, '已完成'); assert.equal(steps[1].status, '已完成');
    assert(steps.slice(2).every(s => s.status === '待处理'));
    assert.deepEqual(steps.slice(2).map(s => s.assignee), food.slice(1).map(s => s.assignee));
    const notes = db.prepare('SELECT step_id,content FROM step_notes WHERE order_id=? ORDER BY content').all(o.orderId) as { step_id: number; content: string }[];
    assert.deepEqual(notes, [{ step_id: claim.id, content: 'NOTE-ON-DELIVER' }, { step_id: plan.id, content: 'NOTE-ON-PLAN' }]);
    const docs = (db.prepare('SELECT COUNT(*) n FROM step_documents WHERE order_id=?').get(o.orderId) as { n: number }).n;
    assert.equal(docs, food.slice(1).reduce((n, s) => n + s.docs.length, 0));
    assert(docs > 0, 'FDA food template carries document checklists');
    assert.deepEqual([orderRow(o.orderId).status, orderRow(o.orderId).sub_service_type, orderRow(o.orderId).business_type_id], ['进行中', 'food', btId('FDA认证')]);
    const published = o.published();
    assert.deepEqual(published.slice(0, 2), ['方案确认', '确认服务归属']);
    assert.equal(published.length, steps.length);
    assert(!published.includes('办理事项'), JSON.stringify(published));
    for (const name of published) assert(!internalMarkers.test(name), name);
    const again = await edit(o.orderId, { ...formOf(o.orderId), business_type_id: btId('商标'), sub_service_type: 'tm-reg' });
    assert.equal(again.status, 200);
    assert.equal(stepsOf(o.orderId).length, steps.length, 'second change is a plain edit, no second regeneration');
  });
  await test('reassign guards: started 办理并交付, cancelled order', async () => {
    const started = await order('TAX-008');
    await setStep(started.orderId, stepsOf(started.orderId)[2].id, '进行中');
    const r1 = await edit(started.orderId, { ...formOf(started.orderId), business_type_id: btId('NBTC'), sub_service_type: '' });
    assert.equal(r1.status, 409); assert.match(r1.body.error, /办理并交付/);
    assert.equal(stepsOf(started.orderId).length, 3);
    const cancelled = await order('TAX-009');
    assert.equal((await edit(cancelled.orderId, { cancel: true, cancel_reason: 'fixture' })).status, 200);
    const r2 = await edit(cancelled.orderId, { ...formOf(cancelled.orderId), business_type_id: btId('NBTC'), sub_service_type: '' });
    assert.equal(r2.status, 409); assert.match(r2.body.error, /已取消/);
  });
  await test('reassign to 地址认证 with 湘泰地址 adds the lease steps; line without sub-services needs none', async () => {
    const a = await order('TAX-010');
    const r = await edit(a.orderId, { ...formOf(a.orderId), business_type_id: btId('地址认证'), sub_service_type: '', address_type: 'xiangtai' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const names = stepsOf(a.orderId).map(s => s.step_name);
    assert(names.includes('签订租赁合同') && names.includes('收取首月租金'));
    assert.equal(orderRow(a.orderId).address_type, 'xiangtai');
    const n = await order('TAX-011');
    assert.equal((await edit(n.orderId, { ...formOf(n.orderId), business_type_id: btId('NBTC'), sub_service_type: '' })).status, 200);
    assert.equal(stepsOf(n.orderId).length, 2 + getOrderStepsWithDocs(btId('NBTC'), '', 'client').length - 1);
  });
  await test('ordinary edits of non-待分类 synced orders are unchanged', async () => {
    const o = await order('COM-001');
    const before = stepsOf(o.orderId).length;
    assert.equal((await edit(o.orderId, { ...formOf(o.orderId), business_type_id: btId('商标') })).status, 200);
    assert.equal(stepsOf(o.orderId).length, before);
  });
  await test('internal shop 待分类 workflow still passes its hash lock', async () => {
    const workflow = commerceWorkflow(db, { version: 'unclassified-v1', quantity_basis: 'unclassified' } as never);
    assert.deepEqual(workflow.publicNames, ['方案确认', '确认服务归属', '办理并交付']);
    assert.equal(workflow.steps.length, 3);
  });

  db.close();
  for (const result of results) console.log(JSON.stringify(result));
  const failed = results.filter(x => x.result === 'FAIL').length;
  console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
