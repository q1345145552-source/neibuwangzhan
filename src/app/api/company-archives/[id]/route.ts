import {deleteCompanyArchive} from "@/lib/delete-company-archive";
import {uploadsDir} from "@/lib/uploads";
import path from "node:path";
import os from "node:os";
import { canAccessCompanyArchive,canAssignArchiveOrder } from "@/lib/company-archive-access";
import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb,logOperation} from "@/lib/db";
import {readJson} from "@/lib/req";
import {companyArchiveStorage,readCompanyArchive,validateCompanyArchive} from "@/lib/company-archive-data";
type Context={params:Promise<{id:string}>};
const validId=(raw:string)=>/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw));
export async function GET(req:NextRequest,{params}:Context){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可查看公司档案"},{status:403});
 const {id}=await params;if(!validId(id))return NextResponse.json({error:"档案编号无效"},{status:400});const db=getDb();if(!canAccessCompanyArchive(db,user,Number(id)))return NextResponse.json({error:"公司档案不存在或无权查看"},{status:404});const row=readCompanyArchive(db,Number(id));return row?NextResponse.json(row,{headers:{'Cache-Control':'private, no-store'}}):NextResponse.json({error:"公司档案不存在"},{status:404});
}
export async function PATCH(req:NextRequest,{params}:Context){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可编辑公司档案"},{status:403});
 const {id}=await params;if(!validId(id))return NextResponse.json({error:"档案编号无效"},{status:400});const body=await readJson(req),db=getDb();
 return db.transaction(()=>{
  if(!canAccessCompanyArchive(db,user,Number(id)))return NextResponse.json({error:"公司档案不存在或无权编辑"},{status:404});
  const previous=readCompanyArchive(db,Number(id));if(!previous)return NextResponse.json({error:"公司档案不存在"},{status:404});
  if(body.version!==previous.version)return NextResponse.json({error:"档案已被更新，请重新打开后编辑"},{status:409});
  let data;try{data=validateCompanyArchive(db,body,user,previous);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'资料无效'},{status:400});}
  if(!canAssignArchiveOrder(db,user,data.order_id))return NextResponse.json({error:"只能关联自己负责的订单，不能取消订单关联"},{status:403});
  const stored=companyArchiveStorage(data);
  db.prepare(`UPDATE company_archives SET ${Object.keys(stored).map(key=>key+'=?').join(',')},updated_by=?,updated_at=datetime('now'),version=version+1 WHERE id=? AND version=?`).run(...Object.values(stored),user.name,Number(id),previous.version);
  logOperation(user.name,'编辑公司档案','company_archive',id,data.name_zh||data.name_foreign);return NextResponse.json(readCompanyArchive(db,Number(id)));
 }).immediate();
}

export async function DELETE(req:NextRequest,{params}:Context){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});
 if(user.role!=="admin")return NextResponse.json({error:"仅管理员可删除公司档案"},{status:403});
 const{id}=await params;if(!validId(id))return NextResponse.json({error:"档案编号无效"},{status:400});
 const body=await readJson(req);
 try{
  const{status,...result}=deleteCompanyArchive(getDb(),Number(id),body,[uploadsDir,path.join(os.tmpdir(),'xiangtai-uploads')],path.join(path.dirname(uploadsDir),'company-archive-deletion-backups'));
  if(status===200)logOperation(user.name,'删除公司档案','company_archive',id,String(body.confirm_name));
  return NextResponse.json(result,{status});
 }catch(error){console.error('[公司档案] 删除失败，已尝试从备份恢复',error);return NextResponse.json({error:'删除失败，请重试；如仍有异常请联系管理员检查删除备份'},{status:500});}
}
