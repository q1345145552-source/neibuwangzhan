import { createHash } from "node:crypto";

type TranslationSource = { content: string; category_id?: number | null; category_name?: string | null };

/** 分类语境或自动派单正文变化时，同样不能复用旧译文。 */
export function todoTranslationKey(todo: TranslationSource): string {
  return createHash("sha256").update(JSON.stringify([todo.content, todo.category_id ?? null, todo.category_name || ""])).digest("hex");
}

export function withValidTodoTranslation<T extends TranslationSource & { content_zh?: string | null; content_zh_key?: string | null }>(todo: T): T {
  return todo.content_zh_key === todoTranslationKey(todo) ? todo : { ...todo, content_zh: "", content_zh_key: "" };
}

// 跟进译文随该条记录的修改版本失效，不因父待办状态、分类等变化重复翻译。
export function followUpTranslationKey(content: string, revision = 0): string {
  return createHash("sha256").update(revision ? JSON.stringify([content, revision]) : content).digest("hex");
}

export function withValidFollowUpTranslation<T extends { content: string; revision?: number; content_zh?: string | null; content_zh_key?: string | null }>(followUp: T): T {
  return followUp.content_zh_key === followUpTranslationKey(followUp.content, followUp.revision) ? followUp : { ...followUp, content_zh: "", content_zh_key: "" };
}
