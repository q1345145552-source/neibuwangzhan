/**
 * 客户站 SKU → 内部业务线映射（第一阶段配置）。
 * 依据：客户站 docs/双站SKU映射草案-2026-09-11.md（对应方向 35 项，均为内部已存在的业务线/子服务）。
 * 规则（业务规则 6）：匹配不到的一律进「待分类」，绝不套用相似的流程；
 * 附加费/参考资料行不建办理单，只在 sync_inbox 留痕。
 *
 * 业务线用名称（运行时查 business_types 解析 ID），不用自增 ID——不同环境的库 ID 可能漂移。
 */

export type MappingResult =
  | { kind: "mapped"; businessTypeName: string; subServiceType: string }
  | { kind: "unclassified"; note?: string }
  | { kind: "attachment" }
  | { kind: "reference" };

const MAPPED: Record<string, { businessType: string; sub?: string }> = {
  // 公司注册 4 SKU + 开公户 + VAT 注册（公司咨询服务）
  "COM-001": { businessType: "公司注册", sub: "company-reg" },
  "COM-002": { businessType: "公司注册", sub: "company-reg" },
  "COM-003": { businessType: "公司注册", sub: "company-reg" },
  "COM-004": { businessType: "公司注册", sub: "company-reg" },
  "COM-026": { businessType: "公司注册", sub: "bank" },
  "COM-027": { businessType: "公司注册", sub: "vat" },
  "TAX-001": { businessType: "公司注册", sub: "vat" },
  // 社保开户
  "TAX-003": { businessType: "社保开户", sub: "social-security" },
  // Mall 入驻三平台
  "PLA-001": { businessType: "Mall开店", sub: "shopee" },
  "PLA-002": { businessType: "Mall开店", sub: "lazada" },
  "PLA-003": { businessType: "Mall开店", sub: "tiktok" },
  // 泰国商标 1 大类 N 小类（档位价，不拆单）
  "TRA-001": { businessType: "商标" },
  "TRA-002": { businessType: "商标" },
  "TRA-003": { businessType: "商标" },
  "TRA-005": { businessType: "商标" },
  "TRA-006": { businessType: "商标" },
  "TRA-007": { businessType: "商标" },
  // 国际商标
  "TM-PH": { businessType: "商标", sub: "international" },
  "TM-MY": { businessType: "商标", sub: "international" },
  "TM-VN": { businessType: "商标", sub: "international" },
  "TM-ID": { businessType: "商标", sub: "international" },
  "TM-SG": { businessType: "商标", sub: "international" },
  // 认证办理
  "OTH-001": { businessType: "TISI", sub: "tisi-main" },
  "OTH-002": { businessType: "DLD", sub: "product" },
  "CERT-NBTC": { businessType: "NBTC" },
  "FDA-COS-PROD": { businessType: "FDA认证", sub: "cosmetics" },
  "FDA-FOOD-PROD": { businessType: "FDA认证", sub: "food" },
  "FDA-HAZ-PROD": { businessType: "FDA认证", sub: "hazard" },
  "FDA-MED-PROD": { businessType: "FDA认证", sub: "medical" },
  "OTH-009": { businessType: "FDA认证", sub: "cosmetics" },
  "OTH-010": { businessType: "FDA认证", sub: "food" },
  "OTH-011": { businessType: "FDA认证", sub: "hazard" },
  "OTH-012": { businessType: "FDA认证", sub: "medical" },
  // 工作签证（hidden 商品，理论上不会有订单，映射保留）
  "VISA-001": { businessType: "工作签证" },
};

// 有内部对应体系但不能由本路由直接建单的 SKU：落待分类并带提示，由员工人工转入。
const MANUAL_HINTS: Record<string, string> = {
  "TAX-012": "内部对应 WHT 月度申报体系（ภ.ง.ด.1/ภ.ง.ด.53），需核对后人工转入 wht_records。",
  "TAX-013": "PND.51 未在 WHT subtype（CHECK 仅 ภ.ง.ด.1/53）内，需人工处理。",
};

// 附加费（随主服务收取，不独立办理）与参考资料（不建单）
const ATTACHMENT_SKUS = new Set(["OTH-007", "OTH-008", "VISA-002"]);
const REFERENCE_SKUS = new Set(["CLASS-LIST"]);

export function mapSku(skuCode: string | null | undefined): MappingResult {
  if (!skuCode) return { kind: "unclassified", note: "同步行缺少 SKU（老 CART 单未结构化），需人工核对拆分。" };
  if (REFERENCE_SKUS.has(skuCode)) return { kind: "reference" };
  if (ATTACHMENT_SKUS.has(skuCode)) return { kind: "attachment" };
  const hit = MAPPED[skuCode];
  if (hit) return { kind: "mapped", businessTypeName: hit.businessType, subServiceType: hit.sub || "" };
  const hint = MANUAL_HINTS[skuCode];
  return { kind: "unclassified", note: hint };
}
