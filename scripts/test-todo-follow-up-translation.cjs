#!/usr/bin/env node
// Actual follow-up translation/history/list handlers with strict in-memory objects.
// Never loads SQLite, application configuration, secrets, real AI or a network service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createTodoTranslationHarness, admin, staff, deferred, load } = require('./test-todo-content-translation.cjs');
const root = path.resolve(__dirname, '..');
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

function createTodoFollowUpTranslationHarness() {
  const h = createTodoTranslationHarness(), originalPrepare = h.db.prepare.bind(h.db);
  const followUps = new Map(), followAiCalls = [];
  let followTranslator = async () => '已联系客户，等待客户补充资料。';
  let beforeFollowWrite, zeroNextFollowWrite = false, nextFollowId = 4200;
  for (const [id, todo_id, content, created_at] of [
    [4101, 3101, 'ติดต่อลูกค้าแล้วและรอเอกสารเพิ่มเติม', '2026-10-25 03:00:00'],
    [4102, 3101, 'โทรหาลูกค้าเพื่อนัดหมายแล้ว', '2026-10-25 02:00:00'],
    [4103, 3102, 'ตรวจสอบข้อมูลของพาร์ทเนอร์แล้ว', '2026-10-25 03:00:00'],
    [4104, 3101, '', '2026-10-25 01:00:00'],
    [4105, 3103, 'ส่งเอกสารเรียบร้อยแล้ว', '2026-10-25 03:00:00'],
  ]) followUps.set(id, { id, todo_id, content, content_zh: '', content_zh_key: '',
    images: id === 4102 ? '{invalid-json' : '["/api/files/mock.jpg"]', created_by: id === 4103 ? '员工乙' : '员工甲', created_at });
  const forTodo = id => [...followUps.values()].filter(follow => follow.todo_id === Number(id))
    .sort((left, right) => right.created_at.localeCompare(left.created_at) || right.id - left.id);
  h.db.prepare = raw => {
    const sql = raw.replace(/\s+/g, ' ').trim(), fallback = originalPrepare(raw);
    return {
      get(...args) {
        if (sql === 'SELECT * FROM todo_follow_ups WHERE id = ?') return copy(followUps.get(Number(args[0])));
        if (sql === 'SELECT f.id, f.todo_id, f.content, f.content_zh, f.content_zh_key, t.assignee, t.content AS todo_content FROM todo_follow_ups f JOIN todos t ON t.id = f.todo_id WHERE f.id = ? AND f.todo_id = ?') {
          assert.equal(args.length, 2);
          const follow = followUps.get(Number(args[0])), todo = follow && h.todos.get(follow.todo_id);
          return follow && todo && follow.todo_id === Number(args[1]) ? { ...copy(follow), assignee: todo.assignee, todo_content: todo.content } : undefined;
        }
        return fallback.get(...args);
      },
      all(...args) {
        if (sql === 'SELECT * FROM todo_follow_ups WHERE todo_id = ? ORDER BY created_at DESC, id DESC') return copy(forTodo(args[0]));
        if (sql.startsWith('SELECT t.*,') && sql.includes('FROM todos t') && sql.includes('ORDER BY CASE t.priority')) {
          assert(sql.includes('AS latest_follow_id') && sql.includes('AS latest_follow_content_zh') && sql.includes('AS latest_follow_content_zh_key'));
          return fallback.all(...args).map(todo => {
            const latest = forTodo(todo.id)[0];
            return { ...todo, latest_follow_id: latest?.id ?? null, latest_follow_content: latest?.content ?? null,
              latest_follow_content_zh: latest?.content_zh ?? null, latest_follow_content_zh_key: latest?.content_zh_key ?? null,
              latest_follow_by: latest?.created_by ?? null, latest_follow_at: latest?.created_at ?? null };
          });
        }
        return fallback.all(...args);
      },
      run(...args) {
        if (sql === 'UPDATE todo_follow_ups SET content_zh = ?, content_zh_key = ? WHERE id = ? AND todo_id = ? AND content = ? AND EXISTS (SELECT 1 FROM todos WHERE id = todo_follow_ups.todo_id AND assignee = ? AND content = ?)') {
          assert.equal(args.length, 7);
          h.writes.push({ sql, args: copy(args) });
          if (beforeFollowWrite) { const callback = beforeFollowWrite; beforeFollowWrite = undefined; callback({ sql, args }); }
          if (zeroNextFollowWrite) { zeroNextFollowWrite = false; return { changes: 0 }; }
          const [translated, key, id, todoId, content, assignee, todoContent] = args;
          const follow = followUps.get(Number(id)), todo = follow && h.todos.get(follow.todo_id);
          if (!follow || follow.todo_id !== Number(todoId) || follow.content !== content || !todo || todo.assignee !== assignee || todo.content !== todoContent) return { changes: 0 };
          follow.content_zh = translated; follow.content_zh_key = key;
          return { changes: 1 };
        }
        if (sql === 'INSERT INTO todo_follow_ups (todo_id, content, images, created_by) VALUES (?, ?, ?, ?)') {
          const [todo_id, content, images, created_by] = args;
          const follow = { id: ++nextFollowId, todo_id: Number(todo_id), content, images, created_by,
            content_zh: '', content_zh_key: '', created_at: '2026-10-25 04:00:00' };
          followUps.set(follow.id, follow); h.writes.push({ sql, args: copy(args) });
          return { changes: 1, lastInsertRowid: follow.id };
        }
        if (sql === "UPDATE todos SET seen_at = datetime('now') WHERE id = ?") {
          const todo = h.todos.get(Number(args[0]));
          if (!todo) return { changes: 0 };
          todo.seen_at = '2026-10-25 04:00:00'; h.writes.push({ sql, args: copy(args) }); return { changes: 1 };
        }
        return fallback.run(...args);
      },
    };
  };
  const dependencies = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => copy(h.actor), isStaff: auth => auth?.role === 'admin' || auth?.role === 'employee' },
    '@/lib/db': { getDb: () => h.db, logOperation(...args) { h.logs.push(copy(args)); } },
    '@/lib/req': load('src/lib/req.ts'),
    '@/lib/todo-translation': h.helpers,
    '@/lib/deepseek': { translateText: async (...args) => { followAiCalls.push(copy(args)); return followTranslator(...args); } },
  };
  const translate = load('src/app/api/todos/[id]/follow-ups/[followUpId]/translate/route.ts', dependencies);
  const history = load('src/app/api/todos/[id]/follow-ups/route.ts', dependencies);
  async function call(route, method, todoId, followUpId, body) {
    const request = new Request('http://mock/api/todos/' + todoId + '/follow-ups' + (followUpId === undefined ? '' : '/' + followUpId + '/translate'), {
      method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });
    const response = await route[method](request, { params: Promise.resolve({ id: String(todoId), followUpId: String(followUpId) }) });
    return { response, status: response.status, body: await response.json() };
  }
  return Object.assign(h, {
    followUps, followAiCalls, forTodo,
    setFollowTranslator(value) { followTranslator = value; },
    setBeforeFollowWrite(value) { beforeFollowWrite = value; },
    zeroNextFollowWrite() { zeroNextFollowWrite = true; },
    callFollowTranslate: (todoId, followUpId, body) => call(translate, 'POST', todoId, followUpId, body),
    callHistory: todoId => call(history, 'GET', todoId),
    callAddFollowUp: (todoId, body) => call(history, 'POST', todoId, undefined, body),
  });
}

