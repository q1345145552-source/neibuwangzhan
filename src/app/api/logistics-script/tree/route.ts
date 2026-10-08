import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";

// GET /api/logistics-script/tree — 话术模板三层结构（分类 → 问题 → 话术），员工和管理员都能看
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const categories = db.prepare("SELECT * FROM logistics_script_categories ORDER BY sort_order ASC, id ASC").all() as any[];
  const questions = db.prepare("SELECT * FROM logistics_script_questions ORDER BY sort_order ASC, id ASC").all() as any[];
  const scripts = db.prepare("SELECT * FROM logistics_scripts ORDER BY sort_order ASC, id ASC").all() as any[];

  const tree = categories.map((cat) => ({
    ...cat,
    questions: questions
      .filter((q) => q.category_id === cat.id)
      .map((q) => ({
        ...q,
        scripts: scripts.filter((s) => s.question_id === q.id),
      })),
  }));

  return NextResponse.json({ categories: tree });
}
