#!/usr/bin/env node
// Actual route handlers and SQLite queries against a fresh :memory: fixture only.
// Application DB/config/auth/network modules cannot load through the VM whitelist.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const root = path.resolve(__dirname, '..');

function createNavigationUnreadHarness() {
  const db = new DatabaseSync(':memory:');
  const schema = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
  for (const name of ['chat_groups', 'group_members', 'messages', 'message_reads', 'message_mentions']) {
    const match = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS ' + name + ' \\([\\s\\S]*?\\n    \\);'));
    assert(match, name); db.exec(match[0]);
  }
  db.exec('CREATE TABLE employees (id INTEGER PRIMARY KEY, name TEXT UNIQUE, role TEXT, status TEXT)');
  for (const [name, role, status] of [
    ['员工甲', 'employee', '在职'], ['员工乙', 'employee', '在职'], ['老板', 'admin', '离职'],
    ['试用员工', 'employee', '试用期'], ['待离员工', 'employee', '待离职'], ['停薪员工', 'employee', '停薪留职'],
    ['离职员工', 'employee', '离职'], ['客户', 'client', '在职'],
  ]) db.prepare('INSERT INTO employees (name, role, status) VALUES (?, ?, ?)').run(name, role, status);
  for (const id of [10, 20, 30, 40, 50]) db.prepare('INSERT INTO chat_groups (id, name, owner) VALUES (?, ?, ?)').run(id, '测试群' + id, '老板');
  for (const [group, member, muted] of [
    [10, '员工甲', 0], [10, '员工乙', 1], [10, '老板', 0], [20, '员工甲', 1], [20, '员工乙', 0],
    [30, '员工乙', 0], [40, '员工甲', 0], [50, '员工甲', null],
  ]) db.prepare('INSERT INTO group_members (group_id, member, muted) VALUES (?, ?, ?)').run(group, member, muted);
  let actor = { id: 1, name: '员工甲', role: 'employee' }, dbCalls = 0;
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor && { ...actor }, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': { getDb: () => { dbCalls++; return db; } },
    '@/lib/req': { readJson: request => request.json() },
  };
  for (const type of ['leave', 'attendance', 'notice', 'report', 'meeting', 'todo-issue']) dependencies['@/lib/chat-' + type + '-card'] = {};
  const routes = {};
  for (const [key, file] of Object.entries({ count: 'unread-count', groups: 'groups', messages: 'group-messages', mute: 'groups/mute' })) {
    const exports = {};
    const source = fs.readFileSync(path.join(root, 'src/app/api/chat', file, 'route.ts'), 'utf8');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
      { exports, URL, Response, Date, Map, Set, require(name) {
        if (Object.hasOwn(dependencies, name)) return dependencies[name];
        throw Error('Forbidden application dependency: ' + name);
      } });
    routes[key] = exports;
  }
  return {
    db, get dbCalls() { return dbCalls; }, setActor(value) { actor = value; },
    addMessage(group, sender, extra = {}) {
      return Number(db.prepare('INSERT INTO messages (group_id, sender, receiver, content, is_read, recalled, image_url, order_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(group, sender, extra.receiver ?? (group ? '测试群' + group : '员工甲'), extra.content ?? '测试消息', extra.is_read ?? 0, extra.recalled ?? 0, extra.image_url ?? '', extra.order_id ?? '').lastInsertRowid);
    },
    markRead(id, member = '员工甲') { db.prepare('INSERT OR IGNORE INTO message_reads (message_id, member) VALUES (?, ?)').run(id, member); },
    mention(id, member = '员工甲', isRead = 0) { db.prepare('INSERT INTO message_mentions (message_id, member, is_read) VALUES (?, ?, ?)').run(id, member, isRead); },
    async call(key, method = 'GET', body, query = '') {
      const response = await routes[key][method](new Request('http://fixture/api/chat/' + key + query, { method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }));
      return { status: response.status, body: await response.json() };
    },
    close() { db.close(); },
  };
}

async function run() {
  const h = createNavigationUnreadHarness();
  try {
    for (const actor of [null, { name: '客户', role: 'client' }, { name: '伪造角色', role: 'unknown' }]) {
      h.setActor(actor); assert.equal((await h.call('count', 'GET', undefined, '?name=老板&role=admin')).status, actor ? 403 : 401);
    }
    assert.equal(h.dbCalls, 0); h.setActor({ id: 1, name: '员工甲', role: 'employee' });
    assert.deepEqual((await h.call('count')).body, { count: 0 });
    for (const sender of ['员工乙', '老板', '试用员工', '待离员工', '停薪员工']) h.addMessage(null, sender);
    for (const sender of ['离职员工', '不存在的员工', '客户']) h.addMessage(null, sender);
    h.addMessage(null, '员工乙', { is_read: 1 }); h.addMessage(null, '员工乙', { receiver: '别人' });
    assert.equal((await h.call('count')).body.count, 5);
    console.log('PASS actual private-message SQL preserves active/admin sender whitelist, read status, receiver and group exclusion; anonymous/client/unknown roles rejected before DB.');

    const ordinary = h.addMessage(10, '员工乙'); assert.equal((await h.call('count')).body.count, 6);
    h.addMessage(10, '员工甲'); assert.equal((await h.call('count')).body.count, 6);
    h.markRead(ordinary, '员工乙'); assert.equal((await h.call('count')).body.count, 6);
    const mention = h.addMessage(10, '员工乙', { content: '@员工甲 看一下' }); h.mention(mention); h.mention(mention, '老板');
    assert.equal((await h.call('count')).body.count, 7, '@ counts once, not once per mention or plus ordinary unread');
    const readWithStaleMention = h.addMessage(10, '员工乙'); h.markRead(readWithStaleMention); h.mention(readWithStaleMention);
    assert.equal((await h.call('count')).body.count, 7, 'Read receipts, not stale mention state, determine unread');
    h.addMessage(20, '员工乙'); h.addMessage(20, '员工乙', { content: '@员工甲 静音群' });
    h.addMessage(30, '员工乙'); h.addMessage(9999, '员工乙');
    assert.equal((await h.call('count')).body.count, 7, 'Muted, nonmember and missing groups excluded');
    let groups = (await h.call('groups')).body;
    assert.equal(groups.find(g => g.id === 10).unread, 2); assert.equal(groups.find(g => g.id === 20).unread, 2); assert.equal(groups.find(g => g.id === 20).muted, true);
    assert(!groups.some(g => g.id === 30));
    console.log('PASS ordinary group messages increase badge; own/read messages excluded, @ counted exactly once; muted-group list still has unread while muted/nonmember/missing groups do not affect badge.');

    const changes = h.db.prepare('SELECT total_changes() AS n').get().n;
    await h.call('count'); await h.call('groups'); assert.equal(h.db.prepare('SELECT total_changes() AS n').get().n, changes, 'Count/list are read-only');
    assert.equal((await h.call('messages', 'GET', undefined, '?group_id=30')).status, 403);
    assert.equal((await h.call('messages', 'GET', undefined, '?group_id=10')).status, 200);
    assert.equal((await h.call('count')).body.count, 5); groups = (await h.call('groups')).body;
    assert.equal(groups.find(g => g.id === 10).unread, 0); assert.equal(groups.find(g => g.id === 20).unread, 2);
    h.addMessage(10, '员工乙', { image_url: '/api/files/fixture.png' });
    assert.equal((await h.call('count')).body.count, 6);
    assert.equal((await h.call('mute', 'PATCH', { group_id: 10, muted: true })).status, 200); assert.equal((await h.call('count')).body.count, 5);
    assert.equal((await h.call('groups')).body.find(g => g.id === 10).unread, 1);
    assert.equal((await h.call('mute', 'PATCH', { group_id: 10, muted: false })).status, 200); assert.equal((await h.call('count')).body.count, 6);
    assert.equal((await h.call('mute', 'PATCH', { group_id: 20, muted: false })).status, 200); assert.equal((await h.call('count')).body.count, 8);
    assert.equal((await h.call('messages', 'GET', undefined, '?group_id=20')).status, 200); assert.equal((await h.call('count')).body.count, 6);
    console.log('PASS actual open-group read handler lowers badge and clears only opened group; next image increments; actual mute/unmute changes badge but preserves per-group unread.');

    h.addMessage(50, '离职员工'); h.addMessage(50, '', { content: '系统消息' });
    const count = (await h.call('count', 'GET', undefined, '?name=别人&member=别人')).body.count;
    groups = (await h.call('groups')).body;
    assert.equal(count, 5 + groups.filter(g => !g.muted).reduce((n, g) => n + g.unread, 0));
    assert.equal(groups.find(g => g.id === 50).unread, 2, 'Group sender rules exactly match existing group list, including legacy/system rows');
    h.db.prepare('DELETE FROM group_members WHERE group_id = ? AND member = ?').run(10, '员工甲');
    assert.equal((await h.call('count')).body.count, 7, 'Leaving/removal excludes remaining unread without reliance on mention cleanup');
    h.setActor({ id: 3, name: '老板', role: 'admin' });
    const adminGroups = (await h.call('groups')).body;
    assert.equal((await h.call('count')).body.count, adminGroups.filter(g => !g.muted).reduce((n, g) => n + g.unread, 0));
    console.log('PASS badge equals private + sum of nonmuted group-list unread for employee/admin, null mute behaves unmuted, identity comes from auth, exited groups vanish, existing group sender semantics retained.');
    console.log('PASS isolated :memory: SQLite only; no application DB, environment, credentials, production/network requests, migrations or data files.');
  } finally { h.close(); }
}
module.exports = { createNavigationUnreadHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
