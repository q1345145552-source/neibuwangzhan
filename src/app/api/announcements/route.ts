import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { syncAnnouncementOverdueTodos } from "@/lib/announcement-overdue";

// 通知（老板向下发工作交代）：
// GET 管理员看全部，员工看发给自己的；POST 仅管理员发送。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const isAdmin = auth.role === "admin";
  if (isAdmin) {
    // 管理员打开通知页面：顺带检测一遍逾期待办（生成/清理）
    syncAnnouncementOverdueTodos(auth.name);
  }
  let announcements: any[];
  if (isAdmin) {
    announcements = db.prepare("SELECT * FROM announcements ORDER BY id DESC").all() as any[];
  } else {
    announcements = db.prepare(
      "SELECT a.* FROM announcements a JOIN announcement_recipients r ON r.announcement_id = a.id WHERE r.employee_name = ? ORDER BY a.id DESC"
    ).all(auth.name) as any[];
  }

  const recipientsStmt = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? ORDER BY id ASC");
  const result = announcements.map((a) => ({
    ...a,
    recipients: recipientsStmt.all(a.id),
  }));
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可发通知" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { title, body: content, attachments, type, recipients, deadline } = body;

  if (!title || !String(title).trim()) return NextResponse.json({ error: "请填写标题" }, { status: 400 });
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写正文" }, { status: 400 });
  if (!deadline || !String(deadline).trim()) return NextResponse.json({ error: "请填写截止时间" }, { status: 400 });
  const _e = validateEnums({ "announcements.type": type });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

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

  const r = db.prepare(
    "INSERT INTO announcements (title, body, attachments, type, deadline, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(String(title).trim(), String(content), attachmentsJson, type || "短通知", String(deadline).trim(), auth.name);
  const announcementId = Number(r.lastInsertRowid);

  const insRec = db.prepare("INSERT INTO announcement_recipients (announcement_id, employee_name, status) VALUES (?, ?, '待读')");
  const insNotif = db.prepare("INSERT INTO notifications (type, title, body, recipient, related_id, related_type) VALUES (?, ?, ?, ?, ?, ?)");
  for (const name of recipientNames) {
    insRec.run(announcementId, name);
    insNotif.run("老板通知", "老板给你发了通知", `老板通知「${String(title).trim()}」，请去复述`, name, String(announcementId), "announcement");
  }
  logOperation(auth.name, "发送通知", "announcement", String(announcementId), String(title));
  return NextResponse.json(db.prepare("SELECT * FROM announcements WHERE id = ?").get(announcementId), { status: 201 });
}
