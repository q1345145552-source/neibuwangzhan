#!/usr/bin/env node
// Real SQLite + notice/problem routes, fresh /tmp fixtures only; no production data or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const child = ['--assign', '--problem'].includes(process.argv[2]);
const fixture = child ? path.dirname(process.argv[3]) : fs.mkdtempSync('/tmp/xt-submission-todos-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'submission-todo-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
const { signToken } = require('../src/lib/auth.ts'), { NextRequest } = require('next/server');
const load = name => require('../src/app/api/' + name + '/route.ts');
const routes = { notice: load('notice-rules'), print: load('notice-rules/[id]/print'), implement: load('notice-rules/[id]/implementation'), review: load('notice-rules/[id]/implementations/[recordId]/review'), problem: load('problems'), edit: load('problems/[id]') };
const { assignNoticeTodo, syncNoticeTodo, assignProblemTodo } = require('../src/lib/submission-todos.ts');
const { bossPendingSubmissions } = require('../src/lib/boss-submissions.ts');
const { ensureTodoSourceSchema } = require('../src/lib/todo-source-schema.ts');
const { submissionToken } = require('../src/lib/notice-rule-review.ts');
const staff = ['业务测试甲', '业务测试乙'], admin = '业务测试老板', client = '业务测试客户';
const users = {}, tokens = {};
const linked = (type, id) => db.prepare('SELECT * FROM todos WHERE source_type=? AND source_id=? ORDER BY id').all(type, String(id));
const records = id => db.prepare('SELECT * FROM notice_rule_implementations WHERE notice_id=? ORDER BY id').all(id);
const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id);
const totals = () => ['notice_rules', 'notice_rule_implementations', 'problems', 'todos', 'notifications'].map(table => db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n);
async function call(route, method, name = admin, body, params = {}) {
  const response = await routes[route][method](new NextRequest('http://fixture/api/' + route, { method, headers: { ...(name ? { Authorization: 'Bearer ' + tokens[name] } : {}), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve(Object.fromEntries(Object.entries(params).map(([key, value]) => [key, String(value)]))) });
  return { status: response.status, body: await response.json() };
}
async function publish(extra = {}) {
  const r = await call('notice', 'POST', admin, { title: '办公规范', body: '打印后放在桌面执行', type: '通知', recipient_mode: 'all', ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body;
}
const problemBody = extra => ({ company_name: '测试公司', description: '核对账单异常', assignee: staff[0], source: '内部发现', priority: '普通', problem_type: '金额问题', ...extra });
async function createProblem(name = admin, extra = {}) { const r = await call('problem', 'POST', name, problemBody(extra)); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; }
const implement = id => call('implement', 'POST', staff[0], { photo: '/api/files/own.png', statement: '已打印放置桌面' }, { id });
async function review(id, recordId, decision) { return call('review', 'POST', admin, { decision, comment: decision === '打回' ? '照片不清晰，请重交' : '通过', submission_token: submissionToken(row('notice_rule_implementations', recordId)) }, { id, recordId }); }
let groups = 0;
async function check(label, fn) {
  db.exec('SAVEPOINT submission_fixture');
  try { await fn(); groups++; console.log('PASS ' + label); }
  finally { db.exec('ROLLBACK TO submission_fixture; RELEASE submission_fixture'); }
}
(async () => {
  if (!child) {
    db.prepare("UPDATE employees SET status='离职' WHERE role='employee'").run();
    for (const [name, role] of [[admin, 'admin'], ...staff.map(name => [name, 'employee']), [client, 'client']]) db.prepare('INSERT INTO employees(name,role,must_change_password) VALUES (?,?,0)').run(name, role);
  }
  for (const name of [admin, ...staff, client]) { users[name] = db.prepare('SELECT * FROM employees WHERE name=?').get(name); tokens[name] = await signToken(users[name]); }
  if (child) {
    let result;
    if (process.argv[2] === '--assign') {
      db.transaction(() => { assignNoticeTodo(db, Number(process.argv[4])); assignProblemTodo(db, Number(process.argv[5])); }).immediate(); result = { success: true };
    } else result = await createProblem();
    db.close(); console.log(JSON.stringify(result)); return;
  }
  db.prepare("INSERT INTO file_uploads(filename,uploaded_by_id,uploaded_by_role,mime_type,size) VALUES ('own.png',?,'employee','image/png',100),('other.png',?,'employee','image/png',100)").run(users[staff[0]].id, users[staff[1]].id);
  await check('Additive repeatable migration keeps manual/report/meeting data and isolates notice/problem uniqueness', () => {
    const legacy = require('better-sqlite3')(':memory:');
    legacy.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY,content TEXT,assignee TEXT,status TEXT); INSERT INTO todos VALUES(42,'旧手工待办','甲','未完成')");
    ensureTodoSourceSchema(legacy); ensureTodoSourceSchema(legacy);
    assert.deepEqual(legacy.prepare('SELECT * FROM todos').get(), { id: 42, content: '旧手工待办', assignee: '甲', status: '未完成', source_type: '', source_id: '' });
    for (const type of ['work_report', 'meeting', 'notice', 'problem']) legacy.prepare('INSERT INTO todos(content,assignee,source_type,source_id) VALUES (?,?,?,?)').run(type, '甲', type, '1');
    for (const type of ['notice', 'problem']) assert.throws(() => legacy.prepare('INSERT INTO todos(assignee,source_type,source_id) VALUES (?,?,?)').run('乙', type, '1'), /UNIQUE/);
    assert.equal(legacy.prepare('SELECT COUNT(*) n FROM todos').get().n, 5); legacy.close();
  });
  await check('Publish all creates urgent tasks for every recipient, using individual implementation IDs; selected rules deduplicate employee IDs', async () => {
    const notice = await publish(); assert.equal(notice.recipient_count, 2);
    for (const r of records(notice.id)) {
      const [t] = linked('notice', r.id); assert.equal(t.assignee, r.employee_name); assert.equal(t.priority, '紧急'); assert.equal(t.status, '未完成'); assert.equal(t.content, '落实通知「办公规范」(打印并拍照)');
      assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='待办指派' AND related_id=? AND recipient=?").get(String(t.id), r.employee_name).n, 1);
      db.transaction(() => { assignNoticeTodo(db, r.id); assignNoticeTodo(db, r.id); }).immediate(); assert.equal(linked('notice', r.id).length, 1);
    }
    const rule = await publish({ type: '规则', title: '新规则', recipient_mode: 'selected', recipient_ids: [users[staff[0]].id, users[staff[0]].id] });
    assert.equal(rule.recipient_count, 1); assert.equal(linked('notice', records(rule.id)[0].id)[0].content, '落实通知「新规则」(打印并拍照)');
    for (const name of [staff[0], client]) assert.equal((await call('notice', 'POST', name, { title: '禁止发布' })).status, 403);
    const before = totals(); assert.equal((await call('notice', 'POST', admin, { title: '无效对象', body: '正文', type: '通知', recipient_mode: 'selected', recipient_ids: [users[client].id] })).status, 400); assert.deepEqual(totals(), before);
  });
  await check('Notice print/photo/statement are all required; another employee photo, non-recipient and customer cannot complete it', async () => {
    const n = await publish({ recipient_mode: 'selected', recipient_ids: [users[staff[0]].id] }), r = records(n.id)[0];
    assert.equal((await implement(n.id)).status, 409);
    await call('print', 'POST', staff[0], undefined, { id: n.id }); assert.equal(linked('notice', r.id)[0].status, '未完成');
    for (const body of [{ statement: '缺照片' }, { photo: '/api/files/own.png' }, { photo: '/api/files/other.png', statement: '别人的照片' }]) assert.equal((await call('implement', 'POST', staff[0], body, { id: n.id })).status, 400);
    assert.equal((await call('implement', 'POST', staff[1], { photo: '/api/files/other.png', statement: '未接收' }, { id: n.id })).status, 404);
    for (const name of [admin, client]) assert.equal((await call('implement', 'POST', name, { photo: '/api/files/own.png', statement: '禁止' }, { id: n.id })).status, 403);
    assert.equal(linked('notice', r.id)[0].status, '未完成');
  });
  await check('Real implementation submission completes only its source task, preserves other recipients/manual/other business, and adds no redundant boss todo review', async () => {
    const n = await publish(), rows = records(n.id), own = rows.find(r => r.employee_name === staff[0]);
    const manual = db.prepare('INSERT INTO todos(content,assignee) VALUES (?,?)').run('落实通知「办公规范」(打印并拍照)', staff[0]).lastInsertRowid;
    const p = await createProblem();
    await call('print', 'POST', staff[0], undefined, { id: n.id }); assert.equal((await implement(n.id)).status, 200);
    const t = linked('notice', own.id)[0]; assert.equal(t.status, '已完成'); assert(t.completed_at);
    assert.equal(linked('notice', rows.find(r => r.id !== own.id).id)[0].status, '未完成'); assert.equal(linked('problem', p.id)[0].status, '未完成'); assert.equal(row('todos', manual).status, '未完成');
    db.transaction(() => syncNoticeTodo(db, own.id)).immediate(); assert.equal(linked('notice', own.id)[0].completed_at, t.completed_at);
    const before = totals(); assert.equal((await implement(n.id)).status, 409); assert.deepEqual(totals(), before);
    const pending = bossPendingSubmissions(db).items; assert(pending.some(i => i.category === 'notice' && i.source_id === own.id)); assert(!pending.some(i => i.category === 'todo' && i.source_id === t.id));
  });
  await check('Notice return reopens the same task; resubmit completes it again; acceptance keeps it complete', async () => {
    const n = await publish(), own = records(n.id).find(r => r.employee_name === staff[0]);
    await call('print', 'POST', staff[0], undefined, { id: n.id }); await implement(n.id); const tid = linked('notice', own.id)[0].id;
    assert.equal((await review(n.id, own.id, '打回')).status, 200); assert.equal(row('todos', tid).status, '未完成'); assert.equal(row('todos', tid).completed_at, '');
    assert.equal((await implement(n.id)).status, 200); assert.equal(row('todos', tid).status, '已完成');
    assert.equal((await review(n.id, own.id, '通过')).status, 200); assert.equal(row('todos', tid).status, '已完成'); assert.equal(linked('notice', own.id).length, 1);
  });
  await check('Publish notification failure rolls back the entire notice, all recipient records/tasks, including the first recipient', async () => {
    const before = totals();
    db.exec(`CREATE TEMP TRIGGER fail_notice_dispatch BEFORE INSERT ON notifications WHEN NEW.type='待办指派' AND NEW.recipient='${staff[1]}' BEGIN SELECT RAISE(ABORT,'fixture dispatch failed'); END`);
    try { await assert.rejects(() => publish(), /fixture dispatch failed/); assert.deepEqual(totals(), before); }
    finally { db.exec('DROP TRIGGER fail_notice_dispatch'); }
  });
  await check('Notice completion failure rolls back submission and boss message together, leaving task unfinished', async () => {
    const n = await publish(), own = records(n.id).find(r => r.employee_name === staff[0]); await call('print', 'POST', staff[0], undefined, { id: n.id }); const before = totals();
    db.exec("CREATE TEMP TRIGGER fail_notice_finish BEFORE UPDATE ON todos WHEN OLD.source_type='notice' BEGIN SELECT RAISE(ABORT,'fixture completion failed'); END");
    try { await assert.rejects(() => implement(n.id), /fixture completion failed/); assert.deepEqual(totals(), before); assert.equal(row('notice_rule_implementations', own.id).submitted_at, null); assert.equal(linked('notice', own.id)[0].status, '未完成'); }
    finally { db.exec('DROP TRIGGER fail_notice_finish'); }
  });
  await check('Admin assigned and employee self-created problems both dispatch urgent tasks; original problem priority and assignment message remain', async () => {
    for (const name of [admin, staff[0]]) {
      const p = await createProblem(name), [t] = linked('problem', p.id);
      assert.equal(t.assignee, staff[0]); assert.equal(t.content, `处理问题 #${p.problem_number}：核对账单异常`); assert.equal(t.priority, '紧急'); assert.equal(p.priority, '普通'); assert.equal(p.status, '待处理');
      db.transaction(() => { assignProblemTodo(db, p.id); assignProblemTodo(db, p.id); }).immediate(); assert.equal(linked('problem', p.id).length, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='待办指派' AND related_id=?").get(String(t.id)).n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='problem_assigned' AND related_id=?").get(String(p.id)).n, name === admin ? 1 : 0);
    }
    assert.equal((await call('problem', 'POST', client, problemBody())).status, 403);
  });
  await check('Problem marked resolved completes task while waiting for boss; return reopens same task, resubmit/accept completes it without duplicate pending todo', async () => {
    const p = await createProblem(), tid = linked('problem', p.id)[0].id;
    assert.equal((await call('edit', 'PATCH', staff[1], { status: '跟进中' }, { id: p.id })).status, 403);
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '跟进中' }, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '未完成');
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '老板验收', resolve_note: '' }, { id: p.id })).status, 400); assert.equal(row('todos', tid).status, '未完成');
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '老板验收', resolve_note: '账目已核对完成' }, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '已完成');
    let pending = bossPendingSubmissions(db).items; assert(pending.some(i => i.category === 'problem' && i.source_id === p.id)); assert(!pending.some(i => i.category === 'todo' && i.source_id === tid));
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '已解决' }, { id: p.id })).status, 403);
    assert.equal((await call('edit', 'PATCH', admin, { status: '跟进中' }, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '未完成');
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '老板验收', resolve_note: '已修正重交' }, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '已完成');
    assert.equal((await call('edit', 'PATCH', admin, { status: '已解决' }, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '已完成'); assert.equal(linked('problem', p.id).length, 1);
    pending = bossPendingSubmissions(db).items; assert(!pending.some(i => i.category === 'problem' && i.source_id === p.id));
  });
  await check('Editing/reassigning a problem updates the same task and clears old seen state, without leaving work for the previous owner or duplicate dispatches', async () => {
    const p = await createProblem(), tid = linked('problem', p.id)[0].id; db.prepare("UPDATE todos SET seen_at='seen' WHERE id=?").run(tid);
    for (let i = 0; i < 2; i++) assert.equal((await call('edit', 'PATCH', admin, problemBody({ assignee: staff[1], description: '转交后的问题内容' }), { id: p.id })).status, 200);
    const t = row('todos', tid); assert.equal(t.assignee, staff[1]); assert.equal(t.seen_at, ''); assert(t.content.endsWith('：转交后的问题内容')); assert.equal(linked('problem', p.id).length, 1);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='待办指派' AND related_id=? AND recipient=?").get(String(tid), staff[1]).n, 1);
    assert.equal((await call('edit', 'PATCH', staff[0], { status: '跟进中' }, { id: p.id })).status, 403);
    await call('edit', 'PATCH', staff[1], { status: '跟进中' }, { id: p.id }); await call('edit', 'PATCH', staff[1], { status: '老板验收', resolve_note: '接手处理完成' }, { id: p.id }); assert.equal(row('todos', tid).status, '已完成');
  });
  await check('Problem create failure rolls back problem + task + notifications; finishing failure rolls back problem status and boss submission', async () => {
    let before = totals(); db.exec("CREATE TEMP TRIGGER fail_problem_notice BEFORE INSERT ON notifications WHEN NEW.type='problem_assigned' BEGIN SELECT RAISE(ABORT,'fixture problem create failed'); END");
    try { await assert.rejects(() => createProblem(), /fixture problem create failed/); assert.deepEqual(totals(), before); }
    finally { db.exec('DROP TRIGGER fail_problem_notice'); }
    const p = await createProblem(); await call('edit', 'PATCH', staff[0], { status: '跟进中' }, { id: p.id }); before = totals();
    db.exec("CREATE TEMP TRIGGER fail_problem_finish BEFORE UPDATE ON todos WHEN OLD.source_type='problem' BEGIN SELECT RAISE(ABORT,'fixture problem finish failed'); END");
    try { await assert.rejects(() => call('edit', 'PATCH', staff[0], { status: '老板验收', resolve_note: '待重试' }, { id: p.id }), /fixture problem finish failed/); assert.deepEqual(totals(), before); assert.equal(row('problems', p.id).status, '跟进中'); assert.equal(linked('problem', p.id)[0].status, '未完成'); }
    finally { db.exec('DROP TRIGGER fail_problem_finish'); }
  });
  await check('Explicitly deleting a suspended problem closes its task and preserves task history; old problems are not backfilled by reads/edits', async () => {
    const p = await createProblem(), tid = linked('problem', p.id)[0].id;
    await call('edit', 'PATCH', staff[0], { status: '搁置', suspend_reason: '业务取消' }, { id: p.id }); assert.equal(row('todos', tid).status, '未完成');
    assert.equal((await call('edit', 'DELETE', staff[0], undefined, { id: p.id })).status, 200); assert.equal(row('todos', tid).status, '已完成');
    const old = db.prepare("INSERT INTO problems(problem_number,company_name,description,assignee) VALUES ('LEGACY','历史公司','历史问题',?)").run(staff[0]).lastInsertRowid;
    await call('problem', 'GET'); await call('edit', 'PATCH', staff[0], problemBody(), { id: old }); assert.equal(linked('problem', old).length, 0);
  });
  const n = await publish({ recipient_mode: 'selected', recipient_ids: [users[staff[0]].id] }), recordId = records(n.id)[0].id;
  const p = await createProblem();
  const { execFile } = require('node:child_process');
  const spawn = mode => new Promise((resolve, reject) => execFile(process.execPath, [__filename, mode, db.name, String(recordId), String(p.id)], { timeout: 25000 }, (error, output) => error ? reject(error) : resolve(JSON.parse(output.trim().split('\n').at(-1)))));
  const before = totals(); await Promise.all([spawn('--assign'), spawn('--assign')]); assert.deepEqual(totals(), before); assert.equal(linked('notice', recordId).length, 1); assert.equal(linked('problem', p.id).length, 1);
  groups++; console.log('PASS concurrent independent assignment attempts do not duplicate tasks or notifications');
  const created = await Promise.all([spawn('--problem'), spawn('--problem')]); assert.notEqual(created[0].problem_number, created[1].problem_number); for (const problem of created) assert.equal(linked('problem', problem.id).length, 1);
  groups++; console.log('PASS simultaneous problem creation generates distinct problem numbers and one task per new problem');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); db.close(); console.log(`SUBMISSION TODOS: ${groups} groups passed; isolated fixture ${fixture}`);
})().catch(error => { console.error(error); try { db.close(); } catch {} process.exitCode = 1; });
