import type { CommerceTerms } from "@/lib/commerce-types";

/** Same immutable entitlement summary at quote, sale, and staff fulfillment entry. */
export function CommerceTermsSummary({ terms }: { terms: CommerceTerms | null | undefined }) {
  if (!terms) return <p className="text-sm">旧成交未记录结构化权益，请按原购买资料核对；不按当前商品反推。</p>;
  if (terms.quantity_basis === "trademark") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>泰国商标注册：每份 1 个商标、1 个大类、{terms.minor_items_per_copy} 个小项。</p>
    <p>份数是独立申请份数；小项是每份包含的规格，不额外拆单或乘一次价格。</p>
    <p className="text-[var(--muted-foreground)]">商标名称、类别与图样下单后按原流程提交核对；国际商标、转让、专利及额外费用不在本项声明。</p>
  </div>;
  // 未核对流程的兜底条款：如实告知「已接单、待归类」，不虚构权益内容。
  if (terms.quantity_basis === "unclassified") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>该服务的办理流程尚未核对，订单已受理并进入「待分类」。</p>
    <p>工作人员确认归属后会按对应业务的正式流程办理，届时更新服务内容说明。</p>
    <p className="text-[var(--muted-foreground)]">成交价格以下单快照为准；归类不改变已成交价格。</p>
  </div>;
  return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>公司类型：{terms.company_structure === "foreign" ? "纯外资" : "合资"} · 公司注册：包含 · VAT 登记：{terms.vat_registration === "included" ? "包含" : "不包含"}</p>
    <p>1 份 = 1 家公司独立办理。{terms.vat_registration === "included" ? "本商品包含 VAT 登记，不另建收费单。" : "本商品不包含 VAT 登记，保留核对步骤不代表购买该服务。"}</p>
    <p className="text-[var(--muted-foreground)]">银行、地址、月度财税、变更等附属服务未在本项声明，需另行核对；流程有该步骤不等于已经购买，不自动订阅或加费。</p>
  </div>;
}
