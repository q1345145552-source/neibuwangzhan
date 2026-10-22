#!/usr/bin/env node
// Actual handlers/callbacks with simulated query objects only. No database driver or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function evaluate(source, dependencies = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, URL, Response, ...globals, require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw Error('Unexpected dependency: ' + name);
    } });
  return exports;
}
const load = (file, deps) => evaluate(fs.readFileSync(path.join(root, file), 'utf8'), deps);
function createGroupHarness() {
  let actor = { id: 2, name: '员工甲', role: 'employee' }, dbCalls = 0;
  const groups = [10, 20, 30, 40].map(id => ({ id, name: '模拟群' + id, owner: '老板', muted: id === 20 ? 1 : 0 }));
  const memberships = new Map([[10, ['老板', '员工甲', '员工乙']], [20, ['员工甲', '员工乙']], [30, ['老板', '员工乙']], [40, ['员工甲']]]);
  const messages = [];
  const reads = new Set(), writes = [], queries = [];
  const addMessage = (id, group_id, sender, extra = {}) => {
    const row = { id, group_id, conversation_id: group_id ? null : 7, sender, receiver: '员工甲', content: '消息 ' + id,
      image_url: '', order_id: '', is_read: 0, recalled: 0, reply_to: null, reply_preview: '', created_at: '2026-10-22 01:00:00', ...extra };
    messages.push(row); return row;
  };
  const groupMessages = id => messages.filter(m => m.group_id === id);
  const db = { prepare(sql) { queries.push(sql); return {
    all(...args) {
      if (sql.includes('FROM chat_groups g')) {
        assert.match(sql, /m\.group_id = g\.id AND m\.sender <> \?/);
        assert.match(sql, /NOT EXISTS \(SELECT 1 FROM message_reads mr WHERE mr\.message_id = m\.id AND mr\.member = \?\)/);
        assert.match(sql, /JOIN group_members me ON me\.group_id = g\.id AND me\.member = \?/);
        assert.deepEqual(args, [actor.name, actor.name, actor.name]);
        return groups.filter(g => memberships.get(g.id).includes(actor.name)).map(g => {
          const list = groupMessages(g.id), last = list.at(-1);
          return { ...g, unread: list.filter(m => m.sender !== actor.name && !reads.has(m.id + ':' + actor.name)).length,
            last_sender: last?.sender, last_content: last?.content, last_image_url: last?.image_url, last_order_id: last?.order_id, last_at: last?.created_at };
        });
      }
      if (sql.startsWith('SELECT member FROM group_members')) return (memberships.get(args[0]) || []).map(member => ({ member }));
      if (sql.includes('FROM messages WHERE group_id')) return groupMessages(args[0]).filter(m => sql.includes('recalled = 1') ? m.recalled === 1 : m.id > args[1]).sort((a, b) => a.id - b.id).slice(0, 500);
      if (sql.includes('FROM message_reads mr')) return groupMessages(args[0]).flatMap(m => [...reads].filter(k => k.startsWith(m.id + ':')).map(k => ({ message_id: m.id, member: k.slice(String(m.id).length + 1) })));
      if (sql.includes('FROM message_mentions')) return [];
      throw Error('Unexpected query: ' + sql);
    },
    get(...args) {
      if (sql.includes('FROM chat_groups')) return groups.find(g => g.id === args[0]);
      if (sql.includes('COUNT(*) AS c FROM group_members')) return { c: (memberships.get(args[0]) || []).length };
      if (sql.includes('FROM group_members')) return memberships.get(args[0])?.includes(args[1]) ? { id: 1 } : undefined;
      if (sql.includes('FROM employees')) return ['老板', '员工甲', '员工乙'].includes(args[0]) ? { id: 2 } : undefined;
      if (sql.includes('FROM messages WHERE id')) return messages.find(m => m.id === args[0]);
      if (sql.includes('FROM orders')) return { customer_name: '模拟客户' };
      throw Error('Unexpected lookup: ' + sql);
    },
    run(...args) {
      writes.push(sql);
      if (sql.startsWith('INSERT OR IGNORE INTO message_reads')) {
        if (sql.includes('SELECT id')) for (const m of groupMessages(args[1])) reads.add(m.id + ':' + args[0]);
        else reads.add(args[0] + ':' + args[1]);
        return { changes: 1 };
      }
      if (sql.startsWith('UPDATE message_mentions') || sql.startsWith('INSERT OR IGNORE INTO message_mentions')) return { changes: 0 };
      if (sql.startsWith('INSERT INTO messages (group_id,')) {
        const [gid, sender, receiver, content, image_url, order_id, reply_to, reply_preview, created_at] = args;
        const id = Math.max(0, ...messages.map(m => m.id)) + 1;
        addMessage(id, gid, sender, { receiver, content, image_url, order_id, reply_to, reply_preview, created_at });
        return { lastInsertRowid: id };
      }
      throw Error('Unexpected write: ' + sql);
    },
  }; } };
  const deps = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: a => ['admin', 'employee'].includes(a.role) },
    '@/lib/db': { getDb: () => { dbCalls++; return db; } }, '@/lib/req': { readJson: req => req.json() } };
  for (const type of ['leave', 'attendance', 'notice', 'report', 'meeting', 'todo-issue']) deps['@/lib/chat-' + type + '-card'] = {};
  const routes = { groups: load('src/app/api/chat/groups/route.ts', deps), messages: load('src/app/api/chat/group-messages/route.ts', deps) };
  return { groups, memberships, messages, reads, writes, queries, addMessage, get actor() { return actor; }, get dbCalls() { return dbCalls; }, setActor(next) { actor = next; },
    async call(key, method = 'GET', body, query = '') {
      const response = await routes[key][method](new Request('http://mock/api/chat/' + key + query, { method,
        ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
      return { status: response.status, body: await response.json() };
    } };
}

const pageSource = ts.createSourceFile('page.tsx', fs.readFileSync(path.join(root, 'src/app/(app)/messages/page.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callback(name, globals) {
  let expression;
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(pageSource) === name) expression = node.initializer.getText(pageSource); ts.forEachChild(node, visit); };
  visit(pageSource); assert(expression, name);
  return evaluate('export const result = ' + expression, {}, { useCallback: fn => fn, ...globals }).result;
}
function scrollEffect(globals) {
  let expression;
  const visit = node => {
    if (ts.isCallExpression(node) && node.expression.getText(pageSource) === 'useEffect' && node.arguments[1]?.getText(pageSource) === '[messages, scrollRequest, scrollToBottom]') expression = node.arguments[0].getText(pageSource);
    ts.forEachChild(node, visit);
  };
  visit(pageSource); assert(expression);
  return evaluate('export const result = ' + expression, {}, globals).result;
}
async function run() {
  let rows = [{ id: 1, read_members: ['甲', '乙'] }, { id: 2 }];
  const apply = callback('applyGroupReads', { setMessages: update => { rows = update(rows); } });
  const before = rows;
  for (const reads of [{}, { 1: ['甲', '乙'] }, { 1: ['乙', '甲'], 2: [] }, { 999: ['甲'] }]) { apply(reads); assert.equal(rows, before); }
  apply({ 1: ['甲', '乙', '丙'] }); assert.notEqual(rows, before); assert.notEqual(rows[0], before[0]); assert.equal(rows[1], before[1]);
  const updated = rows; apply({ 1: ['丙', '乙', '甲'] }); assert.equal(rows, updated);
  console.log('PASS actual group read callback: unchanged/empty/unknown/reordered receipts preserve array and row identity; genuine changes replace only the affected row.');

  const scrollRef = { current: { scrollHeight: 5000, clientHeight: 500, scrollTop: 4500 } }, nearBottomRef = { current: true }, forceBottomRef = { current: false };
  const scrollToBottom = callback('scrollToBottom', { scrollRef, nearBottomRef });
  const handleScroll = callback('handleMessageScroll', { scrollRef, nearBottomRef });
  const effect = scrollEffect({ nearBottomRef, forceBottomRef, scrollToBottom });
  scrollRef.current.scrollTop = 300; handleScroll(); effect(); assert.equal(scrollRef.current.scrollTop, 300);
  scrollRef.current.scrollTop = 4421; handleScroll(); scrollRef.current.scrollHeight += 900; effect(); assert.equal(scrollRef.current.scrollTop, 5900);
  scrollRef.current.scrollTop = 5320; handleScroll(); assert.equal(nearBottomRef.current, false);
  const imageLoad = callback('handleImageLoad', { nearBottomRef, scrollToBottom }); imageLoad(); assert.equal(scrollRef.current.scrollTop, 5320);
  nearBottomRef.current = true; imageLoad(); assert.equal(scrollRef.current.scrollTop, 5900);
  for (const kind of ['direct', 'group']) for (const payload of [{ content: '自己发送' }, { image_url: '/api/files/mock.png' }, { card_type: 'order', card_id: 'ORDER-1' }]) {
    let requests = 0, messages = [{ id: 7 }], error = null, success = true;
    const send = callback('sendMessage', { selected: kind === 'direct' ? { kind, name: '员工乙' } : { kind, id: 10 }, replyTo: null,
      forceBottomRef, cursorRef: { current: 7 }, setScrollRequest: update => { requests = update(requests); },
      setMessages: update => { messages = update(messages); }, setReplyTo() {}, setError: value => { error = value; },
      fetchWithAuth: async () => ({ ok: success, json: async () => success ? { message: { id: 7 } } : { error: '模拟发送失败' } }) });
    // Polling already merged id=7; successful POST must still force a render/scroll.
    nearBottomRef.current = false; forceBottomRef.current = false; scrollRef.current.scrollTop = 200;
    const oldMessages = messages; assert.equal(await send(payload), true); assert.equal(messages, oldMessages); assert.equal(requests, 1); effect();
    assert.equal(scrollRef.current.scrollTop, scrollRef.current.scrollHeight); assert.equal(forceBottomRef.current, false);
    success = false; nearBottomRef.current = false; scrollRef.current.scrollTop = 200;
    assert.equal(await send(payload), false); effect(); assert.equal(requests, 1); assert.equal(scrollRef.current.scrollTop, 200); assert.equal(error, '模拟发送失败');
  }
  console.log('PASS actual scroll/send callbacks: history stays put, previous near-bottom follows tall updates, image loads respect history, both scopes force text/image/card to bottom even after poll dedup; failed sends do not scroll.');

  const h = createGroupHarness();
  for (const actor of [null, { name: '客户', role: 'client' }]) { h.setActor(actor); assert.equal((await h.call('groups')).status, actor ? 403 : 401); }
  assert.equal(h.dbCalls, 0); h.setActor({ id: 2, name: '员工甲', role: 'employee' });
  h.addMessage(101, 10, '员工乙'); h.addMessage(102, 10, '员工甲'); h.addMessage(103, 10, '员工乙'); h.reads.add('103:员工甲');
  h.addMessage(104, 20, '员工乙'); h.addMessage(105, 30, '员工乙'); h.addMessage(106, null, '员工乙');
  h.addMessage(107, 10, '员工乙', { is_read: 1 }); h.reads.add('107:员工乙');
  let r = await h.call('groups', 'GET', null, '?member=员工乙&role=admin'); assert.equal(r.status, 200);
  assert.deepEqual(r.body.map(g => [g.id, g.unread]), [[10, 2], [20, 1], [40, 0]]); assert.equal(r.body[1].muted, true); assert.equal(h.writes.length, 0);
  const snapshot = JSON.stringify(h.messages); assert.equal((await h.call('messages', 'GET', null, '?group_id=30')).status, 403); assert.equal(h.writes.length, 0);
  assert.equal((await h.call('messages', 'GET', null, '?group_id=10')).status, 200);
  assert.equal(JSON.stringify(h.messages), snapshot); r = await h.call('groups'); assert.deepEqual(r.body.map(g => g.unread), [0, 1, 0]);
  h.addMessage(108, 10, '员工乙'); assert.equal((await h.call('groups')).body[0].unread, 1);
  h.addMessage(109, 10, '员工甲'); assert.equal((await h.call('groups')).body[0].unread, 1);
  h.setActor({ id: 1, name: '老板', role: 'admin' }); assert.deepEqual((await h.call('groups')).body.map(g => g.id), [10, 30]);
  console.log('PASS actual group list/read handlers: only joined groups; current-user receipts, own-message exclusion, empty/muted groups and other-scope isolation; open clears only that group, next incoming counts again; auth/forged identity guards retained.');
}
module.exports = { createGroupHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
