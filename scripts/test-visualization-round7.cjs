/** Run ONLY against a compiled isolated source copy. Never uses SQLite or network. */
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const root = process.argv[2];
if (!root || !path.resolve(root).startsWith('/private/tmp/')) throw Error('ISOLATED_COMPILED_ROOT_REQUIRED');
const load = Module._load;
let tables, failures, trace = [], opens = 0, closes = 0;
const clone = x => structuredClone(x);
function reset() {
  failures = new Set(); trace = [];
  tables = { orders: [], sales: [], lines: [], fulfillments: [], parents: [], inbox: [], finances: [], receipts: [], credits: [], refunds: [], invoices: [], employees: [{id:1,name:'合成老板',role:'admin',auth_version:1,must_change_password:0,status:'在职'}], todos: [], issues: [], leave: [], attendance: [], notices: [], reports: [], meetings: [], problems: [], confirmations: [], steps: [] };
}
reset();
const q = require(path.join(root,'lib/visualization/queries.js')).QUERIES;
const dq = require(path.join(root,'lib/visualization/delivery.js')).DELIVERY_QUERIES;
const tq=require(path.join(root,'lib/visualization/bottlenecks.js')).TIMING_QUERIES;
function query(sql, args) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw Error('WRITE_OR_NONSELECT_BLOCKED');
  trace.push({sql,args}); observedQueries.add(sql);
  if (failures.has(sql)) throw Error('SYNTHETIC_QUERY_FAILURE_NO_REAL_DATA');
  if(sql===tq.steps)return clone(tables.steps);
  if(sql===tq.holidays)return clone(tables.holidays);
  if(sql===tq.restarts){const grouped=new Map();for(const a of tables.audit){const old=grouped.get(a.target_id);if(old===undefined||a.created_at>old)grouped.set(a.target_id,a.created_at);}return [...grouped].map(([target_id,restarted_at])=>({target_id,restarted_at}));}
  for(const [key,value] of Object.entries(dq)) if(sql===value)return clone(tables[key]);
  for (const [key, value] of Object.entries(q)) if (sql === value) {
    if (key === 'confirmations') return tables.orders.filter(o=>o.status==='待处理'&&tables.inbox.some(i=>i.internal_order_id===o.id)&&!tables.inbox.some(i=>i.internal_order_id===o.id&&tables.confirmations.some(c=>c.source_order_no===i.source_order_no))&&!tables.steps.some(s=>s.order_id===o.id&&(s.status!=='待处理'||s.started_at!=null||s.completed_at!=null))).map(o=>({id:o.id}));
    return clone(tables[key]);
  }
  if (sql.includes('FROM employees WHERE id = ?')) return tables.employees.filter(r=>r.id===args[0]);
  if (sql.includes("sqlite_master WHERE type='table'")) return [{yes:1}];
  if (sql.includes('FROM commerce_aftercare_state')) return [{revision:1}];
  if (sql.includes('SELECT f.order_id,f.allocated_cents')) return tables.fulfillments.filter(f=>tables.lines.some(l=>l.id===f.line_id&&l.sale_id===args[0])).map(f=>({order_id:f.order_id,original_cents:f.allocated_cents}));
  if (sql.includes('SUM(credit_cents)')) return [{n:tables.credits.filter(r=>r.order_id===args[0]).reduce((n,r)=>n+r.credit_cents,0)}];
  if (sql.includes('SUM(ROUND(f.amount*100))')) return [{n:tables.receipts.filter(r=>r.order_id===args[0]).reduce((n,r)=>n+(tables.finances.find(f=>f.id===r.finance_id)?.amount||0)*100,0)}];
  if (sql.includes('SUM(amount_cents)')) return [{n:tables.refunds.filter(r=>r.order_id===args[0]).reduce((n,r)=>n+r.amount_cents,0)}];
  if (sql.includes('FROM commerce_adjustments') || sql.includes('FROM commerce_refunds')) return [];
  if (sql.includes("MIN(id) id,name FROM employees")) return [...new Map(tables.employees.filter(e=>e.role==='employee').map(e=>[e.name,{id:e.id,name:e.name}])).values()];
  if (sql.includes('FROM leave_requests')) return tables.leave.filter(r=>r.status==='待审批');
  if (sql.includes('FROM attendance_requests')) return tables.attendance.filter(r=>r.status==='待审批');
  if (sql.includes('FROM notice_rule_implementations')) return tables.notices.filter(r=>r.review_status==='还没处理'&&r.printed===1&&r.statement&&r.photos!=='[]'&&r.submitted_at);
  if (sql.includes('FROM work_reports r')) return tables.reports.filter(r=>r.status==='已提交');
  if (sql.includes('FROM meeting_reflections')) return tables.meetings.filter(r=>r.status==='已提交');
  if (sql.includes('FROM todos t WHERE')) return tables.todos.filter(r=>r.status==='未完成').map(r=>({...r,employee_name:r.assignee,summary:r.content,submitted_at:r.created_at}));
  if (sql.includes('FROM problems p')) return tables.problems.filter(r=>r.status==='老板验收');
  if (sql.includes('FROM issue_tickets WHERE')) return tables.issues.filter(r=>['待处理','处理中'].includes(r.status));
  throw Error('UNMODELED_SQL: '+sql);
}
class FakeDatabase {
  constructor(filename, options) { assert.deepEqual(options,{readonly:true,fileMustExist:true}); assert.ok(filename.endsWith('data.db')); opens++; }
  prepare(sql) { return { readonly: /^\s*SELECT\b/i.test(sql), all:(...args)=>query(sql,args), get:(...args)=>query(sql,args)[0], run:()=>{throw Error('WRITE_BLOCKED')} }; }
  close() { closes++; }
  exec() { throw Error('WRITE_BLOCKED'); }
  transaction() { throw Error('WRITE_BLOCKED'); }
}
Module._load = function(id,parent,isMain) {
  if (id === 'better-sqlite3') return FakeDatabase; // The actual native driver is NEVER loaded.
  const resolved = id.startsWith('.') ? Module._resolveFilename(id,parent) : id;
  if (/\/lib\/(db|auth|runtime-config)(\.js|\.cjs)?$/.test(resolved) || /progress-sync|announcement-overdue|customer-payment/.test(id)) throw Error('SIDE_EFFECT_IMPORT_BLOCKED:'+id);
  return load.call(this,id,parent,isMain);
};
const observedQueries = new Set();
// Every statement is interpreted from synthetic table rows, not from API response fixtures.
global.fetch = async()=>{throw Error('NETWORK_BLOCKED')};
process.env.JWT_SECRET='round3-synthetic-jwt-only';
delete process.env.DB_PATH; delete process.env.INTERNAL_APP_ROOT;
const {GET}=require(path.join(root,'app/api/visualization/overview/route.js'));
const {readOnlyReader}=require(path.join(root,'lib/visualization/readonly.js'));
const {utcMillis}=require(path.join(root,'lib/visualization/time.js'));
const {SignJWT}=require(path.join(root,'../node_modules/jose'));
const key=new TextEncoder().encode(process.env.JWT_SECRET);
async function token(payload={id:1,authVersion:1}) { return new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setExpirationTime('1h').sign(key); }
async function call(queryString='',tok) {
  const request=new Request('http://isolated.invalid/api/visualization/overview?from=2026-10-01&to=2026-11-01'+queryString,{headers:{Authorization:'Bearer '+(tok===undefined?await token():tok)}});
  const response=await GET(request); return {status:response.status,body:await response.json()};
}
function order(id,created_at='2026-10-02 00:00:00',status='待处理') { return {id,created_at,status,phase:'discovery',source_system:''}; }
function sale() {
  tables.orders=[order('O1'),order('O2')]; tables.sales=[{id:'P',currency:'CNY',created_at:'2026-09-30 16:59:59'}];
  tables.lines=[{id:'L',sale_id:'P'}]; tables.fulfillments=[{line_id:'L',copy_no:1,order_id:'O1',allocated_cents:5000},{line_id:'L',copy_no:2,order_id:'O2',allocated_cents:5000}];
  tables.finances=[{id:1,order_id:'O1',type:'income',status:'paid',amount:50,currency:'CNY',verify_by:'',verify_at:''},{id:2,order_id:'O2',type:'income',status:'paid',amount:50,currency:'CNY',verify_by:'',verify_at:''}];
  tables.receipts=[{invoice_id:'I',order_id:'O1',finance_id:1},{invoice_id:'I',order_id:'O2',finance_id:2}]; tables.invoices=[{id:'I',sale_id:'P'}];
}

