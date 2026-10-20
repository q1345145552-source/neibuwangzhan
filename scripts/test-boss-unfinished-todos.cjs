#!/usr/bin/env node
// Mock-only contract checks: no SQLite driver, database, environment files or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { exports, Response, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const types = load('src/lib/boss-submission-types.ts');
const submissions = load('src/lib/boss-submissions.ts', { './boss-submission-types': types });
const notices = load('src/lib/notification-types.ts', { './boss-submission-types': types });
const people = [{ id: 2, name: '员工甲' }, { id: 3, name: '员工乙' }];
const todos = ['', 'work_report', 'meeting', 'notice', 'problem', ''].map((source_type, index) => ({
  id: 1001 + index, assignee: index % 2 ? '员工乙' : '员工甲', source_type,
  content: `任务 ${index}`, priority: source_type ? '紧急' : '普通', status: '未完成',
  created_at: `2026-10-${String(index + 1).padStart(2, '0')}T01:00:00Z`,
  updated_at: '2026-10-20T01:00:00Z', confirmed_at: index === 0 ? 'old confirmation' : '',
}));
todos.push(
  { ...todos[0], id: 2001, status: '已完成', confirmed_at: '' },
  { ...todos[0], id: 2002, status: '已完成', confirmed_at: 'confirmed' },
  { ...todos[0], id: 2003, assignee: '老板' },
  { ...todos[0], id: 2004, assignee: '不存在的员工' },
);
const notifications = [];
let writes = 0;
const db = {
  transaction: fn => fn,
  exec() { throw new Error('Unexpected schema/write execution'); },
  prepare(sql) {
    return {
      all() {
        if (sql.includes('SELECT MIN(id) id,name FROM employees')) return people;
        if (sql.includes('SELECT DISTINCT name FROM employees')) return [{ name: '老板甲' }, { name: '老板乙' }];
        if (sql.includes('FROM todos t')) {
          assert(sql.includes("WHERE t.status='未完成'"));
          assert(!sql.includes('boss_submission_state'));
          assert(!sql.includes('source_type'));
          return todos.filter(t => t.status === '未完成').map(t => ({ id: t.id, employee_name: t.assignee, submitted_at: t.created_at, summary: t.content }));
        }
        return []; // Other seven categories are intentionally empty in this fixture.
      },
      get(name) {
        assert(sql.includes("SELECT 1 FROM employees WHERE name=? AND role='employee'"));
        return people.some(p => p.name === name) ? { value: 1 } : undefined;
      },
      run(...args) {
        writes++;
        if (sql.startsWith('INSERT INTO notifications')) {
          const [title, body, recipient, related_id] = args;
          notifications.push({ type: '', related_type: 'boss_submission', title, body, recipient, related_id });
        } else assert(sql.startsWith('INSERT INTO boss_submission_state'));
      },
    };
  },
};
function list() { return submissions.bossPendingSubmissions(db); }
(async () => {
  let result = list();
  assert.equal(result.total, 6); assert.equal(result.counts.todo, 6);
  assert.equal(writes, 0);
  assert.deepEqual(Array.from(result.items, i => i.source_id).sort(), [1001, 1002, 1003, 1004, 1005, 1006]);
  for (const item of result.items) {
    const todo = todos.find(t => t.id === item.source_id);
    assert.equal(item.category_label, '未完成待办');
    assert.equal(item.submitted_at, new Date(todo.created_at).toISOString());
    assert.equal(item.href, `/todos?todo=${todo.id}`);
  }
  todos[0].status = '已完成'; // Simulated business state, without any database operation.
  result = list(); assert.equal(result.counts.todo, 5);
  assert(!result.items.some(i => i.source_id === 1001));
  todos[0].status = '未完成'; assert.equal(list().counts.todo, 6);
  assert.equal(writes, 0, 'Reading the board must never send messages or mark business handled');
  console.log('PASS all employee unfinished manual/system sources; completed rows excluded regardless of confirmation; completion removes and reopen restores; creation time, links, counts, read-only aggregation');

  submissions.publishBossSubmission(db, 'todo', 1001, '员工甲', '完成了待办「任务 0」，等待确认');
  assert.equal(notifications.length, 2);
  assert.equal(types.BOSS_SUBMISSION_TYPES.todo.title, '员工完成了待办');
  for (const notice of notifications) {
    assert.equal(notice.title, '员工完成了待办');
    assert.equal(notice.related_id, 'todo:1001');
    assert.equal(notices.bossSubmissionNoticeHref(notice), '/todos?todo=1001');
  }
  console.log('PASS original completion notification title, recipients, source ID and processing link unchanged');

  let auth = null, dbCalls = 0;
  const route = load('src/app/api/boss-supervision/pending/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => auth },
    '@/lib/db': { getDb: () => { dbCalls++; return db; } },
    '@/lib/boss-submissions': submissions,
  });
  assert.equal((await route.GET({})).status, 401);
  for (const role of ['employee', 'client']) { auth = { role }; assert.equal((await route.GET({})).status, 403); }
  assert.equal(dbCalls, 0);
  auth = { role: 'admin' };
  const response = await route.GET({});
  assert.equal(response.status, 200); assert.equal((await response.json()).counts.todo, 6);
  console.log('PASS admin-only API contract; employee/client denied before query; no real database imported or opened');
})().catch(error => { console.error(error); process.exitCode = 1; });
