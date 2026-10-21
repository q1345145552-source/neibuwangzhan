#!/usr/bin/env node
// Real task/direct handlers + query objects. Never import SQLite, credentials or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { randomUUID } = require('node:crypto');
const root = path.resolve(__dirname, '..');
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, URL, Response, require(name) { if (Object.hasOwn(deps, name)) return deps[name]; throw Error('Unexpected import: ' + name); } });
  return exports;
}
function createTaskHarness() {
  const people = [
    [1, '老板', 'admin', '在职'], [2, '员工甲', 'employee', '在职'], [3, '员工乙', 'employee', '在职'], [4, '员工丙', 'employee', '在职'],
    [5, '停薪员工', 'employee', '停薪留职'], [6, '客户', 'client', '在职'], [7, '离职员工', 'employee', '已离职'],
    [8, '重名员工', 'employee', '在职'], [9, '重名员工', 'employee', '在职'], [10, '另一老板', 'admin', '在职'], [11, '待离职员工', 'employee', '待离职'], [12, '试用员工', 'employee', '试用期'],
  ].map(([id, name, role, status]) => ({ id, name, role, status }));
  const rows = {
    leave_requests: [{ id: 101, employee_name: '员工甲', start_date: '2024-01-01', end_date: '2024-01-02', start_time: '09:00', end_time: '17:00', status: '已通过', reason: '私密请假原因' }],
    attendance_requests: [{ id: 201, employee_name: '员工乙', date: '2024-01-01', time: '09:00', status: '已驳回', reason: '私密补签原因' }],
    notice_rule_implementations: [{ id: 301, notice_id: 91, employee_id: 3, employee_name: '员工乙', review_status: '还没处理', submitted_at: '2024-01-01', statement: '私密落实说明' }],
    notice_rules: [{ id: 91, title: '模拟规则' }], work_reports: [{ id: 401, employee_name: '员工甲', report_date: '2024-01-01', status: '已提交', summary: '私密日报正文' }],
    meeting_reflections: [{ id: 501, meeting_id: 84, employee_name: '员工乙', status: '退回', content: '私密心得正文' }, { id: 502, meeting_id: 85, employee_name: '员工甲', status: '已提交' }],
    meetings: [{ id: 84, title: '模拟会议', meeting_date: '2024-01-01', participants: '["员工甲","员工乙"]' }, { id: 85, title: '未参会会议', meeting_date: '2024-01-01', participants: '["员工乙"]' }],
    todos: [{ id: 601, assignee: '员工甲', content: '模拟未完成待办', status: '未完成' }, { id: 602, assignee: '老板', content: '自己的待办' }],
    problems: [{ id: 701, assignee: '员工乙', problem_number: 'P-701', company_name: '模拟公司' }],
    issue_tickets: [{ id: 801, assignee: '员工甲,员工乙,老板,员工乙,员工丙', created_by: '老板', ticket_number: 'TK-801', description: '模拟多人任务', description_zh: '' },
      { id: 802, assignee: '员工乙', created_by: '员工甲', ticket_number: 'TK-802', description: '自己创建的工单' }, { id: 803, assignee: '员工丙', created_by: '员工乙', ticket_number: 'TK-803', description: '他人工单' },
      { id: 804, assignee: '', created_by: '老板', description: '未分配工单' }],
  };
  let actor = people[0], depth = 0, immediates = 0;
  const messages = [], conversations = [], queries = [], writes = [], failures = new Set();
  const db = {
    transaction(fn) {
      function run() {
        const before = { messages: messages.map(x => ({ ...x })), conversations: conversations.map(x => ({ ...x })) }; depth++;
        try { return fn(); } catch (e) { messages.splice(0, messages.length, ...before.messages); conversations.splice(0, conversations.length, ...before.conversations); throw e; } finally { depth--; }
      }
      run.immediate = () => { immediates++; return run(); }; return run;
    },
    prepare(sql) {
      queries.push(sql);
      function select(args) {
        if (sql.includes('FROM employees')) return people.filter(p => sql.includes('WHERE name') ? p.name === args[0] : p.id === args[0]);
        if (sql.includes('FROM conversations')) return conversations.filter(c => c.user_a === args[0] && c.user_b === args[1]);
        if (sql.includes('FROM messages')) {
          if (sql.includes('content LIKE')) { const marker = args[1].slice(1, -1); return messages.filter(m => m.sender === args[0] && m.content.includes(marker) && m.conversation_id); }
          if (sql.includes('WHERE id')) return messages.filter(m => m.id === args[0] && (!sql.includes('AND conversation_id') || m.conversation_id === args[1]));
          let result = messages.filter(m => m.conversation_id === args[0]);
          if (sql.includes('id > ?')) result = result.filter(m => m.id > args[1]).sort((a, b) => a.id - b.id).slice(0, 500);
          if (sql.includes('id <= ?')) result = result.filter(m => m.id <= args[1]).sort((a, b) => b.id - a.id).slice(0, 500);
          if (sql.includes('is_read = 1')) result = result.filter(m => m.sender === args[1] && m.is_read === 1);
          if (sql.includes('recalled = 1')) result = result.filter(m => m.recalled === 1);
          return result;
        }
        const table = sql.match(/FROM (\w+)/)?.[1];
        assert(rows[table], sql);
        let result = rows[table].filter(r => r.id === Number(args[0]));
        if (sql.includes('JOIN notice_rules')) result = result.flatMap(r => { const n = rows.notice_rules.find(n => n.id === r.notice_id); return n ? [{ ...n, ...r }] : []; });
        if (sql.includes('JOIN meetings')) result = result.flatMap(r => { const m = rows.meetings.find(m => m.id === r.meeting_id); return m ? [{ ...m, ...r }] : []; });
        if (sql.includes('AND employee_name=?') || sql.includes('AND r.employee_name=?')) result = result.filter(r => r.employee_name === args[1]);
        if (sql.includes('AND r.employee_id=?')) result = result.filter(r => r.employee_id === args[1]);
        const cols = sql.match(/SELECT ([\s\S]*?) FROM/)[1].split(',').map(c => c.trim().replace(/^\w+\./, ''));
        assert(!cols.includes('*'));
        return result.map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
      }
      return {
        all: (...args) => select(args).map(x => ({ ...x })), get: (...args) => select(args)[0],
        run(...args) {
          writes.push(sql);
          if (sql.startsWith('INSERT INTO conversations')) { const row = { id: conversations.length + 1, user_a: args[0], user_b: args[1] }; conversations.push(row); return { lastInsertRowid: row.id }; }
          if (sql.startsWith('INSERT INTO messages')) {
            const [conversation_id, sender, receiver, content, image_url, order_id, reply_to, reply_preview, created_at] = args;
            if (order_id && content.includes('task_action_id')) assert(depth > 0, 'Task send must be within a transaction');
            const row = { id: (messages.at(-1)?.id || 0) + 1, conversation_id, sender, receiver, content, image_url, order_id, reply_to, reply_preview, created_at, is_read: 0, recalled: 0 }; messages.push(row); return { lastInsertRowid: row.id };
          }
          if (sql.startsWith('UPDATE conversations')) { const c = conversations.find(c => c.id === args[2]); if (failures.has(c.user_a) || failures.has(c.user_b)) throw Error('Simulated preview failure'); c.preview = args[1]; return {}; }
          if (sql.startsWith('UPDATE messages SET is_read')) return {};
          throw Error('Unexpected write: ' + sql);
        },
      };
    },
  };
  const direct = load('src/lib/chat-direct-message.ts');
  const helpers = Object.fromEntries(['leave', 'attendance', 'notice', 'report', 'meeting'].map(type => [`./chat-${type}-card`, load(`src/lib/chat-${type}-card.ts`, type === 'meeting' ? { './meeting-todos': load('src/lib/meeting-todos.ts', { './boss-submissions': {} }) } : {})]));
  const types = load('src/lib/chat-task-message-types.ts');
  const service = load('src/lib/chat-task-message.ts', { ...helpers, './chat-direct-message': direct, './chat-task-message-types': types });
  const deps = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@/lib/auth': { verifyAuth: async () => actor, isStaff: a => ['admin', 'employee'].includes(a.role) }, '@/lib/db': { getDb: () => db }, '@/lib/req': { readJson: req => req.json() }, '@/lib/chat-task-message': service, '@/lib/chat-direct-message': direct,
    ...Object.fromEntries(Object.entries(helpers).map(([key, val]) => ['@/lib/' + key.slice(2), val])) };
  const routes = { task: load('src/app/api/chat/task-message/route.ts', deps), direct: load('src/app/api/chat/route.ts', deps) };
  return { people, rows, messages, conversations, failures, queries, writes, service, db, get immediates() { return immediates; }, setActor(value) { actor = value; },
    reloadService: () => load('src/lib/chat-task-message.ts', { ...helpers, './chat-direct-message': direct, './chat-task-message-types': types }),
    async call(route, method = 'POST', body, query = '') {
      const req = new Request('http://mock/api/' + route + query, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const response = await routes[route][method](req); return { status: response.status, body: await response.json(), response };
    } };
}
async function run() {
  const h = createTaskHarness(), op = (type, id, action = randomUUID()) => ({ type, id, action, other: '伪造对象', employee_id: 999, content: '伪造内容' });
  for (const actor of [null, h.people[5]]) { h.setActor(actor); assert.equal((await h.call('task', 'POST', op('todo', 601))).status, actor ? 403 : 401); }
  assert.equal(h.queries.length, 0); h.setActor(h.people[0]);
  for (const [type, id, recipient] of [['leave', 101, '员工甲'], ['attendance', 201, '员工乙'], ['notice', 301, '员工乙'], ['report', 401, '员工甲'], ['meeting', 501, '员工乙'], ['todo', 601, '员工甲'], ['problem', 701, '员工乙']]) {
    const before = h.messages.length, body = op(type, id), r = await h.call('task', 'POST', body);
    assert.equal(r.status, 200); assert.equal(r.body.results[0].name, recipient); assert.equal(r.body.results[0].status, 'sent'); assert.equal(h.messages.length, before + 1);
    const m = h.messages.at(-1); assert.equal(m.receiver, recipient); assert.equal(m.order_id, `${type}:${id}`); assert(!m.content.includes('私密') && !m.content.includes('伪造'));
    const again = await h.call('task', 'POST', body); assert.equal(again.body.results[0].messageId, m.id); assert.equal(h.messages.length, before + 1);
  }
  const body = op('issue', 801); h.failures.add('员工乙'); let r = await h.call('task', 'POST', body);
  assert.equal(r.body.multiple, true); assert.equal(r.body.results.length, 3); assert.equal(r.body.results.filter(x => x.status === 'sent').length, 2);
  assert(!r.body.results.some(x => x.name === '老板')); const firstIds = h.messages.filter(m => m.order_id === 'issue:801').map(m => m.id); assert.equal(firstIds.length, 2);
  h.failures.clear(); r = await h.call('task', 'POST', body); assert(r.body.results.every(x => x.status === 'sent'));
  assert.equal(h.messages.filter(m => m.order_id === 'issue:801').length, 3); for (const id of firstIds) assert(h.messages.some(m => m.id === id));
  const cards = h.messages.filter(m => m.order_id === 'issue:801').map(m => JSON.parse(m.content)); assert.equal(new Set(cards.map(c => c.title + c.subtitle)).size, 1);
  const count = h.messages.length; await Promise.all(Array.from({ length: 5 }, () => h.call('task', 'POST', body))); assert.equal(h.messages.length, count);
  // A new service instance still uses persisted successes, not process memory.
  h.reloadService().sendTaskMessages(h.db, h.people[0], body); assert.equal(h.messages.length, count);
  await h.call('task', 'POST', op('issue', 801)); assert.equal(h.messages.length, count + 3);
  assert.equal((await h.call('task', 'POST', { ...body, id: 802 })).status, 409);
  h.rows.issue_tickets[0].assignee += ',另一老板'; assert.equal((await h.call('task', 'POST', body)).status, 409);
  console.log('PASS all eight real task IDs/owners/canonical cards; forged recipient ignored; multiple assignees deduplicated and self excluded; nested failure rolls back message+preview; partial retry preserves successful IDs; concurrent retries deduplicate; fresh explicit action allowed; task/assignment changes rejected');
  const before = h.messages.length;
  for (const name of ['不存在', '停薪员工', '客户', '离职员工', '重名员工', '']) {
    h.rows.todos[0].assignee = name; r = await h.call('task', 'POST', op('todo', 601)); assert.equal(r.body.results[0].status, 'failed'); assert(r.body.results[0].error);
  }
  h.rows.todos[0].assignee = '员工甲'; assert.equal(h.messages.length, before);
  assert.equal((await h.call('task', 'POST', op('todo', 602))).status, 400);
  assert.equal((await h.call('task', 'POST', op('issue', 804))).status, 400);
  assert.equal((await h.call('task', 'POST', op('notice', 91))).status, 404); assert.equal((await h.call('task', 'POST', op('meeting', 84))).status, 404);
  for (const body of [op('unknown', 601), op('todo', '01'), op('todo', '1e3'), op('todo', 0), { ...op('todo', 601), action: '%' }]) assert.equal((await h.call('task', 'POST', body)).status, 400);
  h.setActor(h.people[1]);
  for (const [type, id] of [['leave', 101], ['report', 401]]) assert.equal((await h.call('task', 'POST', op(type, id))).status, 400, 'Own records cannot be sent to self');
  for (const [type, id] of [['attendance', 201], ['notice', 301], ['meeting', 501], ['meeting', 502], ['todo', 602], ['issue', 803]]) assert.equal((await h.call('task', 'POST', op(type, id))).status, 404);
  assert.equal((await h.call('task', 'POST', op('issue', 802))).body.results[0].name, '员工乙');
  h.setActor(h.people[0]); h.rows.notice_rule_implementations[0].employee_name = '错误旧名'; assert.equal((await h.call('task', 'POST', op('notice', 301))).body.results[0].name, '员工乙');
  h.rows.notice_rule_implementations[0].employee_id = 999; assert.equal((await h.call('task', 'POST', op('notice', 301))).body.results[0].status, 'failed');
  for (const actor of [h.people[4], { ...h.people[0], id: 999 }, { ...h.people[0], name: '重名员工' }]) { h.setActor(actor); assert.equal((await h.call('task', 'POST', op('todo', 601))).status, 403); }
  console.log('PASS role/record ownership and participant boundaries; missing/inactive/client/duplicate-name owners fail clearly without guessing; notice uses account ID; parent IDs rejected; self-only and malformed action rejected');
  h.setActor(h.people[0]);
  for (const payload of [{ content: '原文字' }, { image_url: '/api/files/mock.jpg', content: '原图片说明', reply_to: 77, reply_preview: '原回复' }, { content: '[语音]', image_url: '/api/files/mock.webm' }]) assert.equal((await h.call('direct', 'POST', { other: '员工甲', ...payload })).status, 201);
  const last = h.messages.at(-1), conv = last.conversation_id;
  for (let i = 0; i < 600; i++) h.messages.push({ ...last, id: last.id + i + 1, content: `历史消息 ${i}` });
  const target = h.messages.at(-1); r = await h.call('direct', 'GET', null, '?other=员工甲&focus_id=' + target.id); assert.equal(r.status, 200); assert.equal(r.body.messages.length, 500); assert.equal(r.body.messages.at(-1).id, target.id);
  const otherConversation = h.messages.find(m => m.conversation_id !== conv); assert.equal((await h.call('direct', 'GET', null, '?other=员工甲&focus_id=' + otherConversation.id)).status, 404);
  assert.equal((await h.call('direct', 'GET', null, '?other=员工甲&focus_id=NaN')).status, 400);
  assert(h.immediates > 0); assert(h.writes.every(sql => /^(INSERT INTO (messages|conversations)|UPDATE (messages|conversations))/.test(sql)));
  console.log('PASS original text/image/voice/reply direct channel; >500 history opens the sent card in correct conversation; foreign focus rejected; writes confined to existing chat tables; no schema/business/notification writes or database driver');
}
module.exports = { createTaskHarness };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
