import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { analyzeLeave } from "@/lib/leave-ai";

// POST /api/leave/analyze — 分析一次请假（正常/疑似异常），结果缓存，同一条不重复分析（仅管理员）
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少请假ID" }, { status: 400 });

  try {
    const result = await analyzeLeave(db, id);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 分析失败";
    if (msg === "请假记录不存在") return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
