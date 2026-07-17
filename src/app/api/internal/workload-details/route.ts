import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";

// 员工英文名到步骤中文名/泰文名的对照
const NAME_ALIASES: Record<string, string[]> = {
  yuanli: ["元丽"],
  ploy: ["Ploy"],
  namcha: ["Namcha"],
  pare: ["Prae"],
};

function buildLikeClause(name: string): { clause: string; params: string[] } {
  const lower = name.toLowerCase();
  const aliases = NAME_ALIASES[lower] || [];
  const patterns = [name, ...aliases];
  const clauses = patterns.map(() => `assignee LIKE ?`);
  const params = patterns.map(p => `%${p}%`);
  return { clause: clauses.join(" OR "), params };
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const employee = req.nextUrl.searchParams.get("employee") || "";
  const type = req.nextUrl.searchParams.get("type") || "";

  if (!employee || !type) {
    return NextResponse.json({ error: "缺少参数" }, { status: 400 });
  }

  const { clause, params } = buildLikeClause(employee);

  let data: any[] = [];

  if (type === "order_steps") {
    // 按订单分组，一笔订单一条记录
    data = db.prepare(`
      SELECT o.id as order_id, o.customer_name, o.status as order_status,
             o.business_type_id, bt.name as business_type_name,
             COUNT(*) as step_count,
             SUM(CASE WHEN os.status = '进行中' THEN 1 ELSE 0 END) as in_progress_count,
             SUM(CASE WHEN os.status = '待处理' THEN 1 ELSE 0 END) as pending_count
      FROM orders o
      JOIN order_steps os ON os.order_id = o.id
      LEFT JOIN business_types bt ON o.business_type_id = bt.id
      WHERE (${clause}) AND os.status NOT IN ('已完成','已停止')
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `).all(...params);
  } else if (type === "influencer_steps") {
    // 按达人分组，一个达人一条记录
    data = db.prepare(`
      SELECT i.id as influencer_id, i.name as influencer_name, i.code, i.phase, i.status as influencer_status,
             COUNT(*) as step_count,
             SUM(CASE WHEN ist.status = '进行中' THEN 1 ELSE 0 END) as in_progress_count,
             SUM(CASE WHEN ist.status = '待处理' THEN 1 ELSE 0 END) as pending_count
      FROM influencers i
      JOIN influencer_steps ist ON ist.influencer_id = i.id
      WHERE (${clause}) AND ist.status NOT IN ('已完成','已停止')
      GROUP BY i.id
      ORDER BY i.name ASC
    `).all(...params);
  } else if (type === "contract_infs") {
    data = db.prepare(`
      SELECT DISTINCT i.id, i.name, i.code, i.phase, i.status,
             c.id as contract_id, c.base_salary, c.commission, c.live_sessions,
             c.live_duration, c.video_count, c.payment_status
      FROM influencers i
      LEFT JOIN contracts c ON c.influencer_id = i.id
      WHERE i.phase = 'contract'
        AND i.status NOT IN ('已完成','已停止')
        AND i.id IN (
          SELECT influencer_id FROM influencer_steps
          WHERE (${clause}) AND status NOT IN ('已完成','已停止')
        )
      ORDER BY i.name ASC
    `).all(...params);
  }

  return NextResponse.json({ type, employee, data });
}
