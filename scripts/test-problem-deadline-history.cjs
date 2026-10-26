#!/usr/bin/env node
// Actual problem handlers/SQL and schema excerpts on fresh :memory: SQLite only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
const historyStart = schema.indexOf('// 问题截止日期历史'), historyEnd = schema.indexOf('// ── 性能索引', historyStart);
assert(historyStart > schema.indexOf('problems 迁移失败') && historyEnd > historyStart);
function ensureHistory(database) { vm.runInNewContext(schema.slice(historyStart, historyEnd), { database }); }
function load(file, dependencies) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
    { exports, URL, Response, Date, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error('Forbidden dependency: ' + name); } });
  return exports;
}
function createProblemDeadlineHarness() {
  const native = new DatabaseSync(':memory:'); native.exec('PRAGMA foreign_keys = ON');
  for (const table of ['problems', 'problem_follow_ups', 'problem_attachments', 'audit_logs']) {
    const match = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\n    \\);')); assert(match, table); native.exec(match[0]);
  }
  ensureHistory(native); native.exec('CREATE TABLE orders (id TEXT PRIMARY KEY)');
  native.prepare('INSERT INTO problems (id,problem_number,company_name,description,assignee,source,deadline,created_by) VALUES (?,?,?,?,?,?,?,?)').run(1, 'WT-TEST-1', '测试公司', '核对资料', 'Bam', '内部发现', '2026-10-10', '老板');
  native.prepare('INSERT INTO problems (id,problem_number,company_name,description,assignee,source,created_by) VALUES (?,?,?,?,?,?,?)').run(2, 'WT-TEST-2', '另一公司', '处理客户问题', 'Ing', '客户反馈', '老板');
  let actor = { name: 'Bam', role: 'employee' }, beforeTransaction, syncFailure = false, sequence = 100;
  const effects = [], dbCalls = [];
  const db = { prepare: sql => native.prepare(sql), transaction(fn) {
    const work = () => { if (beforeTransaction) { const callback = beforeTransaction; beforeTransaction = null; callback(); } native.exec('BEGIN IMMEDIATE'); try { const result = fn(); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } }; work.immediate = work; return work;
  } };
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor && { ...actor }, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': { getDb() { dbCalls.push(1); return db; }, generateProblemNumber: () => 'WT-NEW-' + ++sequence,
      logOperation(name, action, type, id, detail = '') { native.prepare('INSERT INTO audit_logs (actor,action,target_type,target_id,detail) VALUES (?,?,?,?,?)').run(name, action, type, id, detail); },
      sendNotification(...args) { effects.push(['notification', ...args]); } },
    '@/lib/req': { readJson: request => request.json() }, '@/lib/enums': { validateEnums: () => null },
    '@/lib/boss-submissions': { publishBossSubmission(...args) { effects.push(['submission', args[1]]); } },
    '@/lib/submission-todos': { assignProblemTodo(db, id) { effects.push(['assign', id]); }, syncProblemTodo(db, id) { if (syncFailure) throw Error('simulated todo sync failed'); effects.push(['sync', id]); }, retireProblemTodo(db, id) { effects.push(['retire', id]); } },
    fs: { existsSync() { throw Error('Disk access forbidden'); }, unlinkSync() { throw Error('Disk delete forbidden'); } }, path: require('node:path'), os: { tmpdir: () => '/forbidden-tmp' }, '@/lib/uploads': { uploadsDir: '/forbidden-uploads' },
  };
  const routes = { item: load('src/app/api/problems/[id]/route.ts', deps), list: load('src/app/api/problems/route.ts', deps) };
  return { native, effects, dbCalls, setActor(value) { actor = value; }, beforeTransaction(value) { beforeTransaction = value; }, failSync(value) { syncFailure = value; },
    row(id = 1) { return native.prepare('SELECT * FROM problems WHERE id = ?').get(id); },
    history(id = 1) { return native.prepare('SELECT * FROM problem_deadline_history WHERE problem_id = ? ORDER BY created_at DESC,id DESC').all(id); },
    body(id = 1, extra = {}) { const row = this.row(id); return { company_name: row.company_name, description: row.description, problem_type: row.problem_type, source: row.source, assignee: row.assignee, priority: row.priority, deadline: row.deadline, customer_requirement: row.customer_requirement, ...extra }; },
    async call(method = 'GET', id = 1, body, create = false) {
      const req = new Request('http://fixture/api/problems/' + id, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const response = await routes[create ? 'list' : 'item'][method](req, { params: Promise.resolve({ id: String(id) }) }); return { status: response.status, body: await response.json() };
    }, close() { native.close(); } };
}
async function run() {
  const old = new DatabaseSync(':memory:'); try {
    old.exec("CREATE TABLE problems (id INTEGER PRIMARY KEY, deadline TEXT); INSERT INTO problems VALUES (42, '2026-10-10')"); ensureHistory(old); ensureHistory(old);
    assert.equal(old.prepare('SELECT deadline FROM problems WHERE id=42').get().deadline, '2026-10-10'); assert.equal(old.prepare('SELECT COUNT(*) n FROM problem_deadline_history').get().n, 0);
    assert.equal(old.prepare('PRAGMA foreign_key_list(problem_deadline_history)').get().table, 'problems'); assert(old.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_problem_deadline_history_problem_time'").get());
  } finally { old.close(); }
  const h = createProblemDeadlineHarness();
  try {
    for (const actor of [null, { name: '客户', role: 'client' }]) for (const method of ['GET', 'PATCH']) { h.setActor(actor); assert.equal((await h.call(method, 1, method === 'PATCH' ? h.body() : undefined)).status, actor ? 403 : 401); }
    assert.equal(h.dbCalls.length, 0); h.setActor({ name: 'Bam', role: 'employee' });
    assert.equal((await h.call('PATCH', 2, h.body(2, { deadline: '2026-10-20' }))).status, 403); assert.equal(h.history(2).length, 0);
    assert.equal((await h.call('GET')).body.deadline_history.length, 0);
    assert.equal((await h.call('PATCH', 1, h.body(1, { deadline: '2026-10-20', changed_by: '伪造' }))).status, 200);
    let rows = h.history(); assert.equal(rows.length, 1); assert.equal(rows[0].old_deadline, '2026-10-10'); assert.equal(rows[0].new_deadline, '2026-10-20'); assert.equal(rows[0].changed_by, 'Bam'); assert(rows[0].created_at);
    h.setActor({ name: '老板', role: 'admin' }); assert.equal((await h.call('PATCH', 1, h.body(1, { deadline: '2026-10-25' }))).status, 200);
    rows = (await h.call('GET')).body.deadline_history; assert.equal(rows.length, 2); assert.equal(rows[0].old_deadline, '2026-10-20'); assert.equal(rows[0].new_deadline, '2026-10-25'); assert.equal(rows[0].changed_by, '老板'); assert(rows[0].id > rows[1].id);
    await h.call('PATCH', 1, h.body(1, { description: '只修改说明' })); assert.equal(h.history().length, 2);
    const omitted = h.body(1, { company_name: '只修改公司' }); delete omitted.deadline; await h.call('PATCH', 1, omitted); assert.equal(h.row().deadline, '2026-10-25'); assert.equal(h.history().length, 2);
    const created = await h.call('POST', 0, h.body(1, { deadline: '2026-11-01' }), true); assert.equal(created.status, 201); assert.equal(h.history(created.body.id).length, 0); assert(h.effects.some(effect => effect[0] === 'assign' && effect[1] === created.body.id));
    assert.equal((await h.call('GET', created.body.id)).body.deadline_history.length, 0);
    console.log('PASS actual old/new schema is additive/idempotent/indexed; 10->20->25 records exact dates/server actor/time in descending order; same/omitted deadline no history; actual create initial deadline never counts; auth/write permissions and original todo assignment retained.');
    await h.call('PATCH', 1, h.body(1, { deadline: '' })); assert.equal(h.history()[0].new_deadline, ''); assert.equal(h.history().length, 3);
    await h.call('PATCH', 1, h.body(1, { deadline: '2026-10-15' })); assert.equal(h.history()[0].old_deadline, ''); assert.equal(h.history().length, 4);
    await Promise.all([h.call('PATCH', 1, h.body(1, { deadline: '2026-10-30' })), h.call('PATCH', 1, h.body(1, { deadline: '2026-10-30' }))]); assert.equal(h.history().length, 5);
    h.beforeTransaction(() => { h.native.prepare('UPDATE problems SET deadline=? WHERE id=1').run('2026-11-05'); });
    await h.call('PATCH', 1, h.body(1, { deadline: '2026-11-10' })); assert.equal(h.history()[0].old_deadline, '2026-11-05');
    const count = h.history().length; await h.call('PATCH', 1, { status: '跟进中', deadline: '2099-01-01' }); assert.equal(h.history().length, count); assert.equal(h.row().deadline, '2026-11-10');
    assert.equal((await h.call('PATCH', 1, h.body(1, { deadline: null }))).status, 400); assert.equal(h.history().length, count);
    console.log('PASS changed-to/from-empty and earlier/later dates retained as requested, parallel same target logs once, transaction reads latest old date, status operations ignore deadline payload and leave history untouched.');
    const before = h.row().deadline, beforeCount = h.history().length; h.failSync(true); await assert.rejects(h.call('PATCH', 1, h.body(1, { deadline: '2026-12-01' })), /todo sync failed/); h.failSync(false); assert.equal(h.row().deadline, before); assert.equal(h.history().length, beforeCount);
    h.native.exec("CREATE TRIGGER fail_history BEFORE INSERT ON problem_deadline_history BEGIN SELECT RAISE(ABORT, 'history write failed'); END"); await assert.rejects(h.call('PATCH', 1, h.body(1, { deadline: '2026-12-02' })), /history write failed/); assert.equal(h.row().deadline, before); assert.equal(h.history().length, beforeCount); h.native.exec('DROP TRIGGER fail_history');
    h.setActor({ name: 'Bam', role: 'employee' }); h.beforeTransaction(() => { h.native.prepare('UPDATE problems SET assignee=? WHERE id=1').run('Ing'); }); assert.equal((await h.call('PATCH', 1, h.body(1, { deadline: '2026-12-03' }))).status, 403); assert.equal(h.history().length, beforeCount);
    h.setActor({ name: '老板', role: 'admin' }); h.native.exec("UPDATE problems SET status='已解决' WHERE id=1"); assert.equal((await h.call('DELETE')).status, 200); assert.equal(h.row(), undefined); assert.equal(h.history().length, 0);
    console.log('PASS history insert/todo-sync failures roll date and history back together; transactional owner recheck blocks reassignment race; original problem delete still works with history cascade. In-memory only, no application DB/config/network/disk or production data touched.');
  } finally { h.close(); }
}
module.exports = { createProblemDeadlineHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
