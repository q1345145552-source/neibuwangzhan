/** Browser request recovery shared by checkout and every aftercare command.
 * Keep a lease for the exact persisted input: a response may settle only that
 * input, never a later request in the same account / sale / action slot.
 */
export type PendingCommerceRequest = Record<string, unknown> & { request_id: string };
export type PendingCommerceLease = { request: PendingCommerceRequest; serialized: string };
type RequestStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function decode(serialized: string): PendingCommerceLease {
  let value: unknown;
  try { value = JSON.parse(serialized); }
  catch { throw new Error('原操作记录格式有误，请先核对处理结果；记录已保留'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !('request_id' in value) || typeof value.request_id !== 'string' || !value.request_id.trim()) {
    throw new Error('原操作记录缺少有效编号，请先核对处理结果；记录已保留');
  }
  return { request: value as PendingCommerceRequest, serialized };
}

export function readPendingCommerceRequest(storage: RequestStorage, key: string): PendingCommerceLease | null {
  const serialized = storage.getItem(key);
  return serialized === null ? null : decode(serialized);
}

export function reservePendingCommerceRequest(
  storage: RequestStorage, key: string, candidate: PendingCommerceRequest,
): PendingCommerceLease {
  if (!key) throw new Error('请先登录再确认操作');
  const proposed = decode(JSON.stringify(candidate));
  const existing = readPendingCommerceRequest(storage, key);
  if (existing) {
    // A stale component is not allowed to overwrite an unresolved newer request.
    if (existing.request.request_id === candidate.request_id
      && JSON.stringify(existing.request) !== JSON.stringify(proposed.request)) {
      throw new Error('同一操作编号的内容不一致，请先核对原记录；记录已保留');
    }
    return existing;
  }
  storage.setItem(key, proposed.serialized); // If persistence fails, do not send.
  return proposed;
}

export function settlePendingCommerceRequest(
  storage: RequestStorage, key: string, sent: PendingCommerceLease,
): boolean {
  const current = storage.getItem(key);
  if (current === null) return true; // Another matching reply already settled it.
  if (current !== sent.serialized) return false; // Includes malformed/replaced data.
  storage.removeItem(key);
  return true;
}
