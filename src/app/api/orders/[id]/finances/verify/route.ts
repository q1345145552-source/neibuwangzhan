import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { notifyIncomeNotArrived } from "@/lib/order-alerts";

// POST /api/orders/[id]/finances/verify — 老板核对收入到账
// body: { finance_id, action: 'arrived'|'not_arrived', note? }
// arrived → 状态 paid（已到账）；not_arrived → 状态「未到账」且必填原因
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可核对" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const body = await readJson(req);
  const { finance_id, action, note } = body;
  if (!finance_id) return NextResponse.json({ error: "缺少 finance_id" }, { status: 400 });
  if (action !== "arrived" && action !== "not_arrived") return NextResponse.json({ error: "无效的操作" }, { status: 400 });

  const fin = db.prepare("SELECT * FROM finances WHERE id = ? AND order_id = ?").get(finance_id, id) as any;
  if (!fin) return NextResponse.json({ error: "费用记录不存在" }, { status: 404 });
  if (fin.type !== "income") return NextResponse.json({ error: "只有收入需要核对到账" }, { status: 400 });

  let status: string;
  let verifyNote = "";
  if (action === "arrived") {
    status = "paid";
  } else {
    if (!note || !String(note).trim()) return NextResponse.json({ error: "请填写未到账原因" }, { status: 400 });
    status = "未到账";
    verifyNote = String(note).trim();
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE finances SET status = ?, verify_by = ?, verify_at = ?, verify_note = ? WHERE id = ?").run(status, auth.name, now, verifyNote, Number(finance_id));
  logOperation(auth.name, action === "arrived" ? "收入到账" : "收入未到账", "finance", String(finance_id), verifyNote);
  // 未到账：告诉录入人和负责人去问客户（提醒失败不影响核对结果）
  if (action === "not_arrived") {
    try { notifyIncomeNotArrived(db, id, Number(finance_id), auth.name || ""); } catch (error) { console.error("[finances] 未到账提醒失败:", error); }
  }
  return NextResponse.json(db.prepare("SELECT * FROM finances WHERE id = ?").get(Number(finance_id)));
}