const {createDeliveryGET}=require(path.join(root,'lib/visualization/delivery-handler.js'));
const {openSession}=require(path.join(root,'lib/visualization/runtime.js'));
let fixedNow='2026-10-26T10:00:00Z';
const deliveryGET=createDeliveryGET(openSession,()=>new Date(fixedNow));
function sixth(mode='rich'){
 reset();sale();tables.business=[{id:1,name:'公司注册'},{id:2,name:'签证办理'}];tables.requirements=[];tables.requests=[];tables.documents=[];tables.submissions=[];
 for(let i=0;i<135;i++)tables.orders.push(order('D-'+String(i).padStart(3,'0'),i===0?'2025-01-01 00:00:00':'2026-10-20 00:00:00',i===1?'客户取消':i===2?'已完成':'进行中'));
 tables.orders.forEach((r,i)=>Object.assign(r,{business_type_id:i===0?1:2,sub_service_type:'',responsible_person:i===0?'合成人甲, 合成人乙':i===1?'历史离职姓名':'',phase:'contract'}));
 tables.steps=[{id:1,order_id:'O1',step_name:'注册步骤甲',step_order:1,status:'进行中',assignee:'合成人甲'},{id:2,order_id:'O1',step_name:'注册步骤乙',step_order:2,status:'阻塞',assignee:''},{id:3,order_id:'O2',step_name:'无需办理',step_order:1,status:'已跳过',assignee:''},{id:4,order_id:'O2',step_name:'普通第一步',step_order:2,status:'待处理',assignee:'历史离职姓名'},{id:5,order_id:'O2',step_name:'普通第二步',step_order:3,status:'进行中',assignee:''}];
 tables.requirements=[{id:1,order_id:'O1',step_id:1,document_name:'同名资料',status:'pending'},{id:2,order_id:'O1',step_id:1,document_name:'同名资料',status:'uploaded'}];
 tables.requests=[1,2,3,4].map(id=>({id,internal_order_id:'O1',name:'同名补件',submitted_at:id===1?'': '2026-10-20'}));
 tables.documents=[{id:10,order_id:'O1',name:'旧退回',status:'已退回',direction:'client_to_us'},{id:11,order_id:'O1',name:'新待审',status:'待审核',direction:'client_to_us'},{id:12,order_id:'O1',name:'待重交',status:'已退回',direction:'client_to_us'},{id:13,order_id:'O1',name:'已撤回',status:'待审核',direction:'client_to_us'},{id:14,order_id:'O1',name:'独立退回文件',status:'已退回',direction:'client_to_us'},{id:21,order_id:'O2',name:'同一提交本地副本',status:'待审核',direction:'client_to_us'}];
 tables.submissions=[{id:1,internal_order_id:'O1',requirement_id:'sreq-2',document_id:10,submission_id:'old',withdrawn:0},{id:2,internal_order_id:'O1',requirement_id:'sreq-2',document_id:11,submission_id:'shared',withdrawn:0},{id:3,internal_order_id:'O1',requirement_id:'sreq-3',document_id:12,submission_id:'returned',withdrawn:0},{id:4,internal_order_id:'O1',requirement_id:'sreq-4',document_id:13,submission_id:'withdrawn',withdrawn:1},{id:5,internal_order_id:'O2',requirement_id:'sreq-5',document_id:21,submission_id:'shared',withdrawn:0}];
 tables.requests.push({id:5,internal_order_id:'O2',name:'同一提交本份需求',submitted_at:'2026-10-20'});
 if(mode==='empty'){tables.orders=[];tables.steps=[];tables.requirements=[];tables.requests=[];tables.documents=[];tables.submissions=[];tables.fulfillments=[];tables.sales=[];tables.lines=[];}
 if(mode==='partial')failures.add(dq.documents);
 if(mode==='step-failed')failures.add(dq.steps);
 if(mode==='source-failed')failures.add(q.inbox);
 if(mode==='orders-failed')failures.add(dq.orders);
 if(mode==='conflict'){tables.parents=[{source_order_no:'P2'}];tables.inbox=[{id:'IN',source_order_no:'P2',internal_order_id:'O1'}];}
 if(mode==='missing'){delete tables.requests[0].submitted_at;delete tables.steps[0].assignee;tables.orders[0].created_at='';}
 if(mode==='many-materials')for(let i=6;i<130;i++)tables.requests.push({id:i,internal_order_id:'O1',name:'合成需求'+i,submitted_at:''});
 if(mode==='employee'||mode==='client')tables.employees[0].role=mode;
}
async function askDelivery(params='',tok){const response=await deliveryGET(new Request('http://isolated.invalid/api/visualization/delivery?'+params,{headers:{Authorization:'Bearer '+(tok===undefined?await token():tok)}}));return {status:response.status,body:await response.json()};}

