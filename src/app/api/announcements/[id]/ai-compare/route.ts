import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { compareRetell } from "@/lib/deepseek";

// POST /api/announcements/[id]/ai-compare — 管理员用 AI 比对员工复述
// body: { employee_name }
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const employeeName = String(body?.employee_name || "").trim();

  if (!employeeName) return NextResponse.json({ error: "缺少员工名" }, { status: 400 });

  const announcement = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!announcement) return NextResponse.json({ error: "通知不存在" }, { status: 404 });

  const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, employeeName) as any;
  if (!rec) return NextResponse.json({ error: "该员工不在接收人中" }, { status: 404 });
  if (!rec.retell_zh || !String(rec.retell_zh).trim()) return NextResponse.json({ error: "该员工还没有中文复述" }, { status: 400 });

  try {
    const result = await compareRetell(announcement.body, rec.retell_zh);
    return NextResponse.json({ conclusion: result.conclusion });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 比对失败";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
