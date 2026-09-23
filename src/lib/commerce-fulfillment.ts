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
  // ── 2026-09-20 放行的五个家族（内部均有专属模板，hash 锁定；公开名中性化，不带人名/内部金额）──
  "social-security": { key:"social-security-v1", businessName:"社保开户", businessId:11, subService:"social-security", addressType:"",
    namesHash:"c13db3839e722b5a846a50403014e758fed0abcb4bb7a2b303b58cd7e8ebdf20",
    publicNames:["方案确认","收集公司资料","准备雇员信息表","填写社保局表格","签字盖章","社保预缴金垫付","提交社保局登记","领取雇主登记号","开通网上业务账号","交付办理结果"] },
  "mall-store": { key:"mall-store-v1", businessName:"Mall开店", businessId:8, addressType:"",
    variants:{
      shopee:{ subService:"shopee", namesHash:"a6a078aefb3548ad106a10049533c3370b083890f6350408a9868d3eacd3553c",
        publicNames:["方案确认","收集入驻资料","检查产品与品牌标识","提交初步审核","等待平台初审","税务信息审核","等待平台联系","确认套餐与付款","店铺上线"] },
      lazada:{ subService:"lazada", namesHash:"d1c9a427d330f30b812b030eacfc13e4a36f47152788cfc965aba3d80c5c1cd1",
        publicNames:["方案确认","收集入驻资料","提交平台审核","添加仓库地址","店铺上线"] },
      tiktok:{ subService:"tiktok", namesHash:"68324d7f651a54d49fcdc9016827a09923992b0f6c0288b49711d9aac2d6f97d",
        publicNames:["方案确认","收集入驻资料","申请品牌认证","准备其他平台店铺资料","商品添加品牌","提交平台审核","审核通过店铺上线"] },
    } },
  "trademark-international": { key:"international-trademark-v1", businessName:"商标", businessId:2, subService:"international", addressType:"",
    namesHash:"79746520e9f10dfe559cc754798527242dc04fb8f40fffeb2b35391a46c478c9",
    publicNames:["方案确认","确认需求","商标查重","分类确认","收费开票","文件整理","提交申请","缴费","取得商标并交付"] },
  "dld-product": { key:"dld-product-v1", businessName:"DLD", businessId:5, subService:"product", addressType:"",
    namesHash:"4ca8d986779150ce2c67bc3c28e041c0d7d59e589442100e7e01d5144dc71d6d",
    publicNames:["方案确认","收集资料","检查文件完整性","提交审批","等待审批","现场检查场地"] },
  nbtc: { key:"nbtc-v1", businessName:"NBTC", businessId:9, subService:"", addressType:"",
    namesHash:"60210b4d1424633dd068730d93810fcb75d6e9ae2bab7e63ce2b77d63dc0a2cd",
    publicNames:["方案确认","提供产品图与规格书","确认是否需要认证","准备全套文件","系统注册登记","准备授权委托书","补充文件","审批通过与清关准备","获取进口单据","货物送达认证机构","送样检测","等待检测结果","取得证书"] },
} as const;

/** Select only a reviewed original workflow; nothing in a product name controls dispatch. */
export function commerceWorkflow(db: Database.Database, terms: CommerceTerms) {
  // attachment 在报价/下单入口已被拦截，不进入建单；类型上显式排除以便索引 DEFINITIONS
  if (terms.quantity_basis === "attachment") throw new CommerceTemplateError("附加费用不建独立办理单");
  const definition = DEFINITIONS[terms.quantity_basis];
  if (!definition) throw new CommerceTemplateError("该权益类型未配置审核流程：" + terms.quantity_basis);
  // Mall 三平台共用一族条款，按 terms.platform 选择对应子服务与模板
  const variant = "variants" in definition && "platform" in terms && typeof terms.platform === "string"
    ? definition.variants[terms.platform as keyof typeof definition.variants] : undefined;
  if ("variants" in definition && !variant) throw new CommerceTemplateError("Mall 开店缺少平台模板：" + String((terms as { platform?: string }).platform));
  // mall-store 条目的模板在 variants 内，其余家族在顶层；类型上用断言统一取值
  const subService = variant ? variant.subService : (definition as { subService: string }).subService;
  const namesHash = variant ? variant.namesHash : (definition as { namesHash: string }).namesHash;
  const publicNames = (variant ? variant.publicNames : (definition as { publicNames: readonly string[] }).publicNames) as readonly string[];
  const business = db.prepare("SELECT id FROM business_types WHERE name=?").get(definition.businessName) as { id:number } | undefined;
  if (!business) throw new CommerceTemplateError(definition.businessName + "业务线不存在，订单尚未创建");
  if (definition.businessId >= 0 && business.id !== definition.businessId) throw new CommerceTemplateError(definition.businessName + "流程编号需核对，订单尚未创建");
  const steps = getOrderStepsWithDocs(business.id, subService, definition.addressType);
  if (steps.length !== publicNames.length || createHash("sha256").update(JSON.stringify(steps.map(s=>s.name))).digest("hex") !== namesHash)
    throw new CommerceTemplateError(definition.businessName + "流程已变化，公开步骤映射需复核");
  return { ...definition, subService, namesHash, publicNames, businessId: business.id, steps };
}
