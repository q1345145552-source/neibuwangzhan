#!/usr/bin/env node
// Actual handlers with simulated auth/query objects only. No driver, SQLite, env or network.
const assert = require('node:assert/strict');
const { createRetellFeedbackHarness, feedback, types } = require('./test-announcement-retell-feedback.cjs');

const employee = { id: 2, name: '员工甲', role: 'employee' };
const submission = { retell_th: 'ข้อความภาษาไทยที่พนักงานสรุป', retell_zh: '员工首次提交的中文复述' };
const bossRows = [
  { name: '老板甲', role: 'admin', status: '在职' },
  { name: '老板乙', role: 'admin', status: '试用期' },
  { name: '老板丙', role: 'admin', status: '待离职' },
  { name: '老板甲', role: 'admin', status: '在职' },
  { name: '离职老板', role: 'admin', status: '离职' },
  { name: '', role: 'admin', status: '在职' },
  { name: '员工乙', role: 'employee', status: '在职' },
  { name: '客户', role: 'client', status: '在职' },
];
function createSubmissionHarness(status = '已读待复述') {
  const h = createRetellFeedbackHarness();
  h.bosses.push(...bossRows.map(e => ({ ...e })));
  Object.assign(h.recipients.get(101), { status, retell_th: '', retell_zh: '' });
  h.setActor(employee);
  return h;
}
async function run() {
  for (const actor of [null, { id: 1, role: 'admin', name: '老板甲' }, { id: 7, role: 'client', name: '客户' }]) {
    const h = createSubmissionHarness(); h.setActor(actor);
    const before = h.state();
    const result = await h.call('retell', 'PATCH', { ...submission, name: employee.name, role: 'employee', employee_name: employee.name });
    assert.equal(result.status, actor ? 403 : 401);
    assert.equal(h.dbReads, 0); assert.equal(h.state(), before); assert.equal(h.writes.length, 0);
  }
  for (const body of [{}, { retell_th: ' ' }, { retell_th: 'ไทย', retell_zh: ' ' }]) {
    const h = createSubmissionHarness(), before = h.state();
    assert.equal((await h.call('retell', 'PATCH', body)).status, 400);
    assert.equal(h.state(), before); assert.equal(h.writes.length, 0);
  }
  for (const scenario of ['missing', 'recalled', 'foreign', 'confirmed', 'unknown', 'zero']) {
    const h = createSubmissionHarness();
    if (scenario === 'missing') h.announcements.delete(10);
    if (scenario === 'recalled') h.announcements.get(10).recalled = 1;
    if (scenario === 'foreign') h.recipients.delete(101);
    if (scenario === 'confirmed') h.recipients.get(101).status = '已确认';
    if (scenario === 'unknown') h.recipients.get(101).status = '无效状态';
    if (scenario === 'zero') h.zeroNextUpdate();
    const before = h.state(), r = await h.call('retell', 'PATCH', { ...submission, employee_name: '员工乙', recipient: '客户', recipients: ['员工乙'], related_id: '20:202' });
    assert.equal(r.status, ['missing', 'foreign'].includes(scenario) ? 404 : scenario === 'recalled' ? 400 : 409);
    assert.equal(h.state(), before); assert.equal(h.notifications.length, 0); assert.equal(h.logs.length, 0);
  }
  console.log('PASS auth, required fields, missing/recalled/foreign record, confirmed/unknown state and conditional zero-update; none creates a reminder or partial business state.');

  for (const initial of ['待读', '已读待复述']) {
    const h = createSubmissionHarness(initial);
    const r = await h.call('retell', 'PATCH', { ...submission, name: '伪造者', employee_name: '员工乙', recipient: '客户', related_id: '20:202' });
    assert.equal(r.status, 200); assert.equal(r.body.id, 101); assert.equal(r.body.status, '已复述待确认');
    assert.deepEqual(h.notifications.map(n => n.recipient), ['老板甲', '老板乙', '老板丙']);
    assert.equal(h.logs.length, 1); assert.equal(h.logs[0].args[0], employee.name);
    assert.deepEqual(h.transactionModes, ['immediate']);
    for (const n of h.notifications) {
      assert.equal(n.type, '老板通知'); assert.equal(n.related_type, feedback.ANNOUNCEMENT_RETELL_SUBMITTED);
      assert.equal(n.related_id, '10:101'); assert.equal(n.title, '复述首次提交：安全规范培训');
      assert.equal(n.body, '员工甲首次提交了通知「安全规范培训」的复述，请查看并审核。');
      assert.equal(feedback.announcementFeedbackHref(n), '/announcements?open=10&recipient=101');
    }
    assert.equal(h.recipients.get(102).retell_zh, '员工乙 中文原复述 102');
    const before = h.state(), writes = h.writes.length;
    assert.equal((await h.call('retell', 'PATCH', submission)).status, 200);
    assert.equal(h.state(), before); assert.equal(h.writes.length, writes);
    assert.equal((await h.call('retell', 'PATCH', { ...submission, retell_zh: '未打回却要覆盖' })).status, 409);
    assert.equal(h.state(), before);
  }
  const parallel = createSubmissionHarness();
  const results = await Promise.all([parallel.call('retell', 'PATCH', submission), parallel.call('retell', 'PATCH', submission)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(parallel.notifications.length, 3); assert.equal(parallel.logs.length, 1);
  console.log('PASS first submission from existing allowed states: every active admin exactly once, never publisher-only/client/all; forged names ignored, unchanged retry and parallel duplicate do not write or notify again.');

  const fail = createSubmissionHarness(), original = fail.state();
  fail.failNextNotification(2);
  await assert.rejects(fail.call('retell', 'PATCH', submission), /Simulated notification failure/);
  assert.equal(fail.state(), original); assert.equal(fail.notifications.length, 0); assert.equal(fail.logs.length, 0);
  assert.equal((await fail.call('retell', 'PATCH', submission)).status, 200);
  assert.equal(fail.notifications.length, 3); assert.equal(fail.logs.length, 1);
  const noBoss = createSubmissionHarness(); noBoss.bosses = [];
  assert.equal((await noBoss.call('retell', 'PATCH', submission)).status, 200);
  assert.equal(noBoss.notifications.length, 0); assert.equal(noBoss.recipients.get(101).status, '已复述待确认');
  console.log('PASS second-admin notification failure rolls back retell, prior admin notice and audit; retry succeeds once; no-admin case never falls back to a global/publisher notice.');

  const cycle = createSubmissionHarness();
  await cycle.call('retell', 'PATCH', submission);
  cycle.setActor({ id: 1, role: 'admin', name: '老板甲' });
  assert.equal((await cycle.call('review', 'PATCH', { employee_name: '员工甲', action: 'reject', comment: '请把核查步骤补完整' })).status, 200);
  const rejectNotice = cycle.notifications.at(-1);
  assert.equal(rejectNotice.recipient, '员工甲'); assert.equal(rejectNotice.related_type, feedback.ANNOUNCEMENT_RETELL_REJECTED);
  assert.equal(feedback.announcementFeedbackHref(rejectNotice), '/announcements?open=10&recipient=101');
  cycle.setActor(employee);
  // Repeating the same text after a real rejection is a new submission cycle, not a permanent text dedup.
  assert.equal((await cycle.call('retell', 'PATCH', submission)).status, 200);
  assert.equal(cycle.notifications.length, 7);
  for (const n of cycle.notifications.slice(-3)) {
    assert.equal(n.title, '复述重新提交：安全规范培训'); assert(n.body.includes('员工甲重新提交'));
  }
  const beforeRetry = cycle.state(); await cycle.call('retell', 'PATCH', submission); assert.equal(cycle.state(), beforeRetry);
  cycle.setActor({ id: 1, role: 'admin', name: '老板甲' });
  await cycle.call('review', 'PATCH', { employee_name: '员工甲', action: 'confirm' });
  assert.equal(cycle.notifications.length, 7);
  cycle.setActor(employee);
  assert.equal((await cycle.call('retell', 'PATCH', submission)).status, 409);
  assert.equal(cycle.recipients.get(101).status, '已确认');
  console.log('PASS original employee rejection alert remains; legal resubmit (even identical text) alerts all admins again as resubmission; confirmed state stays confirmed and original confirmation does not send new alerts.');

  for (const [index, name] of ['老板甲', '老板乙', '老板丙'].entries()) {
    cycle.setActor({ id: index + 10, name, role: 'admin' });
    assert.equal((await cycle.call('count')).body.count, 2);
    const center = await cycle.call('center'); assert.equal(center.body.length, 2);
    const target = await cycle.call('detail', 'GET', undefined, 10, '?recipient=101');
    assert.equal(target.status, 200); assert.equal(target.body.target_recipient.employee_name, '员工甲');
    assert.equal(target.body.target_recipient.retell_zh, submission.retell_zh);
    assert.equal(target.body.target_recipient.status, '已确认');
    const noticeId = center.body[0].id;
    await cycle.call('center', 'PATCH', { id: noticeId }); assert.equal((await cycle.call('count')).body.count, 1);
    await cycle.call('center', 'PATCH', { id: noticeId, hide: true });
    assert.equal((await cycle.call('center')).body.length, 1);
  }
  cycle.setActor({ id: 3, name: '员工乙', role: 'employee' });
  assert.equal((await cycle.call('count')).body.count, 0); assert.equal((await cycle.call('center')).body.length, 0);
  assert.equal((await cycle.call('detail', 'GET', undefined, 10, '?recipient=101')).status, 403);
  cycle.setActor({ id: 4, name: '员工丙', role: 'employee' }); // original publisher still has no special retell access
  assert.equal((await cycle.call('center')).body.length, 0);
  assert.equal((await cycle.call('detail', 'GET', undefined, 10, '?recipient=101')).status, 403);
  assert(!JSON.stringify((await cycle.call('list')).body).includes(submission.retell_zh));
  cycle.setActor({ id: 7, name: '客户', role: 'client' });
  assert.equal((await cycle.call('detail', 'GET', undefined, 10, '?recipient=101')).status, 403);
  for (const related_type of [feedback.ANNOUNCEMENT_RETELL_SUBMITTED, feedback.ANNOUNCEMENT_RETELL_REJECTED]) {
    for (const id of [null, '', '10', '01:1', '1:2:3']) assert.equal(feedback.announcementFeedbackHref({ type: '老板通知', related_type, related_id: id }), '/announcements?feedback=invalid');
  }
  assert.equal(feedback.announcementFeedbackHref({ type: '老板通知', related_type: 'announcement', related_id: '10' }), undefined);
  assert.deepEqual([...types.MESSAGE_CENTER_TYPES], ['工单指派', '工单完成', '待办指派', '待办完成', '规则更新', '老板通知']);
  console.log('PASS actual center/unread/read/hide and scoped detail for each admin; exact employee target, old confirmed history and both feedback types; employee/publisher/client cannot read others, original types and publication links unchanged.');
  console.log('PASS actual-handler simulated-only submission verification; no real database, SQL, notifications, secrets or external requests.');
}
module.exports = { createSubmissionHarness, employee, submission, bossRows };
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
