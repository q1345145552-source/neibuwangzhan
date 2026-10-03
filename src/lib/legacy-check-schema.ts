import type Database from "better-sqlite3";

/** Extend known legacy enums once; do not rename live tables on every worker boot. */
export function expandLegacyCheck(db: Database.Database, table: "notifications" | "leave_requests", column: "type" | "leave_type", values: readonly string[]) {
  db.transaction(() => {
    const original = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string } | undefined)?.sql;
    if (!original) throw new Error(`Missing legacy table: ${table}`);
    const pattern = new RegExp(`CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)\\s*\\)`, "i");
    const match = original.match(pattern);
    if (!match) throw new Error(`Review unexpected ${table}.${column} constraint before upgrading`);
    const missing = values.filter(value => !match[1].split(",").map(part => part.trim()).includes(`'${value}'`));
    if (!missing.length) return;

    // These tables have no incoming references in the original model. An extension
    // with new dependencies needs its own reviewed migration, never a guessed DROP.
    for (const entry of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]) {
      const escaped = entry.name.replaceAll('"', '""');
      const refs = db.prepare(`PRAGMA foreign_key_list("${escaped}")`).all() as { table: string }[];
      if (refs.some(ref => ref.table === table)) throw new Error(`Review incoming references to ${table} before upgrading`);
    }
    const temp = `${table}_check_upgrade`;
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(temp)) throw new Error(`Occupied legacy upgrade table: ${temp}`);
    const objects = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table) as { sql: string }[];
    const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(c => `"${c.name.replaceAll('"', '""')}"`).join(", ");
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(table) as { seq: number } | undefined;
    const extended = original.replace(pattern, `CHECK(${column} IN (${match[1]},${missing.map(value => `'${value.replaceAll("'", "''")}'`).join(",")}))`);
    const create = extended.replace(new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?["\\x60]?${table}["\\x60]?`, "i"), `CREATE TABLE ${temp}`);
    if (create === extended) throw new Error(`Review unexpected CREATE for ${table}`);
    db.exec(create);
    db.exec(`INSERT INTO ${temp} (${columns}) SELECT ${columns} FROM ${table}`);
    db.exec(`DROP TABLE ${table}; ALTER TABLE ${temp} RENAME TO ${table}`);
    if (sequence) {
      db.prepare("DELETE FROM sqlite_sequence WHERE name=?").run(table);
      db.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)").run(table, sequence.seq);
    }
    for (const object of objects) db.exec(object.sql);
  }).immediate();
}
