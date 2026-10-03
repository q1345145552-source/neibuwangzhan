import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 会话置顶：每个用户各自维护自己的置顶列表（scope_key 形如 direct:姓名 / group:群id）

// GET /api/chat/pins — 我的置顶会话列表
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const db = getDb();
  const rows = db.prepare(
    "SELECT scope_key FROM pinned_conversations WHERE user_name = ? ORDER BY pinned_at ASC, id ASC"
  ).all(auth.name) as { scope_key: string }[];
  return NextResponse.json({ pins: rows.map((r) => r.scope_key) });
}

// POST /api/chat/pins — 置顶（body: { scope_key }）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const body = await readJson(req);
  const scopeKey = String(body?.scope_key || "").trim();
  if (!scopeKey.startsWith("direct:") && !scopeKey.startsWith("group:")) {
    return NextResponse.json({ error: "scope_key 无效" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO pinned_conversations (user_name, scope_key) VALUES (?, ?)").run(auth.name, scopeKey);
  return NextResponse.json({ success: true, scope_key: scopeKey });
}

// DELETE /api/chat/pins — 取消置顶（body: { scope_key }）
export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可用" }, { status: 403 });

  const body = await readJson(req);
  const scopeKey = String(body?.scope_key || "").trim();
  if (!scopeKey) return NextResponse.json({ error: "缺少 scope_key" }, { status: 400 });

  const db = getDb();
  db.prepare("DELETE FROM pinned_conversations WHERE user_name = ? AND scope_key = ?").run(auth.name, scopeKey);
  return NextResponse.json({ success: true });
}
