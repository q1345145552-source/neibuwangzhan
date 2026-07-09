import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const payload = await verifyAuth(req);
  if (!payload) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const user = db.prepare("SELECT id, name, email, role FROM employees WHERE id = ?").get(payload.id) as { id: number; name: string; email: string; role: string } | undefined;
  if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });

  return NextResponse.json(user);
}
