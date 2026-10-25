import { createHash } from "node:crypto";

type TranslationSource = { content: string; category_id?: number | null; category_name?: string | null };

/** 分类语境或自动派单正文变化时，同样不能复用旧译文。 */
export function todoTranslationKey(todo: TranslationSource): string {
  return createHash("sha256").update(JSON.stringify([todo.content, todo.category_id ?? null, todo.category_name || ""])).digest("hex");
}

export function withValidTodoTranslation<T extends TranslationSource & { content_zh?: string | null; content_zh_key?: string | null }>(todo: T): T {
  return todo.content_zh_key === todoTranslationKey(todo) ? todo : { ...todo, content_zh: "", content_zh_key: "" };
}

// 跟进译文仅随该条跟进正文失效，不因待办状态、分类等变化重复翻译。
export function followUpTranslationKey(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function withValidFollowUpTranslation<T extends { content: string; content_zh?: string | null; content_zh_key?: string | null }>(followUp: T): T {
  return followUp.content_zh_key === followUpTranslationKey(followUp.content) ? followUp : { ...followUp, content_zh: "", content_zh_key: "" };
}
