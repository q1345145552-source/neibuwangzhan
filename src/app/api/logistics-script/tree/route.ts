import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/logistics-script/tree — 话术模板三层结构 + 当前客服的置顶/最近使用 + 每条话术复制次数
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const categories = db.prepare("SELECT * FROM logistics_script_categories ORDER BY sort_order ASC, id ASC").all() as any[];
  const questions = db.prepare("SELECT * FROM logistics_script_questions ORDER BY sort_order ASC, id ASC").all() as any[];
  const scripts = db.prepare("SELECT * FROM logistics_scripts ORDER BY sort_order ASC, id ASC").all() as any[];

  // 每条话术的复制次数（所有人可见）
  const copyCount = new Map<number, number>();
  (db.prepare("SELECT script_id, COUNT(*) AS c FROM logistics_script_copy_logs GROUP BY script_id").all() as { script_id: number; c: number }[])
    .forEach((r) => copyCount.set(r.script_id, r.c));

  // 拼 script 引用（脚本 + 所属问题 + 所属分类名）
  const qMap = new Map<number, any>(questions.map((q) => [q.id, q]));
  const cMap = new Map<number, any>(categories.map((c) => [c.id, c]));
  const refOf = (s: any) => {
    const q = qMap.get(s.question_id);
    return {
      script: { ...s, copy_count: copyCount.get(s.id) || 0 },
      question: q?.question || "",
      category_name: cMap.get(q?.category_id)?.name || "",
    };
  };

  // 当前客服的置顶（按置顶时间倒序）
  const pinned = (db.prepare(
    "SELECT p.script_id, p.created_at AS pin_at FROM logistics_script_pins p WHERE p.user_name = ? ORDER BY p.id DESC"
  ).all(auth.name) as { script_id: number; pin_at: string }[])
    .map((p) => {
      const s = scripts.find((x) => x.id === p.script_id);
      return s ? refOf(s) : null;
    })
    .filter(Boolean);

  // 当前客服的最近使用（按复制时间倒序去重，取最近 10 条）
  const recentScriptIds: number[] = [];
  const recentRows = db.prepare(
    "SELECT script_id FROM logistics_script_copy_logs WHERE user_name = ? ORDER BY id DESC LIMIT 200"
  ).all(auth.name) as { script_id: number }[];
  for (const r of recentRows) {
    if (!recentScriptIds.includes(r.script_id)) recentScriptIds.push(r.script_id);
    if (recentScriptIds.length >= 10) break;
  }
  const recent = recentScriptIds
    .map((id) => {
      const s = scripts.find((x) => x.id === id);
      return s ? refOf(s) : null;
    })
    .filter(Boolean);

  const tree = categories.map((cat) => ({
    ...cat,
    questions: questions
      .filter((q) => q.category_id === cat.id)
      .map((q) => ({
        ...q,
        scripts: scripts
          .filter((s) => s.question_id === q.id)
          .map((s) => ({ ...s, copy_count: copyCount.get(s.id) || 0 })),
      })),
  }));

  return NextResponse.json({ categories: tree, pinned, recent });
}
