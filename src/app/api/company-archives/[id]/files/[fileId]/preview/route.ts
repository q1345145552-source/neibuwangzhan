import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {canAccessCompanyArchive} from "@/lib/company-archive-access";
import {convertCompanyOfficeToPdf,OfficePreviewError} from "@/lib/company-office-preview";
import {uploadsDir} from "@/lib/uploads";
import {readFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
export const runtime='nodejs';
export const maxDuration=90;
const office:Record<string,string>={'application/msword':'doc','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx'};
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string;fileId:string}>}){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:'未登录'},{status:401});if(!isStaff(user))return NextResponse.json({error:'无权限'},{status:403});
 const{id,fileId}=await params;if(![id,fileId].every(value=>/^[1-9]\d*$/.test(value)&&Number.isSafeInteger(Number(value))))return NextResponse.json({error:'编号无效'},{status:400});
 const db=getDb();if(!canAccessCompanyArchive(db,user,Number(id)))return NextResponse.json({error:'资料不存在或无权查看'},{status:404});
 const find=()=>db.prepare("SELECT f.filename,u.mime_type FROM company_archive_files f JOIN file_uploads u ON u.filename=f.filename WHERE f.id=? AND f.archive_id=? AND f.deleted_at=''").get(Number(fileId),Number(id)) as {filename:string;mime_type:string}|undefined;
 const item=find();if(!item)return NextResponse.json({error:'资料不存在或已删除'},{status:404});
 if(path.basename(item.filename)!==item.filename||/[\\/\x00]/.test(item.filename))return NextResponse.json({error:'文件名无效'},{status:400});
 const image=['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'].includes(item.mime_type),pdf=item.mime_type==='application/pdf',extension=office[item.mime_type];
 if(!image&&!pdf&&!extension)return NextResponse.json({error:'此格式暂不支持预览，请下载查看'},{status:415});
 try{
  let bytes:Buffer|undefined;
  for(const directory of[uploadsDir,path.join(os.tmpdir(),'xiangtai-uploads')]){try{bytes=await readFile(path.join(directory,item.filename));break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  if(!bytes)return NextResponse.json({error:'文件不存在'},{status:404});
  const content=extension?await convertCompanyOfficeToPdf(bytes,extension,req.signal):bytes;
  // Conversion may take time: recheck both current ownership and the file before sending bytes.
  if(!canAccessCompanyArchive(db,user,Number(id))||find()?.filename!==item.filename)return NextResponse.json({error:'资料已删除或权限已变化'},{status:404});
  return new NextResponse(Uint8Array.from(content),{headers:{'Content-Type':image?item.mime_type:'application/pdf','Content-Disposition':'inline','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){if(error instanceof OfficePreviewError)return NextResponse.json({error:error.message},{status:error.status});console.error('[公司档案] 预览失败',error);return NextResponse.json({error:'预览失败，请下载原文件查看或稍后重试'},{status:500});}
}
