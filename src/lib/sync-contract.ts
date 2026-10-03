/**
 * Canonical order-sync input contract (pure TypeScript; no I/O or mutation).
 * Edit the client copy, then explicitly sync/check the internal copy with
 * scripts/check-sync-contract.mjs. A release must include both copies and all
 * importing modules; compare full bytes, not just the version number.
 *
 * Transport preserves historical CNY/THB. New catalog sales are CNY only.
 * This contract validates snapshots; it never repairs or reprices saved orders.
 */
export const SYNC_CONTRACT_VERSION = 1;

export class SyncContractError extends Error {
  readonly code = 'SYNC_CONTRACT_INVALID';
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = 'SyncContractError';
    this.field = field;
  }
}

export function textField(value: unknown, field: string, max: number, required = true): string {
  if (!required && (value === undefined || value === null)) return '';
  if (typeof value !== 'string' || value.length > max || (required && (!value.trim() || value !== value.trim())) || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new SyncContractError(`${field} 格式错误或超长`, field);
  }
  return value;
}

/** The caller supplies the effective stored currency, after applying any default. */
export function assertCatalogContract(value: { skuCode: unknown; currency: unknown }): void {
  textField(value.skuCode, 'skuCode', 100);
  const currency = textField(value.currency, 'currency', 3);
  if (currency !== 'CNY') throw new SyncContractError('新销售商品币种必须是 CNY', 'currency');
}

// Match sync-money.ts moneyToCents exactly, including its floating-point tolerance.
// Only validation lives here; the receiver keeps its existing allocation algorithm.
function amountCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new SyncContractError(`${field} 必须是非负有限金额`, field);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > 1_000_000_000_000 || Math.abs(value * 100 - cents) > 0.00001) {
    throw new SyncContractError(`${field} 超过金额上限或包含不足一分的小数`, field);
  }
  return cents;
}

/** Validate the existing receiver contract without normalising or mutating input. */
export function assertSyncPayload(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SyncContractError('请求格式错误', 'payload');
  }
  const body = value as Record<string, unknown>;
  textField(body.source_order_no, 'source_order_no', 64);
  if (body.source !== 'storefront' && body.source !== 'recurring') throw new SyncContractError('source 非法', 'source');
  if (!Number.isSafeInteger(body.billing_revision) || (body.billing_revision as number) < 1) {
    throw new SyncContractError('billing_revision 必须是正整数', 'billing_revision');
  }
  if (!body.customer || typeof body.customer !== 'object' || Array.isArray(body.customer)) {
    throw new SyncContractError('缺少客户账号信息', 'customer');
  }
  const customer = body.customer as Record<string, unknown>;
  textField(customer.id, 'customer.id', 64);
  textField(customer.name, 'customer.name', 100, false);
  textField(customer.email, 'customer.email', 254, false);
  const currency = textField(body.currency, 'currency', 3);
  if (!['CNY', 'THB'].includes(currency)) throw new SyncContractError('currency 非法', 'currency');
  const totalCents = amountCents(body.total_amount, 'total_amount');
  const discountCents = amountCents(body.discount, 'discount');
  if (discountCents > totalCents) throw new SyncContractError('discount 超过订单毛额', 'discount');
  if (body.deposit !== undefined) amountCents(body.deposit, 'deposit');
  textField(body.billing_status, 'billing_status', 32, false);
  if (!Array.isArray(body.lines) || !body.lines.length || body.lines.length > 500) {
    throw new SyncContractError('订单行数量非法', 'lines');
  }
  const lineNumbers = new Set<number>();
  let copies = 0;
  let hasPositiveWeight = false;
  for (const value of body.lines) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyncContractError('订单行格式非法', 'lines');
    const raw = value as Record<string, unknown>;
    const lineNo = raw.line_no;
    if (!Number.isSafeInteger(lineNo) || (lineNo as number) < 1 || lineNumbers.has(lineNo as number)) {
      throw new SyncContractError('line_no 非法或重复', 'line_no');
    }
    lineNumbers.add(lineNo as number);
    if (!Number.isSafeInteger(raw.quantity) || (raw.quantity as number) < 1 || (raw.quantity as number) > 999) {
      throw new SyncContractError('quantity 必须是 1..999 的整数', 'quantity');
    }
    copies += raw.quantity as number;
    if (copies > 5000) throw new SyncContractError('订单总份数超过 5000', 'lines');
    if (raw.sku_code !== undefined && raw.sku_code !== null) textField(raw.sku_code, 'sku_code', 100);
    const cents = amountCents(raw.amount, 'lines.amount');
    if (cents > 0) hasPositiveWeight = true;
  }
  // Same zero-weight rejection as allocateCents; do not require line totals to
  // equal the parent total, or deposit to be below net: neither was a contract rule.
  if (!hasPositiveWeight && totalCents !== discountCents) {
    throw new SyncContractError('正净额订单需要非零原始行权重', 'lines.amount');
  }
}
