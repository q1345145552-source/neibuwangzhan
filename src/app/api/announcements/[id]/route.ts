import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { clearAnnouncementOverdueTodos, syncAnnouncementOverdueTodos } from "@/lib/announcement-overdue";

// GET /api/announcements/[id] — 通知详情；员工打开即把「待读」改成「已读待复述」
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const announcement = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!announcement) return NextResponse.json({ error: "通知不存在" }, { status: 404 });

  let myRecipient: any = null;
  if (auth.role === "employee") {
    myRecipient = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, auth.name) as any;
    // 已撤回的通知不再标记已读（保持原状态，前端显示已撤回）
    if (myRecipient && myRecipient.status === "待读" && !announcement.recalled) {
      db.prepare("UPDATE announcement_recipients SET status = '已读待复述', updated_at = datetime('now') WHERE id = ?").run(myRecipient.id);
      myRecipient = db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(myRecipient.id);
    }
  }

  const recipients = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? ORDER BY id ASC").all(id) as any[];

  return NextResponse.json({ ...announcement, my_recipient: myRecipient, recipients });
}

// PATCH /api/announcements/[id] — 管理员编辑通知（改标题/正文/附件/类型/截止时间/接收人）
// 编辑后所有保留员工的复述状态重置为待读，复述内容/打回批注清空；
// 新增员工生成待读记录，移除员工删记录；逾期待办清掉按新截止时间重新判定。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可编辑通知" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const ann = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  if (ann.created_by !== auth.name) return NextResponse.json({ error: "只能编辑自己发的通知" }, { status: 403 });

  const body = await readJson(req);
  const { title, body: content, attachments, type, deadline, recipients } = body;

  if (!title || !String(title).trim()) return NextResponse.json({ error: "请填写标题" }, { status: 400 });
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写正文" }, { status: 400 });
  if (!deadline || !String(deadline).trim()) return NextResponse.json({ error: "请填写截止时间" }, { status: 400 });
  const enumErr = validateEnums({ "announcements.type": type });
  if (enumErr) return NextResponse.json({ error: enumErr }, { status: 400 });

  // 接收人：'all' 表示全体在职员工；否则是员工名数组
  let recipientNames: string[];
  if (recipients === "all") {
    recipientNames = (db.prepare("SELECT name FROM employees WHERE role = 'employee' AND status = '在职'").all() as { name: string }[]).map((e) => e.name);
  } else if (Array.isArray(recipients)) {
    recipientNames = recipients.map((s) => String(s).trim()).filter(Boolean);
  } else {
    return NextResponse.json({ error: "请选择接收人" }, { status: 400 });
  }
  recipientNames = [...new Set(recipientNames)];
  if (recipientNames.length === 0) return NextResponse.json({ error: "请选择接收人" }, { status: 400 });

  const attachmentsJson = Array.isArray(attachments)
    ? JSON.stringify(attachments.filter((s: unknown) => typeof s === "string" && s.trim()).map((s: string) => s.trim()))
    : "[]";

  db.prepare(
    "UPDATE announcements SET title = ?, body = ?, attachments = ?, type = ?, deadline = ? WHERE id = ?"
  ).run(String(title).trim(), String(content), attachmentsJson, type || "短通知", String(deadline).trim(), id);

  // 接收人差异处理
  const current = (db.prepare("SELECT employee_name FROM announcement_recipients WHERE announcement_id = ?").all(id) as { employee_name: string }[]).map((r) => r.employee_name);
  const currentSet = new Set(current);
  const newSet = new Set(recipientNames);
  const retained = current.filter((n) => newSet.has(n));
  const added = recipientNames.filter((n) => !currentSet.has(n));
  const removed = current.filter((n) => !newSet.has(n));

  const resetRec = db.prepare("UPDATE announcement_recipients SET status = '待读', retell_content = '', retell_th = '', retell_zh = '', reject_comment = '', updated_at = datetime('now') WHERE announcement_id = ? AND employee_name = ?");
  for (const name of retained) resetRec.run(id, name);

  const insRec = db.prepare("INSERT INTO announcement_recipients (announcement_id, employee_name, status) VALUES (?, ?, '待读')");
  for (const name of added) insRec.run(id, name);

  const delRec = db.prepare("DELETE FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?");
  for (const name of removed) delRec.run(id, name);

  // 清掉该通知之前的逾期待办，按新截止时间重新判定
  clearAnnouncementOverdueTodos(Number(id));
  syncAnnouncementOverdueTodos(auth.name);

  logOperation(auth.name, "编辑通知", "announcement", String(id), String(title));
  const updated = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  const recipients2 = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? ORDER BY id ASC").all(id) as any[];
  return NextResponse.json({ ...updated, recipients: recipients2 });
}

// DELETE /api/announcements/[id] — 管理员删除通知（彻底删除，员工那边也看不到）
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可删除通知" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const ann = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  if (ann.created_by !== auth.name) return NextResponse.json({ error: "只能删除自己发的通知" }, { status: 403 });

  clearAnnouncementOverdueTodos(Number(id));
  db.prepare("DELETE FROM announcement_recipients WHERE announcement_id = ?").run(id);
  db.prepare("DELETE FROM announcements WHERE id = ?").run(id);
  logOperation(auth.name, "删除通知", "announcement", String(id), String(ann.title));
  return NextResponse.json({ success: true });
}
