import { NextRequest, NextResponse } from "next/server";
import { getDb, logOperation, sendNotification } from "@/lib/db";
import { verifyAuth } from "@/lib/auth";
import { readJson } from "@/lib/req";
import { existsSync, unlinkSync } from "fs";
import path from "path";
import os from "os";

const UPLOAD_DIRS = [path.join(process.cwd(), "uploads"), path.join(os.tmpdir(), "xiangtai-uploads")];

/** 从 /api/files/xxx 地址解析出文件名并删除磁盘文件 */
function deleteDiskFile(url: string): void {
  const m = (url || "").match(/\/api\/files\/([A-Za-z0-9._-]+)/);
  if (!m) return;
  const base = path.basename(m[1]);
  for (const dir of UPLOAD_DIRS) {
    const fp = path.join(dir, base);
    if (existsSync(fp)) {
      try { unlinkSync(fp); } catch (e) { console.error("[问题附件] 删除磁盘文件失败", fp, e); }
    }
  }
}

// GET /api/problems/:id — 问题详情（含跟进记录，按时间倒序）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT * FROM problems WHERE id = ?").get(id);
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  const followUps = db.prepare(
    "SELECT * FROM problem_follow_ups WHERE problem_id = ? ORDER BY created_at DESC, id DESC"
  ).all(id);

  const attachments = db.prepare(
    "SELECT * FROM problem_attachments WHERE problem_id = ? ORDER BY created_at DESC, id DESC"
  ).all(id);

  return NextResponse.json({ ...(problem as object), follow_ups: followUps, attachments });
}

