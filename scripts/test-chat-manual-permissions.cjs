#!/usr/bin/env node
// Actual handlers with isolated query objects only; no driver, real data or network.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {createTaskHarness}=require('./test-chat-task-message.cjs'),root=path.resolve(__dirname,'..');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,Response,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Unexpected dependency '+name);}});return exports;}
function createManualHarness(){
 const base=createTaskHarness();let actor=base.people[1],syncCalls=0,dbCalls=0;const reads=new Set(),extraWrites=[],members=new Set(['老板','员工甲','员工乙','员工_甲','员工']);
 base.people.push({id:21,name:'员工_甲',role:'employee',status:'在职'},{id:22,name:'员工',role:'employee',status:'在职'});
 const todo=(id,assignee,status='未完成',created_by='老板')=>({id,assignee,status,created_by,content:'真实待办摘要 '+id,priority:'普通',created_at:'2024-01-01T01:00:00Z'});
 base.rows.todos.splice(0,base.rows.todos.length,todo(601,'员工甲'),todo(602,'老板'),todo(603,'员工乙','未完成','员工甲'),todo(604,'员工甲','已完成'),todo(605,''),todo(606,'员工甲乙'),todo(607,'员工_甲'),todo(608,'员工A甲'),{...todo(609,'员工甲'),source_type:'meeting',source_id:'84'});
 const issue=(id,assignee,created_by='老板',status='待处理')=>({id,assignee,created_by,status,ticket_number:'TK-'+id,description:'私密工单摘要 '+id,description_zh:'中文工单摘要 '+id,ref_id:'',ref_type:'order',images:'[]',priority:'medium',created_at:'2024-01-01T01:00:00Z'});
 base.rows.issue_tickets.splice(0,base.rows.issue_tickets.length,issue(801,'员工乙,员工甲'),issue(802,'员工乙','员工甲','处理中'),issue(803,'员工丙','员工乙'),issue(804,'员工甲,员工甲','老板','已解决'),issue(805,'员工甲乙','老板','已解决'),issue(806,'员工_甲'),issue(807,'员工A甲'),issue(808,' 员工乙 , 员工甲 ','老板','处理中'),issue(809,null,'员工甲','已解决'),issue(810,null,'老板','已解决'),issue(811,'员工乙','员工甲乙'),issue(812,'员工乙','员工_甲'));
 const db={...base.db,prepare(sql){const fallback=base.db.prepare(sql);return{
  get(...a){
   if(sql.includes('FROM chat_groups'))return a[0]===20?{id:20,name:'模拟群',owner:'老板'}:undefined;
   if(sql.includes('COUNT(*) AS c FROM group_members'))return{c:members.size};
   if(sql.includes('FROM group_members'))return a[0]===20&&members.has(a[1])?{id:1}:undefined;
   if(sql.includes('FROM employees')&&sql.includes('status IN'))return base.people.find(p=>p.name===a[0]&&['admin','employee'].includes(p.role)&&['在职','试用期','待离职'].includes(p.status));
   return fallback.get(...a);
  },
  all(...a){
   if(sql.includes('FROM todos t'))return base.rows.todos.filter(t=>!sql.includes('WHERE t.assignee = ?')||t.assignee===a[0]).map(t=>({...t}));
   if(sql.includes('FROM todo_images'))return[];
   if(sql.startsWith('SELECT * FROM issue_tickets WHERE 1=1')){assert(!sql.includes('LIKE'));let i=0,rows=base.rows.issue_tickets;if(sql.includes('AND status = ?')){const v=a[i++];rows=rows.filter(r=>r.status===v);}if(sql.includes('AND assignee = ?')){const v=a[i++];rows=rows.filter(r=>r.assignee===v);}if(sql.includes('AND created_by = ?')){const v=a[i++];rows=rows.filter(r=>r.created_by===v);}return rows.map(r=>({...r}));}
   if(sql.startsWith('SELECT member FROM group_members'))return [...members].map(member=>({member}));
   if(sql.includes('FROM message_reads mr'))return [...reads].map(k=>{const[id,member]=k.split(':');return{message_id:Number(id),member};}).filter(r=>base.messages.find(m=>m.id===r.message_id)?.group_id===a[0]);
   if(sql.includes('FROM message_mentions'))return[];
   if(sql.includes('FROM messages WHERE group_id'))return base.messages.filter(m=>m.group_id===a[0]&&(!sql.includes('id > ?')||m.id>a[1])&&(!sql.includes('recalled = 1')||m.recalled===1));
   return fallback.all(...a);
  },
  run(...a){
   if(sql.startsWith('INSERT INTO messages (group_id,')){extraWrites.push(sql);const[group_id,sender,receiver,content,image_url,order_id,reply_to,reply_preview,created_at]=a;const m={id:(base.messages.at(-1)?.id||0)+1,conversation_id:null,group_id,sender,receiver,content,image_url,order_id,reply_to,reply_preview,created_at,is_read:0,recalled:0};base.messages.push(m);return{lastInsertRowid:m.id};}
   if(sql.startsWith('INSERT OR IGNORE INTO message_reads')){extraWrites.push(sql);if(sql.includes('SELECT id'))for(const m of base.messages.filter(m=>m.group_id===a[1]))reads.add(m.id+':'+a[0]);else reads.add(a[0]+':'+a[1]);return{};}
   if(sql.startsWith('INSERT OR IGNORE INTO message_mentions')||sql.startsWith('UPDATE message_mentions')){extraWrites.push(sql);return{};}
   return fallback.run(...a);
  }
 };}};
 const owned=load('src/lib/chat-todo-issue-card.ts');
 const deps={'next/server':{NextResponse:{json:(b,i)=>Response.json(b,i)}},'@/lib/auth':{verifyAuth:async()=>actor,isStaff:a=>['admin','employee'].includes(a.role)},'@/lib/db':{getDb:()=>{dbCalls++;return db;},logOperation(){throw Error('Business writes forbidden');}},'@/lib/req':{readJson:r=>r.json()},'@/lib/chat-todo-issue-card':owned,'@/lib/chat-direct-message':load('src/lib/chat-direct-message.ts'),'@/lib/announcement-overdue':{syncAnnouncementOverdueTodos(){syncCalls++;}}};
 for(const name of ['leave','attendance','notice','report','meeting'])deps['@/lib/chat-'+name+'-card']=load('src/lib/chat-'+name+'-card.ts',name==='meeting'?{'./meeting-todos':load('src/lib/meeting-todos.ts',{'./boss-submissions':{}})}:{});
 const routes=Object.fromEntries(Object.entries({direct:'chat',group:'chat/group-messages',todos:'todos',issues:'issues'}).map(([k,p])=>[k,load('src/app/api/'+p+'/route.ts',deps)]));
 return{base,db,reads,members,extraWrites,owned,get dbCalls(){return dbCalls;},get syncCalls(){return syncCalls;},get actor(){return actor;},setActor(a){actor=a;base.setActor(a);},state(){return JSON.stringify({messages:base.messages,conversations:base.conversations,reads:[...reads].sort(),extraWrites,writes:base.writes});},
  async call(key,method='POST',body,query=''){const response=await routes[key][method](new Request('http://mock/api/'+key+query,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}));return{status:response.status,body:await response.json(),response};}
 };
}
async function run(){
 const h=createManualHarness(),scope=kind=>kind==='direct'?{other:'员工乙'}:{group_id:20};
 const denied=async(kind,type,id,extras={})=>{const before=h.state(),r=await h.call(kind,'POST',{...scope(kind),card_type:type,card_id:String(id),role:'admin',name:'老板',employee_name:'老板',assignee:h.actor?.name,created_by:h.actor?.name,content:'伪造摘要',...extras});assert.equal(r.status,404,`${kind} ${type}:${id}`);assert.equal(r.body.error,'分享条目不存在或无权分享');assert.equal(h.state(),before,'Denied sharing cannot create messages/conversation or update preview/reads');assert(!JSON.stringify(r.body).includes('摘要'));return r;};
 for(const a of [null,h.base.people[5]]){h.setActor(a);for(const kind of ['direct','group']){const before=h.state();assert.equal((await h.call(kind,'POST',{...scope(kind),card_type:'todo',card_id:'601'})).status,a?403:401);assert.equal(h.state(),before);}}assert.equal(h.dbCalls,0);
 h.setActor(h.base.people[0]);
 for(const kind of ['direct','group'])for(const [type,rows]of[['todo',h.base.rows.todos],['issue',h.base.rows.issue_tickets]])for(const row of rows){const n=h.base.messages.length,r=await h.call(kind,'POST',{...scope(kind),card_type:type,card_id:String(row.id),content:'伪造摘要'});assert.equal(r.status,201);assert.equal(h.base.messages.length,n+1);assert.equal(r.body.message.order_id,type+':'+row.id);assert.equal(JSON.parse(r.body.message.content).title,type==='todo'?row.content:row.ticket_number);}
 h.setActor(h.base.people[1]);
 for(const kind of ['direct','group']){
  for(const id of [601,604,609])assert.equal((await h.call(kind,'POST',{...scope(kind),card_type:'todo',card_id:String(id)})).status,201);
  for(const id of [801,802,804,808,809])assert.equal((await h.call(kind,'POST',{...scope(kind),card_type:'issue',card_id:String(id)})).status,201);
  for(const id of [602,603,605,606,607,608])await denied(kind,'todo',id);
  for(const id of [803,805,806,807,810,811,812])await denied(kind,'issue',id);
  for(const type of ['todo','issue'])for(const id of ['99999','0','-1','01','1e3','1.5','NaN','9007199254740992','601 OR 1=1'])await denied(kind,type,id);
 }
 await denied('direct','todo',602,{other:'员工丙'});
 console.log('PASS actual direct/group sends: admin all states; employee exact own unfinished/completed/system todo, creator/single/multiple/not-first/duplicate/space-padded issue; unauthorized/missing/malformed/forged ownership denied with identical generic error and zero message/conversation/preview/read changes.');
 const original=JSON.stringify(h.base.rows);
 let r=await h.call('todos','GET');assert.deepEqual(r.body.map(r=>r.id),[601,604,609]);r=await h.call('issues','GET',null,'?role=admin&assignee=员工乙&created_by=老板');assert.deepEqual(r.body.map(r=>r.id),[801,802,804,808,809]);
 const underscore=h.base.people.find(p=>p.name==='员工_甲');h.setActor(underscore);
 assert.deepEqual((await h.call('todos','GET')).body.map(r=>r.id),[607]);assert.deepEqual((await h.call('issues','GET')).body.map(r=>r.id),[806,812]);
 for(const kind of ['direct','group']){assert.equal((await h.call(kind,'POST',{...scope(kind),card_type:'issue',card_id:'806'})).status,201);await denied(kind,'issue',807);await denied(kind,'todo',608);}
 h.setActor(h.base.people.find(p=>p.name==='员工'));for(const kind of ['direct','group']){await denied(kind,'issue',805);await denied(kind,'todo',606);}assert.deepEqual((await h.call('issues','GET')).body,[]);
 h.setActor(h.base.people[0]);r=await h.call('issues','GET',null,'?status=已解决&assignee=员工甲%2C员工甲&created_by=老板');assert.deepEqual(r.body.map(r=>r.id),[804]);assert.equal((await h.call('todos','GET')).body.length,h.base.rows.todos.length);assert.equal(h.syncCalls,1);assert.equal(JSON.stringify(h.base.rows),original);
 console.log('PASS actual candidate GETs align with sending: no substring/wildcard impersonation, full trimmed comma names, all statuses, original admin filters preserved; todo existing own filter retained, no data writes, original sync invocation mocked.');
 h.setActor(h.base.people[1]);let before=h.state();h.members.delete('员工甲');assert.equal((await h.call('group','POST',{group_id:20,card_type:'todo',card_id:'601',member:'员工甲'})).status,403);assert.equal(h.state(),before);h.members.add('员工甲');
 h.setActor(h.base.people[0]);h.members.delete('老板');before=h.state();assert.equal((await h.call('group','POST',{group_id:20,card_type:'issue',card_id:'803'})).status,403);assert.equal(h.state(),before);h.members.add('老板');
 h.setActor(h.base.people[1]);h.base.people[1].status='停薪留职';for(const kind of ['direct','group']){before=h.state();assert.equal((await h.call(kind,'POST',{...scope(kind),card_type:'todo',card_id:'601'})).status,403);assert.equal(h.state(),before);}h.base.people[1].status='在职';
 before=h.state();assert.equal((await h.call('direct','POST',{other:'停薪员工',card_type:'todo',card_id:'601'})).status,404);assert.equal(h.state(),before);
 console.log('PASS original sender/target chat qualification, group membership even admin, anonymous and client restrictions remain; new rule does not grant access.');
 // Reproduce the original exploit using the real handlers: both now reject and preserve state.
 const proof=[];for(const kind of ['direct','group'])for(const[type,id]of[['todo',602],['issue',803]]){const r=await denied(kind,type,id);proof.push({kind,type,id,status:r.status});}
 console.log('FIXED original exploit probe '+JSON.stringify(proof));
 const old={id:999999,conversation_id:1,sender:'老板',receiver:'员工甲',order_id:'todo:602',content:JSON.stringify({title:'旧卡片快照',subtitle:''}),created_at:'2024-01-01 00:00:00'};h.base.messages.push(old);const saved=JSON.stringify(old);await denied('direct','todo',602);assert.equal(JSON.stringify(old),saved);
 console.log('PASS historic card remains untouched; mock-only query objects, no database driver/environment/network or business writes.');
}
module.exports={createManualHarness};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
