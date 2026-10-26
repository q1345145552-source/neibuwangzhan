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
function query(sql, args) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw Error('WRITE_OR_NONSELECT_BLOCKED');
  trace.push({sql,args}); observedQueries.add(sql);
  if (failures.has(sql)) throw Error('SYNTHETIC_QUERY_FAILURE_NO_REAL_DATA');
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

const {GET:deliveryGET}=require(path.join(root,'app/api/visualization/delivery/route.js'));
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
async function checks(){
 sixth();let r=await askDelivery();assert.equal(r.status,200);assert.equal(r.body.total,135);assert.equal(r.body.summary.orders,135);let a=r.body.items.find(x=>x.id==='O1');
 // Stable lexical/numeric order puts O1 after D; find it using exact server filter.
 a=(await askDelivery('search=O1')).body.items[0];assert.equal(a.steps.filter(x=>x.current).length,2);assert.equal(a.counts.step_pending,1);assert.equal(a.counts.unsubmitted,1);assert.equal(a.counts.review,1);assert.equal(a.counts.returned,1);assert.equal(a.counts.file_returned,1);assert.equal(a.counts.unknown,1);assert.equal(a.requirementCount,6);
 let b=(await askDelivery('search=O2')).body.items[0];assert.deepEqual(b.steps.filter(x=>x.current).map(x=>x.id),['4']);assert.equal(b.steps[0].status,'已跳过');assert.equal(b.counts.review,1);assert.equal(b.owner,'历史离职姓名');assert.equal(b.facts.find(x=>x.category==='review').submissionId,'shared');
 console.log('PASS parallel/serial/skipped steps; parent split rows; latest effective submission; same-name distinct demands; withdrawn unknown; standalone file; shared submission copies');
 assert.equal((await askDelivery('status=all')).body.total,137);assert.equal((await askDelivery('status=已完成')).body.total,1);assert.equal((await askDelivery('owner='+encodeURIComponent('合成人甲, 合成人乙'))).body.total,1);assert.equal((await askDelivery('owner=合成人甲')).body.total,0);assert.equal((await askDelivery('ownerUnassigned=1')).body.total,133);
 const ids=[];for(let i=1;i<=7;i++){let page=(await askDelivery('page='+i)).body;assert.equal(page.total,135);ids.push(...page.items.map(x=>x.id));}assert.equal(ids.length,135);assert.equal(new Set(ids).size,135);
 assert.equal((await askDelivery('material=review')).body.total,2);assert.equal((await askDelivery('material=returned')).body.total,1);assert.equal((await askDelivery('search=D-000')).body.items[0].steps.length,0);
 console.log('PASS default historical backlog/state/owner exact filters; >100 stable pages and category subsets');
 tables.orders.push(clone(tables.orders[0]));assert.equal((await askDelivery('status=all')).body.total,137);tables.orders.pop();
 tables.orders[0].created_at='2026-09-30 17:00:00';tables.orders[1].created_at='2026-10-31 16:59:59';tables.orders[2].created_at='2026-10-31 17:00:00';assert.equal((await askDelivery('from=2026-10-01&to=2026-11-01&source=commerce')).body.total,2);
 sixth('conflict');r=await askDelivery('source=conflict');assert.equal(r.body.total,1);assert.equal(r.body.items[0].source,'conflict');
 sixth('missing');a=(await askDelivery('search=O1')).body.items[0];assert.equal(a.steps,null);assert.equal(a.counts.unsubmitted,0);assert.equal(a.counts.unknown,2);
 sixth();tables.orders[0].responsible_person=null;tables.steps[0].assignee=null;tables.orders[0].sub_service_type=null;a=(await askDelivery('search=O1')).body.items[0];assert.equal(a.owner,'');assert.equal(a.steps.filter(s=>s.current).length,2);assert.ok(!a.warnings.includes('负责人字段缺失'));
 tables.submissions.push({id:99,internal_order_id:'O1',requirement_id:'sreq-2',document_id:999,submission_id:'broken',withdrawn:0});a=(await askDelivery('search=O1')).body.items[0];assert.equal(a.counts.review,1);assert.ok(a.warnings.some(x=>x.includes('关联存在缺失')));
 sixth('many-materials');a=(await askDelivery('search=O1')).body.items[0];assert.equal(a.counts.unsubmitted,125);assert.equal(a.facts.filter(x=>x.category==='unsubmitted').length,125);
 console.log('PASS Bangkok month/end boundaries, source conflict one row, missing fields unknown, >100 material details complete');
 for(const role of ['admin','employee','client']){sixth(role);const before=trace.length;r=await askDelivery();assert.equal(r.status,role==='client'?403:200);if(role==='client')assert.ok(!trace.slice(before).some(t=>t.sql===dq.orders));else{assert.ok(!JSON.stringify(r.body).includes('finances'));assert.ok(!trace.slice(before).some(t=>t.sql===q.finances));}}
 sixth();tables.employees[0].role='client';assert.equal((await askDelivery('',await token({id:1,authVersion:1,role:'admin',name:'合成人甲'}))).status,403);
 sixth();tables.documents[0].file_url='SECRET_FILE_PATH';tables.orders[0].customer_name='SECRET_CUSTOMER';r=await askDelivery('search=O1');assert.ok(!JSON.stringify(r.body).includes('SECRET_'));
 sixth('empty');r=await askDelivery();assert.equal(r.body.total,0);assert.equal(r.body.status,'success');
 for(const mode of ['partial','step-failed','source-failed','orders-failed']){sixth(mode);r=await askDelivery();assert.equal(r.body.status,mode==='orders-failed'?'failed':'unknown');if(mode==='partial')assert.equal(r.body.items[0].counts,null);if(mode==='step-failed')assert.equal(r.body.items[0].steps,null);if(mode==='source-failed')assert.equal(r.body.summary.sourceUnknownOrders,137);if(mode==='orders-failed')assert.equal(r.body.total,null);}
 sixth();for(const x of ['role=admin','owner=a&owner=b','page=0','material=no','from=2026-02-30&to=2026-03-02','from=2026-10-01','status=no','search=x&secret=y'])assert.equal((await askDelivery(x)).status,400);
 assert.equal(opens,closes);console.log('PASS authorization precedes aggregates, forged identity denied, no financial read; empty/partial/full failure, strict validation, closed read-only sessions');
 fs.writeFileSync(path.join(root,'../round6-query-evidence.json'),JSON.stringify({groups:4,queries:[...observedQueries],opens,closes,realDatabase:false},null,2));
}
if(process.argv.includes('--serve')){
 const http=require('node:http');let mode='rich';const requests=[];const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://fixture.invalid');
 if(url.pathname==='/__fixture'){mode=url.searchParams.get('mode')||'rich';res.end('ok');return;}
 if(url.pathname==='/__token'){res.end(await token());return;}
 if(url.pathname==='/__trace'){res.end(JSON.stringify({requests,sql:[...observedQueries],opens,closes,realDatabase:false}));return;}
 if(!['/api/visualization/delivery','/api/visualization/overview'].includes(url.pathname)||req.method!=='GET'){res.writeHead(403);res.end('blocked');return;}
 requests.push({method:req.method,url:req.url,mode});if(mode==='failed'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"SYNTHETIC_FAILURE"}');return;}
 sixth(mode);const fn=url.pathname.endsWith('/delivery')?deliveryGET:GET;const r=await fn(new Request('http://fixture.invalid'+req.url,{headers:{Authorization:req.headers.authorization||''}}));const body=await r.text();const send=()=>{res.writeHead(r.status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);};if(mode==='race'&&url.searchParams.get('status')==='all')setTimeout(send,900);else send();
 });server.listen(43184,'127.0.0.1',()=>console.log('Round6 synthetic real GET ready'));}
else checks().catch(e=>{console.error(e);process.exitCode=1});
