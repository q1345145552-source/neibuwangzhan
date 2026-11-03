import { NextRequest, NextResponse } from "next/server";
import type Database from "better-sqlite3";
import { isStaff, verifyAuth, type TokenPayload } from "./auth";
import { logOperation } from "./db";
import { subServices } from "./constants";
import { awaitingConfirmationSql } from "./order-confirm";
import { orderNumberInfoFor } from "./order-display-no";
import { customerStepView } from "./step-public-copy";

/**
 * 代理记账（2026-11-03 老板定）：返点按单算、人民币固定金额，只有管理员能看能改，员工和客户全程看不到。
 * 员工能挂代理（建单时或在订单页），只选人：挂上后要换要解除找管理员，返点管理员填了代理才看得到这张单。
 * 返点状态读取时按订单状态算，不存快照。代理从业务系统看，业务系统每次来 /api/sync/agent-orders 现取。
 */
export class AgentRebateError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const AGENT_CREATE_FAILED = "业务系统连不上，没开成，再点一次";
export const AGENT_UPDATE_FAILED = "没成功，再点一次";
const STALE_ORDER = "这张单编号变了，请刷新";
const PAID_LOCKED = "请先撤销已付";
const AGENT_UNAVAILABLE = "这个代理不存在或已停用，请换一个";
const ALREADY_ATTACHED = "这张单已经挂了代理，要换请找管理员";
const ORDER_CANCELLED = "这张单已取消，不用挂代理";
const REBATE_EMPTY = "先填返点";
const REBATE_RULE = "返点要填大于 0 的人民币金额，最多两位小数，不超过 99,999,999.99";
const MAX_REBATE_CENTS = 9_999_999_999;

/** 只给管理员的代理接口的门：没登录 401，不是管理员 403。路由里 if (auth instanceof NextResponse) return auth */
export async function requireAdmin(req: NextRequest): Promise<TokenPayload | NextResponse> {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (auth.role !== "admin") return NextResponse.json({ error: "无权限" }, { status: 403 });
  return auth;
}

/** 员工挂代理用的门：没登录 401，客户账号 403 */
export async function requireStaff(req: NextRequest): Promise<TokenPayload | NextResponse> {
  const auth = await verifyAuth(req);
  if (!auth) return NextResponse.json({ error: "未登录" }, { status: 401 });
  if (!isStaff(auth)) return NextResponse.json({ error: "无权限" }, { status: 403 });
  return auth;
}

