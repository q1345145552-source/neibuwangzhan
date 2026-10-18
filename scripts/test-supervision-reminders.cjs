#!/usr/bin/env node
// Real schema and notification handlers; all writes stay in a new temporary synthetic database.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),vm=require('node:vm');
const ts=require('typescript'),root=path.resolve(__dirname,'..'),child=process.argv[2]==='--worker';
if(child && (!/^\/(?:private\/)?tmp\/xt-supervision-push-[^/]+\/fixture\.db$/.test(process.argv[3]||'') || !fs.existsSync(process.argv[3])))throw Error('Child only accepts an existing synthetic fixture');
const fixture=child?path.dirname(process.argv[3]):fs.mkdtempSync('/tmp/xt-supervision-push-');
Object.assign(process.env,{DB_PATH:path.join(fixture,'fixture.db'),INTERNAL_APP_ROOT:fixture,NODE_ENV:'test',ALLOW_EMPTY_DB:'1',JWT_SECRET:'supervision-push-fixture-only'});
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);
const resolve=Module._resolveFilename;Module._resolveFilename=function(id,...rest){return resolve.call(this,id.startsWith('@/')?path.join(root,'src',id.slice(2)):id,...rest)};
global.fetch=async()=>{throw Error('NETWORK_DISABLED')};
const db=require('../src/lib/db.ts').getDb(),{runSupervisionReminders:run,supervisionSchedule}=require('../src/lib/supervision-reminders.ts');
const {SUPERVISION_ALERT_TITLES,messageCenterFilter}=require('../src/lib/notification-types.ts');
const ms=t=>Date.parse(t+'+07:00'),utc=t=>new Date(ms(t)).toISOString();
if(child){const outcome=run(db,Number(process.argv[4]));db.close();console.log(JSON.stringify(outcome));process.exit(0);}
db.prepare("UPDATE employees SET status='离职' WHERE role IN ('admin','employee')").run();
function employee(name,role){return Number(db.prepare('INSERT INTO employees(name,role,hire_date,created_at) VALUES (?,?,?,?)').run(name,role,'2026-10-19',utc('2026-10-19T00:00:00')).lastInsertRowid)}
const alice=employee('推送员工甲','employee'),bob=employee('推送员工乙','employee'),boss=employee('监督老板甲','admin'),boss2=employee('监督老板乙','admin');
const client=db.prepare("SELECT * FROM employees WHERE role='client' LIMIT 1").get();
function todo(priority='紧急'){return Number(db.prepare('INSERT INTO todos(content,assignee,priority,created_at) VALUES (?,?,?,?)').run('推送待办 '+priority,'推送员工甲',priority,utc('2026-10-19T00:00:00')).lastInsertRowid)}
function notice(){const id=Number(db.prepare("INSERT INTO notice_rules(title,body,type,publisher_id,publisher_name,recipient_mode,published_at) VALUES ('落实通知','正文','通知',?,'监督老板甲','selected',?)").run(boss,utc('2026-10-19T00:00:00')).lastInsertRowid);db.prepare("INSERT INTO notice_rule_implementations(notice_id,employee_id,employee_name) VALUES (?,?,'推送员工甲')").run(id,alice);return id;}
const count=()=>db.prepare("SELECT COUNT(*) n FROM notifications WHERE related_type='boss_supervision'").get().n;
const messages=()=>db.prepare("SELECT * FROM notifications WHERE related_type='boss_supervision' ORDER BY id").all();
let passed=0;function test(name,fn){const rollback=Symbol();try{db.transaction(()=>{fn();throw rollback;}).immediate()}catch(e){if(e!==rollback)throw e;}passed++;console.log('PASS '+name)}
(async()=>{
 test('Critical notice + urgent todo push to each admin once; elapsed time/printing/content edits do not resend',()=>{
  const t=todo(),n=notice();assert.deepEqual(run(db,ms('2026-10-20T12:00:00')),{criticalSent:4,digestsSent:0});assert.equal(count(),4);
  assert(messages().every(m=>['监督老板甲','监督老板乙'].includes(m.recipient)&&m.type===''&&m.title===SUPERVISION_ALERT_TITLES[0]));assert(messages().some(m=>m.body.includes('推送员工甲的通知/规则『落实通知』')));
  db.prepare('UPDATE notice_rule_implementations SET printed=1 WHERE notice_id=?').run(n);db.prepare("UPDATE todos SET content='仅编辑文字',updated_at=datetime('now') WHERE id=?").run(t);
  assert.deepEqual(run(db,ms('2026-10-20T12:30:00')),{criticalSent:0,digestsSent:0});assert.equal(count(),4);
 });
 test('Persistent per-recipient dedup survives reloading module; missing admins do not consume reminders',()=>{
  todo();db.prepare("UPDATE employees SET status='离职' WHERE id IN (?,?)").run(boss,boss2);assert.equal(run(db,ms('2026-10-20T12:00:00')).criticalSent,0);
  db.prepare("UPDATE employees SET status='在职' WHERE id IN (?,?)").run(boss,boss2);assert.equal(run(db,ms('2026-10-20T12:30:00')).criticalSent,2);
  delete require.cache[require.resolve('../src/lib/supervision-reminders.ts')];assert.equal(require('../src/lib/supervision-reminders.ts').runSupervisionReminders(db,ms('2026-10-20T13:00:00')).criticalSent,0);
 });
 test('Resolved/reopened and priority escalation are new episodes; quick reopen uses existing audit log',()=>{
  const t=todo();run(db,ms('2026-10-20T12:00:00'));db.prepare("UPDATE todos SET status='已完成' WHERE id=?").run(t);run(db,ms('2026-10-20T12:30:00'));db.prepare("UPDATE todos SET status='未完成' WHERE id=?").run(t);assert.equal(run(db,ms('2026-10-20T13:00:00')).criticalSent,2);
  db.prepare("INSERT INTO audit_logs(action,target_type,target_id) VALUES ('待办恢复未完成','todo',?)").run(String(t));assert.equal(run(db,ms('2026-10-20T13:30:00')).criticalSent,2);
  const ordinary=todo('普通');run(db,ms('2026-10-20T14:00:00'));db.prepare("UPDATE todos SET priority='紧急' WHERE id=?").run(ordinary);assert.equal(run(db,ms('2026-10-20T14:30:00')).criticalSent,2);
 });
 test('Notice completion suppresses alerts; new rejection is pushed even between two scans',()=>{
  const n=notice();run(db,ms('2026-10-20T12:00:00'));
  db.prepare("UPDATE notice_rule_implementations SET printed=1,photos='[\"/api/files/p.png\"]',submitted_at=?,review_status='还没处理' WHERE notice_id=?").run(utc('2026-10-20T12:10:00'),n);
  assert.equal(run(db,ms('2026-10-20T12:30:00')).criticalSent,0);
  db.prepare("UPDATE notice_rule_implementations SET review_status='打回',reviewed_at=? WHERE notice_id=?").run(utc('2026-10-20T12:40:00'),n);assert.equal(run(db,ms('2026-10-20T13:00:00')).criticalSent,2);
  db.prepare('UPDATE notice_rule_implementations SET submitted_at=?,reviewed_at=? WHERE notice_id=?').run(utc('2026-10-20T13:10:00'),utc('2026-10-20T13:20:00'),n);assert.equal(run(db,ms('2026-10-20T13:30:00')).criticalSent,2);
 });
 test('17:30 Bangkok digest: once/day, distinct people counts, all details, no urgent/notice duplication',()=>{
  todo();notice();todo('普通');todo('不急');db.prepare("INSERT INTO work_reports(employee_name,report_date,status,submitted_at) VALUES ('推送员工甲','2026-10-19','退回','2026-10-19T05:00:00.000Z')").run();db.prepare("INSERT INTO meetings(title,meeting_date,participants) VALUES ('未交会议','2026-10-19',?)").run(JSON.stringify(['推送员工甲','推送员工乙']));
  assert.equal(run(db,ms('2026-10-20T17:29:59')).digestsSent,0);
  assert.deepEqual(run(db,ms('2026-10-20T17:30:00')),{criticalSent:0,digestsSent:2});const digests=messages().filter(m=>m.title===SUPERVISION_ALERT_TITLES[1]);assert.equal(digests.length,2);
  for(const m of digests){assert(m.body.includes('今日日报漏交 2 人、普通待办逾期 2 条、会议未交 2 人'));assert(m.body.includes('推送员工甲')&&m.body.includes('推送员工乙'));assert(m.body.includes('2026-10-19的日报')&&m.body.includes('2026-10-20的日报'));assert(!m.body.includes('落实通知')&&!m.body.includes('推送待办 紧急'));}
  assert.equal(run(db,ms('2026-10-20T18:00:00')).digestsSent,0);db.prepare("UPDATE work_reports SET boss_comment='仅修改点评',updated_at='2026-10-21T00:00:00.000Z'").run();assert.equal(run(db,ms('2026-10-21T17:30:00')).digestsSent,2);
  const next=messages().filter(m=>m.title===SUPERVISION_ALERT_TITLES[1]).slice(-2);for(const m of next){assert(m.body.includes('2026-10-21的日报'));assert(!m.body.includes('2026-10-19的日报'));assert(!m.body.includes('推送待办 普通'));assert(!m.body.includes('未交会议'));}
 });
 test('No empty digest; late ordinary events wait next day; catch-up after restart does not duplicate',()=>{
  for(const id of [alice,bob])for(const date of ['2026-10-19','2026-10-20'])db.prepare("INSERT INTO work_reports(employee_name,report_date,status) VALUES (?,?,'已提交')").run(id===alice?'推送员工甲':'推送员工乙',date);
  assert.equal(run(db,ms('2026-10-20T17:30:00')).digestsSent,0);todo('普通');assert.equal(run(db,ms('2026-10-20T18:00:00')).digestsSent,0);assert.equal(run(db,ms('2026-10-21T18:00:00')).digestsSent,2);assert.equal(run(db,ms('2026-10-21T18:01:00')).digestsSent,0);
 });
 test('Transaction rollback never consumes dedup records or partial messages after send failure',()=>{
  todo();db.exec("CREATE TEMP TRIGGER fail_supervision BEFORE INSERT ON notifications WHEN NEW.related_type='boss_supervision' BEGIN SELECT RAISE(ABORT,'fixture send failure'); END;");
  try{assert.throws(()=>run(db,ms('2026-10-20T12:00:00')),/fixture send failure/);assert.equal(count(),0);assert.equal(db.prepare("SELECT COUNT(*) n FROM reminder_log WHERE kind LIKE 'supervision-%'").get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM supervision_reminder_state').get().n,0);}finally{db.exec('DROP TRIGGER fail_supervision');}
  assert.equal(run(db,ms('2026-10-20T12:01:00')).criticalSent,2);
 });
 test('Existing worker dispatch: minute clock, half-hour supervision, 17:30 digest, hourly orders, global singleton',()=>{
  const source=fs.readFileSync(path.join(root,'src/lib/order-reminders.ts'),'utf8');const calls=[],timers=[];let certificates=0,fail=false;const fakeDb={prepare:sql=>({all:()=>{if(sql.includes('FROM certificates'))certificates++;return [];}})};
  const context=vm.createContext({exports:{},require:id=>id==='@/lib/db'?{getDb:()=>fakeDb}:id==='@/lib/time'?{bangkokToday:()=> '2026-10-20'}:id==='@/lib/step-overdue'?{currentStepTimings:()=>[]}:id==='@/lib/supervision-reminders'?{runSupervisionReminders:(db,now,options)=>{calls.push({now,options});if(fail){fail=false;throw Error('fixture retry');}},supervisionSchedule}:null,Date,Map,Set,console:{error(){}},setInterval:(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer;}});
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);const worker=context.exports;
  worker.ensureReminderWorker();worker.ensureReminderWorker();assert.equal(timers.length,1);assert.equal(timers[0].ms,60000);
  worker.runReminderTick(ms('2026-10-20T17:00:00'));worker.runReminderTick(ms('2026-10-20T17:01:00'));worker.runReminderTick(ms('2026-10-20T17:30:00'));worker.runReminderTick(ms('2026-10-20T17:31:00'));worker.runReminderTick(ms('2026-10-20T18:00:00'));assert.equal(calls.length,3);assert.equal(calls[1].options.digest,true);assert.equal(calls[0].options.digest,false);assert.equal(certificates,2);
  worker.runReminderTick(ms('2026-10-21T17:30:00'));assert.equal(calls[3].options.digest,true);fail=true;worker.runReminderTick(ms('2026-10-21T18:00:00'));worker.runReminderTick(ms('2026-10-21T18:01:00'));assert.equal(calls.length,6);
 });
 // Real message-center routes, legacy filter behavior, badges and role checks.
 todo();notice();todo('普通');run(db,ms('2026-10-20T17:30:00'));
 const {signToken}=require('../src/lib/auth.ts'),{NextRequest}=require('next/server');const list=require('../src/app/api/notifications/route.ts'),badge=require('../src/app/api/notifications/unread-count/route.ts');
 for(const id of [boss,alice,client.id])db.prepare('UPDATE employees SET must_change_password=0 WHERE id=?').run(id);
 const tokens={};for(const [role,id]of [['admin',boss],['employee',alice],['client',client.id]])tokens[role]=await signToken(db.prepare('SELECT * FROM employees WHERE id=?').get(id));
 const req=(role,method='GET',body)=>new NextRequest('http://fixture/api/notifications',{method,headers:{Authorization:'Bearer '+tokens[role],'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 const own=messages().filter(m=>m.recipient==='监督老板甲');const response=await list.GET(req('admin'));assert.equal(response.status,200);const visible=await response.json();assert.equal(visible.filter(n=>n.related_type==='boss_supervision').length,own.length);let unread=await(await badge.GET(req('admin'))).json();assert(unread.count>=own.length);
 const id=own[0].id;assert.equal((await list.PATCH(req('admin','PATCH',{id}))).status,200);assert.equal(db.prepare('SELECT is_read FROM notifications WHERE id=?').get(id).is_read,1);assert.equal((await(await badge.GET(req('admin'))).json()).count,unread.count-1);
 // Even matching recipient names must not expose boss-only notifications to employees.
 db.prepare("INSERT INTO notifications(type,title,body,recipient,related_type) VALUES ('','监督关键逾期','不应泄露','推送员工甲','boss_supervision')").run();
 const staff=await(await list.GET(req('employee'))).json();assert.equal(staff.some(n=>n.related_type==='boss_supervision'),false);assert.equal((await(await badge.GET(req('employee'))).json()).count,0);assert.equal((await list.GET(req('client'))).status,403);
 db.prepare("INSERT INTO notifications(type,title,recipient,related_type) VALUES ('工单指派','旧工单','监督老板甲','issue'),('','客户站新订单','监督老板甲','order'),('','任意空类型','监督老板甲','other')").run();const filter=messageCenterFilter();const accepted=db.prepare(`SELECT title FROM notifications WHERE ${filter.sql}`).all(...filter.params).map(n=>n.title);assert(accepted.includes('旧工单')&&accepted.includes('客户站新订单'));assert(!accepted.includes('任意空类型'));
 passed++;console.log('PASS real message center: list/badge/mark-read, admin-only privacy, legacy notifications preserved');
 const before=count();todo();const {execFile}=require('node:child_process');
 const spawn=()=>new Promise((resolve,reject)=>execFile(process.execPath,[__filename,'--worker',path.join(fixture,'fixture.db'),String(ms('2026-10-20T17:30:00'))],{timeout:20000},(error,out)=>error?reject(error):resolve(JSON.parse(out.trim().split('\n').at(-1)))));
 const concurrent=await Promise.all([spawn(),spawn()]);assert.equal(concurrent.reduce((n,r)=>n+r.criticalSent,0),2);assert.equal(count()-before,2);passed++;console.log('PASS two independent worker processes share durable atomic dedup without duplicate messages');
 assert.equal(db.pragma('quick_check',{simple:true}),'ok');db.close();console.log(`SUPERVISION PUSH: ${passed} groups passed; isolated fixture ${fixture}`);
})().catch(e=>{console.error(e);try{db.close()}catch{}process.exitCode=1;});
