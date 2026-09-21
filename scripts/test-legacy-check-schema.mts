import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type Database from "better-sqlite3";
const root=process.env.INTERNAL_SOURCE_ROOT||process.cwd();
const SQLite=createRequire(path.join(root,"package.json"))("better-sqlite3") as typeof Database;
const {expandLegacyCheck}=await import(pathToFileURL(path.join(root,"src/lib/legacy-check-schema.ts")).href) as typeof import("../src/lib/legacy-check-schema");
const rows:unknown[]=[];
for(const [table,column,old,extra] of [["notifications","type","mention",["leave_overdue"]],["leave_requests","leave_type","事假",["调休","法定假日"]]] as const){
 const db=new SQLite(":memory:");db.pragma("foreign_keys=ON");
 db.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY AUTOINCREMENT,${column} TEXT CHECK(${column} IN ('${old}')),local_extra TEXT);CREATE TABLE log(value TEXT);CREATE INDEX ${table}_extra ON ${table}(local_extra);CREATE TRIGGER ${table}_log AFTER UPDATE ON ${table} BEGIN INSERT INTO log VALUES(NEW.local_extra);END;`);
 db.prepare(`INSERT INTO ${table}(id,${column},local_extra) VALUES(50,?,'KEEP')`).run(old);db.prepare(`INSERT INTO ${table}(id,${column}) VALUES(99,?)`).run(old);db.exec(`DELETE FROM ${table} WHERE id=99`);
 const before=db.serialize(),original=db.exec;let failed=false;
 db.exec=function(sql:string){if(sql.startsWith("DROP TABLE")){failed=true;throw new Error("INJECTED_LEGACY_UPGRADE_FAULT");}return original.call(this,sql);};
 assert.throws(()=>expandLegacyCheck(db,table,column,extra),/INJECTED_LEGACY/);db.exec=original;assert(failed);assert.deepEqual(db.serialize(),before);
 expandLegacyCheck(db,table,column,extra);assert.deepEqual(db.prepare(`SELECT * FROM ${table}`).all(),[{id:50,[column]:old,local_extra:"KEEP"}]);
 for(const value of extra)db.prepare(`INSERT INTO ${table}(${column},local_extra) VALUES(?,'NEW')`).run(value);
 assert.equal((db.prepare(`SELECT id FROM ${table} WHERE id>50 ORDER BY id`).get() as {id:number}).id,100);
 db.exec(`UPDATE ${table} SET local_extra='AFTER' WHERE id=50`);assert.equal((db.prepare("SELECT value FROM log").get() as {value:string}).value,"AFTER");
 assert(db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(table+"_extra"));assert.deepEqual(db.pragma("foreign_key_check"),[]);
 const upgraded=db.serialize();expandLegacyCheck(db,table,column,extra);expandLegacyCheck(db,table,column,extra);assert.deepEqual(db.serialize(),upgraded);
 rows.push({table,rollback:true,preserves_extra_column_index_trigger_sequence:true,no_repeat_rebuild:true});console.log("PASS "+table+": old CHECK expansion atomic; extras/index/trigger/sequence retained; current schema untouched");db.close();
}
for(const dependency of ["occupied","reference"]){const db=new SQLite(":memory:");db.exec("CREATE TABLE notifications(id INTEGER PRIMARY KEY AUTOINCREMENT,type TEXT CHECK(type IN ('mention')))");if(dependency==="occupied")db.exec("CREATE TABLE notifications_check_upgrade(keep TEXT)");else db.exec("CREATE TABLE extension(id INTEGER REFERENCES notifications(id))");const before=db.serialize();assert.throws(()=>expandLegacyCheck(db,"notifications","type",["leave_overdue"]),/Occupied|incoming/);assert.deepEqual(db.serialize(),before);rows.push({dependency,unchanged:true});console.log("PASS "+dependency+": unexpected extension preserved for review");db.close();}
if(process.env.MERGE_EVIDENCE)fs.writeFileSync(path.join(process.env.MERGE_EVIDENCE,"legacy-check-calls.json"),JSON.stringify(rows,null,2));
console.log("SUMMARY 4/4 legacy upgrade groups");
