import crypto from "crypto";
import { NextRequest } from "next/server";

/**
 * 定时任务鉴权。
 *
 * 之前这里是硬编码字符串 "Bearer internal-cron"，等于把一把万能钥匙写进源码
 * （还进了 git 历史），任何人带上这个头就能绕过登录批量生成/篡改申报记录。
 *
 * 现在改为读环境变量 CRON_SECRET：
 * - 未配置 CRON_SECRET → 一律返回 false（cron 分支不可用，正常登录路径不受影响）
 * - 已配置 → 用等时比较，避免通过响应时间逐字节猜测密钥
 *
 * 部署方式见 .env.example，脚本示例见 scripts/vat-auto-generate.sh
 */
export function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return false;
  const provided = header.slice(7);

  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
