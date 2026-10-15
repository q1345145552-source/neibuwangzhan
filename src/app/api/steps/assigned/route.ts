import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { listMySteps } from "@/lib/my-steps";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role === "client") return NextResponse.json({ error: "无权限" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const user = searchParams.get("user");
  const type = searchParams.get("type"); // "influencer" 查达人步骤，否则查订单步骤
  if (!user) return NextResponse.json({ error: "缺少 user 参数" }, { status: 400 });

  const db = getDb();
  const likeUser = `%${user}%`;

  if (type === "influencer") {
    // 达人步骤：支持多负责人格式如 "Prae / Namcha"
    const rows = db.prepare(`
      SELECT is2.id as step_id, is2.influencer_id, is2.step_name, is2.status, is2.step_order,
             is2.phase, i.name as influencer_name, i.code as influencer_number, i.category
      FROM influencer_steps is2
      JOIN influencers i ON is2.influencer_id = i.id
      WHERE is2.assignee LIKE ? AND is2.status != '已完成'
      ORDER BY is2.influencer_id, is2.step_order
    `).all(likeUser);
    return NextResponse.json(rows);
  }

  // 订单步骤：经办人是我，或步骤没写经办人、订单负责人是我；不含已取消的单（口径见 lib/my-steps.ts）
  return NextResponse.json(listMySteps(db, user));
}
