#!/usr/bin/env node
// Real handlers + mock queries only. No real DB, AI, review, sync or notification.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {createNoticeHarness}=require('./test-chat-notice-card.cjs');
const root=path.resolve(__dirname,'..');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,Response,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Unexpected dependency: '+name);}});return exports;}
function createReportHarness(){
 const base=createNoticeHarness();let actor={id:2,role:'employee',name:'员工甲'};
 const report=(id,employee_name,report_date,status='已提交',boss_rating=0)=>({id,employee_name,report_date,status,boss_rating,boss_comment:boss_rating?'私密点评':'',
  completed_items:'["私密已完成内容"]',completed_items_zh:'',summary:'私密总结',summary_zh:'',tomorrow_plan:'私密计划',tomorrow_plan_zh:'',problems:'私密问题',problems_zh:'',
  related_objects:'[]',ai_label:'',ai_comment:'',risk_flag:0,risk_desc:'',is_backfill:0,submitted_at:report_date+'T10:00:00.000Z',created_at:report_date+' 10:00:00'});
 const reports=[report(1501,'员工甲','2026-10-20'),report(1502,'员工甲','2024-02-10','已提交',5),report(1503,'员工甲','2024-01-01','退回'),
  report(1504,'员工乙','2024-02-10'),report(1505,'已离职员工丙','2023-01-01'),report(1506,'员工甲','2024-02-11')];
 const project=(sql,row)=>{if(!row)return undefined;if(/SELECT \*/.test(sql))return {...row};return Object.fromEntries(sql.match(/SELECT ([\s\S]+?) FROM work_reports/)[1].split(',').map(k=>k.trim()).map(k=>[k,row[k]]));};
 const db={prepare(sql){
  if(sql.includes("SELECT name FROM employees WHERE role = 'employee'"))return{all(){base.reads.push(sql);return[{name:'员工甲'},{name:'员工乙'}];}};
  if(!sql.includes('FROM work_reports'))return base.db.prepare(sql);
  return{
   get(...args){base.reads.push(sql);if(actor.role!=='admin')assert(/employee_name\s*=\s*\?/.test(sql)&&args[1]===actor.name);return project(sql,reports.find(r=>r.id===args[0]&&(!/employee_name\s*=\s*\?/.test(sql)||r.employee_name===args[1])));},
   all(...args){base.reads.push(sql);
    if(sql.includes('WHERE report_date = ?'))return reports.filter(r=>r.report_date===args[0]).map(r=>({...r}));
    if(actor.role!=='admin')assert(/employee_name\s*=\s*\?/.test(sql)&&args[0]===actor.name);
    if(!/SELECT \*/.test(sql))assert(!/summary|completed_items|boss_comment|boss_rating|JOIN|LIMIT/.test(sql));
    return reports.filter(r=>!sql.includes('WHERE employee_name')||r.employee_name===args[0]).map(r=>project(sql,r));},
   run(){throw Error('No report/business writes allowed');}
  };
 }};
 const helper=load('src/lib/chat-report-card.ts');
 const forbidden=()=>{throw Error('No review, AI, notification or sync allowed');};
 const deps={'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/auth':{verifyAuth:async()=>actor,isStaff:auth=>['admin','employee'].includes(auth.role)},
  '@/lib/db':{getDb:()=>db,logOperation:forbidden},'@/lib/notification-types':load('src/lib/notification-types.ts',{'./boss-submission-types':load('src/lib/boss-submission-types.ts'),'./announcement-feedback':load('src/lib/announcement-feedback.ts')}),'@/lib/chat-direct-message': load('src/lib/chat-direct-message.ts'), '@/lib/chat-todo-issue-card': load('src/lib/chat-todo-issue-card.ts'), '@/lib/req':{readJson:req=>req.json()},'@/lib/chat-meeting-card':load('src/lib/chat-meeting-card.ts',{'./meeting-todos':load('src/lib/meeting-todos.ts',{'./boss-submissions':{}})}), '@/lib/chat-report-card':helper,
  '@/lib/chat-leave-card':load('src/lib/chat-leave-card.ts'),'@/lib/chat-attendance-card':load('src/lib/chat-attendance-card.ts'),'@/lib/chat-notice-card':load('src/lib/chat-notice-card.ts'),
  '@/lib/boss-submissions':{publishBossSubmission:forbidden,acknowledgeBossSubmission:forbidden},'@/lib/boss-submission-types':load('src/lib/boss-submission-types.ts'),
  '@/lib/work-report-sync':{completeWorkReportTodos:forbidden,pendingWorkReportDates:()=>[]},'@/lib/deepseek':{analyzeWorkReport:forbidden},'@/lib/work-report-items':load('src/lib/work-report-items.ts'),
  '@/lib/time':{bangkokToday:()=> '2026-10-20'}};
 const routes=Object.fromEntries(Object.entries({candidates:'chat/share-items',direct:'chat',group:'chat/group-messages',groups:'chat/groups',detail:'work-reports/[id]',list:'work-reports',board:'work-reports/board'})
  .map(([key,file])=>[key,load(`src/app/api/${file}/route.ts`,deps)]));
 return{...base,reports,db,helper,routes,setActor(value){actor=value;base.setActor(value);},async call(route,method='GET',body,id,query=''){
  const req=new Request('http://mock/api/'+route+query,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  const response=await routes[route][method](req,{params:Promise.resolve({id:String(id)})});return{response,status:response.status,body:await response.json()};
 }};
}
async function run(){
 const h=createReportHarness();
 for(const actor of [null,{id:9,role:'client',name:'客户'}]){h.setActor(actor);for(const [r,m,b,id,q]of[['candidates','GET',null,null,'?type=report'],['detail','GET',null,1501],['list','GET'],['direct','POST',{other:'老板',card_type:'report',card_id:'1501'}],['group','POST',{group_id:20,card_type:'report',card_id:'1501'}]])assert.equal((await h.call(r,m,b,id,q)).status,actor?403:401);}
 assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);h.setActor({id:2,role:'employee',name:'员工甲'});
 let r=await h.call('candidates','GET',null,null,'?type=report&employee=员工乙');assert.equal(r.status,200);assert.deepEqual(r.body.map(c=>c.id),['1501','1502','1503','1506']);assert(!JSON.stringify(r.body).includes('私密'));assert.deepEqual(Object.keys(r.body[0]).sort(),['id','status','subtitle','title']);
 for(const id of [1501,1502,1503,1506]){r=await h.call('detail','GET',null,id);assert.equal(r.body.id,id);assert.equal(r.response.headers.get('cache-control'),'private, no-store');}
 for(const id of [1504,1505,99999])assert.equal((await h.call('detail','GET',null,id)).status,404);
 for(const id of ['0','-1','NaN','9007199254740992'])assert.equal((await h.call('detail','GET',null,id)).status,400);
 assert.equal((await h.call('board')).status,403);assert.equal(h.writes.length,0);
 console.log('PASS minimal own candidates and original name-based read permissions; true report IDs/dates, same employee across dates, reviewed/returned states, other employee and client denial; no read side effects');
 for(const route of ['direct','group']){
  const scope=route==='direct'?{other:'老板'}:{group_id:20};const before=h.writes.length;
  for(const id of ['1504','1505','99999','2024-02-10','1e3','01'])assert.equal((await h.call(route,'POST',{...scope,card_type:'report',card_id:id,employee_name:'员工乙'})).status,404);assert.equal(h.writes.length,before);
  for(const id of ['1501','1502','1503','1506']){r=await h.call(route,'POST',{...scope,card_type:'report',card_id:id,content:'伪造正文',title:'错误日期'});assert.equal(r.status,201);assert.equal(r.body.message.order_id,'report:'+id);const c=JSON.parse(r.body.message.content);assert.deepEqual(Object.keys(c).sort(),['subtitle','title']);assert(c.title.includes(h.reports.find(r=>r.id===Number(id)).report_date));assert(!JSON.stringify(c).includes('私密')&&!JSON.stringify(c).includes('伪造'));}
  for(const type of ['order','todo','project','customer','vat','wht','problem','issue','leave','attendance','notice'])assert.equal((await h.call(route,'POST',{...scope,card_type:type,card_id:type==='order'?'ORD-1':type==='leave'||type==='notice'?'1001':type==='attendance'?'1101':'1'})).status,201,type);
 }
 assert(h.previews.includes('[日报]'));await h.call('group','POST',{group_id:20,card_type:'report',card_id:'1502'});assert.equal((await h.call('groups')).body[0].last_preview,'[日报]');
 const before=h.writes.length;h.setMember(false);assert.equal((await h.call('group','POST',{group_id:20,card_type:'report',card_id:'1501'})).status,403);h.setMember(true);h.setActive(false);for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'老板'}:{group_id:20}),card_type:'report',card_id:'1501'})).status,403);h.setActive(true);assert.equal(h.writes.length,before);
 h.setActor({id:1,role:'admin',name:'老板'});assert.equal((await h.call('candidates','GET',null,null,'?type=report')).body.length,6);assert.equal((await h.call('detail','GET',null,1505)).body.employee_name,'已离职员工丙');
 assert.equal((await h.call('board','GET',null,null,'?date=2023-01-01')).body.employees.some(e=>e.name==='已离职员工丙'),false);
 for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'员工甲'}:{group_id:20}),card_type:'report',card_id:'1505'})).status,201);
 console.log('PASS canonical report snapshots in both real POST handlers, active/member/owner guards, original eleven card types, archived employee history visible to admin without expanding ordinary board; no review/return/viewed/notification writes');
 const page=fs.readFileSync(path.join(root,'src/app/(app)/messages/page.tsx'),'utf8'),exports={};vm.runInNewContext(ts.transpileModule(page.slice(page.indexOf('// ── 分享卡片'),page.indexOf('// ── AI 总结'))+'\nObject.assign(exports,{CARD_META,SHARE_CATEGORIES,parseCard,quotePreview});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports});
 assert.equal(exports.SHARE_CATEGORIES.length,13);const m={order_id:'report:1502',content:JSON.stringify({title:'员工甲 2024-02-10 日报 #1502',subtitle:'已提交'})};assert.equal(exports.parseCard(m).kind,'report');assert.equal(exports.quotePreview(m),'[日报] 员工甲 2024-02-10 日报 #1502');assert.equal(exports.CARD_META.report.href('1502'),'/work-reports?report=1502');
 console.log('PASS thirteen categories, report parser/quote and exact URL. No database imported or opened.');
}
module.exports={createReportHarness};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1;});
