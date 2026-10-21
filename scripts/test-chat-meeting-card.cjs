#!/usr/bin/env node
// Actual handlers and participant parser + mock queries only. No database or business writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {createReportHarness}=require('./test-chat-report-card.cjs');const root=path.resolve(__dirname,'..');
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports,URL,Response,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Unexpected dependency: '+name);}});return exports;}
function createMeetingHarness(){
 const base=createReportHarness();let actor={id:2,role:'employee',name:'员工甲'},blockedSyncCalls=0;
 const meeting=(id,title,participants)=>({id,title,participants:JSON.stringify(participants),meeting_date:'2024-02-15',meeting_time:'10:00',agenda:Array.from({length:28},(_,i)=>'隔离模拟长议程第'+(i+1)+'项').join('\n'),topics:'[]',story:'模拟历史故事线',creator:'老板',created_at:'2024-02-15 02:00:00'});
 const meetings=[meeting(41,'模拟历史会议甲',['员工甲','员工乙']),meeting(84,'模拟历史会议乙',['员工甲','员工乙']),meeting(126,'模拟未参会会议',['员工乙']),{...meeting(304,'模拟无效参会名单',[]),participants:'bad-json'}];
 const reflection=(id,meeting_id,employee_name,status='已提交')=>({id,meeting_id,employee_name,status,content:'私密心得 #'+id+'：'+employee_name+'的完整心得。\n必须按独立心得编号定位。',content_zh:'',images:'[]',created_at:'2024-02-15 04:00:00',updated_at:'2024-02-16 04:00:00'});
 const reflections=[reflection(1701,41,'员工甲'),reflection(1702,41,'员工甲'),reflection(1703,41,'员工甲','退回'),reflection(1704,41,'员工乙'),reflection(1710,41,'旧作者丁'),reflection(41,84,'员工甲'),reflection(1790,126,'员工甲'),reflection(1791,304,'员工甲'),reflection(9991,9999,'员工甲'),...Array.from({length:12},(_,i)=>reflection(1801+i,41,i%2?'员工乙':'员工甲'))];
 const forbidden=()=>{throw Error('No meeting business mutation allowed');};
 const mt=load('src/lib/meeting-todos.ts',{'./boss-submissions':{acknowledgeBossSubmission:forbidden}});
 const joinRows=()=>reflections.filter(r=>meetings.some(m=>m.id===r.meeting_id)).map(r=>({...meetings.find(m=>m.id===r.meeting_id),...r,title:meetings.find(m=>m.id===r.meeting_id).title}));
 function project(sql,row){if(!row)return undefined;return Object.fromEntries(sql.match(/SELECT ([\s\S]+?) FROM meeting_reflections/)[1].split(',').map(f=>f.trim().replace(/^[rm]\./,'')).map(f=>[f,row[f]]));}
 const db={prepare(sql){
  if(!sql.includes('FROM meeting_reflections')&&!sql.includes('FROM meetings'))return base.db.prepare(sql);
  return{
   get(...args){base.reads.push(sql);if(sql.includes('FROM meetings WHERE id'))return meetings.find(m=>m.id===Number(args[0]));
    assert(/WHERE r.id=\?/.test(sql));if(sql.includes('AND r.employee_name=?'))assert.equal(args[1],actor.name);
    const row=joinRows().find(r=>r.id===args[0]&&(!sql.includes('AND r.employee_name=?')||r.employee_name===args[1]));return project(sql,row);},
   all(...args){base.reads.push(sql);
    if(sql.includes('FROM meetings ORDER BY'))return meetings.map(m=>({...m}));
    if(sql.includes('SELECT DISTINCT meeting_id'))return [...new Map(reflections.filter(r=>r.status==='已提交').map(r=>[r.meeting_id+':'+r.employee_name,{meeting_id:r.meeting_id,employee_name:r.employee_name}])).values()];
    if(sql.includes('JOIN meetings m')){assert(!/content|images|agenda|story|GROUP BY|LIMIT/.test(sql));if(actor.role!=='admin')assert(sql.includes('WHERE r.employee_name=?')&&args[0]===actor.name);return joinRows().filter(r=>actor.role==='admin'||r.employee_name===args[0]).map(r=>project(sql,r));}
    assert(sql.includes('WHERE meeting_id = ?'));if(actor.role!=='admin')assert(sql.includes('AND employee_name = ?')&&args[1]===actor.name);
    return reflections.filter(r=>r.meeting_id===args[0]&&(actor.role==='admin'||r.employee_name===args[1])).sort((a,b)=>b.id-a.id).map(r=>({...r}));},
   run:forbidden
  };
 }};
 const helper=load('src/lib/chat-meeting-card.ts',{'./meeting-todos':mt});
 const deps={'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/auth':{verifyAuth:async()=>actor,isStaff:a=>['admin','employee'].includes(a.role)},'@/lib/db':{getDb:()=>db,logOperation:forbidden},'@/lib/chat-direct-message': load('src/lib/chat-direct-message.ts'), '@/lib/req':{readJson:req=>req.json()},
  '@/lib/chat-meeting-card':helper,'@/lib/chat-report-card':load('src/lib/chat-report-card.ts'),'@/lib/chat-notice-card':load('src/lib/chat-notice-card.ts'),'@/lib/chat-attendance-card':load('src/lib/chat-attendance-card.ts'),'@/lib/chat-leave-card':load('src/lib/chat-leave-card.ts'),
  '@/lib/meeting-todos':mt,'@/lib/boss-submissions':{publishBossSubmission:forbidden},'@/lib/meeting-sync':{syncMeetingReminders(){blockedSyncCalls++;}},'@/lib/meeting-topics':load('src/lib/meeting-topics.ts')};
 const routes=Object.fromEntries(Object.entries({candidates:'chat/share-items',direct:'chat',group:'chat/group-messages',groups:'chat/groups',lookup:'meetings/reflections/[id]',list:'meetings',reflections:'meetings/[id]/reflections'}).map(([k,f])=>[k,load(`src/app/api/${f}/route.ts`,deps)]));
 return{...base,meetings,reflections,db,helper,routes,get blockedSyncCalls(){return blockedSyncCalls;},setActor(value){actor=value;base.setActor(value);},async call(route,method='GET',body,id,query=''){
  const req=new Request('http://mock/api/'+route+query,{method,...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const response=await routes[route][method](req,{params:Promise.resolve({id:String(id)})});return{response,status:response.status,body:await response.json()};
 }};
}
async function run(){
 const h=createMeetingHarness();for(const actor of [null,{id:9,role:'client',name:'客户'}]){h.setActor(actor);for(const[r,m,b,id,q]of[['candidates','GET',null,null,'?type=meeting'],['lookup','GET',null,1701],['list','GET'],['reflections','GET',null,41],['direct','POST',{other:'老板',card_type:'meeting',card_id:'1701'}],['group','POST',{group_id:20,card_type:'meeting',card_id:'1701'}]])assert.equal((await h.call(r,m,b,id,q)).status,actor?403:401);}
 assert.equal(h.reads.length,0);h.setActor({id:2,role:'employee',name:'员工甲'});let r=await h.call('candidates','GET',null,null,'?type=meeting&employee_name=员工乙');
 assert.equal(r.status,200);const ids=r.body.map(c=>c.id);for(const id of ['1701','1702','1703','41'])assert(ids.includes(id));for(const id of ['1704','1710','1790','1791','9991'])assert(!ids.includes(id));assert(!JSON.stringify(r.body).includes('私密'));assert.deepEqual(Object.keys(r.body[0]).sort(),['id','status','subtitle','title']);
 assert.deepEqual((await h.call('lookup','GET',null,41)).body,{id:41,meeting_id:84});for(const id of [1704,1710,1790,1791,84,9991,99999])assert.equal((await h.call('lookup','GET',null,id)).status,404);
 assert.equal(h.writes.length,0);assert.equal(h.blockedSyncCalls,0);
 for(const route of ['direct','group']){const scope=route==='direct'?{other:'老板'}:{group_id:20},before=h.writes.length;
  for(const id of ['1704','1710','1790','1791','84','9991','99999','01'])assert.equal((await h.call(route,'POST',{...scope,card_type:'meeting',card_id:id})).status,404);assert.equal(h.writes.length,before);
  for(const id of ['1701','1702','1703','41']){r=await h.call(route,'POST',{...scope,card_type:'meeting',card_id:id,title:'伪造会议',content:'私密伪造心得'});assert.equal(r.status,201);assert.equal(r.body.message.order_id,'meeting:'+id);const c=JSON.parse(r.body.message.content);assert.deepEqual(Object.keys(c).sort(),['subtitle','title']);assert(c.title.includes('#'+id));assert(!JSON.stringify(c).includes('私密')&&!JSON.stringify(c).includes('伪造'));}
  for(const type of ['order','todo','project','customer','vat','wht','problem','issue','leave','attendance','notice','report'])assert.equal((await h.call(route,'POST',{...scope,card_type:type,card_id:type==='order'?'ORD-1':type==='leave'||type==='notice'?'1001':type==='attendance'?'1101':type==='report'?'1501':'1'})).status,201,type);
 }
 assert.equal(h.blockedSyncCalls,0);assert(h.previews.includes('[会议心得]'));await h.call('group','POST',{group_id:20,card_type:'meeting',card_id:'1702'});assert.equal((await h.call('groups')).body[0].last_preview,'[会议心得]');
 const before=h.writes.length;h.setMember(false);assert.equal((await h.call('group','POST',{group_id:20,card_type:'meeting',card_id:'1701'})).status,403);h.setMember(true);h.setActive(false);for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'老板'}:{group_id:20}),card_type:'meeting',card_id:'1701'})).status,403);h.setActive(true);assert.equal(h.writes.length,before);
 r=await h.call('list');assert(!r.body.some(m=>[126,304].includes(m.id)));r=await h.call('reflections','GET',null,41);assert(r.body.every(r=>r.employee_name==='员工甲'));assert(r.body.some(r=>r.id===1701)&&r.body.some(r=>r.id===1702));
 h.setActor({id:1,role:'admin',name:'老板'});r=await h.call('candidates','GET',null,null,'?type=meeting');for(const id of ['1710','1790','1791'])assert(r.body.some(c=>c.id===id));assert.deepEqual((await h.call('lookup','GET',null,1710)).body,{id:1710,meeting_id:41});
 for(const route of ['direct','group'])assert.equal((await h.call(route,'POST',{...(route==='direct'?{other:'员工甲'}:{group_id:20}),card_type:'meeting',card_id:'1710'})).status,201);
 console.log('PASS own author AND current participant scope; true reflection IDs, parent collision 41->84, same-author multiple rows, submitted/returned/history, admin historical authors; minimal server snapshot, no share-triggered sync or business writes; original twelve types and both previews');
 const p=fs.readFileSync(path.join(root,'src/app/(app)/messages/page.tsx'),'utf8'),exports={};vm.runInNewContext(ts.transpileModule(p.slice(p.indexOf('// ── 分享卡片'),p.indexOf('// ── AI 总结'))+'\nObject.assign(exports,{CARD_META,SHARE_CATEGORIES,parseCard,quotePreview});',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{exports});assert.equal(exports.SHARE_CATEGORIES.length,13);
 const m={order_id:'meeting:41',content:JSON.stringify({title:'模拟历史会议乙 · 员工甲 心得 #41',subtitle:'2024-02-15 · 已提交'})};assert.equal(exports.parseCard(m).kind,'meeting');assert.equal(exports.quotePreview(m),'[会议心得] 模拟历史会议乙 · 员工甲 心得 #41');assert.equal(exports.CARD_META.meeting.href('41'),'/meetings?reflection=41');
 assert.equal(exports.parseCard({order_id:'OLD-ORDER',content:'旧客户'}).kind,'order');console.log('PASS thirteen categories, exact reflection URL, quote/parser and legacy order compatibility. Real DB/AI/sync never loaded.');
}
module.exports={createMeetingHarness};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
