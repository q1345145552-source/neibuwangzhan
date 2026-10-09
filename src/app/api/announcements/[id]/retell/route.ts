import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

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

  const ann = db.prepare("SELECT recalled FROM announcements WHERE id = ?").get(id) as any;
  if (!ann) return NextResponse.json({ error: "通知不存在" }, { status: 404 });
  if (ann.recalled) return NextResponse.json({ error: "该通知已撤回，无法复述" }, { status: 400 });

  const rec = db.prepare("SELECT * FROM announcement_recipients WHERE announcement_id = ? AND employee_name = ?").get(id, auth.name) as any;
  if (!rec) return NextResponse.json({ error: "你不在该通知的接收人中" }, { status: 404 });

  db.prepare(
    "UPDATE announcement_recipients SET retell_th = ?, retell_zh = ?, status = '已复述待确认', updated_at = datetime('now') WHERE id = ?"
  ).run(retellTh, retellZh, rec.id);
  logOperation(auth.name, "复述通知", "announcement_recipient", String(rec.id));
  return NextResponse.json(db.prepare("SELECT * FROM announcement_recipients WHERE id = ?").get(rec.id));
}
