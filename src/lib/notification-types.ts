// 消息中心只显示这几类通知（工单/待办/规则/老板通知），其余请假/考勤/VAT/业务线等过滤掉
export const MESSAGE_CENTER_TYPES = ["工单指派", "工单完成", "待办指派", "待办完成", "规则更新", "老板通知"] as const;

// 客户站同步来的订单提醒（src/lib/order-alerts.ts 写入）。10-03 老板定：客户站新单、待分类待领取、
// 客户交资料、客户申请取消都要提醒员工。表上类型约束里没有这几类，写入时 type 为空（不动约束），
// 所以按「related_type=order + 这几个标题」认出来，一起放进消息中心。
// 10-15 加：内部商城新单（原来对上业务线的不提醒）、回传客户站一直失败（只发管理员）。
// 10-16 加：上一步办完提醒下一步的人「轮到你了」。
// 10-16 再加：证书快到期（到期前 60、30 天）、步骤超时（超过流程设置里的预计天数）。
export const CUSTOMER_SITE_ALERT_TITLES = ["客户站新订单", "待分类订单待领取", "客户提交了资料", "客户申请取消", "商城新订单", "客户站同步失败", "轮到你了", "证书快到期", "步骤超时"] as const;

/** 消息中心的筛选条件：列表和侧栏未读角标共用，保证两边口径一致 */
export function messageCenterFilter(): { sql: string; params: string[] } {
  const types = MESSAGE_CENTER_TYPES.map(() => "?").join(",");
  const titles = CUSTOMER_SITE_ALERT_TITLES.map(() => "?").join(",");
  return {
    sql: `(type IN (${types}) OR (type = '' AND related_type = 'order' AND title IN (${titles})))`,
    params: [...MESSAGE_CENTER_TYPES, ...CUSTOMER_SITE_ALERT_TITLES],
  };
}
