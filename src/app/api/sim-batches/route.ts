import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// SIM卡批次管理：管理员和员工都可操作；客户不可操作。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  return NextResponse.json(db.prepare("SELECT * FROM sim_batches ORDER BY id DESC").all());
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { lot_no, total_qty, stock_date, remark } = body;

  if (!lot_no || !String(lot_no).trim()) return NextResponse.json({ error: "请填写批次号（Lot号）" }, { status: 400 });
  const qty = Number(total_qty);
  if (!Number.isInteger(qty) || qty <= 0) return NextResponse.json({ error: "入库数量必须是正整数" }, { status: 400 });

  // 新增批次 = 初始入库：批次落库的同时记一条「入库」流水，保持台账与流水一致
  const insertBatch = db.transaction((lot: string, n: number, date: string, note: string, operator: string) => {
    const r = db.prepare(
      "INSERT INTO sim_batches (lot_no, total_qty, remaining_qty, stock_date, remark, created_by) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(lot, n, n, date, note, operator);
    const batchId = Number(r.lastInsertRowid);
    db.prepare(
      "INSERT INTO sim_transactions (batch_id, type, qty, purpose, customer, operator) VALUES (?, '入库', ?, '', '', ?)"
    ).run(batchId, n, operator);
    return batchId;
  });

  const batchId = insertBatch(String(lot_no).trim(), qty, String(stock_date || "").trim(), String(remark || "").trim(), auth.name);
  logOperation(auth.name, "新增SIM卡批次", "sim_batch", String(batchId), String(lot_no));
  return NextResponse.json(db.prepare("SELECT * FROM sim_batches WHERE id = ?").get(batchId), { status: 201 });
}
