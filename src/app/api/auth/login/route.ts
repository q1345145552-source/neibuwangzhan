import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import bcrypt from "bcryptjs";
import { signToken } from "@/lib/auth";
import { clearFailedLogins, getLoginLock, loginLockMessage, recordFailedLogin } from "@/lib/login-security";

export async function POST(req: NextRequest) {
  const body = await readJson(req);
  const { email, password } = body;
  const remember = body.remember === true;
  if (!email || !password) return NextResponse.json({ error: "请输入邮箱和密码" }, { status: 400 });

  const db = getDb();
  const user = db.prepare("SELECT id, name, email, role, password, must_change_password, auth_version FROM employees WHERE email = ?").get(email) as { id: number; name: string; email: string; role: string; password: string; must_change_password: number; auth_version: number } | undefined;
  if (!user) return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });

  const existingLock = getLoginLock(db, user.id);
  if (existingLock) {
    return NextResponse.json(
      { error: loginLockMessage(existingLock), retry_after_seconds: existingLock.retryAfterSeconds },
      { status: 429, headers: { "Retry-After": String(existingLock.retryAfterSeconds) } }
    );
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const newLock = recordFailedLogin(db, user.id);
    if (newLock) {
      return NextResponse.json(
        { error: loginLockMessage(newLock), retry_after_seconds: newLock.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(newLock.retryAfterSeconds) } }
      );
    }
    return NextResponse.json({ error: "邮箱或密码错误" }, { status: 401 });
  }

  clearFailedLogins(db, user.id);

  const token = await signToken(user, { remember });
  // must_change_password = 1 表示还在用初始密码 123456。
  // 仍然发受限 token（改密码接口本身需要鉴权）；服务端会拒绝它访问其他接口。
  return NextResponse.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    must_change_password: user.must_change_password === 1,
  });
}