export function agentErrorResponse(error: unknown): NextResponse {
  if (error instanceof AgentRebateError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error("[agents] 处理失败:", error);
  return NextResponse.json({ error: "服务器内部错误" }, { status: 500 });
}

/** 元 → 分（整数）。全程按文字算，不过浮点数；不合规矩返回 null */
export function parseRebateCents(input: unknown): number | null {
  if (typeof input !== "number" && typeof input !== "string") return null;
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(String(input).trim());
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0"));
  return cents > 0 && cents <= MAX_REBATE_CENTS ? cents : null;
}

export type RebateState = "waiting" | "earned" | "paid" | "void";

export function rebateStateOf(orderStatus: string, paidAt: string | null | undefined): RebateState {
  if (orderStatus === "已完成") return paidAt ? "paid" : "earned";
  if (orderStatus === "客户取消") return "void";
  return "waiting";
}

/** 点过已付、订单又不是已完成了：代理端按状态显示，管理员页标红、金额单独合计；重新完成后恢复已付 */
export function isPaidAnomaly(orderStatus: string, paidAt: string | null | undefined): boolean {
  return !!paidAt && orderStatus !== "已完成";
}

export function agentStatusLabel(orderStatus: string, awaitingConfirmation: boolean): string {
  if (orderStatus === "待处理") return awaitingConfirmation ? "待确认" : "已确认";
  if (orderStatus === "已完成") return "已完成";
  if (orderStatus === "客户取消") return "已取消";
  return "办理中";
}

export function agentBusinessName(order: { business_type_id: number; sub_service_type?: string | null; business_type_name?: string | null }): string {
  if (!order.business_type_name || order.business_type_name === "待分类") return "业务确认中";
  return (subServices[Number(order.business_type_id)] || []).find(o => o.key === order.sub_service_type)?.label || order.business_type_name;
}

type RebateRow = {
  order_id: string; agent_account_id: string; rebate_cents: number | null; paid_at: string | null;
  status: string; customer_name: string; business_type_id: number; sub_service_type: string | null; address_type: string | null;
  created_at: string; business_type_name: string | null; awaiting: number;
};
type NumberedRow = RebateRow & { order_no: string; part: number | null; parts: number | null; business_name: string; status_label: string; rebate_state: RebateState };

/** 这个代理名下每张内部单一行（不连 sync_inbox：一张内部单可能对多行商品，连了合计会重复） */
function agentOrderRows(db: Database.Database, agentId: string): NumberedRow[] {
  const rows = db.prepare(`SELECT r.order_id, r.agent_account_id, r.rebate_cents, r.paid_at,
      o.status, o.customer_name, o.business_type_id, o.sub_service_type, o.address_type, o.created_at,
      bt.name AS business_type_name, ${awaitingConfirmationSql("o")} AS awaiting
    FROM agent_rebates r JOIN orders o ON o.id = r.order_id LEFT JOIN business_types bt ON bt.id = o.business_type_id
    WHERE r.agent_account_id = ? ORDER BY o.created_at DESC, r.order_id`).all(agentId) as RebateRow[];
  const numbers = orderNumberInfoFor(db, rows.map(r => r.order_id));
  // 拆单：同一来源单号、这个代理名下、同业务名称有多张才标第几份，只在同业务内数。待填的也数，管理员和代理看到的份数一样，填了也不变号
  const groups = new Map<string, string[]>();
  const nameOf = new Map(rows.map(r => [r.order_id, agentBusinessName(r)]));
  for (const r of [...rows].sort((a, b) => (numbers.get(a.order_id)?.part ?? 0) - (numbers.get(b.order_id)?.part ?? 0))) {
    const source = numbers.get(r.order_id)?.source;
    if (!source) continue;
    const key = JSON.stringify([source, nameOf.get(r.order_id)]);
    groups.set(key, [...(groups.get(key) ?? []), r.order_id]);
  }
  const parts = new Map<string, { part: number; parts: number }>();
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((id, i) => parts.set(id, { part: i + 1, parts: ids.length }));
  return rows.map(r => ({
    ...r,
    order_no: numbers.get(r.order_id)?.display || r.order_id,
    part: parts.get(r.order_id)?.part ?? null,
    parts: parts.get(r.order_id)?.parts ?? null,
    business_name: nameOf.get(r.order_id) as string,
    status_label: agentStatusLabel(r.status, !!r.awaiting),
    rebate_state: rebateStateOf(r.status, r.paid_at),
  }));
}

/** 给业务系统的代理端：字段逐个列，金额、负责人、经办人、内部步骤名、备注一律不出去。没填返点的单不出去 */
export function agentOrdersForSync(db: Database.Database, agentId: string) {
  const steps = db.prepare("SELECT step_order, step_name, status, public_name FROM order_steps WHERE order_id = ? ORDER BY step_order");
  const totals = { waiting_cents: 0, earned_cents: 0, paid_cents: 0 };
  const orders = agentOrderRows(db, agentId).filter(r => r.rebate_cents !== null).map(r => {
    if (r.rebate_state !== "void") totals[`${r.rebate_state}_cents`] += r.rebate_cents as number;
    const internalSteps = steps.all(r.order_id) as { step_order: number; step_name: string; status: string; public_name: string | null }[];
    const view = customerStepView(r, internalSteps);
    return {
      key: r.order_id,
      order_no: r.order_no,
      part: r.part,
      parts: r.parts,
      business_name: r.business_name,
      customer_name: r.customer_name,
      status_label: r.status_label,
      rebate_cents: r.rebate_cents,
      rebate_state: r.rebate_state,
      steps: internalSteps.map((step, i) => view[i].description
        ? { step_order: step.step_order, step_name: view[i].name, status: step.status, description: view[i].description }
        : { step_order: step.step_order, step_name: view[i].name, status: step.status }),
      created_at: r.created_at,
    };
  });
  return { agent_id: agentId, orders, totals };
}

/** 代理记账页下面那张表 */
export function agentRebateRows(db: Database.Database, agentId: string) {
  return agentOrderRows(db, agentId).map(r => ({
    order_id: r.order_id,
    order_no: r.order_no,
    part: r.part,
    parts: r.parts,
    business_name: r.business_name,
    customer_name: r.customer_name,
    status_label: r.status_label,
    rebate_cents: r.rebate_cents,
    rebate_state: r.rebate_state,
    paid_at: r.paid_at,
    paid_anomaly: isPaidAnomaly(r.status, r.paid_at),
  }));
}

/** 代理记账页上面那张表。标红的钱只进 anomaly_cents，不再算进 waiting（一笔钱不在同一行出现两次） */
export function listAgents(db: Database.Database) {
  const sums = new Map<string, { order_count: number; unfilled_count: number; waiting_cents: number; earned_cents: number; paid_cents: number; anomaly_cents: number }>();
  for (const r of db.prepare(`SELECT r.agent_account_id, r.rebate_cents, r.paid_at, o.status FROM agent_rebates r JOIN orders o ON o.id = r.order_id`).all() as
    { agent_account_id: string; rebate_cents: number | null; paid_at: string | null; status: string }[]) {
    const sum = sums.get(r.agent_account_id) ?? { order_count: 0, unfilled_count: 0, waiting_cents: 0, earned_cents: 0, paid_cents: 0, anomaly_cents: 0 };
    sum.order_count += 1;
    sums.set(r.agent_account_id, sum);
    const state = rebateStateOf(r.status, r.paid_at);
    if (r.rebate_cents === null) { if (state !== "void") sum.unfilled_count += 1; continue; }
    if (isPaidAnomaly(r.status, r.paid_at)) sum.anomaly_cents += r.rebate_cents;
    else if (state !== "void") sum[`${state}_cents`] += r.rebate_cents;
  }
  return (db.prepare("SELECT account_id, name, login, status, created_at FROM agents ORDER BY created_at DESC, account_id").all() as
    { account_id: string; name: string; login: string; status: string; created_at: string }[]).map(a => {
    const sum = sums.get(a.account_id);
    return {
      account_id: a.account_id, name: a.name, login: a.login, status: a.status,
      order_count: sum?.order_count ?? 0, unfilled_count: sum?.unfilled_count ?? 0, waiting_cents: sum?.waiting_cents ?? 0, earned_cents: sum?.earned_cents ?? 0,
      paid_cents: sum?.paid_cents ?? 0, anomaly_cents: sum?.anomaly_cents ?? 0, created_at: a.created_at,
    };
  });
}

/** 能挂新单的代理（停用的不列） */
export function activeAgents(db: Database.Database): { account_id: string; name: string }[] {
  return db.prepare("SELECT account_id, name FROM agents WHERE status = 'active' ORDER BY name, account_id").all() as { account_id: string; name: string }[];
}

/**
 * 内部查重用的登录名写法，跟业务系统 splitLogin 同一套：带 @ 或带字母的原样；只有数字和分隔符的按手机号整理。
 * 不整理的话「081-234 5678」查不出重，业务系统又会按「已是代理账号」认回去、把那个账号的密码改掉。
 */
export function agentLoginKey(raw: string): string {
  const login = raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (login.includes("@") || /[A-Za-z]/.test(login)) return login;
  const phone = login
    .replace(/[๐-๙]/g, d => String(d.charCodeAt(0) - 0x0E50))
    .replace(/[０-９]/g, d => String(d.charCodeAt(0) - 0xFF10))
    .replace(/＋/g, "+")
    .replace(/[\s​-‍⁠﻿()（）.\-‐-―]/g, "");
  return /^\+?\d{6,15}$/.test(phone) ? phone : login;
}

/** 业务系统给手机号账号存的占位邮箱，不能当登录名开号 */
export function isPlaceholderLogin(login: string): boolean {
  return /^phone_.*@user\.xiangtai$/i.test(agentLoginKey(login));
}

export function agentLoginTaken(db: Database.Database, login: string): boolean {
  return !!db.prepare("SELECT 1 FROM agents WHERE lower(login) = lower(?)").get(agentLoginKey(login));
}

export function orderRebateView(db: Database.Database, orderId: string) {
  const row = db.prepare(`SELECT r.agent_account_id, COALESCE(a.name, '') AS agent_name, r.rebate_cents, r.paid_at, o.status
    FROM agent_rebates r JOIN orders o ON o.id = r.order_id LEFT JOIN agents a ON a.account_id = r.agent_account_id WHERE r.order_id = ?`).get(orderId) as
    { agent_account_id: string; agent_name: string; rebate_cents: number | null; paid_at: string | null; status: string } | undefined;
  if (!row) return null;
  return {
    agent_account_id: row.agent_account_id,
    agent_name: row.agent_name,
    rebate_cents: row.rebate_cents,
    rebate_state: rebateStateOf(row.status, row.paid_at),
    paid_at: row.paid_at,
    paid_anomaly: isPaidAnomaly(row.status, row.paid_at),
  };
}

/** 员工看的这张单：只有代理名字，返点、状态、已付一律不给 */
export function orderAgentForStaff(db: Database.Database, orderId: string): { agent_name: string } | null {
  const row = db.prepare(`SELECT COALESCE(a.name, '') AS agent_name FROM agent_rebates r LEFT JOIN agents a ON a.account_id = r.agent_account_id WHERE r.order_id = ?`).get(orderId) as { agent_name: string } | undefined;
  return row ? { agent_name: row.agent_name } : null;
}

type RebateLock = { agent_account_id: string; rebate_cents: number | null; paid_at: string | null };
const lockOf = (db: Database.Database, orderId: string) =>
  db.prepare("SELECT agent_account_id, rebate_cents, paid_at FROM agent_rebates WHERE order_id = ?").get(orderId) as RebateLock | undefined;
const orderStatusOf = (db: Database.Database, orderId: string) =>
  (db.prepare("SELECT status FROM orders WHERE id = ?").get(orderId) as { status: string } | undefined)?.status;
const agentStatusOf = (db: Database.Database, agentId: string) =>
  (db.prepare("SELECT status FROM agents WHERE account_id = ?").get(agentId) as { status: string } | undefined)?.status;

export function hasPaidRebate(db: Database.Database, orderId: string): boolean {
  return !!lockOf(db, orderId)?.paid_at;
}

/** 挂、换、改金额。已付要先撤销；新挂或换人时代理必须状态正常，同一个代理改金额允许已停用 */
export function saveOrderRebate(db: Database.Database, orderId: string, input: { agent_account_id?: unknown; rebate?: unknown }, actor: string) {
  const agentId = typeof input.agent_account_id === "string" ? input.agent_account_id.trim() : "";
  if (!agentId || agentId.length > 64) throw new AgentRebateError("请选代理");
  const cents = parseRebateCents(input.rebate);
  if (cents === null) throw new AgentRebateError(REBATE_RULE);
  db.transaction(() => {
    if (orderStatusOf(db, orderId) === undefined) throw new AgentRebateError(STALE_ORDER, 409);
    const current = lockOf(db, orderId);
    if (current?.paid_at) throw new AgentRebateError(PAID_LOCKED, 409);
    const agentStatus = agentStatusOf(db, agentId);
    const sameAgent = current?.agent_account_id === agentId;
    if (agentStatus === undefined || (!sameAgent && agentStatus !== "active")) throw new AgentRebateError(AGENT_UNAVAILABLE, 409);
    db.prepare(`INSERT INTO agent_rebates (order_id, agent_account_id, rebate_cents, created_by) VALUES (?, ?, ?, ?)
      ON CONFLICT(order_id) DO UPDATE SET agent_account_id = excluded.agent_account_id, rebate_cents = excluded.rebate_cents,
        updated_by = ?, updated_at = datetime('now')`).run(orderId, agentId, cents, actor, actor);
    logOperation(actor, !current ? "挂代理" : !sameAgent ? "换代理" : current.rebate_cents === null ? "填返点" : "改返点", "agent_rebate", orderId, `代理账号 ${agentId}`);
  })();
}

/** 员工挂代理：只选人不碰返点，这张单已经挂了就不能动 */
export function attachOrderAgent(db: Database.Database, orderId: string, input: { agent_account_id?: unknown }, actor: string) {
  const agentId = typeof input.agent_account_id === "string" ? input.agent_account_id.trim() : "";
  if (!agentId || agentId.length > 64) throw new AgentRebateError("请选代理");
  db.transaction(() => {
    const status = orderStatusOf(db, orderId);
    if (status === undefined) throw new AgentRebateError(STALE_ORDER, 409);
    if (lockOf(db, orderId)) throw new AgentRebateError(ALREADY_ATTACHED, 409);
    if (status === "客户取消") throw new AgentRebateError(ORDER_CANCELLED, 409);
    if (agentStatusOf(db, agentId) !== "active") throw new AgentRebateError(AGENT_UNAVAILABLE, 409);
    insertOrderRebate(db, orderId, { agent_account_id: agentId, rebate_cents: null }, actor);
  })();
}

export function removeOrderRebate(db: Database.Database, orderId: string, actor: string) {
  db.transaction(() => {
    if (orderStatusOf(db, orderId) === undefined) throw new AgentRebateError(STALE_ORDER, 409);
    const current = lockOf(db, orderId);
    if (current?.paid_at) throw new AgentRebateError(PAID_LOCKED, 409);
    if (!current) return;
    db.prepare("DELETE FROM agent_rebates WHERE order_id = ?").run(orderId);
    logOperation(actor, "解除代理", "agent_rebate", orderId, `代理账号 ${current.agent_account_id}`);
  })();
}

/** 已付只有订单已完成才能点；撤销不看订单状态（标红的单也要能撤）。重复点已付不改第一次的时间 */
export function setRebatePaid(db: Database.Database, orderId: string, paid: unknown, actor: string) {
  if (typeof paid !== "boolean") throw new AgentRebateError("paid 要是 true 或 false");
  db.transaction(() => {
    const status = orderStatusOf(db, orderId);
    if (status === undefined) throw new AgentRebateError(STALE_ORDER, 409);
    const current = lockOf(db, orderId);
    if (!paid) {
      if (!current?.paid_at) return;
      db.prepare("UPDATE agent_rebates SET paid_at = NULL, paid_by = NULL, updated_by = ?, updated_at = datetime('now') WHERE order_id = ?").run(actor, orderId);
      logOperation(actor, "撤销已付", "agent_rebate", orderId);
      return;
    }
    if (!current) throw new AgentRebateError("这张单没有挂代理", 409);
    if (current.rebate_cents === null) throw new AgentRebateError(REBATE_EMPTY, 409);
    if (status !== "已完成") throw new AgentRebateError("订单办完才能点已付", 409);
    if (current.paid_at) return;
    db.prepare("UPDATE agent_rebates SET paid_at = ?, paid_by = ?, updated_by = ?, updated_at = datetime('now') WHERE order_id = ?").run(new Date().toISOString(), actor, actor, orderId);
    logOperation(actor, "返点已付", "agent_rebate", orderId);
  })();
}

const blank = (v: unknown) => v === undefined || v === null || v === "";

/**
 * 建单时带的代理字段（POST /api/orders，事务外校验）：管理员两个都给或都不给；员工只能选代理，带返点字段就 403。
 * 返回 input 为 null 表示这张单不挂代理。
 */
export function readOrderAgentFields(db: Database.Database, body: { agent_account_id?: unknown; agent_rebate?: unknown }, role: string):
  { error: string; status: number } | { input: { agent_account_id: string; rebate_cents: number | null } | null } {
  const isEmployee = role === "employee";
  if (body.agent_rebate !== undefined && role !== "admin") return { error: "无权限", status: 403 };
  if (body.agent_account_id !== undefined && role !== "admin" && !isEmployee) return { error: "无权限", status: 403 };
  if (blank(body.agent_account_id) && blank(body.agent_rebate)) return { input: null };
  if (!isEmployee && (blank(body.agent_account_id) || blank(body.agent_rebate))) return { error: "代理和返点要一起填，或者都不填", status: 400 };
  const cents = isEmployee ? null : parseRebateCents(body.agent_rebate);
  if (!isEmployee && cents === null) return { error: REBATE_RULE, status: 400 };
  if (typeof body.agent_account_id !== "string" || body.agent_account_id.length > 64) return { error: "请选代理", status: 400 };
  if (agentStatusOf(db, body.agent_account_id) !== "active") return { error: AGENT_UNAVAILABLE, status: 409 };
  return { input: { agent_account_id: body.agent_account_id, rebate_cents: cents } };
}

/** 必须在建单事务里调 */
export function insertOrderRebate(db: Database.Database, orderId: string, input: { agent_account_id: string; rebate_cents: number | null }, actor: string) {
  db.prepare("INSERT INTO agent_rebates (order_id, agent_account_id, rebate_cents, created_by) VALUES (?, ?, ?, ?)").run(orderId, input.agent_account_id, input.rebate_cents, actor);
  logOperation(actor, "挂代理", "agent_rebate", orderId, `代理账号 ${input.agent_account_id}`);
}
