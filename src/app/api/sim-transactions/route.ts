import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

// SIM卡出入库流水：入库给批次加数量，出库从批次减数量（不能超剩余），并逐笔留痕。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const batchId = searchParams.get("batch_id");
  let sql = `
    SELECT t.*, b.lot_no AS lot_no
    FROM sim_transactions t
    LEFT JOIN sim_batches b ON b.id = t.batch_id
  `;
  const params: any[] = [];
  if (batchId && batchId !== "all") {
    sql += " WHERE t.batch_id = ?";
    params.push(batchId);
  }
  sql += " ORDER BY t.id DESC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { batch_id, type, qty, purpose, customer } = body;

  const _e = validateEnums({ "sim_transactions.type": type });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!batch_id) return NextResponse.json({ error: "请选择批次" }, { status: 400 });
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "数量必须是正整数" }, { status: 400 });
  if (type === "出库") {
    if (!purpose || !String(purpose).trim()) return NextResponse.json({ error: "出库必须填写用途" }, { status: 400 });
    if (!customer || !String(customer).trim()) return NextResponse.json({ error: "出库必须填写客户" }, { status: 400 });
  }

  try {
    const run = db.transaction(() => {
      const batch = db.prepare("SELECT * FROM sim_batches WHERE id = ?").get(batch_id) as { id: number; remaining_qty: number } | undefined;
      if (!batch) throw new Error("批次不存在");
      if (type === "出库") {
        if (n > batch.remaining_qty) throw new Error(`出库数量不能超过该批次剩余数量（剩余 ${batch.remaining_qty}）`);
        db.prepare("UPDATE sim_batches SET remaining_qty = remaining_qty - ?, updated_at = datetime('now') WHERE id = ?").run(n, batch_id);
      } else {
        db.prepare("UPDATE sim_batches SET total_qty = total_qty + ?, remaining_qty = remaining_qty + ?, updated_at = datetime('now') WHERE id = ?").run(n, n, batch_id);
      }
      const r = db.prepare(
        "INSERT INTO sim_transactions (batch_id, type, qty, purpose, customer, operator) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(batch_id, type, n, String(purpose || "").trim(), String(customer || "").trim(), auth.name);
      return Number(r.lastInsertRowid);
    });
    const txId = run();
    logOperation(auth.name, type === "出库" ? "SIM卡出库" : "SIM卡入库", "sim_transaction", String(txId), `批次${batch_id} ${type}${n}`);
    return NextResponse.json(db.prepare("SELECT * FROM sim_transactions WHERE id = ?").get(txId), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
