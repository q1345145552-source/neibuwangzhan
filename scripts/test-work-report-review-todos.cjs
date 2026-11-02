// Actual review/resubmit/todo/pending handlers, memory-only SQLite. No application data or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{createHarness,load}=require('./test-work-report-seen.cjs');
function createReviewHarness(){const h=createHarness();
 const schema=fs.readFileSync(path.join(__dirname,'../src/lib/db.ts'),'utf8');
 for(const table of ['leave_requests','attendance_requests','notice_rules','notice_rule_implementations','meetings','meeting_reflections','problems','issue_tickets','todo_categories','todo_follow_ups','todo_images']){
  const match=schema.match(new RegExp('CREATE TABLE IF NOT EXISTS '+table+' \\([\\s\\S]*?\\n\\s*\\)(?=;|\\n)'));assert(match,table);try{h.native.exec(match[0]);}catch(e){console.error(table,match[0]);throw e;}
 }
 const translation=load('src/lib/todo-translation.ts',{'node:crypto':require('node:crypto')});
 const deps={...h.deps,fs,path:{default:path},os:{default:os},'@/lib/uploads':{uploadsDir:'/tmp/unused-review-fixture'},'@/lib/announcement-overdue':{syncAnnouncementOverdueTodos(){}},'@/lib/todo-translation':translation};
 const todoRoute=load('src/app/api/todos/[id]/route.ts',deps),listRoute=load('src/app/api/todos/route.ts',deps),pendingRoute=load('src/app/api/boss-supervision/pending/route.ts',deps);
 const call=async(route,method='GET',body,id)=>{const response=await route[method](new Request('http://fixture/api/test',{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})}),{params:Promise.resolve({id:String(id)})});return{status:response.status,body:await response.json()};};
 return {...h,callRoute:call,todoRoute,listRoute,pendingRoute};
}
async function run(){const h=createReviewHarness();const{callRoute:call,todoRoute,listRoute,pendingRoute}=h;try{
 const review=(rating=4,comment='请补充客户跟进',revision='version-1',id=1)=>h.call('item','PATCH',{action:'review',rating,comment,submission_revision:revision},id);
 const tasks=()=>h.native.prepare("SELECT * FROM todos WHERE source_type='work_report_review' ORDER BY id").all();
 const notices=()=>h.native.prepare("SELECT * FROM notifications WHERE type='待办指派' ORDER BY id").all();
 const before=()=>JSON.stringify({tasks:tasks(),notifications:h.native.prepare('SELECT * FROM notifications').all(),reports:h.native.prepare('SELECT * FROM work_reports').all(),states:h.native.prepare('SELECT * FROM boss_submission_state').all(),audit:h.native.prepare('SELECT * FROM audit_logs').all()});
 const normal=h.native.prepare("INSERT INTO todos(content,assignee) VALUES ('手工待办','Bam')").run().lastInsertRowid;
 const missing=h.native.prepare("INSERT INTO todos(content,assignee,source_type,source_id) VALUES ('补交日报','Bam','work_report',?)").run(h.date).lastInsertRowid;
 const untouched=()=>JSON.stringify(h.native.prepare('SELECT * FROM todos WHERE id IN (?,?) ORDER BY id').all(normal,missing)),original=untouched();
 assert.equal((await review()).status,200);let todo=tasks()[0];assert.equal(tasks().length,1);assert.equal(todo.source_id,'1');assert.equal(todo.source_revision,'version-1');assert.equal(todo.assignee,'Bam');assert.equal(todo.priority,'紧急');assert.equal(todo.status,'未完成');assert.match(todo.content,/10月29日.*4 星/);assert.match(todo.content,/请补充客户跟进/);assert.equal(notices().length,1);assert.equal(notices()[0].recipient,'Bam');assert.equal(notices()[0].related_id,String(todo.id));assert.equal(notices()[0].related_type,'todo');assert.throws(()=>h.native.prepare("INSERT INTO todos(content,assignee,source_type,source_id) VALUES ('重复','Bam','work_report_review','1')").run(),/UNIQUE/);
 assert((await call(pendingRoute)).body.items.some(t=>t.id==='todo:'+todo.id));
 h.native.prepare("UPDATE todos SET content_zh='旧译',content_zh_key='旧键',seen_at='已看' WHERE id=?").run(todo.id);
 assert.equal((await review(5,'最新点评')).status,200);assert.equal(tasks().length,1);assert.match(tasks()[0].content,/5 星.*\n点评：最新点评/);assert.equal(tasks()[0].content_zh,'');assert.equal(tasks()[0].content_zh_key,'');assert.equal(tasks()[0].seen_at,'');assert.equal(notices().length,1);
 assert.equal((await review(5,'最新点评')).status,200);assert.equal(tasks().length,1);assert.equal(notices().length,1);
 h.setActor({id:1,name:'Bam',role:'employee'});assert((await call(listRoute)).body.some(t=>t.id===todo.id));assert.equal((await call(todoRoute,'PATCH',{status:'已完成'},todo.id)).status,200);assert.equal(tasks()[0].status,'已完成');assert(tasks()[0].completed_at);
 assert(h.native.prepare("SELECT 1 FROM notifications WHERE related_type='boss_submission' AND related_id=?").get('todo:'+todo.id));
 h.setActor({id:4,name:'老板',role:'admin'});assert(!(await call(pendingRoute)).body.items.some(t=>t.id==='todo:'+todo.id));assert.equal((await call(listRoute)).body.find(t=>t.id===todo.id).status,'已完成');
 const finished=JSON.stringify(tasks()[0]);assert.equal((await review(2,'同轮改点评不重开')).status,200);assert.equal(JSON.stringify(tasks()[0]),finished);assert.equal(notices().length,1);
 assert.equal((await call(todoRoute,'PATCH',{action:'confirm'},todo.id)).status,200);
 assert.equal((await h.call('item','PATCH',{action:'reject',rejection_reason:'重写',submission_revision:'version-1'})).status,200);
 h.setActor({id:1,name:'Bam',role:'employee'});const resubmitted=await h.call('item','PATCH',{completed_items:['重新补充内容'],summary:'重交总结'});assert.equal(resubmitted.status,200);const revision=resubmitted.body.submitted_at;assert.notEqual(revision,'version-1');assert.equal(tasks()[0].status,'已完成');
 h.setActor({id:4,name:'老板',role:'admin'});assert.equal((await review(3,'重交后的新点评',revision)).status,200);assert.equal(tasks().length,1);todo=tasks()[0];assert.equal(todo.status,'未完成');assert.equal(todo.completed_at,'');assert.equal(todo.source_revision,revision);assert.match(todo.content,/3 星.*\n点评：重交后的新点评/);assert.equal(notices().length,2);assert.equal(h.native.prepare("SELECT confirmed_at FROM boss_submission_state WHERE category='todo' AND source_id=?").get(todo.id).confirmed_at,'');assert((await call(pendingRoute)).body.items.some(t=>t.id==='todo:'+todo.id));
 const snapshot=before();assert.equal((await review(1,'旧版','version-1')).status,409);assert.equal(before(),snapshot);
 h.fail(true);await assert.rejects(review(4,'事务失败',revision),/commit failure/);h.fail(false);assert.equal(before(),snapshot);
 // New submission while its existing task is still open: update the same task and notify once.
 h.native.prepare("UPDATE work_reports SET submitted_at='version-3' WHERE id=1").run();assert.equal((await review(4,'第三轮','version-3')).status,200);assert.equal(tasks().length,1);assert.equal(notices().length,3);assert.equal(tasks()[0].status,'未完成');
 // A different report is independent, even on the same date; failed first creation rolls back everything.
 const beforeNew=before();h.native.exec("CREATE TEMP TRIGGER fail_review_notice BEFORE INSERT ON notifications WHEN NEW.type='待办指派' BEGIN SELECT RAISE(ABORT,'fixture notification failed'); END");try{await assert.rejects(review(5,'通知失败','version-1',2),/fixture notification failed/);assert.equal(before(),beforeNew);}finally{h.native.exec('DROP TRIGGER fail_review_notice');}h.fail(true);await assert.rejects(review(5,'首次失败','version-1',2),/commit failure/);h.fail(false);assert.equal(before(),beforeNew);assert.equal((await review(5,'另一员工','version-1',2)).status,200);assert.equal(tasks().length,2);assert.equal(tasks()[1].assignee,'Ing');assert.equal(tasks()[1].source_id,'2');
 for(const actor of [null,{id:1,name:'Bam',role:'employee'},{id:9,name:'客户',role:'client'}]){h.setActor(actor);const snapshot=before();assert.equal((await review()).status,actor?403:401);assert.equal(before(),snapshot);}
 h.setActor({id:2,name:'Ing',role:'employee'});assert.equal((await call(todoRoute,'PATCH',{status:'已完成'},todo.id)).status,403);assert(!(await call(listRoute)).body.some(t=>t.id===todo.id));
 assert.equal(untouched(),original);
 console.log('PASS actual review -> one urgent source-linked employee todo+notice; same-version update/dedup and completed preservation; employee completion/admin list/pending+completion notice; resubmit reopens and resets confirmation; independent reports and supplement tasks; role guards; atomic rollback on create/update; translation cache invalidation.');
 }finally{h.native.close();}}
module.exports={run,createReviewHarness};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
