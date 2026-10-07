import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";

// Shopee 店铺台账：管理员和员工都可查看、新增、编辑、删除；客户不可操作。

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
  const { store_code, store_name, status, sold, ban_reason } = body;

  const _e = validateEnums({ "shopee_stores.status": status, "shopee_stores.sold": sold });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
  if (!store_code || !String(store_code).trim()) return NextResponse.json({ error: "请填写店铺编号" }, { status: 400 });
  if (!store_name || !String(store_name).trim()) return NextResponse.json({ error: "请填写店铺名称" }, { status: 400 });
  if (status === "被封" && !String(ban_reason || "").trim()) {
    return NextResponse.json({ error: "店铺被封时必须填写封禁原因" }, { status: 400 });
  }

  const result = db.prepare(
    "INSERT INTO shopee_stores (store_code, store_name, status, sold, ban_reason, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(
    String(store_code).trim(),
    String(store_name).trim(),
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
  const { id, store_code, store_name, status, sold, ban_reason } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  const _e = validateEnums({ "shopee_stores.status": status, "shopee_stores.sold": sold });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (store_code !== undefined) { sets.push("store_code = ?"); vals.push(String(store_code).trim()); }
  if (store_name !== undefined) { sets.push("store_name = ?"); vals.push(String(store_name).trim()); }
  if (status !== undefined) { sets.push("status = ?"); vals.push(status); }
  if (sold !== undefined) { sets.push("sold = ?"); vals.push(sold); }
  if (status === "被封") {
    if (!String(ban_reason || "").trim()) return NextResponse.json({ error: "店铺被封时必须填写封禁原因" }, { status: 400 });
    sets.push("ban_reason = ?"); vals.push(String(ban_reason).trim());
  } else if (status !== undefined) {
    // 状态不是「被封」时清空封禁原因
    sets.push("ban_reason = ?"); vals.push("");
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE shopee_stores SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改Shopee店铺", "shopee_store", String(id), String(store_name));
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
