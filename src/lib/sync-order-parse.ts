import { moneyToCents } from '@/lib/sync-money';
import { assertSyncPayload, textField } from '@/lib/sync-contract';

/**
 * 客户站订单快照解析：接单（/api/sync/orders）和线下单推送（lib/storefront-push）共用，
 * 两边算出来的账号/订单行身份和金额必须一模一样，客户站后面发来的账单新版本才认得出是同一张。
 */
export interface SyncLine {
  line_no: number;
  sku_code: string | null;
  quantity: number;
  amount: number;
  amountCents: number;
  raw: Record<string, unknown>;
}
export interface SyncOrder {
  source: 'storefront' | 'recurring';
  sourceOrderNo: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  revision: number;
  totalCents: number;
  discountCents: number;
  netCents: number;
  lines: SyncLine[];
  identityJson: string;
  financialJson: string;
  payload: string;
}

export function parseSyncOrder(body: unknown): SyncOrder {
  assertSyncPayload(body);
  const sourceOrderNo = body.source_order_no as string;
  const source = body.source as SyncOrder['source'];
  const revision = body.billing_revision as number;
  const customer = body.customer as Record<string, unknown>;
  const customerId = customer.id as string;
  const customerName = textField(customer.name, 'customer.name', 100, false);
  const customerEmail = textField(customer.email, 'customer.email', 254, false);
  const currency = body.currency as string;
  const totalCents = moneyToCents(body.total_amount, 'total_amount');
  const discountCents = moneyToCents(body.discount, 'discount');
  const netCents = totalCents - discountCents;
  // Deposit is payment scheduling, not an additional price discount.
  const depositCents = body.deposit === undefined ? 0 : moneyToCents(body.deposit, 'deposit');
  const billingStatus = textField(body.billing_status, 'billing_status', 32, false);
  const lines: SyncLine[] = (body.lines as Record<string, unknown>[]).map(raw => ({
    line_no: raw.line_no as number,
    sku_code: raw.sku_code === undefined || raw.sku_code === null ? null : raw.sku_code as string,
    quantity: raw.quantity as number,
    amount: raw.amount as number,
    amountCents: moneyToCents(raw.amount, 'lines.amount'),
    raw,
  })).sort((a,b) => a.line_no-b.line_no);
  const identityJson = JSON.stringify({ source, currency, customerId, lines: lines.map(line => ({
    line_no: line.line_no, sku_code: line.sku_code, quantity: line.quantity, amount_cents: line.amountCents,
  })) });
  const financialJson = JSON.stringify({ totalCents, discountCents, depositCents, billingStatus });
  return { source, sourceOrderNo, customerId, customerName, customerEmail, currency, revision,
    totalCents, discountCents, netCents, lines, identityJson, financialJson, payload: JSON.stringify(body) };
}
