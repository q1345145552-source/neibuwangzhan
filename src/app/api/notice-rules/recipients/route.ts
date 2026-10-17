import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可选择发送对象" }, { status: 403 });
  return NextResponse.json(getDb().prepare("SELECT id, name FROM employees WHERE role='employee' AND status != '离职' ORDER BY name, id").all());
}
