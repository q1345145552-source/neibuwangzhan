import type Database from "better-sqlite3";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const labels: Record<string, string> = { documents: "文档", employee_files: "员工档案", messages: "聊天消息", todos: "待办", todo_images: "待办图片", todo_follow_ups: "待办跟进", problems: "问题", problem_attachments: "问题附件", orders: "订单", certificates: "证书", assets: "资产", meeting_reflections: "会议心得", work_reports: "日报", leave_requests: "请假申请" };
// 元数据、日志和翻译缓存不代表正在使用的附件。业务表的文本/JSON 均检查，
// 避免只查文档而漏掉聊天、跟进、图片数组或后续新增模块。
const metadata = new Set(["file_uploads", "personal_files", "personal_file_note_history", "audit_logs", "notifications", "system_settings"]);
export function personalFileReferences(db: Database.Database, filename: string): string[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as {name: string}[];
  const references: string[] = [];
  for (const {name} of tables) {
    if (metadata.has(name) || /(?:_logs|_translations)$/.test(name)) continue;
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all() as {name:string; type:string}[];
    const text = columns.filter(c => /TEXT|CHAR|CLOB/i.test(c.type));
    if (!text.length) continue;
    const rows = db.prepare(`SELECT * FROM ${quote(name)} WHERE ${text.map(c => `instr(${quote(c.name)}, ?) > 0`).join(" OR ")}`).all(...text.map(() => filename)) as Record<string, unknown>[];
    for (const row of rows) {
      const uses = (value: unknown): boolean => {
        if (typeof value !== "string") return false;
        if (value === filename) return true;
        try { const parsed: unknown = JSON.parse(value); if (parsed !== value) return nested(parsed); } catch { /* 普通文本/URL */ }
        let decoded = value;
        try { decoded = decodeURIComponent(value); } catch { /* 保留原文 */ }
        const escaped = filename.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`/api/files/${escaped}(?=$|[?&#\\s\"'<>\\)\\]\\}，。])`).test(decoded);
      };
      const nested = (value: unknown): boolean => typeof value === "string" ? uses(value) : Array.isArray(value) ? value.some(nested) : !!value && typeof value === "object" && Object.values(value).some(nested);
      if (!text.some(c => uses(row[c.name]))) continue;
      if (name === "documents") references.push(`文档「${row.name || row.id}」`);
      else if (name === "employee_files") {
        const employee = db.prepare("SELECT name FROM employees WHERE id = ?").get(row.employee_id) as {name:string}|undefined;
        references.push(`员工「${employee?.name || row.employee_id}」的档案「${row.original_name || row.category || row.id}」`);
      } else references.push(`${labels[name] || name} #${row.id ?? row.filename ?? "记录"}`);
    }
  }
  return [...new Set(references)];
}

export function deletePersonalFile(db: Database.Database, userId: number, filename: string, directories: string[]) {
  if (!filename || filename !== path.basename(filename) || /[\\/\x00]/.test(filename) || filename === "." || filename === "..") return {status:400, error:"文件名无效"};
  const backups: {file: string; buffer: Buffer}[] = [];
  try {
    return db.transaction(() => {
      const own = db.prepare(`SELECT 1 FROM personal_files p JOIN file_uploads u ON u.filename=p.filename WHERE p.filename=? AND p.owner_id=? AND u.uploaded_by_id=? AND u.uploaded_by_role IN ('admin','employee')`).get(filename,userId,userId);
      if (!own) return {status:403, error:"文件不存在或不是你上传的文件"};
      const references = personalFileReferences(db,filename);
      if (references.length) return {status:409, error:"文件正在被以下位置引用，请先取消引用后再删除：", references};
      const files = [...new Set(directories.map(dir=>path.join(dir,filename)))].filter(file=>existsSync(file));
      // 先读齐备份，再开始删除；磁盘或事务失败时恢复，避免列表消失但文件未删。
      for (const file of files) backups.push({file,buffer:readFileSync(file)});
      db.prepare("DELETE FROM personal_files WHERE filename=? AND owner_id=?").run(filename,userId);
      db.prepare("DELETE FROM file_uploads WHERE filename=? AND uploaded_by_id=?").run(filename,userId);
      for (const {file} of backups) unlinkSync(file);
      return {status:200, success:true};
    }).immediate();
  } catch (error) {
    for (const {file,buffer} of backups) if (!existsSync(file)) writeFileSync(file,buffer,{flag:"wx"});
    throw error;
  }
}
