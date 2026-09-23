import type { CommerceTerms } from "@/lib/commerce-types";

/** Same immutable entitlement summary at quote, sale, and staff fulfillment entry. */
export function CommerceTermsSummary({ terms }: { terms: CommerceTerms | null | undefined }) {
  if (!terms) return <p className="text-sm">旧成交未记录结构化权益，请按原购买资料核对；不按当前商品反推。</p>;
  if (terms.quantity_basis === "trademark") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>泰国商标注册：每份 1 个商标、1 个大类、{terms.minor_items_per_copy} 个小项。</p>
    <p>份数是独立申请份数；小项是每份包含的规格，不额外拆单或乘一次价格。</p>
    <p className="text-[var(--muted-foreground)]">商标名称、类别与图样下单后按原流程提交核对；国际商标、转让、专利及额外费用不在本项声明。</p>
  </div>;
  if (terms.quantity_basis === "unclassified") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>该服务的办理流程尚未核对，订单已受理并进入「待分类」。</p>
    <p>工作人员确认归属后会按对应业务的正式流程办理，届时更新服务内容说明。</p>
    <p className="text-[var(--muted-foreground)]">成交价格以下单快照为准；归类不改变已成交价格。</p>
  </div>;
  if (terms.quantity_basis === "attachment") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>附加费用：随对应主服务一并收取，不能单独购买。</p>
    <p className="text-[var(--muted-foreground)]">请先选购对应的主服务，该项费用将随主服务一并结算与办理。</p>
  </div>;
  if (terms.quantity_basis === "social-security") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>公司社保登记：每份为一家公司的社保开户登记。</p>
    <p className="text-[var(--muted-foreground)]">雇员参保名单与金额在办理中按社保局要求提交核对；每月代缴不在本项声明。</p>
  </div>;
  if (terms.quantity_basis === "mall-store") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>Mall 店入驻（{terms.platform === "shopee" ? "Shopee" : terms.platform === "lazada" ? "Lazada" : "TikTok"}）：每份为一个店铺的入驻办理。</p>
    <p className="text-[var(--muted-foreground)]">平台套餐费与保证金等第三方费用以平台账单为准，不包含在本项服务费内。</p>
  </div>;
  if (terms.quantity_basis === "trademark-international") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>国际商标注册（{terms.registration_country}）：每份为 1 个商标在该国家/地区的注册申请。</p>
    <p className="text-[var(--muted-foreground)]">商标名称、类别与图样下单后按原流程提交核对。</p>
  </div>;
  if (terms.quantity_basis === "dld-product") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>DLD 宠物饲料注册：每份为 1 个产品的注册办理。</p>
    <p className="text-[var(--muted-foreground)]">产品配方与工序资料在办理中提交核对；场地检查以官方安排为准。</p>
  </div>;
  if (terms.quantity_basis === "nbtc") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>NBTC 认证：每份为 1 类产品的认证办理，总周期约 3-4 个月。</p>
    <p className="text-[var(--muted-foreground)]">检测与官方规费以实际发生为准；清关配合事项办理中另行通知。</p>
  </div>;
  if (terms.quantity_basis === "company-service") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>{terms.service === "vat" ? "VAT 税号注册" : terms.service === "bank" ? "银行开户（对公账户）" : "注册地址服务"}：每份为 1 项独立办理。</p>
    <p className="text-[var(--muted-foreground)]">办理进度暂按公司注册全流程展示，实际以本项服务内容为准；不含其他附属服务。</p>
  </div>;
  if (terms.quantity_basis === "company-change") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>公司变更：地址迁移、董事/股东变更、增减资、改印章、经营范围等，收资料后递交官方办理。</p>
    <p className="text-[var(--muted-foreground)]">具体变更类型以提交的资料为准；政府规费按变更事项另计。</p>
  </div>;
  if (terms.quantity_basis === "address-cert") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>FDA 场地认证：为产品认证办理合规场地确认（含 FDA 系统开通与官方现场检查）。</p>
    <p className="text-[var(--muted-foreground)]">使用湘泰场地的含租赁合同与首月租金；客户自有场地不含租赁环节。</p>
  </div>;
  if (terms.quantity_basis === "mall-enterprise") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>企业店入驻（{terms.platform === "shopee" ? "Shopee" : terms.platform === "lazada" ? "Lazada" : "TikTok"}）：每份为 1 个店铺的入驻办理。</p>
    <p className="text-[var(--muted-foreground)]">与 Mall 店（品牌认证型）为不同店铺类型；平台费用以平台账单为准。</p>
  </div>;
  if (terms.quantity_basis === "trademark-buy-r") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>商标转让：匹配已注册商标（R标）并办理权利转让登记。</p>
    <p className="text-[var(--muted-foreground)]">商标编号与类别以沟通确认为准；转让登记规费按规定另计。</p>
  </div>;
  if (terms.quantity_basis === "trademark-th-plus") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>泰国商标注册（1 个大类 6 个及以上小类）：一口价，不随小类数量加价。</p>
    <p className="text-[var(--muted-foreground)]">政府注册登记费按小类数另计；建议同一大类不超过 10-20 个小类。</p>
  </div>;
  if (terms.quantity_basis === "fda-product") return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>FDA 产品注册（{terms.category === "cosmetics" ? "化妆品" : terms.category === "food" ? "食品（含保健食品）" : terms.category === "hazard" ? "危险物质" : "医疗器械"}）：每份为 1 个产品的注册备案。</p>
    <p className="text-[var(--muted-foreground)]">官方审核周期以品类为准；补件或检测产生的官方费用另计。</p>
  </div>;
  return <div className="space-y-1 text-sm" data-commerce-terms={terms.version}>
    <p>公司类型：{terms.company_structure === "foreign" ? "纯外资" : "合资"} · 公司注册：包含 · VAT 登记：{terms.vat_registration === "included" ? "包含" : "不包含"}</p>
    <p>1 份 = 1 家公司独立办理。{terms.vat_registration === "included" ? "本商品包含 VAT 登记，不另建收费单。" : "本商品不包含 VAT 登记，保留核对步骤不代表购买该服务。"}</p>
    <p className="text-[var(--muted-foreground)]">银行、地址、月度财税、变更等附属服务未在本项声明，需另行核对；流程有该步骤不等于已经购买，不自动订阅或加费。</p>
  </div>;
}
