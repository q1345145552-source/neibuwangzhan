#!/usr/bin/env node
// Real routes and a new isolated SQLite fixture; no production DB or external AI/network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const root = path.resolve(__dirname, '..'), fixture = fs.mkdtempSync('/tmp/xt-boss-pending-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'boss-pending-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const resolve = Module._resolveFilename; Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
require('../src/lib/deepseek.ts').analyzeWorkReport = async () => ({ label: '测试', comment: '', risk: false, riskDesc: '' });
const { signToken } = require('../src/lib/auth.ts'), { NextRequest } = require('next/server');
const { reportSubmissionRevision, reflectionSubmissionRevision, BOSS_SUBMISSION_TYPES } = require('../src/lib/boss-submission-types.ts');
const { ensureBossSubmissionSchema } = require('../src/lib/boss-submissions.ts');
const load = name => require('../src/app/api/' + name + '/route.ts');
const routes = { pending: load('boss-supervision/pending'), seen: load('boss-supervision/pending/seen'), leave: load('leave'), attendance: load('attendance/request'),
  notice: load('notice-rules/[id]/implementation'), noticeReview: load('notice-rules/[id]/implementations/[recordId]/review'), report: load('work-reports'), reportEdit: load('work-reports/[id]'),
  meeting: load('meetings/[id]/reflections'), reflection: load('meetings/[id]/reflections/[rid]'), todo: load('todos/[id]'), problem: load('problems/[id]'), customers: load('customers'), messages: load('notifications'), badge: load('notifications/unread-count') };
