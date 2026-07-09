import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import bcrypt from "bcryptjs";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password } = body;
  if (!email || !password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });

  const db = getDb();
  const user = db.prepare("SELECT id, name, email, role, password FROM employees WHERE email = ?").get(email) as { id: number; name: string; email: string; role: string; password: string } | undefined;
  if (!user) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  const token = await signToken({ id: user.id, name: user.name, role: user.role });
  return NextResponse.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
}
