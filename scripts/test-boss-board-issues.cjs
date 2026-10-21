#!/usr/bin/env node
// Mock-only checks of the real aggregator/routes; never load SQLite or environment files.
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
    throw Error(`Unexpected import: ${name}`);
  } });
  return exports;
}
const types = load('src/lib/boss-submission-types.ts');
const submissions = load('src/lib/boss-submissions.ts', { './boss-submission-types': types });
const notifications = load('src/lib/notification-types.ts', { './boss-submission-types': types });
const categories = ['leave', 'attendance', 'notice', 'report', 'meeting', 'todo', 'problem', 'issue'];
assert.deepEqual(Object.keys(types.BOSS_PENDING_TYPES), categories);
assert.equal(types.BOSS_PENDING_TYPES.issue.label, '工单');
assert.equal(types.BOSS_PENDING_TYPES.todo.label, '未完成待办');
assert(Object.hasOwn(types.BOSS_SUBMISSION_TYPES, 'withdrawal'));
assert(!Object.hasOwn(types.BOSS_SUBMISSION_TYPES, 'issue'));

const stamp = '2026-10-21 02:00:00';
const candidate = { id: 71, employee_name: '员工甲', summary: '保留原有事项', submitted_at: stamp };
const todos = ['', 'work_report', 'meeting', 'notice', 'problem'].map((source_type, i) => ({
  ...candidate, id: 100 + i, source_type, status: '未完成', summary: source_type || '普通待办',
}));
todos.push({ ...candidate, id: 200, status: '已完成' });
const issues = ['员工甲', '员工甲,员工乙,老板', '老板', '历史负责人', '', null].map((assignee, i) => ({
  id: 71 + i, ticket_number: `TK-${71 + i}`, description: `模拟工单 ${i}`, assignee,
  status: i % 2 ? '处理中' : '待处理', created_at: stamp,
}));
issues.push({ ...issues[0], id: 90, ticket_number: 'TK-90', status: '已解决' });
let reads = 0, writes = 0;
const published = [];
const db = {
  transaction: fn => fn,
  exec() { throw Error('Unexpected schema execution'); },
  prepare(sql) {
    assert(!sql.includes('point_withdrawals'), 'Board must not read withdrawal data');
    return {
      all() {
        reads++;
        if (sql.includes('SELECT MIN(id) id,name FROM employees')) return [{ id: 2, name: '员工甲' }];
        if (sql.includes('SELECT DISTINCT name FROM employees')) return [{ name: '老板' }];
        if (sql.includes('FROM issue_tickets')) {
          assert(/WHERE status IN \('待处理','处理中'\)/.test(sql));
          assert(!/JOIN|GROUP BY|LIMIT|assignee\s*=|employee|role/i.test(sql), 'Do not filter or split owners');
          return issues.filter(i => ['待处理', '处理中'].includes(i.status));
        }
        if (sql.includes('FROM todos t')) {
          assert(sql.includes("WHERE t.status='未完成'"));
          assert(!/source_type|confirmed_at|priority/.test(sql));
          return todos.filter(t => t.status === '未完成');
        }
        if (sql.includes('FROM leave_requests')) return [{ ...candidate }];
        if (sql.includes('FROM attendance_requests')) return [{ ...candidate }];
        if (sql.includes('FROM notice_rule_implementations')) return [{ ...candidate }];
        if (sql.includes('FROM work_reports')) return [{ ...candidate, created_at: stamp, viewed_revision: null, generation: 1 }];
        if (sql.includes('FROM meeting_reflections')) return [{ ...candidate, created_at: stamp, updated_at: stamp, content: '心得', images: '[]', viewed_revision: null }];
        if (sql.includes('FROM problems p')) return [{ ...candidate }];
        throw Error(`Unexpected query: ${sql}`);
      },
      get(name) { assert(sql.includes("role='employee'")); return name === '员工甲' ? { value: 1 } : undefined; },
      run(...args) {
        writes++;
        if (sql.startsWith('INSERT INTO notifications')) {
          const [title, body, recipient, related_id] = args;
          published.push({ type: '', related_type: 'boss_submission', title, body, recipient, related_id });
        } else assert(sql.startsWith('INSERT INTO boss_submission_state'));
      },
    };
  },
};
const pending = () => submissions.bossPendingSubmissions(db);
(async () => {
  const result = pending();
  assert.equal(result.total, 17); // Six other employee categories + five todos + six tickets.
  assert.deepEqual(Object.keys(result.counts), categories);
  assert.equal(result.counts.issue, 6); assert.equal(result.counts.todo, 5);
  assert.equal(Object.values(result.counts).reduce((a, b) => a + b, 0), result.total);
  for (const category of categories.slice(0, -1)) assert(result.items.some(i => i.category === category));
  assert(!result.items.some(i => i.category === 'withdrawal'));
  assert.equal(new Set(result.items.map(i => i.id)).size, result.total);
  for (const row of issues.filter(i => i.status !== '已解决')) {
    const matches = result.items.filter(i => i.id === `issue:${row.id}`);
    assert.equal(matches.length, 1);
    const item = matches[0];
    assert.equal(item.employee_id, null, 'Never invent a single owner for a ticket');
    assert.equal(item.employee_name, row.assignee || '未分配');
    assert.equal(item.category_label, '工单');
    assert.equal(item.href, `/issues?open=${row.id}`);
    assert(item.summary.includes(row.ticket_number) && item.summary.includes(row.description));
    assert.equal(item.submitted_at, '2026-10-21T02:00:00.000Z');
  }
  assert(!result.items.some(i => i.id === 'issue:90'));
  assert(result.items.some(i => i.id === 'problem:71') && result.items.some(i => i.id === 'issue:71'));
  const otherItems = JSON.stringify(result.items.filter(i => i.category !== 'issue'));
  issues[0].status = '已解决';
  assert.equal(pending().counts.issue, 5); assert.equal(pending().total, 16);
  assert(!pending().items.some(i => i.id === 'issue:71'));
  issues[0].status = '处理中';
  assert.equal(pending().counts.issue, 6);
  assert.equal(JSON.stringify(pending().items.filter(i => i.category !== 'issue')), otherItems);
  assert.equal(writes, 0);
  console.log('PASS exact eight board categories; all seven existing categories preserved; pending/in-progress tickets included once for employee/admin/multiple/unknown/unassigned owners; solved excluded and reopened restored; counts, links, read-only aggregation');

  submissions.publishBossSubmission(db, 'withdrawal', 1301, '员工甲', '申请提现 100 积分');
  assert.equal(published.length, 1);
  assert.equal(published[0].title, '员工提交了积分提现');
  assert.equal(notifications.bossSubmissionNoticeHref(published[0]), '/customers?withdrawals=1&withdrawal=1301');
  assert(notifications.messageCenterFilter().params.includes('员工提交了积分提现'));
  assert.equal(types.BOSS_SUBMISSION_TYPES.todo.title, '员工完成了待办');
  console.log('PASS withdrawal publication, whitelist, confirmation-dialog recognition and exact processing URL preserved; original todo completion notification title preserved');

  let auth = null;
  const route = load('src/app/api/boss-supervision/pending/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => auth }, '@/lib/db': { getDb: () => db }, '@/lib/boss-submissions': submissions,
  });
  const before = reads;
  assert.equal((await route.GET({})).status, 401);
  for (const role of ['employee', 'client']) { auth = { role }; assert.equal((await route.GET({})).status, 403); }
  assert.equal(reads, before);
  auth = { role: 'admin' };
  const response = await route.GET({});
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal((await response.json()).total, 17);
  console.log('PASS admin-only API; employee/client/anonymous rejected before queries; no database driver or network loaded');
})().catch(error => { console.error(error); process.exitCode = 1; });
