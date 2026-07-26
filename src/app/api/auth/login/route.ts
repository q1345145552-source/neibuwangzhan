import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import bcrypt from "bcryptjs";
import { signToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { email, password } = body;
  if (!email || !password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });

  const db = getDb();
  const user = db.prepare("SELECT id, name, email, role, password, must_change_password FROM employees WHERE email = ?").get(email) as { id: number; name: string; email: string; role: string; password: string; must_change_password: number } | undefined;
  if (!user) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  const token = await signToken({ id: user.id, name: user.name, role: user.role });
  // must_change_password = 1 表示还在用初始密码 123456。
  // 仍然发 token（改密码接口本身需要鉴权），由前端拦在改密页面，不放进系统。
  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    must_change_password: user.must_change_password === 1,
  });
}
