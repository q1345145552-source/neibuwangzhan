// Isolated real SQL + temporary files only. Never imports the application's DB/config.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const {DatabaseSync}=require('node:sqlite');
const root=path.resolve(__dirname,'..');
function load(file,deps){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,URL,Buffer,console,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Forbidden dependency '+name);}});return exports;}
async function run(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'personal-file-delete-')),fallback=path.join(dir,'fallback');fs.mkdirSync(fallback);
 const native=new DatabaseSync(':memory:');native.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE employees(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO employees VALUES(1,'Bam'),(2,'Ing');
 CREATE TABLE file_uploads(filename TEXT PRIMARY KEY,uploaded_by_id INTEGER,uploaded_by_role TEXT);
 CREATE TABLE personal_files(filename TEXT PRIMARY KEY REFERENCES file_uploads(filename),owner_id INTEGER);
 CREATE TABLE documents(id INTEGER PRIMARY KEY,name TEXT,file_url TEXT);
 CREATE TABLE employee_files(id INTEGER PRIMARY KEY,employee_id INTEGER,original_name TEXT,filename TEXT);
 CREATE TABLE todo_follow_ups(id INTEGER PRIMARY KEY,images TEXT);
 CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,detail TEXT);
 CREATE TABLE messages(id INTEGER PRIMARY KEY,content TEXT);
 `);
 let failCommit=false,failUnlink=false,actor={id:1,name:'Bam',role:'employee'};
 const db={prepare:s=>native.prepare(s),transaction(fn){const work=()=>{native.exec('BEGIN IMMEDIATE');try{const result=fn();if(failCommit)throw Error('commit failure');native.exec('COMMIT');return result;}catch(e){native.exec('ROLLBACK');throw e;}};work.immediate=work;return work;}};
 const helper=load('src/lib/personal-file-deletion.ts',{'node:path':path,'node:fs':{...fs,unlinkSync(file){if(failUnlink&&file.startsWith(fallback))throw Error('disk failure');return fs.unlinkSync(file);}}});
 const route=load('src/app/api/my-folder/route.ts',{'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/auth':{verifyAuth:async()=>actor,isStaff:u=>['admin','employee'].includes(u.role)},'@/lib/db':{getDb:()=>db},'@/lib/req':{readJson:r=>r.json()},'@/lib/workspace-data':{},'node:path':path,'node:os':{tmpdir:()=>dir},'@/lib/uploads':{uploadsDir:dir},'@/lib/personal-file-deletion':{...helper,deletePersonalFile:(database,id,name)=>helper.deletePersonalFile(database,id,name,[dir,fallback])}});
 const seed=(name,owner=1)=>{native.prepare('INSERT INTO file_uploads VALUES(?,?,?)').run(name,owner,'employee');native.prepare('INSERT INTO personal_files VALUES(?,?)').run(name,owner);fs.writeFileSync(path.join(dir,name),'fixture '+name);};
 const call=async filename=>{const response=await route.DELETE(new Request('http://fixture/api/my-folder',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({filename,owner_id:1})}));return{status:response.status,body:await response.json()};};
 const present=name=>{assert(native.prepare('SELECT 1 FROM personal_files WHERE filename=?').get(name));assert(native.prepare('SELECT 1 FROM file_uploads WHERE filename=?').get(name));assert(fs.existsSync(path.join(dir,name)));};
 try{
 seed('own.pdf');seed('other.pdf',2);
 for(const user of [null,{id:1,role:'client'}]){actor=user;assert.equal((await call('own.pdf')).status,user?403:401);present('own.pdf');}
 actor={id:2,role:'employee'};assert.equal((await call('own.pdf')).status,403);actor={id:99,role:'admin'};assert.equal((await call('own.pdf')).status,403);
 actor={id:1,role:'employee'};assert.equal((await call('other.pdf')).status,403);for(const name of ['../own.pdf','/own.pdf','..','x\\own.pdf',''])assert.equal((await call(name)).status,400);
 native.exec(`INSERT INTO documents VALUES(1,'合同A','/api/files/own.pdf?token=abc'),(2,'合同B','https://internal/api/files/own.pdf'); INSERT INTO employee_files VALUES(1,2,'入职合同','own.pdf');`);
 let result=await call('own.pdf');assert.equal(result.status,409);assert(result.body.references.includes('文档「合同A」'));assert(result.body.references.includes('文档「合同B」'));assert(result.body.references.includes('员工「Ing」的档案「入职合同」'));present('own.pdf');
 native.exec('DELETE FROM documents; DELETE FROM employee_files');
 native.prepare('INSERT INTO todo_follow_ups VALUES(1,?)').run(JSON.stringify([{url:'/api/files/own.pdf'}]));assert.equal((await call('own.pdf')).status,409);present('own.pdf');native.exec('DELETE FROM todo_follow_ups');
 native.prepare('INSERT INTO messages VALUES(1,?)').run('[文件](/api/files/own.pdf)');assert.equal((await call('own.pdf')).status,409);native.exec('DELETE FROM messages');
 // A different filename prefix and immutable audit evidence must not block deletion.
 native.exec(`INSERT INTO documents VALUES(3,'另一文件','/api/files/own.pdf.bak'); INSERT INTO audit_logs VALUES(1,'/api/files/own.pdf');`);
 assert.equal((await call('own.pdf')).status,200);assert(!fs.existsSync(path.join(dir,'own.pdf')));assert(!native.prepare('SELECT 1 FROM file_uploads WHERE filename=?').get('own.pdf'));assert(!native.prepare('SELECT 1 FROM personal_files WHERE filename=?').get('own.pdf'));present('other.pdf');
 seed('rollback.pdf');failCommit=true;assert.equal((await call('rollback.pdf')).status,500);failCommit=false;present('rollback.pdf');assert.equal(fs.readFileSync(path.join(dir,'rollback.pdf'),'utf8'),'fixture rollback.pdf');
 seed('disk.pdf');fs.writeFileSync(path.join(fallback,'disk.pdf'),'fallback bytes');failUnlink=true;assert.equal((await call('disk.pdf')).status,500);failUnlink=false;present('disk.pdf');assert.equal(fs.readFileSync(path.join(fallback,'disk.pdf'),'utf8'),'fallback bytes');assert.equal((await call('disk.pdf')).status,200);assert(!fs.existsSync(path.join(fallback,'disk.pdf')));
 seed('missing.pdf');fs.unlinkSync(path.join(dir,'missing.pdf'));assert.equal((await call('missing.pdf')).status,200);
 console.log('PASS: actual DELETE handler, ownership (including admin), clients, traversal, named document/employee references, JSON attachments, markdown links, prefix safety, unreference then disk+DB deletion, fallback copies, commit/disk rollback, already-missing file.');
 }finally{native.close();fs.rmSync(dir,{recursive:true,force:true});}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
