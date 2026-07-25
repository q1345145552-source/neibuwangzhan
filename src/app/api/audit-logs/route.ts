import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const targetType = searchParams.get("target_type");
  const targetId = searchParams.get("target_id");
  // parseInt("abc") → NaN，直接当 LIMIT 参数会让 SQLite 抛 "datatype mismatch" → 500
  const rawLimit = parseInt(searchParams.get("limit") || "100", 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(500, Math.max(1, rawLimit)) : 100;

  let sql = "SELECT * FROM audit_logs WHERE 1=1";
  const params: any[] = [];
  // 审计日志是"谁在什么时候改了什么"的全量记录（含金额、负责人变更等），
  // 普通员工只应看到自己的操作，全量视图限管理员
  if (auth.role !== "admin") { sql += " AND actor = ?"; params.push(auth.name); }
  if (targetType) { sql += " AND target_type = ?"; params.push(targetType); }
  if (targetId) { sql += " AND target_id = ?"; params.push(targetId); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return NextResponse.json(db.prepare(sql).all(...params));
}
