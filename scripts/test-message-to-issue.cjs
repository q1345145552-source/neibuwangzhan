#!/usr/bin/env node
// Actual issue handler, in-memory query objects only. No database driver, environment or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

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

function createIssueHarness() {
  let actor = { id: 2, name: '员工甲', role: 'employee' };
  let nextId = 1, dbCalls = 0, locks = 0, transactions = 0, notificationAttempts = 0, failedNotification = null;
  const tickets = new Map(), notifications = [], logs = [], writes = [];
  const copy = value => JSON.parse(JSON.stringify(value));
  const db = {
    transaction(fn) {
      const run = () => {
        const before = { tickets: copy([...tickets]), notifications: copy(notifications), logs: copy(logs), nextId };
        transactions++; locks++;
        try { return fn(); }
        catch (error) {
          tickets.clear(); for (const [id, ticket] of before.tickets) tickets.set(id, ticket);
          notifications.splice(0, notifications.length, ...before.notifications);
          logs.splice(0, logs.length, ...before.logs);
          nextId = before.nextId;
          throw error;
        } finally { locks--; }
      };
      run.immediate = run;
      return run;
    },
    prepare(raw) {
      const sql = raw.replace(/\s+/g, ' ').trim();
      return {
        run(...args) {
          assert(locks > 0, 'Issue creation, audit and notifications must share a transaction');
          writes.push({ sql, args: copy(args) });
          if (sql.startsWith('INSERT INTO issue_tickets (')) {
            const match = sql.match(/^INSERT INTO issue_tickets \(([^)]+)\) VALUES \(([^)]+)\)$/);
            assert(match, 'Recognized parameterized issue insertion');
            const columns = match[1].split(',').map(column => column.trim());
            assert.equal(match[2].split(',').length, columns.length);
            assert(match[2].split(',').every(value => value.trim() === '?'), 'All inserted values are bound');
            assert.equal(args.length, columns.length);
            const ticket = { id: nextId++, ticket_number: '', ref_id: '', ref_type: '', description_zh: '',
              priority: 'medium', status: '待处理', assignee: '', created_by: '', resolved_by: '', resolved_at: null,
              withdrawn_by: '', withdrawn_at: null, images: '[]', resolve_screenshot: '',
              ...Object.fromEntries(columns.map((column, index) => [column, args[index]])) };
            tickets.set(ticket.id, ticket);
            return { lastInsertRowid: ticket.id, changes: 1 };
          }
          if (sql.startsWith('INSERT INTO notifications (')) {
            notificationAttempts++;
            if (notificationAttempts === failedNotification) { failedNotification = null; throw Error('Simulated notification failure'); }
            const [type, title, body, recipient, related_id, related_type] = args;
            notifications.push({ type, title, body, recipient, related_id, related_type });
            return { lastInsertRowid: notifications.length, changes: 1 };
          }
          throw Error('Unexpected write: ' + sql);
        },
        get(...args) {
          assert.equal(sql, 'SELECT * FROM issue_tickets WHERE id = ?');
          const row = tickets.get(Number(args[0]));
          return row ? copy(row) : undefined;
        },
        all(...args) {
          assert(sql.startsWith('SELECT * FROM issue_tickets WHERE 1=1'), 'Only existing issue list queries are allowed');
          let rows = [...tickets.values()], index = 0;
          for (const field of ['status', 'assignee', 'created_by']) {
            if (sql.includes('AND ' + field + ' = ?')) { const value = args[index++]; rows = rows.filter(row => row[field] === value); }
          }
          return copy(rows.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id));
        },
      };
    },
  };
  const route = load('src/app/api/issues/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => actor, isStaff: value => ['admin', 'employee'].includes(value.role) },
    '@/lib/db': {
      getDb() { dbCalls++; return db; },
      logOperation(...args) { assert(locks > 0, 'Audit is inside the same transaction'); logs.push({ args: copy(args) }); },
    },
    '@/lib/req': load('src/lib/req.ts'),
    '@/lib/chat-todo-issue-card': load('src/lib/chat-todo-issue-card.ts'),
  });
  return {
    tickets, notifications, logs, writes,
    get actor() { return actor; },
    setActor(value) { actor = value; },
    get dbCalls() { return dbCalls; },
    get transactions() { return transactions; },
    failNextNotification(nth = 1) {
      assert(Number.isInteger(nth) && nth > 0);
      failedNotification = notificationAttempts + nth;
    },
    state() { return JSON.stringify({ tickets: [...tickets], notifications, logs }); },
    async call(method = 'POST', body, query = '') {
      const request = new Request('http://mock/api/issues' + query, {
        method,
        ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      const response = await route[method](request);
      return { response, status: response.status, body: await response.json() };
    },
  };
}

const create = {
  description: '聊天原文：请处理这个问题\n可以补充修改', assignee: ['员工乙'], created_by: '员工甲',
};

function testActualLongPressCallbacks() {
  const file = 'src/app/(app)/messages/page.tsx';
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = ['closeMenu', 'showMessageMenu', 'startLongPress', 'cancelLongPress', 'finishLongPress', 'abortLongPress'];
  const callbacks = new Map();
  let messageTouchHandlers = false;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.includes(node.name.text)) {
      assert(!callbacks.has(node.name.text), 'Long-press callback has a unique declaration');
      assert(node.initializer);
      callbacks.set(node.name.text, node.initializer.getText(tree));
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(tree) === 'div') {
      const attributes = new Map(node.attributes.properties.filter(ts.isJsxAttribute).map(attribute =>
        [attribute.name.getText(tree), attribute.initializer && ts.isJsxExpression(attribute.initializer) ? attribute.initializer.expression?.getText(tree) : '']));
      if (attributes.get('onTouchEnd') === 'finishLongPress') {
        assert.equal(attributes.get('onTouchMove'), 'cancelLongPress');
        assert.equal(attributes.get('onTouchCancel'), 'abortLongPress');
        assert.match(attributes.get('onTouchStart') || '', /startLongPress\(e, m\.id\)/);
        assert.match(attributes.get('onContextMenu') || '', /showMessageMenu\(m\.id, e\.clientX, e\.clientY\)/);
        messageTouchHandlers = true;
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(callbacks.size, names.length); assert(messageTouchHandlers, 'Actual message element wires all tested touch callbacks');
  const timers = new Map(), cleared = [], longPressTimerRef = { current: null }, longPressTriggeredRef = { current: false };
  let clock = 0, nextTimer = 1, menu = null;
  const context = {
    longPressTimerRef, longPressTriggeredRef, window: { innerWidth: 390, innerHeight: 844 },
    setMenuState(value) { menu = value; },
    setTimeout(fn, delay) { const id = nextTimer++; timers.set(id, { at: clock + delay, fn }); return id; },
    clearTimeout(id) { cleared.push(id); timers.delete(id); },
  };
  const compiled = ts.transpileModule(names.map(name => `const ${name} = ${callbacks.get(name)};`).join('\n') +
    '\nglobalThis.actualCallbacks = { ' + names.join(',') + ' };', {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, context, { filename: file + ':extracted-long-press-callbacks' });
  const actual = context.actualCallbacks;
  const event = (touches = [{ clientX: 45, clientY: 740 }]) => ({
    touches, prevented: 0, stopped: 0,
    preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; },
  });
  function advance(ms) {
    const until = clock + ms;
    while (true) {
      const next = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next; clock = timer.at; timers.delete(id); timer.fn();
    }
    clock = until;
  }
  function clean() {
    assert.equal(timers.size, 0); assert.equal(longPressTimerRef.current, null); assert.equal(longPressTriggeredRef.current, false);
  }
  actual.startLongPress(event(), 11); advance(499);
  const short = event(); actual.finishLongPress(short); advance(1000);
  assert.equal(short.prevented, 0); assert.equal(short.stopped, 0); assert.equal(menu, null); clean();

  actual.startLongPress(event(), 12); advance(500);
  assert.equal(menu.id, 12); assert.equal(longPressTriggeredRef.current, true);
  assert(menu.x >= 0 && menu.y >= 8 && menu.y <= 844 - 320);
  const long = event(); actual.finishLongPress(long);
  assert.equal(long.prevented, 1); assert.equal(long.stopped, 1); assert.equal(menu.id, 12); clean();
  // A normal, later click must still close the menu; only the releasing touch is suppressed.
  actual.closeMenu(); assert.equal(menu, null);

  actual.startLongPress(event(), 13); advance(250); actual.cancelLongPress(); advance(500);
  const moved = event(); actual.finishLongPress(moved);
  assert.equal(menu, null); assert.equal(moved.prevented, 0); assert.equal(moved.stopped, 0); clean();

  actual.startLongPress(event(), 14); advance(500); actual.cancelLongPress();
  assert.equal(longPressTriggeredRef.current, true, 'Moving after the menu opens must retain the release suppression');
  const movedAfterOpen = event(); actual.finishLongPress(movedAfterOpen);
  assert.equal(movedAfterOpen.prevented, 1); assert.equal(movedAfterOpen.stopped, 1); assert.equal(menu.id, 14); clean();
  actual.closeMenu();

  actual.startLongPress(event(), 15); advance(200); actual.abortLongPress(); advance(500);
  assert.equal(menu, null); clean();
  actual.startLongPress(event(), 16); advance(500); actual.abortLongPress(); clean();
  const cancelledRelease = event(); actual.finishLongPress(cancelledRelease);
  assert.equal(cancelledRelease.prevented, 0); assert.equal(cancelledRelease.stopped, 0);
  actual.closeMenu();

  actual.startLongPress(event(), 17); const staleTimer = longPressTimerRef.current; advance(300);
  actual.startLongPress(event(), 18);
  assert(cleared.includes(staleTimer)); assert.equal(timers.size, 1); assert.equal(longPressTriggeredRef.current, false);
  advance(200); assert.equal(menu, null, 'Repeated start must not open the previous message menu');
  advance(300); assert.equal(menu.id, 18);
  const repeatedRelease = event(); actual.finishLongPress(repeatedRelease);
  assert.equal(repeatedRelease.prevented, 1); clean(); actual.closeMenu();
  actual.startLongPress(event(), 19); advance(500);
  actual.startLongPress(event(), 20); assert.equal(longPressTriggeredRef.current, false);
  const newShort = event(); actual.finishLongPress(newShort); assert.equal(newShort.prevented, 0); clean();
  actual.closeMenu(); actual.startLongPress(event([]), 21); advance(1000); assert.equal(menu, null); clean();
  // Desktop right-click uses the existing direct callback and needs no touch suppression.
  actual.showMessageMenu(22, 389, 843); assert.equal(menu.id, 22); assert.equal(longPressTriggeredRef.current, false);
  actual.closeMenu();
  console.log('PASS actual AST-extracted long-press callbacks and JSX wiring: short taps preserved; release after 500ms suppresses ghost click; movement cancels pending timer but retains triggered suppression; touchcancel/repeated start clean refs/timers; desktop menu preserved.');
}

async function run() {
  for (const actor of [null, { id: 9, name: '客户', role: 'client' }]) {
    const h = createIssueHarness(); h.setActor(actor); const before = h.state();
    assert.equal((await h.call('POST', { ...create, status: '已解决', role: 'admin' })).status, actor ? 403 : 401);
    assert.equal(h.dbCalls, 0); assert.equal(h.transactions, 0); assert.equal(h.state(), before); assert.equal(h.writes.length, 0);
  }
  console.log('PASS anonymous/client rejected before DB access; forged role does not grant creation or notifications.');

  for (const actor of [{ id: 2, name: '员工甲', role: 'employee' }, { id: 1, name: '老板', role: 'admin' }]) {
    for (const assignee of [['员工乙'], ['员工乙', '老板']]) for (const status of ['待处理', '处理中', '已解决']) {
      const h = createIssueHarness(); h.setActor(actor);
      const payload = { ...create, created_by: actor.name, assignee, status, resolved_by: '伪造解决人', resolved_at: '2000-01-01',
        ticket_number: 'TK-MOCK', ref_id: '42', ref_type: 'order', priority: 'high', images: ['proof.png', ''] };
      const r = await h.call('POST', payload);
      assert.equal(r.status, 201); assert.equal(h.tickets.size, 1); assert.equal(h.transactions, 1);
      assert.equal(r.body.description, payload.description); assert.equal(r.body.assignee, assignee.join(',')); assert.equal(r.body.status, status);
      assert.equal(r.body.created_by, actor.name); assert.equal(r.body.ticket_number, 'TK-MOCK'); assert.equal(r.body.ref_id, '42');
      assert.equal(r.body.ref_type, 'order'); assert.equal(r.body.priority, 'high'); assert.equal(r.body.images, '["proof.png"]');
      assert.equal(r.body.updated_at, r.body.created_at); assert(Number.isFinite(Date.parse(r.body.created_at)));
      assert.equal(r.body.resolved_by, status === '已解决' ? actor.name : '');
      assert.equal(r.body.resolved_at, status === '已解决' ? r.body.created_at : null);
      assert.equal(h.logs.length, 1);
      assert.deepEqual(h.logs[0].args, [actor.name, '提交工单', 'issue', String(r.body.id), payload.description]);
      assert.equal(h.notifications.length, assignee.length);
      assert.deepEqual(h.notifications.map(note => note.recipient), assignee);
      for (const note of h.notifications) assert.deepEqual(note, {
        type: '工单指派', title: '新问题工单', body: payload.description, recipient: note.recipient,
        related_id: String(r.body.id), related_type: 'issue',
      });
    }
  }
  console.log('PASS employee/admin, single/multiple assignees and all three states; original fields/audit/assignment notices preserved; solved metadata uses authenticated actor and creation time.');

  const legacy = createIssueHarness();
  let r = await legacy.call('POST', { ...create, assignee: ' 员工乙 ' });
  assert.equal(r.status, 201); assert.equal(r.body.status, '待处理'); assert.equal(r.body.assignee, '员工乙');
  assert.equal(r.body.priority, 'medium'); assert.equal(r.body.images, '[]'); assert.equal(r.body.resolved_by, ''); assert.equal(r.body.resolved_at, null);
  r = await legacy.call('POST', { ...create, assignee: [' 员工乙 ', ' ', '老板'] });
  assert.equal(r.status, 201); assert.equal(r.body.assignee, '员工乙,老板');
  assert.deepEqual(legacy.notifications.map(note => note.recipient), ['员工乙', '员工乙', '老板']);
  console.log('PASS existing POST without status defaults to pending; string assignee and trimmed array/blank entries remain compatible.');

  const invalid = createIssueHarness();
  const denied = [
    {}, { ...create, description: '' }, { ...create, description: '  \n ' }, { ...create, assignee: undefined }, { ...create, assignee: [] },
    { ...create, assignee: '' }, { ...create, assignee: '  ' }, { ...create, assignee: [' ', ''] },
    ...['已撤回', '', null, false, 1, [], {}].map(status => ({ ...create, status })),
  ];
  for (const body of denied) {
    const before = invalid.state(), transactionCount = invalid.transactions, writes = invalid.writes.length;
    assert.equal((await invalid.call('POST', body)).status, 400, JSON.stringify(body));
    assert.equal(invalid.state(), before); assert.equal(invalid.writes.length, writes); assert.equal(invalid.transactions, transactionCount);
  }
  console.log('PASS missing/blank description or assignee and explicitly invalid status return 400 without business/audit/notification writes.');

  const rollback = createIssueHarness();
  assert.equal((await rollback.call('POST', create)).status, 201);
  const before = rollback.state(); rollback.failNextNotification(2);
  await assert.rejects(() => rollback.call('POST', { ...create, assignee: ['员工乙', '老板'], status: '已解决' }), /Simulated notification failure/);
  assert.equal(rollback.state(), before, 'Failure of the second notification rolls back issue, audit and first notification together');
  assert.equal(rollback.tickets.size, 1); assert.equal(rollback.notifications.length, 1); assert.equal(rollback.logs.length, 1);
  assert.equal((await rollback.call('POST', { ...create, status: '处理中' })).status, 201);
  assert.equal(rollback.tickets.size, 2); assert.equal(rollback.notifications.length, 2); assert.equal(rollback.logs.length, 2);
  console.log('PASS simulated second-assignee notification failure rolls back the full transaction and preserves earlier records; subsequent retry succeeds.');
  testActualLongPressCallbacks();
  console.log('PASS mock-only verification: real handler and request helper; no SQLite constructor, environment, network or real notifications loaded.');
}

module.exports = { createIssueHarness };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