function seventh(mode='rich'){
 sixth(mode);tables.holidays=[];tables.audit=[];
 for(const step of tables.steps)Object.assign(step,{started_at:'2026-10-24 01:00:00',completed_at:null,expected_days:1});
 tables.steps[0]&&(tables.steps[0].status='阻塞');
 if(tables.steps[3])Object.assign(tables.steps[3],{started_at:'2026-10-26 01:00:00',expected_days:1});
 if(tables.steps[4])Object.assign(tables.steps[4],{status:'阻塞',expected_days:0});
 for(const order of tables.orders.filter(o=>o.id.startsWith('D-'))){const i=Number(order.id.slice(2));tables.steps.push({id:100+i,order_id:order.id,step_order:1,step_name:'合成当前办理',status:i===1||i===2?'阻塞':'进行中',assignee:i===0?'历史离职姓名':'',started_at:'2026-10-19 01:00:00',completed_at:null,expected_days:1});}
 if(mode==='calendar-failed')failures.add(tq.holidays);
 if(mode==='audit-failed')failures.add(tq.restarts);
 if(mode==='timing-failed')failures.add(tq.steps);
 if(mode==='unknown'){tables.steps[0].expected_days=null;tables.steps[1].expected_days=-1;tables.steps[3].started_at='2026-02-30 01:00:00';}
 if(mode==='no-steps')tables.steps=[];
 if(mode==='closed-steps')for(const s of tables.steps.filter(x=>x.order_id==='O2'))s.status=s.id===3?'已跳过':'已完成';
 if(mode==='many-steps')for(let i=300;i<425;i++)tables.steps.push({id:i,order_id:'O1',step_name:'并行合成步骤'+i,step_order:i,status:'阻塞',assignee:'',started_at:'2026-10-24 01:00:00',completed_at:null,expected_days:1});
}
async function one(params=''){return (await askDelivery(params)).body;}
async function checks(){
 seventh();let r=await one();assert.equal(r.total,135);assert.deepEqual(r.bottlenecks.blocked,{orders:2,steps:3,unknownOrders:0});assert.deepEqual(r.bottlenecks.overdue,{orders:134,steps:135,unknownOrders:0});assert.equal(r.bottlenecks.affectedOrders,135);
 let a=(await one('search=O1')).items[0],b=(await one('search=O2')).items[0];assert.equal(a.bottleneck.timing.length,2);assert.equal(a.bottleneck.blockedSteps.length,2);assert.equal(b.bottleneck.blockedSteps.length,1);assert.deepEqual(b.bottleneck.timing.map(t=>t.id),['4']);assert.equal(b.bottleneck.timing[0].elapsedDays,1);assert.equal(b.bottleneck.timing[0].overdue,false);
 assert.equal((await one('source=commerce&bottleneck=overdue')).total,1);assert.equal((await one('source=commerce&bottleneck=blocked')).total,2);assert.equal((await one('material=review&bottleneck=affected')).total,2);
 assert.equal((await one('status=all')).bottlenecks.closedBlocked.orders,2);assert.equal((await one('status=all&bottleneck=closed_blocked')).total,2);assert.equal((await one('status=已完成&bottleneck=overdue')).total,0);assert.equal((await one('status=客户取消&bottleneck=blocked')).total,0);
 assert.equal((await one('owner='+encodeURIComponent('合成人甲, 合成人乙')+'&bottleneck=blocked')).total,1);
 console.log('PASS parallel/serial/skipped/noncurrent blockers, distinct order/step units, category overlap union, closed inconsistencies, exact common filters');
 const ids=[];for(let page=1;page<=7;page++){r=await one('bottleneck=overdue&page='+page);assert.equal(r.total,134);ids.push(...r.items.map(x=>x.id));}assert.equal(ids.length,134);assert.equal(new Set(ids).size,134);
 seventh('many-steps');a=(await one('search=O1')).items[0];assert.equal(a.bottleneck.timing.length,127);assert.equal(a.bottleneck.blockedSteps.length,127);
 console.log('PASS >100 overdue records/stable seven pages and all 127 same-order current steps');
 const {workDays}=require(path.join(root,'lib/handling-report.js'));
 const {checkedTime}=require(path.join(root,'lib/visualization/bottlenecks.js'));
 const cases=[['2026-10-26T01:00:00Z','2026-10-26T10:00:00Z',[],1],['2026-10-24T01:00:00Z','2026-10-26T10:00:00Z',[],2],['2026-10-24T09:00:00Z','2026-10-26T02:00:00Z',[],2/9],['2026-10-25T00:00:00Z','2026-10-26T01:00:00Z',[],0],['2026-10-24T01:00:00Z','2026-10-26T10:00:00Z',['2026-10-26'],1]];
 for(const [from,to,holidays,expected]of cases){seventh();fixedNow=to;tables.steps[3].started_at=from;tables.steps[3].expected_days=expected;tables.holidays=holidays.map(date=>({date}));b=(await one('search=O2')).items[0];const t=b.bottleneck.timing[0];assert.equal(t.elapsedDays,workDays(new Date(from),new Date(to),new Set(holidays)));assert.equal(t.elapsedDays,expected);assert.equal(t.overdue,false);}
 seventh();fixedNow='2026-10-26T10:00:00.001Z';assert.equal((await one('search=O2')).items[0].bottleneck.timing[0].overdue,false); // after 17:00 adds no working time
 tables.steps[3].expected_days=0.5;fixedNow='2026-10-26T05:30:00.001Z';b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].overdue,true);assert.ok(b.bottleneck.timing[0].excessDays>0);fixedNow='2026-10-26T05:29:59.999Z';assert.equal((await one('search=O2')).items[0].bottleneck.timing[0].overdue,false);
 fixedNow='2026-10-26T10:00:00Z';seventh();tables.audit=[{target_id:'1',created_at:'2026-10-26 01:00:00'},{target_id:'1',created_at:'2026-10-25 01:00:00'}];a=(await one('search=O1')).items[0];assert.equal(a.bottleneck.timing[0].sinceBasis,'restart');assert.equal(a.bottleneck.timing[0].elapsedDays,1);
 tables.steps[0].started_at='2026-10-26 02:00:00';a=(await one('search=O1')).items[0];assert.equal(a.bottleneck.timing[0].sinceBasis,'started');assert.equal(a.bottleneck.timing[0].elapsedDays,8/9);
 seventh();tables.steps[3].started_at=null;tables.steps[2].completed_at='2026-10-24 10:00:00';b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].sinceBasis,'previous');assert.equal(b.bottleneck.timing[0].elapsedDays,1);assert.equal(b.bottleneck.timing.length,1);
 tables.steps[2].completed_at=null;b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].sinceBasis,'created');assert.equal(b.bottleneck.timing[0].since,'2026-10-02T00:00:00.000Z');
 assert.equal(checkedTime('2026-02-30 00:00:00').invalid,true);assert.equal(checkedTime('2026-10-26 24:00:00').invalid,true);assert.equal(checkedTime('2026-10-26T00:30:00+07:00').date.toISOString(),'2026-10-25T17:30:00.000Z');
 console.log('PASS exact threshold/one millisecond over/below, Saturday/Sunday/night/Bangkok boundary/holiday, original workDays parity, restart-v-started/previous/created priority');
 for(const expected of [null,'',-1,Infinity,NaN,undefined]){seventh();tables.steps[3].expected_days=expected;b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].overdue,null);assert.ok(b.bottleneck.timing[0].reasons.length);}
 seventh();tables.steps[3].expected_days=0;b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].expectedDays,0);assert.equal(b.bottleneck.timing[0].overdue,true);
 tables.steps[3].started_at=fixedNow;b=(await one('search=O2')).items[0];assert.equal(b.bottleneck.timing[0].overdue,false);
 for(const mode of ['calendar-failed','audit-failed','timing-failed']){seventh(mode);r=await one('search=O1');assert.equal(r.items[0].bottleneck.timingState,'failed');assert.equal(r.items[0].bottleneck.timing[0].overdue,null);assert.equal(r.bottlenecks.blocked.orders,1);assert.equal(r.bottlenecks.overdue.unknownOrders,1);assert.equal(r.items[0].counts.review,1);const filtered=await one('bottleneck=overdue');assert.equal(filtered.total,0);assert.equal(filtered.bottlenecks.overdue.unknownOrders,135);assert.equal(filtered.selectionUnknownOrders,135);}
 seventh('closed-steps');b=(await one('search=O2')).items[0];assert.equal(b.status,'待处理');assert.equal(b.bottleneck.timingState,'no_current');assert.equal(b.bottleneck.timing.length,0);assert.equal((await one('search=O2&bottleneck=timing_unknown')).total,0);
 seventh('no-steps');r=await one('bottleneck=timing_unknown');assert.equal(r.total,135);assert.equal(r.items[0].bottleneck.timingState,'no_current');
 seventh();tables.steps[0].started_at='bad';a=(await one('search=O1')).items[0];assert.equal(a.bottleneck.timing[0].overdue,null);assert.equal(a.bottleneck.timing[1].overdue,true);assert.equal((await one('search=O1&bottleneck=overdue')).total,1);
 seventh();tables.orders[0].created_at='';r=await one('source=commerce&from=2026-10-01&to=2026-11-01');assert.equal(r.total,1);assert.equal(r.scopeUnknownOrders,1);
 seventh();tables.audit=[{target_id:'1',created_at:'bad'}];assert.equal((await one('search=O1')).items[0].bottleneck.timing[0].overdue,null);
 console.log('PASS null/empty/negative/nonfinite/missing/zero expected, invalid times, successful empty holidays vs calendar/audit/time query failures, partial known overdue and no steps');
 for(const role of ['admin','employee','client']){seventh(role);const before=trace.length;const result=await askDelivery('bottleneck=overdue');assert.equal(result.status,role==='client'?403:200);if(role==='client')assert.ok(!trace.slice(before).some(x=>Object.values(tq).includes(x.sql)));else{assert.equal(result.body.total,134);assert.ok(!JSON.stringify(result.body).includes('customer_name'));}}
 seventh();tables.employees[0].role='client';assert.equal((await askDelivery('bottleneck=blocked',await token({id:1,authVersion:1,role:'admin'}))).status,403);
 seventh('empty');r=await one();assert.equal(r.total,0);assert.equal(r.bottlenecks.blocked.orders,0);assert.equal(r.bottlenecks.overdue.orders,0);
 seventh();delete tables.orders[0].status;r=await one('status=已完成');assert.equal(r.total,1);assert.equal(r.scopeUnknownOrders,1);
 seventh('step-failed');r=await one();assert.equal(r.bottlenecks.blocked.unknownOrders,135);
 seventh();for(const invalid of ['bottleneck=no','bottleneck=all&bottleneck=blocked','role=admin','now=2025-01-01','ownerUnassigned=1&owner=name'])assert.equal((await askDelivery(invalid)).status,400);
 assert.equal(opens,closes);console.log('PASS staff scope/client denial before timing reads, identity/clock injection denied, successful empty/partial modules, closed readonly sessions');
 fs.writeFileSync(path.join(root,'../round7-query-evidence.json'),JSON.stringify({groups:5,fixedNow,queries:[...observedQueries],opens,closes,realDatabase:false,originalWorkDaysCases:cases},null,2));
}
if(process.argv.includes('--serve')){
 const http=require('node:http');let mode='rich';const requests=[];const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture.invalid');
 if(url.pathname==='/__fixture'){mode=url.searchParams.get('mode')||'rich';res.end('ok');return;}
 if(url.pathname==='/__token'){res.end(await token());return;}
 if(url.pathname==='/__trace'){res.end(JSON.stringify({requests,sql:[...observedQueries],opens,closes,realDatabase:false,fixedNow}));return;}
 if(!['/api/visualization/delivery','/api/visualization/overview'].includes(url.pathname)||req.method!=='GET'){res.writeHead(403);res.end('blocked');return;}
 requests.push({method:req.method,url:req.url,mode});if(mode==='failed'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"SYNTHETIC_FAILURE"}');return;}
 fixedNow='2026-10-26T10:00:00Z';seventh(mode);const fn=url.pathname.endsWith('/delivery')?deliveryGET:GET;const r=await fn(new Request('http://fixture.invalid'+req.url,{headers:{Authorization:req.headers.authorization||''}}));const body=await r.text();const send=()=>{res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);};if(mode==='race'&&url.searchParams.get('bottleneck')==='blocked')setTimeout(send,900);else send();
 });server.listen(43184,'127.0.0.1',()=>console.log('Round7 synthetic real GET ready'));}
else checks().catch(e=>{console.error(e);process.exitCode=1});
