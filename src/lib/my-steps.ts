import type Database from "better-sqlite3";

/**
 * 「我的环节」和首页「今日待办」共用的口径（2026-10-15）：
 * - 步骤经办人写着我；或者步骤没写经办人、这张单的负责人是我（负责人兜底：公司变更、企业店、场地确认、
 *   待分类，以及每张单第一步「方案确认」都没有预设经办人，认领就是填负责人，9-22 定的「认领的员工自己填」）
 * - 已完成的步骤、已取消（客户取消）的单不算
 * - can_start：前一步已完成（公司注册各步互不阻塞，同订单详情页「标记完成」的规则）；今日待办只数能动手的
 * 经办人照原来按 LIKE 模糊匹配，兼容「Prae / Namcha」这种几个人写在一起的写法；
 * 负责人兜底这一支按「拆开后名字完全一样、不分大小写」比（与办理月报同一比法），免得 Ann 把 Anna 的单算进来。
 */
export type MyStep = {
  step_id: number; order_id: string; step_name: string; status: string; step_order: number;
  customer_name: string; business_type_id: number; business_type_name: string;
  via_owner: number; can_start: number;
};

const splitNames = (v: string | null | undefined) => (v || "").split(/[\/、,，]/).map(x => x.trim().toLowerCase()).filter(Boolean);

export function listMySteps(db: Database.Database, userName: string): MyStep[] {
  const like = `%${userName}%`;
  const me = userName.trim().toLowerCase();
  const rows = db.prepare(`
    SELECT os.id AS step_id, os.order_id, os.step_name, os.status, os.step_order,
           o.customer_name, o.business_type_id, bt.name AS business_type_name, o.responsible_person,
           CASE WHEN trim(COALESCE(os.assignee,'')) = '' THEN 1 ELSE 0 END AS via_owner,
           CASE WHEN o.business_type_id = 1 OR NOT EXISTS (
             SELECT 1 FROM order_steps p WHERE p.order_id = os.order_id AND p.step_order = os.step_order - 1 AND p.status != '已完成'
           ) THEN 1 ELSE 0 END AS can_start
    FROM order_steps os
    JOIN orders o ON os.order_id = o.id
    JOIN business_types bt ON o.business_type_id = bt.id
    WHERE os.status NOT IN ('已完成','已停止') AND o.status != '客户取消'
      AND (os.assignee LIKE ? OR (trim(COALESCE(os.assignee,'')) = '' AND COALESCE(o.responsible_person,'') LIKE ?))
    ORDER BY os.step_order, os.order_id
  `).all(like, like) as (MyStep & { responsible_person: string | null })[];
  return rows
    .filter(r => !r.via_owner || splitNames(r.responsible_person).includes(me))
    .map(({ responsible_person: _owner, ...r }) => r);
}
