import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/announcements/[id]/review — 管理员标「对/不对」
// body: { employee_name, action: 'confirm'|'reject', comment? }
export async function PATCH(
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
  const action = body?.action;
  const comment = String(body?.comment || "").trim();

  if (!employeeName) return NextResponse.json({ error: "缺少员工名" }, { status: 400 });
  if (action !== "confirm" && action !== "reject") return NextResponse.json({ error: "无效的操作" }, { status: 400 });

  const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, employeeName) as any;
  if (!rec) return NextResponse.json({ error: "该员工不在接收人中" }, { status: 404 });

  if (action === "confirm") {
    db.prepare("UPDATE announcement_recipients SET status = '已确认', updated_at = datetime('now') WHERE id = ?").run(rec.id);
  } else {
    if (!comment) return NextResponse.json({ error: "打回必须填写批注" }, { status: 400 });
    db.prepare("UPDATE announcement_recipients SET status = '需重述', reject_comment = ?, updated_at = datetime('now') WHERE id = ?").run(comment, rec.id);
  }
  logOperation(auth.name, action === "confirm" ? "通知复述确认" : "通知复述打回", "announcement_recipient", String(rec.id), employeeName);
  return NextResponse.json(db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(rec.id));
}
