import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { getDb, logOperation, CONTRACT_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("payment_status");
  let sql = `SELECT c.*, i.name AS influencer_name, i.code AS influencer_code,
    i.category AS influencer_category, i.followers AS influencer_followers,
    i.contact_phone AS influencer_phone, i.line_id AS influencer_line,
    i.status AS influencer_status, i.phase AS influencer_phase,
    (SELECT e.gmv_amount FROM influencer_evaluations e WHERE e.influencer_id = c.influencer_id ORDER BY e.created_at DESC LIMIT 1) AS latest_gmv,
    (SELECT COUNT(*) FROM influencer_documents d WHERE d.influencer_id = c.influencer_id) AS file_count
    FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id`;
  const params: string[] = [];
  if (status) { sql += " WHERE c.payment_status = ?"; params.push(status); }
  sql += " ORDER BY c.created_at DESC";
  const rows = db.prepare(sql).all(...params);
  const res = NextResponse.json(rows);
  res.headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  return res;
}

export async function POST(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await req.json();
  const { influencer_id, base_salary, commission, live_sessions, live_duration, video_count, contract_url, payment_status, start_date, end_date, notes, created_by } = body;
  if (!influencer_id) return NextResponse.json({ error: "请选择达人" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO contracts (influencer_id, base_salary, commission, live_sessions, live_duration, video_count, contract_url, payment_status, start_date, end_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(influencer_id, base_salary || "", commission || "", live_sessions || "", live_duration || "", video_count || "", contract_url || "", payment_status || "未付", start_date || "", end_date || "", notes || "", created_by || "");
  // Update influencer status to 已签约 when contract is created
  db.prepare("UPDATE influencers SET status = '已签约', updated_at = datetime('now') WHERE id = ?").run(influencer_id);
  const row = db.prepare("SELECT c.*, i.name AS influencer_name, i.code AS influencer_code FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await req.json();
  const { id, influencer_id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  // Read old values for version tracking
  const oldRow = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id) as any;
  if (!oldRow) return NextResponse.json({ error: "合同不存在" }, { status: 404 });

  const trackedFields = ["base_salary", "commission", "live_sessions", "live_duration", "video_count", "payment_status"];
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    // 字段白名单：防止请求体字段名被拼进 SQL（列名注入）
    if (!CONTRACT_UPDATABLE_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`); vals.push(v);
    if (trackedFields.includes(k)) {
      const oldVal = oldRow[k] || "";
      const newVal = String(v || "");
      if (oldVal !== newVal) {
        logOperation(auth.name, "修改合同", "contract", String(id), `${k}: ${oldVal} → ${newVal}`, oldVal, newVal, k);
      }
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE contracts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const row = db.prepare("SELECT c.*, i.name AS influencer_name, i.code AS influencer_code FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.id = ?").get(id);
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  return NextResponse.json({ success: true });
}
