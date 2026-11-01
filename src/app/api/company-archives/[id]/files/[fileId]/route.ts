import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb,logOperation} from "@/lib/db";
import {canManageCompanyArchiveFiles} from "@/lib/company-archive-access";
import {uploadsDir} from "@/lib/uploads";
import {existsSync,readFileSync,unlinkSync,writeFileSync} from "node:fs";
import path from "node:path";
import os from "node:os";
export async function DELETE(req:NextRequest,{params}:{params:Promise<{id:string;fileId:string}>}){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"无权限"},{status:403});
 const{id,fileId}=await params;if(![id,fileId].every(value=>/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))))return NextResponse.json({error:"编号无效"},{status:400});
 const db=getDb(),backups:{file:string;buffer:Buffer}[]=[];
 try{return db.transaction(()=>{
  if(!canManageCompanyArchiveFiles(db,user,Number(id)))return NextResponse.json({error:"无权删除公司档案资料"},{status:403});
  const row=db.prepare("SELECT filename FROM company_archive_files WHERE id=? AND archive_id=? AND deleted_at=''").get(Number(fileId),Number(id)) as {filename:string}|undefined;
  if(!row)return NextResponse.json({error:"资料不存在或已删除"},{status:404});
  if(path.basename(row.filename)!==row.filename||/[\\/\x00]/.test(row.filename))throw Error('Invalid filename');
  const files=[...new Set([path.join(uploadsDir,row.filename),path.join(os.tmpdir(),'xiangtai-uploads',row.filename)])].filter(file=>existsSync(file));
  for(const file of files)backups.push({file,buffer:readFileSync(file)});
  // Keep the private ownership marker: old URLs can never fall back to generic file access.
  db.prepare("UPDATE company_archive_files SET deleted_at=datetime('now') WHERE id=?").run(Number(fileId));
  for(const{file}of backups)unlinkSync(file);
  logOperation(user.name,'删除公司档案资料','company_archive',id,`资料 #${fileId}`);
  return NextResponse.json({success:true});
 }).immediate();}catch(error){for(const{file,buffer}of backups)if(!existsSync(file))writeFileSync(file,buffer,{flag:'wx'});console.error('[公司档案] 删除资料失败',error);return NextResponse.json({error:'删除失败，请重试'},{status:500});}
}
