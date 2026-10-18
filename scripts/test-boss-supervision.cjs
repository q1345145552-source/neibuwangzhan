#!/usr/bin/env node
// Fixed-clock regression against the real schema/handlers, using ONLY a new temporary database.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const ts = require('typescript');
const fixture = fs.mkdtempSync('/tmp/xt-boss-supervision-');
Object.assign(process.env, { DB_PATH: path.join(fixture, 'fixture.db'), INTERNAL_APP_ROOT: fixture, NODE_ENV: 'test', ALLOW_EMPTY_DB: '1', JWT_SECRET: 'boss-supervision-fixture-only' });
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText, filename);
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(id, ...args) { return originalResolve.call(this, id.startsWith('@/') ? path.join(root, 'src', id.slice(2)) : id, ...args); };
global.fetch = async () => { throw Error('NETWORK_DISABLED'); };
const db = require('../src/lib/db.ts').getDb();
const { bossSupervisionOverdues: calculate, supervisionClock: clock, supervisionCalendar: calendar, supervisionTimestamp: timestamp } = require('../src/lib/boss-supervision.ts');
const ms = value => Date.parse(value + '+07:00');
const H = 3_600_000;
const utc = value => new Date(ms(value)).toISOString();
db.prepare("UPDATE employees SET status='离职' WHERE role='employee'").run();
const alice = Number(db.prepare("INSERT INTO employees(name,role,hire_date,created_at) VALUES ('监督测试员工','employee','2026-10-19',?)").run(utc('2026-10-19T00:00:00')).lastInsertRowid);
const bob = Number(db.prepare("INSERT INTO employees(name,role,hire_date,created_at) VALUES ('监督第二员工','employee','2026-10-19',?)").run(utc('2026-10-19T00:00:00')).lastInsertRowid);
const admin = db.prepare("SELECT id FROM employees WHERE role='admin' LIMIT 1").get().id;
const person = '监督测试员工';
const result = now => calculate(db, ms(now));
const items = (now, type) => result(now).overdues.filter(r => r.category === type && r.employee_id === alice);
function todo(created, status = '未完成', assignee = person) { return Number(db.prepare('INSERT INTO todos(content,assignee,status,created_at) VALUES (?,?,?,?)').run('测试待办', assignee, status, utc(created)).lastInsertRowid); }
function leave(date, end = date, startTime = '09:00', endTime = '17:00', status = '已通过', name = person, type = '事假') { db.prepare('INSERT INTO leave_requests(employee_name,leave_type,start_date,end_date,start_time,end_time,status) VALUES (?,?,?,?,?,?,?)').run(name,type,date,end,startTime,endTime,status); }
function meeting(date, participants = [person], time = '10:00') { return Number(db.prepare('INSERT INTO meetings(title,meeting_date,meeting_time,participants) VALUES (?,?,?,?)').run('测试会议',date,time,JSON.stringify(participants)).lastInsertRowid); }
function reflection(id, status) { db.prepare('INSERT INTO meeting_reflections(meeting_id,employee_name,content,status) VALUES (?,?,?,?)').run(id,person,'心得',status); }
function notice(created) { const id = Number(db.prepare("INSERT INTO notice_rules(title,body,type,publisher_id,publisher_name,recipient_mode,published_at) VALUES ('测试通知','正文','通知',?,'老板','selected',?)").run(admin, utc(created)).lastInsertRowid); db.prepare('INSERT INTO notice_rule_implementations(notice_id,employee_id,employee_name) VALUES (?,?,?)').run(id,alice,person); return id; }
function report(date, status = '已提交') { db.prepare('INSERT INTO work_reports(employee_name,report_date,status) VALUES (?,?,?)').run(person,date,status); }
let passed = 0;
function test(name, fn) {
  const rollback = Symbol('rollback');
  try { db.transaction(() => { fn(); throw rollback; }).immediate(); }
  catch (error) { if (error !== rollback) throw error; }
  passed++; console.log('PASS ' + name);
}
(async () => {
  test('24h threshold is inclusive; completed todos never appear', () => {
    const id = todo('2026-10-19T10:00:00');
    assert.equal(items('2026-10-20T09:59:59','todo').length,0);
    let entry = items('2026-10-20T10:00:00','todo')[0]; assert.equal(entry.source_id,id); assert.equal(entry.overdue_seconds,0);
    entry = items('2026-10-20T11:00:00','todo')[0]; assert.equal(entry.overdue_seconds,3600); assert.equal(entry.deadline_bangkok,'2026-10-20 10:00:00');
    db.prepare("UPDATE todos SET status='已完成' WHERE id=?").run(id); assert.equal(items('2026-10-21T12:00:00','todo').length,0);
  });
  test('Sunday is skipped across Bangkok midnight and does not erase existing overdue', () => {
    todo('2026-10-17T10:00:00');
    assert.equal(items('2026-10-19T09:59:59','todo').length,0); assert.equal(items('2026-10-19T10:00:00','todo')[0].deadline_bangkok,'2026-10-19 10:00:00');
    const before = clock(ms('2026-10-17T00:00:00'),ms('2026-10-18T00:00:00'),[],24*H);
    const after = clock(ms('2026-10-17T00:00:00'),ms('2026-10-19T00:00:00'),[],24*H);
    assert.equal(before.elapsed,after.elapsed); assert.equal(after.deadline,ms('2026-10-18T00:00:00'));
  });
  test('Full-day leave delays deadline 24h; pending counts, rejected does not', () => {
    todo('2026-10-19T12:00:00'); leave('2026-10-20',undefined,undefined,undefined,'待审批');
    assert.equal(items('2026-10-21T11:59:59','todo').length,0);assert.equal(items('2026-10-21T12:00:00','todo')[0].deadline_bangkok,'2026-10-21 12:00:00');
    db.prepare("UPDATE leave_requests SET status='已驳回' WHERE employee_name=?").run(person);
    assert.equal(items('2026-10-20T13:00:00','todo')[0].overdue_seconds,3600);
  });
  test('Sunday + overlapping leave is a union, half-day is exact, two halves make full day', () => {
    todo('2026-10-17T10:00:00'); leave('2026-10-18','2026-10-19');leave('2026-10-19');
    assert.equal(items('2026-10-20T09:59:59','todo').length,0);assert.equal(items('2026-10-20T10:00:00','todo')[0].deadline_bangkok,'2026-10-20 10:00:00');
    const rows = [{employee_name:person,status:'已通过',start_date:'2026-10-19',end_date:'2026-10-19',start_time:'13:00',end_time:'15:00'},{employee_name:person,status:'待审批',start_date:'2026-10-19',end_date:'2026-10-19',start_time:'14:00',end_time:'17:00'}];
    const pauses=calendar(rows).intervals; assert.equal(clock(ms('2026-10-19T12:00:00'),ms('2026-10-20T16:00:00'),pauses,24*H).deadline,ms('2026-10-20T16:00:00'));
    rows[0].start_time='09:00';rows[0].end_time='13:00';rows[1].start_time='13:00';
    assert.equal(calendar(rows).intervals[0].end-calendar(rows).intervals[0].start,24*H);
  });
  test('Daily reports: strictly after 17:00, historical misses persist, backfill clears, returned is unsubmitted', () => {
    assert.equal(items('2026-10-19T17:00:00','report').length,0);
    assert.equal(items('2026-10-19T17:00:01','report')[0].business_date,'2026-10-19');
    assert.deepEqual(items('2026-10-20T18:00:00','report').map(r=>r.business_date).sort(),['2026-10-19','2026-10-20']);
    report('2026-10-19');report('2026-10-20','退回');assert.equal(items('2026-10-20T18:00:00','report').length,1);
    db.prepare("UPDATE work_reports SET status='已提交' WHERE employee_name=?").run(person);assert.equal(items('2026-10-20T18:00:00','report').length,0);
  });
  test('Reports exempt Sundays and any partial leave day; rejected leave does not exempt', () => {
    db.prepare('UPDATE employees SET created_at=?,hire_date=? WHERE id=?').run(utc('2026-10-17T00:00:00'),'2026-10-17',alice);
    report('2026-10-17');assert.equal(items('2026-10-18T18:00:00','report').length,0);
    leave('2026-10-19',undefined,'13:00','14:00','待审批');assert.equal(items('2026-10-19T18:00:00','report').length,0);
    db.prepare("UPDATE leave_requests SET status='已驳回' WHERE employee_name=?").run(person);assert.equal(items('2026-10-19T18:00:00','report').length,1);
  });
  test('Report history starts at later of valid hire date/account creation', () => {
    db.prepare('UPDATE employees SET hire_date=? WHERE id=?').run('2026-10-21',alice);
    assert.equal(items('2026-10-20T18:00:00','report').length,0);assert.equal(items('2026-10-21T18:00:00','report').length,1);
    db.prepare('UPDATE employees SET hire_date=? WHERE id=?').run('2020-01-01',alice);assert.equal(items('2026-10-19T18:00:00','report').length,1);
  });
  test('Meeting reflections: returned counts missing; any submitted entry satisfies; participants deduplicate', () => {
    const id=meeting('2026-10-19',[person,person,'客户','不存在']);reflection(id,'退回');
    assert.equal(items('2026-10-19T17:00:00','meeting').length,0);assert.equal(items('2026-10-19T17:00:01','meeting').length,1);
    reflection(id,'已提交');assert.equal(items('2026-10-20T18:00:00','meeting').length,0);
  });
  test('Meeting Sunday/leave exemptions and future/start-time guards', () => {
    meeting('2026-10-18');meeting('2026-10-19',[person],'19:00');meeting('2026-10-20');
    assert.equal(items('2026-10-19T18:00:00','meeting').length,0);assert.equal(items('2026-10-19T19:01:00','meeting').length,1);
    leave('2026-10-19',undefined,'09:00','10:00');assert.equal(items('2026-10-19T20:00:00','meeting').length,0);
  });
  test('Notice 12h threshold; printing alone or returned submission does not complete; valid submitted clears', () => {
    const id=notice('2026-10-19T06:00:00');assert.equal(items('2026-10-19T17:59:59','notice').length,0);assert.equal(items('2026-10-19T18:00:00','notice')[0].overdue_seconds,0);
    db.prepare('UPDATE notice_rule_implementations SET printed=1 WHERE notice_id=?').run(id);assert.equal(items('2026-10-19T19:00:00','notice').length,1);
    db.prepare("UPDATE notice_rule_implementations SET submitted_at=?,photos=?,review_status='打回' WHERE notice_id=?").run(utc('2026-10-19T12:00:00'),JSON.stringify(['/api/files/photo.png']),id);assert.equal(items('2026-10-19T19:00:00','notice').length,1);
    db.prepare("UPDATE notice_rule_implementations SET review_status='还没处理' WHERE notice_id=?").run(id);assert.equal(items('2026-10-19T19:00:00','notice').length,0);
  });
  test('Notice clock skips Sunday and leave, freezes overdue duration during leave', () => {
    notice('2026-10-17T18:00:00');leave('2026-10-19');assert.equal(items('2026-10-20T05:59:59','notice').length,0);assert.equal(items('2026-10-20T06:00:00','notice')[0].deadline_bangkok,'2026-10-20 06:00:00');
    leave('2026-10-21');const before=items('2026-10-21T00:00:00','notice')[0],after=items('2026-10-21T23:00:00','notice')[0];assert.equal(before.overdue_seconds,after.overdue_seconds);
  });
  test('Mixed UTC formats, invalid/future creation, and inactive/non-employee scope', () => {
    assert.equal(timestamp('2026-10-19 03:00:00'),timestamp('2026-10-19T10:00:00+07:00'));
    const id=todo('2026-10-19T10:00:00');db.prepare('UPDATE todos SET created_at=? WHERE id=?').run('2026-10-19 03:00:00',id);assert.equal(items('2026-10-20T11:00:00','todo')[0].overdue_seconds,3600);
    todo('2026-10-25T10:00:00');todo('2026-10-01T10:00:00','未完成','老板');assert.equal(items('2026-10-20T11:00:00','todo').length,1);
    db.prepare("UPDATE employees SET status='离职' WHERE id=?").run(alice);assert.equal(result('2026-10-20T18:00:00').overdues.some(r=>r.employee_id===alice),false);
  });
  test('All leave types exempt daily submission; cached historical durations match the clock', () => {
    db.prepare('UPDATE employees SET created_at=?,hire_date=? WHERE id=?').run(utc('2026-08-01T00:00:00'),'2026-08-01',alice);
    leave('2026-09-07',undefined,undefined,undefined,'已通过',person,'病假');
    leave('2026-09-08',undefined,undefined,undefined,'待审批',person,'事假');
    leave('2026-09-09',undefined,undefined,undefined,'已通过',person,'年假');
    const rows=items('2026-10-20T18:00:00','report');assert(rows.length>40);
    const pauses=calendar(db.prepare('SELECT * FROM leave_requests WHERE employee_name=?').all(person)).intervals;
    for(const row of rows){assert(!['2026-09-07','2026-09-08','2026-09-09'].includes(row.business_date));assert.equal(row.overdue_seconds,Math.floor(clock(Date.parse(row.deadline_at),ms('2026-10-20T18:00:00'),pauses).elapsed/1000));}
  });
  // Actual route, real JWT account validation, fixed clock, read-only verification.
  const { signToken } = require('../src/lib/auth.ts');
  const { GET } = require('../src/app/api/boss-supervision/overdue/route.ts');
  const { NextRequest } = require('next/server');
  const adminRow=db.prepare('SELECT * FROM employees WHERE id=?').get(admin);
  const clientRow=db.prepare("SELECT * FROM employees WHERE role='client' LIMIT 1").get();
  for (const row of [adminRow,clientRow]) db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(row.id);
  const tokens = {admin:await signToken({...adminRow,must_change_password:0}),employee:await signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(alice)),client:await signToken({...clientRow,must_change_password:0})};
  todo('2026-10-19T10:00:00');meeting('2026-10-19');notice('2026-10-19T06:00:00');
  const originalNow=Date.now;Date.now=()=>ms('2026-10-20T18:00:00');
  try {
    for (const [role,status] of [[null,401],['employee',403],['client',403],['admin',200]]) {
      // JWT uses real current issuance; account auth is validated with the real clock before freeze.
      const request=new NextRequest('http://fixture.test/api/boss-supervision/overdue?now=1900-01-01',{headers:role?{Authorization:'Bearer '+tokens[role]}:{}});
      const before=db.prepare('SELECT total_changes() AS n').get().n;const response=await GET(request);assert.equal(response.status,status);assert.equal(db.prepare('SELECT total_changes() AS n').get().n,before);
      if(status===200){const payload=await response.json();assert.equal(payload.generated_at,'2026-10-20T11:00:00.000Z');assert.equal(response.headers.get('cache-control'),'private, no-store');for(const type of ['todo','report','meeting','notice'])assert(payload.counts[type]>0);assert.equal(payload.total,payload.overdues.length);for(const row of payload.overdues){assert(row.employee_id&&row.employee_name&&row.title&&row.deadline_at);assert(row.overdue_seconds>=0);}}
    }
  } finally { Date.now=originalNow; }
  passed++;console.log('PASS real API: 401/403/200, all four categories, server-owned Bangkok clock, no-store, no mutations');
  assert.equal(db.pragma('quick_check',{simple:true}),'ok');db.close();console.log(`BOSS SUPERVISION: ${passed} passed; isolated fixture ${fixture}`);
})().catch(error=>{console.error(error);db.close();process.exitCode=1;});
