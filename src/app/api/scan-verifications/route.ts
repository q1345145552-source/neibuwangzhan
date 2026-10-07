import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 扫描验证：每天一条，记录当天完成扫描验证的店铺数量。

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  return NextResponse.json(getDb().prepare("SELECT * FROM scan_verifications ORDER BY date DESC").all());
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { date, qty } = body;
  if (!date) return NextResponse.json({ error: "请选择日期" }, { status: 400 });
  const n = Number(qty);
  if (!Number.isInteger(n) || n < 0) return NextResponse.json({ error: "完成数量必须是非负整数" }, { status: 400 });
  const dup = db.prepare("SELECT id FROM scan_verifications WHERE date = ?").get(date);
  if (dup) return NextResponse.json({ error: "该日期已有记录，请直接编辑" }, { status: 400 });

  const r = db.prepare("INSERT INTO scan_verifications (date, qty, created_by) VALUES (?, ?, ?)").run(date, n, auth.name);
  logOperation(auth.name, "新增扫描验证记录", "scan_verification", String(r.lastInsertRowid), `${date} ${n}`);
  return NextResponse.json(db.prepare("SELECT * FROM scan_verifications WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const db = getDb();
  const body = await readJson(req);
  const { id, date, qty } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const n = Number(qty);
  if (date === undefined && qty === undefined) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  if (qty !== undefined && (!Number.isInteger(n) || n < 0)) return NextResponse.json({ error: "完成数量必须是非负整数" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (date !== undefined) { sets.push("date = ?"); vals.push(date); }
  if (qty !== undefined) { sets.push("qty = ?"); vals.push(n); }
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE scan_verifications SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改扫描验证记录", "scan_verification", String(id), `${date ?? ""} ${qty ?? ""}`);
  return NextResponse.json(db.prepare("SELECT * FROM scan_verifications WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  getDb().prepare("DELETE FROM scan_verifications WHERE id = ?").run(id);
  logOperation(auth.name, "删除扫描验证记录", "scan_verification", String(id));
  return NextResponse.json({ success: true });
}
