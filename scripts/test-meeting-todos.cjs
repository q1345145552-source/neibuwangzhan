#!/usr/bin/env node
// Real SQLite and route handlers; isolated /tmp data, no network or business database.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript');
const child = process.argv[2] === '--add';
const fixture = child ? path.dirname(process.argv[3]) : fs.mkdtempSync('/tmp/xt-meeting-todos-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'meeting-todo-fixture-only', CUSTOMER_SYNC_URL: '', SYNC_SECRET: '' });
const root = path.resolve(__dirname, '..');
require.extensions['.ts'] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, file);
const resolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...rest) { return resolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...rest); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
const { signToken } = require('../src/lib/auth.ts'), { NextRequest } = require('next/server');
const meetings = require('../src/app/api/meetings/route.ts');
const additions = require('../src/app/api/meetings/[id]/participants/route.ts');
const reflections = require('../src/app/api/meetings/[id]/reflections/route.ts');
const edits = require('../src/app/api/meetings/[id]/reflections/[rid]/route.ts');
const { completeMeetingTodos } = require('../src/lib/meeting-todos.ts');
const { ensureTodoSourceSchema } = require('../src/lib/todo-source-schema.ts');
const { bossPendingSubmissions } = require('../src/lib/boss-submissions.ts');
const { bangkokToday } = require('../src/lib/time.ts');
const names = ['会议测试甲', '会议测试乙', '会议测试丙', '会议测试丁', '会议测试戊'];
const admin = '会议测试老板', client = '会议测试客户';
const params = (id, rid) => ({ params: Promise.resolve({ id: String(id), rid: String(rid) }) });
const tokenFor = async name => signToken(db.prepare('SELECT * FROM employees WHERE name=?').get(name));
const req = (token, method, body) => new NextRequest('http://fixture/api/meetings', { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const tasks = id => db.prepare("SELECT * FROM todos WHERE source_type='meeting' AND source_id=? ORDER BY id").all(String(id));
let groups = 0;
async function check(label, fn) {
  db.exec('SAVEPOINT meeting_fixture');
  try { await fn(); groups++; console.log('PASS ' + label); }
  finally { db.exec('ROLLBACK TO meeting_fixture; RELEASE meeting_fixture'); }
}
(async () => {
  if (child) {
    const response = await additions.PATCH(req(await tokenFor(admin), 'PATCH', { participants: process.argv.slice(5) }), params(process.argv[4]));
    assert.equal(response.status, 200); db.close(); console.log(JSON.stringify(await response.json())); return;
  }
  for (const name of names) db.prepare("INSERT INTO employees(name,role) VALUES (?,'employee')").run(name);
  db.prepare("INSERT INTO employees(name,role) VALUES (?,'admin'),(?,'client')").run(admin, client);
  const adminToken = await tokenFor(admin), staffToken = await tokenFor(names[0]), clientToken = await tokenFor(client);
  const create = async (participants = names.slice(0, 2), extra = {}) => {
    const response = await meetings.POST(req(adminToken, 'POST', { title: '项目复盘', meeting_date: '2026-10-19', meeting_time: '10:00', agenda: '核对行动', topics: ['周会'], participants, ...extra }));
    assert.equal(response.status, 201); return response.json();
  };
  await check('Additive/repeatable migration preserves old manual and report records; meeting uniqueness does not cross source types', () => {
    const legacy = require('better-sqlite3')(':memory:');
    legacy.exec("CREATE TABLE todos(id INTEGER PRIMARY KEY,content TEXT,assignee TEXT,status TEXT); INSERT INTO todos VALUES(42,'原待办','原员工','未完成')");
    ensureTodoSourceSchema(legacy); ensureTodoSourceSchema(legacy);
    assert.deepEqual(legacy.prepare('SELECT * FROM todos').get(), { id: 42, content: '原待办', assignee: '原员工', status: '未完成', source_type: '', source_id: '' });
    legacy.exec("INSERT INTO todos(content,assignee,source_type,source_id) VALUES('日报','甲','work_report','1'),('会议','甲','meeting','1')");
    assert.throws(() => legacy.exec("INSERT INTO todos(assignee,source_type,source_id) VALUES('甲','meeting','1')"), /UNIQUE/); legacy.close();
  });
  await check('Admin creation dispatches one urgent source-linked task + notification per employee, trimming and deduplicating names', async () => {
    const m = await create([names[0], ' ' + names[0] + ' ', names[1]]);
    assert.deepEqual(JSON.parse(m.participants), names.slice(0, 2)); assert.deepEqual(JSON.parse(m.topics), ['周会']); assert.equal(m.story, '');
    assert.equal(tasks(m.id).length, 2);
    for (const t of tasks(m.id)) {
      assert.equal(t.content, '参加「项目复盘」并提交心得'); assert.equal(t.priority, '紧急'); assert.equal(t.status, '未完成'); assert.equal(t.created_by, '系统');
      assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='待办指派' AND related_id=? AND recipient=?").get(String(t.id), t.assignee).n, 1);
    }
    for (const token of [staffToken, clientToken]) {
      assert.equal((await meetings.POST(req(token, 'POST', { title: '不允许', meeting_date: '2026-10-19', participants: [names[0]] }))).status, 403);
      assert.equal((await additions.PATCH(req(token, 'PATCH', { participants: [names[2]] }), params(m.id))).status, 403);
    }
    for (const invalid of [client, admin, '不存在的员工']) assert.equal((await meetings.POST(req(adminToken, 'POST', { title: '不允许', meeting_date: '2026-10-19', participants: [names[0], invalid] }))).status, 400);
    assert.equal(tasks(m.id).length, 2);
  });
  await check('Failure dispatching notification rolls back the whole new meeting and its tasks', async () => {
    const before = db.prepare('SELECT COUNT(*) n FROM meetings').get().n;
    db.exec("CREATE TEMP TRIGGER fail_meeting_notice BEFORE INSERT ON notifications WHEN NEW.type='待办指派' BEGIN SELECT RAISE(ABORT,'fixture notification failed'); END");
    try { await assert.rejects(() => create(), /fixture notification failed/); assert.equal(db.prepare('SELECT COUNT(*) n FROM meetings').get().n, before); }
    finally { db.exec('DROP TRIGGER fail_meeting_notice'); }
    assert.equal(tasks((await create()).id).length, 2);
  });
  await check('Adding participants appends, immediately dispatches only new people, and duplicate requests preserve completed tasks', async () => {
    const m = await create(); const original = tasks(m.id)[0];
    db.prepare("UPDATE todos SET status='已完成',completed_at='first-completion' WHERE id=?").run(original.id);
    for (let i = 0; i < 2; i++) {
      const response = await additions.PATCH(req(adminToken, 'PATCH', { participants: [names[0], names[2], names[2]] }), params(m.id));
      assert.equal(response.status, 200); assert.deepEqual(JSON.parse((await response.json()).participants), names.slice(0, 3));
    }
    assert.equal(tasks(m.id).length, 3); assert.equal(tasks(m.id)[0].completed_at, 'first-completion');
    assert.equal((await additions.PATCH(req(adminToken, 'PATCH', { participants: [client] }), params(m.id))).status, 400);
    assert.equal((await additions.PATCH(req(adminToken, 'PATCH', { participants: [names[3]] }), params(999999))).status, 404);
    db.exec("CREATE TEMP TRIGGER fail_meeting_add BEFORE INSERT ON notifications WHEN NEW.type='待办指派' BEGIN SELECT RAISE(ABORT,'fixture append failed'); END");
    try { await assert.rejects(() => additions.PATCH(req(adminToken, 'PATCH', { participants: [names[3]] }), params(m.id)), /fixture append failed/); }
    finally { db.exec('DROP TRIGGER fail_meeting_add'); }
    assert.equal(tasks(m.id).length, 3); assert.deepEqual(JSON.parse(db.prepare('SELECT participants FROM meetings WHERE id=?').get(m.id).participants), names.slice(0, 3));
  });
  await check('Real reflection POST completes only own exact-source task; other meeting/manual/report/other employee stay unchanged; no redundant boss todo review', async () => {
    const m = await create(), other = await create([names[0]]);
    const manual = db.prepare("INSERT INTO todos(content,assignee) VALUES ('参加「项目复盘」并提交心得',?)").run(names[0]).lastInsertRowid;
    const report = db.prepare("INSERT INTO todos(content,assignee,source_type,source_id) VALUES ('日报',?,'work_report',?)").run(names[0], String(m.id)).lastInsertRowid;
    assert.equal(completeMeetingTodos(db, names[0], m.id), 0);
    assert.equal((await reflections.POST(req(staffToken, 'POST', { content: '' }), params(m.id))).status, 400);
    assert.equal((await reflections.POST(req(await tokenFor(names[2]), 'POST', { content: '冒用参会人' }), params(m.id))).status, 403);
    for (let i = 0; i < 2; i++) assert.equal((await reflections.POST(req(staffToken, 'POST', { content: '已确认行动事项 ' + i }), params(m.id))).status, 201);
    const completed = tasks(m.id).find(t => t.assignee === names[0]); assert.equal(completed.status, '已完成'); assert(completed.completed_at);
    assert.equal(tasks(m.id).find(t => t.assignee === names[1]).status, '未完成'); assert.equal(tasks(other.id)[0].status, '未完成');
    for (const id of [manual, report]) assert.equal(db.prepare('SELECT status FROM todos WHERE id=?').get(id).status, '未完成');
    const pending = bossPendingSubmissions(db).items;
    assert(!pending.some(i => i.category === 'todo' && i.source_id === completed.id)); assert.equal(pending.filter(i => i.category === 'meeting' && i.employee_name === names[0]).length, 2);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_logs WHERE action='会议心得提交自动完成待办' AND target_id=?").get(String(completed.id)).n, 1);
  });
  await check('Returned reflections do not qualify; real resubmission completes the matching task and resets old translation', async () => {
    const m = await create([names[0]]);
    const rid = db.prepare("INSERT INTO meeting_reflections(meeting_id,employee_name,content,content_zh,status) VALUES (?,?,'旧心得','旧翻译','退回')").run(m.id, names[0]).lastInsertRowid;
    assert.equal(completeMeetingTodos(db, names[0], m.id), 0);
    const response = await edits.PATCH(req(staffToken, 'PATCH', { content: '修改后重交' }), params(m.id, rid));
    assert.equal(response.status, 200); assert.equal((await response.json()).content_zh, ''); assert.equal(tasks(m.id)[0].status, '已完成');
  });
  await check('Adding a historical participant who already submitted leaves no false unfinished task or duplicate assignment notice', async () => {
    const m = await create([names[0]]);
    db.prepare("INSERT INTO meeting_reflections(meeting_id,employee_name,content,status) VALUES (?,?,'原有心得','已提交')").run(m.id, names[1]);
    const response = await additions.PATCH(req(adminToken, 'PATCH', { participants: [names[1]] }), params(m.id));
    assert.equal(response.status, 200);
    const task = tasks(m.id).find(t => t.assignee === names[1]); assert.equal(task.status, '已完成');
    assert.equal(db.prepare("SELECT COUNT(*) n FROM notifications WHERE type='待办指派' AND related_id=?").get(String(task.id)).n, 0);
  });
  await check('Reflection + completion roll back together on boss notification failure', async () => {
    const m = await create([names[0]]);
    db.exec("CREATE TEMP TRIGGER fail_reflection_notice BEFORE INSERT ON notifications WHEN NEW.related_type='boss_submission' BEGIN SELECT RAISE(ABORT,'fixture reflection failed'); END");
    try { await assert.rejects(() => reflections.POST(req(staffToken, 'POST', { content: '失败后可重试' }), params(m.id)), /fixture reflection failed/); }
    finally { db.exec('DROP TRIGGER fail_reflection_notice'); }
    assert.equal(tasks(m.id)[0].status, '未完成'); assert.equal(db.prepare('SELECT COUNT(*) n FROM meeting_reflections WHERE meeting_id=?').get(m.id).n, 0);
  });
  await check('Yesterday meeting GET does not generate a second legacy catch-up task; original task/history remain', async () => {
    const yesterday = new Date(Date.parse(bangkokToday() + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const m = await create(undefined, { meeting_date: yesterday });
    const before = db.prepare('SELECT COUNT(*) n FROM todos').get().n;
    for (let i = 0; i < 2; i++) assert.equal((await meetings.GET(req(adminToken, 'GET'))).status, 200);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM todos').get().n, before); assert.equal(tasks(m.id).length, 2);
  });
  const m = await create([names[0]]);
  const { execFile } = require('node:child_process');
  const spawn = people => new Promise((resolve, reject) => execFile(process.execPath, [__filename, '--add', db.name, String(m.id), ...people], { timeout: 25000 }, (error, output) => error ? reject(error) : resolve(JSON.parse(output.trim().split('\n').at(-1)))));
  await Promise.all([spawn([names[1], names[3]]), spawn([names[2], names[3]])]);
  assert.equal(tasks(m.id).length, 4); assert.deepEqual(new Set(JSON.parse(db.prepare('SELECT participants FROM meetings WHERE id=?').get(m.id).participants)), new Set(names.slice(0, 4)));
  assert.equal(tasks(m.id).filter(t => t.assignee === names[3]).length, 1);
  groups++; console.log('PASS concurrent independent participant requests merge without loss or duplicate tasks');
  assert.equal(db.pragma('quick_check', { simple: true }), 'ok'); db.close();
  console.log(`MEETING TODOS: ${groups} groups passed; isolated fixture ${fixture}`);
})().catch(error => { console.error(error); try { db.close(); } catch {} process.exitCode = 1; });
