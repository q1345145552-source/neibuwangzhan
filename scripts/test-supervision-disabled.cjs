#!/usr/bin/env node
// Isolated regression: disabling boss overdues must not disable order reminders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const fixture = fs.mkdtempSync('/tmp/xt-supervision-disabled-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'supervision-disabled-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, filename) => m._compile(compile(fs.readFileSync(filename, 'utf8')), filename);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();

(async () => {
  const { signToken } = require('../src/lib/auth.ts');
  const { NextRequest } = require('next/server');
  const { GET } = require('../src/app/api/boss-supervision/overdue/route.ts');
  const users = {};
  for (const role of ['admin', 'employee', 'client']) {
    const id = db.prepare('INSERT INTO employees(name,role) VALUES (?,?)').run('停用测试' + role, role).lastInsertRowid;
    users[role] = db.prepare('SELECT * FROM employees WHERE id=?').get(id);
  }
  db.prepare("INSERT INTO todos(content,assignee,priority,created_at) VALUES ('保留旧待办',?,'紧急','2020-01-01 00:00:00')").run(users.employee.name);
  db.prepare("INSERT INTO notifications(type,title,recipient,related_type) VALUES ('','监督关键逾期',?,'boss_supervision')").run(users.admin.name);
  const originalPrepare = db.prepare;
  db.prepare = function(sql) {
    assert(!/\b(todos|work_reports|meetings|meeting_reflections|notice_rules|notice_rule_implementations|leave_requests)\b/i.test(sql), 'Retired endpoint queried business data: ' + sql);
    return originalPrepare.call(this, sql);
  };
  try {
    for (const role of [null, 'employee', 'client', 'admin']) {
      const headers = role ? { Authorization: 'Bearer ' + await signToken(users[role]) } : {};
      const response = await GET(new NextRequest('http://fixture/api/boss-supervision/overdue', { headers }));
      assert.equal(response.status, role === 'admin' ? 200 : role ? 403 : 401);
      if (role === 'admin') {
        const body = await response.json();
        assert.equal(body.enabled, false); assert.equal(body.total, 0);
        assert.deepEqual(body.overdues, []); assert.deepEqual(body.counts, { todo: 0, report: 0, meeting: 0, notice: 0 });
        assert.equal(response.headers.get('cache-control'), 'private, no-store');
      }
    }
  } finally { db.prepare = originalPrepare; }
  console.log('PASS retired API: empty response, no business-table reads, 401/403 permissions preserved');

  const timers = []; let orderChecks = 0;
  const fakeDb = { prepare: sql => ({ all: () => { assert(sql.includes('FROM certificates')); orderChecks++; return []; } }) };
  const context = vm.createContext({ exports: {}, require: id => {
    if (id === '@/lib/db') return { getDb: () => fakeDb };
    if (id === '@/lib/time') return { bangkokToday: () => '2026-10-20' };
    if (id === '@/lib/step-overdue') return { currentStepTimings: () => [] };
    throw Error('Unexpected worker dependency: ' + id);
  }, Date, Map, Set, console, setInterval: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; } });
  vm.runInContext(compile(fs.readFileSync(path.join(root, 'src/lib/order-reminders.ts'), 'utf8')), context);
  const worker = context.exports, at = t => Date.parse('2026-10-20T' + t + '+07:00');
  worker.ensureReminderWorker(); worker.ensureReminderWorker();
  assert.equal(timers.length, 1); assert.equal(timers[0].ms, 60000);
  worker.runReminderTick(at('17:00:00')); worker.runReminderTick(at('17:01:00'));
  worker.runReminderTick(at('17:30:00')); worker.runReminderTick(at('17:31:00'));
  assert.equal(orderChecks, 1);
  worker.runReminderTick(at('18:00:00')); assert.equal(orderChecks, 2);
  console.log('PASS worker: singleton and hourly order checks preserved, no half-hour or 17:30 supervision dispatch');

  const business = db.prepare('SELECT id FROM business_types ORDER BY id LIMIT 1').get().id;
  db.prepare("INSERT INTO orders(id,customer_name,business_type_id,responsible_person,status,created_at) VALUES ('RETIRED-CONTROL','测试客户',?,?,'进行中','2026-09-01 00:00:00')").run(business, users.employee.name);
  db.prepare("INSERT INTO order_steps(order_id,step_name,step_order,status,assignee,expected_days,started_at) VALUES ('RETIRED-CONTROL','测试步骤',1,'进行中',?,1,'2026-09-01 00:00:00')").run(users.employee.name);
  db.prepare("INSERT INTO certificates(order_id,expiry_date) VALUES ('RETIRED-CONTROL','2026-11-10')").run();
  const { runCertificateExpiryReminders, runStepOverdueReminders } = require('../src/lib/order-reminders.ts');
  assert(runCertificateExpiryReminders(db, '2026-10-20') > 0);
  assert(runStepOverdueReminders(db, new Date('2026-10-20T12:00:00+07:00')) > 0);
  assert.equal(runCertificateExpiryReminders(db, '2026-10-20'), 0);
  assert.equal(runStepOverdueReminders(db, new Date('2026-10-20T12:30:00+07:00')), 0);
  const titles = db.prepare("SELECT title FROM notifications WHERE related_type='order'").all().map(n => n.title);
  assert(titles.includes('证书快到期') && titles.includes('步骤超时'));
  assert.equal(db.prepare("SELECT count(*) n FROM notifications WHERE related_type='boss_supervision'").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) n FROM todos WHERE content='保留旧待办'").get().n, 1);
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  console.log('PASS real order certificate/step reminders and dedup; historical supervision messages and business records preserved');
  db.close(); console.log('SUPERVISION DISABLED: all checks passed; isolated fixture ' + fixture);
})().catch(e => { console.error(e); try { db.close(); } catch {} process.exitCode = 1; });