function testMigration() {
  const source = fs.readFileSync(path.join(root, 'src/lib/db.ts'), 'utf8');
  const start = source.indexOf('// 待办跟进翻译缓存'), end = source.indexOf('// 待办正文翻译缓存', start);
  assert(start > 0 && end > start, 'Only extract the reviewed follow-up migration, never load the database module');
  const excerpt = source.slice(start, end);
  assert(excerpt.includes('followUpTranslationColumns'));
  const compiled = ts.transpileModule(excerpt, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const existing of [[], ['content_zh'], ['content_zh_key'], ['content_zh', 'content_zh_key']]) {
    const columns = new Set(['id', 'todo_id', 'content', 'images', ...existing]), statements = [];
    const database = {
      prepare(sql) {
        assert.equal(sql, 'PRAGMA table_info(todo_follow_ups)');
        return { all: () => [...columns].map(name => ({ name })) };
      },
      exec(sql) {
        const match = sql.match(/^ALTER TABLE todo_follow_ups ADD COLUMN (content_zh|content_zh_key) TEXT NOT NULL DEFAULT ''$/);
        assert(match, 'Only describe added cache columns; never execute application SQL or mutate old records');
        assert(!columns.has(match[1])); columns.add(match[1]); statements.push(sql);
      },
    };
    vm.runInNewContext(compiled, { database });
    assert.equal(statements.length, 2 - existing.length);
    assert(columns.has('content_zh') && columns.has('content_zh_key'));
    const first = statements.length;
    vm.runInNewContext(compiled, { database });
    assert.equal(statements.length, first, 'Repeated migration has no duplicate column description');
  }
  const schema = source.match(/CREATE TABLE IF NOT EXISTS todo_follow_ups \(([\s\S]*?)\n\s*\);/);
  assert(schema); assert.match(schema[1], /content_zh TEXT NOT NULL DEFAULT ''/); assert.match(schema[1], /content_zh_key TEXT NOT NULL DEFAULT ''/);
  console.log('PASS actual follow-up schema and exact migration fragment: new/partial/existing columns and repeated startup, only two added cache columns; mock metadata only, no database driver or SQL execution.');
}

