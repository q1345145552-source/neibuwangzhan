import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { annualLeaveBalance } from "@/lib/annual-leave";
import { bangkokToday } from "@/lib/time";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const employee = searchParams.get("employee");
  // 普通员工只能看自己的年假额度，管理员可查任意员工
  const name = auth.role === "admin" && employee ? employee : auth.name;
  if (!name) return NextResponse.json({ error: "缺少员工" }, { status: 400 });
  const balance = annualLeaveBalance(db, name, bangkokToday());
  return NextResponse.json(balance);
}
