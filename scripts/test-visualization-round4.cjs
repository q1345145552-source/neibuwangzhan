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
function query(sql, args) {
  if (!/^\s*SELECT\b/i.test(sql) || /;|--|\/\*/.test(sql)) throw Error('WRITE_OR_NONSELECT_BLOCKED');
  trace.push({sql,args}); observedQueries.add(sql);
  if (failures.has(sql)) throw Error('SYNTHETIC_QUERY_FAILURE_NO_REAL_DATA');
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
async function fourthChecks() {
 rich(); let r=await call(); assert.equal(r.body.modules.orders.data.current.count,138); assert.equal(r.body.modules.orders.data.period.count,137); assert.equal(r.body.modules.parents.data.period.count,0);
 const checks=[['&subset=income_paid&detail=finances',3],['&subset=income_waiting&detail=finances',1],['&subset=income_not_arrived&detail=finances',1],['&subset=missing_verification&detail=finances',2],['&subset=cost&detail=finances',1],['&subset=refund&detail=finances',1],['&subset=income_paid&currency=CNY&detail=finances',2],['&subset=awaiting',1],['&subset=without_parent',135],['&category=issue&detail=pending',23],['&category=todo&detail=pending',1],['&status=客户取消',20],['&source=commerce',2],['&basis=period',137]];
 for(const [qs,expected] of checks) { const body=(await call(qs)).body; assert.equal(body.details.data.total,expected,qs); console.log('PASS exact subset '+qs+' => '+expected); }
 r=await call('&detail=parents'); assert.equal(r.body.details.data.items[0].fulfillments.length,2);
 rich('unknown'); r=await call('&subset=income_paid&detail=finances'); assert.equal(r.body.modules.finances.data.currentIncome.unknownCount,2); assert.equal(r.body.details.data.total,5); assert.equal(r.body.details.data.items.filter(row=>row.amount_valid===false).length,1); assert.equal((await call('&subset=date_unknown')).body.details.data.total,1);
 for(const qs of ['&subset=cost','&category=unknown&detail=pending','&currency=USD&detail=finances','&status=bad','&subset=awaiting&detail=parents']) assert.equal((await call(qs)).status,400);
 rich('mismatch'); assert.ok((await call()).body.modules.billing.gaps.some(g=>g.code==='MAPPED_INCOME_DIFFERS_FROM_PAID'));
 console.log('PASS fourth-round unknown fields, source/end-day/parent cross-period, validation and ledger difference');
}
if(process.argv.includes('--serve')) {
 const http=require('node:http'); let mode='rich'; const requests=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  if(url.pathname==='/__fixture') { mode=url.searchParams.get('mode')||'rich';res.end('ok'); return; }
  if(url.pathname==='/__token') { res.end(await token());return; }
  if(url.pathname==='/__trace') {res.setHeader('content-type','application/json');res.end(JSON.stringify({requests,sql:[...observedQueries],opens,closes,realDatabase:false}));return;}
  if(url.pathname!=='/api/visualization/overview'||req.method!=='GET') {res.writeHead(403);res.end('blocked');return;}
  requests.push({method:req.method,url:req.url,mode});
  if(mode==='failed'){res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({error:'SYNTHETIC_UNAVAILABLE'}));return;}
  rich(mode);
  const response=await GET(new Request('http://fixture.invalid'+req.url,{headers:{Authorization:req.headers.authorization||''}}));
  const body=await response.text();
  const send=()=>{res.writeHead(response.status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);};
  if(mode==='race'&&url.searchParams.get('from')==='2026-09-01')setTimeout(send,900);else send();
 });
 server.listen(43184,'127.0.0.1',()=>console.log('Synthetic SQL-backed real GET fixture on 127.0.0.1:43184'));
} else fourthChecks().catch(error=>{console.error(error);process.exitCode=1});
