// Actual export handler + real XLSX + memory-only SQLite. No app DB/config, worker, or external service.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),ts=require('typescript'),XLSX=require('xlsx');
const{DatabaseSync}=require('node:sqlite');const root=path.resolve(__dirname,'..');
function loadSource(source,deps){const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,URL,Response,Date,Buffer,Uint8Array,Map,Set,console,require(name){if(Object.hasOwn(deps,name))return deps[name];throw Error('Forbidden dependency '+name);}});return exports;}
function createExportHarness(source){
 const native=new DatabaseSync(':memory:');native.exec("CREATE TABLE employees(name TEXT,role TEXT,status TEXT);CREATE TABLE attendance(employee_name TEXT,date TEXT,check_in TEXT,check_out TEXT,work_hours REAL,type TEXT);CREATE TABLE leave_requests(employee_name TEXT,leave_type TEXT,start_date TEXT,end_date TEXT,status TEXT)");
 let actor={id:1,name:'老板',role:'admin'},reads=0;const db={prepare(sql){reads++;return native.prepare(sql);}};
 const time=loadSource(fs.readFileSync(path.join(root,'src/lib/time.ts'),'utf8'),{});
 const route=loadSource(source||fs.readFileSync(path.join(root,'src/app/api/attendance/export/route.ts'),'utf8'),{'next/server':{NextResponse:Response},'@/lib/db':{getDb:()=>db},'@/lib/auth':{verifyAuth:async()=>actor,isStaff:a=>['admin','employee'].includes(a.role)},'@/lib/time':time,xlsx:XLSX});
 return{native,route,time,setActor(value){actor=value;},get reads(){return reads;},async call(type='detail',month='2026-10'){return route.GET(new Request(`http://fixture/api/attendance/export?type=${type}&month=${month}`));}};
}
const matrix=sheet=>XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',blankrows:true});
const read=async response=>XLSX.read(Buffer.from(await response.arrayBuffer()),{type:'buffer'});
function seed(h){
 const insert=h.native.prepare('INSERT INTO employees VALUES (?,?,?)');
 for(const name of['Ing','Bam','ไทย','老板','Bam/ทีม?*[x]:\\','A/B','A:B','A_B','bam','Long'.repeat(12)+'1','Long'.repeat(12)+'2',"'Quote'",' '.repeat(3),'员工','History','History_', '😀'.repeat(16),'x'.repeat(30)+"'tail"])insert.run(name,name==='老板'?'admin':'employee','在职');
 for(const row of[['Pop','employee','在职'],['张三','employee','在职'],['离职员工','employee','离职'],['试用员工','employee','试用期'],['客户','client','在职']])insert.run(...row);
 for(const month of['2026-10','2026-11','2024-02','2025-02']){
  const a=h.native.prepare('INSERT INTO attendance VALUES (?,?,?,?,?,?)');a.run('Bam',month+'-01',month+'-01 02:15:00',month+'-01 10:00:00',7.75,'正常');a.run('Bam',month+'-02',month+'-02 01:59:00','',0,'补签');a.run('Ing',month+'-03','','',8,'请假');
  const l=h.native.prepare('INSERT INTO leave_requests VALUES (?,?,?,?,?)');const previous=new Date(month+'-01T00:00:00Z');previous.setUTCDate(0);l.run('Bam','病假',previous.toISOString().slice(0,10),month+'-02','已通过');l.run('Ing','事假',month+'-05',month+'-05','已通过');l.run('Bam','年假',month+'-04',month+'-04','待审批');l.run('Bam','事假',month+'-06',month+'-06','已驳回');
 }
}
async function run(){const h=createExportHarness();try{
 seed(h);const people=h.native.prepare("SELECT name FROM employees WHERE role IN ('admin','employee') AND status='在职' AND name NOT IN ('Pop','张三') ORDER BY name").all();
 const before=h.native.prepare('SELECT * FROM employees').all();
 let baseline;if(process.env.BASELINE_EXPORT_FILE){baseline=createExportHarness(fs.readFileSync(process.env.BASELINE_EXPORT_FILE,'utf8'));seed(baseline);}
 try{for(const[month,days]of[['2026-10',31],['2026-11',30],['2024-02',29],['2025-02',28]]){
  const response=await h.call('detail',month);assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/spreadsheetml/);assert.match(response.headers.get('content-disposition'),new RegExp('attendance_detail_'+month));const wb=await read(response);assert.equal(wb.SheetNames.length,people.length);assert.equal(new Set(wb.SheetNames.map(n=>n.toLowerCase())).size,people.length);
  const legacy=baseline?matrix((await read(await baseline.call('detail',month))).Sheets['明细']):null;
  let rowCount=0;for(let i=0;i<people.length;i++){
   const name=wb.SheetNames[i],rows=matrix(wb.Sheets[name]);assert(name.length>0&&name.length<=31,name);assert(!/[\\/:?*\[\]\x00-\x1f]/.test(name),name);assert(!/^'|'$/.test(name),name);assert(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(name),name);
   assert.deepEqual(rows[0],['日期','签到时间','签退时间','工作小时数','请假类型']);assert.equal(rows.length,days+1);rowCount+=rows.length-1;
   for(let d=1;d<=days;d++)assert.equal(rows[d][0],month+'-'+String(d).padStart(2,'0'));
   if(legacy)assert.deepEqual(rows.slice(1),legacy.slice(1+i*days,1+(i+1)*days).map(row=>row.slice(1)));
   if(people[i].name==='Bam'){assert.equal(name,'Bam');assert.deepEqual(rows[1],[month+'-01','09:15','17:00',7.75,'病假']);assert.deepEqual(rows[2],[month+'-02','08:59','',0,'病假']);assert.deepEqual(rows[4],[month+'-04','','','','']);}
   if(people[i].name==='Ing'){assert.equal(name,'Ing');assert.deepEqual(rows[3],[month+'-03','','','','请假']);assert.equal(rows[5][4],'事假');}
   if(people[i].name==='ไทย')assert.equal(name,'ไทย');
  }assert.equal(rowCount,people.length*days);
  const summary=await read(await h.call('summary',month));assert.deepEqual(summary.SheetNames,['月度汇总']);const summaryRows=matrix(summary.Sheets['月度汇总']);assert.equal(summaryRows.length,people.length+1);assert.deepEqual(summaryRows[0],['员工','总出勤天数','迟到次数','请假天数','病假天数','事假天数']);assert.deepEqual(summaryRows.slice(1).map(row=>row[0]),people.map(p=>p.name));
  if(baseline)assert.deepEqual(summaryRows,matrix((await read(await baseline.call('summary',month))).Sheets['月度汇总']));
 }}finally{baseline?.native.close();}
 for(const actor of[null,{role:'employee',name:'Bam'},{role:'client',name:'客户'}]){h.setActor(actor);const count=h.reads;for(const type of['detail','summary'])assert.equal((await h.call(type)).status,actor?403:401);assert.equal(h.reads,count);}
 assert.deepEqual(h.native.prepare('SELECT * FROM employees').all(),before);h.setActor({role:'admin',name:'老板'});h.native.exec('DELETE FROM employees');const empty=await read(await h.call());assert.deepEqual(empty.SheetNames,['明细']);assert.deepEqual(matrix(empty.Sheets['明细']),[['日期','签到时间','签退时间','工作小时数','请假类型']]);
 console.log('PASS real XLSX per employee, unchanged order/scope and all 28/29/30/31 days, Thai times/hours/approved leave/blanks, safe unique <=31-character sheet names, headers, empty scope, admin-only; summary unchanged'+(process.env.BASELINE_EXPORT_FILE?' and every detail cell matches original flat export.':'.'));
 }finally{h.native.close();}}
module.exports={createExportHarness,read,matrix};if(require.main===module)run().catch(error=>{console.error(error);process.exitCode=1});
