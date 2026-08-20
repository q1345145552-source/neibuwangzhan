import { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { readJson } from "@/lib/req";
import { signToken, type TokenUser } from "@/lib/auth";
import { corsResponse, handleOptions } from "@/lib/cors";
import bcrypt from "bcryptjs";
import { clearFailedLogins, getLoginLock, loginLockMessage, recordFailedLogin } from "@/lib/login-security";

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get("origin");
  return handleOptions(origin);
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  try {
    const { email, password, remember } = await readJson(req);
    if (!email || !password) {
      return corsResponse({ error: "请提供邮箱和密码" }, 400, origin);
    }
    const db = getDb();
    const user = db.prepare(
      "SELECT id, name, email, role, password, must_change_password, auth_version FROM employees WHERE email = ? AND role = 'client'"
    ).get(email) as (TokenUser & { email: string; password: string }) | undefined;
    if (!user) {
      return corsResponse({ error: "账号不存在或非客户账号" }, 401, origin);
    }
    const existingLock = getLoginLock(db, user.id);
    if (existingLock) {
      return corsResponse({
        error: loginLockMessage(existingLock),
        retry_after_seconds: existingLock.retryAfterSeconds,
      }, 429, origin);
    }
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      const newLock = recordFailedLogin(db, user.id);
      if (newLock) {
        return corsResponse({
          error: loginLockMessage(newLock),
          retry_after_seconds: newLock.retryAfterSeconds,
        }, 429, origin);
      }
      return corsResponse({ error: "密码错误" }, 401, origin);
    }
    clearFailedLogins(db, user.id);
    const token = await signToken({ ...user, role: "client" }, { remember: remember === true });
    return corsResponse({
      token,
      customer_name: user.name,
      email: user.email,
      must_change_password: user.must_change_password === 1,
    }, 200, origin);
  } catch {
    return corsResponse({ error: "请求格式错误" }, 400, origin);
  }
}
