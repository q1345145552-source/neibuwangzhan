import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation } from "@/lib/db";
import { verifyAuth, isStaff } from "@/lib/auth";
import { readJson } from "@/lib/req";

// 话术：管理员可增删改，员工只读

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const questionId = Number(body?.question_id);
  const versionName = String(body?.version_name || "").trim() || "标准版";
  const content = String(body?.content || "");
  if (!Number.isInteger(questionId) || questionId <= 0) return NextResponse.json({ error: "缺少所属问题" }, { status: 400 });
  if (!content.trim()) return NextResponse.json({ error: "请填写话术内容" }, { status: 400 });
  const q = db.prepare("SELECT id FROM logistics_script_questions WHERE id = ?").get(questionId);
  if (!q) return NextResponse.json({ error: "问题不存在" }, { status: 400 });
  const sort = Number.isInteger(Number(body?.sort_order)) ? Number(body.sort_order) : 0;

  const r = db.prepare("INSERT INTO logistics_scripts (question_id, version_name, content, sort_order, created_by) VALUES (?, ?, ?, ?, ?)").run(questionId, versionName, content, sort, auth.name);
  logOperation(auth.name, "新增物流话术", "logistics_script", String(r.lastInsertRowid), versionName);
  return NextResponse.json(db.prepare("SELECT * FROM logistics_scripts WHERE id = ?").get(r.lastInsertRowid), { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const body = await readJson(req);
  const id = Number(body?.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少话术ID" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];
  if (body?.version_name !== undefined) { sets.push("version_name = ?"); vals.push(String(body.version_name).trim() || "标准版"); }
  if (body?.content !== undefined) { sets.push("content = ?"); vals.push(String(body.content)); }
  if (body?.sort_order !== undefined) { sets.push("sort_order = ?"); vals.push(Number(body.sort_order) || 0); }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_by = ?"); vals.push(auth.name);
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE logistics_scripts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  logOperation(auth.name, "修改物流话术", "logistics_script", String(id));
  return NextResponse.json(db.prepare("SELECT * FROM logistics_scripts WHERE id = ?").get(id));
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "仅员工可操作" }, { status: 403 });
  if (auth.role !== "admin") return NextResponse.json({ error: "仅管理员可操作" }, { status: 403 });

  const db = getDb();
  const id = Number(new URL(req.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "缺少话术ID" }, { status: 400 });
  db.prepare("DELETE FROM logistics_scripts WHERE id = ?").run(id);
  logOperation(auth.name, "删除物流话术", "logistics_script", String(id));
  return NextResponse.json({ success: true });
}
