'use strict';
// Independent adversarial regression: prior false-ACK/starvation/employee-cancel repros.
// Only actual source is loaded; every DB is synthetic in a new OS temp directory.
// Route/auth/DB injection keeps the test away from configured project databases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const ts = require('typescript');
const Database = require('better-sqlite3');
const root = path.resolve(process.env.PROGRESS_SOURCE_ROOT || path.join(__dirname, '..'));
const temp = fs.mkdtempSync('/tmp/xt-progress-adversarial-');
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
    CREATE TABLE sync_progress_outbox(id TEXT PRIMARY KEY,inbox_id TEXT,payload TEXT,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now')),sent_at TEXT,attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT,last_error TEXT);
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
    fetch: async (...args) => { assert.equal(db.inTransaction, false, 'network starts only after COMMIT'); metrics.fetches.push(args); return fetchImpl(...args); },
  });
  function load(key, fresh = false) {
    if (cache[key] && !fresh) return cache[key].exports;
    const mod = { exports: {} }; cache[key] = mod;
    const file = path.join(root, files[key]);
    const nativeRequire = createRequire(__filename);
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
const state = db => ({ order: db.prepare('SELECT status FROM orders').get().status, step: db.prepare('SELECT status FROM order_steps').get().status, seq: db.prepare('SELECT progress_seq FROM sync_inbox').get()?.progress_seq ?? null, events: count(db) });
const mutate = (h, key, body) => h.load(key).PATCH({ json: async () => body }, { params: Promise.resolve({ id: 'fixture-order' }) });
async function test(name, run) {
  const db = makeDb(), h = harness(db);
  try { await run(db, h); passed.push(name); console.log(`PASS ${name}`); }
  finally { h.load('progress').stopProgressWorker?.(); db.close(); }
}


function enable(h) { Object.assign(h.env, { CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only' }); }
function ackFor(event, overrides = {}) { return { ok: true, source_order_no: event.source_order_no, line_no: event.line_no, copy_no: event.copy_no, seq: event.seq, ...overrides }; }
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
function validFetch(_, options) { return Promise.resolve(response(ackFor(JSON.parse(options.body)))); }
function due(db) { db.prepare("UPDATE sync_progress_outbox SET next_attempt_at=datetime('now','-1 second') WHERE status='pending'").run(); }
function queueRow(db) { return db.prepare('SELECT * FROM sync_progress_outbox ORDER BY rowid LIMIT 1').get(); }

// Used only for actual DB migration verification on the synthetic path supplied below.
function actualDbModule(dbPath) {
  const modules = new Map();
  const context = vm.createContext({
    console: { error() {}, warn() {}, log() {} }, Buffer,
    process: { env: { ...process.env, DB_PATH: dbPath, NODE_ENV: 'test' }, cwd: () => path.dirname(dbPath) },
  });
  function load(file) {
    if (modules.has(file)) return modules.get(file).exports;
    const mod = { exports: {} }; modules.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    }}).outputText;
    const nativeRequire = createRequire(file);
    function resolve(id) {
      if (!id.startsWith('.')) return nativeRequire(id);
      const resolved = path.resolve(path.dirname(file), id);
      if (id === './runtime-config.cjs') return {databasePath: dbPath}; // fixture path injection; production config is exercised by storage tests
      const candidate = [resolved, resolved + '.ts', path.join(resolved, 'index.ts')].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
      return candidate && !candidate.endsWith('.cjs') ? load(candidate) : nativeRequire(id);
    }
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context, {filename: file})(resolve, mod, mod.exports);
    return mod.exports;
  }
  return load(path.join(root, 'src/lib/db.ts'));
}

