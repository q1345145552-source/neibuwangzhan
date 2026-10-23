import { publishBossSubmission } from "@/lib/boss-submissions";
import { completeMeetingTodos } from "@/lib/meeting-todos";
import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { MEETING_REFLECTION_REVIEW_TITLE } from "@/lib/notification-types";

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
  const body = await readJson(req);
  const { action } = body;
  if (action === "reject" && auth.role !== "admin") return NextResponse.json({ error: "仅管理员可退回" }, { status: 403 });
  const db = getDb();

  if (action === "reject") {
    const reason = typeof body.rejection_reason === "string" ? body.rejection_reason.trim() : "";
    if (!reason) return NextResponse.json({ error: "请填写退回原因" }, { status: 400 });
    return db.transaction(() => {
      const reflection = db.prepare("SELECT * FROM meeting_reflections WHERE id = ? AND meeting_id = ?").get(rid, id) as any;
      if (!reflection) return NextResponse.json({ error: "心得不存在" }, { status: 404 });
      if (reflection.status !== "已提交") return NextResponse.json({ error: "该心得不是已提交状态" }, { status: 400 });
      if (typeof reflection.employee_name !== "string" || !reflection.employee_name.trim()) return NextResponse.json({ error: "提交人信息无效" }, { status: 409 });
      if (["updated_at", "content", "images"].some(key => body.submission && body.submission[key] !== (reflection[key] || ""))) return NextResponse.json({ error: "心得已更新，请重新打开后审核" }, { status: 409 });
      const meeting = db.prepare("SELECT title FROM meetings WHERE id = ?").get(reflection.meeting_id) as { title: string } | undefined;
      if (!meeting) return NextResponse.json({ error: "会议不存在" }, { status: 404 });
      const changed = db.prepare("UPDATE meeting_reflections SET status = '退回', rejection_reason = ?, updated_at = datetime('now') WHERE id = ? AND meeting_id = ? AND status = '已提交'").run(reason, reflection.id, reflection.meeting_id);
      if (changed.changes !== 1) return NextResponse.json({ error: "心得状态已变化，请刷新后重试" }, { status: 409 });
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "", MEETING_REFLECTION_REVIEW_TITLE, `${auth.name}退回了你在会议「${meeting.title}」提交的心得。\n退回原因：${reason}\n请修改心得后重新提交。`,
        reflection.employee_name, String(reflection.id), "meeting_reflection_review"
      );
      logOperation(auth.name, "退回会议心得", "meeting_reflection", String(reflection.id), String(reflection.employee_name));
      return NextResponse.json(db.prepare("SELECT * FROM meeting_reflections WHERE id = ?").get(reflection.id));
    }).immediate();
  }

  const reflection = db.prepare("SELECT * FROM meeting_reflections WHERE id = ? AND meeting_id = ?").get(rid, id) as any;
  if (!reflection) return NextResponse.json({ error: "心得不存在" }, { status: 404 });

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