// PATCH /api/problems/:id — 状态流转
// 待处理 ↔ 跟进中；跟进中 → 老板验收（负责人标已解决，必须填解决说明）
// 老板验收 → 已解决（只有老板能验收，真正关闭并记解决时间）；老板验收 → 跟进中（老板退回）
// 待处理/跟进中/老板验收 → 搁置（必须填搁置原因）；搁置 → 跟进中（重新激活）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT assignee, status, problem_number FROM problems WHERE id = ?").get(id) as { assignee: string; status: string; problem_number: string } | undefined;
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  const isAdmin = auth.role === "admin";
  const isAssignee = auth.name === problem.assignee;
  if (!isAdmin && !isAssignee) {
    return NextResponse.json({ error: "只有负责人或管理员能修改状态" }, { status: 403 });
  }

  const body = await readJson(req);
  const { status, resolve_note, suspend_reason, order_id } = body;

  // 关联/修改关联订单：请求只带 order_id（不触发状态流转，跟进过程中随时可加可改）
  if (order_id !== undefined) {
    const target = typeof order_id === "string" ? order_id.trim() : "";
    if (target) {
      const order = db.prepare("SELECT id FROM orders WHERE id = ?").get(target);
      if (!order) return NextResponse.json({ error: "订单不存在" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET order_id = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(target, id);
    logOperation(auth.name, target ? "关联订单" : "取消关联订单", "problem", String(id), target || "无");
    const linked = db.prepare("SELECT * FROM problems WHERE id = ?").get(id);
    return NextResponse.json(linked);
  }

  const validStatuses = ["待处理", "跟进中", "已解决", "老板验收", "搁置"];
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: "无效的状态" }, { status: 400 });
  }

  const current = problem.status;
  // 老板专用操作：验收（→已解决）、退回（老板验收→跟进中）
  const isAccept = status === "已解决";
  const isReject = status === "跟进中" && current === "老板验收";
  if ((isAccept || isReject) && !isAdmin) {
    return NextResponse.json({ error: "只有老板能验收或退回" }, { status: 403 });
  }

  if (isAccept) {
    // 老板验收：待老板验收 → 已解决（真正关闭，记解决时间）
    if (current !== "老板验收") {
      return NextResponse.json({ error: "只有待老板验收的问题才能验收" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET status = '已解决', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "老板验收问题", "problem", String(id));
    // 通知联动：验收通过后通知负责人
    if (problem.assignee) {
      sendNotification("problem_accepted", "问题验收通过", `问题 ${problem.problem_number} 已通过老板验收`, problem.assignee, String(id), "problem");
    }
  } else if (isReject) {
    // 老板退回：待老板验收 → 跟进中（负责人继续处理）
    db.prepare(
      "UPDATE problems SET status = '跟进中', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "老板退回问题", "problem", String(id));
    // 通知联动：退回后通知负责人
    if (problem.assignee) {
      sendNotification("problem_rejected", "问题被退回", `问题 ${problem.problem_number} 被老板退回，请继续跟进`, problem.assignee, String(id), "problem");
    }
  } else if (status === "老板验收") {
    // 负责人标记已解决：跟进中 → 待老板验收（必须填解决说明）
    if (current !== "跟进中") {
      return NextResponse.json({ error: "只有跟进中的问题才能标记已解决" }, { status: 400 });
    }
    if (!resolve_note?.trim()) {
      return NextResponse.json({ error: "请填写解决说明" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET status = '老板验收', resolve_note = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(resolve_note.trim(), id);
    logOperation(auth.name, "标记问题已解决（待老板验收）", "problem", String(id), resolve_note.trim());
  } else if (status === "搁置") {
    // 搁置：必须填搁置原因（已解决/搁置中不可再搁置）
    if (current === "已解决" || current === "搁置") {
      return NextResponse.json({ error: "当前状态不能搁置" }, { status: 400 });
    }
    if (!suspend_reason?.trim()) {
      return NextResponse.json({ error: "请填写搁置原因" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET status = '搁置', suspend_reason = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(suspend_reason.trim(), id);
    logOperation(auth.name, "搁置问题", "problem", String(id), suspend_reason.trim());
  } else if (status === "跟进中") {
    // 开始处理（待处理→跟进中）或 重新激活（搁置→跟进中）
    if (current !== "待处理" && current !== "搁置") {
      return NextResponse.json({ error: "当前状态不能转为跟进中" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET status = '跟进中', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, current === "搁置" ? "重新激活问题" : "开始处理问题", "problem", String(id));
  } else if (status === "待处理") {
    // 改回待处理：跟进中 → 待处理
    if (current !== "跟进中") {
      return NextResponse.json({ error: "当前状态不能改回待处理" }, { status: 400 });
    }
    db.prepare(
      "UPDATE problems SET status = '待处理', updated_at = datetime('now') WHERE id = ?"
    ).run(id);
    logOperation(auth.name, "问题改回待处理", "problem", String(id));
  }

  const updated = db.prepare("SELECT * FROM problems WHERE id = ?").get(id);
  return NextResponse.json(updated);
}

// DELETE /api/problems/:id — 删除问题（仅负责人/管理员，仅已解决/搁置状态）
// 级联删除跟进记录 + 附件（含磁盘文件），不留孤儿数据
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const problem = db.prepare("SELECT assignee, status FROM problems WHERE id = ?").get(id) as { assignee: string; status: string } | undefined;
  if (!problem) return NextResponse.json({ error: "问题不存在" }, { status: 404 });

  // 权限：只有负责人或管理员能删除
  if (auth.role !== "admin" && auth.name !== problem.assignee) {
    return NextResponse.json({ error: "只有负责人或管理员能删除问题" }, { status: 403 });
  }

  // 状态限制：只有已解决/搁置能删除
  if (problem.status !== "已解决" && problem.status !== "搁置") {
    return NextResponse.json({ error: "当前状态不能删除，只有已解决或搁置的问题能删除" }, { status: 400 });
  }

  // 先取出所有附件的磁盘文件地址，删除记录后一并清磁盘
  const attachments = db.prepare("SELECT url FROM problem_attachments WHERE problem_id = ?").all(id) as { url: string }[];

  db.transaction(() => {
    db.prepare("DELETE FROM problem_follow_ups WHERE problem_id = ?").run(id);
    db.prepare("DELETE FROM problem_attachments WHERE problem_id = ?").run(id);
    db.prepare("DELETE FROM problems WHERE id = ?").run(id);
  })();

  for (const a of attachments) deleteDiskFile(a.url);
  logOperation(auth.name, "删除问题", "problem", String(id));
  return NextResponse.json({ success: true });
}
