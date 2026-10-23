#!/usr/bin/env node
// Actual route handlers with memory-only query/auth objects. Never load a real driver, env or service.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const { createRetellFeedbackHarness, types } = require('./test-announcement-retell-feedback.cjs');
const root = path.resolve(__dirname, '..'), copy = x => JSON.parse(JSON.stringify(x));
function load(file, deps = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
    exports, URL, Response, Date, Map, require(name) { if (Object.hasOwn(deps, name)) return deps[name]; throw Error('Forbidden dependency: ' + name); },
  }); return exports;
}
function createLeaveHarness() {
  const h = createRetellFeedbackHarness(), db = h.db, prepare = db.prepare.bind(db), transaction = db.transaction.bind(db);
  const leaves = new Map(), attendance = new Map([[1, { id: 1, employee_name: '员工甲', date: '2026-11-01', type: '正常' }]]);
  for (const [id, employee_name, status] of [[101, '员工甲', '待审批'], [102, '员工甲', '待审批'], [103, '员工乙', '已驳回'], [104, '员工甲', '已驳回'], [105, '员工甲', '已通过']]) {
    leaves.set(id, { id, employee_name, status, leave_type: '事假', start_date: '2026-11-01', end_date: id === 101 ? '2026-11-03' : '2026-11-01', start_time: '09:00', end_time: '17:00', reason: `申请原因 ${id}`, destination: '曼谷', images: '[]', rejection_reason: id === 103 ? '其他员工的私密驳回原因' : '', approved_by: '', approved_at: null, created_at: '2026-10-23 00:00:00' });
  }
  let locks = 0, zero = false, failAttendance = 0, attendanceAttempts = 0;
  h.leaves = leaves; h.attendance = attendance; h.submissions = [];
  h.zeroNextLeave = () => { zero = true; }; h.failAttendanceAt = nth => { failAttendance = attendanceAttempts + nth; };
  h.leaveState = () => JSON.stringify({ leaves: [...leaves], attendance: [...attendance], notices: h.notifications, logs: h.logs });
  db.transaction = fn => {
    const shared = transaction(() => { const before = { leaves: copy([...leaves]), attendance: copy([...attendance]) }; locks++;
      try { return fn(); } catch (e) { leaves.clear(); for (const [k, v] of before.leaves) leaves.set(k, v); attendance.clear(); for (const [k, v] of before.attendance) attendance.set(k, v); throw e; } finally { locks--; }
    }); const run = () => shared(); run.immediate = () => shared.immediate(); return run;
  };
  const select = (sql, row) => row && Object.fromEntries(sql.match(/^SELECT (.*?) FROM/)[1].split(',').map(s => s.trim()).map(key => [key, row[key]]));
  db.prepare = raw => { const sql = raw.replace(/\s+/g, ' ').trim(), fallback = prepare(raw); return {
    get(...a) {
      if (sql === 'SELECT * FROM leave_requests WHERE id = ?') return copy(leaves.get(Number(a[0])) || null) || undefined;
      if (sql.startsWith('SELECT id,employee_name,leave_type')) {
        const row = leaves.get(Number(a[0])); if (!row || (sql.includes('AND employee_name=?') && row.employee_name !== a[1])) return undefined;
        return select(sql, row);
      }
      if (sql === 'SELECT images, employee_name FROM leave_requests WHERE id = ?') { const row = leaves.get(Number(a[0])); return row ? { images: row.images, employee_name: row.employee_name } : undefined; }
      if (sql === 'SELECT id FROM attendance WHERE employee_name = ? AND date = ?') return [...attendance.values()].find(r => r.employee_name === a[0] && r.date === a[1]);
      return fallback.get(...a);
    },
    all(...a) {
      if (sql.startsWith('SELECT * FROM leave_requests WHERE 1=1')) { let rows = [...leaves.values()], i = 0; if (sql.includes('employee_name = ?')) { const name = a[i++]; rows = rows.filter(r => r.employee_name === name); } if (sql.includes('status = ?')) { const status = a[i++]; rows = rows.filter(r => r.status === status); } if (sql.includes('start_date LIKE ?')) rows = rows.filter(r => r.start_date.startsWith(a[i].slice(0, -1))); return copy(rows.reverse()); }
      if (sql.startsWith('SELECT leave_id, review_status')) return [];
      if (sql.startsWith('SELECT id, employee_name, leave_type, start_date')) return []; // fixed current fixtures have not reached the existing overdue condition
      if (sql === "SELECT name FROM employees WHERE role = 'admin'") return [{ name: '审批老板' }];
      return fallback.all(...a);
    },
    run(...a) {
      if (sql.startsWith('UPDATE leave_requests SET status = ?')) {
        assert(locks > 0); assert(sql.endsWith('WHERE id = ? AND status = ?')); h.writes.push({ sql, args: a });
        const row = leaves.get(Number(a.at(-2))); if (zero) { zero = false; return { changes: 0 }; } if (!row || row.status !== a.at(-1)) return { changes: 0 };
        Object.assign(row, { status: a[0], rejection_reason: a[1] }); let i = 2;
        if (sql.includes('images = ?')) row.images = a[i++];
        if (sql.includes('approved_by = ?')) Object.assign(row, { approved_by: a[i], approved_at: '2026-10-23 08:00:00' });
        return { changes: 1 };
      }
      if (sql === 'UPDATE leave_requests SET images = ? WHERE id = ?') { h.writes.push({ sql, args: a }); leaves.get(Number(a[1])).images = a[0]; return { changes: 1 }; }
      if (sql.startsWith('UPDATE attendance') || sql.startsWith('INSERT INTO attendance')) {
        assert(locks > 0); attendanceAttempts++; if (failAttendance === attendanceAttempts) { failAttendance = 0; throw Error('Simulated attendance failure'); }
        h.writes.push({ sql, args: a });
        if (sql.startsWith('UPDATE')) attendance.get(Number(a[0])).type = '请假';
        else { const id = Math.max(0, ...attendance.keys()) + 1; attendance.set(id, { id, employee_name: a[0], date: a[1], type: '请假' }); }
        return { changes: 1 };
      }
      if (sql.startsWith('INSERT INTO leave_requests')) { assert(locks > 0); const id = Math.max(...leaves.keys()) + 1; const keys = ['employee_name', 'leave_type', 'start_date', 'end_date', 'start_time', 'end_time', 'destination', 'reason', 'images']; leaves.set(id, { id, status: '待审批', rejection_reason: '', ...Object.fromEntries(keys.map((k, i) => [k, a[i]])) }); return { changes: 1, lastInsertRowid: id }; }
      return fallback.run(...a);
    },
  }; };
  const deps = {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } }, '@/lib/auth': { verifyAuth: async () => h.actor, isStaff: a => ['admin', 'employee'].includes(a.role) },
    '@/lib/db': { getDb: () => { h.leaveReads = (h.leaveReads || 0) + 1; return db; }, logOperation: (...args) => h.logs.push({ args }) },
    '@/lib/req': load('src/lib/req.ts'), '@/lib/enums': load('src/lib/enums.ts'), '@/lib/notification-types': types,
    '@/lib/boss-submissions': { publishBossSubmission(...a) { assert(locks > 0); h.submissions.push(a.slice(1)); } },
    '@/lib/annual-leave': { annualLeaveTotal() { throw Error('Unrelated annual calculation forbidden'); }, annualLeaveBalance() { throw Error('Unrelated annual calculation forbidden'); } },
    '@/lib/leave-rules': { computeLeaveRules() { return new Map(); } }, '@/lib/time': { bangkokToday: () => '2026-10-23' },
  };
  const routes = { list: load('src/app/api/leave/route.ts', deps), detail: load('src/app/api/leave/[id]/route.ts', deps) };
  h.callLeave = async (key = 'list', method = 'GET', body, id = 101, query = '') => {
    const res = await routes[key][method](new Request('http://mock/api/leave' + (key === 'detail' ? '/' + id : '') + query, { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }), { params: Promise.resolve({ id: String(id) }) });
    return { status: res.status, body: await res.json(), response: res };
  };
  h.setActor({ id: 1, name: '审批老板', role: 'admin' }); return h;
}
async function run() {
  for (const actor of [null, { id: 2, name: '员工甲', role: 'employee' }, { id: 3, name: '客户', role: 'client' }]) {
    const h = createLeaveHarness(); h.setActor(actor); const before = h.leaveState();
    assert.equal((await h.callLeave('list', 'PATCH', { id: 101, status: '已通过', role: 'admin', approved_by: '伪造老板' })).status, actor ? 403 : 401); assert.equal(h.leaveState(), before); assert.equal(h.writes.length, 0);
  }
  for (const body of [{}, { id: 101 }, { id: 101, status: '坏状态' }, ...[undefined, '', ' ', {}, 123].map(rejection_reason => ({ id: 101, status: '已驳回', rejection_reason }))]) {
    const h = createLeaveHarness(), before = h.leaveState(); assert.equal((await h.callLeave('list', 'PATCH', body)).status, 400); assert.equal(h.leaveState(), before); assert.equal(h.writes.length, 0);
  }
  const missing = createLeaveHarness(); assert.equal((await missing.callLeave('list', 'PATCH', { id: 999, status: '已通过' })).status, 404);
  const zero = createLeaveHarness(), zeroBefore = zero.leaveState(); zero.zeroNextLeave(); assert.equal((await zero.callLeave('list', 'PATCH', { id: 101, status: '已通过' })).status, 409); assert.equal(zero.leaveState(), zeroBefore);
  console.log('PASS admin-only approval and real operator, required true rejection text, invalid/missing request and conditional no-change; no reminder or partial state.');
  for (const status of ['已通过', '已驳回']) {
    const h = createLeaveHarness(); const body = { id: 101, status, rejection_reason: '  人员安排冲突，请调整日期  ', approved_by: '伪造老板', employee_name: '员工乙', recipient: '客户' };
    const r = await h.callLeave('list', 'PATCH', body); assert.equal(r.status, 200); assert.equal(r.body.approved_by, '审批老板'); assert.equal(r.body.rejection_reason, status === '已驳回' ? body.rejection_reason.trim() : '');
    assert.equal(h.notifications.length, 1); const n = h.notifications[0]; assert.equal(n.type, ''); assert.equal(n.related_type, 'leave_review'); assert.equal(n.related_id, '101'); assert.equal(n.recipient, '员工甲'); assert(n.body.includes('审批老板') && n.body.includes('2026-11-01') && n.body.includes('2026-11-03')); if (status === '已驳回') assert(n.body.includes(r.body.rejection_reason));
    assert.equal(types.leaveReviewNoticeHref(n), '/internal/leave?leave=101'); assert.equal(h.logs[0].args[0], '审批老板');
    assert.equal(h.attendance.size, status === '已通过' ? 3 : 1); if (status === '已通过') assert([...h.attendance.values()].every(a => a.type === '请假'));
    const before = h.leaveState(), writes = h.writes.length; await h.callLeave('list', 'PATCH', body); assert.equal(h.leaveState(), before); assert.equal(h.writes.length, writes);
    const stamp = h.leaves.get(101).approved_at; await h.callLeave('list', 'PATCH', { ...body, images: ['replacement.jpg'] }); assert.equal(h.leaves.get(101).images, '["replacement.jpg"]'); assert.equal(h.leaves.get(101).approved_at, stamp); assert.equal(h.notifications.length, 1);
    h.setActor({ name: '员工甲', role: 'employee' }); assert.equal((await h.call('count')).body.count, 1); assert.equal((await h.call('center')).body.length, 1);
    const detail = await h.callLeave('detail'); assert.equal(detail.body.rejection_reason, r.body.rejection_reason); assert.equal(detail.response.headers.get('cache-control'), 'private, no-store');
    await h.call('center', 'PATCH', { id: n.id }); assert.equal((await h.call('count')).body.count, 0);
    h.setActor({ name: '员工乙', role: 'employee' }); assert.equal((await h.callLeave('detail')).status, 404); assert.equal((await h.call('center')).body.length, 0);
  }
  const parallel = createLeaveHarness(); await Promise.all([parallel.callLeave('list', 'PATCH', { id: 101, status: '已通过' }), parallel.callLeave('list', 'PATCH', { id: 101, status: '已通过' })]); assert.equal(parallel.notifications.length, 1); assert.equal(parallel.logs.length, 1);
  for (const fail of ['attendance', 'notification']) {
    const h = createLeaveHarness(), before = h.leaveState(); if (fail === 'attendance') h.failAttendanceAt(2); else h.failNextNotification();
    await assert.rejects(h.callLeave('list', 'PATCH', { id: 101, status: '已通过' }), /Simulated .* failure/); assert.equal(h.leaveState(), before);
    assert.equal((await h.callLeave('list', 'PATCH', { id: 101, status: '已通过' })).status, 200); assert.equal(h.notifications.length, 1);
  }
  const rejectionFail = createLeaveHarness(), beforeReject = rejectionFail.leaveState(); rejectionFail.failNextNotification(); await assert.rejects(rejectionFail.callLeave('list', 'PATCH', { id: 101, status: '已驳回', rejection_reason: '真实原因' })); assert.equal(rejectionFail.leaveState(), beforeReject);
  const cycle = createLeaveHarness(); await cycle.callLeave('list', 'PATCH', { id: 101, status: '已驳回', rejection_reason: '第一次' }); await cycle.callLeave('list', 'PATCH', { id: 101, status: '待审批' }); assert.equal(cycle.notifications.length, 1); await cycle.callLeave('list', 'PATCH', { id: 101, status: '已驳回', rejection_reason: '第二次' }); assert.equal(cycle.notifications.length, 2); assert.equal(cycle.leaves.get(101).rejection_reason, '第二次');
  console.log('PASS both results only to applicant, exact stored reason and operator, original multi-day attendance update/insert, duplicate/parallel once, failure rollback including attendance and audit, legal next cycle alerts again.');
  const old = createLeaveHarness(); old.setActor({ name: '员工甲', role: 'employee' }); for (const id of [104, 105]) assert.equal((await old.callLeave('detail', 'GET', undefined, id)).status, 200);
  for (const id of ['0', '01', '1e2', 'bad', '9007199254740992']) assert.equal((await old.callLeave('detail', 'GET', undefined, id)).status, 400);
  assert.equal((await old.callLeave('list', 'GET', undefined, 101, '?employee=员工乙')).body.some(r => r.employee_name !== '员工甲'), false);
  assert.equal((await old.callLeave('list', 'PATCH', { id: 101, append_images: ['own.jpg'] })).status, 200); assert.equal(old.notifications.length, 0);
  assert.equal((await old.callLeave('list', 'PATCH', { id: 103, append_images: ['foreign.jpg'] })).status, 403);
  const created = await old.callLeave('list', 'POST', { leave_type: '事假', start_date: '2026-11-10', end_date: '2026-11-10', reason: '新申请' }); assert.equal(created.status, 201); assert.equal(old.submissions.length, 1); assert.equal(old.notifications.length, 0);
  for (const id of [null, undefined, '', '01', 'bad']) assert.equal(types.leaveReviewNoticeHref({ type: '', related_type: 'leave_review', title: '请假审批驳回', related_id: id }), '/internal/leave?leave=invalid');
  assert.equal(types.leaveReviewNoticeHref({ type: '', related_type: 'leave', title: '请假审批超时', related_id: '101' }), undefined);
  console.log('PASS own historical readonly detail, invalid/foreign IDs, original filtered list, append-only attachment permissions and original leave submit/boss-publish call; no false approval notice.');
  console.log('PASS actual handlers with memory-only auth/queries; no SQLite, real SQL, env, production requests or real notifications.');
}
module.exports = { createLeaveHarness, types };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
