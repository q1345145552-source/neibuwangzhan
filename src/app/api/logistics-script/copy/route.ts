import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/logistics-script/copy — 记录一次复制，用于「最近使用」和「使用统计」
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

  db.prepare("INSERT INTO logistics_script_copy_logs (script_id, user_name) VALUES (?, ?)").run(scriptId, auth.name);
  const count = (db.prepare("SELECT COUNT(*) AS c FROM logistics_script_copy_logs WHERE script_id = ?").get(scriptId) as { c: number }).c;
  return NextResponse.json({ copy_count: count });
}
