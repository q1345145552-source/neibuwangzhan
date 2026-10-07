import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

// 邮箱库存：记录剩余可用邮箱数量，手动增减并逐笔留流水。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const stock = db.prepare("SELECT remaining_qty FROM email_stock WHERE id = 1").get() as { remaining_qty: number } | undefined;
  const flows = db.prepare("SELECT * FROM email_flows ORDER BY id DESC").all();
  return NextResponse.json({ remaining_qty: stock?.remaining_qty ?? 0, flows });
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { type, qty, note } = body;

  const _e = validateEnums({ "email_flows.type": type });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  const n = Number(qty);
  if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "数量必须是正整数" }, { status: 400 });

  try {
    const run = db.transaction(() => {
      const stock = db.prepare("SELECT remaining_qty FROM email_stock WHERE id = 1").get() as { remaining_qty: number } | undefined;
      const remaining = stock?.remaining_qty ?? 0;
      if (type === "减少" && n > remaining) {
        throw new Error(`减少数量不能超过当前剩余（剩余 ${remaining}）`);
      }
      const delta = type === "增加" ? n : -n;
      db.prepare("UPDATE email_stock SET remaining_qty = remaining_qty + ?, updated_at = datetime('now') WHERE id = 1").run(delta);
      const r = db.prepare(
        "INSERT INTO email_flows (type, qty, note, operator) VALUES (?, ?, ?, ?)"
      ).run(type, n, String(note || "").trim(), auth.name);
      return Number(r.lastInsertRowid);
    });
    const flowId = run();
    logOperation(auth.name, type === "增加" ? "邮箱库存增加" : "邮箱库存减少", "email_flow", String(flowId), `${type}${n}`);
    const stock = db.prepare("SELECT remaining_qty FROM email_stock WHERE id = 1").get() as { remaining_qty: number };
    return NextResponse.json({ remaining_qty: stock.remaining_qty, flow: db.prepare("SELECT * FROM email_flows WHERE id = ?").get(flowId) }, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
