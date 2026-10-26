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
let count=0;
async function test(name,fn) { reset(); await fn(); count++; console.log('PASS '+name); }
(async()=>{
await test('T1 T2 T17 real GET + ledger, identical amounts, duplicate rows, cross-period parents',async()=>{
 sale(); tables.orders.push(clone(tables.orders[0])); tables.finances.push(clone(tables.finances[0]));
 const r=await call(); assert.equal(r.status,200); const m=r.body.modules;
 assert.equal(m.orders.data.current.count,2); assert.equal(m.parents.data.current.count,1); assert.equal(m.parents.data.period.count,0); assert.equal(m.orders.data.period.count,2);
 assert.equal(m.finances.data.currentIncome.CNY,10000); assert.equal(m.finances.data.missingVerification.count,2); assert.equal(m.billing.data.currentDue.CNY,0);
 assert.equal(m.finances.data.financialTrend.status,'unsupported'); assert.equal(m.orders.data.details,undefined);
});
await test('T3 conflict maps exactly one order and no duplicated source group',async()=>{
 sale(); tables.parents=[{source_order_no:'S',source:'storefront',created_at:'2026-10-01 00:00:00'}]; tables.inbox=[{id:'x',source_order_no:'S',internal_order_id:'O1',line_no:1,copy_no:1}];
 const m=(await call()).body.modules; assert.equal(m.orders.data.current.count,2); assert.equal(m.orders.data.current.sources.conflict,1); assert.equal(m.orders.data.current.sources.commerce,1); assert.equal(m.billing.status,'unknown');
});
await test('T4 >100 pagination + total/detail agreement, stable order',async()=>{
 tables.orders=Array.from({length:137},(_,i)=>order('O'+String(i).padStart(3,'0'))); const r=await call('&page=2&pageSize=100');
 assert.equal(r.body.modules.orders.data.current.count,137); assert.equal(r.body.modules.parents.data.withoutTrustedParent,137); assert.equal(r.body.details.data.total,137); assert.equal(r.body.details.data.items.length,37); assert.equal(r.body.details.data.items[0].id,'O100');
});
await test('T5 T7 currencies, missing verification and unknown money',async()=>{
 tables.orders=[order('O')]; tables.finances=[{id:1,order_id:'O',type:'income',status:'paid',amount:100,currency:'CNY'},{id:2,order_id:'O',type:'income',status:'paid',amount:500,currency:'THB'},{id:3,order_id:'O',type:'income',status:'paid',amount:20,currency:''},{id:4,order_id:'O',type:'income',status:'待核对',amount:40,currency:'CNY'}];
 const f=(await call()).body.modules.finances; assert.equal(f.status,'unknown'); assert.deepEqual(f.data.currentIncome,{CNY:10000,THB:50000,unknownCount:1}); assert.equal(f.data.awaitingVerification.count,1);
});
await test('T6 strict Bangkok half-open month boundary',async()=>{
 tables.orders=[order('before','2026-09-30 16:59:59'),order('start','2026-09-30 17:00:00'),order('end','2026-10-31T17:00:00Z'),order('bad','2026-02-30 25:00:00')];
 const m=(await call()).body.modules.orders; assert.equal(m.data.current.count,4); assert.equal(m.data.period.count,1); assert.equal(m.data.period.dateUnknownCount,1); assert.equal(m.data.trend[0].date,'2026-10-01'); assert.equal(m.data.trend[0].count,1);
 assert.equal(utcMillis('2026-10-01T00:00:00+07:00'),Date.parse('2026-09-30T17:00:00Z')); assert.equal(utcMillis('2026-02-30 12:00:00'),null);
});
await test('T8 repeat verification/current state is not financial event count',async()=>{
 tables.orders=[order('O')]; tables.finances=[{id:1,order_id:'O',type:'income',status:'paid',amount:100,currency:'CNY',verify_at:'2026-10-05T00:00:00Z',verify_by:'A'}];
 assert.equal((await call()).body.modules.finances.data.currentIncome.CNY,10000); tables.finances[0].verify_at='2026-10-06T00:00:00Z'; assert.equal((await call()).body.modules.finances.data.currentIncome.CNY,10000);
 tables.finances[0].status='未到账'; const f=(await call()).body.modules.finances.data; assert.equal(f.currentIncome.CNY,0); assert.equal(f.notArrived.count,1);
});
await test('T9 T10 cancellation, credits, refunds preserve original ledger',async()=>{
 sale(); tables.orders.forEach(r=>r.status='客户取消'); tables.credits=[{order_id:'O1',credit_cents:5000},{order_id:'O2',credit_cents:5000}]; tables.refunds=[{order_id:'O1',amount_cents:3000,finance_id:3}]; tables.finances.push({id:3,order_id:'O1',type:'expense',status:'paid',currency:'CNY',amount:30});
 let r=await call('&detail=billing'); assert.equal(r.body.modules.finances.data.currentIncome.CNY,10000); assert.equal(r.body.modules.billing.data.currentDue.CNY,0); assert.equal(r.body.details.data.items[0].refundDueCents,7000); assert.equal(r.body.details.data.items[0].refundedCents,3000);
 tables.credits=[]; tables.refunds=[]; tables.receipts=[]; tables.finances=[]; assert.equal((await call()).body.modules.billing.data.currentDue.CNY,10000);
});
await test('mapped receipt status difference is explicit, not a new ledger algorithm',async()=>{sale(); tables.finances[0].status='未到账'; const m=(await call()).body.modules; assert.equal(m.finances.data.currentIncome.CNY,5000); assert.equal(m.billing.data.currentDue.CNY,0); assert.ok(m.billing.gaps.some(r=>r.code==='MAPPED_INCOME_DIFFERS_FROM_PAID'));});
await test('T11 partial query failure does not become zero',async()=>{tables.orders=[order('O','')]; failures.add(q.finances); const m=(await call()).body.modules; assert.equal(m.orders.status,'unknown'); assert.equal(m.finances.status,'failed'); assert.equal(m.finances.data,null); assert.equal(m.pending.status,'success');});
await test('T12 T13 T16 deferred delivery/overdue/outbox explicitly unsupported',async()=>{const m=(await call()).body.modules; for(const k of ['delivery','overdue','exceptions']) assert.equal(m[k].status,'unsupported');});
await test('T14 existing pending categories, multi-owner issue counted once',async()=>{
 tables.employees.push({id:2,name:'A',role:'employee'}); tables.issues=[{id:10,status:'待处理',ticket_number:'SYN',description:'合成',assignee:'A,B,A',created_at:'2026-10-01 00:00:00'}]; tables.todos=[{id:20,assignee:'A',status:'未完成',content:'合成',created_at:'2026-10-01 00:00:00'}];
 const p=(await call('&detail=pending')).body; assert.equal(p.modules.pending.data.current.total,2); assert.equal(p.modules.pending.data.current.counts.issue,1); assert.ok(p.details.data.items.some(r=>r.href==='/issues?open=10'));
});
await test('T15 real runtime auth uses current DB role, not signed/request claimed role',async()=>{
 tables.orders=[order('SECRET')]; tables.employees[0].role='employee'; let r=await call('',await token({id:1,authVersion:1,role:'admin'})); assert.equal(r.status,403); assert.ok(!JSON.stringify(r).includes('SECRET')); assert.equal(trace.filter(r=>r.sql===q.orders).length,0);
 tables.employees[0].role='client'; assert.equal((await call()).status,403); tables.employees[0].role='admin'; tables.employees[0].auth_version=2; assert.equal((await call()).status,401);
});
await test('T15 revoked/forced-password/invalid JWT + bad filter validation',async()=>{
 assert.equal((await call('','invalid')).status,401); assert.equal((await call('',await token({id:1,authVersion:'1'}))).status,401); tables.employees[0].must_change_password=1; assert.equal((await call()).status,401); tables.employees[0].must_change_password=0;
 for(const value of ['&role=admin','&page=0','&source=bad','&from=2026-02-30','&pageSize=101']) assert.equal((await call(value)).status,400);
});
await test('query failure module privacy; source filter same aggregation/details',async()=>{
 sale(); tables.orders.push(order('local')); const r=await call('&source=local'); assert.equal(r.body.modules.orders.data.current.count,1); assert.equal(r.body.details.data.total,1); assert.equal(r.body.modules.finances.data.currentIncome.CNY,0);
 failures.add(q.orders); const f=await call(); assert.equal(f.body.modules.orders.status,'failed'); assert.equal(f.body.details.status,'failed'); assert.ok(!JSON.stringify(f).includes('SYNTHETIC_QUERY_FAILURE'));
});
await test('read facade rejects write SQL and has no write methods',async()=>{
 const connection=new FakeDatabase('/synthetic/data.db',{readonly:true,fileMustExist:true}); const reader=readOnlyReader(connection); for(const sql of ['DELETE FROM orders','SELECT 1; DELETE FROM orders','PRAGMA journal_mode=WAL','SELECT 1 --x']) assert.throws(()=>reader.all(sql)); for(const k of ['run','exec','transaction','prepare']) assert.equal(reader[k],undefined); connection.close();
});
await test('period detail total matches period count without filtering stock',async()=>{tables.orders=[order('old','2026-09-01 00:00:00'),order('new')]; const r=await call('&basis=period'); assert.equal(r.body.modules.orders.data.current.count,2); assert.equal(r.body.modules.orders.data.period.count,1); assert.equal(r.body.details.data.total,1); assert.equal((await call('&basis=period&detail=finances')).status,400);});
await test('invalid money, missing relation and malformed auth state do not become known totals',async()=>{sale(); tables.finances[0].amount=0.001; const m=(await call()).body.modules; assert.equal(m.finances.status,'unknown'); assert.equal(m.billing.status,'unknown'); assert.equal(m.billing.data.currentDue.unknownCount,1); tables.employees[0].status='离职'; assert.equal((await call()).status,401);});
assert.equal(opens,closes);
console.log(JSON.stringify({passed:count,opens,closes,realDriverLoaded:false,networkAllowed:false,writeSqlAllowed:false}));
fs.writeFileSync(path.join(root,'../sample-response.json'),JSON.stringify((await call()).body,null,2));
fs.writeFileSync(path.join(root,'../query-trace.json'),JSON.stringify([...observedQueries].map(sql=>({sql,source:'interpreted synthetic tables; no SQLite'})),null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
