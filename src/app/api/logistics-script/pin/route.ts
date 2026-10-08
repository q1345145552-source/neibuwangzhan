import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/logistics-script/pin — 置顶/取消置顶（每个客服自己的一套）
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

  const existing = db.prepare("SELECT id FROM logistics_script_pins WHERE script_id = ? AND user_name = ?").get(scriptId, auth.name) as { id: number } | undefined;
  let pinned: boolean;
  if (existing) {
    db.prepare("DELETE FROM logistics_script_pins WHERE id = ?").run(existing.id);
    pinned = false;
  } else {
    db.prepare("INSERT INTO logistics_script_pins (script_id, user_name) VALUES (?, ?)").run(scriptId, auth.name);
    pinned = true;
  }
  return NextResponse.json({ pinned });
}
