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
  const limit = parseInt(searchParams.get("limit") || "100");

  let sql = "SELECT * FROM audit_logs WHERE 1=1";
  const params: any[] = [];
  if (targetType) { sql += " AND target_type = ?"; params.push(targetType); }
  if (targetId) { sql += " AND target_id = ?"; params.push(targetId); }
  sql += " ORDER BY created_at DESC LIMIT ?";
  params.push(limit);

  return NextResponse.json(db.prepare(sql).all(...params));
}
