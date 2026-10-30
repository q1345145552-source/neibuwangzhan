import type Database from "better-sqlite3";
import { isParallelFlow } from "./step-status";

/**
 * 发给全体在职员工的提醒：按人各写一条（同请假提醒的写法），客户账号与离职员工不发。
 *
 * 2026-10-03 起不再用 recipient='' 广播：广播是全员共用一行，一人点开大家都算已读；
 * 且「全部已读」只清 recipient=本人 的行，广播刷新后又回到未读，铃铛角标清不掉。
 * type 用 '' 以兼容表上 CHECK 的既有枚举，不动约束。
 */
function notifyAllStaff(db: Database.Database, title: string, detail: string, relatedId: string): void {
  const staff = db.prepare(
    "SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND status = '在职' AND name <> ''"
  ).all() as { name: string }[];
  const insert = db.prepare(
    "INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')"
  );
  for (const { name } of staff) insert.run(title, detail, name, relatedId);
}

/**
 * 待分类订单提醒（规则 6「提醒员工，确认归属后处理」的落地）。
 * 全员都收到——谁看到谁领取（PATCH 订单填负责人即认领，改业务线即归类）。
 * 9-22 老板定「全员广播」；10-03 选每人各一条（别人领了，自己那条要自己点掉）。
 */
export function notifyUnclassifiedOrder(
  db: Database.Database,
  orderId: string,
  detail: string,
): void {
  notifyAllStaff(db, "待分类订单待领取", detail, orderId);
}

/** 客户站送来资料的提醒（2026-10-03 资料打通）：一批算一条，每个在职员工一条。 */
export function notifyCustomerDocuments(
  db: Database.Database,
  sourceOrderNo: string,
  detail: string,
): void {
  notifyAllStaff(db, "客户提交了资料", detail, sourceOrderNo);
}

/** 客户站新单提醒（2026-10-03 老板选「发给所有员工」：已对上业务线的新单也提醒）。related_id 用第一张对上业务线的办理单号（10-16 起）。 */
export function notifyNewSyncedOrder(
  db: Database.Database,
  internalOrderId: string,
  detail: string,
): void {
  notifyAllStaff(db, "客户站新订单", detail, internalOrderId);
}

/** 客户在业务网站取消了还没确认的单（2026-10-30）：新单提醒发给了全体在职员工，取消也告诉全体，免得有人还去确认、联系客户。 */
export function notifyUnconfirmedOrderCancelled(
  db: Database.Database,
  internalOrderId: string,
  detail: string,
): void {
  notifyAllStaff(db, "客户取消了订单", detail, internalOrderId);
}

/** 内部商城新单提醒（2026-10-15）：对上业务线的商城单原来一条提醒都不发，照客户站新单的规矩提醒全体在职员工。related_id 用办理单号。 */
export function notifyNewMallOrder(
  db: Database.Database,
  internalOrderId: string,
  detail: string,
): void {
  notifyAllStaff(db, "商城新订单", detail, internalOrderId);
}

/**
 * 回传客户站一直失败的提醒（2026-10-15）：只发在职管理员，每人一条。related_id 用客户站单号，消息中心会换成办理单号。
 * 客户站长时间连不上时各条事件会陆续失败：管理员手上还有 12 小时内没读的同类提醒就不另发，把新的单号补进那一条（不吞掉）。
 */
