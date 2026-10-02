import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/employees/background — 员工设置自己的聊天背景（body: { background }）
// background 取值：空串（恢复默认）/ 预设 key（如 green）/ 站内图片 URL（/api/files/...）
// 任何人只能改自己的背景，各看各的、互不影响。
export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const body = await readJson(req);
  const background = String(body?.background ?? "").trim();
  if (background && !background.startsWith("/api/files/") && !/^[a-z0-9_-]+$/.test(background)) {
    return NextResponse.json({ error: "背景值无效" }, { status: 400 });
  }

  const db = getDb();
  db.prepare("UPDATE employees SET chat_background = ? WHERE id = ?").run(background, auth.id);
  return NextResponse.json({ success: true, background });
}
