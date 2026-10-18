import { publishBossSubmission } from "@/lib/boss-submissions";
import { completeMeetingTodos } from "@/lib/meeting-todos";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

function parseList(raw: unknown): string[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch {}
  }
  return arr.map((s: unknown) => String(s).trim()).filter(Boolean);
}

// PATCH /api/meetings/[id]/reflections/[rid] — 老板退回 / 员工退回后重新提交
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rid: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id, rid } = await params;
  const db = getDb();
  const reflection = db.prepare("SELECT * FROM meeting_reflections WHERE id = ? AND meeting_id = ?").get(rid, id) as any;
  if (!reflection) return NextResponse.json({ error: "心得不存在" }, { status: 404 });

  const body = await readJson(req);
  const { action } = body;

  // 老板退回
  if (action === "reject") {
    if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可退回" }, { status: 403 });
    if (reflection.status !== "已提交") return NextResponse.json({ error: "该心得不是已提交状态" }, { status: 400 });
    db.prepare("UPDATE meeting_reflections SET status = '退回', updated_at = datetime('now') WHERE id = ?").run(reflection.id);
    logOperation(auth.name, "退回会议心得", "meeting_reflection", String(reflection.id), String(reflection.employee_name));
    return NextResponse.json(db.prepare("SELECT * FROM meeting_reflections WHERE id = ?").get(reflection.id));
  }

  // 员工重新提交（退回后编辑再提交）
  if (reflection.employee_name !== auth.name) return NextResponse.json({ error: "只能改自己的心得" }, { status: 403 });
  if (reflection.status !== "退回") return NextResponse.json({ error: "只有退回的心得能修改" }, { status: 400 });

  const { content, images } = body;
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写心得内容" }, { status: 400 });
  const imgUrls = [...new Set(parseList(images))];

  const submitted = db.transaction(() => {
    const saved = db.prepare(
    "UPDATE meeting_reflections SET content = ?, content_zh = '', images = ?, status = '已提交', updated_at = datetime('now') WHERE id = ? AND status = '退回'"
  ).run(String(content).trim(), JSON.stringify(imgUrls), reflection.id);
    if (saved.changes) {
      publishBossSubmission(db, "meeting", reflection.id, auth.name, `重新提交了会议心得（会议 #${id}）`);
      completeMeetingTodos(db, auth.name, reflection.meeting_id);
    }
    return saved.changes;
  })();
  if (!submitted) return NextResponse.json({ error: "心得状态已变化，请刷新后重试" }, { status: 409 });
  logOperation(auth.name, "重新提交会议心得", "meeting_reflection", String(reflection.id));
  return NextResponse.json(db.prepare("SELECT * FROM meeting_reflections WHERE id = ?").get(reflection.id));
}

// DELETE /api/meetings/[id]/reflections/[rid] — 员工删除自己的心得
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; rid: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id, rid } = await params;
  const db = getDb();
  const reflection = db.prepare("SELECT * FROM meeting_reflections WHERE id = ? AND meeting_id = ?").get(rid, id) as any;
  if (!reflection) return NextResponse.json({ error: "心得不存在" }, { status: 404 });
  if (reflection.employee_name !== auth.name) return NextResponse.json({ error: "只能删自己的心得" }, { status: 403 });

  db.prepare("DELETE FROM meeting_reflections WHERE id = ?").run(reflection.id);
  logOperation(auth.name, "删除会议心得", "meeting_reflection", String(reflection.id));
  return NextResponse.json({ success: true });
}
