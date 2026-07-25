import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, logOperation, CONTRACT_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("payment_status");
  const trash = searchParams.get("trash") === "1";
  let sql = `SELECT c.*, i.name AS influencer_name, i.code AS influencer_code,
    i.category AS influencer_category, i.followers AS influencer_followers,
    i.contact_phone AS influencer_phone, i.line_id AS influencer_line,
    i.status AS influencer_status, i.phase AS influencer_phase,
    i.created_by AS influencer_created_by,
    (SELECT e.gmv_amount FROM influencer_evaluations e WHERE e.influencer_id = c.influencer_id ORDER BY e.created_at DESC LIMIT 1) AS latest_gmv,
    (SELECT COUNT(*) FROM influencer_documents d WHERE d.influencer_id = c.influencer_id) AS file_count
    FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id`;
  const params: string[] = [];
  if (trash) { sql += " WHERE c.deleted = 1"; }
  else { sql += " WHERE c.deleted = 0"; }
  if (status) { sql += " AND c.payment_status = ?"; params.push(status); }
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
  const body = await readJson(req);
  const { influencer_id, base_salary, commission, live_sessions, live_duration, video_count, contract_url, payment_status, start_date, end_date, notes } = body;
  const created_by = auth.name || "";
  if (!influencer_id) return NextResponse.json({ error: "请选择达人" }, { status: 400 });

  const errEnum = validateEnums({ "contracts.payment_status": payment_status });
  if (errEnum) return NextResponse.json({ error: errEnum }, { status: 400 });

  // 达人必须存在：原来只靠外键兜底，传个不存在的 id 会抛异常变成 500
  const inf = db.prepare("SELECT id, name, status FROM influencers WHERE id = ?").get(influencer_id) as
    { id: number; name: string; status: string } | undefined;
  if (!inf) return NextResponse.json({ error: "达人不存在" }, { status: 404 });

  // 一个达人只能有一份生效合同：原来不去重，重复创建时每次都把达人状态强行改回「已签约」
  //（哪怕这个达人当前是「已停止」）。续签请改现有合同的起止日期。
  const existing = db.prepare(
    "SELECT id FROM contracts WHERE influencer_id = ? AND COALESCE(deleted, 0) = 0"
  ).get(influencer_id) as { id: number } | undefined;
  if (existing) {
    return NextResponse.json(
      { error: `「${inf.name}」已有一份生效合同（#${existing.id}），续签请直接修改该合同`, existing_contract_id: existing.id },
      { status: 409 }
    );
  }

  const result = db.prepare(
    "INSERT INTO contracts (influencer_id, base_salary, commission, live_sessions, live_duration, video_count, contract_url, payment_status, start_date, end_date, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(influencer_id, base_salary || "", commission || "", live_sessions || "", live_duration || "", video_count || "", contract_url || "", payment_status || "未付", start_date || "", end_date || "", notes || "", created_by || "");
  // 建合同即视为签约成功；但已停止合作的达人不该被悄悄拉回「已签约」
  if (inf.status !== "已停止") {
    db.prepare("UPDATE influencers SET status = '已签约', updated_at = datetime('now') WHERE id = ?").run(influencer_id);
  }
  const row = db.prepare("SELECT c.*, i.name AS influencer_name, i.code AS influencer_code FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const db = getDb();
  const body = await readJson(req);
  const { id, influencer_id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  // Read old values for version tracking
  const oldRow = db.prepare("SELECT * FROM contracts WHERE id = ?").get(id) as any;
  if (!oldRow) return NextResponse.json({ error: "合同不存在" }, { status: 404 });

  const _e = validateEnums({ "contracts.payment_status": fields.payment_status, "contracts.phase": fields.phase });
  if (_e) return NextResponse.json({ error: _e }, { status: 400 });
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
  // 恢复：从回收站还原
  if (body.restore === true) {
    db.prepare("UPDATE contracts SET deleted = 0, deleted_at = NULL, deleted_by = '', updated_at = datetime('now') WHERE id = ?").run(id);
    const row = db.prepare("SELECT c.*, i.name AS influencer_name, i.code AS influencer_code FROM contracts c LEFT JOIN influencers i ON c.influencer_id = i.id WHERE c.id = ?").get(id);
    return NextResponse.json(row);
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

  // 主数据删除不可恢复：仅管理员或创建人本人可删
  const _delId = new URL(req.url).searchParams.get("id");
  if (!_delId) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const _owner = getDb().prepare("SELECT created_by as o FROM contracts WHERE id = ?").get(_delId) as { o: string } | undefined;
  if (!_owner) return NextResponse.json({ error: "合同不存在" }, { status: 404 });
  if (auth.role !== "admin" && (_owner.o || "") !== auth.name) {
    return NextResponse.json({ error: "只能删除自己创建的合同，其他请联系管理员" }, { status: 403 });
  }

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  const permanent = searchParams.get("permanent") === "1";
  if (permanent) {
    // 彻底删除
    db.prepare("DELETE FROM contracts WHERE id = ?").run(id);
  } else {
    // 软删除：移入回收站
    db.prepare("UPDATE contracts SET deleted = 1, deleted_at = datetime('now'), deleted_by = ? WHERE id = ?").run(auth.name, id);
  }
  return NextResponse.json({ success: true });
}