async function run() {
  testMigration();
  const sample = createTodoFollowUpTranslationHarness(), follow = sample.followUps.get(4101), key = sample.helpers.followUpTranslationKey(follow.content);
  assert.equal(key, crypto.createHash('sha256').update(follow.content).digest('hex'));
  assert.notEqual(sample.helpers.followUpTranslationKey(follow.content + 'ใหม่'), key);
  assert.equal(sample.helpers.withValidFollowUpTranslation({ ...follow, content_zh: '已保存', content_zh_key: key }).content_zh, '已保存');
  const invalid = sample.helpers.withValidFollowUpTranslation({ ...follow, content_zh: '旧译文', content_zh_key: 'outdated' });
  assert.equal(invalid.content_zh, ''); assert.equal(invalid.content_zh_key, '');
  assert.equal(follow.content_zh, '', 'Sanitizing does not mutate the source record');

  for (const actor of [null, { name: '客户甲', role: 'client' }, { name: '客户甲', role: 'customer' }, { name: '员工甲', role: 'unknown' }]) {
    const h = createTodoFollowUpTranslationHarness(); h.setActor(actor);
    assert.equal((await h.callFollowTranslate(3101, 4101, { role: 'admin', assignee: '客户甲' })).status, actor ? 403 : 401);
    assert.equal(h.queries.length, 0); assert.equal(h.followAiCalls.length, 0); assert.equal(h.writes.length, 0);
    assert.equal((await h.callHistory(3101)).status, actor ? 403 : 401);
    assert.equal((await h.callTodos()).status, actor ? 403 : 401);
  }
  for (const id of [undefined, null, '', '01', '1e3', '3.1', ' 3101', 0, -1, 1.2, true, false, [], {}, 'bad', '9007199254740992']) {
    for (const [todoId, followId] of [[id, 4101], [3101, id]]) {
      const h = createTodoFollowUpTranslationHarness();
      assert.equal((await h.callFollowTranslate(todoId, followId)).status, 400, 'Invalid path id: ' + JSON.stringify([todoId, followId]));
      assert.equal(h.queries.length, 0); assert.equal(h.followAiCalls.length, 0);
    }
  }
  for (const [todoId, followId] of [[9999, 4101], [3101, 9999], [3101, 4103], [3102, 4101]]) {
    const h = createTodoFollowUpTranslationHarness();
    assert.equal((await h.callFollowTranslate(todoId, followId)).status, 404); assert.equal(h.followAiCalls.length, 0); assert.equal(h.writes.length, 0);
  }
  const empty = createTodoFollowUpTranslationHarness(); assert.equal((await empty.callFollowTranslate(3101, 4104)).status, 400); assert.equal(empty.followAiCalls.length, 0);
  const denied = createTodoFollowUpTranslationHarness(); denied.setActor(staff('员工乙'));
  denied.followUps.get(4101).content_zh = '不可读缓存'; denied.followUps.get(4101).content_zh_key = denied.helpers.followUpTranslationKey(denied.followUps.get(4101).content);
  assert.equal((await denied.callFollowTranslate(3101, 4101, { role: 'admin', todo_id: 3102 })).status, 403);
  assert.equal((await denied.callHistory(3101)).status, 403); assert.equal(denied.followAiCalls.length, 0); assert.equal(denied.writes.length, 0);
  const authorOnly = createTodoFollowUpTranslationHarness(); authorOnly.followUps.get(4103).created_by = '员工甲'; authorOnly.setActor(staff('员工甲'));
  assert.equal((await authorOnly.callFollowTranslate(3102, 4103)).status, 403, 'Authored follow-up does not grant access to another assignee');
  console.log('PASS actual translation/history/list permissions: anonymous/client/unknown roles denied, strict parent/follow IDs and parent relation, empty/missing records, own-assignee scope before cache and forged body identity ignored.');

  const h = createTodoFollowUpTranslationHarness(); h.setActor(staff('员工甲'));
  let result = await h.callFollowTranslate(3101, 4101, { content: '伪造跟进', todo_content: '伪造待办', context: '伪造背景' });
  assert.equal(result.status, 200); assert.equal(result.body.cached, false);
  assert.deepEqual(h.followAiCalls, [[h.followUps.get(4101).content, '中文', '待办工作内容：' + h.todos.get(3101).content]]);
  assert.equal(result.body.id, 4101); assert.equal(result.body.todo_id, 3101); assert.equal(result.body.content, h.followUps.get(4101).content); assert.equal(result.body.content_zh_key, key);
  result = await h.callFollowTranslate(3101, 4101);
  assert.equal(result.status, 200); assert.equal(result.body.cached, true); assert.equal(h.followAiCalls.length, 1);
  let history = (await h.callHistory(3101)).body;
  assert.deepEqual(history.map(row => row.id), [4101, 4102, 4104]);
  assert.equal(history[0].content_zh, result.body.content_zh); assert.deepEqual(history[0].images, ['/api/files/mock.jpg']); assert.deepEqual(history[1].images, []);
  let listed = (await h.callTodos()).body, latest = listed.find(todo => todo.id === 3101);
  assert.equal(latest.latest_follow_id, 4101); assert.equal(latest.latest_follow_content, h.followUps.get(4101).content);
  assert.equal(latest.latest_follow_content_zh, result.body.content_zh); assert.equal(latest.latest_follow_content_zh_key, key);
  assert(!listed.some(todo => todo.id === 3102));
  assert.equal((await h.callFollowTranslate(3103, 4105)).status, 200, 'Completed own todo follow-up allowed');
  h.setActor(admin); assert.equal((await h.callFollowTranslate(3102, 4103)).status, 200, 'Admin can translate any employee follow-up');
  assert.equal((await h.callHistory(3102)).status, 200);
  console.log('PASS Chinese cache and source metadata persist, second call skips AI; actual history returns translated rows/images in original order and latest list exposes exact matching follow ID/cache; backend parent work content supplies context, completed/admin scope intact.');

  const stable = createTodoFollowUpTranslationHarness(); await stable.callFollowTranslate(3101, 4101);
  const savedKey = stable.followUps.get(4101).content_zh_key;
  stable.todos.get(3101).content = '父待办工作内容已调整'; stable.todos.get(3101).status = '已完成'; stable.todos.get(3101).category_id = 2; stable.categories.get(2).name = '分类已经改名';
  result = await stable.callFollowTranslate(3101, 4101);
  assert.equal(result.body.cached, true); assert.equal(stable.followAiCalls.length, 1); assert.equal(result.body.content_zh_key, savedKey);
  assert.equal((await stable.callHistory(3101)).body[0].content_zh_key, savedKey);
  assert.equal((await stable.callTodos()).body.find(todo => todo.id === 3101).latest_follow_content_zh_key, savedKey);
  stable.followUps.get(4101).content = 'อัปเดตติดตามล่าสุด';
  const persistedOldCache = stable.followUps.get(4101).content_zh;
  history = (await stable.callHistory(3101)).body;
  assert.equal(history[0].content_zh, ''); assert.equal(history[0].content_zh_key, '');
  latest = (await stable.callTodos()).body.find(todo => todo.id === 3101);
  assert.equal(latest.latest_follow_content_zh, ''); assert.equal(latest.latest_follow_content_zh_key, '');
  assert.equal(stable.followUps.get(4101).content_zh, persistedOldCache, 'Read handlers do not rewrite stored cache');
  result = await stable.callFollowTranslate(3101, 4101);
  assert.equal(result.status, 200); assert.equal(result.body.cached, false); assert.notEqual(result.body.content_zh_key, savedKey);
  assert.equal(stable.followAiCalls.length, 2); assert.equal(stable.followAiCalls[1][2], '待办工作内容：父待办工作内容已调整');
  stable.followUps.get(4102).created_at = stable.followUps.get(4101).created_at;
  latest = (await stable.callTodos()).body.find(todo => todo.id === 3101);
  assert.equal(latest.latest_follow_id, 4102, 'Same-time latest selection uses descending follow-up ID');
  assert.equal(latest.latest_follow_content_zh, '', 'Old latest translation never moves to a different follow ID');
  console.log('PASS cache key depends only on exact follow-up text: later parent text/status/category edits retain valid cache, changed follow text hides stale history/list Chinese and retranslates with new parent context; latest row switches by date/ID without mixing cache.');

  for (const [name, mutate, code] of [
    ['follow text', test => { test.followUps.get(4101).content += 'ใหม่'; }, 409],
    ['parent content', test => { test.todos.get(3101).content += '新背景'; }, 409],
    ['follow deleted', test => { test.followUps.delete(4101); }, 404],
    ['parent deleted', test => { test.todos.delete(3101); }, 404],
    ['parent relation changed', test => { test.followUps.get(4101).todo_id = 3102; }, 404],
    ['assignee changed', test => { test.todos.get(3101).assignee = '员工乙'; }, 403],
  ]) {
    const test = createTodoFollowUpTranslationHarness(), gate = deferred(), started = deferred(); test.setActor(staff('员工甲'));
    test.setFollowTranslator(() => { started.resolve(); return gate.promise; });
    const pending = test.callFollowTranslate(3101, 4101); await started.promise;
    mutate(test); gate.resolve('旧背景翻译不能返回或保存');
    result = await pending; assert.equal(result.status, code, name); assert.equal(test.writes.length, 0);
    assert(!JSON.stringify(result.body).includes('旧背景翻译不能返回或保存'));
    if (test.followUps.has(4101)) assert.equal(test.followUps.get(4101).content_zh, '');
  }
  for (const mutate of [
    test => { test.followUps.get(4101).content += 'write-race'; },
    test => { test.followUps.get(4101).todo_id = 3102; },
    test => { test.todos.get(3101).content += 'write-race'; },
    test => { test.todos.get(3101).assignee = '员工乙'; },
    test => { test.todos.delete(3101); },
    test => { test.followUps.delete(4101); },
  ]) {
    const test = createTodoFollowUpTranslationHarness(); test.setBeforeFollowWrite(() => mutate(test));
    assert.equal((await test.callFollowTranslate(3101, 4101)).status, 409);
    if (test.followUps.has(4101)) assert.equal(test.followUps.get(4101).content_zh, '');
  }
  const zero = createTodoFollowUpTranslationHarness(); zero.zeroNextFollowWrite();
  assert.equal((await zero.callFollowTranslate(3101, 4101)).status, 409); assert.equal(zero.followUps.get(4101).content_zh, '');
  console.log('PASS AI-in-flight changed follow text/parent background/delete/reparent/reassignment rechecked before response; final conditional update protects both IDs, exact content, current parent and assignee against last-window races/zero writes.');

  const parallel = createTodoFollowUpTranslationHarness(), gate = deferred(), started = deferred();
  parallel.setFollowTranslator(() => { started.resolve(); return gate.promise; });
  const first = parallel.callFollowTranslate(3101, 4101); await started.promise;
  const second = parallel.callFollowTranslate(3101, 4101);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(parallel.followAiCalls.length, 1);
  gate.resolve('同一进程并发译文'); assert.equal((await first).status, 200); assert.equal((await second).status, 200); assert.equal(parallel.followAiCalls.length, 1);
  assert.equal((await parallel.callFollowTranslate(3101, 4101)).body.cached, true);
  for (const changeParent of [false, true]) {
    const test = createTodoFollowUpTranslationHarness(), old = deferred(), entered = deferred();
    const firstFollow = test.followUps.get(4101).content, firstParent = test.todos.get(3101).content;
    test.setFollowTranslator((text, target, context) => {
      if (text === firstFollow && context === '待办工作内容：' + firstParent) { entered.resolve(); return old.promise; }
      return '新版本正确译文';
    });
    const older = test.callFollowTranslate(3101, 4101); await entered.promise;
    if (changeParent) test.todos.get(3101).content += '新背景'; else test.followUps.get(4101).content += 'ใหม่';
    result = await test.callFollowTranslate(3101, 4101); assert.equal(result.status, 200); assert.equal(result.body.content_zh, '新版本正确译文'); assert.equal(test.followAiCalls.length, 2);
    old.resolve('旧版本译文'); assert.equal((await older).status, 409); assert.equal(test.followUps.get(4101).content_zh, '新版本正确译文');
  }
  const distinct = createTodoFollowUpTranslationHarness(); distinct.followUps.get(4102).content = distinct.followUps.get(4101).content;
  await Promise.all([distinct.callFollowTranslate(3101, 4101), distinct.callFollowTranslate(3101, 4102)]);
  assert.equal(distinct.followAiCalls.length, 2, 'Separate follow-up IDs are independent even when text matches');
  for (const mode of ['throw', 'empty']) {
    const test = createTodoFollowUpTranslationHarness(); test.setFollowTranslator(async () => { if (mode === 'throw') throw Error('模拟 AI 不可用'); return '  '; });
    result = await test.callFollowTranslate(3101, 4101); assert.equal(result.status, 502);
    assert.equal(test.followUps.get(4101).content_zh, ''); assert.equal(test.writes.length, 0);
    test.setFollowTranslator(async () => '重试成功'); result = await test.callFollowTranslate(3101, 4101);
    assert.equal(result.status, 200); assert.equal(result.body.content_zh, '重试成功'); assert.equal(test.followAiCalls.length, 2);
  }
  console.log('PASS same-input single-process requests share AI once; changed follow or in-flight parent context uses separate task, stale result cannot overwrite new; different follow IDs independent; AI failures/empty results never cached and retry succeeds.');

  const append = createTodoFollowUpTranslationHarness(); append.setActor(staff('员工甲')); await append.callFollowTranslate(3101, 4101);
  const oldCache = append.followUps.get(4101).content_zh;
  result = await append.callAddFollowUp(3101, { content: '  เพิ่มบันทึกติดตามใหม่  ', images: ['/api/files/new.jpg', '', 1], created_by: '伪造人' });
  assert.equal(result.status, 201); assert.equal(result.body.created_by, '员工甲'); assert.equal(result.body.content, 'เพิ่มบันทึกติดตามใหม่');
  assert.equal(result.body.images, '["/api/files/new.jpg"]'); assert.equal(result.body.content_zh, ''); assert.equal(append.followUps.get(4101).content_zh, oldCache);
  assert(append.todos.get(3101).seen_at); assert(append.logs.some(log => log[1] === '添加待办跟进'));
  history = (await append.callHistory(3101)).body; assert.equal(history[0].id, result.body.id); assert(history.some(row => row.id === 4101 && row.content_zh === oldCache));
  latest = (await append.callTodos()).body.find(todo => todo.id === 3101); assert.equal(latest.latest_follow_id, result.body.id); assert.equal(latest.latest_follow_content_zh, '');
  assert.equal((await append.callAddFollowUp(3101, { content: '' })).status, 400);
  append.setActor(staff('员工乙')); assert.equal((await append.callAddFollowUp(3101, { content: '无权追加' })).status, 403);
  console.log('PASS original append flow retains trimmed text/images, backend author, seen marker/audit and old history translation; new follow starts uncached, becomes exact latest, empty/foreign append still rejected.');
  console.log('PASS all real translation/history/list/append handlers and migration/helper sources through strict simulated objects; no SQLite/SQL execution, .env/secrets, network, real AI/notifications, data modification, Git, server or deployment.');
}

module.exports = { createTodoFollowUpTranslationHarness, admin, staff, deferred, load };
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
