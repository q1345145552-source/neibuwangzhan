import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

// 只读本人结果；管理员查看他人仍走原有审核面板，不复用这个入口。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth) || !auth.name?.trim()) return NextResponse.json({ error: "无权限" }, { status: 403 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) return NextResponse.json({ error: "提现编号无效" }, { status: 400 });
  const row = getDb().prepare("SELECT * FROM point_withdrawals WHERE id = ? AND employee_name = ?").get(id, auth.name);
  if (!row) return NextResponse.json({ error: "提现记录不存在或你无权查看" }, { status: 404 });
  return NextResponse.json(row, { headers: { "Cache-Control": "private, no-store" } });
}
