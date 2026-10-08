import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 话术「不好用」反馈：同一客服对同一条话术只能反馈一次

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const scriptId = Number(body?.script_id);
  if (!Number.isInteger(scriptId) || scriptId <= 0) return NextResponse.json({ error: "缺少话术ID" }, { status: 400 });
  const script = db.prepare("SELECT id FROM logistics_scripts WHERE id = ?").get(scriptId);
  if (!script) return NextResponse.json({ error: "话术不存在" }, { status: 404 });

  const existing = db.prepare("SELECT id FROM logistics_script_feedback WHERE script_id = ? AND user_name = ?").get(scriptId, auth.name);
  if (existing) return NextResponse.json({ error: "你已经反馈过这条话术了" }, { status: 400 });

  const reason = String(body?.reason || "").trim();
  db.prepare("INSERT INTO logistics_script_feedback (script_id, user_name, reason) VALUES (?, ?, ?)").run(scriptId, auth.name, reason);
  const count = (db.prepare("SELECT COUNT(*) AS c FROM logistics_script_feedback WHERE script_id = ?").get(scriptId) as { c: number }).c;
  return NextResponse.json({ feedback_count: count });
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可查看反馈详情" }, { status: 403 });

  const db = getDb();
  const scriptId = Number(new URL(req.url).searchParams.get("script_id"));
  if (!Number.isInteger(scriptId) || scriptId <= 0) return NextResponse.json({ error: "缺少话术ID" }, { status: 400 });

  const rows = db.prepare("SELECT id, user_name, reason, created_at FROM logistics_script_feedback WHERE script_id = ? ORDER BY id DESC").all(scriptId);
  return NextResponse.json(rows);
}
