import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// POST /api/rules/[id]/apply — 管理员「更新覆盖」
// 员工都确认后，把待覆盖通知的内容写进规则；旧内容不删，存成历史记录。
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可覆盖规则" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const rule = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as any;
  if (!rule) return NextResponse.json({ error: "规则不存在" }, { status: 404 });

  const pending = db.prepare("SELECT * FROM announcements WHERE rule_id = ? ORDER BY id DESC LIMIT 1").get(id) as any;
  if (!pending) return NextResponse.json({ error: "没有待覆盖的更新" }, { status: 400 });

  const total = (db.prepare("SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ?").get(pending.id) as any).c;
  const confirmed = (db.prepare("SELECT COUNT(*) AS c FROM announcement_recipients WHERE announcement_id = ? AND status = '已确认'").get(pending.id) as any).c;
  if (total === 0 || confirmed < total) {
    return NextResponse.json({ error: `还有 ${total - confirmed} 名员工未确认，暂不能覆盖` }, { status: 400 });
  }

  db.transaction(() => {
    // 旧内容存历史
    db.prepare("INSERT INTO rule_history (rule_id, title, content, changed_by) VALUES (?, ?, ?, ?)").run(Number(id), rule.title, rule.content, auth.name);
    // 新内容覆盖
    db.prepare("UPDATE rules SET content = ?, updated_at = datetime('now') WHERE id = ?").run(pending.body, Number(id));
    // 解绑待覆盖通知
    db.prepare("UPDATE announcements SET rule_id = NULL WHERE id = ?").run(pending.id);
  })();

  logOperation(auth.name, "覆盖规则", "rule", String(id), String(rule.title));
  const updated = db.prepare("SELECT * FROM rules WHERE id = ?").get(id) as any;
  const history = db.prepare("SELECT * FROM rule_history WHERE rule_id = ? ORDER BY id DESC").all(id) as any[];
  return NextResponse.json({ rule: updated, history });
}
