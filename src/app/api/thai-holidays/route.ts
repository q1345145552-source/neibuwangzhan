import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const year = new URL(req.url).searchParams.get("year") || new Date().getFullYear().toString();
  const rows = db.prepare("SELECT DISTINCT date, name FROM thai_holidays WHERE year = ? ORDER BY date").all(year);
  return NextResponse.json(rows);
}
