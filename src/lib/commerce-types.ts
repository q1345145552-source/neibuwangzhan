export interface CompanyRegistrationTerms {
  version: string;
  quantity_basis: "company";
  company_structure: "foreign" | "joint";
  company_registration: "included";
  vat_registration: "included" | "excluded";
  other_services: "not_specified";
}
export interface ThaiTrademarkTerms {
  version: "thai-trademark-v1";
  quantity_basis: "trademark";
  registration_country: "TH";
  major_classes_per_copy: 1;
  minor_items_per_copy: 1 | 2 | 3 | 4 | 5;
  other_services: "not_specified";
}
// 未核对流程商品的兜底条款：下单照常成立，fulfillment 挂「待分类」业务线。
// 归属经员工/老板确认后改派，已售订单的快照不受影响。
export interface UnclassifiedTerms {
  version: "unclassified-v1";
  quantity_basis: "unclassified";
}
// 附加费用（场地设备配置费、泰籍法人代表费等）：随对应主服务一并收取，
// 不构成独立服务，不可单独购买（2026-09-20 全量清单第五组方案）。
export interface AttachmentTerms {
  version: "attachment-v1";
  quantity_basis: "attachment";
}
// 以下五族为 2026-09-20 放行的已核对家族（内部均有专属步骤模板，hash 锁定）。
export interface SocialSecurityTerms {
  version: "social-security-v1";
  quantity_basis: "social-security";
}
export interface MallStoreTerms {
  version: "mall-store-v1";
  quantity_basis: "mall-store";
  platform: "shopee" | "lazada" | "tiktok";
}
export interface InternationalTrademarkTerms {
  version: "international-trademark-v1";
  quantity_basis: "trademark-international";
  registration_country: string;
}
export interface DldProductTerms {
  version: "dld-product-v1";
  quantity_basis: "dld-product";
}
export interface NbtcTerms {
  version: "nbtc-v1";
  quantity_basis: "nbtc";
}
// ── 2026-09-22 逐项裁决放行的七族 ──
// 线1附属服务（VAT注册/银行开户/地址服务）：裁决「先套公司全套流程」，专属精简模板后续再换
export interface CompanyServiceTerms {
  version: "company-service-v1";
  quantity_basis: "company-service";
  service: "vat" | "bank" | "address";
}
export interface CompanyChangeTerms {
  version: "company-change-v1";
  quantity_basis: "company-change";
}
export interface AddressCertTerms {
  version: "address-cert-v1";
  quantity_basis: "address-cert";
}
export interface MallEnterpriseTerms {
  version: "mall-enterprise-v1";
  quantity_basis: "mall-enterprise";
  platform: "shopee" | "lazada" | "tiktok";
}
export interface TrademarkBuyRTerms {
  version: "trademark-buy-r-v1";
  quantity_basis: "trademark-buy-r";
}
// 泰国商标 6 小类以上：一口价（2026-09-22 计费表裁决，18,000 泰铢≈¥3,870 不随小类数涨）
export interface ThaiTrademarkPlusTerms {
  version: "thai-trademark-plus-v1";
  quantity_basis: "trademark-th-plus";
}
export interface FdaProductTerms {
  version: "fda-product-v1";
  quantity_basis: "fda-product";
  category: "cosmetics" | "food" | "hazard" | "medical";
}
export type CommerceTerms = CompanyRegistrationTerms | ThaiTrademarkTerms | UnclassifiedTerms | AttachmentTerms | SocialSecurityTerms | MallStoreTerms | InternationalTrademarkTerms | DldProductTerms | NbtcTerms | CompanyServiceTerms | CompanyChangeTerms | AddressCertTerms | MallEnterpriseTerms | TrademarkBuyRTerms | ThaiTrademarkPlusTerms | FdaProductTerms;
export interface CommerceCart { revision: number; lines: CommerceSelection[] }
export interface CommerceOrderPurchase {
  sale_id: string; sku: string; copy_no: number; terms: CommerceTerms | null;
}
export interface CommerceProduct {
  id: string; sku: string; name: string; price_cents: number; currency: "CNY";
  revision: number; active: number; terms: CommerceTerms;
}
export interface CommerceSelection { product_id: string; quantity: number; revision: number; terms_version?: string }
export interface CommerceQuote {
  lines: (CommerceSelection & { sku: string; name: string; unit_cents: number; total_cents: number; terms: CommerceTerms })[];
  total_cents: number; currency: "CNY";
}
export interface CommerceInvoice {
  id: string; total_cents: number; currency: "CNY"; status: "unpaid" | "paid"; paid_at: string | null;
}
export interface CommerceDocument {
  id: number; name: string; status: string; direction: string; file_url: string;
}
export interface CommerceSale {
  id: string; buyer_account_id: number; buyer_name: string; total_cents: number; currency: "CNY"; created_at: string;
  invoice: CommerceInvoice;
  billing: CommerceBilling;
  cancellations: CommerceCancellation[];
  lines: {
    id: string; sku: string; name: string; unit_cents: number; quantity: number; total_cents: number; terms: CommerceTerms | null;
    fulfillments: {
      order_id: string; copy_no: number; allocated_cents: number; status: string;
      steps: { id: number; step_order: number; name: string; status: string }[];
      documents: CommerceDocument[];
    }[];
  }[];
}

export interface CommerceAllocationBalance {
  order_id: string; original_cents: number; credited_cents: number; adjusted_cents: number;
  received_cents: number; refunded_cents: number; refund_due_cents: number;
}
export interface CommerceBilling {
  revision: number; original_cents: number; credited_cents: number; adjusted_cents: number;
  received_cents: number; refunded_cents: number; balance_due_cents: number; refund_due_cents: number;
  settlement: "unpaid" | "paid" | "voided" | "refund_due" | "refunded";
  allocations: CommerceAllocationBalance[];
  adjustments: { id:string; reason:string; created_at:string; items:{order_id:string;credit_cents:number}[] }[];
  refunds: { id:string; reason:string; reference:string; created_at:string; items:{order_id:string;amount_cents:number}[] }[];
}
export interface CommerceCancellation {
  id:string; reason:string; order_ids:string[]; status:"pending"|"approved"|"rejected"|"withdrawn";
  public_note:string; created_at:string; decided_at:string|null;
}
export interface CommerceSalePage { items:CommerceSale[]; next_cursor:string|null }
