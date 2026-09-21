import type Database from "better-sqlite3";

/**
 * 待分类订单提醒（规则 6「提醒员工，确认归属后处理」的落地）。
 *
 * recipient='' 为广播：notifications 路由的查询条件是 `recipient = ? OR recipient = ''`，
 * 普通员工与管理员都会在侧边栏通知里看到——谁看到谁领取（PATCH 订单填负责人即认领，
 * 改业务线即归类）。type 用 '' 以兼容表上 CHECK 的既有枚举，不动约束。
 * 提醒范围暂为全员广播，这是最安全的默认（不漏人）；交接稿 §7「待分类提醒对象」
 * 待老板明确固定认领人后再收窄。
 */
export function notifyUnclassifiedOrder(
  db: Database.Database,
  orderId: string,
  detail: string,
): void {
  db.prepare(
    "INSERT INTO notifications (type,title,body,recipient,related_id,related_type) VALUES ('',?,?,'',?,'order')"
  ).run("待分类订单待领取", detail, orderId);
}
