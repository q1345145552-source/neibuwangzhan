'use strict';
// Isolated regression tests. All SQL files are synthetic, in a new OS temp dir.
// Route/auth/DB injection keeps the test away from configured project databases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const Database = require('better-sqlite3');
const root = path.resolve(process.env.PROGRESS_SOURCE_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync('/tmp/xt-progress-regression-');
const files = {
  progress: 'src/lib/progress-sync.ts',
  step: 'src/app/api/orders/[id]/steps/route.ts',
  order: 'src/app/api/orders/[id]/route.ts',
  instrumentation: 'src/instrumentation.ts',
  scope: 'src/lib/client-scope.ts',
  view: 'src/lib/client-view.ts',
  authCapability: 'src/lib/auth.ts',
};
let serial = 0;
const passed = [];
function makeDb() {
  const db = new Database(path.join(temp, `fixture-${++serial}.sqlite`));
  db.exec(`
    CREATE TABLE orders(id TEXT PRIMARY KEY,status TEXT,updated_at TEXT,description TEXT,cancel_reason TEXT,customer_name TEXT DEFAULT 'Fixture customer',source_system TEXT DEFAULT '',total_amount REAL DEFAULT 100,currency TEXT DEFAULT 'CNY',monthly_rent REAL DEFAULT 0);
    CREATE TABLE client_account_customers(employee_id INTEGER,customer_name TEXT);
    CREATE TABLE client_scope_settings(employee_id INTEGER PRIMARY KEY,mode TEXT);
    CREATE TABLE order_steps(id INTEGER PRIMARY KEY,order_id TEXT,step_order INTEGER,step_name TEXT,status TEXT,notes TEXT,assignee TEXT,approval_status TEXT,submission_count INTEGER,completed_at TEXT,started_at TEXT);
    CREATE TABLE sync_inbox(id TEXT PRIMARY KEY,source_order_no TEXT,line_no INTEGER,copy_no INTEGER,internal_order_id TEXT,progress_seq INTEGER DEFAULT 0);
    CREATE TABLE sync_progress_outbox(id TEXT PRIMARY KEY,inbox_id TEXT,payload TEXT,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now')),sent_at TEXT,attempts INTEGER DEFAULT 0,next_attempt_at TEXT,last_error TEXT);
    INSERT INTO orders(id,status) VALUES('fixture-order','待处理');
    INSERT INTO order_steps(id,order_id,step_order,step_name,status,notes,assignee) VALUES(1,'fixture-order',1,'Fixture step','待处理','PRIVATE-NOTE','PRIVATE-ASSIGNEE');
    INSERT INTO sync_inbox(id,source_order_no,line_no,copy_no,internal_order_id) VALUES('fixture-inbox','FIXTURE-001',1,1,'fixture-order');
  `);
  return db;
}
function harness(db) {
  const metrics = { timers: [], fetches: [], logs: [], audits: [] };
  const env = { CUSTOMER_SYNC_URL: '', SYNC_SECRET: '', NEXT_RUNTIME: 'nodejs', NEXT_PHASE: '' };
  let fetchImpl = async () => ({ ok: true, status: 200 });
  let getDbImpl = () => db;
  let auth = { id: 1, role: 'admin', name: 'Fixture admin' };
  const cache = {};
  const ctx = vm.createContext({
    Buffer, AbortSignal, process: { env }, setTimeout, clearTimeout,
    console: { error: (...args) => metrics.logs.push(args.map(String).join(' ')), warn: (...args) => metrics.logs.push(args.map(String).join(' ')) },
    setInterval: (fn, ms) => { const timer = { fn, ms, active: true, unref() {} }; metrics.timers.push(timer); return timer; },
    clearInterval: timer => { timer.active = false; },
    fetch: async (...args) => { assert.equal(db.inTransaction, false, 'network starts only after COMMIT'); metrics.fetches.push(args); const response = await fetchImpl(...args);
      if (response.ok && !response.json) response.json = async () => ({ok:true,...JSON.parse(args[1].body)});
      return response; },
  });
  function load(key, fresh = false) {
    if (cache[key] && !fresh) return cache[key].exports;
    const mod = { exports: {} }; cache[key] = mod;
    const file = path.join(root, files[key]);
    const nativeRequire = createRequire(path.join(__dirname, 'test-progress-sync.cjs'));
    let source = fs.readFileSync(file, 'utf8');
    if (key === 'authCapability') {
      const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
      const capability = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'isStaff');
      assert(capability, 'actual isStaff declaration must be present');
      source = capability.getText(parsed);
    }
    const code = ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText;
    const resolve = id => {
      if (id === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ status: options.status || 200, body }) } };
      if (id === '@/lib/auth') return { verifyAuth: async () => auth, isStaff: load('authCapability').isStaff };
      if (id === '@/lib/req') return { readJson: req => req.json() };
      // 商城只读查询（仅 GET 用）与客户可见步骤名：夹具步骤名不属于任何模板，真实实现同样回中性名；
      // 真实映射由 scripts/test-sync-public-steps.mts 端到端覆盖。
      if (id === '@/lib/commerce-terms') return { readOrderPurchase: () => null };
      if (id === './commerce-fulfillment') return { publicStepNames: names => names.map(() => '办理事项') };
      if (id === './commerce-schema') return { isCommerceBuyer: () => false }; // 夹具未开商城试点，真实实现同为 false
      if (id === '@/lib/constants') return { subServices: {} }; // 仅待分类改派用，夹具订单不是待分类单
      if (id === '@/lib/cancel-sync') return { approvePending: () => 0 }; // 夹具单没有客户站取消申请，真实实现同样回 0；真实流程由 test-sync-documents.mts 端到端覆盖
      if (id === '@/lib/db' || id === './db') return { getDb: () => getDbImpl(), getOrderStepsWithDocs: () => [], logOperation: (...args) => metrics.audits.push(args) };
      if (id === '@/lib/progress-sync' || id === './lib/progress-sync') return load('progress');
      if (id === '@/lib/client-scope') return load('scope');
      if (id === '@/lib/client-view') return load('view');
      return nativeRequire(id);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, ctx, { filename: file })(resolve, mod, mod.exports);
    return mod.exports;
  }
  return { load, metrics, env, setAuth: value => { auth = value; }, setFetch: fn => { fetchImpl = fn; }, setDb: fn => { getDbImpl = fn; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const count = db => db.prepare('SELECT COUNT(*) n FROM sync_progress_outbox').get().n;
const state = db => ({ order: db.prepare('SELECT status FROM orders').get().status, step: db.prepare('SELECT status FROM order_steps').get().status, seq: db.prepare('SELECT progress_seq FROM sync_inbox').get().progress_seq, events: count(db) });
const mutate = (h, key, body) => h.load(key).PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'fixture-order' }) });
async function test(name, run) {
  const db = makeDb(), h = harness(db);
  try { await run(db, h); passed.push(name); console.log(`PASS ${name}`); }
  finally { h.load('progress').stopProgressWorker?.(); db.close(); }
}
(async () => {
  for (const key of ['step', 'order']) await test(`${key}: queue insert failure rolls back business, seq and event`, async (db, h) => {
    db.exec("CREATE TRIGGER reject_progress BEFORE INSERT ON sync_progress_outbox BEGIN SELECT RAISE(ABORT,'INJECTED_PROGRESS_QUEUE_FAILURE'); END");
    const response = await mutate(h, key, key === 'step' ? { step_id: 1, status: '已完成', assignee: 'Other' } : { cancel: true, cancel_reason: 'Fixture cancellation' });
    assert.equal(response.status, 500);
    assert.deepEqual(state(db), { order: '待处理', step: '待处理', seq: 0, events: 0 });
    assert.equal(h.metrics.fetches.length, 0);
    assert.equal(h.metrics.audits.length, 0, 'rolled-back change must not be audited as successful');
    assert.ok(h.metrics.logs.some(line => line.includes('INJECTED_PROGRESS_QUEUE_FAILURE')));
  });
  await test('standalone and nested queue transactions roll back all copies', async (db, h) => {
    const p = h.load('progress');
    db.exec("INSERT INTO sync_inbox VALUES('fixture-inbox-2','FIXTURE-001',1,2,'fixture-order',0)");
    db.exec("CREATE TRIGGER reject_progress BEFORE INSERT ON sync_progress_outbox WHEN NEW.inbox_id = 'fixture-inbox-2' BEGIN SELECT RAISE(ABORT,'INJECTED_SECOND_COPY_FAILURE'); END");
    assert.throws(() => p.queueProgressEventsForOrder('fixture-order', db), /INJECTED_SECOND_COPY_FAILURE/);
    assert.equal(count(db), 0);
    assert.equal(db.prepare('SELECT SUM(progress_seq) n FROM sync_inbox').get().n, 0);
    db.exec('DROP TRIGGER reject_progress');
    assert.throws(() => db.transaction(() => { p.queueProgressEventsForOrder('fixture-order', db); throw Error('OUTER_ROLLBACK'); })(), /OUTER_ROLLBACK/);
    assert.equal(count(db), 0);
    assert.equal(db.prepare('SELECT SUM(progress_seq) n FROM sync_inbox').get().n, 0);
  });
  await test('successful mutation persists while offline; later retry sends public seq only', async (db, h) => {
    Object.assign(h.env, { CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only' });
    h.setFetch(async () => ({ ok: false, status: 503 }));
    const response = await mutate(h, 'step', { step_id: 1, status: '已完成' });
    await tick();
    assert.equal(response.status, 200);
    assert.deepEqual(state(db), { order: '已完成', step: '已完成', seq: 1, events: 1 });
    assert.equal(db.prepare('SELECT status FROM sync_progress_outbox').get().status, 'pending');
    const payload = JSON.parse(db.prepare('SELECT payload FROM sync_progress_outbox').get().payload);
    assert.deepEqual(Object.keys(payload).sort(), ['copy_no', 'line_no', 'seq', 'source_order_no', 'status', 'steps']);
    assert.deepEqual(Object.keys(payload.steps[0]).sort(), ['status', 'step_name', 'step_order']);
    assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
    h.setFetch(async () => ({ ok: true, status: 200 }));
    db.prepare('UPDATE sync_progress_outbox SET next_attempt_at=NULL').run();
    assert.equal((await h.load('progress').flushProgress()).sent, 1);
    assert.equal(db.prepare('SELECT status FROM sync_progress_outbox').get().status, 'sent');
  });
  await test('cancellation stays sticky; restore, approval, notes and timestamps preserved', async (db, h) => {
    assert.equal((await mutate(h, 'order', { cancel: true, cancel_reason: 'Fixture cancellation' })).status, 200);
    assert.equal((await mutate(h, 'step', { step_id: 1, status: '阻塞' })).status, 200);
    assert.equal(state(db).order, '客户取消');
    assert.equal((await mutate(h, 'order', { restore: true })).status, 200);
    assert.equal(state(db).order, '进行中');
    assert.equal((await mutate(h, 'step', { step_id: 1, status: '进行中' })).status, 200);
    const started = db.prepare('SELECT started_at FROM order_steps').get().started_at;
    assert.ok(started);
    await mutate(h, 'step', { step_id: 1, status: '已完成' });
    const completed = db.prepare('SELECT completed_at FROM order_steps').get().completed_at;
    await mutate(h, 'step', { step_id: 1, notes: 'PRIVATE-UPDATED', approval_status: '已批准', submission_count: 2 });
    const row = db.prepare('SELECT * FROM order_steps').get();
    assert.equal(row.completed_at, completed); assert.equal(row.started_at, started);
    assert.equal(row.approval_status, '已批准'); assert.equal(row.submission_count, 2);
    assert.equal(state(db).order, '已完成');
    const seqs = db.prepare('SELECT payload FROM sync_progress_outbox ORDER BY rowid').all().map(row => JSON.parse(row.payload).seq);
    // 最后那次只改备注/审批/提交次数，客户可见内容没变，不再发事件（否则客户收到空的「进度更新」通知）
    assert.deepEqual(seqs, [1, 2, 3, 4, 5]);
  });
  await test('internal-only edits queue nothing; customer-visible change still queues', async (db, h) => {
    assert.equal((await mutate(h, 'step', { step_id: 1, status: '进行中' })).status, 200);
    assert.equal(count(db), 1);
    for (const body of [{ step_id: 1, notes: 'PRIVATE-NOTE-2' }, { step_id: 1, assignee: 'Other' }, { step_id: 1, approval_status: '已批准', submission_count: 3 }]) {
      assert.equal((await mutate(h, 'step', body)).status, 200);
    }
    assert.equal((await mutate(h, 'order', { description: 'PRIVATE-DESCRIPTION' })).status, 200);
    assert.equal(count(db), 1, 'internal-only edits must not notify the customer');
    assert.equal(state(db).seq, 1);
    assert.equal((await mutate(h, 'step', { step_id: 1, status: '已完成' })).status, 200);
    assert.equal(count(db), 2);
    assert.equal(JSON.parse(db.prepare('SELECT payload FROM sync_progress_outbox ORDER BY rowid DESC LIMIT 1').get().payload).seq, 2);
    db.prepare("UPDATE sync_progress_outbox SET payload='not-json' WHERE rowid=(SELECT MAX(rowid) FROM sync_progress_outbox)").run();
    assert.equal((await mutate(h, 'step', { step_id: 1, notes: 'after corrupt payload' })).status, 200, 'unreadable previous event must not block staff');
    assert.equal(count(db), 3);
  });
  await test('unlinked internal order creates no event or network request', async (db, h) => {
    db.exec('DELETE FROM sync_inbox');
    Object.assign(h.env, { CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only' });
    assert.equal((await mutate(h, 'step', { step_id: 1, status: '已完成' })).status, 200);
    assert.equal(count(db), 0); assert.equal(h.metrics.fetches.length, 0);
  });
  await test('register skips Edge/build, supports disabled-enable, flushes immediately, and stops', async (db, h) => {
    const p = h.load('progress'), instrumentation = h.load('instrumentation');
    p.queueProgressEventsForOrder('fixture-order', db);
    await instrumentation.register(); assert.equal(h.metrics.timers.length, 0);
    Object.assign(h.env, { CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only', NEXT_RUNTIME: 'edge' });
    await instrumentation.register(); assert.equal(h.metrics.timers.length, 0);
    Object.assign(h.env, { NEXT_RUNTIME: 'nodejs', NEXT_PHASE: 'phase-production-build' });
    await instrumentation.register(); assert.equal(h.metrics.timers.length, 0);
    h.env.NEXT_PHASE = ''; await instrumentation.register(); await tick();
    assert.equal(h.metrics.timers.length, 1); assert.equal(h.metrics.timers[0].ms, 15000);
    assert.equal(h.metrics.fetches.length, 1, 'startup flush occurs without a mutation or timer tick');
    await instrumentation.register(); assert.equal(h.metrics.timers.length, 1);
    p.stopProgressWorker(); assert.equal(h.metrics.timers[0].active, false);
    p.ensureProgressWorker(); await tick(); assert.equal(h.metrics.timers.length, 2);
  });
  await test('global single-flight spans module reloads and startup scan errors are caught', async (db, h) => {
    const p = h.load('progress'); p.queueProgressEventsForOrder('fixture-order', db);
    Object.assign(h.env, { CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only' });
    let release;
    h.setFetch(() => new Promise(resolve => { release = resolve; }));
    const first = p.flushProgress();
    const reloaded = h.load('progress', true);
    assert.equal((await reloaded.flushProgress()).skipped, true);
    assert.equal(h.metrics.fetches.length, 1);
    release({ ok: true, status: 200 }); await first;
    h.setDb(() => { throw Error('INJECTED_DB_SCAN_FAILURE'); });
    reloaded.ensureProgressWorker(); await tick();
    assert.ok(h.metrics.logs.some(line => line.includes('INJECTED_DB_SCAN_FAILURE')));
    assert.equal(h.metrics.timers.length, 1);
    h.setDb(() => db);
    p.queueProgressEventsForOrder('fixture-order', db);
    h.setFetch(async () => ({ ok: true, status: 200 }));
    h.metrics.timers[0].fn(); await tick();
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_progress_outbox WHERE status = 'pending'").get().n, 0);
  });
  await test('direct order GET rejects synced clients, preserves legacy scope and staff access', async (db, h) => {
    const get = () => h.load('order').GET({}, { params: Promise.resolve({ id: 'fixture-order' }) });
    h.setAuth({ id: 25, role: 'client', name: 'Fixture customer' });
    assert.equal((await get()).status, 404, 'same-name client must not read inbox-linked order');
    db.exec("INSERT INTO client_account_customers VALUES(25,'Fixture customer')");
    assert.equal((await get()).status, 404, 'explicit company scope is not a storefront account link');
    db.exec("DELETE FROM sync_inbox; UPDATE orders SET source_system = 'storefront'");
    assert.equal((await get()).status, 404, 'source marker blocks access even when inbox is absent');
    db.exec("UPDATE orders SET source_system = ''");
    assert.equal((await get()).status, 200, 'existing explicit legacy company mapping is preserved');
    db.exec('DELETE FROM client_account_customers');
    assert.equal((await get()).status, 200, 'existing same-name legacy fallback is preserved');
    h.setAuth({ id: 26, role: 'client', name: 'Other customer' });
    assert.equal((await get()).status, 404);
    h.setAuth({ id: 1, role: 'admin', name: 'Fixture admin' });
    assert.equal((await get()).status, 200);
  });
  await test('synced financial edits reject real changes but accept unchanged form values', async (db, h) => {
    for (const body of [{ total_amount: 200 }, { currency: 'THB' }, { monthly_rent: 10 }]) {
      assert.equal((await mutate(h, 'order', body)).status, 403);
    }
    assert.equal(count(db), 0);
    assert.equal((await mutate(h, 'order', { total_amount: 100, currency: 'CNY', monthly_rent: 0, description: 'Updated internal note' })).status, 200);
    assert.equal(db.prepare('SELECT description FROM orders').get().description, 'Updated internal note');
    db.exec('DELETE FROM sync_inbox');
    assert.equal((await mutate(h, 'order', { total_amount: 200 })).status, 200, 'legacy finance editing is unchanged');
  });
  await test('synced physical deletion preserves source ledger; legacy deletion remains available', async (db, h) => {
    const remove = () => h.load('order').DELETE({}, { params: Promise.resolve({ id: 'fixture-order' }) });
    assert.equal((await remove()).status, 409);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 1);
    db.exec("DELETE FROM sync_inbox; UPDATE orders SET source_system = 'storefront'");
    assert.equal((await remove()).status, 409, 'source marker remains protective without inbox');
    db.exec("UPDATE orders SET source_system = ''");
    for (const table of ['step_notes', 'step_documents', 'documents', 'finances', 'certificates', 'tasks']) {
      db.exec(`CREATE TABLE ${table}(order_id TEXT)`);
    }
    assert.equal((await remove()).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  });
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ root, passed }, null, 2));
  console.log(`PASS ${passed.length} progress regression cases; isolated evidence ${temp}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
