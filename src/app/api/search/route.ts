import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { globalSearch } from "@/lib/workspace-data";

export async function GET(req: NextRequest) {
  const user = await verifyAuth(req);
  if (!user) return NextResponse.json({error:"未登录"}, {status:401});
  if (!isStaff(user)) return NextResponse.json({error:"仅员工可用"}, {status:403});
  const keyword = req.nextUrl.searchParams.get("q")?.trim() || "";
  if (keyword.length > 100) return NextResponse.json({error:"关键词不能超过100字"}, {status:400});
  return NextResponse.json(keyword ? globalSearch(getDb(), user, keyword) : [], {headers:{"Cache-Control":"private, no-store"}});
}
