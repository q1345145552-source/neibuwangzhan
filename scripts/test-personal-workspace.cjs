/* eslint-disable @typescript-eslint/no-require-imports -- Standalone isolated regression CLI. */
/* Isolated API/data regression: in-memory SQLite; never touches the application DB. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
// Local TS loader for this standalone test, including the project's @ alias.
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, 'src', request.slice(2)) : request, ...args);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText,filename);
const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
db.exec(`
 CREATE TABLE employees(id INTEGER PRIMARY KEY,name TEXT);
 INSERT INTO employees VALUES(1,'甲'),(2,'乙'),(3,'老板');
 CREATE TABLE business_types(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO business_types VALUES(1,'商标');
 CREATE TABLE orders(id TEXT PRIMARY KEY,customer_name TEXT,responsible_person TEXT,business_type_id INTEGER,status TEXT,trademark_name TEXT,description TEXT,created_at TEXT);
 INSERT INTO orders VALUES('商标-001','商标客户','甲',1,'待处理','','','2026-10-26'),('商标-002','商标客户','乙',1,'待处理','','','2026-10-25');
 CREATE TABLE meetings(id INTEGER PRIMARY KEY,title TEXT,meeting_date TEXT,agenda TEXT,topics TEXT,participants TEXT);
 INSERT INTO meetings VALUES(1,'商标会议','2026-10-26','议程','["商标"]','["甲"]'),(2,'商标私会','2026-10-26','','[]','["乙"]'),(3,'商标无效','2026-10-26','','[]','broken'),(4,'商标姓名子串','2026-10-26','','[]','["甲乙"]');
 CREATE TABLE work_reports(id INTEGER PRIMARY KEY,employee_name TEXT,report_date TEXT,completed_items TEXT,summary TEXT,tomorrow_plan TEXT,problems TEXT,completed_items_zh TEXT,summary_zh TEXT,tomorrow_plan_zh TEXT,problems_zh TEXT);
 INSERT INTO work_reports VALUES(1,'甲','2026-10-26','["商标办结"]','','','','','','',''),(2,'乙','2026-10-26','[]','商标私密','','','','','','');
 CREATE TABLE todos(id INTEGER PRIMARY KEY,content TEXT,content_zh TEXT,assignee TEXT,status TEXT,created_at TEXT);
 INSERT INTO todos VALUES(1,'商标待办','','甲','未完成','2026-10-26'),(2,'商标别人的待办','','乙','未完成','2026-10-26');
 CREATE TABLE documents(id INTEGER PRIMARY KEY,name TEXT,order_id TEXT,created_at TEXT,file_url TEXT);
 INSERT INTO documents VALUES(1,'商标文档','商标-001','2026-10-26','/api/files/history.pdf');
 CREATE TABLE customers(id INTEGER PRIMARY KEY,company_name TEXT,status TEXT,updated_at TEXT,claimed_by TEXT);
 INSERT INTO customers VALUES(1,'商标公海','潜在','2026-10-26',''),(2,'商标我的客户','跟进中','2026-10-26','甲'),(3,'商标别人的客户','跟进中','2026-10-26','乙');
 CREATE TABLE file_uploads(filename TEXT PRIMARY KEY,uploaded_by_id INTEGER,uploaded_by_role TEXT,mime_type TEXT,size INTEGER,created_at TEXT,original_name TEXT DEFAULT '');
 INSERT INTO file_uploads VALUES('own.pdf',1,'employee','application/pdf',10,'2026-10-26','商标合同.pdf'),('other.pdf',2,'employee','application/pdf',10,'2026-10-26','商标乙文件.pdf'),('history.pdf',3,'admin','application/pdf',10,'2026-10-26',''),('personnel.pdf',3,'admin','application/pdf',10,'2026-10-26','商标员工合同.pdf');
 CREATE TABLE employee_files(filename TEXT,original_name TEXT,employee_id INTEGER);
 INSERT INTO employee_files VALUES('personnel.pdf','商标员工合同.pdf',2);
`);
const {ensureWorkspaceSchema}=require('../src/lib/workspace-schema.ts'); ensureWorkspaceSchema(db);ensureWorkspaceSchema(db);
const data=require('../src/lib/workspace-data.ts');
const user={id:1,name:'甲',role:'employee'}, other={id:2,name:'乙',role:'employee'}, admin={id:3,name:'老板',role:'admin'};
const own=data.personalWorkspace(db,user);assert.deepEqual(own.groups.map(g=>g.type),['meetings','reports','todos','orders']);
for(const group of own.groups) assert.equal(group.items.length,1,group.type);
const results=data.globalSearch(db,user,'商标');assert.equal(results.length,7);assert.ok(results.every(g=>g.items.length>0));
assert.equal(results.find(g=>g.type==='meetings').items.length,1);assert.equal(results.find(g=>g.type==='reports').items.length,1);assert.equal(results.find(g=>g.type==='todos').items.length,1);assert.equal(results.find(g=>g.type==='orders').items.length,2);assert.equal(results.find(g=>g.type==='customers').items.length,2);
assert.ok(!results.find(g=>g.type==='files').items.some(r=>r.id==='personnel.pdf'));
assert.ok(data.globalSearch(db,user,'不存在xyz').every(g=>g.items.length===0));
assert.ok(data.globalSearch(db,user,"%' OR 1=1 --").every(g=>g.items.length===0));
assert.ok(data.globalSearch(db,user,'%').every(g=>g.items.length===0));
assert.equal(data.globalSearch(db,admin,'商标').find(g=>g.type==='reports').items.length,2);
// Exercise authenticated route ownership and mutation logic with injected DB/auth only.
let auth=user;
require.cache[require.resolve('../src/lib/db.ts')]={id:'test-db',filename:'test-db',loaded:true,exports:{getDb:()=>db}};
require.cache[require.resolve('../src/lib/auth.ts')]={id:'test-auth',filename:'test-auth',loaded:true,exports:{verifyAuth:async()=>auth,verifyToken:async()=>auth,isStaff:a=>['admin','employee'].includes(a.role)}};
const testUploads=fs.mkdtempSync(path.join(require('node:os').tmpdir(),'workspace-upload-notes-'));
require.cache[require.resolve('../src/lib/uploads.ts')]={id:'test-uploads',filename:'test-uploads',loaded:true,exports:{uploadsDir:testUploads}};
const uploadRoute=require('../src/app/api/upload/route.ts');
const route=require('../src/app/api/my-folder/route.ts');
const searchRoute=require('../src/app/api/search/route.ts');
const fileRoute=require('../src/app/api/files/[filename]/route.ts');
const {NextRequest}=require('next/server');
const post=body=>route.POST(new NextRequest('http://localhost/api/my-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));
(async()=>{
 assert.equal((await post({action:'create',name:'客户A'})).status,200);
 const folder=db.prepare('SELECT id FROM personal_folders WHERE owner_id=1').get().id;
 assert.equal((await post({action:'create',name:'客户A'})).status,409);
 assert.equal((await post({action:'rename',folder_id:folder,name:'合同'})).status,200);
 assert.equal((await post({action:'assign',folder_id:folder,record_type:'meetings',record_id:'1'})).status,200);
 let space=data.personalWorkspace(db,user);assert.equal(space.groups[0].items.length,1);assert.equal(space.memberships.length,1);
 assert.equal((await post({action:'assign',folder_id:folder,record_type:'meetings',record_id:'2'})).status,403);
 assert.equal((await post({action:'file',folder_id:folder,filename:'other.pdf'})).status,403);
 assert.equal((await post({action:'file',folder_id:folder,filename:'own.pdf'})).status,200);
 space=data.personalWorkspace(db,user);assert.equal(space.files[0].title,'商标合同.pdf');assert.equal(space.files[0].folder_id,folder);
 assert.ok(!data.globalSearch(db,other,'商标').find(g=>g.type==='files').items.some(r=>r.id==='own.pdf'));
 auth=other;assert.equal((await fileRoute.GET(new NextRequest('http://localhost/api/files/own.pdf',{headers:{Authorization:'Bearer test'}}),{params:Promise.resolve({filename:'own.pdf'})})).status,403);assert.equal((await post({action:'rename',folder_id:folder,name:'偷改'})).status,404);assert.equal((await post({action:'delete',folder_id:folder})).status,404);assert.equal((await route.GET(new NextRequest('http://localhost/api/my-folder'))).status,200);
 auth=user;assert.equal((await post({action:'create',name:'客户B'})).status,200);const folder2=db.prepare("SELECT id FROM personal_folders WHERE name='客户B'").get().id;
 assert.equal((await post({action:'assign',folder_id:folder2,record_type:'meetings',record_id:'1',from_folder_id:folder})).status,200);
 space=data.personalWorkspace(db,user);assert.equal(space.memberships.length,1);assert.equal(space.memberships[0].folder_id,folder2);assert.equal(space.groups[0].items.length,1);
 db.prepare("UPDATE meetings SET participants='[\"乙\"]' WHERE id=1").run();assert.equal(data.personalWorkspace(db,user).memberships.length,0);
 assert.equal((await post({action:'assign',folder_id:folder,record_type:'todos',record_id:'1'})).status,200);
 assert.equal((await post({action:'delete',folder_id:folder})).status,200);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM personal_folder_records WHERE folder_id=?').get(folder).n,0);assert.ok(db.prepare('SELECT 1 FROM todos WHERE id=1').get());space=data.personalWorkspace(db,user);assert.equal(space.files[0].folder_id,null);assert.ok(db.prepare("SELECT 1 FROM file_uploads WHERE filename='own.pdf'").get());
 auth=null;assert.equal((await route.GET(new NextRequest('http://localhost/api/my-folder'))).status,401);
 auth={...user,role:'client'};assert.equal((await route.GET(new NextRequest('http://localhost/api/my-folder'))).status,403);assert.equal((await searchRoute.GET(new NextRequest('http://localhost/api/search?q=商标'))).status,403);
 auth=user;assert.equal((await searchRoute.GET(new NextRequest('http://localhost/api/search?q='+ 'a'.repeat(101)))).status,400);
 // Notes are owner-only; original upload names remain intact; search is scoped.
 auth=user;
 assert.equal((await post({action:'note',filename:'own.pdf',note_name:'张三合同'})).status,200);
 let noted=data.personalWorkspace(db,user).files[0];assert.equal(noted.title,'张三合同');assert.equal(noted.original_name,'商标合同.pdf');
 assert.equal(data.globalSearch(db,user,'张三').find(g=>g.type==='files').items[0].title,'张三合同');
 assert.ok(!data.globalSearch(db,other,'张三').find(g=>g.type==='files').items.length);
 assert.equal((await post({action:'note',filename:'own.pdf',note_name:'张三合同新版'})).status,200);
 const historyResponse=await route.GET(new NextRequest('http://localhost/api/my-folder?filename=own.pdf'));const history=(await historyResponse.json()).history;
 assert.equal(history.length,2);assert.equal(history[0].old_note,'张三合同');assert.equal(history[0].new_note,'张三合同新版');assert.equal(history[0].changed_by,'甲');assert.ok(history[0].created_at);
 assert.equal((await post({action:'note',filename:'own.pdf',note_name:'张三合同新版'})).status,200);assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_file_note_history').get().n,2);
 auth=other;assert.equal((await post({action:'note',filename:'own.pdf',note_name:'偷改'})).status,403);assert.equal((await route.GET(new NextRequest('http://localhost/api/my-folder?filename=own.pdf'))).status,403);
 auth=admin;assert.equal((await post({action:'note',filename:'own.pdf',note_name:'偷改'})).status,403);
 auth=user;assert.equal((await post({action:'note',filename:'own.pdf',note_name:'x'.repeat(201)})).status,400);
 assert.equal((await post({action:'note',filename:'own.pdf',note_name:'   '})).status,200);assert.equal(data.personalWorkspace(db,user).files[0].title,'商标合同.pdf');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_file_note_history').get().n,3);
 const empty=await searchRoute.GET(new NextRequest('http://localhost/api/search?q=不存在'));assert.ok((await empty.json()).every(g=>!g.items.length));
 // Exercise the actual multipart upload handler, including initial note history.
 for (const note of ['上传时备注','']) {
   const form=new FormData();form.append('file',new File(['%PDF-fixture'],'original.pdf',{type:'application/pdf'}));form.append('personal_folder_id',String(folder2));if(note)form.append('note_name',note);
   const uploaded=await uploadRoute.POST(new NextRequest('http://localhost/api/upload',{method:'POST',body:form}));assert.equal(uploaded.status,200);const file=await uploaded.json();const filename=file.url.split('/').at(-1);
   assert(fs.existsSync(path.join(testUploads,filename)));const row=db.prepare('SELECT note_name FROM personal_files WHERE filename=?').get(filename);assert.equal(row.note_name,note);
   assert.equal(data.personalWorkspace(db,user).files.find(f=>f.id===filename).title,note||'original.pdf');
   assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_file_note_history WHERE filename=?').get(filename).n,note?1:0);
   assert.equal((await route.DELETE(new NextRequest('http://localhost/api/my-folder',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename})}))).status,200);assert(!fs.existsSync(path.join(testUploads,filename)));assert.equal(db.prepare('SELECT COUNT(*) n FROM personal_file_note_history WHERE filename=?').get(filename).n,0);
 }
 console.log('PASS: 7 search types, partial/literal matching, personal scopes, exact participants, malformed JSON, folder CRUD, duplicate names, record copy/move, upload ownership, private file search, reassignment, delete keeps uploads, authentication/authorization, note naming/fallback, owner-only edit/history, exact old/new actor/time, no-op edits, length limit and private note keyword search, real multipart uploads with/without note, disk deletion and history cascade.');
 db.close();fs.rmSync(testUploads,{recursive:true,force:true});
})().catch(err=>{console.error(err);fs.rmSync(testUploads,{recursive:true,force:true});process.exitCode=1;});
