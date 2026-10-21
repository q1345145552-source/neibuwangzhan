#!/usr/bin/env node
// Actual handlers with mock query objects only. No SQLite, environment files or network.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, dependencies = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, URL, Response, require(name) {
    if (Object.hasOwn(dependencies, name)) return dependencies[name];
    throw Error(`Unexpected dependency: ${name}`);
  } });
  return exports;
}
function createHarness() {
  const leaves = ['待审批', '已通过', '已驳回', '待审批'].map((status, i) => ({
    id: 1001 + i, employee_name: i === 3 ? '员工乙' : '员工甲', status,
    start_date: `202${i === 0 ? 6 : 4}-01-0${i + 1}`, end_date: `202${i === 0 ? 6 : 4}-01-0${i + 1}`,
    start_time: '09:00', end_time: '17:00', leave_type: '事假', reason: `私密原因${i}`,
    destination: '私密地点', images: '["private-photo.png"]', created_at: '2026-10-21 02:00:00',
  }));
  leaves.push({ ...leaves[0], id: 1005, employee_name: '历史离职员工' });
  let actor = { role: 'employee', name: '员工甲' }, member = true, active = true;
  const messages = [], writes = [], reads = [], previews = [];
  function project(sql, row) {
    if (!row) return undefined;
    const columns = sql.match(/SELECT ([\s\S]+?)\s+FROM leave_requests/)[1].split(',').map(c => c.trim());
    assert(!columns.includes('*'));
    return Object.fromEntries(columns.map(c => [c, row[c]]));
  }
  const db = { prepare(sql) { return {
    get(...args) {
      reads.push(sql);
      if (sql.includes('FROM leave_requests')) {
        assert(sql.includes('WHERE id=?'));
        if (actor.role !== 'admin') assert(sql.includes('AND employee_name=?') && args[1] === actor.name);
        return project(sql, leaves.find(r => r.id === args[0] && (!sql.includes('AND employee_name=?') || r.employee_name === args[1])));
      }
      if (sql.includes('FROM employees WHERE name')) return active && ['员工甲', '员工乙', '老板'].includes(args[0]) ? { id: 2 } : undefined;
      if (sql.includes('FROM conversations')) return { id: 10 };
      if (sql.includes('FROM chat_groups')) return args[0] === 20 ? { id: 20, name: '模拟群', owner: '老板' } : undefined;
      if (sql.includes('FROM group_members')) return member ? { id: 1 } : undefined;
      if (sql.includes('FROM messages WHERE id')) return messages.find(m => m.id === args[0]);
      if (/FROM (orders|todos|projects|customers|vat_records|wht_records|problems|issue_tickets)/.test(sql)) return {
        customer_name: '旧订单客户', content: '旧待办', name: '旧项目', current_phase: '执行', company_name: '旧公司',
        year_month: '2026-10', problem_number: 'P-1', ticket_number: 'TK-1', description: '旧工单', description_zh: '',
      };
      throw Error('Unexpected get: ' + sql);
    },
    all(...args) {
      reads.push(sql);
      if (sql.includes('FROM leave_requests')) {
        if (actor.role !== 'admin') assert(sql.includes('WHERE employee_name=?') && args[0] === actor.name);
        assert(!/reason|destination|images|leave_type/.test(sql));
        return leaves.filter(r => !sql.includes('WHERE employee_name=?') || r.employee_name === args[0]).map(r => project(sql, r));
      }
      if (sql.includes('FROM group_members')) return [{ member: '老板' }, { member: '员工甲' }, { member: '员工乙' }];
      if (sql.includes('FROM chat_groups g')) {
        const m = messages.filter(m => m.group_id).at(-1);
        return [{ id: 20, name: '模拟群', owner: '老板', background: '', announcement: '', avatar: '', muted: 0,
          last_content: m?.content, last_order_id: m?.order_id, last_image_url: m?.image_url, last_sender: m?.sender, last_at: m?.created_at }];
      }
      throw Error('Unexpected all: ' + sql);
    },
    run(...args) {
      writes.push(sql);
      if (sql.startsWith('INSERT INTO messages')) {
        const [scope, sender, receiver, content, image_url, order_id, reply_to, reply_preview, created_at] = args;
        const group = sql.includes('(group_id,');
        const message = { id: messages.length + 1, conversation_id: group ? null : scope, group_id: group ? scope : null,
          sender, receiver, content, image_url, order_id, reply_to, reply_preview, created_at, is_read: 0, read_at: null, recalled: 0 };
        messages.push(message); return { lastInsertRowid: message.id };
      }
      if (sql.startsWith('UPDATE conversations')) { previews.push(args[1]); return {}; }
      assert(sql.startsWith('INSERT OR IGNORE INTO message_reads') || sql.startsWith('INSERT OR IGNORE INTO message_mentions'), sql);
      return {};
    },
  }; } };
  const helper = load('src/lib/chat-leave-card.ts');
  const deps = { 'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: auth => ['admin', 'employee'].includes(auth.role) },
    '@/lib/db': { getDb: () => db }, '@/lib/req': { readJson: req => req.json() }, '@/lib/chat-leave-card': helper,
    '@/lib/chat-attendance-card': load('src/lib/chat-attendance-card.ts'), '@/lib/chat-report-card': load('src/lib/chat-report-card.ts'), '@/lib/chat-notice-card': load('src/lib/chat-notice-card.ts') };
  const routes = Object.fromEntries(Object.entries({ candidates: 'chat/share-items', direct: 'chat', group: 'chat/group-messages', groups: 'chat/groups', detail: 'leave/[id]' })
    .map(([key, file]) => [key, load(`src/app/api/${file}/route.ts`, deps)]));
  return { leaves, messages, writes, reads, previews, helper, db, routes,
    setActor(next) { actor = next; }, setMember(value) { member = value; }, setActive(value) { active = value; },
    async call(route, method = 'GET', body, id, query = '') {
      const req = new Request('http://mock/api/' + route + query, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const response = await routes[route][method](req, { params: Promise.resolve({ id: String(id) }) });
      return { response, status: response.status, body: await response.json() };
    },
  };
}
async function run() {
  const h = createHarness();
  for (const actor of [null, { role: 'client', name: '客户' }]) {
    h.setActor(actor);
    for (const [route, method, body, id, query] of [['candidates', 'GET', null, null, '?type=leave'], ['detail', 'GET', null, 1001], ['direct', 'POST', { other: '老板', card_type: 'leave', card_id: '1001' }], ['group', 'POST', { group_id: 20, card_type: 'leave', card_id: '1001' }]])
      assert.equal((await h.call(route, method, body, id, query)).status, actor ? 403 : 401);
  }
  assert.equal(h.reads.length, 0); assert.equal(h.writes.length, 0);
  h.setActor({ role: 'employee', name: '员工甲' });
  let r = await h.call('candidates', 'GET', null, null, '?type=leave&employee=员工乙');
  assert.equal(r.status, 200); assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(r.body.map(c => c.id), ['1001', '1002', '1003']);
  assert(!JSON.stringify(r.body).includes('私密')); assert.deepEqual(Object.keys(r.body[0]).sort(), ['id', 'status', 'subtitle', 'title']);
  for (const id of [1001, 1002, 1003]) assert.equal((await h.call('detail', 'GET', null, id)).body.id, id);
  assert.equal((await h.call('detail', 'GET', null, 1004)).status, 404);
  for (const id of ['0', '-1', '1e3', '01', 'NaN', '9007199254740992']) assert.equal((await h.call('detail', 'GET', null, id)).status, 400);
  assert.equal((await h.call('candidates', 'GET', null, null, '?type=unknown')).status, 400);
  assert.equal(h.writes.length, 0);
  console.log('PASS candidate and detail role/ownership checks; three historical states; forged employee filter ignored; minimal card payload, private no-store, invalid IDs; reads do not write');
  for (const route of ['direct', 'group']) {
    const scope = route === 'direct' ? { other: '老板' } : { group_id: 20 };
    const before = h.writes.length;
    for (const id of ['1004', '99999', '1e3', '01']) assert.equal((await h.call(route, 'POST', { ...scope, card_type: 'leave', card_id: id, content: '伪造原因' })).status, 404);
    assert.equal(h.writes.length, before, 'Invalid or unauthorized card must not create messages/conversations');
    for (const id of ['1001', '1002', '1003']) {
      r = await h.call(route, 'POST', { ...scope, card_type: 'leave', card_id: id, content: '{"title":"伪造内容"}', title: '伪造标题' });
      assert.equal(r.status, 201); assert.equal(r.body.message.order_id, 'leave:' + id);
      const card = JSON.parse(r.body.message.content); assert.deepEqual(Object.keys(card).sort(), ['subtitle', 'title']);
      assert(card.title.includes('员工甲') && card.title.includes(id)); assert(!JSON.stringify(card).includes('伪造') && !JSON.stringify(card).includes('私密'));
    }
    for (const type of ['order', 'todo', 'project', 'customer', 'vat', 'wht', 'problem', 'issue'])
      assert.equal((await h.call(route, 'POST', { ...scope, card_type: type, card_id: type === 'order' ? 'ORD-1' : '1' })).status, 201, type);
    assert.equal((await h.call(route, 'POST', { ...scope, order_id: 'OLD-ORDER' })).status, 201);
  }
  assert(h.previews.includes('[请假]'));
  await h.call('group', 'POST', { group_id: 20, card_type: 'leave', card_id: '1001' });
  assert.equal((await h.call('groups')).body[0].last_preview, '[请假]');
  h.setMember(false); const before = h.writes.length;
  assert.equal((await h.call('group', 'POST', { group_id: 20, card_type: 'leave', card_id: '1001' })).status, 403);
  assert.equal(h.writes.length, before); h.setMember(true);
  h.setActive(false); assert.equal((await h.call('direct', 'POST', { other: '老板', card_type: 'leave', card_id: '1001' })).status, 403); h.setActive(true);
  h.setActor({ role: 'admin', name: '老板' }); assert.equal((await h.call('candidates', 'GET', null, null, '?type=leave')).body.length, 5);
  assert.equal((await h.call('detail', 'GET', null, 1004)).status, 200);
  for (const route of ['direct', 'group']) assert.equal((await h.call(route, 'POST', { ...(route === 'direct' ? { other: '员工甲' } : { group_id: 20 }), card_type: 'leave', card_id: '1005' })).status, 201);
  console.log('PASS direct and group real POST handlers; canonical server snapshots ignore forged text; owner/admin permissions, membership/active sender, all eight old card types and legacy order format; direct/group previews; no business or notification writes');
  const page = fs.readFileSync(path.join(root, 'src/app/(app)/messages/page.tsx'), 'utf8');
  const segment = page.slice(page.indexOf('// ── 分享卡片'), page.indexOf('// ── AI 总结'));
  const exports = {};
  vm.runInNewContext(ts.transpileModule(segment + '\nObject.assign(exports,{CARD_META,SHARE_CATEGORIES,parseCard,quotePreview,mapShareItem});', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports });
  assert.equal(exports.SHARE_CATEGORIES.length, 12);
  const msg = { order_id: 'leave:1001', content: JSON.stringify({ title: '员工甲的请假申请 #1001', subtitle: '日期与状态' }) };
  assert.equal(exports.parseCard(msg).kind, 'leave'); assert.equal(exports.CARD_META.leave.href('1001'), '/internal/leave?leave=1001');
  assert.equal(exports.quotePreview(msg), '[请假] 员工甲的请假申请 #1001');
  assert.equal(exports.parseCard({ order_id: 'OLD-ORDER', content: '旧客户' }).kind, 'order');
  for (const kind of ['order', 'todo', 'project', 'customer', 'vat', 'wht', 'problem', 'issue']) assert.equal(exports.parseCard({ order_id: kind + ':1', content: '{}' }).kind, kind);
  console.log('PASS twelve frontend categories, card parser, quote preview and exact leave URL; old eight and legacy cards compatible. Mock-only verification; no database loaded.');
}
module.exports = { createHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
