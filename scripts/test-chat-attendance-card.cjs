#!/usr/bin/env node
// Actual handlers + mock queries only. Never load a database or alter clock-in records.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const { createHarness } = require('./test-chat-leave-card.cjs');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, URL, Response, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error('Unexpected dependency: ' + name);
  } });
  return exports;
}
function createAttendanceHarness() {
  const base = createHarness();
  let actor = { role: 'employee', name: '员工甲' };
  const requests = ['待审批', '已通过', '已驳回', '待审批'].map((status, i) => ({
    id: 1101 + i, employee_name: i === 3 ? '员工乙' : '员工甲', date: '2024-06-16', time: '09:15',
    type: '补签', status, reason: `私密补签原因${i}`, photo: 'private-clock-photo.png',
    approved_by: status === '待审批' ? '' : '老板', approved_at: status === '待审批' ? '' : '2024-06-17 02:00:00', created_at: '2024-06-16 02:00:00',
  }));
  requests.push({ ...requests[0], id: 1105, employee_name: '历史离职员工' });
  const db = { prepare(sql) {
    assert(!/\bFROM attendance\b/.test(sql), 'Card/detail must never read clock-in records');
    if (!sql.includes('FROM attendance_requests')) return base.db.prepare(sql);
    const projection = row => row && Object.fromEntries(sql.match(/SELECT ([\s\S]+?)\s+FROM attendance_requests/)[1].split(',').map(c => c.trim()).map(c => { assert.notEqual(c, '*'); return [c, row[c]]; }));
    return {
      get(...args) {
        base.reads.push(sql); assert(sql.includes('WHERE id=?'));
        if (actor.role !== 'admin') assert(sql.includes('AND employee_name=?') && args[1] === actor.name);
        return projection(requests.find(r => r.id === args[0] && (!sql.includes('AND employee_name=?') || r.employee_name === args[1])));
      },
      all(...args) {
        base.reads.push(sql); assert(!/reason|photo/.test(sql));
        if (actor.role !== 'admin') assert(sql.includes('WHERE employee_name=?') && args[0] === actor.name);
        return requests.filter(r => !sql.includes('WHERE employee_name=?') || r.employee_name === args[0]).map(projection);
      },
      run() { throw Error('No attendance request writes allowed'); },
    };
  } };
  const helper = load('src/lib/chat-attendance-card.ts');
  const deps = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: auth => ['admin', 'employee'].includes(auth.role) },
    '@/lib/db': { getDb: () => db }, '@/lib/chat-direct-message': load('src/lib/chat-direct-message.ts'), '@/lib/chat-todo-issue-card': load('src/lib/chat-todo-issue-card.ts'), '@/lib/req': { readJson: req => req.json() },
    '@/lib/chat-attendance-card': helper, '@/lib/chat-leave-card': load('src/lib/chat-leave-card.ts'), '@/lib/chat-meeting-card':load('src/lib/chat-meeting-card.ts',{'./meeting-todos':load('src/lib/meeting-todos.ts',{'./boss-submissions':{}})}), '@/lib/chat-report-card': load('src/lib/chat-report-card.ts'), '@/lib/chat-notice-card': load('src/lib/chat-notice-card.ts') };
  const routes = Object.fromEntries(Object.entries({ candidates: 'chat/share-items', direct: 'chat', group: 'chat/group-messages', groups: 'chat/groups', detail: 'attendance/request/[id]' })
    .map(([key, file]) => [key, load(`src/app/api/${file}/route.ts`, deps)]));
  return { ...base, requests, helper, routes, db,
    setActor(value) { actor = value; base.setActor(value); },
    async call(route, method = 'GET', body, id, query = '') {
      const req = new Request('http://mock/api/' + route + query, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const response = await routes[route][method](req, { params: Promise.resolve({ id: String(id) }) });
      return { response, status: response.status, body: await response.json() };
    },
  };
}
async function run() {
  const h = createAttendanceHarness();
  assert.deepEqual(Object.keys(h.routes.detail), ['GET']);
  for (const actor of [null, { role: 'client', name: '客户' }]) {
    h.setActor(actor);
    for (const [route, method, body, id, query] of [['candidates', 'GET', null, null, '?type=attendance'], ['detail', 'GET', null, 1101], ['direct', 'POST', { other: '老板', card_type: 'attendance', card_id: '1101' }], ['group', 'POST', { group_id: 20, card_type: 'attendance', card_id: '1101' }]])
      assert.equal((await h.call(route, method, body, id, query)).status, actor ? 403 : 401);
  }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  h.setActor({ role: 'employee', name: '员工甲' });
  let r = await h.call('candidates', 'GET', null, null, '?type=attendance&employee=员工乙');
  assert.equal(r.status, 200); assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(r.body.map(c => c.id), ['1101', '1102', '1103']);
  assert(!JSON.stringify(r.body).includes('私密')); assert(!JSON.stringify(r.body).includes('private-clock'));
  assert.deepEqual(Object.keys(r.body[0]).sort(), ['id', 'status', 'subtitle', 'title']);
  for (const id of [1101, 1102, 1103]) { r = await h.call('detail', 'GET', null, id); assert.equal(r.body.id, id); assert.equal(r.response.headers.get('cache-control'), 'private, no-store'); }
  for (const id of [1104, 777, 99999]) assert.equal((await h.call('detail', 'GET', null, id)).status, 404);
  for (const id of ['0', '-1', '1e3', '01', '9007199254740992']) assert.equal((await h.call('detail', 'GET', null, id)).status, 400);
  assert.equal(h.writes.length, 0);
  console.log('PASS attendance_requests IDs, own-only minimal candidates and read-only detail, all historical statuses; clock-in ID 777 is not a request; spoofed employee ignored; client/anonymous denied and no writes');
  for (const route of ['direct', 'group']) {
    const scope = route === 'direct' ? { other: '老板' } : { group_id: 20 };
    const before = h.writes.length;
    for (const id of ['1104', '777', '99999', '1e3', '01']) assert.equal((await h.call(route, 'POST', { ...scope, card_type: 'attendance', card_id: id })).status, 404);
    assert.equal(h.writes.length, before);
    for (const id of ['1101', '1102', '1103']) {
      r = await h.call(route, 'POST', { ...scope, card_type: 'attendance', card_id: id, content: '{"title":"伪造内容"}', title: '伪造标题' });
      assert.equal(r.status, 201); assert.equal(r.body.message.order_id, 'attendance:' + id);
      const card = JSON.parse(r.body.message.content); assert.deepEqual(Object.keys(card).sort(), ['subtitle', 'title']);
      assert(card.title.includes(id)); assert(card.subtitle.includes('2024-06-16 09:15'));
      assert(!JSON.stringify(card).includes('伪造') && !JSON.stringify(card).includes('私密'));
    }
    for (const type of ['order', 'todo', 'project', 'customer', 'vat', 'wht', 'problem', 'issue', 'leave'])
      assert.equal((await h.call(route, 'POST', { ...scope, card_type: type, card_id: type === 'order' ? 'ORD-1' : type === 'leave' ? '1001' : '1' })).status, 201, type);
  }
  assert(h.previews.includes('[补签]'));
  await h.call('group', 'POST', { group_id: 20, card_type: 'attendance', card_id: '1101' });
  assert.equal((await h.call('groups')).body[0].last_preview, '[补签]');
  h.setMember(false); let before = h.writes.length;
  assert.equal((await h.call('group', 'POST', { group_id: 20, card_type: 'attendance', card_id: '1101' })).status, 403); assert.equal(h.writes.length, before); h.setMember(true);
  h.setActive(false); for (const route of ['direct', 'group']) assert.equal((await h.call(route, 'POST', { ...(route === 'direct' ? { other: '老板' } : { group_id: 20 }), card_type: 'attendance', card_id: '1101' })).status, 403); h.setActive(true);
  h.setActor({ role: 'admin', name: '老板' }); assert.equal((await h.call('candidates', 'GET', null, null, '?type=attendance')).body.length, 5);
  assert.equal((await h.call('detail', 'GET', null, 1104)).status, 200);
  for (const route of ['direct', 'group']) assert.equal((await h.call(route, 'POST', { ...(route === 'direct' ? { other: '员工甲' } : { group_id: 20 }), card_type: 'attendance', card_id: '1105' })).status, 201);
  console.log('PASS real direct/group handlers with canonical server snapshots; invalid/other-owner/clock-in IDs never write; admin, active sender and group membership; original nine cards and both previews preserved');
  const page = fs.readFileSync(path.join(root, 'src/app/(app)/messages/page.tsx'), 'utf8');
  const segment = page.slice(page.indexOf('// ── 分享卡片'), page.indexOf('// ── AI 总结'));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(segment + '\nObject.assign(exports,{CARD_META,SHARE_CATEGORIES,parseCard,quotePreview});', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  assert.equal(exports.SHARE_CATEGORIES.length, 13);
  const msg = { order_id: 'attendance:1101', content: JSON.stringify({ title: '员工甲的补签申请 #1101', subtitle: '2024-06-16 09:15 · 待审批' }) };
  assert.equal(exports.parseCard(msg).kind, 'attendance'); assert.equal(exports.quotePreview(msg), '[补签] 员工甲的补签申请 #1101');
  assert.equal(exports.CARD_META.attendance.href('1101'), '/internal?attendance_request=1101#attendance-requests');
  console.log('PASS thirteen frontend categories, parser, quote preview and exact request URL. No database imported or opened.');
}
module.exports = { createAttendanceHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
