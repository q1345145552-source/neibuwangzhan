import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 打字提示：前端输入时上报「我正在输入」，并轮询「对方正在输入」。
// scope_key 形如 direct:会话id 或 group:群id。

// POST /api/chat/typing — 上报我正在输入（body: { scope_key }）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await readJson(req);
  const scopeKey = String(body?.scope_key || "").trim();
  if (!scopeKey.startsWith("direct:") && !scopeKey.startsWith("group:")) {
    return NextResponse.json({ error: "scope_key 无效" }, { status: 400 });
  }

  const db = getDb();
  const now = new Date().toISOString().replace("T", " ").split(".")[0];
  db.prepare(
    "INSERT INTO typing_status (user_name, scope_key, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_name, scope_key) DO UPDATE SET updated_at = excluded.updated_at"
  ).run(auth.name, scopeKey, now);
  return NextResponse.json({ success: true });
}

// GET /api/chat/typing?scope_key=X — 最近 3 秒内在输入的其他人
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const scopeKey = (new URL(req.url).searchParams.get("scope_key") || "").trim();
  if (!scopeKey) return NextResponse.json({ users: [] });

  const db = getDb();
  const rows = db.prepare(
    "SELECT user_name FROM typing_status WHERE scope_key = ? AND user_name != ? AND updated_at >= datetime('now', '-3 seconds')"
  ).all(scopeKey, auth.name) as { user_name: string }[];
  return NextResponse.json({ users: rows.map((r) => r.user_name) });
}
