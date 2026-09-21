import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * 客户站同步通道鉴权（服务间凭证，与 cron-auth 同一套等时比较模式）。
 *
 * 环境变量 SYNC_SECRET 未配置 → 一律拒绝（同步通道关闭）。
 * 凭证只存两端服务端环境变量，绝不下发浏览器；CORS 不作为鉴权手段。
 */
export function isSyncRequest(req: NextRequest): boolean {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// 鉴权失败限流：同一个 IP 短时间内猜错太多次就关 10 分钟小黑屋。
// 内存态即可——重启清零无所谓，攻击者面对的是每一台实例独立的闸门。
const syncAuthFails = new Map<string, { n: number; until: number }>();

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function syncRateLimited(req: NextRequest): boolean {
  const e = syncAuthFails.get(clientIp(req));
  return !!e && e.until > Date.now();
}

export function recordSyncAuthFailure(req: NextRequest): void {
  const ip = clientIp(req);
  const e = syncAuthFails.get(ip) || { n: 0, until: 0 };
  e.n += 1;
  if (e.n >= 20) {
    e.until = Date.now() + 10 * 60 * 1000;
    e.n = 0;
  }
  syncAuthFails.set(ip, e);
}
