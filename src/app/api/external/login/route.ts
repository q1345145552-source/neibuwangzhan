import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { verifyToken, signToken } from "@/lib/auth";
import { corsResponse, handleOptions } from "@/lib/cors";
import bcrypt from "bcryptjs";

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return handleOptions(origin);
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return corsResponse({ error: "请提供邮箱和密码" }, 400, origin);
    }
    const db = getDb();
    const user = db.prepare("SELECT * FROM employees WHERE email = ? AND role = 'client'").get(email) as any;
    if (!user) {
      return corsResponse({ error: "账号不存在或非客户账号" }, 401, origin);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return corsResponse({ error: "密码错误" }, 401, origin);
    }
    const token = await signToken({ id: user.id, name: user.name, role: "client" });
    return corsResponse({
      token,
      customer_name: user.name,
      email: user.email,
    }, 200, origin);
  } catch {
    return corsResponse({ error: "请求格式错误" }, 400, origin);
  }
}
