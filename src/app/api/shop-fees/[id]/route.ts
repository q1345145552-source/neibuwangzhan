import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// PATCH /api/shop-fees/[id] — 管理员核对收入：待核对 → 已到账 / 未到账
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可核对" }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(id) as any;
  if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
  if (row.fee_type !== "收入") return NextResponse.json({ error: "只有收入需要核对" }, { status: 400 });
  if (row.status !== "待核对" && row.status !== "未到账") {
    return NextResponse.json({ error: "该记录不在待核对状态" }, { status: 400 });
  }

  const body = await readJson(req);
  const { action, result, note } = body;

  if (action !== "review") return NextResponse.json({ error: "未知操作" }, { status: 400 });

  let finalStatus: string;
  if (result === "已到账") {
    finalStatus = "已到账";
  } else if (result === "未到账") {
    finalStatus = "未到账";
    // 标未到账必填原因
    if (!note || !String(note).trim()) {
      return NextResponse.json({ error: "标未到账必须填写原因" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "核对结果只能是已到账或未到账" }, { status: 400 });
  }

  const reviewNote = finalStatus === "未到账" ? String(note).trim() : String(note || "").trim();
  db.prepare(
    "UPDATE shop_fees SET status = ?, reviewed_by = ?, reviewed_at = datetime('now'), review_note = ? WHERE id = ?"
  ).run(finalStatus, auth.name, reviewNote, id);

  logOperation(auth.name, "核对店铺收入", "shop_fee", String(id), `${finalStatus}${reviewNote ? `：${reviewNote}` : ""}`);
  return NextResponse.json(db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(id));
}
