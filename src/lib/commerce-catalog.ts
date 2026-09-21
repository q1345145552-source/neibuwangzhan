import type { CommerceTerms, ThaiTrademarkTerms } from "./commerce-types";

// This is a reviewed allowlist, not a name-matching classifier or an imported price list.
export const COMMERCE_SKUS = ["COM-001","COM-002","COM-003","COM-004","TRA-001","TRA-002","TRA-003","TRA-005","TRA-006"] as const;
export const COMMERCE_MAX_LINES = COMMERCE_SKUS.length;
// Immutable fallback for first-slice company requests. New business families require explicit versions.
export const LEGACY_TERMS_VERSION = "company-registration-v1";

// 2026-09-11 线上商品快照的全部 83 个 SKU（唯一编号，含 hidden 3 个：COM-020、VISA-001/002）。
// 用户 2026-09-20 拍板「未接通的一律接单」后，这里的语义是「可下单全集」：
// 进入 commerce_products 的 SKU 只能出自这份清单；已核对流程的走 COMMERCE_SKUS 显式条款，
// 其余全部走 unclassified 兜底条款（fulfillment 挂「待分类」业务线，员工确认归属后改派）。
// hidden 商品同样进清单（schema 约束层面允许），是否前台可见由 active 开关与导入目录 status 决定。
export const ORDERABLE_SKUS = [
  // 公司咨询服务 27（历史缺口 COM-023/COM-025 从未在售，不在清单内）
  "COM-001","COM-002","COM-003","COM-004","COM-005","COM-006","COM-007","COM-008","COM-009","COM-010",
  "COM-011","COM-012","COM-013","COM-014","COM-015","COM-016","COM-017","COM-018","COM-019","COM-020",
  "COM-021","COM-022","COM-024","COM-026","COM-027","COM-028","COM-029",
  // 税务合规 13
  "TAX-001","TAX-002","TAX-003","TAX-004","TAX-005","TAX-006","TAX-007","TAX-008","TAX-009","TAX-010",
  "TAX-011","TAX-012","TAX-013",
  // 认证办理 19
  "FDA-COS-PROD","FDA-FOOD-PROD","FDA-HAZ-PROD","FDA-MED-PROD","FDA-SUP-PROD",
  "OTH-001","OTH-002","OTH-003","OTH-004","OTH-005","OTH-006","OTH-007","OTH-008",
  "OTH-009","OTH-010","OTH-011","OTH-012","OTH-013","CERT-NBTC",
  // 平台入驻 6 + 店铺售卖 2
  "PLA-001","PLA-002","PLA-003","PLA-004","PLA-005","PLA-006","STO-001","STO-002",
  // 商标服务 14
  "TRA-001","TRA-002","TRA-003","TRA-005","TRA-006","TRA-007","TRA-008","TRA-009",
  "TM-PH","TM-MY","TM-VN","TM-ID","TM-SG","CLASS-LIST",
  // 工作签证 2
  "VISA-001","VISA-002",
] as const;

// 未核对流程商品的兜底条款：快照进 commerce_line_terms，与显式条款同制。
// 归属升级（老板裁决映射后）不影响已售出的快照——读快照，不回推断。
export const UNCLASSIFIED_TERMS_VERSION = "unclassified-v1";
const UNCLASSIFIED_TERMS: CommerceTerms = { version: UNCLASSIFIED_TERMS_VERSION, quantity_basis: "unclassified" };

const TRADEMARK_ITEMS: Readonly<Record<string, ThaiTrademarkTerms["minor_items_per_copy"]>> = {
  "TRA-001": 1, "TRA-002": 2, "TRA-003": 3, "TRA-005": 4, "TRA-006": 5,
};
export function productTerms(sku: string): CommerceTerms | null {
  if (["COM-001","COM-002","COM-003","COM-004"].includes(sku)) return {
    version: "company-registration-v1", quantity_basis: "company",
    company_structure: ["COM-001","COM-002"].includes(sku) ? "foreign" : "joint",
    company_registration: "included", vat_registration: ["COM-002","COM-004"].includes(sku) ? "included" : "excluded",
    other_services: "not_specified",
  };
  const items = TRADEMARK_ITEMS[sku];
  if (items) return { version: "thai-trademark-v1", quantity_basis: "trademark", registration_country: "TH",
    major_classes_per_copy: 1, minor_items_per_copy: items, other_services: "not_specified" };
  // 目录内但未核对流程：接单走兜底条款（用户 2026-09-20 拍板，规则 6：不拒单）；
  // 目录之外仍返回 null——防脏数据，不是拒客户。
  if ((ORDERABLE_SKUS as readonly string[]).includes(sku)) return UNCLASSIFIED_TERMS;
  return null;
}