export function notifySyncBackFailure(
  db: Database.Database,
  sourceOrderNo: string,
  detail: string,
): void {
  const admins = db.prepare(
    "SELECT DISTINCT name FROM employees WHERE role = 'admin' AND status = '在职' AND name <> ''"
  ).all() as { name: string }[];
  const insert = db.prepare(
    "INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')"
  );
  const pending = db.prepare(
    "SELECT id, body FROM notifications WHERE recipient = ? AND type = '' AND related_type = 'order' AND title = '客户站同步失败' AND is_read = 0 AND created_at >= datetime('now','-12 hours') ORDER BY id DESC LIMIT 1"
  );
  const append = db.prepare("UPDATE notifications SET body = ? WHERE id = ?");
  for (const { name } of admins) {
    const open = pending.get(name) as { id: number; body: string } | undefined;
    if (!open) { insert.run("客户站同步失败", detail, name, sourceOrderNo); continue; }
    // 一次断线只留一条，但后面失败的单不能被吞掉：把单号补进那条还没读的提醒
    if (sourceOrderNo && !open.body.includes(sourceOrderNo)) append.run(`${open.body}\n又有一单没送到：客户站订单 ${sourceOrderNo}。`.slice(0, 2000), open.id);
  }
}

/**
 * 客户站内申请取消的提醒（2026-10-03，规则 19/20）：批准取消仅管理员可操作（规则 4），
 * 所以只发在职管理员，每人一条；related_id 用办理单号，便于按单查。
 */
export function notifyCancelRequest(
  db: Database.Database,
  internalOrderId: string,
  detail: string,
): void {
  const admins = db.prepare(
    "SELECT DISTINCT name FROM employees WHERE role = 'admin' AND status = '在职' AND name <> ''"
  ).all() as { name: string }[];
  const insert = db.prepare(
    "INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')"
  );
  for (const { name } of admins) insert.run("客户申请取消", detail, name, internalOrderId);
}

/**
 * 上一步做完（或跳过）后提醒下一步的人「轮到你了」（2026-10-16）。
 * - 收件人：下一步的经办人（几个人写在一起的拆开）；没写经办人的算订单负责人；只发在岗员工，名字完全一样才算；不发给刚点完成的本人
 * - 经办人一个在岗员工都对不上（已离职，或者写的是合作方如清关的 Next）：改发订单负责人；负责人也对不上，发在职管理员、写明要派人
 *   （跟超时提醒同一写法，2026-10-16）
 * - 公司注册那套各步互不阻塞，没有「下一步」，不发（公司变更按顺序走，照发）；已取消、已办完的单不发
 * - 同一张单同一步，收件人手上还有没读的同一条就不重复发
 */
