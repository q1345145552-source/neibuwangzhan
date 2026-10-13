import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { validateEnums } from "@/lib/enums";

// GET /api/ideas — 老板看全部想法；员工看自己 + 其他员工的（看不到老板记的）
export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const rows = (auth.role === "admin"
    ? db.prepare("SELECT * FROM ideas ORDER BY id DESC").all()
    : db.prepare("SELECT * FROM ideas WHERE is_boss = 0 ORDER BY id DESC").all()) as any[];
  return NextResponse.json(rows);
}

// POST /api/ideas — 老板记想法 / 员工提点子
export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const { title, content, category } = body;

  if (!title || !String(title).trim()) return NextResponse.json({ error: "请填写标题" }, { status: 400 });
  if (!content || !String(content).trim()) return NextResponse.json({ error: "请填写内容" }, { status: 400 });
  const cat = String(category || "产品功能").trim();
  const _e = validateEnums({ "ideas.category": cat });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });

  const isBoss = auth.role === "admin" ? 1 : 0;
  const result = db.prepare(
    "INSERT INTO ideas (title, content, category, source, is_boss, status) VALUES (?, ?, ?, ?, ?, '待评估')"
  ).run(String(title).trim(), String(content).trim(), cat, auth.name, isBoss);

  logOperation(auth.name, isBoss ? "记录想法" : "提交点子", "idea", String(result.lastInsertRowid), String(title).trim());
  return NextResponse.json(db.prepare("SELECT * FROM ideas WHERE id = ?").get(result.lastInsertRowid), { status: 201 });
}
