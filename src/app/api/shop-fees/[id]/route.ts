import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { canDeleteShopFee, canEditShopFee, ownsShopFee, SHOP_BUSINESS_TYPES, SHOP_CURRENCIES, type ShopFeeRecord } from "@/lib/shop-fees";

// PATCH /api/shop-fees/[id] — 修改收付款，或由管理员核对收入。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const { id } = await params;
  const body = await readJson(req);
  const { action, result, note } = body;
  if (action !== "review" && action !== "edit") return NextResponse.json({ error: "未知操作" }, { status: 400 });
  if (action === "review" && auth.role !== "admin") return NextResponse.json({ error: "仅管理员可核对" }, { status: 403 });
  const db = getDb();
  // 检查、保存和核对共用写事务，避免打开表单后已被核对仍能覆盖。
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(id) as ShopFeeRecord | undefined;
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    if (action === "edit") {
      if (!ownsShopFee(auth, row)) return NextResponse.json({ error: "只能修改自己录入的记录" }, { status: 403 });
      if (!canEditShopFee(auth, row)) return NextResponse.json({ error: "已核对的收入不能修改" }, { status: 409 });
      if (body.fee_type !== undefined && body.fee_type !== row.fee_type) return NextResponse.json({ error: "收入/支出类型不能修改" }, { status: 400 });
      if (!SHOP_BUSINESS_TYPES.includes(body.business_type)) return NextResponse.json({ error: "请选择业务类型" }, { status: 400 });
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: "请填写有效金额" }, { status: 400 });
      if (!SHOP_CURRENCIES.includes(body.currency)) return NextResponse.json({ error: "请选择币种" }, { status: 400 });
      if (typeof body.screenshot !== "string" || !body.screenshot.trim()) return NextResponse.json({ error: "请上传截图" }, { status: 400 });
      const fields = { amount, business_type: body.business_type, currency: body.currency, note: String(body.note || "").trim(), screenshot: body.screenshot.trim() };
      db.prepare("UPDATE shop_fees SET amount = ?, business_type = ?, currency = ?, note = ?, screenshot = ? WHERE id = ?")
        .run(fields.amount, fields.business_type, fields.currency, fields.note, fields.screenshot, id);
      logOperation(auth.name, "修改店铺收付款", "shop_fee", String(id), `${row.fee_type} ${fields.business_type} ${fields.amount}${fields.currency}`, JSON.stringify(row), JSON.stringify(fields));
      return NextResponse.json(db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(id));
    }
    if (row.fee_type !== "收入") return NextResponse.json({ error: "只有收入需要核对" }, { status: 400 });
    if (row.status !== "待核对" && row.status !== "未到账") {
      return NextResponse.json({ error: "该记录不在待核对状态" }, { status: 400 });
    }

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
  }).immediate();
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { id } = await params;
  const db = getDb();
  return db.transaction(() => {
    const row = db.prepare("SELECT * FROM shop_fees WHERE id = ?").get(id) as ShopFeeRecord | undefined;
    if (!row) return NextResponse.json({ error: "记录不存在" }, { status: 404 });
    if (!ownsShopFee(auth, row)) return NextResponse.json({ error: "只能删除自己录入的记录" }, { status: 403 });
    if (!canDeleteShopFee(auth, row)) return NextResponse.json({ error: "只有待核对收入或待处理支出可以删除" }, { status: 409 });
    db.prepare("DELETE FROM shop_fees WHERE id = ?").run(id);
    logOperation(auth.name, "删除店铺收付款", "shop_fee", String(id), `${row.fee_type} ${row.business_type} ${row.amount}${row.currency}`, JSON.stringify(row));
    return NextResponse.json({ success: true });
  }).immediate();
}
