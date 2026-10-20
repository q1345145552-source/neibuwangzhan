import { NextRequest, NextResponse } from "next/server";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";

/**
 * 评价送泰国特产（2026-10-20 老板 3A）：一张客户单每一步都评完，送一份。员工送了点「已送出」。
 * GET 列出来（没送的在前）；POST { source_order_no } 标已送出。
 */
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可查看" }, { status: 403 });
  const db = getDb();
  const gifts = db.prepare(`SELECT g.source_order_no, g.customer_name, g.qualified_at, g.sent_at, g.sent_by,
      (SELECT i.internal_order_id FROM sync_inbox i WHERE i.source_order_no = g.source_order_no AND i.internal_order_id IS NOT NULL ORDER BY i.line_no, i.copy_no LIMIT 1) AS order_id,
      (SELECT COUNT(*) FROM step_ratings r WHERE r.source_order_no = g.source_order_no) AS rating_count,
      (SELECT ROUND(AVG(stars), 1) FROM step_ratings r WHERE r.source_order_no = g.source_order_no) AS avg_stars
    FROM rating_gifts g ORDER BY (g.sent_at IS NOT NULL), g.qualified_at DESC LIMIT 500`).all();
  return NextResponse.json({ gifts });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const body = await readJson(req);
  const sourceOrderNo = typeof body.source_order_no === "string" ? body.source_order_no : "";
  const db = getDb();
  const changed = db.prepare("UPDATE rating_gifts SET sent_at = datetime('now'), sent_by = ? WHERE source_order_no = ? AND sent_at IS NULL").run(auth.name || "", sourceOrderNo).changes;
  if (!changed) {
    const exists = db.prepare("SELECT 1 FROM rating_gifts WHERE source_order_no = ?").get(sourceOrderNo);
    return NextResponse.json({ error: exists ? "已经点过「已送出」了，请刷新" : "没有这条特产记录" }, { status: exists ? 409 : 404 });
  }
  logOperation(auth.name || "", "特产已送出", "order", sourceOrderNo, `客户站单号 ${sourceOrderNo}`);
  return NextResponse.json({ ok: true });
}
