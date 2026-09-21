// Shared DB identity / no-create preflight. Keep both repositories byte-identical.
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const IDENTITIES = {
  client: { users: ['id','email','password','role'], products: ['id','sku_code','price'], orders: ['id','order_no','user_id','price'], invoices: ['id','order_id','amount'] },
  internal: { employees: ['id','name','role','password'], business_types: ['id','name'], orders: ['id','customer_name','business_type_id'], order_steps: ['id','order_id','step_name'] },
};
function validate(database, kind) {
  const identity = IDENTITIES[kind];
  if (!identity) throw new Error('Unknown database identity');
  const result = database.pragma('quick_check', { simple: true });
  if (result !== 'ok') throw new Error(`DB_INVALID: integrity check failed (${kind})`);
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  if (tables.length === 0) return false;
  for (const [table, required] of Object.entries(identity)) {
    const columns = new Set(database.prepare(`PRAGMA table_info("${table}")`).all().map(row => row.name));
    if (required.some(column => !columns.has(column))) throw new Error(`DB_IDENTITY_MISMATCH: ${kind}.${table}`);
  }
  return true;
}
function preflight(filename, kind, allowEmpty = false) {
  if (!path.isAbsolute(filename)) throw new Error('DB_PATH must resolve to an absolute path');
  if (!fs.existsSync(filename)) {
    if (allowEmpty) return { existing: false, initialize: true };
    throw new Error(`DB_SOURCE_MISSING: ${filename}; verify the mount/path or explicitly initialize with ALLOW_EMPTY_DB=1`);
  }
  const stat = fs.statSync(filename);
  if (!stat.isFile()) throw new Error(`DB_INVALID: not a regular file: ${filename}`);
  if (stat.size === 0) {
    if (allowEmpty) return { existing: true, initialize: true };
    throw new Error(`DB_EMPTY: ${filename}; restore the real database or explicitly initialize with ALLOW_EMPTY_DB=1`);
  }
  let probe;
  try {
    probe = new Database(filename, { readonly: true, fileMustExist: true });
    const identified = validate(probe, kind);
    if (!identified && !allowEmpty) throw new Error(`DB_EMPTY: ${filename}`);
    return { existing: true, initialize: !identified };
  } finally { if (probe) probe.close(); }
}
function openChecked(filename, kind, allowEmpty = false) {
  const state = preflight(filename, kind, allowEmpty);
  // fileMustExist also closes the missing-file race between preflight and open.
  const database = new Database(filename, { fileMustExist: !state.initialize });
  try {
    const identified = validate(database, kind);
    if (!identified && !state.initialize) throw new Error(`DB_EMPTY: ${filename}`);
    return database;
  } catch (error) { database.close(); throw error; }
}
function backup(filename, destination, kind) {
  // No mkdir, source creation, migration or seed before verification.
  preflight(filename, kind, false);
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    if (!validate(database, kind)) throw new Error(`DB_EMPTY: ${filename}`);
    const counts = Object.fromEntries(Object.keys(IDENTITIES[kind]).map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get().count]));
    return database.backup(destination).then(() => {
      preflight(destination, kind, false);
      return { source: filename, destination, identity: kind, sourceCountsBeforeSnapshot: counts };
    }).finally(() => database.close());
  } catch (error) { database.close(); throw error; }
}
module.exports = { preflight, openChecked, validate, backup };
