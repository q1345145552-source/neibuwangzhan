import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

const DEFAULT_WARN = 5;
const DEFAULT_CRITICAL = 8;

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();

  const warnThreshold = parseInt(req.nextUrl.searchParams.get("warn") || `${DEFAULT_WARN}`);
  const critThreshold = parseInt(req.nextUrl.searchParams.get("crit") || `${DEFAULT_CRITICAL}`);

  const employees = db.prepare("SELECT name FROM employees WHERE role = 'employee'").all() as { name: string }[];

  const result: { name: string; orderSteps: number; influencerSteps: number; contractInfs: number; total: number; level: "ok" | "warn" | "critical" }[] = [];

  for (const emp of employees) {
    const orderSteps = (db.prepare(
      "SELECT COUNT(*) as c FROM order_steps WHERE assignee = ? AND status NOT IN ('已完成','已停止')"
    ).get(emp.name) as { c: number })?.c || 0;

    const influencerSteps = (db.prepare(
      "SELECT COUNT(*) as c FROM influencer_steps WHERE assignee = ? AND status NOT IN ('已完成','已停止')"
    ).get(emp.name) as { c: number })?.c || 0;

    const contractInfs = (db.prepare(
      "SELECT COUNT(*) as c FROM influencers WHERE phase = 'contract' AND id IN (SELECT influencer_id FROM influencer_steps WHERE assignee = ? AND status NOT IN ('已完成','已停止'))"
    ).get(emp.name) as { c: number })?.c || 0;

    const total = orderSteps + influencerSteps + contractInfs;
    let level: "ok" | "warn" | "critical" = "ok";
    if (total >= critThreshold) level = "critical";
    else if (total >= warnThreshold) level = "warn";

    if (total > 0 || orderSteps > 0 || influencerSteps > 0) {
      result.push({ name: emp.name, orderSteps, influencerSteps, contractInfs, total, level });
    }
  }

  result.sort((a, b) => b.total - a.total);

  return NextResponse.json({ employees: result, thresholds: { warn: warnThreshold, crit: critThreshold } });
}
