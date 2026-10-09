import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/rules/[id]/update — 管理员发起规则更新
// 相当于发一条新的长通知（内容是新的规则），接收人默认全体也可选；
// 员工复述确认后，管理员再在规则库点「更新覆盖」。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可更新规则" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as any;
  if (!rule) return NextResponse.json({ error: "规则不存在" }, { status: 404 });

  const body = await readJson(req);
  const { title, body: content, recipients, deadline } = body;
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写新规则内容" }, { status: 400 });
  if (!deadline || !String(deadline).trim()) return NextResponse.json({ error: "请填写截止时间" }, { status: 400 });

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

  const finalTitle = title && String(title).trim() ? String(title).trim() : rule.title;

  // 同一规则同一时间只保留一个待覆盖更新：先解绑旧的待覆盖通知
  db.prepare("UPDATE announcements SET rule_id = NULL WHERE rule_id = ?").run(id);

  const r = db.prepare(
    "INSERT INTO announcements (title, body, attachments, type, deadline, rule_id, created_by) VALUES (?, ?, '[]', '长通知', ?, ?, ?)"
  ).run(finalTitle, String(content), String(deadline).trim(), Number(id), auth.name);
  const announcementId = Number(r.lastInsertRowid);

  const insRec = db.prepare("INSERT INTO announcement_recipients (announcement_id, employee_name, status) VALUES (?, ?, '待读')");
  for (const name of recipientNames) insRec.run(announcementId, name);

  logOperation(auth.name, "发起规则更新", "rule", String(id), finalTitle);
  return NextResponse.json(db.prepare("SELECT * FROM announcements WHERE id = ?").get(announcementId), { status: 201 });
}
