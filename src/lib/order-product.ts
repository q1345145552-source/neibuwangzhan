/**
 * 订单列表里的「产品描述」（2026-11-10 老板要）：就是订单的「描述」，同一个客户多个产品时不用点进订单看。
 * 业务线页面（BusinessLinePage）和国际商标、购买R标、TikTok、Lazada、场地确认这几张单独的表都用这一个，口径一致。
 * 空的返回空字符串，页面自己决定显示「—」还是不显示。
 */
export function productDescription(order: { description?: string | null }): string {
  return (order.description ?? "").trim();
}