// 进度事件只在客户可见内容变化时才入队；需要第二条事件的用例先改一次步骤状态。
const visibleChange = db => db.prepare("UPDATE order_steps SET status = CASE status WHEN '已完成' THEN '进行中' ELSE '已完成' END WHERE order_id = 'fixture-order'").run();
(async () => {
  await test('false/malformed/mismatched ACK stays pending; exact or newer matching ACK succeeds', async (db, h) => {
    const p = h.load('progress'); p.queueProgressEventsForOrder('fixture-order', db); enable(h);
    const event = JSON.parse(queueRow(db).payload);
    const negative = [
      ['ok:false', response(ackFor(event, {ok: false}))],
      ['empty object', response({})],
      ['ignored', response(ackFor(event, {ignored: 'unknown order'}))],
      ['wrong order', response(ackFor(event, {source_order_no: 'OTHER-ORDER'}))],
      ['wrong line', response(ackFor(event, {line_no: event.line_no + 1}))],
      ['wrong copy', response(ackFor(event, {copy_no: event.copy_no + 1}))],
      ['lower seq', response(ackFor(event, {seq: event.seq - 1}))],
      ['string seq', response(ackFor(event, {seq: String(event.seq)}))],
      ['fractional seq', response(ackFor(event, {seq: event.seq + 0.5}))],
      ['non JSON', {ok: true, status: 200, json: async () => {throw new SyntaxError('Fixture HTML instead of JSON');}}],
      ['null body', response(null)],
    ];
    for (let i = 0; i < negative.length; i++) {
      const [name, reply] = negative[i]; let jsonReads = 0;
      h.setFetch(async () => ({...reply, json: async () => {jsonReads++; return reply.json();}}));
      due(db); const result = await p.flushProgress(); const row = queueRow(db);
      assert.equal(result.sent, 0, name); assert.equal(result.failed, 1, name);
      assert.equal(row.status, 'pending', name); assert.equal(row.attempts, i + 1, name);
      assert.ok(row.next_attempt_at && row.last_error, name); assert.equal(jsonReads, 1, name);
      const calls = h.metrics.fetches.length; await p.flushProgress();
      assert.equal(h.metrics.fetches.length, calls, 'backoff should suppress immediate repeat');
    }
    h.setFetch(validFetch); due(db); assert.equal((await p.flushProgress()).sent, 1);
    assert.equal(queueRow(db).status, 'sent'); assert.equal(queueRow(db).last_error, null);
    visibleChange(db); p.queueProgressEventsForOrder('fixture-order', db);
    h.setFetch(async (_, options) => response(ackFor(JSON.parse(options.body), {seq: 9, stale: true})));
    assert.equal((await p.flushProgress()).sent, 1, 'newer matching persisted sequence confirms a stale event');
    console.log('VERIFIED ACK negative_cases=11 exact_ack=sent newer_matching_ack=sent');
  });

  await test('100 failing events do not starve the 101st; long failure recovers after capped backoff', async (db, h) => {
    const p = h.load('progress'); enable(h);
    const insert = db.prepare('INSERT INTO sync_progress_outbox(id,inbox_id,payload) VALUES(?,?,?)');
    for (let i = 1; i <= 101; i++) insert.run(`event-${String(i).padStart(3, '0')}`, 'fixture-inbox', JSON.stringify({
      source_order_no: 'FIXTURE-001', line_no: 1, copy_no: 1, seq: i, status: '待处理', steps: [],
    }));
    h.setFetch(async (_, options) => {
      const event = JSON.parse(options.body); return event.seq === 101 ? response(ackFor(event)) : response({error: 'fixture conflict'}, 409);
    });
    const first = await p.flushProgress(); assert.equal(first.failed, 100); assert.equal(first.sent, 0);
    const second = await p.flushProgress(); assert.equal(second.sent, 1); assert.equal(second.failed, 0);
    assert.equal(db.prepare("SELECT status FROM sync_progress_outbox WHERE id='event-101'").get().status, 'sent');
    assert.equal(h.metrics.fetches.length, 101);
    db.prepare("UPDATE sync_progress_outbox SET attempts=40,next_attempt_at=datetime('now','-1 second') WHERE status='pending'").run();
    const outage = await p.flushProgress(); assert.equal(outage.failed, 100);
    const row = queueRow(db); assert.equal(row.attempts, 41);
    const backoff = db.prepare("SELECT CAST(strftime('%s', next_attempt_at) AS INTEGER)-CAST(strftime('%s','now') AS INTEGER) AS seconds FROM sync_progress_outbox LIMIT 1").get().seconds;
    assert.ok(backoff >= 598 && backoff <= 600, `capped delay ${backoff}`);
    h.setFetch(validFetch); due(db); const recovered = await p.flushProgress(); assert.equal(recovered.sent, 100);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_progress_outbox WHERE status='pending'").get().n, 0);
    console.log('VERIFIED fairness first_failed=100 second_sent=1 after_41_attempts_recovered=100');
  });

  await test('synced cancel/restore require admin; legacy employee behavior and ordinary step work remain', async (db, h) => {
    h.setAuth({id: 22, role: 'employee', name: 'Fixture employee'});
    for (const body of [{cancel: true, cancel_reason: 'Staff request'}, {restore: true}]) {
      assert.equal((await mutate(h, 'order', body)).status, 403);
    }
    assert.equal(state(db).order, '待处理'); assert.equal(count(db), 0); assert.equal(h.metrics.audits.length, 0);
    assert.equal((await mutate(h, 'step', {step_id: 1, status: '进行中'})).status, 200);
    h.setAuth({id: 1, role: 'admin', name: 'Fixture admin'});
    assert.equal((await mutate(h, 'order', {cancel: true, cancel_reason: 'Admin approved'})).status, 200);
    assert.equal(state(db).order, '客户取消');
    assert.equal((await mutate(h, 'order', {restore: true})).status, 200); assert.equal(state(db).order, '进行中');
    assert.equal((await mutate(h, 'order', {cancel: true, restore: true, cancel_reason: 'contradictory'})).status, 400);
    db.exec("DELETE FROM sync_inbox; UPDATE orders SET source_system='storefront'");
    h.setAuth({id: 22, role: 'employee', name: 'Fixture employee'});
    assert.equal((await mutate(h, 'order', {cancel: true, cancel_reason: 'Missing inbox'})).status, 403);
    db.exec("UPDATE orders SET source_system=''");
    assert.equal((await mutate(h, 'order', {cancel: true, cancel_reason: 'Legacy internal cancellation'})).status, 200);
    assert.equal(state(db).order, '客户取消');
    assert.equal((await mutate(h, 'order', {restore: true})).status, 200); assert.equal(state(db).order, '进行中');
    console.log('VERIFIED permissions synced_employee=403 synced_admin=200 legacy_employee=200');
  });

  await test('sent-marker and retry-metadata SQL errors preserve pending and release the worker lock', async (db, h) => {
    const p = h.load('progress'); p.queueProgressEventsForOrder('fixture-order', db); enable(h); h.setFetch(validFetch);
    db.exec("CREATE TRIGGER reject_sent BEFORE UPDATE OF status ON sync_progress_outbox BEGIN SELECT RAISE(ABORT,'MARK_SENT_FAILURE'); END");
    assert.equal((await p.flushProgress()).failed, 1); assert.equal(queueRow(db).status, 'pending');
    db.exec('DROP TRIGGER reject_sent'); due(db); assert.equal((await p.flushProgress()).sent, 1);
    visibleChange(db); p.queueProgressEventsForOrder('fixture-order', db);
    db.exec("CREATE TRIGGER reject_retry BEFORE UPDATE OF attempts ON sync_progress_outbox BEGIN SELECT RAISE(ABORT,'RETRY_METADATA_FAILURE'); END");
    h.setFetch(async () => response({}, 503));
    await assert.rejects(p.flushProgress(), /RETRY_METADATA_FAILURE/);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM sync_progress_outbox WHERE status='pending'").get().n, 1);
    db.exec('DROP TRIGGER reject_retry'); h.setFetch(validFetch);
    assert.equal((await p.flushProgress()).sent, 1, 'finally must release lock after bookkeeping exception');
    console.log('VERIFIED SQL marker and retry errors preserve event; repaired sender recovers');
  });

  const migrationPath = path.join(temp, 'old-schema.sqlite');
  const initialized = actualDbModule(migrationPath).getDb(); initialized.close();
  const legacy = new Database(migrationPath);
  legacy.exec(`DROP TABLE sync_progress_outbox; CREATE TABLE sync_progress_outbox(id TEXT PRIMARY KEY,inbox_id TEXT NOT NULL,payload TEXT NOT NULL,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now')),sent_at TEXT);
    INSERT INTO sync_progress_outbox(id,inbox_id,payload) VALUES('old-pending','old-inbox','{"source_order_no":"OLD","line_no":1,"copy_no":1,"seq":1}');`);
  legacy.close();
  for (let run = 1; run <= 2; run++) {
    const migrated = actualDbModule(migrationPath).getDb();
    const columns = new Set(migrated.prepare('PRAGMA table_info(sync_progress_outbox)').all().map(row => row.name));
    for (const name of ['attempts', 'next_attempt_at', 'last_error']) assert.ok(columns.has(name), `migration adds ${name}`);
    const row = migrated.prepare("SELECT status,attempts,next_attempt_at,last_error FROM sync_progress_outbox WHERE id='old-pending'").get();
    assert.deepEqual(row, {status: 'pending', attempts: 0, next_attempt_at: null, last_error: null});
    migrated.close();
  }
  passed.push('actual getDb upgrades old progress schema twice without losing pending');
  console.log('PASS actual getDb upgrades old progress schema twice without losing pending');
  const hashes = Object.fromEntries(Object.values(files).map(file => [file, require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({root, passed, hashes}, null, 2));
  console.log(`PASS ${passed.length} independent adversarial suites; evidence ${temp}`);
})().catch(error => {console.error(error); process.exitCode = 1;});
