import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// POST /api/announcements/[id]/to-rule — 长通知转成规则（仅管理员，仅长通知）
// 标题 = 通知标题，内容 = 通知正文；转成后该通知标记 converted_rule_id 防止重复转。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可转成规则" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const ann = db.prepare("SELECT * FROM announcements WHERE id = ?").get(id) as any;
  if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  if (ann.type !== "长通知") return NextResponse.json({ error: "只有长通知能转成规则" }, { status: 400 });
  if (ann.converted_rule_id) return NextResponse.json({ error: "该通知已转成规则" }, { status: 400 });

  const r = db.prepare(
    "INSERT INTO rules (title, content, created_by) VALUES (?, ?, ?)"
  ).run(ann.title, ann.body, auth.name);
  const ruleId = Number(r.lastInsertRowid);

  db.prepare("UPDATE announcements SET converted_rule_id = ? WHERE id = ?").run(ruleId, Number(id));
  logOperation(auth.name, "长通知转规则", "rule", String(ruleId), String(ann.title));
  return NextResponse.json(db.prepare("SELECT * FROM rules WHERE id = ?").get(ruleId), { status: 201 });
}
