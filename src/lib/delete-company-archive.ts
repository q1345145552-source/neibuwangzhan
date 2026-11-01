import type Database from "better-sqlite3";
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,rmSync,unlinkSync,writeFileSync} from "node:fs";
import path from "node:path";
import {readCompanyArchive} from "./company-archive-data";
/** Disk backups are complete before any delete. SQLite rollback + file copies restore failures. */
export function deleteCompanyArchive(db:Database.Database,id:number,body:{confirm_name?:unknown;version?:unknown},directories:string[],backupRoot:string){
 let backupDir:string|undefined,committed=false;
 const copies:{source:string;backup:string}[]=[];
 try{
  const result=db.transaction(()=>{
   const archive=readCompanyArchive(db,id);
   if(!archive)return {status:404,error:'公司档案不存在或已删除'};
   if(body.confirm_name!==(archive.name_zh||archive.name_foreign))return {status:400,error:'请输入完整公司名确认删除'};
   if(body.version!==archive.version)return {status:409,error:'档案已被更新，请重新打开后删除'};
   const attachments=db.prepare('SELECT * FROM company_archive_files WHERE archive_id=?').all(id) as {id:number;filename:string}[];
   const uploads=attachments.map(item=>db.prepare('SELECT * FROM file_uploads WHERE filename=?').get(item.filename));
   mkdirSync(backupRoot,{recursive:true,mode:0o700});backupDir=mkdtempSync(path.join(backupRoot,`archive-${id}-`));
   // Even records with no files get a manifest; no passwords or unrelated business data.
   writeFileSync(path.join(backupDir,'manifest.json'),JSON.stringify({archive,attachments,uploads}),{mode:0o600,flag:'wx'});
   for(const item of attachments){
    if(path.basename(item.filename)!==item.filename||/[\\/\x00]/.test(item.filename))throw Error('Unsafe archived filename');
    for(const source of new Set(directories.map(dir=>path.join(dir,item.filename)))){
     if(!existsSync(source))continue;
     const backup=path.join(backupDir,`file-${copies.length}`);copyFileSync(source,backup);copies.push({source,backup});
    }
   }
   writeFileSync(path.join(backupDir,'files.json'),JSON.stringify(copies),{mode:0o600,flag:'wx'});
   for(const item of attachments)db.prepare('INSERT OR IGNORE INTO deleted_company_archive_files(filename) VALUES(?)').run(item.filename);
   db.prepare('DELETE FROM company_archive_files WHERE archive_id=?').run(id);
   for(const item of attachments)db.prepare('DELETE FROM file_uploads WHERE filename=?').run(item.filename);
   db.prepare('DELETE FROM company_archives WHERE id=?').run(id);
   for(const {source}of copies)unlinkSync(source);
   return {status:200,success:true};
  }).immediate();
  committed=result.status===200;
  if(backupDir)try{rmSync(backupDir,{recursive:true,force:true});}catch(error){console.error('[公司档案] 删除备份清理失败',error);}
  return result;
 }catch(error){
  if(!committed){
   let restored=true;
   for(const {source,backup}of copies)if(!existsSync(source))try{copyFileSync(backup,source);}catch(restoreError){restored=false;console.error('[公司档案] 文件恢复失败，保留磁盘备份',restoreError);}
   if(restored&&backupDir)rmSync(backupDir,{recursive:true,force:true});
  }
  throw error;
 }
}
