import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";
import { getDb } from "./db";

const rawSecret = process.env.JWT_SECRET;
if (!rawSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "未设置 JWT_SECRET 环境变量：生产环境禁止使用默认密钥启动，请在部署环境中设置一个足够随机的 JWT_SECRET。"
    );
  }
  console.warn("[auth] 未设置 JWT_SECRET，当前使用开发环境默认密钥，仅供本地开发，切勿用于生产部署。");
}
const secret = new TextEncoder().encode(rawSecret || "xiangtai-internal-secret-key-2026-dev-only");

export interface TokenPayload {
  id: number;
  name: string;
  role: string;
  authVersion: number;
  passwordChangeRequired: boolean;
}

export interface TokenUser {
  id: number;
  name: string;
  role: string;
  auth_version: number;
  must_change_password: number;
}

interface VerifyOptions {
  allowPasswordChangeRequired?: boolean;
}

interface SignTokenOptions {
  remember?: boolean;
}

export async function signToken(user: TokenUser, options: SignTokenOptions = {}): Promise<string> {
  // 强制改密凭证只用于完成改密；普通会话 12 小时，记住我延长到 30 天。
  const expiresIn = user.must_change_password === 1 ? "15m" : options.remember ? "30d" : "12h";
  return new SignJWT({
    id: user.id,
    name: user.name,
    role: user.role,
    authVersion: user.auth_version,
    passwordChangeRequired: user.must_change_password === 1,
  } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret);
}

export async function verifyToken(token: string, options: VerifyOptions = {}): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    const tokenPayload = payload as unknown as TokenPayload;
    if (!Number.isInteger(tokenPayload.id) || !Number.isInteger(tokenPayload.authVersion)) return null;

    // JWT 只证明它由本系统签发；账号当前是否还能使用，必须以数据库为准。
    const user = getDb().prepare(
      "SELECT name, role, must_change_password, auth_version FROM employees WHERE id = ?"
    ).get(tokenPayload.id) as {
      name: string;
      role: string;
      must_change_password: number;
      auth_version: number;
    } | undefined;

    if (!user || user.auth_version !== tokenPayload.authVersion) return null;
    if (user.must_change_password === 1 && !options.allowPasswordChangeRequired) return null;

    return {
      ...tokenPayload,
      name: user.name,
      role: user.role,
      passwordChangeRequired: user.must_change_password === 1,
    };
  } catch {
    return null;
  }
}

export async function verifyAuth(request: NextRequest, options: VerifyOptions = {}): Promise<TokenPayload | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return verifyToken(token, options);
}
