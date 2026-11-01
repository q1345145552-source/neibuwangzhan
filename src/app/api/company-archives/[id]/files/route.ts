import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {canAccessCompanyArchive,canManageCompanyArchiveFiles} from "@/lib/company-archive-access";
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"无权限"},{status:403});
 const{id}=await params,archiveId=Number(id),db=getDb();if(!/^[1-9]\d*$/.test(id)||!Number.isSafeInteger(archiveId))return NextResponse.json({error:"档案编号无效"},{status:400});
 if(!canAccessCompanyArchive(db,user,archiveId))return NextResponse.json({error:"公司档案不存在或无权查看"},{status:404});
 const files=db.prepare("SELECT f.id,f.archive_id,f.filename,f.category,f.created_by,f.created_at,u.original_name,u.mime_type,u.size FROM company_archive_files f JOIN file_uploads u ON u.filename=f.filename WHERE f.archive_id=? AND f.deleted_at='' ORDER BY f.id DESC").all(archiveId);
 return NextResponse.json({files,can_manage:canManageCompanyArchiveFiles(db,user,archiveId)},{headers:{'Cache-Control':'private, no-store'}});
}
