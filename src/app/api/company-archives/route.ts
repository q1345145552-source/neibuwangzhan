import { NextRequest,NextResponse } from "next/server";
import { verifyAuth,isStaff } from "@/lib/auth";
import { getDb,logOperation } from "@/lib/db";
import { readJson } from "@/lib/req";
import { companyArchiveSelect,readCompanyArchive,validateCompanyArchive } from "@/lib/company-archive-data";
import { COMPANY_ARCHIVE_STATUSES } from "@/lib/company-archives";
export async function GET(req:NextRequest){
  const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可查看公司档案"},{status:403});
  const params=new URL(req.url).searchParams,status=params.get('status')||'',q=(params.get('q')||'').trim();
  if(status&&!COMPANY_ARCHIVE_STATUSES.includes(status as typeof COMPANY_ARCHIVE_STATUSES[number]))return NextResponse.json({error:"公司状态无效"},{status:400});
  if(q.length>200)return NextResponse.json({error:"搜索词最多200字"},{status:400});
  const conditions:string[]=[],args:string[]=[];if(status){conditions.push('a.status=?');args.push(status);}if(q){conditions.push('(instr(lower(a.name_zh),lower(?))>0 OR instr(lower(a.name_foreign),lower(?))>0)');args.push(q,q);}
  return NextResponse.json(getDb().prepare(companyArchiveSelect+(conditions.length?' WHERE '+conditions.join(' AND '):'')+' ORDER BY a.id DESC').all(...args),{headers:{'Cache-Control':'private, no-store'}});
}
export async function POST(req:NextRequest){
  const user=await verifyAuth(req);if(!user)return NextResponse.json({error:"未登录"},{status:401});if(!isStaff(user))return NextResponse.json({error:"仅内部员工可新建公司档案"},{status:403});
  const body=await readJson(req),db=getDb();
  return db.transaction(()=>{
    let data;try{data=validateCompanyArchive(db,body,user);}catch(error){return NextResponse.json({error:error instanceof Error?error.message:'资料无效'},{status:400});}
    const keys=Object.keys(data),result=db.prepare(`INSERT INTO company_archives(${keys.join(',')},created_by,updated_by) VALUES(${keys.map(()=>'?').join(',')},?,?)`).run(...Object.values(data),user.name,user.name);
    const id=Number(result.lastInsertRowid);logOperation(user.name,'新建公司档案','company_archive',String(id),data.name_zh||data.name_foreign);
    return NextResponse.json(readCompanyArchive(db,id),{status:201});
  }).immediate();
}
