#!/usr/bin/env node
// Real handlers with memory-only auth/queries. No SQLite, services or env files.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const { createRetellFeedbackHarness, types } = require('./test-announcement-retell-feedback.cjs');
const root = path.resolve(__dirname, '..'), copy = x => JSON.parse(JSON.stringify(x));
function load(file, deps) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, Response, Date, Map, Set, console, require(name) { if (Object.hasOwn(deps, name)) return deps[name]; throw Error('Forbidden dependency ' + name); } });
  return exports;
}
function createIdeaFeedbackHarness() {
  const h = createRetellFeedbackHarness(), db = h.db, prepare = db.prepare.bind(db), transaction = db.transaction.bind(db), ideas = new Map();
  for (const [id, title, source, is_boss, status] of [
    [1701, '简化对账流程', '员工甲', 0, '待评估'], [1702, '同事的库存建议', '员工乙', 0, '待评估'],
    [1703, '老板保密想法', '老板甲', 1, '待评估'], [1704, '零奖金建议', '员工甲', 0, '待评估'],
    [1705, '暂不采纳的建议', '员工甲', 0, '待评估'], [1706, '历史想法', '员工甲', 0, '已拒绝'],
    [1707, '已开始的旧建议', '员工甲', 0, '进行中'],
  ]) ideas.set(id, { id, title, source, is_boss, status, category: '业务改进', content: Array.from({ length: 35 }, (_, i) => `想法完整正文 ${id} 第${i + 1}行`).join('\n'), bonus_amount: id === 1707 ? 12.3456 : 0, currency: id === 1707 ? 'CNY' : 'THB', rejection_reason: '', related_feature: '', implementation_bonus_amount: null, implementation_bonus_currency: null, created_at: '2024-02-10 01:00:00', updated_at: '2024-02-10 01:00:00' });
  let locks = 0, zero = false, tick = 0;
  h.ideas = ideas; h.ideaReads = 0; h.zeroNextIdea = () => { zero = true; };
  h.ideaState = () => JSON.stringify({ ideas: [...ideas], notifications: h.notifications, logs: h.logs });
  db.transaction = fn => {
    const shared = transaction(() => {
      const before = copy([...ideas]); locks++;
      try { return fn(); } catch (e) { ideas.clear(); for (const [k, v] of before) ideas.set(k, v); throw e; } finally { locks--; }
    });
    const run = () => shared(); run.immediate = () => shared.immediate(); return run;
  };
  const sorted = () => [...ideas.values()].sort((a, b) => b.id - a.id).map(copy);
  db.prepare = raw => {
    const sql = raw.replace(/\s+/g, ' ').trim(), fallback = prepare(raw);
    return {
      get(...a) {
        if (sql === 'SELECT * FROM ideas WHERE id = ?' || sql === 'SELECT * FROM ideas WHERE id = ? AND is_boss = 0') {
          const row = ideas.get(Number(a[0])); return row && (!sql.includes('is_boss = 0') || row.is_boss === 0) ? copy(row) : undefined;
        }
        return fallback.get(...a);
      },
      all(...a) {
        if (sql === 'SELECT * FROM ideas ORDER BY id DESC') return sorted();
        if (sql === 'SELECT * FROM ideas WHERE is_boss = 0 ORDER BY id DESC') return sorted().filter(r => r.is_boss === 0);
        return fallback.all(...a);
      },
      run(...a) {
        if (sql.startsWith('UPDATE ideas SET ')) {
          const row = ideas.get(Number(a.at(-1))); h.writes.push({ sql, args: a });
          if (sql.endsWith("AND status = '待评估'")) {
            assert(locks > 0); assert(sql.includes("status = '已采纳'") || sql.includes("status = '已拒绝'"));
            if (zero) { zero = false; return { changes: 0 }; }
            if (!row || row.status !== '待评估') return { changes: 0 };
          }
          assert(row, 'Updates must target a real idea');
          if (sql.startsWith("UPDATE ideas SET status = '已采纳'")) Object.assign(row, { status: '已采纳', bonus_amount: a[0], currency: a[1] });
          else if (sql.startsWith("UPDATE ideas SET status = '已拒绝'")) Object.assign(row, { status: '已拒绝', rejection_reason: a[0] });
          else if (sql.startsWith("UPDATE ideas SET status = '待评估'")) Object.assign(row, { status: '待评估', rejection_reason: '' });
          else if (sql.startsWith("UPDATE ideas SET status = '进行中'")) row.status = '进行中';
          else if (sql.startsWith("UPDATE ideas SET status = '已实现'")) Object.assign(row, { status: '已实现', related_feature: a[0], implementation_bonus_amount: a[1], implementation_bonus_currency: a[2] });
          else if (sql.startsWith('UPDATE ideas SET implementation_bonus_amount = ?')) Object.assign(row, { implementation_bonus_amount: a[0], implementation_bonus_currency: a[1] });
          else throw Error('Unexpected idea update ' + sql);
          row.updated_at = `2026-10-23 09:00:${String(++tick).padStart(2, '0')}`; return { changes: 1 };
        }
        if (sql.startsWith('INSERT INTO ideas')) {
          const id = Math.max(...ideas.keys()) + 1;
          ideas.set(id, { ...copy(ideas.get(1701)), id, title: a[0], content: a[1], category: a[2], source: a[3], is_boss: a[4], status: '待评估', rejection_reason: '', bonus_amount: 0, currency: 'THB' });
          return { lastInsertRowid: id, changes: 1 };
        }
        return fallback.run(...a);
      },
    };
  };
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/auth': { verifyAuth: async () => h.actor, isStaff: a => ['admin', 'employee'].includes(a.role) },
    '@/lib/db': { getDb() { h.ideaReads++; return db; }, logOperation(...args) { if (['采纳想法', '拒绝想法'].includes(args[1])) assert(locks > 0); h.logs.push({ args }); } },
    '@/lib/req': load('src/lib/req.ts', {}), '@/lib/enums': load('src/lib/enums.ts', {}), '@/lib/notification-types': types,
  };
  const routes = { item: load('src/app/api/ideas/[id]/route.ts', deps), list: load('src/app/api/ideas/route.ts', deps) };
  h.callIdea = async (key = 'item', method = 'GET', body, id = 1701) => {
    const response = await routes[key][method](new Request('http://mock/api/ideas/' + id, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: String(id) }) });
    return { status: response.status, body: await response.json(), response };
  };
  h.setActor({ id: 1, name: '审批老板', role: 'admin' }); return h;
}
async function run() {
  const adopt = { action: 'adopt', bonus_amount: '123.4567', currency: 'CNY' }, reject = { action: 'reject', rejection_reason: '  暂不适合当前业务，请完善成本分析  ' };
  for (const actor of [null, { name: '客户', role: 'client' }, { name: '员工甲', role: 'employee' }]) {
    const h = createIdeaFeedbackHarness(); h.setActor(actor); const before = h.ideaState();
    for (const payload of [adopt, reject]) assert.equal((await h.callIdea('item', 'PATCH', { ...payload, role: 'admin', name: '伪造老板' })).status, actor ? 403 : 401);
    if (!actor || actor.role === 'client') for (const key of ['item', 'list']) assert.equal((await h.callIdea(key)).status, actor ? 403 : 401);
    assert.equal(h.ideaReads, 0); assert.equal(h.ideaState(), before);
  }
  for (const payload of [
    ...[undefined, '', ' ', null, true, {}, -1, 'bad', 'Infinity'].map(bonus_amount => ({ ...adopt, bonus_amount })),
    ...[undefined, '', 'USD'].map(currency => ({ ...adopt, currency })),
    ...[undefined, '', ' ', 1, {}].map(rejection_reason => ({ ...reject, rejection_reason })),
  ]) { const h = createIdeaFeedbackHarness(), before = h.ideaState(); assert.equal((await h.callIdea('item', 'PATCH', payload)).status, 400); assert.equal(h.ideaState(), before); }
  for (const status of ['已采纳', '进行中', '已实现', '已拒绝']) for (const payload of [adopt, reject]) {
    const h = createIdeaFeedbackHarness(); h.ideas.get(1701).status = status; const before = h.ideaState(); assert.equal((await h.callIdea('item', 'PATCH', payload)).status, 400); assert.equal(h.ideaState(), before);
  }
  for (const kind of ['missing', 'blank-source', 'zero']) for (const payload of [adopt, reject]) {
    const h = createIdeaFeedbackHarness(); let id = 1701;
    if (kind === 'missing') id = 999; if (kind === 'blank-source') h.ideas.get(id).source = ' '; if (kind === 'zero') h.zeroNextIdea();
    const before = h.ideaState(); assert.equal((await h.callIdea('item', 'PATCH', payload, id)).status, kind === 'missing' ? 404 : 409); assert.equal(h.ideaState(), before);
  }
  console.log('PASS admin-only decisions, true required reason and original bonus validation; invalid/missing/unchanged/blank-source/conditional-zero guards without partial writes.');
  for (const currency of ['THB', 'CNY']) for (const bonus_amount of [0, 0.00123, 123.4567]) {
    const h = createIdeaFeedbackHarness(), before = copy(h.ideas.get(1701));
    const r = await h.callIdea('item', 'PATCH', { ...adopt, bonus_amount, currency, source: '员工乙', recipient: '客户', name: '假老板', title: '假标题' });
    assert.equal(r.status, 200); assert.equal(r.body.status, '已采纳'); assert.equal(r.body.bonus_amount, bonus_amount); assert.equal(r.body.currency, currency);
    for (const field of ['title', 'content', 'source', 'is_boss', 'implementation_bonus_amount', 'implementation_bonus_currency']) assert.equal(r.body[field], before[field]);
    assert.equal(h.notifications.length, 1); const n = h.notifications[0]; assert.equal(n.recipient, '员工甲'); assert.equal(n.related_id, '1701'); assert.equal(n.related_type, 'idea_review'); assert.equal(n.title, '想法已采纳'); assert.equal(n.type, '');
    assert(n.body.includes('审批老板') && n.body.includes(before.title) && n.body.includes(`${bonus_amount} ${currency}`)); assert(!n.body.includes('已付款')); assert(n.body.includes(bonus_amount > 0 ? '仅为获批奖金' : '本次采纳无奖金'));
    assert.equal(types.ideaReviewNoticeHref(n), '/ideas?idea=1701');
    const saved = h.ideaState(); assert.equal((await h.callIdea('item', 'PATCH', adopt)).status, 400); assert.equal(h.ideaState(), saved);
  }
  for (const payload of [adopt, reject]) {
    const h = createIdeaFeedbackHarness(), results = await Promise.all([h.callIdea('item', 'PATCH', payload), h.callIdea('item', 'PATCH', payload)]);
    assert.deepEqual(results.map(x => x.status), [200, 400]); assert.equal(h.notifications.length, 1);
    const f = createIdeaFeedbackHarness(), before = f.ideaState(); f.failNextNotification();
    await assert.rejects(f.callIdea('item', 'PATCH', payload), /Simulated notification failure/); assert.equal(f.ideaState(), before);
    assert.equal((await f.callIdea('item', 'PATCH', payload)).status, 200); assert.equal(f.notifications.length, 1);
  }
  console.log('PASS persisted exact amount/currency (including zero/fractions/both currencies), real source/reviewer/title, no paid claim, duplicate/parallel once; notification failure rolls back decision with no extra notice/audit, retry succeeds.');
  const h = createIdeaFeedbackHarness(); let r = await h.callIdea('item', 'PATCH', reject); assert.equal(r.body.rejection_reason, reject.rejection_reason.trim());
  assert(h.notifications[0].body.includes(r.body.rejection_reason)); assert.equal(h.notifications[0].recipient, '员工甲');
  assert.equal((await h.callIdea('item', 'PATCH', { action: 'reopen' })).status, 200); assert.equal(h.ideas.get(1701).rejection_reason, ''); assert.equal(h.notifications.length, 1);
  await h.callIdea('item', 'PATCH', { ...reject, rejection_reason: '第二次拒绝' }); assert.equal(h.notifications.length, 2);
  await h.callIdea('item', 'PATCH', { action: 'reopen' }); await h.callIdea('item', 'PATCH', adopt); assert.equal(h.notifications.length, 3);
  await h.callIdea('item', 'PATCH', { action: 'start' }); assert.equal(h.notifications.length, 3);
  await h.callIdea('item', 'PATCH', { action: 'complete', related_feature: '  功能A  ', implementation_bonus_amount: 25.5, implementation_bonus_currency: 'THB' });
  assert.equal(h.ideas.get(1701).related_feature, '功能A'); assert.equal(h.ideas.get(1701).implementation_bonus_amount, 25.5); assert.equal(h.ideas.get(1701).bonus_amount, 123.4567); assert.equal(h.ideas.get(1701).currency, 'CNY');
  await h.callIdea('item', 'PATCH', { action: 'set_implementation_bonus', implementation_bonus_amount: 0, implementation_bonus_currency: 'CNY' }); assert.equal(h.notifications.length, 3); assert.equal(h.ideas.get(1701).implementation_bonus_amount, 0);
  const old = createIdeaFeedbackHarness(); for (const [action, state] of [['reopen', '已拒绝'], ['start', '已采纳'], ['complete', '进行中'], ['set_implementation_bonus', '已实现']]) {
    for (const status of ['待评估', '已采纳', '进行中', '已实现', '已拒绝'].filter(s => s !== state)) { old.ideas.get(1701).status = status; const before = old.ideaState(); assert.equal((await old.callIdea('item', 'PATCH', { action, related_feature: '功能', implementation_bonus_amount: 5, implementation_bonus_currency: 'THB' })).status, 400); assert.equal(old.ideaState(), before); }
  }
  old.ideas.get(1701).status = '进行中'; await old.callIdea('item', 'PATCH', { action: 'complete', related_feature: '后补奖金' }); assert.equal(old.ideas.get(1701).implementation_bonus_amount, null); assert.equal(old.notifications.length, 0);
  console.log('PASS rejection reason persists; reopen clears it, another legitimate reject/adopt alerts again; start/complete/supplement and original transition/bonus behavior unchanged and generate no new reminder.');
  h.setActor({ name: '员工甲', role: 'employee' }); assert.equal((await h.call('center')).body.length, 3); assert.equal((await h.call('count')).body.count, 3);
  await h.call('center', 'PATCH', { id: h.notifications[0].id }); assert.equal((await h.call('count')).body.count, 2); await h.call('center', 'PATCH', { id: h.notifications[1].id, hide: true }); assert.equal((await h.call('count')).body.count, 1);
  h.setActor({ name: '员工乙', role: 'employee' }); assert.equal((await h.call('center')).body.length, 0); await h.call('center', 'PATCH', { id: h.notifications[2].id }); assert.equal(h.notifications[2].is_read, 0);
  const gate = createIdeaFeedbackHarness(); gate.setActor({ name: '员工甲', role: 'employee' });
  assert.equal((await gate.callIdea('item', 'GET', undefined, 1701)).status, 200); r = await gate.callIdea('item', 'GET', undefined, 1702); assert.equal(r.status, 200); assert.equal(r.body.source, '员工乙'); assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
  for (const id of [1703, 999]) assert.equal((await gate.callIdea('item', 'GET', undefined, id)).status, 404);
  for (const id of ['0', '01', 'bad', '1e3', '9007199254740992']) assert.equal((await gate.callIdea('item', 'GET', undefined, id)).status, 400);
  assert((await gate.callIdea('list')).body.every(i => i.is_boss === 0)); assert.equal(gate.writes.length, 0); assert.equal(gate.notifications.length, 0);
  gate.setActor({ name: '审批老板', role: 'admin' }); assert.equal((await gate.callIdea('item', 'GET', undefined, 1703)).status, 200); assert((await gate.callIdea('list')).body.some(i => i.id === 1703));
  const bossDecision = await gate.callIdea('item', 'PATCH', adopt, 1703); assert.equal(bossDecision.status, 200); assert.equal(gate.notifications[0].recipient, '老板甲');
  gate.setActor({ name: '员工甲', role: 'employee' }); r = await gate.callIdea('list', 'POST', { title: '原提交', content: '原正文', source: '伪造老板', is_boss: 1 }); assert.equal(r.status, 201); assert.equal(r.body.source, '员工甲'); assert.equal(r.body.is_boss, 0); assert.equal(gate.notifications.length, 1);
  for (const id of [null, undefined, '', '01', 'bad', '9007199254740992']) assert.equal(types.ideaReviewNoticeHref({ type: '', related_type: 'idea_review', title: '想法已采纳', related_id: id }), '/ideas?idea=invalid');
  assert.equal(types.ideaReviewNoticeHref({ type: '', related_type: 'idea_review', title: '开始实施', related_id: '1701' }), undefined);
  console.log('PASS actual center/count/read/hide and recipient isolation; detail matches original colleague-visible/boss-private list permissions, no view side effects, admin boss-history access, original POST identity and invalid links.');
  console.log('PASS actual handlers with memory-only queries/auth and blocked unknown dependencies; no SQLite/SQL execution, env, real notifications or production requests.');
}
module.exports = { createIdeaFeedbackHarness, types }; if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
