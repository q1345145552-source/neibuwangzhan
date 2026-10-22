export interface ShopFeeRecord {
  id: number; fee_type: string; business_type: string; amount: number; currency: string;
  note: string; screenshot: string; status: string; reviewed_by: string; reviewed_at: string;
  review_note: string; created_by: string; created_at: string;
}

export const SHOP_BUSINESS_TYPES = ["卖店铺", "外购店铺", "SIM卡", "邮箱", "扫描验证", "注册"];
export const SHOP_CURRENCIES = ["CNY", "THB"];
type Actor = { role: string; name: string } | null;
type FeeScope = Pick<ShopFeeRecord, "fee_type" | "status" | "created_by">;

export function ownsShopFee(actor: Actor, fee: FeeScope): boolean {
  return !!actor && (actor.role === "admin" || (actor.role === "employee" && !!actor.name && actor.name === fee.created_by));
}
export function canEditShopFee(actor: Actor, fee: FeeScope): boolean {
  return ownsShopFee(actor, fee) && !(fee.fee_type === "收入" && ["已到账", "未到账"].includes(fee.status));
}
export function canDeleteShopFee(actor: Actor, fee: FeeScope): boolean {
  return ownsShopFee(actor, fee) && ((fee.fee_type === "收入" && fee.status === "待核对") || (fee.fee_type === "支出" && fee.status === "待处理"));
}
