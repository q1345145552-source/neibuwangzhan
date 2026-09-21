import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { getOrderStepsWithDocs } from "./db";
import type { CommerceTerms } from "./commerce-types";

export class CommerceTemplateError extends Error {}

const DEFINITIONS = {
  company: { key:"company-registration-v1", businessName:"公司注册", businessId:1, subService:"company-reg", addressType:"client",
    namesHash:"22e8ea2f2f5a70dee6900a1f11f1dc6d94b9bbe01f12a2849bc7608a57384b8f",
    publicNames:["方案确认","资料准备","注册账号办理","身份核验","注册补充事项","印章办理","VAT 登记","银行开户","地址服务","财税服务","公司变更事项","资料交付"] },
  trademark: { key:"thai-trademark-v1", businessName:"商标", businessId:2, subService:"tm-reg", addressType:"",
    namesHash:"8470e70a37e8ba8aa89d34fdfefbf74a7dec82c4499ca306212af1d669f70b24",
    publicNames:["方案确认","商标名称核对","查重与分类核对","账单核对","申请资料准备","申请提交","缴费进度","办理资料交付"] },
  // 未核对流程商品的兜底（用户 2026-09-20 拍板「接单不拒单」，规则 6）：挂「待分类」业务线，
  // 员工确认归属后改派。businessId=-1 是哨兵：该业务线由迁移按名称追加插入，编号随库漂移，
  // 运行时按名称解析，不做固定编号比对（其余业务线仍严格比对，防种子顺序漂移）。
  unclassified: { key:"unclassified-v1", businessName:"待分类", businessId:-1, subService:"storefront-unclassified", addressType:"",
    namesHash:"8546045644a7ea1432058f134852a5d81541699f76dc4e11f95119f02f55eea4",
    publicNames:["方案确认","确认服务归属"] },
} as const;

/** Select only a reviewed original workflow; nothing in a product name controls dispatch. */
export function commerceWorkflow(db: Database.Database, terms: CommerceTerms) {
  const definition = DEFINITIONS[terms.quantity_basis];
  const business = db.prepare("SELECT id FROM business_types WHERE name=?").get(definition.businessName) as { id:number } | undefined;
  if (!business) throw new CommerceTemplateError(definition.businessName + "业务线不存在，订单尚未创建");
  if (definition.businessId >= 0 && business.id !== definition.businessId) throw new CommerceTemplateError(definition.businessName + "流程编号需核对，订单尚未创建");
  const steps = getOrderStepsWithDocs(business.id,definition.subService,definition.addressType);
  if (steps.length !== definition.publicNames.length || createHash("sha256").update(JSON.stringify(steps.map(s=>s.name))).digest("hex") !== definition.namesHash)
    throw new CommerceTemplateError(definition.businessName + "流程已变化，公开步骤映射需复核");
  return { ...definition, businessId: business.id, steps };
}
