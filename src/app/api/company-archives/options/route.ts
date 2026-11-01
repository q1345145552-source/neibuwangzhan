import {NextRequest,NextResponse} from "next/server";
import {verifyAuth,isStaff} from "@/lib/auth";
import {getDb} from "@/lib/db";
import {readCompanyArchive,registrationOrderScope} from "@/lib/company-archive-data";
export async function GET(req:NextRequest){
 const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可查看"},{status:403});
 const db=getDb(),id=Number(new URL(req.url).searchParams.get('archive_id')),previous=Number.isSafeInteger(id)&&id>0?readCompanyArchive(db,id):undefined;
 const orders=db.prepare(`SELECT o.id,o.customer_name,o.created_at FROM orders o JOIN business_types b ON b.id=o.business_type_id WHERE ${registrationOrderScope} ORDER BY o.created_at DESC,o.id DESC`).all();
 const customers=user.role==='admin'?db.prepare('SELECT id,company_name FROM customers ORDER BY company_name,id').all():db.prepare("SELECT id,company_name FROM customers WHERE claimed_by IS NULL OR trim(claimed_by)='' OR claimed_by=? OR id=? ORDER BY company_name,id").all(user.name,previous?.customer_id??-1);
 return NextResponse.json({orders,customers},{headers:{'Cache-Control':'private, no-store'}});
}
