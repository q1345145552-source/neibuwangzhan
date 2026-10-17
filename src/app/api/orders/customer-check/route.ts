import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

/**
 * 新建/修改订单时核对客户名（2026-10-16，2A）：员工在客户管理里只看得到没人认领的和自己认领的客户（客户管理原来的规矩，不动），
 * 同事认领的客户下拉里没有；打全名时这里只回答「客户管理里有没有」，不带任何客户资料。客户管理本身的接口不改。
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth) || auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });
  const name = (new URL(req.url).searchParams.get("name") || "").trim();
  const exists = !!name && !!getDb().prepare("SELECT 1 FROM customers WHERE company_name = ? OR trim(company_name) = ?").get(name, name);
  return NextResponse.json({ exists });
}
