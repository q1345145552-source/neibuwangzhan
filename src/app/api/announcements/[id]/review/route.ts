import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { ANNOUNCEMENT_RETELL_REJECTED } from "@/lib/announcement-feedback";

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

  if (action === "reject") {
    if (!comment) return NextResponse.json({ error: "打回必须填写批注" }, { status: 400 });
    return db.transaction(() => {
      const announcement = db.prepare("SELECT id, title, recalled FROM announcements WHERE id = ?").get(id) as { id: number; title: string; recalled: number } | undefined;
      if (!announcement) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
      if (announcement.recalled) return NextResponse.json({ error: "该通知已撤回，无法打回复述" }, { status: 409 });
      const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, employeeName) as any;
      if (!rec) return NextResponse.json({ error: "该员工不在接收人中" }, { status: 404 });
      if (body.recipient_id !== undefined && String(body.recipient_id) !== String(rec.id)) return NextResponse.json({ error: "接收记录不匹配，请重新打开复述" }, { status: 409 });
      if (rec.status !== "已复述待确认") return NextResponse.json({ error: "只有已复述待确认的记录可以打回，请刷新后重试" }, { status: 409 });
      // 新页面带上看过的提交快照；旧调用仍兼容，快照只用于防止覆盖后来重交的内容。
      if (["updated_at", "retell_th", "retell_zh"].some(key => body.submission && body.submission[key] !== (rec[key] || ""))) {
        return NextResponse.json({ error: "复述已更新，请重新打开后审核" }, { status: 409 });
      }
      const changed = db.prepare("UPDATE announcement_recipients SET status = '需重述', reject_comment = ?, updated_at = datetime('now') WHERE id = ? AND status = '已复述待确认'").run(comment, rec.id);
      if (changed.changes !== 1) return NextResponse.json({ error: "复述状态已变化，请刷新后重试" }, { status: 409 });
      db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)").run(
        "老板通知", `复述被打回：${announcement.title}`,
        `${auth.name}打回了你对通知「${announcement.title}」的复述。\n原因：${comment}\n请重新复述并提交。`,
        rec.employee_name, `${announcement.id}:${rec.id}`, ANNOUNCEMENT_RETELL_REJECTED
      );
      logOperation(auth.name, "通知复述打回", "announcement_recipient", String(rec.id), employeeName);
      return NextResponse.json(db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(rec.id));
    }).immediate();
  }

  const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, employeeName) as any;
  if (!rec) return NextResponse.json({ error: "该员工不在接收人中" }, { status: 404 });

  if (action === "confirm") {
    db.prepare("UPDATE announcement_recipients SET status = '已确认', updated_at = datetime('now') WHERE id = ?").run(rec.id);
  }
  logOperation(auth.name, action === "confirm" ? "通知复述确认" : "通知复述打回", "announcement_recipient", String(rec.id), employeeName);
  return NextResponse.json(db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(rec.id));
}
