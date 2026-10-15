import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { buildHandlingReport, bkkMonthKey } from "@/lib/handling-report";

// GET /api/internal/handling-report?month=YYYY-MM — 办理效率月报（只读，仅管理员）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可看" }, { status: 403 });

  const now = new Date();
  const month = new URL(req.url).searchParams.get("month") || bkkMonthKey(now);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NextResponse.json({ error: "月份格式应为 YYYY-MM" }, { status: 400 });
  return NextResponse.json(buildHandlingReport(getDb(), month, now));
}
