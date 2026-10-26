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
const eq=require(path.join(root,'lib/visualization/exceptions.js')).EXCEPTION_QUERIES;
function query(sql, args) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw Error('WRITE_OR_NONSELECT_BLOCKED');
  trace.push({sql,args}); observedQueries.add(sql);
  if(failures.has('__ALL_BUSINESS__')&&!sql.includes('FROM employees WHERE id = ?'))throw Error('SYNTHETIC_ALL_FAILURE');
  if (failures.has(sql)) throw Error('SYNTHETIC_QUERY_FAILURE_NO_REAL_DATA');
  for(const [name,value]of Object.entries(eq))if(sql===value)return clone(tables[name]);
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

const {createExceptionsGET}=require(path.join(root,'lib/visualization/exceptions-handler.js'));
const exceptionsGET=createExceptionsGET(openSession,()=>new Date('2026-10-26T10:00:00Z'));
function eighth(mode='rich'){
 seventh(mode==='empty'?'rich':mode);tables.progress=[];tables.documentsOutbox=[];tables.certificates=[];tables.cancels=[];
 tables.parents=[{source_order_no:'SRC-A',source:'storefront',currency:'CNY',created_at:'2026-01-01 00:00:00'}];
 tables.inbox=[{id:'IN-0',source_order_no:'SRC-A',internal_order_id:'D-000',line_no:1,copy_no:1},{id:'IN-3',source_order_no:'SRC-A',internal_order_id:'D-003',line_no:1,copy_no:2},{id:'IN-C',source_order_no:'SRC-A',internal_order_id:'D-001',line_no:1,copy_no:3},{id:'IN-HISTORY',source_order_no:'MISSING-PARENT',internal_order_id:'D-004',line_no:1,copy_no:1},{id:'IN-BROKEN',source_order_no:'SRC-A',internal_order_id:'NO-ORDER',line_no:1,copy_no:1},{id:'IN-CONFLICT',source_order_no:'SRC-A',internal_order_id:'O1',line_no:1,copy_no:1}];
 tables.documents.push({id:810,order_id:'D-000',name:'本地副本甲',status:'待审核',direction:'client_to_us'},{id:811,order_id:'D-003',name:'本地副本乙',status:'待审核',direction:'client_to_us'},{id:910,order_id:'D-000',name:'公开文件',status:'已审核',direction:'us_to_client'});
 tables.submissions.push({id:80,submission_id:'SUB-SHARED',source_order_no:'SRC-A',internal_order_id:'D-000',document_id:810,withdrawn:0},{id:81,submission_id:'SUB-SHARED',source_order_no:'SRC-A',internal_order_id:'D-003',document_id:811,withdrawn:0},{id:82,submission_id:'HIST',source_order_no:'SRC-A',internal_order_id:'D-005',document_id:9999,withdrawn:1},{id:83,submission_id:'LIVE-BROKEN',source_order_no:'SRC-A',internal_order_id:'D-006',document_id:9998,withdrawn:0});
 tables.requests.push({id:'REQ-ONE',source_order_no:'SRC-A',internal_order_id:'D-000',name:'补件请求甲',submitted_at:'',created_at:'2026-10-20 00:00:00'});
 tables.cancels=[{id:'CANCEL-ONE',source_order_no:'SRC-A',internal_order_id:'D-001',line_no:1,copy_no:3,status:'pending',created_at:'2026-10-20 00:00:00'}];
 tables.certificates=[{id:920,order_id:'D-003'}];
 const ev=(id,attempts=1)=>({id,status:'pending',attempts,created_at:'2026-10-20 00:00:00',sent_at:null,next_attempt_at:null,last_error:null});
 tables.progress=[{...ev('PGR-W0',0),inbox_id:'IN-0'},{...ev('PGR-R1'),inbox_id:'IN-0'},{...ev('PGR-SENT'),status:'sent',sent_at:'2026-10-26 09:00:00',inbox_id:'IN-0'}];
 for(let i=0;i<120;i++)tables.progress.push({...ev('PGR-M-'+String(i).padStart(3,'0')),inbox_id:'IN-0'});
 tables.progress.push({...ev('PGR-BAD',-1),status:'SYNTHETIC_SECRET_STATUS',inbox_id:'IN-0'},{...ev('PGR-NODATE',2),created_at:'',inbox_id:'IN-0'},{...ev('PGR-UNLINK',0),inbox_id:'NO-INBOX'});
 const doc=(id,key,payload,attempts=1)=>({...ev(id,attempts),submission_id:key,payload:JSON.stringify(payload)});
 tables.documentsOutbox=[doc('DRV-A','SUB-SHARED',{submission_id:'SUB-SHARED',seq:1},6),doc('DRV-B','SUB-SHARED',{submission_id:'SUB-SHARED',seq:2},2),doc('DRQ-A','REQ-ONE',{event:'request',request_id:'REQ-ONE',source_order_no:'SRC-A'},0),doc('CNL-A','CANCEL-ONE',{event:'cancel',request_id:'CANCEL-ONE',source_order_no:'SRC-A',line_no:1,copy_no:3}),doc('DLV-A','doc-910',{event:'delivery',delivery_id:'doc-910',source_order_no:'SRC-A'},0),doc('DLV-C','cert-920',{event:'delivery',delivery_id:'cert-920',source_order_no:'SRC-A'},0),{...doc('DRV-BAD','BAD',{}),payload:'{'},doc('DRV-LEAK','SUB-SHARED',{submission_id:'SUB-SHARED',name:'SYNTHETIC_SECRET_PAYLOAD',url:'https://synthetic.invalid?token=SYNTHETIC_TOKEN'},2),{...doc('DOC-SENT','SUB-SHARED',{submission_id:'SUB-SHARED'}),status:'sent',sent_at:'2026-10-25 09:00:00'},{...doc('DOC-BADSENT','SUB-SHARED',{submission_id:'SUB-SHARED'}),status:'sent',sent_at:'invalid'},doc('DOC-ATTEMPT','SUB-SHARED',{submission_id:'SUB-SHARED'},'2'),doc('DOC-MISSING','NO-SUB',{submission_id:'NO-SUB'})];
 tables.documentsOutbox.find(r=>r.id==='DRV-LEAK').last_error='Error https://synthetic.invalid?token=SYNTHETIC_TOKEN 客户=SYNTHETIC_CUSTOMER';
 const finance=(id,order_id,status,currency,amount)=>({id,order_id,status,currency,amount,type:'income',verify_by:'',verify_at:'',created_at:'2026-10-20 00:00:00'});
 tables.finances.push(finance(801,'D-001','pending','CNY',40),finance(802,'D-000','待核对','THB',60),finance(803,'O1','未到账','CNY',30),finance(804,'D-003','pending','SYNTHETIC_SECRET_CURRENCY',5),finance(805,'D-000','pending','CNY','SYNTHETIC_SECRET_AMOUNT'),finance(806,'NO-ORDER','pending','CNY',7));
 tables.orders.find(o=>o.id==='O2').created_at='';
 tables.issues=[{id:9,ticket_number:'ISSUE-9',description:'合成多人事项',assignee:'甲,乙',created_at:'2026-10-20 00:00:00',status:'待处理'}];
 if(mode==='empty'){for(const k of Object.keys(tables))if(k!=='employees')tables[k]=[];}
 if(mode==='progress-failed')failures.add(eq.progress);
 if(mode==='documents-failed')failures.add(eq.documentsOutbox);
 if(mode==='financial-failed')failures.add(q.finances);
 if(mode==='mapping-failed')failures.add(eq.submissions);
 if(mode==='all-failed')failures.add('__ALL_BUSINESS__');
 if(mode==='all-failed')for(const sql of [...Object.values(eq),...Object.values(q),...Object.values(dq),...Object.values(tq)])failures.add(sql);
 if(mode==='many-copies'){for(let i=10;i<130;i++){const order_id='D-'+String(i).padStart(3,'0');tables.documents.push({id:10000+i,order_id,name:'同一提交本地副本',status:'待审核',direction:'client_to_us'});tables.submissions.push({id:10000+i,submission_id:'SUB-SHARED',source_order_no:'SRC-A',internal_order_id:order_id,document_id:10000+i,withdrawn:0});}}
}
async function askExceptions(params='',tok){const r=await exceptionsGET(new Request('http://isolated.invalid/api/visualization/exceptions?'+params,{headers:{Authorization:'Bearer '+(tok===undefined?await token():tok)}}));return {status:r.status,body:await r.json()};}
const ex=async p=>(await askExceptions(p)).body;
function rich(mode='rich') {
 reset(); sale();
 for(let i=0;i<135;i++) tables.orders.push(order('LOCAL-'+String(i).padStart(4,'0')+'-LONG-INTERNAL-IDENTIFIER',i===0?'2026-10-31 16:59:59':i===1?'2026-10-31 17:00:00':'2026-10-10 00:00:00',i%7===0?'客户取消':i%3===0?'已完成':'进行中'));
 tables.orders.push(order('SOURCE-ORDER-ONE'));
 tables.parents=[{source_order_no:'SYN-SOURCE-PARENT',source:'storefront',currency:'CNY',created_at:'2026-09-30 16:59:59'}];
 tables.inbox=[{id:'IN-1',source_order_no:'SYN-SOURCE-PARENT',internal_order_id:'SOURCE-ORDER-ONE',line_no:1,copy_no:1}];
 tables.finances.push({id:3,order_id:'O1',type:'income',status:'paid',currency:'THB',amount:500,verify_by:'合成核对人',verify_at:'2026-10-01 00:00:00'}, {id:4,order_id:'O1',type:'income',status:'待核对',currency:'CNY',amount:40},{id:5,order_id:'O2',type:'income',status:'未到账',currency:'CNY',amount:30},{id:6,order_id:'O1',type:'expense',status:'paid',currency:'CNY',amount:5},{id:7,order_id:'O2',type:'expense',status:'paid',currency:'CNY',amount:30});
 tables.refunds=[{order_id:'O2',amount_cents:3000,finance_id:7}]; tables.credits=[{order_id:'O1',credit_cents:5000},{order_id:'O2',credit_cents:5000}];
 tables.employees.push({id:2,name:'合成员工',role:'employee'});
 tables.issues=Array.from({length:23},(_,i)=>({id:i+10,status:'待处理',ticket_number:'SYN-ISSUE-'+i,description:'合成工单示例 · 沿原入口定位',assignee:'合成员工,另一位合成员工',created_at:'2026-10-01 00:00:00'}));
 tables.todos=[{id:20,status:'未完成',assignee:'合成员工',content:'合成待办',created_at:'2026-10-01 00:00:00'}];
 if(mode==='unknown') {tables.finances.push({id:8,order_id:'O1',type:'income',status:'paid',currency:'',amount:20},{id:9,order_id:'O1',type:'income',status:'paid',currency:'CNY',amount:-5});tables.orders.push(order('NO-DATE',''));}
 if(mode==='partial') failures.add(q.finances);
 if(mode==='mismatch') tables.finances[0].status='未到账';
 if(mode==='employee'||mode==='client') tables.employees[0].role=mode;
 if(mode==='empty') reset();
}
function fifthData(mode='rich') {
 reset(); sale(); tables.sales[0].created_at='2025-12-31 00:00:00';
 tables.orders[0].created_at='2025-12-31 16:59:59'; tables.orders[1].created_at='2025-12-31 17:00:00';
 for(let i=0;i<135;i++) tables.orders.push(order('LOCAL-'+String(i).padStart(4,'0'),i===0?'2025-12-19 16:59:59':i===1?'2026-02-10 17:00:00':'2026-01-15 00:00:00',i%7===0?'客户取消':i%3===0?'已完成':'进行中'));
 tables.orders.push(order('SOURCE-ONE','2026-01-20 00:00:00'));
 tables.parents=[{source_order_no:'SOURCE-PARENT',source:'storefront',currency:'CNY',created_at:'2026-01-20 00:00:00'}];
 tables.inbox=[{id:'IN',source_order_no:'SOURCE-PARENT',internal_order_id:'SOURCE-ONE',line_no:1,copy_no:1}];
 if(mode==='unknown'){tables.orders.push(order('NO-DATE',''),order('BAD-DATE','2026-02-30 00:00:00'));tables.parents.push({source_order_no:'NO-PARENT-DATE',source:'storefront',currency:'CNY',created_at:''});}
 if(mode==='conflict')tables.inbox.push({id:'CONFLICT',source_order_no:'SOURCE-PARENT',internal_order_id:'O1',line_no:2,copy_no:1});
 if(mode==='partial')failures.add(q.finances);
 if(mode==='trend-failed')failures.add(q.orders);
 if(mode==='employee'||mode==='client')tables.employees[0].role=mode;
 if(mode==='empty')reset();
}

