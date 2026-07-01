import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });

  const db = getDb();
  const user = db.prepare("SELECT id, name, email, role FROM employees WHERE email = ? AND password = ?").get(email, password) as { id: number; name: string; email: string; role: string } | undefined;
  if (!user) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  return NextResponse.json({ id: user.id, name: user.name, email: user.email, role: user.role });
}
