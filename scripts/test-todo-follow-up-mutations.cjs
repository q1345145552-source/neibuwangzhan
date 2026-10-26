#!/usr/bin/env node
// Actual mutation/list/history/translation handlers on new :memory: SQLite only.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, Response, Date, Map, Set, require(name) { if (Object.hasOwn(dependencies, name)) return dependencies[name]; throw Error('Forbidden application dependency: ' + name); } });
  return exports;
}
function createFollowUpMutationHarness() {
  const native = new DatabaseSync(':memory:'), schema = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
  for (const table of ['todos', 'todo_categories', 'todo_follow_ups', 'todo_images', 'audit_logs']) {
    const match = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + table + ' \\([\\s\\S]*?\\n    \\);')); assert(match, table); native.exec(match[0]);
  }
  let actor = { name: 'Bam', role: 'employee' }, translator = async text => '中文：' + text, dbCalls = 0;
  const aiCalls = [];
  const db = { prepare: sql => native.prepare(sql), transaction(fn) {
    const work = () => { native.exec('BEGIN IMMEDIATE'); try { const result = fn(); native.exec('COMMIT'); return result; } catch (error) { native.exec('ROLLBACK'); throw error; } };
    work.immediate = work; return work;
  } };
  const helpers = load('src/lib/todo-translation.ts', { 'node:crypto': require('node:crypto') });
  for (const [id, assignee, status] of [[1, 'Bam', '未完成'], [2, 'Ing', '未完成'], [3, 'Bam', '已完成']]) native.prepare('INSERT INTO todos (id, content, assignee, status, created_by) VALUES (?, ?, ?, ?, ?)').run(id, 'ติดตามเอกสารของลูกค้า ' + id, assignee, status, '老板');
  for (const [id, todo, author, at] of [[101, 1, 'Bam', '2026-10-26 03:00:00'], [102, 1, '老板', '2026-10-26 02:00:00'], [103, 1, 'Bam', '2026-10-26 01:00:00'], [201, 2, 'Bam', '2026-10-26 03:00:00'], [202, 2, 'Ing', '2026-10-26 02:00:00'], [301, 3, 'Bam', '2026-10-26 01:00:00']]) {
    const content = 'ติดตามเอกสารแล้ว ' + id;
    native.prepare('INSERT INTO todo_follow_ups (id,todo_id,content,images,created_by,created_at,content_zh,content_zh_key) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, todo, content, '["/api/files/old.png"]', author, at, '旧译文 ' + id, helpers.followUpTranslationKey(content));
  }
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor && { ...actor }, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': { getDb: () => { dbCalls++; return db; }, logOperation() { throw Error('Only mutation route direct transactional audit expected'); } },
    '@/lib/req': { readJson: async request => { try { return await request.json(); } catch { return {}; } } },
    '@/lib/todo-translation': helpers,
    '@/lib/deepseek': { translateText: async (...args) => { aiCalls.push(args); return translator(...args); } },
    '@/lib/announcement-overdue': { syncAnnouncementOverdueTodos() {} },
  };
  const routes = {
    mutation: load('src/app/api/todos/[id]/follow-ups/[followUpId]/route.ts', deps),
    translate: load('src/app/api/todos/[id]/follow-ups/[followUpId]/translate/route.ts', deps),
    history: load('src/app/api/todos/[id]/follow-ups/route.ts', deps),
    list: load('src/app/api/todos/route.ts', deps),
  };
  return { native, aiCalls, get dbCalls() { return dbCalls; }, setActor(value) { actor = value; }, setTranslator(value) { translator = value; },
    row(id) { return native.prepare('SELECT * FROM todo_follow_ups WHERE id = ?').get(id); },
    logs() { return native.prepare('SELECT * FROM audit_logs ORDER BY id').all(); },
    snapshot() { return JSON.stringify([native.prepare('SELECT * FROM todos ORDER BY id').all(), native.prepare('SELECT * FROM todo_follow_ups ORDER BY id').all(), this.logs()]); },
    async call(key, method = 'GET', todoId = 1, followId = 101, body, query = '') {
      const req = new Request('http://fixture/api/todos/' + todoId + '/follow-ups/' + followId + query, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
      const r = await routes[key][method](req, { params: Promise.resolve({ id: String(todoId), followUpId: String(followId) }) });
      return { status: r.status, body: await r.json() };
    }, close() { native.close(); } };
}
async function run() {
  const h = createFollowUpMutationHarness();
  try {
    for (const actor of [null, { name: '客户', role: 'client' }]) for (const method of ['PATCH', 'DELETE']) { h.setActor(actor); assert.equal((await h.call('mutation', method, 1, 101, { content: '伪造', created_by: '客户' })).status, actor ? 403 : 401); }
    assert.equal(h.dbCalls, 0); h.setActor({ name: 'Bam', role: 'employee' });
    for (const [todo, follow, status] of [[1, 102, 403], [2, 201, 403], [2, 202, 403], [1, 201, 404], [999, 101, 404], ['01', 101, 400], [1, '1e2', 400]]) for (const method of ['PATCH', 'DELETE']) {
      const before = h.snapshot(); assert.equal((await h.call('mutation', method, todo, follow, { content: '不能写入', role: 'admin', created_by: 'Bam' })).status, status); assert.equal(h.snapshot(), before);
    }
    console.log('PASS auth/strict double IDs/parent relation, author plus existing parent visibility, forged role/author blocked; admin capability tested separately; denied operations leave rows/logs untouched.');
    const before = h.row(101); let r = await h.call('mutation', 'PATCH', 1, 101, { content: ' 改后的跟进内容 ', images: ['/api/files/new.png'], revision: 0, created_by: '伪造' });
    assert.equal(r.status, 200); assert.equal(r.body.content, '改后的跟进内容'); assert.deepEqual(r.body.images, ['/api/files/new.png']); assert.equal(r.body.revision, 1); assert.equal(r.body.content_zh, ''); assert.equal(r.body.content_zh_key, '');
    assert.equal(r.body.created_by, before.created_by); assert.equal(r.body.created_at, before.created_at);
    assert.equal((await h.call('list')).body.find(t => t.id === 1).latest_follow_content, '改后的跟进内容');
    assert.equal((await h.call('history')).body[0].content, '改后的跟进内容');
    r = await h.call('translate', 'POST'); assert.equal(r.status, 200); assert.equal(h.aiCalls.length, 1); assert.equal(h.aiCalls[0][0], '改后的跟进内容');
    assert.equal((await h.call('translate', 'POST')).body.cached, true); assert.equal(h.aiCalls.length, 1);
    await h.call('mutation', 'PATCH', 1, 101, { content: '改后的跟进内容', images: [], revision: 1 });
    assert.equal(h.row(101).content_zh, ''); assert.equal(h.row(101).revision, 2); assert.equal((await h.call('translate', 'POST')).status, 200); assert.equal(h.aiCalls.length, 2, 'Image-only edit also invalidates stored translation');
    const log = h.logs()[0]; assert.equal(log.actor, 'Bam'); assert.equal(log.action, '修改待办跟进'); assert.equal(log.target_id, '1'); assert(log.detail.includes('101')); assert(log.created_at); assert.equal(JSON.parse(log.old_value).content, before.content); assert.deepEqual(JSON.parse(log.new_value).images, ['/api/files/new.png']);
    const snapshot = h.snapshot(); assert.equal((await h.call('mutation', 'PATCH', 1, 101, { content: '旧编辑框', revision: 0 })).status, 409); assert.equal((await h.call('mutation', 'DELETE', 1, 101, undefined, '?revision=0')).status, 409); assert.equal(h.snapshot(), snapshot);
    for (const body of [{ content: ' ' }, { content: 'x', images: 'bad' }, { content: 'x', images: [3] }, { content: 'x', revision: true }]) { assert.equal((await h.call('mutation', 'PATCH', 1, 101, body)).status, 400); assert.equal(h.snapshot(), snapshot); }
    console.log('PASS actual edit text/remove/add images, author/time preserved, revision/cache cleared including image-only edits, actual list/history sync, translation gets new text and caches again, audit old/new values, stale forms and malformed bodies rejected.');
    let resolve, started; const gate = new Promise(r => { resolve = r; }); const start = new Promise(r => { started = r; });
    await h.call('mutation', 'PATCH', 1, 101, { content: '同文字修改版本', images: [] });
    h.setTranslator(() => { started(); return gate; }); const oldTranslation = h.call('translate', 'POST'); await start;
    await h.call('mutation', 'PATCH', 1, 101, { content: '同文字修改版本', images: ['/api/files/other.png'] });
    h.setTranslator(async () => '新版本译文'); assert.equal((await h.call('translate', 'POST')).status, 200); resolve('旧请求译文'); assert.equal((await oldTranslation).status, 409); assert.equal(h.row(101).content_zh, '新版本译文');
    assert.equal((await h.call('mutation', 'DELETE', 1, 101)).status, 200); assert.equal(h.row(101), undefined); assert.equal((await h.call('list')).body.find(t => t.id === 1).latest_follow_id, 102);
    h.setActor({ name: '老板', role: 'admin' }); assert.equal((await h.call('mutation', 'PATCH', 2, 202, { content: '老板可以改别人' })).status, 200); assert.equal((await h.call('mutation', 'DELETE', 1, 102)).status, 200);
    h.setActor({ name: 'Bam', role: 'employee' }); assert.equal((await h.call('mutation', 'DELETE', 1, 103)).status, 200); assert.equal((await h.call('history')).body.length, 0); assert.equal((await h.call('list')).body.find(t => t.id === 1).latest_follow_id, null);
    assert.equal((await h.call('mutation', 'DELETE', 1, 103)).status, 404);
    assert(h.logs().some(log => log.actor === '老板' && log.action === '删除待办跟进')); assert(h.logs().some(log => log.action === '删除待办跟进' && JSON.parse(log.old_value).images.length));
    console.log('PASS image-only edit rejects late old AI without overwriting fresh cache; deleting newest exposes previous, deleting all returns empty latest, admin edits/deletes others, repeated delete does not duplicate audit.');
  } finally { h.close(); }
  for (const method of ['PATCH', 'DELETE']) {
    const h = createFollowUpMutationHarness(); try { const row = JSON.stringify(h.row(101)); h.native.exec('DROP TABLE audit_logs'); await assert.rejects(h.call('mutation', method, 1, 101, { content: '日志失败不能保存' })); assert.equal(JSON.stringify(h.row(101)), row); } finally { h.close(); }
  }
  const source = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
  const excerpt = source.slice(source.indexOf('// 跟进修改版本'), source.indexOf('// 待办跟进翻译缓存'));
  for (const initial of [false, true]) {
    const db = new DatabaseSync(':memory:'); try {
      db.exec('CREATE TABLE todo_follow_ups (id INTEGER PRIMARY KEY, content TEXT)'); db.prepare('INSERT INTO todo_follow_ups VALUES (?, ?)').run(1, '旧跟进保留'); if (initial) db.exec('ALTER TABLE todo_follow_ups ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
      const script = ts.transpileModule(excerpt, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
      for (let n = 0; n < 2; n++) vm.runInNewContext(script, { database: db });
      const row = db.prepare('SELECT * FROM todo_follow_ups').get(); assert.equal(row.content, '旧跟进保留'); assert.equal(row.revision, 0);
    } finally { db.close(); }
  }
  console.log('PASS real SQLite transactional audit failure rolls edit/delete back; actual old-table revision migration is repeatable and preserves old data. No business DB/config/network/files accessed.');
  const page = ts.createSourceFile('page.tsx', fs.readFileSync(path.join(root, 'src/app/(app)/todos/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression; const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(page) === 'load') expression = node.initializer.getText(page); ts.forEachChild(node, visit); }; visit(page); assert(expression);
  const exports = {}, requests = [], applied = [], errors = [], sequence = { current: 0 };
  vm.runInNewContext(ts.transpileModule('exports.run = ' + expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, useCallback: fn => fn, todoListSequence: sequence, fetchWithAuth: () => new Promise(resolve => requests.push(resolve)), setTodos: value => applied.push(value), setLoadError: value => errors.push(value), setLoading() {}, loadStats() {} });
  exports.run(); exports.run(); requests[1]({ ok: true, json: async () => [{ id: 'fresh' }] }); await new Promise(setImmediate);
  requests[0]({ ok: true, json: async () => [{ id: 'stale-before-delete' }] }); await new Promise(setImmediate);
  assert.equal(applied.length, 1); assert.equal(applied[0][0].id, 'fresh');
  exports.run(); exports.run(); requests[3]({ ok: true, json: async () => [{ id: 'newest' }] }); await new Promise(setImmediate);
  requests[2]({ ok: false, status: 500 }); await new Promise(setImmediate); assert.equal(applied.at(-1)[0].id, 'newest'); assert(errors.every(error => error === ''));
  console.log('PASS actual page load callback discards older list responses/errors, so late pre-mutation data cannot restore removed or outdated latest follow-up.');
}
module.exports = { createFollowUpMutationHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
