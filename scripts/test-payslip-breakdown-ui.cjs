// Production UI with every API intercepted; actual payroll routes use memory-only SQLite.
const { chromium }=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const {createPayrollRulesHarness}=require('./test-payroll-rules.cjs');
const {load}=require('./test-company-archives.cjs');
const XLSX=require('xlsx');
const origin=process.env.TEST_APP_ORIGIN||'http://127.0.0.1:3201';
assert(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [1440,390]){
  const h=createPayrollRulesHarness(),errors=[];
  h.addLeave({end_time:'13:00'});
  h.addLeave({leave_type:'病假',start_date:'2026-10-03',end_date:'2026-10-03'});
  h.addLeave({leave_type:'年假',pay_status:'带薪',start_date:'2026-10-05',end_date:'2026-10-05'});
  h.native.prepare("INSERT INTO attendance(employee_name,date,check_in,type) VALUES('Bam','2026-10-06','2026-10-06 01:40:00','正常')").run();
  await h.call('payslips','POST',{month:'2026-10'});
  h.native.exec("UPDATE payslips SET status='待确认'");
  let actor;
  const exportRoute=load('src/app/api/payslips/export/route.ts',{'next/server':{NextResponse:Response},'@/lib/db':{getDb:()=>h.db},'@/lib/auth':{verifyAuth:async()=>actor},xlsx:XLSX,'@/lib/payslip-breakdown':load('src/lib/payslip-breakdown.ts')});
  async function open(user){
   actor=user;h.setActor(user);
   const context=await browser.newContext({viewport:{width,height:900},isMobile:width===390,hasTouch:width===390,serviceWorkers:'block'});
   context.setDefaultTimeout(15000);await context.addInitScript(()=>localStorage.setItem('authToken','fixture'));
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());assert.equal(url.origin,origin);
    if(!url.pathname.startsWith('/api/'))return route.continue();
    const p=url.pathname,send=(data,status=200)=>route.fulfill({status,json:data});
    if(p==='/api/auth/me')return send(user);
    if(p==='/api/payslips/export'){const r=await exportRoute.GET(new Request(url));return route.fulfill({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer())});}
    if(p==='/api/payslips'){const r=await h.call('payslips','GET',undefined,url.search);return send(r.body,r.status);}
    if(p==='/api/employees')return send(h.native.prepare('SELECT * FROM employees').all());
    if(p==='/api/internal/workload')return send({employees:[],thresholds:{warn:10,crit:20}});
    if(p==='/api/settings')return send({agency_enabled:false});
    if(p==='/api/boss-supervision/pending')return send({total:0,counts:{},items:[]});
    if(p.includes('count'))return send({count:0});
    assert.equal(request.method(),'GET');return send([]);
   });
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {context,page};
  }
  try{
   let {context,page}=await open({id:1,name:'老板',role:'admin'});
   await page.goto(origin+'/internal/payslips');await page.locator('input[type=month]').first().fill('2026-10');
   const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'Bam',exact:true})});
   await row.getByRole('button',{name:'详情',exact:true}).click();
   let dialog=page.getByRole('dialog',{name:'工资单详情：Bam 2026-10',exact:true});
   const model=load('src/lib/payslip-breakdown.ts').buildPayslipBreakdown(h.native.prepare('SELECT * FROM payslips WHERE employee_id=2').get());
   async function check(){
    const section=dialog.getByRole('region',{name:'计算明细'});await section.waitFor();
    const text=await section.innerText();
    for(const str of ['累计迟到 40 分钟','30 分钟豁免','4 小时（不带薪）','2026-10-03 病假','带薪，不扣款','÷ 30','÷ 8','应出勤天数','实际出勤天数','请假天数',model.net.toFixed(2)]) assert(text.includes(str),str);
    await section.getByText('实发工资',{exact:true}).scrollIntoViewIfNeeded();
    const box=await dialog.boundingBox();assert(box.x>=0&&box.x+box.width<=width+1);assert(box.height<=900);assert(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth));
   }
   await check();await page.screenshot({path:`breakdown-admin-${width}.png`});await dialog.getByRole('button',{name:'关闭工资单详情'}).click();
   const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'导出 Excel',exact:true}).click();
   const download=await downloaded;assert.equal(download.suggestedFilename(),'payslips_2026-10.xlsx');await download.saveAs(`breakdown-export-${width}.xlsx`);
   const wb=XLSX.readFile(`breakdown-export-${width}.xlsx`);assert.deepEqual(wb.SheetNames,['Bam','Ing']);
   assert.equal(XLSX.utils.sheet_to_json(wb.Sheets.Bam,{header:1}).find(r=>r[0]==='实发工资')[2],model.net);
   await context.close();
   ({context,page}=await open({id:2,name:'Bam',role:'employee'}));
   await page.goto(origin+'/internal');const own=page.locator('[data-my-payslip-id]');await own.getByRole('button',{name:'详情 / 计算明细',exact:true}).click();
   dialog=page.getByRole('dialog',{name:'2026-10 工资单计算明细',exact:true});await check();await page.screenshot({path:`breakdown-employee-${width}.png`});await dialog.getByRole('button',{name:'关闭计算明细'}).click();
   assert.equal(await page.locator('[data-my-payslip-id]').count(),1);assert.deepEqual(errors,[]);
   await context.close();console.log(`PASS ${width}: admin detail and own employee detail show identical formulas, itemized paid/unpaid leave, rates/attendance/net; modal stays in viewport without horizontal overflow; other employee slips excluded; no browser errors.`);
  }finally{h.native.close();}
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
