import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

// 订单店铺明细：把台账里的可售店铺关联到订单，台账已售状态联动。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order_id");
  let sql = "SELECT * FROM shopee_order_items";
  const params: any[] = [];
  if (orderId) { sql += " WHERE order_id = ?"; params.push(orderId); }
  sql += " ORDER BY id ASC";
  return NextResponse.json(db.prepare(sql).all(...params));
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { order_id, store_id } = body;
  if (!order_id) return NextResponse.json({ error: "缺少订单" }, { status: 400 });
  if (!store_id) return NextResponse.json({ error: "请选择店铺" }, { status: 400 });

  try {
    const run = db.transaction(() => {
      const store = db.prepare("SELECT * FROM shopee_stores WHERE id = ?").get(store_id) as
        { id: number; store_code: string; store_name: string; status: string; sold: string } | undefined;
      if (!store) throw new Error("店铺不存在");
      if (store.sold === "已出售") throw new Error("该店铺已被其他订单选中，不能再选");
      if (store.status !== "可售") throw new Error("只能选择可售状态的店铺");

      const dup = db.prepare("SELECT id FROM shopee_order_items WHERE order_id = ? AND store_id = ?").get(order_id, store_id);
      if (dup) throw new Error("该店铺已在此订单中");

      const r = db.prepare(
        "INSERT INTO shopee_order_items (order_id, store_id, store_code, store_name, process_status, created_by) VALUES (?, ?, ?, ?, '等待处理', ?)"
      ).run(order_id, store_id, store.store_code, store.store_name, auth.name);
      db.prepare("UPDATE shopee_stores SET sold = '已出售', updated_at = datetime('now') WHERE id = ?").run(store_id);
      return Number(r.lastInsertRowid);
    });
    const itemId = run();
    logOperation(auth.name, "订单添加店铺", "shopee_order_item", String(itemId), `订单${order_id} 店铺${store_id}`);
    return NextResponse.json(db.prepare("SELECT * FROM shopee_order_items WHERE id = ?").get(itemId), { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, process_status, ban_status, ban_reason } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  const _e = validateEnums({ "shopee_order_items.process_status": process_status, "shopee_order_items.ban_status": ban_status });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

  const item = db.prepare("SELECT * FROM shopee_order_items WHERE id = ?").get(id) as { id: number; store_id: number } | undefined;
  if (!item) return NextResponse.json({ error: "记录不存在" }, { status: 404 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (process_status !== undefined) { sets.push("process_status = ?"); vals.push(process_status); }
  if (ban_status !== undefined) {
    sets.push("ban_status = ?"); vals.push(ban_status);
    if (ban_reason !== undefined) { sets.push("ban_reason = ?"); vals.push(String(ban_reason).trim()); }
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });

  try {
    const run = db.transaction(() => {
      sets.push("updated_at = datetime('now')");
      vals.push(id);
      db.prepare(`UPDATE shopee_order_items SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      // 记封禁处理：把台账店铺状态改成「被封」，封禁原因同步
      if (ban_status !== undefined && ban_status !== "") {
        db.prepare("UPDATE shopee_stores SET status = '被封', ban_reason = ?, updated_at = datetime('now') WHERE id = ?")
          .run(String(ban_reason || "").trim(), item.store_id);
      }
    });
    run();
    logOperation(auth.name, "修改订单店铺明细", "shopee_order_item", String(id));
    return NextResponse.json(db.prepare("SELECT * FROM shopee_order_items WHERE id = ?").get(id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const db = getDb();

  try {
    const run = db.transaction(() => {
      const item = db.prepare("SELECT * FROM shopee_order_items WHERE id = ?").get(id) as { id: number; store_id: number } | undefined;
      if (!item) throw new Error("记录不存在");
      db.prepare("DELETE FROM shopee_order_items WHERE id = ?").run(id);
      // 移除后：台账店铺恢复可售、未出售
      db.prepare("UPDATE shopee_stores SET sold = '未出售', status = '可售', ban_reason = '', updated_at = datetime('now') WHERE id = ?").run(item.store_id);
    });
    run();
    logOperation(auth.name, "订单移除店铺", "shopee_order_item", String(id));
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "操作失败";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
