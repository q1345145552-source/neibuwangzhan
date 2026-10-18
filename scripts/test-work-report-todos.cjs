#!/usr/bin/env node
// Real SQLite + submission routes; fresh /tmp fixture only, no production data or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), vm = require('node:vm'), ts = require('typescript');
const child = process.argv[2] === '--worker';
const fixture = child ? path.dirname(process.argv[3]) : fs.mkdtempSync('/tmp/xt-report-todos-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'report-todo-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
require.extensions['.ts'] = (m, file) => m._compile(compile(fs.readFileSync(file, 'utf8')), file);
const resolve = Module._resolveFilename; Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
const { runDailyWorkReportTodos: run, completeWorkReportTodos: complete, pendingWorkReportDates } = require('../src/lib/work-report-sync.ts');
const { workReportTodoSchedule } = require('../src/lib/work-report-policy.ts');
const { ensureTodoSourceSchema } = require('../src/lib/todo-source-schema.ts');
const at = time => Date.parse(time + '+07:00');
if (child) { const result = run(db, Number(process.argv[4])); db.close(); console.log(JSON.stringify(result)); process.exit(0); }
db.prepare("UPDATE employees SET status='离职' WHERE role='employee'").run();
const workerName = '日报强制测试员工';
const workerId = Number(db.prepare("INSERT INTO employees(name,role,hire_date) VALUES (?,'employee','2026-10-19')").run(workerName).lastInsertRowid);
const sourceTasks = () => db.prepare("SELECT * FROM todos WHERE source_type='work_report' ORDER BY id").all();
const report = (date, status = '已提交', name = workerName) => Number(db.prepare('INSERT INTO work_reports(employee_name,report_date,status) VALUES (?,?,?)').run(name, date, status).lastInsertRowid);
const leave = (type, status, start = '2026-10-19', end = start) => db.prepare('INSERT INTO leave_requests(employee_name,leave_type,status,start_date,end_date,start_time,end_time) VALUES (?,?,?,?,?,?,?)').run(workerName, type, status, start, end, '09:00', '12:00');
let groups = 0;
function check(name, fn) {
  const rollback = Symbol();
  try { db.transaction(() => { fn(); throw rollback; }).immediate(); } catch (e) { if (e !== rollback) throw e; }
  groups++; console.log('PASS ' + name);
}
(async () => {
  check('Old-table migration is additive, repeatable and preserves every manual record', () => {
    const legacy = require('better-sqlite3')(':memory:');
    legacy.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY,content TEXT,assignee TEXT,status TEXT,priority TEXT); INSERT INTO todos VALUES (42,'原待办','原员工','未完成','普通')");
    ensureTodoSourceSchema(legacy); ensureTodoSourceSchema(legacy);
    assert.deepEqual(legacy.prepare('SELECT * FROM todos').get(), { id: 42, content: '原待办', assignee: '原员工', status: '未完成', priority: '普通', source_type: '', source_id: '' }); legacy.close();
  });
  check('No pre-Oct19 dates or pre-17:00 Bangkok tasks, exact 17:00 creates one urgent linked todo + staff notification', () => {
    for (const time of ['2026-10-17T18:00:00', '2026-10-18T18:00:00', '2026-10-19T16:59:59']) assert.equal(run(db, at(time)).todos, 0);
    assert.deepEqual(run(db, at('2026-10-19T17:00:00')), { todos: 1, notifications: 1 });
    const t = sourceTasks()[0]; assert.equal(t.content, '补交 10月19日 的日报'); assert.equal(t.priority, '紧急'); assert.equal(t.assignee, workerName); assert.equal(t.source_id, '2026-10-19');
    assert.equal(t.created_at, '2026-10-19T10:00:00.000Z');
    const n = db.prepare("SELECT * FROM notifications WHERE type='待办指派' AND related_id=?").get(String(t.id)); assert.equal(n.recipient, workerName);
    assert.equal(run(db, at('2026-10-19T23:59:59')).todos, 0); assert.equal(sourceTasks().length, 1);
  });
  check('Monday-Saturday required, Sunday skipped, next date has its own task, no historical sweep', () => {
    assert.equal(run(db, at('2026-10-24T17:00:00')).todos, 1);
    assert.equal(run(db, at('2026-10-25T17:00:00')).todos, 0);
    assert.equal(run(db, at('2026-10-26T17:00:00')).todos, 1);
    assert.deepEqual(sourceTasks().map(t => t.source_id), ['2026-10-24', '2026-10-26']);
    assert.equal(workReportTodoSchedule(Date.parse('2026-10-19T09:59:59Z')).due, false);
    assert.equal(workReportTodoSchedule(Date.parse('2026-10-19T10:00:00Z')).due, true);
  });
  check('Pending/approved sick/personal/annual leave (including half day or cross-day) exempt; rejected/other-day leave do not', () => {
    for (const type of ['病假', '事假', '年假']) for (const status of ['待审批', '已通过']) {
      leave(type, status); assert.equal(run(db, at('2026-10-19T17:00:00')).todos, 0); db.prepare('DELETE FROM leave_requests WHERE employee_name=?').run(workerName);
    }
    leave('病假', '已通过', '2026-10-18', '2026-10-20'); assert.equal(run(db, at('2026-10-19T17:00:00')).todos, 0);
    db.prepare('DELETE FROM leave_requests WHERE employee_name=?').run(workerName);
    leave('事假', '已驳回'); leave('年假', '待审批', '2026-10-20'); assert.equal(run(db, at('2026-10-19T17:00:00')).todos, 1);
  });
  check('Submitted reports exempt; returned reports require resubmit; only active employees who have joined are checked', () => {
    report('2026-10-19'); assert.equal(run(db, at('2026-10-19T17:00:00')).todos, 0);
    db.prepare("UPDATE work_reports SET status='退回' WHERE employee_name=?").run(workerName);
    for (const status of ['试用期', '待离职', '离职', '停薪留职']) db.prepare("INSERT INTO employees(name,role,status,hire_date) VALUES (?,'employee',?,'2026-10-19')").run('状态' + status, status);
    db.prepare("INSERT INTO employees(name,role,hire_date) VALUES ('未来入职','employee','2026-10-20')").run();
    assert.equal(run(db, at('2026-10-19T17:00:00')).todos, 3);
    assert.deepEqual(sourceTasks().map(t => t.assignee).sort(), [workerName, '状态试用期', '状态待离职'].sort());
  });
  check('Completion requires actual submitted report and exact source; manual/other employee/other date stay unchanged', () => {
    run(db, at('2026-10-19T17:00:00')); run(db, at('2026-10-20T17:00:00'));
    const manual = db.prepare("INSERT INTO todos(content,assignee) VALUES ('补交 10月19日 的日报',?)").run(workerName).lastInsertRowid;
    const other = db.prepare("INSERT INTO todos(content,assignee,source_type,source_id) VALUES ('另一员工日报','另一员工','work_report','2026-10-19')").run().lastInsertRowid;
    assert.equal(complete(db, workerName, '2026-10-19'), 0);
    report('2026-10-19'); assert.equal(complete(db, workerName, '2026-10-19'), 1); assert.equal(complete(db, workerName, '2026-10-19'), 0);
    assert.equal(sourceTasks().find(t => t.assignee === workerName && t.source_id === '2026-10-19').status, '已完成');
    assert.equal(db.prepare('SELECT status FROM todos WHERE id=?').get(manual).status, '未完成'); assert.equal(db.prepare('SELECT status FROM todos WHERE id=?').get(other).status, '未完成');
    assert.equal(sourceTasks().find(t => t.source_id === '2026-10-20').status, '未完成');
    const pending = require('../src/lib/boss-submissions.ts').bossPendingSubmissions(db); assert(!pending.items.some(i => i.category === 'todo'));
  });
  check('Failed notification rolls back todo and source claim; retry succeeds', () => {
    db.exec("CREATE TEMP TRIGGER fail_daily_notice BEFORE INSERT ON notifications WHEN NEW.type='待办指派' BEGIN SELECT RAISE(ABORT,'fixture send failed'); END");
    try { assert.throws(() => run(db, at('2026-10-19T17:00:00')), /fixture send failed/); assert.equal(sourceTasks().length, 0); } finally { db.exec('DROP TRIGGER fail_daily_notice'); }
    assert.equal(run(db, at('2026-10-19T17:01:00')).todos, 1);
  });
  check('Existing singleton minute worker runs daily at 17:00, retries failures, catches up same day and preserves hourly orders', () => {
    const calls = [], timers = []; let orders = 0, fail = false;
    function makeWorker() {
      const fakeDb = { prepare: () => ({ all: () => { orders++; return []; } }) };
      const context = vm.createContext({ exports: {}, require: id => {
        if (id === '@/lib/db') return { getDb: () => fakeDb };
        if (id === '@/lib/time') return { bangkokToday: () => '2026-10-19' };
        if (id === '@/lib/step-overdue') return { currentStepTimings: () => [] };
        if (id === '@/lib/work-report-policy') return { workReportTodoSchedule };
        if (id === '@/lib/work-report-sync') return { runDailyWorkReportTodos: (_, now) => { calls.push(now); if (fail) { fail = false; throw Error('fixture retry'); } } };
        throw Error('Unexpected scheduler dependency: ' + id);
      }, Date, Map, Set, console: { error() {} }, setInterval: (fn, ms) => { const timer = { fn, ms, unref() {} }; timers.push(timer); return timer; } });
      vm.runInContext(compile(fs.readFileSync(path.join(root, 'src/lib/order-reminders.ts'), 'utf8')), context); return context.exports;
    }
    const w = makeWorker(); w.ensureReminderWorker(); w.ensureReminderWorker(); assert.equal(timers.length, 1); assert.equal(timers[0].ms, 60000);
    for (const time of ['2026-10-18T17:00:00', '2026-10-19T16:59:00']) w.runReminderTick(at(time)); assert.equal(calls.length, 0);
    w.runReminderTick(at('2026-10-19T17:00:00')); w.runReminderTick(at('2026-10-19T17:30:00')); assert.equal(calls.length, 1);
    const orderCount = orders; w.runReminderTick(at('2026-10-19T18:00:00')); assert.equal(orders, orderCount + 1);
    fail = true; w.runReminderTick(at('2026-10-20T17:00:00')); w.runReminderTick(at('2026-10-20T17:01:00')); assert.equal(calls.length, 3);
    w.runReminderTick(at('2026-10-25T18:00:00')); assert.equal(calls.length, 3);
    makeWorker().runReminderTick(at('2026-10-26T18:00:00')); assert.equal(calls.length, 4);
  });
  const { signToken } = require('../src/lib/auth.ts'), { NextRequest } = require('next/server');
  require('../src/lib/deepseek.ts').analyzeWorkReport = async () => ({ label: '测试', comment: '', risk: false, riskDesc: '' });
  const submit = require('../src/app/api/work-reports/route.ts'), edit = require('../src/app/api/work-reports/[id]/route.ts');
  const token = await signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(workerId));
  const req = (method, body, query = '') => new NextRequest('http://fixture/api/work-reports' + query, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const realNow = Date.now; Date.now = () => at('2026-10-22T18:00:00');
  try {
    run(db, at('2026-10-19T17:00:00')); run(db, at('2026-10-20T17:00:00'));
    assert.deepEqual((await submit.GET(req('GET', undefined, '?pending_dates=1'))).status, 200);
    assert.deepEqual(pendingWorkReportDates(db, workerName, '2026-10-22'), ['2026-10-20', '2026-10-19']);
    let response = await submit.POST(req('POST', { report_date: '2026-10-19', completed_items: ['补交历史日报'] })); assert.equal(response.status, 201); assert.equal((await response.json()).is_backfill, 1);
    assert.equal(sourceTasks().find(t => t.source_id === '2026-10-19').status, '已完成');
    response = await submit.POST(req('POST', { report_date: '2026-10-18', completed_items: ['不允许随意补交'] })); assert.equal(response.status, 400);
    const returned = report('2026-10-20', '退回');
    response = await edit.PATCH(req('PATCH', { completed_items: ['退回后重提'] }), { params: Promise.resolve({ id: String(returned) }) }); assert.equal(response.status, 200);
    assert.equal(sourceTasks().find(t => t.source_id === '2026-10-20').status, '已完成');
    const count = sourceTasks().length; await submit.GET(req('GET')); assert.equal(sourceTasks().length, count, 'Page GET never dispatches missing-report tasks');
    groups++; console.log('PASS real POST/PATCH: older backfill allowed only for own linked dates; submit/resubmit auto-complete; GET is read-only');
  } finally { Date.now = realNow; }
  const { execFile } = require('node:child_process');
  const spawn = () => new Promise((resolve, reject) => execFile(process.execPath, [__filename, '--worker', path.join(fixture, 'fixture.db'), String(at('2026-10-23T17:00:00'))], { timeout: 20000 }, (error, out) => error ? reject(error) : resolve(JSON.parse(out.trim().split('\n').at(-1)))));
  const concurrent = await Promise.all([spawn(), spawn()]); assert.equal(concurrent.reduce((sum, r) => sum + r.todos, 0), 1);
  groups++; console.log('PASS two independent workers create only one same-employee/date task and notification');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); db.close();
  console.log(`REPORT TODOS: ${groups} groups passed; isolated fixture ${fixture}`);
})().catch(e => { console.error(e); try { db.close(); } catch {} process.exitCode = 1; });
