// Actual payroll SQL and export route, in-memory SQLite only. No application database.
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { load } = require('./test-company-archives.cjs');
const { createPayrollRulesHarness } = require('./test-payroll-rules.cjs');
const breakdown = load('src/lib/payslip-breakdown.ts');
async function run() {
 const h = createPayrollRulesHarness();
 try {
  h.addLeave({end_time:'13:00'});
  h.addLeave({start_date:'2026-10-05',end_date:'2026-10-05',leave_type:'病假'});
  h.addLeave({start_date:'2026-10-06',end_date:'2026-10-06',leave_type:'年假',pay_status:'带薪'});
  h.addLeave({start_date:'2026-09-30',end_date:'2026-10-01',leave_type:'其他'});
  h.native.prepare("INSERT INTO attendance(employee_name,date,check_in,type) VALUES (?,?,?,?)").run('Bam','2026-10-07','2026-10-07 01:40:30','正常');
  const result = await h.call('payslips','POST',{month:'2026-10'});
  assert.equal(result.status,200);
  const p = result.body.payslips.find(p=>p.employee_name==='Bam');
  h.native.prepare('UPDATE payslips SET bonus=200,commission=100,overtime=50,merit_income=30,demerit_deduction=20,withholding_tax=10 WHERE id=?').run(p.id);
  Object.assign(p,{bonus:200,commission:100,overtime:50,merit_income:30,demerit_deduction:20,withholding_tax:10});
  const s=JSON.parse(p.summary), c=s.calculation;
  assert.equal(c.daily_rate,320);assert.equal(c.hourly_rate,40);assert.equal(c.late_minutes,40.5);
  assert.equal(s.leave_details[0].start_date,'2026-10-01');assert.equal(s.leave_details[0].end_date,'2026-10-01');
  const data=breakdown.buildPayslipBreakdown(p), lines=data.sections.flatMap(s=>s.lines), text=lines.map(l=>l.label+' '+l.formula).join('\n');
  assert.equal(data.income,9980);assert.equal(data.deduction,450+105+480+320+p.absence_deduction+30);assert.equal(data.net,data.income-data.deduction);
  for(const expected of ['2026-10-02 事假','4 小时（不带薪） × 时薪 40','2026-10-05 病假','2026-10-06 年假','带薪，不扣款','40.5 − 30','应出勤天数','实际出勤天数','请假天数','÷ 30','÷ 8']) assert(text.includes(expected),expected);
  assert(!text.includes('金额差异'));
  assert.equal(breakdown.buildPayslipBreakdown({...p,bonus:'200',commission:'100',overtime:'50',withholding_tax:'10'}).net,data.net);
  assert.equal(lines.find(l=>l.label==='2026-10-02 事假').amount,160);
  assert.equal(lines.find(l=>l.label==='2026-10-05 病假').amount,320);
  assert.equal(lines.find(l=>l.label==='2026-10-06 年假').amount,0);
  // Historical/locked slips retain their original numbers; malformed or null JSON cannot break views.
  for(const summary of ['', 'null','[]','bad','{"attendance_days":7,"late_details":[{"minutes":20}]}']) {
   const old=breakdown.buildPayslipBreakdown({...p,summary,late_deduction:555});
   assert(old.note.includes('历史'));assert.equal(old.deduction,data.deduction-105+555);
   assert(!old.sections.flatMap(s=>s.lines).some(l=>l.formula.includes('30 分钟豁免')));
  }
  const changed=breakdown.buildPayslipBreakdown({...p,absence_deduction:1});
  assert(changed.sections.flatMap(s=>s.lines).some(l=>l.label==='缺勤扣款金额差异'));
  // Row rounding versus aggregate rounding is explicitly reconciled.
  h.native.prepare('UPDATE employees SET skill_allowance=800 WHERE id=2').run();
  h.clear();for(const date of ['02','03','05']) h.addLeave({start_date:'2026-10-'+date,end_date:'2026-10-'+date});
  await h.call('payslips','POST',{month:'2026-10'});
  const fractional=h.native.prepare('SELECT * FROM payslips WHERE employee_id=2').get();
  const fd=breakdown.buildPayslipBreakdown(fractional);
  assert.equal(fractional.personal_leave_deduction,1010);
  assert(fd.sections.flatMap(s=>s.lines).some(l=>l.label.includes('尾差')&&l.amount===-.01));
  // Salary settings may later change: export must use the slip, not current employee wages.
  h.native.prepare('UPDATE employees SET base_salary=99999 WHERE id=2').run();
  let actor={id:1,name:'老板',role:'admin'};
  const route=load('src/app/api/payslips/export/route.ts',{'next/server':{NextResponse:Response},'@/lib/db':{getDb:()=>h.db},'@/lib/auth':{verifyAuth:async()=>actor},xlsx:XLSX,'@/lib/payslip-breakdown':breakdown});
  const response=await route.GET(new Request('http://test/api/payslips/export?month=2026-10'));
  assert.equal(response.status,200);
  const wb=XLSX.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'});
  assert.deepEqual(wb.SheetNames,['Bam','Ing']);
  for(const name of wb.SheetNames) {
   const stored=h.native.prepare('SELECT * FROM payslips WHERE employee_name=?').get(name), expected=breakdown.buildPayslipBreakdown(stored);
   const rows=XLSX.utils.sheet_to_json(wb.Sheets[name],{header:1});
   assert.equal(rows.find(r=>r[0]==='底薪')[1],stored.base_salary);
   assert.equal(rows.find(r=>r[0]==='净收入')[1],expected.net);
   assert.equal(rows.find(r=>r[0]==='实发工资')[2],expected.net);
   assert(rows.some(r=>r[0]==='计算明细'));
   for(const section of expected.sections) for(const line of section.lines) {
    const row=rows.find(r=>r[0]===line.label&&r[2]===line.amount);
    if(line.amount!==undefined)assert(row,`${name}: ${line.label}`);
   }
  }
  for(const role of ['employee','client']){actor={id:2,name:'Bam',role};assert.equal((await route.GET(new Request('http://test/api/payslips/export?month=2026-10'))).status,403);}
  h.setActor({id:2,name:'Bam',role:'employee'});const own=await h.call('payslips','GET',undefined,'?month=all');assert.equal(own.status,200);assert(own.body.every(r=>r.employee_id===2&&JSON.parse(r.summary).calculation.version===1));
  h.setActor({id:9,name:'客户',role:'client'});assert.equal((await h.call('payslips','GET',undefined,'?month=all')).status,403);
  console.log('PASS actual generation snapshots, dates/month clipping, hourly/daily and paid leave, seconds precision, totals/net reconciliation, rounding adjustment, legacy/malformed snapshots, stored salaries in real per-person Excel, matching UI/export model, employee-own/client/admin-export authorization.');
 } finally {h.native.close();}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
