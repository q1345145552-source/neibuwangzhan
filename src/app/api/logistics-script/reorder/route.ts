import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// POST /api/logistics-script/reorder — 上移/下移排序（分类/问题/话术），仅管理员
// body: { type: 'category'|'question'|'script', id, direction: 'up'|'down' }
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可排序" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const type = body?.type;
  const id = Number(body?.id);
  const direction = body?.direction;
  if (!["category", "question", "script"].includes(type)) return NextResponse.json({ error: "无效的类型" }, { status: 400 });
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  if (direction !== "up" && direction !== "down") return NextResponse.json({ error: "无效的方向" }, { status: 400 });

  let siblings: { id: number }[];
  if (type === "category") {
    siblings = db.prepare("SELECT id FROM logistics_script_categories ORDER BY sort_order ASC, id ASC").all() as { id: number }[];
  } else if (type === "question") {
    const q = db.prepare("SELECT category_id FROM logistics_script_questions WHERE id = ?").get(id) as { category_id: number } | undefined;
    if (!q) return NextResponse.json({ error: "问题不存在" }, { status: 404 });
    siblings = db.prepare("SELECT id FROM logistics_script_questions WHERE category_id = ? ORDER BY sort_order ASC, id ASC").all(q.category_id) as { id: number }[];
  } else {
    const s = db.prepare("SELECT question_id FROM logistics_scripts WHERE id = ?").get(id) as { question_id: number } | undefined;
    if (!s) return NextResponse.json({ error: "话术不存在" }, { status: 404 });
    siblings = db.prepare("SELECT id FROM logistics_scripts WHERE question_id = ? ORDER BY sort_order ASC, id ASC").all(s.question_id) as { id: number }[];
  }

  const idx = siblings.findIndex((x) => x.id === id);
  if (idx < 0) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (target < 0 || target >= siblings.length) {
    return NextResponse.json({ success: true, noop: true }); // 已在边界
  }
  [siblings[idx], siblings[target]] = [siblings[target], siblings[idx]];

  const table = type === "category" ? "logistics_script_categories" : type === "question" ? "logistics_script_questions" : "logistics_scripts";
  const upd = db.prepare(`UPDATE ${table} SET sort_order = ? WHERE id = ?`);
  siblings.forEach((s, i) => upd.run(i, s.id));
  return NextResponse.json({ success: true });
}