const routes={overview:GET,delivery:require(path.join(root,'app/api/visualization/delivery/route.js')).GET,exceptions:require(path.join(root,'app/api/visualization/exceptions/route.js')).GET};
let fixtureDataset='exceptions8',fixtureMode='rich',fixtureRole=null,fixtureAccount='active',delayPath='',delayBudget=0,nonce=0;
function prepareData(dataset=fixtureDataset,mode=fixtureMode,role=fixtureRole,account=fixtureAccount){
 if(dataset==='overview4')rich(mode);else if(dataset==='trend5')fifthData(mode);else eighth(mode);
 const add=(id,name,role)=>{let user=tables.employees.find(u=>u.id===id);if(!user){user={id,name,role};tables.employees.push(user);}Object.assign(user,{auth_version:1,must_change_password:0,status:'在职',salary:'SYNTHETIC_SALARY',bank_account:'SYNTHETIC_BANK',passport:'SYNTHETIC_PASSPORT'});};
 add(1,'合成老板',role||tables.employees[0]?.role||'admin');add(2,'合成员工','employee');add(3,'合成客户','client');
 const boss=tables.employees.find(u=>u.id===1);if(role)boss.role=role;
 if(account==='left'||account==='disabled')boss.status='离职';if(account==='unknown-status')boss.status='停用';if(account==='password')boss.must_change_password=1;if(account==='bad-password-field')boss.must_change_password=undefined;if(account==='version')boss.auth_version=2;if(account==='missing')tables.employees=tables.employees.filter(u=>u.id!==1);
}
async function credential(id=1,kind='valid'){
 const payload={id,authVersion:kind==='old-version'?0:1,role:kind==='forged'?'admin':'client',name:'SYNTHETIC_FORGED_NAME',owner:'SYNTHETIC_FORGED_OWNER',nonce:++nonce};
 let value=await new SignJWT(payload).setProtectedHeader({alg:'HS256'}).setExpirationTime(kind==='expired'?1:'1h').sign(key);if(kind==='tampered')value+='broken';return value;
}
async function actual(endpoint,params='',jwt){const url='http://isolated.invalid/api/visualization/'+endpoint+'?'+(endpoint==='overview'?'from=2026-10-01&to=2026-11-01&':'')+params;const r=await routes[endpoint](new Request(url,{headers:jwt===null?{}:{Authorization:'Bearer '+(jwt===undefined?await credential():jwt)}}));return {status:r.status,body:await r.json(),headers:Object.fromEntries(r.headers)};}
async function checks(baseline=false){
 const matrix=[];
 for(const [id,role,expected]of [[1,'admin',[200,200,200]],[2,'employee',[403,200,403]],[3,'client',[403,403,403]]])for(const [index,endpoint]of ['overview','delivery','exceptions'].entries()){
  prepareData('exceptions8','rich',null,'active');const jwt=await credential(id,'forged');trace=[];const r=await actual(endpoint,'',jwt);assert.equal(r.status,expected[index]);const business=trace.filter(t=>!t.sql.includes('FROM employees WHERE id = ?'));if(r.status!==200){assert.equal(business.length,0);assert.deepEqual(Object.keys(r.body),r.status===403&&!baseline?['error','viewerRole']:['error']);if(r.status===403&&!baseline)assert.equal(r.body.viewerRole,role);}else{assert.equal(r.headers['cache-control'],'private, no-store');assert.equal(r.headers.vary,'Authorization');for(const marker of ['SYNTHETIC_SALARY','SYNTHETIC_BANK','SYNTHETIC_PASSPORT','SYNTHETIC_FORGED_NAME','SYNTHETIC_FORGED_OWNER'])assert.ok(!JSON.stringify(r.body).includes(marker));if(endpoint==='delivery'){assert.equal(r.body.total,135);assert.ok(!JSON.stringify(r.body).includes('currentIncome'));}}
  matrix.push({id,serverRole:role,endpoint,status:r.status,businessReads:business.length});
 }
 console.log('PASS actual route role matrix, forged role/name/owner ignored, denial before business SQL, employee global delivery and minimum response fields');
 for(const kind of ['anonymous','expired','tampered','old-version'])for(const endpoint of Object.keys(routes)){
  prepareData('exceptions8','rich',null,'active');trace=[];const before=opens;const r=await actual(endpoint,'',kind==='anonymous'?null:await credential(1,kind));assert.equal(r.status,401);assert.ok(!trace.some(t=>!t.sql.includes('FROM employees WHERE id = ?')));if(['anonymous','expired','tampered'].includes(kind))assert.equal(opens,before);
 }
 for(const account of ['left','disabled','password','version','missing'])for(const endpoint of Object.keys(routes)){prepareData('exceptions8','rich',null,account);trace=[];const r=await actual(endpoint);assert.equal(r.status,401);assert.equal(trace.filter(t=>!t.sql.includes('FROM employees WHERE id = ?')).length,0);}
 const findings=[];
 for(const account of ['unknown-status','bad-password-field']){prepareData('exceptions8','rich',null,account);const r=await actual('overview');findings.push({case:account,status:r.status});if(!baseline)assert.equal(r.status,401);}
 // Existing policy permits this valid status. Do not invent a new staff suspension policy.
 prepareData('exceptions8','rich',null,'active');tables.employees[0].status='停薪留职';assert.equal((await actual('delivery')).status,200);
 console.log('PASS anonymous/expiry/tamper/version/left/disabled/password-change/missing-account checks and preserved valid account statuses');
 prepareData('exceptions8','rich',null,'active');let r=await actual('overview','detail=finances&subset=income_waiting');const leaked=JSON.stringify(r.body).includes('SYNTHETIC_SECRET');findings.push({case:'invalid-finance-text-exposed',leaked});if(!baseline)assert.equal(leaked,false);
 prepareData('exceptions8','rich',null,'active');tables.orders[0].source_system='https://synthetic.invalid/?token=SYNTHETIC_TOKEN_SOURCE';const publicOrders=await actual('overview','detail=orders');assert.ok(!JSON.stringify(publicOrders.body).includes('SYNTHETIC_TOKEN_SOURCE'));
 for(const endpoint of Object.keys(routes))for(const bad of ['role=admin','source=all&source=local','page=1000001','pageSize=101','from=2026-02-30&to=2026-03-01']){prepareData('exceptions8','rich',null,'active');trace=[];const r=await actual(endpoint,bad);assert.equal(r.status,400);assert.equal(trace.filter(t=>!t.sql.includes('FROM employees WHERE id = ?')).length,0);}
 assert.equal(opens,closes);console.log('PASS invalid/duplicate/range/identity parameters reject before metrics, sensitive malformed money check and closed readonly sessions');
 fs.writeFileSync(path.join(root,baseline?'../before-auth-query-evidence.json':'../round9-query-evidence.json'),JSON.stringify({baseline,matrix,findings,opens,closes,queries:[...observedQueries],realDatabase:false},null,2));
}
if(process.argv.includes('--serve')){
 const http=require('node:http');const requests=[];
 const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://fixture.invalid');
 if(u.pathname==='/__fixture'){if(u.searchParams.has('dataset'))fixtureDataset=u.searchParams.get('dataset');if(u.searchParams.has('mode'))fixtureMode=u.searchParams.get('mode');if(u.searchParams.has('role'))fixtureRole=u.searchParams.get('role')==='default'?null:u.searchParams.get('role');if(u.searchParams.has('account'))fixtureAccount=u.searchParams.get('account');if(u.searchParams.has('delay')){delayPath=u.searchParams.get('delay');delayBudget=1;}res.end('ok');return;}
 if(u.pathname==='/__token'){res.end(await credential(Number(u.searchParams.get('id')||1),u.searchParams.get('kind')||'valid'));return;}
 if(u.pathname==='/__trace'){res.end(JSON.stringify({requests,sql:[...observedQueries],opens,closes,realDatabase:false}));return;}
 const endpoint=u.pathname.split('/').at(-1);if(!u.pathname.startsWith('/api/visualization/')||!routes[endpoint]||req.method!=='GET'){res.writeHead(403);res.end('blocked');return;}
 const requestCase={method:req.method,url:req.url,dataset:fixtureDataset,mode:fixtureMode,serverRole:fixtureRole,account:fixtureAccount};
 if(fixtureMode==='failed'){requests.push({...requestCase,status:503});res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"SYNTHETIC_FAILURE"}');return;}
 prepareData();const uiRoutes={overview:GET,delivery:deliveryGET,exceptions:exceptionsGET};const r=await uiRoutes[endpoint](new Request('http://fixture.invalid'+req.url,{headers:{Authorization:req.headers.authorization||''}}));const body=await r.text();requests.push({...requestCase,status:r.status,businessReads:trace.filter(t=>!t.sql.includes('FROM employees WHERE id = ?')).length});const send=()=>{res.writeHead(r.status,{'content-type':'application/json','cache-control':'private, no-store',vary:'Authorization'});res.end(body);};
 if(delayBudget>0&&delayPath===endpoint){delayBudget--;setTimeout(send,1000);}else send();
 });server.listen(43184,'127.0.0.1',()=>console.log('Round9 reviewed synthetic real routes ready'));}
else checks(process.argv.includes('--baseline')).catch(e=>{console.error(e);process.exitCode=1});
