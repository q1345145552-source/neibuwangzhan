import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { bangkokToday, bangkokDayRange } from "@/lib/time";

// Shopee 店铺台账：管理员和员工都可查看、新增、编辑、删除；客户不可操作。
// 店铺编号由系统自动生成：平台前缀(SP/TK) + YYMMDD + 当天该平台序号（每天按平台分开从 1 计数）。

function isFilledNumber(v: unknown): boolean {
  if (v === undefined || v === null || v === "") return false;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const rows = db.prepare("SELECT * FROM shopee_stores ORDER BY id DESC").all();
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { store_name, platform, source, status, sold, ban_reason, supplier, cost, purchase_date, sell_price } = body;

  const plat = platform || "Shopee";
  const src = source || "自营";
  const _e = validateEnums({
    "shopee_stores.status": status,
    "shopee_stores.sold": sold,
    "shopee_stores.platform": plat,
    "shopee_stores.source": src,
  });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!store_name || !String(store_name).trim()) return NextResponse.json({ error: "请填写店铺名称" }, { status: 400 });
  if (status === "被封" && !String(ban_reason || "").trim()) {
    return NextResponse.json({ error: "店铺被封时必须填写封禁原因" }, { status: 400 });
  }

  const supplierVal = String(supplier || "").trim();
  const purchaseVal = String(purchase_date || "").trim();
  if (src === "外购") {
    if (!supplierVal) return NextResponse.json({ error: "外购店铺必须填写供应商" }, { status: 400 });
    if (!purchaseVal) return NextResponse.json({ error: "外购店铺必须填写拿货日期" }, { status: 400 });
    if (!isFilledNumber(cost)) return NextResponse.json({ error: "外购店铺必须填写有效的拿货成本" }, { status: 400 });
    if (!isFilledNumber(sell_price)) return NextResponse.json({ error: "外购店铺必须填写有效的卖价" }, { status: 400 });
  }

  // 自动生成编号：平台前缀 + YYMMDD + 当天该平台第几间（按曼谷日期、按平台分开计数）
  const today = bangkokToday();
  const range = bangkokDayRange(today);
  const prefix = plat === "TikTok" ? "TK" : "SP";
  const datePart = today.slice(2).replace(/-/g, "");
  const cnt = db.prepare(
    "SELECT COUNT(*) AS c FROM shopee_stores WHERE platform = ? AND created_at >= ? AND created_at < ?"
  ).get(plat, range.start, range.end) as { c: number };
  const store_code = `${prefix}-${datePart}${cnt.c + 1}`;

  const result = db.prepare(
    "INSERT INTO shopee_stores (store_code, store_name, platform, source, supplier, cost, purchase_date, sell_price, status, sold, ban_reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    store_code,
    String(store_name).trim(),
    plat,
    src,
    src === "外购" ? supplierVal : "",
    src === "外购" ? Number(cost) : 0,
    src === "外购" ? purchaseVal : "",
    src === "外购" ? Number(sell_price) : 0,
    status || "可售",
    sold || "未出售",
    status === "被封" ? String(ban_reason || "").trim() : "",
    auth.name
  );
  logOperation(auth.name, "新增Shopee店铺", "shopee_store", String(result.lastInsertRowid), String(store_name));
  return NextResponse.json(db.prepare("SELECT * FROM shopee_stores WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, store_name, platform, source, status, sold, ban_reason, supplier, cost, purchase_date, sell_price } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  const _e = validateEnums({
    "shopee_stores.status": status,
    "shopee_stores.sold": sold,
    "shopee_stores.platform": platform,
    "shopee_stores.source": source,
  });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (store_name !== undefined) { sets.push("store_name = ?"); vals.push(String(store_name).trim()); }
  if (platform !== undefined) { sets.push("platform = ?"); vals.push(platform); }
  if (source !== undefined) { sets.push("source = ?"); vals.push(source); }
  if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
  if (sold !== undefined) { sets.push("sold = ?"); vals.push(sold); }

  // 外购四个字段：来源明确为外购时必填；自营时清空；来源未传时只更新传入的字段
  if (source === "外购") {
    if (!String(supplier || "").trim()) return NextResponse.json({ error: "外购店铺必须填写供应商" }, { status: 400 });
    if (!String(purchase_date || "").trim()) return NextResponse.json({ error: "外购店铺必须填写拿货日期" }, { status: 400 });
    if (!isFilledNumber(cost)) return NextResponse.json({ error: "外购店铺必须填写有效的拿货成本" }, { status: 400 });
    if (!isFilledNumber(sell_price)) return NextResponse.json({ error: "外购店铺必须填写有效的卖价" }, { status: 400 });
    sets.push("supplier = ?"); vals.push(String(supplier).trim());
    sets.push("cost = ?"); vals.push(Number(cost));
    sets.push("purchase_date = ?"); vals.push(String(purchase_date).trim());
    sets.push("sell_price = ?"); vals.push(Number(sell_price));
  } else if (source === "自营") {
    sets.push("supplier = ?"); vals.push("");
    sets.push("cost = ?"); vals.push(0);
    sets.push("purchase_date = ?"); vals.push("");
    sets.push("sell_price = ?"); vals.push(0);
  } else {
    if (supplier !== undefined) { sets.push("supplier = ?"); vals.push(String(supplier).trim()); }
    if (cost !== undefined) { sets.push("cost = ?"); vals.push(Number(cost)); }
    if (purchase_date !== undefined) { sets.push("purchase_date = ?"); vals.push(String(purchase_date).trim()); }
    if (sell_price !== undefined) { sets.push("sell_price = ?"); vals.push(Number(sell_price)); }
  }

  if (status === "被封") {
    if (!String(ban_reason || "").trim()) return NextResponse.json({ error: "店铺被封时必须填写封禁原因" }, { status: 400 });
    sets.push("ban_reason = ?"); vals.push(String(ban_reason).trim());
  } else if (status !== undefined) {
    sets.push("ban_reason = ?"); vals.push("");
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE shopee_stores SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改Shopee店铺", "shopee_store", String(id), String(store_name ?? ""));
  return NextResponse.json(db.prepare("SELECT * FROM shopee_stores WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  getDb().prepare("DELETE FROM shopee_stores WHERE id = ?").run(id);
  logOperation(auth.name, "删除Shopee店铺", "shopee_store", String(id));
  return NextResponse.json({ success: true });
}
