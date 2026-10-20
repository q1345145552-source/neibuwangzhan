import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";

type Row = { id: string; source_order_no: string; internal_order_id: string | null; step_order: number; step_name: string; public_name: string;
  assignee: string; stars: number; comment: string; points: number; customer_name: string; rated_at: string };

/**
 * 客户评价（员工评价表，2026-10-20 老板 3A 4A）：客户在业务系统给每一步打的分。
 * 管理员看全部；员工只看评到自己（那一步经办人里有自己）的。
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可查看" }, { status: 403 });
  const db = getDb();
  // 员工只看评到自己的：在库里先筛再取最近的，不能先取全公司最近 2000 条再筛（别人评价多了自己的就被挤掉）
  const isAdmin = auth.role === "admin";
  const rows = db.prepare(`SELECT id, source_order_no, internal_order_id, step_order, step_name, public_name, assignee, stars, comment, points, customer_name, rated_at
    FROM step_ratings ${isAdmin ? "" : "WHERE instr('、' || assignee || '、', '、' || ? || '、') > 0"} ORDER BY rated_at DESC, received_at DESC LIMIT 2000`)
    .all(...(isAdmin ? [] : [auth.name || "\u0000"])) as Row[];
  // 按人汇总：几次评价、平均几星、积分合计（一步几个人的，每人都算一次）
  const byPerson = new Map<string, { person: string; count: number; stars: number; points: number; low: number }>();
  for (const r of rows) {
    for (const person of r.assignee ? r.assignee.split("、") : ["（没写经办人）"]) {
      if (auth.role !== "admin" && person !== auth.name) continue;
      const p = byPerson.get(person) ?? { person, count: 0, stars: 0, points: 0, low: 0 };
      p.count++; p.stars += r.stars; p.points += r.assignee ? r.points : 0; if (r.stars <= 2) p.low++;
      byPerson.set(person, p);
    }
  }
  const summary = [...byPerson.values()].map(p => ({ ...p, avg: Math.round(p.stars / p.count * 10) / 10 })).sort((a, b) => b.count - a.count);
  return NextResponse.json({ ratings: rows.slice(0, 500), summary, is_admin: isAdmin });
}
