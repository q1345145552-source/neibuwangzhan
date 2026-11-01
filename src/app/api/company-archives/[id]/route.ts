import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb,logOperation} from "@/lib/db";
import {readJson} from "@/lib/req";
import {companyArchiveStorage,readCompanyArchive,validateCompanyArchive} from "@/lib/company-archive-data";
type Context={params:Promise<{id:string}>};
const validId=(raw:string)=>/^[1-9]\d*$/.test(raw)&&Number.isSafeInteger(Number(raw));
export async function GET(req:NextRequest,{params}:Context){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可查看公司档案"},{status:403});
 const {id}=await params;if(!validId(id))return NextResponse.json({error:"档案编号无效"},{status:400});const row=readCompanyArchive(getDb(),Number(id));return row?NextResponse.json(row,{headers:{'Cache-Control':'private, no-store'}}):NextResponse.json({error:"公司档案不存在"},{status:404});
}
export async function PATCH(req:NextRequest,{params}:Context){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可编辑公司档案"},{status:403});
 const {id}=await params;if(!validId(id))return NextResponse.json({error:"档案编号无效"},{status:400});const body=await readJson(req),db=getDb();
 return db.transaction(()=>{
  const previous=readCompanyArchive(db,Number(id));if(!previous)return NextResponse.json({error:"公司档案不存在"},{status:404});
  if(body.version!==previous.version)return NextResponse.json({error:"档案已被更新，请重新打开后编辑"},{status:409});
  let data;try{data=validateCompanyArchive(db,body,user,previous);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'资料无效'},{status:400});}
  const stored=companyArchiveStorage(data);
  db.prepare(`UPDATE company_archives SET ${Object.keys(stored).map(key=>key+'=?').join(',')},updated_by=?,updated_at=datetime('now'),version=version+1 WHERE id=? AND version=?`).run(...Object.values(stored),user.name,Number(id),previous.version);
  logOperation(user.name,'编辑公司档案','company_archive',id,data.name_zh||data.name_foreign);return NextResponse.json(readCompanyArchive(db,Number(id)));
 }).immediate();
}
