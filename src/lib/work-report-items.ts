// 日报「今日已完成」条目：既支持纯文本（手动填的），也支持结构化对象（自动带出勾选的）。
// 结构化对象格式：{ text, type, refId, href }
export interface StructuredItem {
  text: string;
  type?: string;
  refId?: string;
  href?: string;
}

export type CompletedItem = string | StructuredItem;

/** 解析请求体里的 completed_items，兼容字符串数组 / 对象数组 / 混合数组 / JSON 字符串 */
export function normalizeCompletedItems(raw: unknown): CompletedItem[] {
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (typeof raw === "string") {
    try { const p = JSON.parse(raw); if (Array.isArray(p)) arr = p; } catch {}
  }
  const out: CompletedItem[] = [];
  for (const x of arr) {
    if (typeof x === "string") {
      const t = x.trim();
      if (t) out.push(t);
    } else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      const text = String(o.text || "").trim();
      if (!text) continue;
      const item: StructuredItem = { text };
      if (typeof o.type === "string" && o.type) item.type = o.type;
      if (typeof o.refId === "string" && o.refId) item.refId = o.refId;
      if (typeof o.href === "string" && o.href) item.href = o.href;
      out.push(item);
    }
  }
  return out;
}

/** 取条目的纯文本（用于摘要/时间线拼接） */
export function completedItemText(item: CompletedItem): string {
  return typeof item === "string" ? item : item.text;
}
