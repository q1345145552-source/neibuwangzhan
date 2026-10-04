import type Database from "better-sqlite3";

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

/** 客户站新单提醒（2026-10-03 老板选「发给所有员工」：已对上业务线的新单也提醒）。 */
export function notifyNewSyncedOrder(
  db: Database.Database,
  sourceOrderNo: string,
  detail: string,
): void {
  notifyAllStaff(db, "客户站新订单", detail, sourceOrderNo);
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
