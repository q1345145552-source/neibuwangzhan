import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";

// 旧接口保留兼容与权限校验；监督逾期已停用，不读取业务表、不计算逾期。
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可访问监督接口" }, { status: 403 });
  return NextResponse.json({
    enabled: false,
    generated_at: new Date().toISOString(),
    timezone: "Asia/Bangkok",
    total: 0,
    counts: { todo: 0, report: 0, meeting: 0, notice: 0 },
    overdues: [],
  }, { headers: { "Cache-Control": "private, no-store" } });
}
