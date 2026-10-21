import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

// 员工卡片定位只读本人申请，不加载老板看板或执行审批/通知。
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });
  const { id } = await params;
  const n = Number(id);
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(n)) return NextResponse.json({ error: "请假编号无效。" }, { status: 400 });
  const own = auth.role !== "admin";
  const row = getDb().prepare(`SELECT id,employee_name,leave_type,start_date,end_date,start_time,end_time,destination,reason,status,created_at
    FROM leave_requests WHERE id=?${own ? " AND employee_name=?" : ""}`).get(n, ...(own ? [auth.name] : []));
  if (!row) return NextResponse.json({ error: "请假记录不存在或你无权查看。" }, { status: 404 });
  return NextResponse.json(row, { headers: { "Cache-Control": "private, no-store" } });
}
