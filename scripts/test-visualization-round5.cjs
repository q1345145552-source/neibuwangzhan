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
const {bucketDays,bucketValue,trendDetail}=require(path.join(root,'components/visualization/trend-model.js'));
const {query:uiQuery,nextDay}=require(path.join(root,'components/visualization/model.js'));
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
async function ask(params) {
 const response=await GET(new Request('http://isolated.invalid/api/visualization/overview?'+params,{headers:{Authorization:'Bearer '+await token()}}));
 return {status:response.status,body:await response.json()};
}
const filter={from:'2025-12-20',end:'2026-02-10',source:'all'};
const sum=items=>items.reduce((n,r)=>n+r.count,0);
async function fifthChecks() {
 fifthData(); let r=await ask(uiQuery(filter));assert.equal(r.status,200);let m=r.body.modules;
 assert.equal(m.orders.data.current.count,138);assert.equal(m.orders.data.period.count,136);assert.equal(m.orders.data.trend.length,53);assert.equal(m.parents.data.period.count,2);
 for(const unit of ['orders','parents'])for(const granularity of ['day','month']) {
  const buckets=bucketDays(m[unit].data.trend,granularity);
  assert.equal(sum(buckets),m[unit].data.period.count);
  for(const bucket of buckets) {
   const spec=trendDetail(bucket,unit,'total','all','全部记录');const details=(await ask(uiQuery(filter,spec))).body.details.data;
   assert.equal(details.total,bucket.count,unit+' '+granularity+' '+bucket.label);
   assert.ok(spec.from>=filter.from&&spec.end<=filter.end);
  }
  if(granularity==='month'){assert.equal(buckets.length,3);assert.deepEqual(buckets.map(b=>b.partialMonth),[true,false,true]);assert.equal(buckets[0].from,'2025-12-20');assert.equal(buckets[2].end,'2026-02-10');}
  console.log('PASS daily/month/overview/detail reconciliation '+unit+' '+granularity);
 }
 const jan=bucketDays(m.orders.data.trend,'month')[1];
 for(const [group,keys] of [['source',Object.keys(jan.sources)],['status',Object.keys(jan.statuses)]])for(const key of keys){const detail=(await ask(uiQuery(filter,trendDetail(jan,'orders',group,key,key)))).body.details.data;assert.equal(detail.total,bucketValue(jan,group,key));}
 console.log('PASS source and real status point subsets; cancelled included and awaiting overlay never added');
 const paged=(await ask(uiQuery(filter,trendDetail(jan,'orders','total','all','全部记录'),2))).body.details.data;assert.equal(paged.total,135);assert.equal(paged.items.length,20);
 // Duplicate rows and identical names are not a new transaction or fulfillment.
 tables.orders.push(clone(tables.orders[0]));tables.sales.push(clone(tables.sales[0]));tables.inbox.push(clone(tables.inbox[0]));tables.orders.forEach(r=>r.customer_name='同名合成主体');
 assert.equal((await ask(uiQuery(filter))).body.modules.orders.data.period.count,136);
 console.log('PASS >100 pagination, duplicate JOIN-like rows and same-name records retain unique IDs');
 fifthData('conflict');r=await ask(uiQuery(filter));assert.equal(r.body.modules.orders.status,'unknown');assert.equal(r.body.modules.orders.data.current.sources.conflict,1);const conflictMonth=bucketDays(r.body.modules.orders.data.trend,'month')[0];assert.equal((await ask(uiQuery(filter,trendDetail(conflictMonth,'orders','source','conflict','来源冲突')))).body.details.data.total,1);
 fifthData('unknown');r=await ask(uiQuery(filter));assert.equal(r.body.modules.orders.data.period.dateUnknownCount,2);assert.equal(r.body.modules.parents.data.period.dateUnknownCount,1);assert.equal(sum(r.body.modules.orders.data.trend),136);assert.equal((await ask(uiQuery(filter,{title:'未知',detail:'orders',subset:'date_unknown'}))).body.details.data.total,2);
 assert.equal((await ask(uiQuery(filter,{title:'Unknown parents',detail:'parents',subset:'date_unknown'}))).body.details.data.total,1);
 console.log('PASS association conflict/invalid date gaps stay distinct from known zero days');
 reset();tables.orders=[order('LEAP','2024-02-28 17:00:00'),order('BAD','2023-02-29 00:00:00'),order('END','2024-03-04 17:00:00')];
 const leap={from:'2024-02-20',end:'2024-03-04',source:'all'};r=await ask(uiQuery(leap));assert.equal(r.body.modules.orders.data.period.count,1);assert.equal(r.body.modules.orders.data.trend.find(p=>p.date==='2024-02-29').count,1);assert.equal(nextDay('2024-02-29'),'2024-03-01');assert.equal(r.body.modules.orders.data.period.dateUnknownCount,1);
 assert.equal((await ask('from=2025-01-01&to=2027-01-01')).status,400);
 console.log('PASS leap year, invalid date, exact exclusive end and invalid oversized range');
 fifthData('empty');r=await ask(uiQuery(filter));assert.equal(r.body.modules.orders.status,'success');assert.equal(r.body.modules.orders.data.trend.length,53);assert.equal(sum(r.body.modules.orders.data.trend),0);
 fifthData('partial');r=await ask(uiQuery(filter));assert.equal(r.body.modules.orders.status,'success');assert.equal(r.body.modules.finances.status,'failed');
 fifthData('trend-failed');r=await ask(uiQuery(filter));assert.equal(r.body.modules.orders.status,'failed');assert.equal(r.body.modules.orders.data,null);
 for(const role of ['employee','client']){fifthData(role);const before=trace.length;r=await ask(uiQuery(filter));assert.equal(r.status,403);assert.ok(!trace.slice(before).some(t=>t.sql===q.orders));}
 console.log('PASS successful zero/partial failure/full trend failure and server-side role denial');
 fs.writeFileSync(path.join(root,'../round5-query-trace.json'),JSON.stringify([...observedQueries],null,2));
}
if(process.argv.includes('--serve')) {
 const http=require('node:http');let mode='rich';const requests=[];
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.invalid');
  if(url.pathname==='/__fixture'){mode=url.searchParams.get('mode')||'rich';res.end('ok');return;}
  if(url.pathname==='/__token'){res.end(await token());return;}
  if(url.pathname==='/__trace'){res.setHeader('content-type','application/json');res.end(JSON.stringify({requests,sql:[...observedQueries],opens,closes,realDatabase:false}));return;}
  if(url.pathname!=='/api/visualization/overview'||req.method!=='GET'){res.writeHead(403);res.end('blocked');return;}
  requests.push({method:req.method,url:req.url,mode});
  if(mode==='failed'){res.writeHead(503,{'content-type':'application/json'});res.end('{"error":"SYNTHETIC_FAILURE"}');return;}
  fifthData(mode);const result=await GET(new Request('http://fixture.invalid'+req.url,{headers:{Authorization:req.headers.authorization||''}}));const body=await result.text();
  const send=()=>{res.writeHead(result.status,{'content-type':'application/json','cache-control':'no-store'});res.end(body);};
  if(mode==='race'&&url.searchParams.get('from')==='2025-12-20')setTimeout(send,850);else send();
 });server.listen(43184,'127.0.0.1',()=>console.log('Fifth-round synthetic SQL service ready 43184'));
}else fifthChecks().catch(error=>{console.error(error);process.exitCode=1});
