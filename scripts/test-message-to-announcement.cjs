#!/usr/bin/env node
// Execute the actual handlers with in-memory query objects only; never load SQLite, secrets or services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function load(file, dependencies = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, {
    exports, URL, Response, Date,
    require(name) {
      if (Object.hasOwn(dependencies, name)) return dependencies[name];
      throw Error('Unexpected dependency; no real driver or service may load: ' + name);
    },
  }, { filename: file });
  return exports;
}

function createAnnouncementHarness() {
  let actor = { id: 2, name: '员工甲', role: 'employee' };
  let nextId = 1, nextRecipientId = 1, dbCalls = 0, locks = 0, transactions = 0;
  let notificationAttempts = 0, failedNotification = null, aiCalls = 0;
  const employees = [
    { id: 1, name: '老板', role: 'admin', status: '在职' },
    { id: 2, name: '员工甲', role: 'employee', status: '在职' },
    { id: 3, name: '员工乙', role: 'employee', status: '在职' },
    { id: 4, name: '员工丙', role: 'employee', status: '在职' },
    { id: 5, name: '试用员工', role: 'employee', status: '试用期' },
    { id: 6, name: '离职员工', role: 'employee', status: '离职' },
    { id: 7, name: '客户', role: 'client', status: '在职' },
  ];
  const announcements = new Map(), recipients = new Map(), notifications = [], logs = [], writes = [], syncCalls = [];
  const sortedAnnouncements = () => [...announcements.values()].sort((a, b) => b.id - a.id);
  const recipientRows = id => [...recipients.values()].filter(row => row.announcement_id === Number(id)).sort((a, b) => a.id - b.id);
  const db = {
    transaction(fn) {
      const run = () => {
        const before = { announcements: copy([...announcements]), recipients: copy([...recipients]), notifications: copy(notifications), logs: copy(logs), nextId, nextRecipientId };
        transactions++; locks++;
        try { return fn(); }
        catch (error) {
          announcements.clear(); for (const [id, row] of before.announcements) announcements.set(id, row);
          recipients.clear(); for (const [id, row] of before.recipients) recipients.set(id, row);
          notifications.splice(0, notifications.length, ...before.notifications);
          logs.splice(0, logs.length, ...before.logs);
          nextId = before.nextId; nextRecipientId = before.nextRecipientId;
          throw error;
        } finally { locks--; }
      };
      run.immediate = run; return run;
    },
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim();
      return {
        run(...args) {
          writes.push({ sql, args: copy(args) });
          if (sql.startsWith('INSERT INTO announcements (')) {
            assert(locks > 0, 'Announcement creation is inside the shared transaction');
            const [title, body, attachments, type, deadline, created_by] = args;
            const id = nextId++;
            announcements.set(id, { id, title, body, attachments, type, deadline, created_by,
              created_at: '2026-10-22 03:00:00', recalled: 0, rule_id: null, converted_rule_id: null });
            return { lastInsertRowid: id, changes: 1 };
          }
          if (sql.startsWith('INSERT INTO announcement_recipients (')) {
            assert(locks > 0, 'Recipient creation is inside the shared transaction');
            const [announcement_id, employee_name] = args;
            assert(!recipientRows(announcement_id).some(row => row.employee_name === employee_name), 'Unique recipient per announcement');
            const id = nextRecipientId++;
            recipients.set(id, { id, announcement_id: Number(announcement_id), employee_name, status: '待读',
              retell_content: '', retell_th: '', retell_zh: '', reject_comment: '', updated_at: '2026-10-22 03:00:00' });
            return { lastInsertRowid: id, changes: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications (')) {
            assert(locks > 0, 'Notification creation is inside the shared transaction');
            notificationAttempts++;
            if (notificationAttempts === failedNotification) { failedNotification = null; throw Error('Simulated notification failure'); }
            const [type, title, body, recipient, related_id, related_type] = args;
            notifications.push({ type, title, body, recipient, related_id, related_type });
            return { lastInsertRowid: notifications.length, changes: 1 };
          }
          if (sql === "UPDATE announcement_recipients SET status = '已读待复述', updated_at = datetime('now') WHERE id = ?") {
            const row = recipients.get(Number(args[0]));
            assert(row, 'Read mutation must target an existing recipient');
            Object.assign(row, { status: '已读待复述', updated_at: '2026-10-22 03:01:00' });
            return { changes: 1 };
          }
          throw Error('Unexpected write: ' + sql);
        },
        get(...args) {
          if (sql === 'SELECT * FROM announcements WHERE id = ?') return copy(announcements.get(Number(args[0])));
          if (sql === 'SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?') {
            return copy(recipientRows(args[0]).find(row => row.employee_name === args[1]));
          }
          if (sql === 'SELECT * FROM announcement_recipients WHERE id = ?') return copy(recipients.get(Number(args[0])));
          throw Error('Unexpected lookup: ' + sql);
        },
        all(...args) {
          if (sql.startsWith('SELECT name FROM employees WHERE ')) {
            assert.match(sql, /role = 'employee'/); assert.match(sql, /status = '在职'/);
            const rows = employees.filter(row => row.role === 'employee' && row.status === '在职');
            if (sql.includes('name IN (')) return copy(rows.filter(row => args.includes(row.name)).map(({ name }) => ({ name })));
            return copy(rows.map(({ name }) => ({ name })));
          }
          if (sql === 'SELECT * FROM announcements ORDER BY id DESC') return copy(sortedAnnouncements());
          if (sql.startsWith('SELECT DISTINCT a.* FROM announcements a LEFT JOIN announcement_recipients r ')) {
            assert.match(sql, /r\.employee_name = \? OR a\.created_by = \?/);
            assert.deepEqual(args, [actor.name, actor.name]);
            return copy(sortedAnnouncements().filter(row => row.created_by === args[1] || recipientRows(row.id).some(rec => rec.employee_name === args[0])));
          }
          if (sql === 'SELECT * FROM announcement_recipients WHERE announcement_id = ? ORDER BY id ASC') return copy(recipientRows(args[0]));
          throw Error('Unexpected list: ' + sql);
        },
      };
    },
  };
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': { getDb() { dbCalls++; return db; }, logOperation(...args) { assert(locks > 0, 'Creation audit is inside the same transaction'); logs.push({ args: copy(args) }); } },
    '@/lib/req': load('src/lib/req.ts'), '@/lib/enums': load('src/lib/enums.ts'), '@/lib/announcement-feedback': load('src/lib/announcement-feedback.ts'),
    '@/lib/announcement-overdue': { syncAnnouncementOverdueTodos(name) { syncCalls.push(name); }, clearAnnouncementOverdueTodos() { throw Error('No existing notice mutations are authorized in this harness'); } },
    '@/lib/deepseek': { async compareRetell() { aiCalls++; throw Error('AI is not authorized in this mock'); } },
  };
  const routes = {
    list: load('src/app/api/announcements/route.ts', deps), item: load('src/app/api/announcements/[id]/route.ts', deps),
    review: load('src/app/api/announcements/[id]/review/route.ts', deps), recall: load('src/app/api/announcements/[id]/recall/route.ts', deps),
    ai: load('src/app/api/announcements/[id]/ai-compare/route.ts', deps), rule: load('src/app/api/announcements/[id]/to-rule/route.ts', deps),
  };
  return {
    db, employees, announcements, recipients, notifications, logs, writes, syncCalls,
    get actor() { return actor; }, setActor(value) { actor = value; },
    get dbCalls() { return dbCalls; }, get transactions() { return transactions; }, get aiCalls() { return aiCalls; },
    failNextNotification(nth = 1) { assert(Number.isInteger(nth) && nth > 0); failedNotification = notificationAttempts + nth; },
    state() { return JSON.stringify({ announcements: [...announcements], recipients: [...recipients], notifications, logs }); },
    async call(key = 'list', method = 'GET', body, id = 1) {
      const request = new Request('http://mock/api/announcements' + (key === 'list' ? '' : '/' + id), {
        method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const response = await routes[key][method](request, { params: Promise.resolve({ id: String(id) }) });
      return { response, status: response.status, body: await response.json() };
    },
  };
}

const create = { title: '  聊天转来的通知  ', body: '消息原文\n这是需要执行的内容', deadline: '2026-10-23T17:00', recipients: ['员工乙'] };

async function run() {
  for (const actor of [null, { id: 7, name: '客户', role: 'client' }]) {
    const h = createAnnouncementHarness(); h.setActor(actor); const old = h.state();
    for (const [key, method] of [['list', 'GET'], ['list', 'POST'], ['item', 'GET']]) {
      const result = await h.call(key, method, method === 'POST' ? { ...create, role: 'admin', created_by: '老板', name: '老板' } : undefined);
      assert.equal(result.status, actor ? 403 : 401);
    }
    assert.equal(h.dbCalls, 0); assert.equal(h.transactions, 0); assert.equal(h.writes.length, 0); assert.equal(h.state(), old);
  }
  console.log('PASS anonymous/client list/detail/create rejected before DB; forged request name, creator and role cannot grant access.');

  for (const actor of [{ id: 2, name: '员工甲', role: 'employee' }, { id: 1, name: '老板', role: 'admin' }]) {
    for (const recipients of [['员工乙', ' 员工丙 ', '员工乙'], 'all']) {
      const h = createAnnouncementHarness(); h.setActor(actor);
      const payload = { ...create, recipients, type: '长通知', attachments: ['/api/files/a.png', '', 2, ' /api/files/b.pdf '], created_by: '伪造者', role: 'admin', name: '伪造者' };
      const result = await h.call('list', 'POST', payload);
      assert.equal(result.status, 201); assert.equal(h.transactions, 1); assert.equal(h.announcements.size, 1); assert.equal(h.logs.length, 1);
      assert.equal(result.body.created_by, actor.name); assert.equal(result.body.title, create.title.trim()); assert.equal(result.body.body, create.body);
      assert.equal(result.body.type, '长通知'); assert.equal(result.body.deadline, create.deadline); assert.equal(result.body.attachments, '["/api/files/a.png","/api/files/b.pdf"]');
      const expected = recipients === 'all' ? ['员工甲', '员工乙', '员工丙'] : ['员工乙', '员工丙'];
      assert.deepEqual([...h.recipients.values()].map(row => row.employee_name), expected);
      assert([...h.recipients.values()].every(row => row.status === '待读'));
      assert.deepEqual(h.notifications.map(note => note.recipient), expected);
      for (const note of h.notifications) assert.deepEqual(note, { type: '老板通知', title: `${actor.name}给你发了通知`,
        body: `${actor.name}发来的通知「${create.title.trim()}」，请去复述`, recipient: note.recipient, related_id: String(result.body.id), related_type: 'announcement' });
      assert.deepEqual(h.logs[0].args.slice(0, 4), [actor.name, '发送通知', 'announcement', String(result.body.id)]);
    }
  }
  const defaults = createAnnouncementHarness();
  const defaultResult = await defaults.call('list', 'POST', create);
  assert.equal(defaultResult.status, 201); assert.equal(defaultResult.body.type, '短通知'); assert.equal(defaultResult.body.attachments, '[]');
  console.log('PASS employee/admin creation to selected/all active employees, deduplication, creator from auth, original body/attachments retained, short default and sender-specific notifications; clients/admin/left/probation not accidentally selected.');

  const invalid = createAnnouncementHarness();
  for (const payload of [
    {}, { ...create, title: '' }, { ...create, title: ' \n ' }, { ...create, body: '' }, { ...create, body: ' \n ' },
    { ...create, deadline: '' }, { ...create, deadline: ' ' }, { ...create, type: '无效类型' },
    ...[undefined, [], '', [' '], ['不存在'], ['客户'], ['老板'], ['离职员工'], ['试用员工'], ['员工乙', '客户']].map(recipients => ({ ...create, recipients })),
  ]) {
    const old = invalid.state(), writes = invalid.writes.length;
    assert.equal((await invalid.call('list', 'POST', payload)).status, 400, JSON.stringify(payload));
    assert.equal(invalid.state(), old); assert.equal(invalid.writes.length, writes);
  }
  console.log('PASS required title/body/deadline, invalid type, absent/empty or invalid recipients return 400 with zero announcement/recipient/notification/audit writes.');

  const rollback = createAnnouncementHarness();
  assert.equal((await rollback.call('list', 'POST', create)).status, 201);
  const old = rollback.state(); rollback.failNextNotification(2);
  await assert.rejects(() => rollback.call('list', 'POST', { ...create, recipients: ['员工乙', '员工丙'] }), /Simulated notification failure/);
  assert.equal(rollback.state(), old, 'Notification failure rolls back announcement, recipient rows, earlier notification and audit');
  assert.equal((await rollback.call('list', 'POST', { ...create, recipients: ['员工乙', '员工丙'] })).status, 201);
  assert.equal(rollback.announcements.size, 2); assert.equal(rollback.notifications.length, 3); assert.equal(rollback.logs.length, 2);
  console.log('PASS actual shared transaction rolls back on second recipient notification failure, preserves earlier records, and allows retry.');

  const visible = createAnnouncementHarness();
  const sent = (await visible.call('list', 'POST', create)).body.id;
  visible.setActor({ id: 1, name: '老板', role: 'admin' });
  const received = (await visible.call('list', 'POST', { ...create, title: '发给甲和乙', recipients: ['员工甲', '员工乙'] })).body.id;
  const unrelated = (await visible.call('list', 'POST', { ...create, title: '只发给丙', recipients: ['员工丙'] })).body.id;
  visible.setActor({ id: 2, name: '员工甲', role: 'employee' });
  const sentAndReceived = (await visible.call('list', 'POST', { ...create, title: '自己也接收', recipients: ['员工甲', '员工乙'] })).body.id;
  let result = await visible.call('list', 'GET');
  assert.deepEqual(result.body.map(row => row.id), [sentAndReceived, received, sent]);
  assert(result.body.every(row => Array.isArray(row.recipients))); assert.equal(visible.syncCalls.length, 0);
  assert.equal(result.body.filter(row => row.id === sentAndReceived).length, 1, 'Own sent-and-received announcement appears once');
  const beforeRead = visible.writes.length;
  result = await visible.call('item', 'GET', undefined, sent);
  assert.equal(result.status, 200); assert.equal(result.body.body, create.body); assert.equal(result.body.my_recipient, null);
  assert.equal(visible.writes.length, beforeRead, 'Sender-only view must not mark a different recipient read');
  result = await visible.call('item', 'GET', undefined, received);
  assert.equal(result.status, 200); assert.equal(result.body.my_recipient.employee_name, '员工甲'); assert.equal(result.body.my_recipient.status, '已读待复述');
  assert.equal(visible.writes.length, beforeRead + 1);
  result = await visible.call('item', 'GET', undefined, received); assert.equal(result.body.my_recipient.status, '已读待复述');
  assert.equal(visible.writes.length, beforeRead + 1, 'Read reopening does not create another read mutation');
  const oldBeforeDenied = visible.state();
  assert.equal((await visible.call('item', 'GET', undefined, unrelated)).status, 403); assert.equal(visible.state(), oldBeforeDenied);
  assert.equal((await visible.call('item', 'GET', undefined, 99999)).status, 404);
  visible.announcements.get(sentAndReceived).recalled = 1;
  result = await visible.call('item', 'GET', undefined, sentAndReceived);
  assert.equal(result.body.my_recipient.status, '待读', 'Recalled announcements do not mutate recipient read state');
  visible.setActor({ id: 1, name: '老板', role: 'admin' });
  result = await visible.call('list', 'GET'); assert.deepEqual(result.body.map(row => row.id), [sentAndReceived, unrelated, received, sent]);
  assert.deepEqual(visible.syncCalls, ['老板']);
  result = await visible.call('item', 'GET', undefined, sent); assert.equal(result.status, 200); assert.equal(result.body.my_recipient, null);
  console.log('PASS employee sees sent or received once, creator can open original body without becoming a recipient, real recipient reads mark once, unrelated access denied, recalled read preserved, admin sees all with original mocked sync call.');

  for (const actor of [null, { id: 7, name: '客户', role: 'client' }, { id: 2, name: '员工甲', role: 'employee' }]) {
    const h = createAnnouncementHarness(); h.setActor(actor);
    for (const [key, method] of [['item', 'PATCH'], ['item', 'DELETE'], ['review', 'PATCH'], ['recall', 'PATCH'], ['ai', 'POST'], ['rule', 'POST']]) {
      assert.equal((await h.call(key, method, ['PATCH', 'POST'].includes(method) ? { role: 'admin', created_by: '员工甲', employee_name: '员工乙' } : undefined)).status, actor ? 403 : 401);
    }
    assert.equal(h.dbCalls, 0); assert.equal(h.writes.length, 0); assert.equal(h.aiCalls, 0);
  }
  console.log('PASS publishing does not grant employees admin edit/delete/recall/review/AI/to-rule rights; anonymous/client also denied before DB or AI calls.');
  console.log('PASS mock-only actual-handler verification: no real database constructor, environment, business records, notifications, uploads or network loaded.');
}

module.exports = { createAnnouncementHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
