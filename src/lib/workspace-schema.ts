import type Database from "better-sqlite3";

export function ensureWorkspaceSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS personal_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id INTEGER NOT NULL REFERENCES employees(id),
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 80),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(owner_id, name)
    );
    CREATE TABLE IF NOT EXISTS personal_folder_records (
      folder_id INTEGER NOT NULL REFERENCES personal_folders(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL CHECK(record_type IN ('meetings','reports','todos','orders')),
      record_id TEXT NOT NULL,
      PRIMARY KEY(folder_id, record_type, record_id)
    );
    CREATE TABLE IF NOT EXISTS personal_files (
      filename TEXT PRIMARY KEY REFERENCES file_uploads(filename),
      owner_id INTEGER NOT NULL REFERENCES employees(id),
      folder_id INTEGER REFERENCES personal_folders(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_personal_folders_owner ON personal_folders(owner_id);
    CREATE INDEX IF NOT EXISTS idx_personal_files_owner ON personal_files(owner_id);
  `);
}
