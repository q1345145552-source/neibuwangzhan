import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { ANNOUNCEMENT_RETELL_SUBMITTED } from "@/lib/announcement-feedback";

// PATCH /api/announcements/[id]/retell — 员工提交复述（泰语 + 中文都必填）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "employee") return NextResponse.json({ error: "仅员工可复述" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const retellTh = String(body?.retell_th || "").trim();
  const retellZh = String(body?.retell_zh || "").trim();
  if (!retellTh) return NextResponse.json({ error: "请填写泰语复述" }, { status: 400 });
  if (!retellZh) return NextResponse.json({ error: "请填写中文复述" }, { status: 400 });

  return db.transaction(() => {
    const ann = db.prepare("SELECT id, title, recalled FROM announcements WHERE id = ?").get(id) as any;
    if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
    if (ann.recalled) return NextResponse.json({ error: "该通知已撤回，无法复述" }, { status: 400 });

    const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, auth.name) as any;
    if (!rec) return NextResponse.json({ error: "你不在该通知的接收人中" }, { status: 404 });
    // 网络重试按已成功处理返回；等待审核、已确认的复述不能被重复覆盖。
    if (rec.status === "已复述待确认" && rec.retell_th === retellTh && rec.retell_zh === retellZh) return NextResponse.json(rec);
    if (!["待读", "已读待复述", "需重述"].includes(rec.status)) return NextResponse.json({ error: "当前状态无法提交复述，请刷新后重试" }, { status: 409 });

    const changed = db.prepare(
      "UPDATE announcement_recipients SET retell_th = ?, retell_zh = ?, status = '已复述待确认', updated_at = datetime('now') WHERE id = ? AND status = ?"
    ).run(retellTh, retellZh, rec.id, rec.status);
    if (changed.changes !== 1) return NextResponse.json({ error: "复述状态已变化，请刷新后重试" }, { status: 409 });

    const submission = rec.status === "需重述" ? "重新提交" : "首次提交";
    // 与系统现有员工提交提醒采用同一在岗管理员口径，不只提醒通知发布人。
    const bosses = db.prepare("SELECT DISTINCT name FROM employees WHERE role='admin' AND status IN ('在职','试用期','待离职') AND name<>''").all() as { name: string }[];
    const insert = db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)");
    for (const boss of bosses) insert.run(
      "老板通知", `复述${submission}：${ann.title}`,
      `${auth.name}${submission}了通知「${ann.title}」的复述，请查看并审核。`,
      boss.name, `${ann.id}:${rec.id}`, ANNOUNCEMENT_RETELL_SUBMITTED
    );
    logOperation(auth.name, "复述通知", "announcement_recipient", String(rec.id));
    return NextResponse.json(db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(rec.id));
  }).immediate();
}
