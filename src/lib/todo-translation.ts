import { createHash } from "node:crypto";

type TranslationSource = { content: string; category_id?: number | null; category_name?: string | null };

/** 分类语境或自动派单正文变化时，同样不能复用旧译文。 */
export function todoTranslationKey(todo: TranslationSource): string {
  return createHash("sha256").update(JSON.stringify([todo.content, todo.category_id ?? null, todo.category_name || ""])).digest("hex");
}

export function withValidTodoTranslation<T extends TranslationSource & { content_zh?: string | null; content_zh_key?: string | null }>(todo: T): T {
  return todo.content_zh_key === todoTranslationKey(todo) ? todo : { ...todo, content_zh: "", content_zh_key: "" };
}
