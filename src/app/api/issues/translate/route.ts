import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { translateText } from "@/lib/deepseek";

// POST /api/issues/translate — 把工单问题描述翻译成中文（结果缓存在 description_zh，同一条不重复翻译）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少工单ID" }, { status: 400 });

  const db = getDb();
  const issue = db.prepare("SELECT id, description, description_zh FROM issue_tickets WHERE id = ?").get(id) as
    { id: number; description: string; description_zh: string } | undefined;
  if (!issue) return NextResponse.json({ error: "工单不存在" }, { status: 404 });

  // 已有缓存直接返回，不重复翻译
  if (issue.description_zh) {
    return NextResponse.json({ description_zh: issue.description_zh, cached: true });
  }

  const text = (issue.description || "").trim();
  if (!text) return NextResponse.json({ error: "问题描述为空" }, { status: 400 });

  try {
    const zh = await translateText(text, "中文");
    db.prepare("UPDATE issue_tickets SET description_zh = ? WHERE id = ?").run(zh, id);
    return NextResponse.json({ description_zh: zh, cached: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "翻译失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
