import type Database from "better-sqlite3";

/** Additive migration only. Historical scopes/files are never guessed from display names. */
export function ensureAccessSchema(db: Database.Database): void {
  // Acquire the write reservation before schema reads; deferred upgrades can deadlock across workers.
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS client_scope_settings (
        employee_id INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode = 'explicit'),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS file_uploads (
        filename TEXT PRIMARY KEY,
        uploaded_by_id INTEGER NOT NULL,
        uploaded_by_role TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER NOT NULL CHECK (size >= 0),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO client_scope_settings (employee_id, mode)
        SELECT DISTINCT employee_id, 'explicit' FROM client_account_customers;
    `);
    const documentColumns = db.prepare('PRAGMA table_info(documents)').all() as { name: string }[];
    if (!documentColumns.some(column => column.name === 'publication_verified')) {
      db.exec('ALTER TABLE documents ADD COLUMN publication_verified INTEGER NOT NULL DEFAULT 0 CHECK (publication_verified IN (0, 1))');
    }
    for (const table of ['documents', 'step_notes']) {
      const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
      if (!columns.some(column => column.name === 'client_author_id')) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN client_author_id INTEGER`);
      }
    }
  }).immediate();
}
