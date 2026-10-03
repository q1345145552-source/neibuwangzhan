import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, type TokenPayload } from "./auth";
import { getDb } from "./db";
import { commercePilotEnabled } from "./commerce-schema";
import { CommerceError, recordBody } from "./commerce";

export async function commerceJson(req: NextRequest): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (Buffer.byteLength(text) > 32_768) throw new CommerceError(413,"BODY_TOO_LARGE","请求内容过大");
  try { return recordBody(JSON.parse(text)); }
  catch (error) {
    if (error instanceof CommerceError) throw error;
    throw new CommerceError(400,"INVALID_JSON","请求格式有误");
  }
}
export async function commerceResponse(
  req: NextRequest, roles: readonly string[],
  operation: (actor: TokenPayload, db: ReturnType<typeof getDb>) => unknown | Promise<unknown>,
  status = 200,
) {
  const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
  try {
    if (!commercePilotEnabled()) throw new CommerceError(404,"PILOT_DISABLED","入口尚未启用");
    const actor = await verifyAuth(req);
    if (!actor) throw new CommerceError(401,"LOGIN_REQUIRED","请先登录");
    if (!roles.includes(actor.role)) throw new CommerceError(403,"ROLE_REQUIRED","当前账号没有此操作权限");
    return NextResponse.json(await operation(actor,getDb()), { status, headers });
  } catch (error) {
    if (error instanceof CommerceError) return NextResponse.json({ error: error.message, code: error.code },{ status: error.status, headers });
    console.error("[commerce] transaction/request failed",error);
    return NextResponse.json({ error: "操作尚未确认，请保留当前订单请求后重试", code: "RETRY_SAME_REQUEST" },{ status: 500, headers });
  }
}
