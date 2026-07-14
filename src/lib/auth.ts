import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";

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
}

export async function signToken(user: { id: number; name: string; role: string }): Promise<string> {
  return new SignJWT({ id: user.id, name: user.name, role: user.role } as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

export async function verifyAuth(request: NextRequest): Promise<TokenPayload | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  return verifyToken(token);
}
