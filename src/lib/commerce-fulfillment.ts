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
  // ── 2026-09-22 逐项裁决放行的七族 ──
  // 线1附属服务：裁决「先套公司全套流程」——三服务共用 company 12 步模板，仅子服务标记不同
  "company-service": { key:"company-service-v1", businessName:"公司注册", businessId:1, addressType:"client",
    namesHash:"22e8ea2f2f5a70dee6900a1f11f1dc6d94b9bbe01f12a2849bc7608a57384b8f",
    publicNames:["方案确认","资料准备","注册账号办理","身份核验","注册补充事项","印章办理","VAT 登记","银行开户","地址服务","财税服务","公司变更事项","资料交付"],
    serviceSubServices: { vat:"vat", bank:"bank", address:"address" } },
  "company-change": { key:"company-change-v1", businessName:"公司注册", businessId:1, subService:"change", addressType:"",
    namesHash:"26eb9f222bd9c138819d718264008e108575e7ecf7512ec39d53a93bfc0cfb69",
    publicNames:["方案确认","收齐变更资料","递交官方办理变更","办结交付客户"] },
  // 场地认证（裁决：归地址认证线；按口述流程含租赁两步 → xiangtai 分支，员工可按客户自有场地调整）
  "address-cert": { key:"address-cert-v1", businessName:"地址认证", businessId:7, subService:"", addressType:"xiangtai",
    namesHash:"e15665d89fe0d3a957a4a2af2d8f06fc178689baea1ff3fe4ffd7134dd53d33a",
    publicNames:["方案确认","收集资料","准备系统开通申请资料","提交系统开通申请","签订租赁合同","收取首月租金","签署授权书与同意书","系统开通申请通过","准备场地确认资料","场地拍照取证","整理全部资料","提交场地确认申请","等待官方审核","补充或修改资料","重新提交","官方再次审核","支付申请费用","官方现场检查","场地确认通过"] },
  // 企业店（裁决：与 Mall 分开，独立岗位，三平台共用笼统三步模板；平台差异记在条款里）
  "mall-enterprise": { key:"mall-enterprise-v1", businessName:"Mall开店", businessId:8, subService:"enterprise", addressType:"",
    namesHash:"45d47264151204f4e585b1faad3f1dcc8aee83e43058503e0eb6b9f86e9f694b",
    publicNames:["方案确认","收齐入驻资料","提交平台审核","店铺上线交付"] },
  "trademark-buy-r": { key:"trademark-buy-r-v1", businessName:"商标", businessId:2, subService:"buy-r", addressType:"",
    namesHash:"1e1e5f8ff1bd6cd0e87ea5bba60235a89febf900249b4a554d75dca88773bdcc",
    publicNames:["方案确认","需求沟通","匹配可用商标","确认类别","收费开票","准备转让文件","提交变更申请","缴费","完成转让"] },
  // 泰国商标 6+ 小类一口价：与 1-5 小类同一注册流程
  "trademark-th-plus": { key:"thai-trademark-plus-v1", businessName:"商标", businessId:2, subService:"tm-reg", addressType:"",
    namesHash:"8470e70a37e8ba8aa89d34fdfefbf74a7dec82c4499ca306212af1d669f70b24",
    publicNames:["方案确认","商标名称核对","查重与分类核对","账单核对","申请资料准备","申请提交","缴费进度","办理资料交付"] },
  // FDA 四品类（裁决：四组差价 SKU 同归各品类岗；保健食品归食品岗）
  "fda-product": { key:"fda-product-v1", businessName:"FDA认证", businessId:3, addressType:"",
    variants:{
      cosmetics:{ subService:"cosmetics", namesHash:"f6cfee884c9f317f117eceb775712af6efdf6ac006cc20d859eb4a51d52988d7",
        publicNames:["方案确认","收集资料并检查完整性","整理资料","提交注册申请","支付备案申请费","等待官方审核","补件或修改资料","再次等待审核","未通过时重新注册","支付复审申请费","等待复审结果","支付备案证书费","取得证书交付"] },
      food:{ subService:"food", namesHash:"111f4b3ec40e7913c723a02bc1b172b7af0671fbe10b74e346509babd1a16526",
        publicNames:["方案确认","收集资料并检查完整性","整理资料","提交官方预审","等待官方预审（约30个工作日）","正式提交注册","支付备案申请费","等待官方审核","补件或修改资料","提交补充资料","再次等待审核","支付备案证书费","取得证书交付"] },
      hazard:{ subService:"hazard", namesHash:"e0b0fd3f2988fb2dd8be465c4615f311b486f98c9d5dbd41f1ca94198852b2b4",
        publicNames:["方案确认","收集资料并检查完整性","整理资料","成分信息送官方检查","提交注册申请","支付备案申请费","等待官方审核","补件或修改资料","提交补充资料","再次等待审核","继续补充处理","未通过时重新注册","等待复审结果","支付备案证书费","取得证书交付"] },
      medical:{ subService:"medical", namesHash:"07be597759584aeff41939aa760101c9c19a3497575e689a9a0cc081ee7a3539",
        publicNames:["方案确认","收集资料","送样检测","提交申请","缴费","取得证书交付"] },
    } },
  // TISI 办理（2026-09-22 裁决 B 面议下单）：办理周期约 3-4 个月，公开名提示周期
  tisi: { key:"tisi-negotiable-v1", businessName:"TISI", businessId:4, subService:"tisi-main", addressType:"",
    namesHash:"93d7c9206da9cf0accb74175f1d020157c45c58125d243567763d068b5bebc2e",
    publicNames:["方案确认","提供产品图与规格书","确认是否需要 TISI","准备全套文件","系统注册登记","准备授权委托书","补充文件","审批通过与清关准备","获取进口单据","货物送达 TISI","送样检测","等待检测结果","取得 TISI 证书（周期约 3-4 个月）"] },
} as const;

/** Select only a reviewed original workflow; nothing in a product name controls dispatch. */
export function commerceWorkflow(db: Database.Database, terms: CommerceTerms) {
  // attachment 在报价/下单入口已被拦截，不进入建单；类型上显式排除以便索引 DEFINITIONS
  if (terms.quantity_basis === "attachment") throw new CommerceTemplateError("附加费用不建独立办理单");
  const definition = DEFINITIONS[terms.quantity_basis];
  if (!definition) throw new CommerceTemplateError("该权益类型未配置审核流程：" + terms.quantity_basis);
  // 共用一族条款时按条款里的区分字段选模板：Mall 用 platform、FDA 用 category
  const variantKey = "platform" in terms && typeof terms.platform === "string" ? terms.platform
    : "category" in terms && typeof terms.category === "string" ? terms.category : undefined;
  const variant = "variants" in definition && variantKey
    ? (definition.variants as Record<string, { subService: string; namesHash: string; publicNames: readonly string[] }>)[variantKey] : undefined;
  if ("variants" in definition && !variant) throw new CommerceTemplateError("该服务缺少品类/平台模板：" + String(variantKey));
  // company-service：三服务共用全套模板，仅子服务不同（2026-09-22 裁决「先套公司的」）
  const serviceSub = "serviceSubServices" in definition && "service" in terms && typeof terms.service === "string"
    ? (definition.serviceSubServices as Record<string, string>)[terms.service] : undefined;
  // mall-store 条目的模板在 variants 内，其余家族在顶层；类型上用断言统一取值
  const subService = serviceSub ?? (variant ? variant.subService : (definition as { subService: string }).subService);
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
