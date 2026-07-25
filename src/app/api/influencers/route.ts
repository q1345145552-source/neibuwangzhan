import { NextRequest, NextResponse } from "next/server";
import { verifyAuth } from "@/lib/auth";
import { validateEnums } from "@/lib/enums";
import { readJson } from "@/lib/req";
import { getDb, seedInfluencerSteps, logOperation, INFLUENCER_UPDATABLE_FIELDS } from "@/lib/db";

export async function GET(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const phase = searchParams.get("phase");
  let sql = `SELECT i.*, 
    (SELECT ie.final_rating FROM influencer_evaluations ie WHERE ie.influencer_id = i.id ORDER BY ie.created_at DESC LIMIT 1) as latest_rating,
    dt.task_number as task_number, dt.creator as task_creator
    FROM influencers i
    LEFT JOIN discovery_tasks dt ON i.discovery_task_id = dt.id`;
  const conditions: string[] = [];
  const params: string[] = [];
  if (status) { const statuses = status.split(",").map(s => s.trim()); conditions.push("i.status IN (" + statuses.map(() => "?").join(",") + ")"); params.push(...statuses); }
  if (phase) {
    // 「走到过某阶段」的达人列表要排除已经终止的：不推荐（评估没过）、不签约（谈崩）、已停止。
    // 之前没排除，孵化页面里混进了 2 个不签约 + 1 个不推荐的达人。
    // 想看全部（含终止的）可以传 include_terminated=1。
    const includeTerminated = searchParams.get("include_terminated") === "1";
    const notTerminated = includeTerminated ? "" : " AND i.status NOT IN ('不推荐','不签约','已停止')";
    if (phase === "contract") {
      conditions.push(`i.phase IN ('completed_discovery','contract','completed_contract')${notTerminated}`);
    } else if (phase === "incubation") {
      conditions.push(`i.phase IN ('completed_discovery','contract','completed_contract','incubation','completed_incubation')${notTerminated}`);
    } else {
      conditions.push("i.phase = ?"); params.push(phase);
    }
  }
  if (search) { conditions.push("(i.name LIKE ? OR i.category LIKE ? OR i.contact LIKE ? OR i.code LIKE ?)"); const q = `%${search}%`; params.push(q, q, q, q); }
  if (conditions.length) sql += " WHERE " + conditions.join(" AND ");
  sql += " ORDER BY i.created_at DESC";
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
  const { name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status, code } = body;
  if (!name) return NextResponse.json({ error: "请填写达人名称" }, { status: 400 });
  const result = db.prepare(
    "INSERT INTO influencers (name, tiktok_link, category, contact, contact_phone, line_id, monthly_gmv, live_stream_ratio, contact_time, reply_status, followers, avg_views, gmv_range, notes, status, code, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(name, tiktok_link || "", category || "", contact || "", contact_phone || "", line_id || "", monthly_gmv || "", live_stream_ratio || "", contact_time || "", reply_status || "待联系", followers || "", avg_views || "", gmv_range || "", notes || "", status || "待评估", code || "", auth.name || "");
  // Auto-generate discovery phase steps only (5 steps)
  seedInfluencerSteps(db, Number(result.lastInsertRowid), "discovery");
  const row = db.prepare("SELECT * FROM influencers WHERE id = ?").get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const db = getDb();
  const body = await readJson(req);
  const { id, ...fields } = body;
  if (!id) return NextResponse.json({ error: "缺少ID" }, { status: 400 });

  // 值白名单：这三列都有 CHECK 约束，之前只挡了字段名（防注入）没挡值，非法值直接 500
  const errEnum = validateEnums({
    "influencers.status": fields.status,
    "influencers.reply_status": fields.reply_status,
    "influencers.phase": fields.phase,
  });
  if (errEnum) return NextResponse.json({ error: errEnum }, { status: 400 });
  const sets: string[] = []; const vals: any[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!INFLUENCER_UPDATABLE_FIELDS.has(k)) continue;
    sets.push(`${k} = ?`); vals.push(v);
  }
  if (sets.length === 0) return NextResponse.json({ error: "无更新字段" }, { status: 400 });
  sets.push("updated_at = datetime('now')");
  vals.push(id);
  db.prepare(`UPDATE influencers SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
  const row = db.prepare("SELECT * FROM influencers WHERE id = ?").get(id);
  return NextResponse.json(row);
}

export async function DELETE(req: NextRequest) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  // 主数据删除不可恢复：仅管理员或创建人本人可删
  const _delId = new URL(req.url).searchParams.get("id");
  if (!_delId) return NextResponse.json({ error: "缺少ID" }, { status: 400 });
  const _owner = getDb().prepare("SELECT created_by as o FROM influencers WHERE id = ?").get(_delId) as { o: string } | undefined;
  if (!_owner) return NextResponse.json({ error: "达人不存在" }, { status: 404 });
  if (auth.role !== "admin" && (_owner.o || "") !== auth.name) {
    return NextResponse.json({ error: "只能删除自己创建的达人，其他请联系管理员" }, { status: 403 });
  }

  const db = getDb();
  const id = _delId;
  // 与 /api/influencers/[id] 的删除保持一致：同样的子表清单 + 事务
  // （原来这里漏删了步骤、备注、文档、财务、证书，会留下孤儿数据）
  db.transaction(() => {
    db.prepare("DELETE FROM influencer_step_notes WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_steps WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_evaluations WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_documents WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_finances WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_certificates WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM contracts WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencer_factories WHERE influencer_id = ?").run(id);
    db.prepare("DELETE FROM influencers WHERE id = ?").run(id);
  })();
  logOperation(auth.name, "删除达人", "influencer", String(id));
  return NextResponse.json({ success: true });
}