export function notifyNextStep(db: Database.Database, orderId: string, fromStepOrder: number, actor: string, how: "已办完" | "已跳过" = "已办完"): void {
  const order = db.prepare("SELECT id, customer_name, business_type_id, sub_service_type, status, responsible_person FROM orders WHERE id = ?").get(orderId) as
    { id: string; customer_name: string; business_type_id: number; sub_service_type: string | null; status: string; responsible_person: string | null } | undefined;
  if (!order || order.status === "客户取消" || order.status === "已完成" || isParallelFlow(order.business_type_id, order.sub_service_type)) return;
  const next = db.prepare(
    "SELECT step_name, step_order, assignee FROM order_steps WHERE order_id = ? AND step_order > ? AND status NOT IN ('已完成','已跳过') ORDER BY step_order LIMIT 1"
  ).get(orderId, fromStepOrder) as { step_name: string; step_order: number; assignee: string | null } | undefined;
  if (!next) return;
  // 下一步前面还有没办完的（比如中间某步撤回了），还没轮到它，不提醒
  if (db.prepare("SELECT 1 FROM order_steps WHERE order_id = ? AND step_order < ? AND status NOT IN ('已完成','已跳过') LIMIT 1").get(orderId, next.step_order)) return;
  const done = db.prepare("SELECT step_name FROM order_steps WHERE order_id = ? AND step_order = ?").get(orderId, fromStepOrder) as { step_name: string } | undefined;
  const split = (v: string | null | undefined) => (v || "").split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean);
  // 在岗（在职、试用期、待离职）都算，跟超时提醒、流程设置同一口径
  const staff = db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND status NOT IN ('离职','停薪留职') AND name <> ''").all() as { name: string }[];
  const byLower = new Map(staff.map((e) => [e.name.trim().toLowerCase(), e.name]));
  const me = actor.trim().toLowerCase();
  const active = (names: string[]) => names.map((n) => byLower.get(n.toLowerCase())).filter((n): n is string => !!n);
  const assignees = split(next.assignee);
  const owners = active(split(order.responsible_person));
  // 先找经办人；经办人没写或一个都不在岗，找负责人；负责人也没有，找管理员（本人不在内：本人在岗就不用提醒自己）
  let wanted = active(assignees);
  let reason = "是你的";
  if (!wanted.length) {
    wanted = owners;
    reason = assignees.length ? `的经办人 ${assignees.join("、")} 不在岗或不是员工账号，算你这个负责人的` : "没写经办人，算你这个负责人的";
  }
  if (!wanted.length) {
    wanted = (db.prepare("SELECT DISTINCT name FROM employees WHERE role = 'admin' AND status = '在职' AND name <> ''").all() as { name: string }[]).map((r) => r.name);
    reason = `没人接手（${assignees.length ? `经办人 ${assignees.join("、")} 不在岗` : "没写经办人"}，也没有在岗的负责人），要派人`;
  }
  const recipients = [...new Set(wanted.filter((n) => n.trim().toLowerCase() !== me))];
  const nextPart = `下一步「${next.step_name}」`;
  const detail = `订单 ${order.id}（${order.customer_name}）「${done?.step_name || "上一步"}」${how}，${nextPart}${reason}。`;
  // 去重按「收件人 + 订单 + 下一步」：同一步还有没读的就不再发（不比整段正文，正文里带着上一步的名字）
  const exists = db.prepare("SELECT 1 FROM notifications WHERE recipient = ? AND type = '' AND related_type = 'order' AND title = '轮到你了' AND related_id = ? AND instr(body, ?) > 0 AND is_read = 0 LIMIT 1");
  const insert = db.prepare("INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')");
  for (const name of recipients) if (!exists.get(name, order.id, nextPart)) insert.run("轮到你了", detail, name, order.id);
}

/**
 * 老板核对收入时点了「未到账」（2026-10-16）：告诉录这笔收入的员工和订单负责人（同一个人只发一条），好去问客户。
 * 只发在岗员工；不发给点「未到账」的本人。点开进订单。
 */
export function notifyIncomeNotArrived(db: Database.Database, orderId: string, financeId: number, actor: string): void {
  const fin = db.prepare("SELECT amount, currency, created_by, verify_note FROM finances WHERE id = ?").get(financeId) as
    { amount: number; currency: string | null; created_by: string | null; verify_note: string | null } | undefined;
  const order = db.prepare("SELECT id, customer_name, responsible_person FROM orders WHERE id = ?").get(orderId) as
    { id: string; customer_name: string; responsible_person: string | null } | undefined;
  if (!fin || !order) return;
  const staff = db.prepare("SELECT DISTINCT name FROM employees WHERE role IN ('admin','employee') AND status NOT IN ('离职','停薪留职') AND name <> ''").all() as { name: string }[];
  const byLower = new Map(staff.map((e) => [e.name.trim().toLowerCase(), e.name]));
  const split = (v: string | null | undefined) => (v || "").split(/[\/、,，]/).map((x) => x.trim()).filter(Boolean);
  const me = actor.trim().toLowerCase();
  const recipients = [...new Set([...split(fin.created_by), ...split(order.responsible_person)]
    .map((n) => byLower.get(n.toLowerCase())).filter((n): n is string => !!n && n.trim().toLowerCase() !== me))];
  const money = `${fin.currency === "THB" ? "฿" : "¥"}${Number(fin.amount).toLocaleString()}`;
  const detail = `订单 ${order.id}（${order.customer_name}）记的收入 ${money}，核对为未到账：${fin.verify_note || "没写原因"}。请跟客户确认。`;
  const insert = db.prepare("INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,?,?,'order')");
  for (const name of recipients) insert.run("收入未到账", detail, name, order.id);
}
