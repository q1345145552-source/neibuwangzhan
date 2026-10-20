import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { getDb, logOperation } from "@/lib/db";
import { KIT_KINDS, templateFiles, type KitKind } from "@/lib/order-kit";

/**
 * 流程设置里给这套流程配「说明书」「资料收集表」（2026-10-20 老板 2A：每种业务固定一份，这种业务的订单客户都能看到）。
 * 只有管理员能改（流程设置本来就只给管理员）。文件先走 /api/upload 传上来，这里只登记；删除只做标记。
 */
const EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".doc", ".docx", ".xls", ".xlsx"]);

async function adminAndTemplate(req: NextRequest, params: Promise<{ id: string }>) {
  const auth = await verifyAuth(req);
  if (!auth) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  if (auth.role !== "admin") return { error: NextResponse.json({ error: "只有管理员能改流程资料" }, { status: 403 }) };
  const { id } = await params;
  const db = getDb();
  const tpl = db.prepare("SELECT id, label FROM workflow_templates WHERE id = ?").get(Number(id)) as { id: number; label: string } | undefined;
  if (!tpl) return { error: NextResponse.json({ error: "流程不存在，先在流程设置里导入" }, { status: 404 }) };
  return { auth, db, tpl };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await adminAndTemplate(req, params);
  if ("error" in r) return r.error;
  return NextResponse.json({ files: templateFiles(r.db, [r.tpl.id]) });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await adminAndTemplate(req, params);
  if ("error" in r) return r.error;
  const body = await readJson(req);
  const kind = String(body.kind || "") as KitKind;
  if (!KIT_KINDS.includes(kind)) return NextResponse.json({ error: "只能放说明书或资料收集表" }, { status: 400 });
  const fileUrl = String(body.file_url || "");
  const safeName = /^\/api\/files\/([A-Za-z0-9._-]+)$/.exec(fileUrl)?.[1];
  if (!safeName || !EXTS.has(path.extname(safeName).toLowerCase())) return NextResponse.json({ error: "文件不对，请重新上传（PDF、图片、Word、Excel）" }, { status: 400 });
  if (!r.db.prepare("SELECT 1 FROM file_uploads WHERE filename = ?").get(safeName)) return NextResponse.json({ error: "文件没传上来，请重新上传" }, { status: 400 });
  const name = String(body.name || "").trim().slice(0, 100) || kind;
  const info = r.db.prepare("INSERT INTO workflow_template_files (template_id, kind, name, file_url, uploaded_by) VALUES (?, ?, ?, ?, ?)")
    .run(r.tpl.id, kind, name, fileUrl, r.auth.name || "");
  logOperation(r.auth.name || "", "流程资料", "workflow", String(r.tpl.id), `${r.tpl.label} 加${kind}「${name}」`);
  return NextResponse.json({ ok: true, id: Number(info.lastInsertRowid), files: templateFiles(r.db, [r.tpl.id]) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const r = await adminAndTemplate(req, params);
  if ("error" in r) return r.error;
  const fileId = Number(req.nextUrl.searchParams.get("file_id"));
  const row = r.db.prepare("SELECT kind, name FROM workflow_template_files WHERE id = ? AND template_id = ? AND deleted_at IS NULL").get(fileId, r.tpl.id) as { kind: string; name: string } | undefined;
  if (!row) return NextResponse.json({ error: "这份资料不存在或已经删了" }, { status: 404 });
  r.db.prepare("UPDATE workflow_template_files SET deleted_at = datetime('now') WHERE id = ?").run(fileId);
  logOperation(r.auth.name || "", "流程资料", "workflow", String(r.tpl.id), `${r.tpl.label} 删${row.kind}「${row.name}」`);
  return NextResponse.json({ ok: true, files: templateFiles(r.db, [r.tpl.id]) });
}