const users = {}, tokens = {};
const current = require('../src/lib/time.ts').bangkokToday();
let groups = 0;
async function check(name, fn) { await fn(); groups++; console.log('PASS ' + name); }
(async () => {
  db.prepare("UPDATE employees SET status='离职' WHERE role='admin'").run();
  for (const [key, role] of [['admin', 'admin'], ['admin2', 'admin'], ['employee', 'employee'], ['client', 'client']]) {
    const id = Number(db.prepare('INSERT INTO employees(name,role,must_change_password) VALUES (?,?,0)').run('汇总测试' + key, role).lastInsertRowid);
    users[key] = db.prepare('SELECT * FROM employees WHERE id=?').get(id); tokens[key] = await signToken(users[key]);
  }
  async function call(route, method, role = 'employee', body, params = {}) {
    const r = await routes[route][method](new NextRequest('http://fixture/api/' + route, { method, headers: { ...(role ? { Authorization: 'Bearer ' + tokens[role] } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(params) });
    return { status: r.status, body: await r.json(), response: r };
  }
  const pending = async () => (await call('pending', 'GET', 'admin')).body;
  const messages = () => db.prepare("SELECT * FROM notifications WHERE related_type='boss_submission' ORDER BY id").all();
  const employee = users.employee.name;
  const historical = Number(db.prepare("INSERT INTO work_reports(employee_name,report_date,completed_items,status,submitted_at) VALUES (?,'2026-01-01','[\"历史日报\"]','已提交','2026-01-01T10:00:00.000Z')").run(employee).lastInsertRowid);
  await check('Additive schema and historical pending data, without historical notification spam', async () => {
    ensureBossSubmissionSchema(db); ensureBossSubmissionSchema(db);
    assert((await pending()).items.some(i => i.category === 'report' && i.source_id === historical)); assert.equal(messages().length, 0);
  });
  const noticeId = Number(db.prepare("INSERT INTO notice_rules(title,body,type,publisher_id,publisher_name,recipient_mode) VALUES ('测试落实通知','正文','通知',?,?,'selected')").run(users.admin.id, users.admin.name).lastInsertRowid);
  const noticeRecord = Number(db.prepare('INSERT INTO notice_rule_implementations(notice_id,employee_id,employee_name,printed) VALUES (?,?,?,1)').run(noticeId, users.employee.id, employee).lastInsertRowid);
  db.prepare("INSERT INTO file_uploads(filename,uploaded_by_id,uploaded_by_role,mime_type,size) VALUES ('pending.png',?,'employee','image/png',100)").run(users.employee.id);
  const meetingId = Number(db.prepare("INSERT INTO meetings(title,meeting_date,participants) VALUES ('测试会议',?,?)").run(current, JSON.stringify([employee])).lastInsertRowid);
  const todoId = Number(db.prepare('INSERT INTO todos(content,assignee,created_by) VALUES (?,?,?)').run('完成后待确认', employee, users.admin.name).lastInsertRowid);
  const problemId = Number(db.prepare("INSERT INTO problems(problem_number,company_name,assignee,status) VALUES ('PROB-TEST','测试公司',?,'跟进中')").run(employee).lastInsertRowid);
  db.prepare("INSERT INTO points_records(employee_name,points,reason,rule_key) VALUES (?,100,'测试积分','customer_claim')").run(employee);
  const ids = { notice: noticeRecord, todo: todoId, problem: problemId };
  await check('All eight real employee submission routes create one notification per active admin', async () => {
    let r = await call('leave', 'POST', 'employee', { leave_type: '事假', start_date: current, end_date: current, reason: '测试申请' }); assert.equal(r.status, 201); ids.leave = r.body.id;
    r = await call('attendance', 'POST', 'employee', { date: current, time: '09:00', reason: '测试补签' }); assert.equal(r.status, 201); ids.attendance = r.body.id;
    r = await call('notice', 'POST', 'employee', { photo: '/api/files/pending.png', statement: '已打印放置桌面' }, { id: String(noticeId) }); assert.equal(r.status, 200);
    r = await call('report', 'POST', 'employee', { report_date: current, completed_items: ['已完成测试'], summary: '测试日报' }); assert.equal(r.status, 201, JSON.stringify(r.body)); ids.report = r.body.id;
    r = await call('meeting', 'POST', 'employee', { content: '会议心得测试' }, { id: String(meetingId) }); assert.equal(r.status, 201); ids.meeting = r.body.id;
    r = await call('todo', 'PATCH', 'employee', { status: '已完成' }, { id: String(todoId) }); assert.equal(r.status, 200);
    r = await call('problem', 'PATCH', 'employee', { status: '老板验收', resolve_note: '已解决请验收' }, { id: String(problemId) }); assert.equal(r.status, 200);
    r = await call('customers', 'POST', 'employee', { action: 'withdraw_request', amount: 30 }); assert.equal(r.status, 200); ids.withdrawal = db.prepare('SELECT MAX(id) id FROM point_withdrawals').get().id;
    assert.equal(messages().length, 16);
    for (const category of Object.keys(BOSS_SUBMISSION_TYPES)) {
      const rows = messages().filter(n => n.related_id === `${category}:${ids[category]}`); assert.equal(rows.length, 2, category);
      assert(rows.every(n => [users.admin.name, users.admin2.name].includes(n.recipient) && n.body.includes(employee)));
    }
    assert.equal(db.prepare("SELECT count(*) n FROM notifications WHERE type='待办完成'").get().n, 0, 'No duplicate legacy admin todo message');
  });
  await check('Pending response includes all eight categories, employee/summary/time/href and newest-first sorting', async () => {
    const r = await call('pending', 'GET', 'admin'); assert.equal(r.status, 200); assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
    assert.equal(r.body.total, 9);
    for (const category of Object.keys(BOSS_SUBMISSION_TYPES)) assert(r.body.items.some(i => i.category === category && i.source_id === ids[category]), category);
    for (const item of r.body.items) { assert.equal(item.employee_name, employee); assert.equal(item.employee_id, users.employee.id); assert(item.summary && item.category_label && item.href.startsWith('/') && !isNaN(Date.parse(item.submitted_at))); }
    assert.deepEqual(r.body.items.map(i => i.submitted_at), r.body.items.map(i => i.submitted_at).sort().reverse());
    assert.equal(messages().length, 16, 'Reading pending does not send reminders');
  });
  await check('Admin message center list/unread/mark-read contain submissions; staff/client cannot access pending or receipts', async () => {
    const list = await call('messages', 'GET', 'admin'); assert.equal(list.body.filter(n => n.related_type === 'boss_submission').length, 8);
    assert.equal((await call('badge', 'GET', 'admin')).body.count, 8);
    const id = list.body[0].id; await call('messages', 'PATCH', 'admin', { id }); assert.equal((await call('badge', 'GET', 'admin')).body.count, 7);
    assert.equal((await pending()).total, 9, 'Message read does not mean business handled');
    for (const role of [null, 'employee', 'client']) {
      assert.equal((await call('pending', 'GET', role)).status, role ? 403 : 401);
      assert.equal((await call('seen', 'POST', role, { category: 'report', items: [] })).status, role ? 403 : 401);
    }
    assert.equal((await call('messages', 'GET', 'employee')).body.some(n => n.related_type === 'boss_submission'), false);
    assert.equal((await call('badge', 'GET', 'employee')).body.count, 0);
    assert.equal((await call('messages', 'GET', 'client')).status, 403);
    const privateId = Number(db.prepare("INSERT INTO notifications(type,title,recipient,related_type,related_id) VALUES ('','员工提交了日报',?,'boss_submission','report:1')").run(employee).lastInsertRowid);
    await call('messages', 'PATCH', 'employee', { id: privateId }); await call('messages', 'PATCH', 'employee', { markAll: true });
    assert.equal(db.prepare('SELECT is_read FROM notifications WHERE id=?').get(privateId).is_read, 0);
  });
  const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
  await check('Opening report/reflection detail removes only that version; stale receipts cannot dismiss resubmissions', async () => {
    const report = row('work_reports', ids.report), reflection = row('meeting_reflections', ids.meeting);
    assert.equal((await call('seen', 'POST', 'admin', { category: 'report', items: [{ id: report.id, revision: reportSubmissionRevision(report) }] })).body.marked, 1);
    assert.equal((await call('seen', 'POST', 'admin', { category: 'meeting', items: [{ id: reflection.id, revision: reflectionSubmissionRevision(reflection) }] })).body.marked, 1);
    assert(!(await pending()).items.some(i => i.id === `report:${report.id}` || i.id === `meeting:${reflection.id}`));
    await call('reportEdit', 'PATCH', 'admin', { action: 'review', rating: 5, comment: '已点评' }, { id: String(report.id) });
    await call('reportEdit', 'PATCH', 'admin', { action: 'reject' }, { id: String(report.id) });
    let r = await call('reportEdit', 'PATCH', 'employee', { completed_items: ['日报重新提交'] }, { id: String(report.id) }); assert.equal(r.status, 200);
    await call('reflection', 'PATCH', 'admin', { action: 'reject' }, { id: String(meetingId), rid: String(reflection.id) });
    r = await call('reflection', 'PATCH', 'employee', { content: '心得重新提交' }, { id: String(meetingId), rid: String(reflection.id) }); assert.equal(r.status, 200);
    assert.equal((await call('seen', 'POST', 'admin', { category: 'report', items: [{ id: report.id, revision: reportSubmissionRevision(report) }] })).body.marked, 0);
    assert.equal((await call('seen', 'POST', 'admin', { category: 'meeting', items: [{ id: reflection.id, revision: reflectionSubmissionRevision(reflection) }] })).body.marked, 0);
    assert((await pending()).items.some(i => i.id === `report:${report.id}`)); assert((await pending()).items.some(i => i.id === `meeting:${reflection.id}`));
    assert.equal(db.prepare("SELECT generation FROM boss_submission_state WHERE category='report' AND source_id=?").get(report.id).generation, 2);
  });
  await check('Todo repeat completion sends no duplicate; admin confirmation is separate, reopen/completion creates a new round', async () => {
    const before = messages().length;
    await call('todo', 'PATCH', 'employee', { status: '已完成' }, { id: String(todoId) }); assert.equal(messages().length, before);
    assert.equal((await call('todo', 'PATCH', 'employee', { action: 'confirm' }, { id: String(todoId) })).status, 403);
    assert.equal((await call('todo', 'PATCH', 'admin', { action: 'confirm' }, { id: String(todoId) })).status, 200);
    assert(!(await pending()).items.some(i => i.category === 'todo'));
    await call('todo', 'PATCH', 'employee', { status: '未完成' }, { id: String(todoId) });
    await call('todo', 'PATCH', 'employee', { status: '已完成' }, { id: String(todoId) }); assert.equal(messages().length, before + 2);
    assert((await pending()).items.some(i => i.category === 'todo'));
  });
  await check('Approvals/returns/acceptance remove pending entries; returned notice and problem submissions notify again', async () => {
    await call('leave', 'PATCH', 'admin', { id: ids.leave, status: '已驳回' });
    await call('attendance', 'PATCH', 'admin', { id: ids.attendance, status: '已驳回' });
    const { submissionToken } = require('../src/lib/notice-rule-review.ts');
    let r = await call('noticeReview', 'POST', 'admin', { decision: '打回', comment: '重拍', submission_token: submissionToken(row('notice_rule_implementations', noticeRecord)) }, { id: String(noticeId), recordId: String(noticeRecord) }); assert.equal(r.status, 200);
    await call('problem', 'PATCH', 'admin', { status: '跟进中' }, { id: String(problemId) });
    await call('customers', 'POST', 'admin', { action: 'withdraw_review', withdrawal_id: ids.withdrawal, approve: false });
    assert(!(await pending()).items.some(i => ['leave', 'attendance', 'notice', 'problem', 'withdrawal'].includes(i.category)));
    const before = messages().length;
    assert.equal((await call('notice', 'POST', 'employee', { photo: '/api/files/pending.png', statement: '重新拍照落实' }, { id: String(noticeId) })).status, 200);
    assert.equal((await call('notice', 'POST', 'employee', { photo: '/api/files/pending.png', statement: '重复提交' }, { id: String(noticeId) })).status, 409);
    await call('problem', 'PATCH', 'employee', { status: '老板验收', resolve_note: '问题重新解决' }, { id: String(problemId) });
    assert.equal(messages().length, before + 4);
    assert((await pending()).items.some(i => i.category === 'notice')); assert((await pending()).items.some(i => i.category === 'problem'));
  });
  await check('Submission + notification are atomic if notification insert fails; migration preserves existing business rows', async () => {
    const before = db.prepare('SELECT count(*) n FROM attendance_requests').get().n;
    db.exec("CREATE TEMP TRIGGER reject_boss_notice BEFORE INSERT ON notifications WHEN NEW.related_type='boss_submission' BEGIN SELECT RAISE(ABORT,'fixture notification failure'); END");
    try { await assert.rejects(call('attendance', 'POST', 'employee', { date: current, time: '10:00' }), /fixture notification failure/); } finally { db.exec('DROP TRIGGER reject_boss_notice'); }
    assert.equal(db.prepare('SELECT count(*) n FROM attendance_requests').get().n, before);
    assert.equal(row('work_reports', historical).completed_items, '["历史日报"]');
    assert.equal(db.pragma('quick_check', { simple: true }), 'ok');
  });
  db.close(); console.log(`BOSS PENDING: ${groups} groups passed; isolated fixture ${fixture}`);
})().catch(e => { console.error(e); try { db.close(); } catch {} process.exitCode = 1; });
