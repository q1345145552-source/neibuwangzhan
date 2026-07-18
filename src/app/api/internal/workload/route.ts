import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

const DEFAULT_WARN = 5;
const DEFAULT_CRITICAL = 8;

// 员工英文名到步骤中文名/泰文名的对照（步骤 assignee 字段存的是中文/泰文）
const NAME_ALIASES: Record<string, string[]> = {
  yuanli: ["Yuanli"],
  ploy: ["Ploy"],
  namcha: ["Namcha"],
  pare: ["Prae"],
};

function buildMatchCondition(name: string): string {
  const lower = name.toLowerCase();
  const aliases = NAME_ALIASES[lower] || [];
  const patterns = [name, ...aliases];
  return patterns.map(p => `assignee LIKE '%${p.replace(/'/g, "''")}%'`).join(" OR ");
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();

  const warnThreshold = parseInt(req.nextUrl.searchParams.get("warn") || `${DEFAULT_WARN}`);
  const critThreshold = parseInt(req.nextUrl.searchParams.get("crit") || `${DEFAULT_CRITICAL}`);

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];

  const result: { name: string; orderSteps: number; influencerSteps: number; contractInfs: number; total: number; level: "ok" | "warn" | "critical" }[] = [];

  for (const emp of employees) {
    const cond = buildMatchCondition(emp.name);

    // 订单笔数：该员工参与且未完成的订单（去重计数，不是步骤数）
    const orderSteps = (db.prepare(
      `SELECT COUNT(DISTINCT os.order_id) as c FROM order_steps os
       JOIN orders o ON os.order_id = o.id
       WHERE (${cond}) AND os.status NOT IN ('已完成','已停止')`
    ).all() as { c: number }[])[0]?.c || 0;

    // 达人个数：该员工参与且未完成的达人（去重计数，不是步骤数）
    const influencerSteps = (db.prepare(
      `SELECT COUNT(DISTINCT ist.influencer_id) as c FROM influencer_steps ist
       WHERE (${cond}) AND ist.status NOT IN ('已完成','已停止')`
    ).all() as { c: number }[])[0]?.c || 0;

    // 签约中的达人（该员工有未完成步骤的签约达人）
    const contractInfs = (db.prepare(
      `SELECT COUNT(DISTINCT i.id) as c FROM influencers i
       JOIN influencer_steps s ON s.influencer_id = i.id
       WHERE i.phase = 'contract' AND (${cond}) AND s.status NOT IN ('已完成','已停止')`
    ).all() as { c: number }[])[0]?.c || 0;

    const total = orderSteps + influencerSteps + contractInfs;
    let level: "ok" | "warn" | "critical" = "ok";
    if (total >= critThreshold) level = "critical";
    else if (total >= warnThreshold) level = "warn";

    result.push({ name: emp.name, orderSteps, influencerSteps, contractInfs, total, level });
  }

  result.sort((a, b) => b.total - a.total);

  return NextResponse.json({ employees: result, thresholds: { warn: warnThreshold, crit: critThreshold } });
}
