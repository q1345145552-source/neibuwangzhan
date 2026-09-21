import type Database from "better-sqlite3";
import type { TokenPayload } from "./auth";

export class CommerceError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function fail(status: number, code: string, message: string): never { throw new CommerceError(status, code, message); }
export function recordBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail(400, "INVALID_INPUT", "请提交有效对象");
  return value as Record<string, unknown>;
}
export function only(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) fail(400, "INVALID_FIELD", "请求包含不支持的字段");
}
export function boundedText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) return fail(400, "INVALID_INPUT", label + "格式有误");
  return value.trim();
}
export function audit(db: Database.Database, actor: TokenPayload, action: string, id: string, detail: string) {
  // Unlike best-effort logOperation, commerce audit must commit with its financial write.
  db.prepare("INSERT INTO audit_logs(actor,action,target_type,target_id,detail) VALUES (?,?,'commerce',?,?)")
    .run(actor.name, action, id, JSON.stringify({ actor_id: actor.id, detail }));
}
