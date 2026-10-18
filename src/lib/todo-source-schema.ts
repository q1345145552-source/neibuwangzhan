import type Database from "better-sqlite3";

/** 仅补列和索引，存量手工待办的来源保持为空。 */
export function ensureTodoSourceSchema(db: Database.Database) {
  db.transaction(() => {
    const columns = db.prepare("PRAGMA table_info(todos)").all() as { name: string }[];
    for (const column of ["source_type", "source_id"]) {
      if (!columns.some(existing => existing.name === column)) db.exec(`ALTER TABLE todos ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`);
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_todos_source ON todos(source_type,source_id,assignee);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_work_report_source ON todos(source_id,assignee)
      WHERE source_type='work_report' AND source_id<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_meeting_source ON todos(source_id,assignee)
      WHERE source_type='meeting' AND source_id<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_notice_source ON todos(source_id)
      WHERE source_type='notice' AND source_id<>'';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_todos_problem_source ON todos(source_id)
      WHERE source_type='problem' AND source_id<>''`);
  })();
}
