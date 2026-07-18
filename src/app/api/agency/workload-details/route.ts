import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

const STAFF_ALIASES: Record<string, string[]> = {
  ploy: ["Ploy", "ploy"],
  yuanli: ["Yuanli"],
  pare: ["Prae", "pare", "Pare"],
  namcha: ["Namcha", "namcha"],
};

function buildNameWhere(prefix: string, name: string): { clause: string; params: string[] } {
  const aliases = STAFF_ALIASES[name] || [name];
  const clauses = aliases.map(() => `LOWER(${prefix}) = LOWER(?)`);
  const params = aliases.map(a => a);
  return { clause: `(${clauses.join(" OR ")})`, params };
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const employee = req.nextUrl.searchParams.get("employee") || "";
  const type = req.nextUrl.searchParams.get("type") || "";
  const from = req.nextUrl.searchParams.get("from") || "";
  const to = req.nextUrl.searchParams.get("to") || "";

  if (!employee || !type) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  const { clause: nameWhere, params: nameParams } = buildNameWhere(
    type === "evaluations" ? "evaluated_by" : "creator",
    employee
  );

  const dateWhere = (col: string) => {
    const parts: string[] = [];
    if (from) parts.push(`${col} >= ?`);
    if (to) parts.push(`${col} <= ?`);
    return parts.length > 0 ? ` AND ${parts.join(" AND ")}` : "";
  };
  const dateParams = (): any[] => {
    const p: any[] = [];
    if (from) p.push(from);
    if (to) p.push(to + " 23:59:59");
    return p;
  };

  let data: any[] = [];

  if (type === "tasks") {
    const dp = dateParams();
    data = db.prepare(`
      SELECT id, task_number, category, status, created_at
      FROM discovery_tasks
      WHERE ${nameWhere}${dateWhere("created_at")}
      ORDER BY created_at DESC
    `).all(...nameParams, ...dp);
  } else if (type === "influencers") {
    const dp = dateParams();
    const { clause: iWhere, params: iP } = buildNameWhere("created_by", employee);
    data = db.prepare(`
      SELECT id, name, code, category, phase, created_at
      FROM influencers
      WHERE ${iWhere}${dateWhere("created_at")}
      ORDER BY created_at DESC
    `).all(...iP, ...dp);
  } else if (type === "evaluations") {
    const dp = dateParams();
    data = db.prepare(`
      SELECT ie.id, ie.final_rating, ie.rating, ie.total_score, ie.created_at,
             i.id as influencer_id, i.name as influencer_name
      FROM influencer_evaluations ie
      JOIN influencers i ON ie.influencer_id = i.id
      WHERE ${nameWhere}${dateWhere("ie.created_at")}
      ORDER BY ie.created_at DESC
    `).all(...nameParams, ...dp);
  } else if (type === "contracts") {
    const dp = dateParams();
    const { clause: cWhere, params: cP } = buildNameWhere("created_by", employee);
    data = db.prepare(`
      SELECT c.id, c.base_salary, c.commission, c.live_sessions, c.live_duration,
             c.video_count, c.payment_status, c.created_at,
             c.influencer_id, i.name as influencer_name
      FROM contracts c
      JOIN influencers i ON c.influencer_id = i.id
      WHERE ${cWhere}${dateWhere("c.created_at")}
      ORDER BY c.created_at DESC
    `).all(...cP, ...dp);
  }

  return NextResponse.json({ type, employee, data });
}