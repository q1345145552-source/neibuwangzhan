/** All persisted allocation math is integer cents; BigInt prevents ratio overflow. */
export const MAX_MONEY_CENTS = 1_000_000_000_000;

export function moneyToCents(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} 必须是非负有限金额`);
  }
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > MAX_MONEY_CENTS || Math.abs(value * 100 - cents) > 0.00001) {
    throw new Error(`${field} 超过金额上限或包含不足一分的小数`);
  }
  return cents;
}

/** Largest remainder allocation; ties follow stable line order. Every cent is assigned once. */
export function allocateCents(total: number, weights: number[]): number[] {
  if (!Number.isSafeInteger(total) || total < 0 || weights.length === 0 || weights.some(w => !Number.isSafeInteger(w) || w < 0)) {
    throw new Error('分摊参数非法');
  }
  const sum = weights.reduce((s,w) => s + BigInt(w), BigInt(0));
  if (sum === BigInt(0)) {
    if (total !== 0) throw new Error('正净额订单需要非零原始行权重');
    return weights.map(() => 0);
  }
  const shares = weights.map((weight, index) => {
    const product = BigInt(total) * BigInt(weight);
    return { index, cents: Number(product / sum), remainder: product % sum };
  });
  let left = total - shares.reduce((s,x) => s + x.cents, 0);
  const ranked = [...shares].sort((a,b) => a.remainder === b.remainder ? a.index-b.index : a.remainder > b.remainder ? -1 : 1);
  for(const share of ranked) {
    if (left === 0) break;
    share.cents += 1; left -= 1;
  }
  return shares.map(x => x.cents);
}

export function splitCents(total: number, copies: number): number[] {
  if (!Number.isSafeInteger(copies) || copies < 1) throw new Error('份数非法');
  return allocateCents(total, Array.from({length:copies}, () => 1));
}
