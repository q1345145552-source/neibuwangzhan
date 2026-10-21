/**
 * 奖惩页「刷新积分」只重算能算回来的自动积分（2026-10-22 老板选 A）。
 * 原来一刷新就把当月所有自动记的分删掉再重算，评价链接、客户每步评价、客户认领 / 跟进 / 成交、互评点赞、
 * 积分提现扣分这些当时实时记的分都算不回来，直接丢了（提现扣分丢了等于积分又回来了）。
 * 这里在临时合成库里各记一条，刷新两次后核对：实时记的原样还在；能重算的旧记录被换成新算的、不重复。
 * Run (from this repo): node --import <tsx loader> scripts/test-points-refresh.mts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';

const dir = fs.mkdtempSync('/tmp/xt-points-refresh-');
Object.assign(process.env, { NODE_ENV: 'test', DB_PATH: path.join(dir, 'internal.db'), JWT_SECRET: 'points-refresh-regression-jwt' });
const [pointsRoute, { getDb, setSystemSetting }, { signToken }, { bangkokMonthKey, bangkokMonthBounds, utcNowStr }] = await Promise.all([
  import('../src/app/api/internal/points/route'), import('../src/lib/db'), import('../src/lib/auth'), import('../src/lib/time'),
]);
process.chdir(dir);
const db = getDb();
db.prepare('UPDATE employees SET must_change_password=0').run();
type Emp = { id: number; name: string; role: string; auth_version: number };
const empOf = (sql: string) => db.prepare(`SELECT id, name, role, auth_version FROM employees WHERE ${sql} ORDER BY id LIMIT 1`).get() as Emp;
const admin = empOf("role='admin' AND status='在职'"), emp = empOf("role='employee' AND status='在职'");
assert.ok(admin && emp, 'test fixture needs one admin and one employee');
const refresh = async (month: string) => {
  const token = await signToken({ id: admin.id, name: admin.name, role: 'admin', auth_version: admin.auth_version, must_change_password: 0 });
  const res = await pointsRoute.GET(new NextRequest(`http://127.0.0.1/api/internal/points?month=${month}&refresh=1`, { headers: { authorization: `Bearer ${token}` } }));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.ok(!body.refreshError, `refresh failed: ${body.refreshError}`);
};

const results: { name: string; result: 'PASS' | 'FAIL'; error?: string }[] = [];
async function test(name: string, fn: () => Promise<void>) { try { await fn(); results.push({ name, result: 'PASS' }); } catch (error) { results.push({ name, result: 'FAIL', error: String(error) }); } }

const month = bangkokMonthKey();
const now = utcNowStr();
const insert = db.prepare('INSERT INTO points_records (employee_name, points, reason, rule_key, is_manual, created_at) VALUES (?, ?, ?, ?, ?, ?)');
// 实时记的分（刷新算不回来）
const kept: [string, number][] = [
  ['client_feedback', 3], ['client_step_rating', 3], ['customer_claim', 2], ['customer_followup', 1], ['customer_activate', 5],
  ['customer_upgrade', 5], ['customer_deal', 10], ['peer_vote', 2], ['withdrawal', -50],
];
for (const [rule, pts] of kept) insert.run(emp.name, pts, `合成：${rule}`, rule, 0, now);
insert.run(emp.name, 7, '合成：管理员手动加分', 'manual', 1, now);
// 能重算的旧记录：员工本月没有任何考勤，所以不该还有「迟到」，刷新后会被换成新算的缺勤
insert.run(emp.name, -9, '合成：旧的迟到记录', 'late', 0, now);

const snapshot = (rules: string[]) => db.prepare(`SELECT rule_key, points, reason FROM points_records WHERE employee_name=? AND rule_key IN (${rules.map(() => '?').join(',')}) ORDER BY rule_key, id`).all(emp.name, ...rules);
const keptRules = [...kept.map(([r]) => r), 'manual'];
const before = snapshot(keptRules);

await test('refresh keeps the points it cannot recompute (评价链接、每步评价、销售、互评、提现扣分、手动)', async () => {
  await refresh(month);
  await refresh(month);
  assert.deepEqual(snapshot(keptRules), before);
  const withdrawal = db.prepare("SELECT COUNT(*) c FROM points_records WHERE employee_name=? AND rule_key='withdrawal'").get(emp.name) as { c: number };
  assert.equal(withdrawal.c, 1, 'the withdrawal deduction must survive, otherwise withdrawn points come back');
});

await test('refresh still replaces the rebuildable rules and does not duplicate them', async () => {
  assert.equal((db.prepare("SELECT COUNT(*) c FROM points_records WHERE employee_name=? AND rule_key='late'").get(emp.name) as { c: number }).c, 0, 'stale late record is recomputed away');
  const absent = db.prepare("SELECT COUNT(*) c FROM points_records WHERE employee_name=? AND rule_key='absent'").get(emp.name) as { c: number };
  assert.equal(absent.c, 1, 'absent is recomputed once per refresh, not stacked');
});

await test('agency switched off: refresh keeps the earlier A-grade evaluation points instead of deleting them', async () => {
  setSystemSetting('agency_enabled', '0');
  insert.run(emp.name, 5, '合成：A级达人评估', 'influencer_a_grade', 0, now);
  await refresh(month);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM points_records WHERE employee_name=? AND rule_key='influencer_a_grade'").get(emp.name) as { c: number }).c, 1);
});

await test('refreshing an earlier month keeps that month\'s step-overdue record (it can only be computed from today\'s steps)', async () => {
  const [y, m] = month.split('-').map(Number);
  const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  const [py, pm] = prev.split('-').map(Number);
  const inPrev = bangkokMonthBounds(py, pm).from.replace(/ 00:00:00$/, ' 12:00:00');
  insert.run(emp.name, -99, '合成：上月步骤逾期', 'step_overdue', 0, inPrev);
  insert.run(emp.name, -6, '合成：上月旧迟到', 'late', 0, inPrev);
  await refresh(prev);
  const rows = db.prepare("SELECT rule_key, points FROM points_records WHERE employee_name=? AND created_at >= ? AND created_at <= ? AND rule_key IN ('step_overdue','late')").all(emp.name, bangkokMonthBounds(py, pm).from, bangkokMonthBounds(py, pm).to) as { rule_key: string; points: number }[];
  assert.deepEqual(rows, [{ rule_key: 'step_overdue', points: -99 }], 'step_overdue kept, stale late of that month still recomputed away');
});

for (const result of results) console.log(JSON.stringify(result));
const failed = results.filter(r => r.result === 'FAIL').length;
console.log(`SUMMARY ${results.length - failed}/${results.length} passed`);
if (failed) process.exitCode = 1;
else fs.rmSync(dir, { recursive: true, force: true });
process.exit();
