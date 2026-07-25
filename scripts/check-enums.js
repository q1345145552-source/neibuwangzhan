#!/usr/bin/env node
/**
 * 比对 src/lib/enums.ts 的白名单与 data.db 里实际的 CHECK 约束。
 *
 * 两边不一致会出问题：
 *   - 白名单比 DB 宽 → 校验放行了、写库时才撞 CHECK → 500
 *   - 白名单比 DB 窄 → 合法值被接口拒绝 → 用户报"提交不了"
 *
 * 用法：node scripts/check-enums.js
 * 建议加进 CI 或提交前检查。不一致时以非 0 退出。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(ROOT, "data.db");
const ENUMS_TS = path.join(ROOT, "src", "lib", "enums.ts");

function parseEnumsTs() {
  const src = fs.readFileSync(ENUMS_TS, "utf8");
  const body = src.slice(src.indexOf("export const ENUMS"), src.indexOf("} as const;"));
  const out = {};
  const re = /"([\w.]+)"\s*:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = re.exec(body))) {
    // 注意顺序：先按原始 token 过滤空项，再去引号。
    // 反过来的话，合法的空字符串选项（如 influencer_evaluations.rating 的 ""）
    // 会被 filter 当成空值丢掉，导致误报"与数据库不一致"。
    out[m[1]] = m[2]
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length)
      .map((s) => s.replace(/^["']|["']$/g, ""));
  }
  return out;
}

function parseDbChecks() {
  let Database;
  try {
    Database = require("better-sqlite3");
  } catch {
    console.error("需要 better-sqlite3（项目依赖）。请在项目根目录运行。");
    process.exit(2);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.error(`找不到 ${DB_PATH}，先启动一次应用生成数据库。`);
    process.exit(2);
  }
  const db = new Database(DB_PATH, { readonly: true });
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all();
  const out = {};
  for (const { name, sql } of rows) {
    const re = /(\w+)\s+TEXT[^,]*?CHECK\(\s*\1\s+IN\s*\(([^)]*)\)/g;
    let m;
    while ((m = re.exec(sql))) {
      out[`${name}.${m[1]}`] = m[2]
        .split(",")
        .map((s) => s.trim().replace(/^'|'$/g, ""))
        .filter((s, i, a) => a.indexOf(s) === i);
    }
  }
  db.close();
  return out;
}

const ts = parseEnumsTs();
const db = parseDbChecks();
let problems = 0;

for (const key of Object.keys(ts)) {
  if (!db[key]) {
    console.log(`⚠️  ${key}: enums.ts 里有，但数据库里没有对应的 CHECK 约束（表未建或已改名？）`);
    problems++;
    continue;
  }
  const a = new Set(ts[key]);
  const b = new Set(db[key]);
  const onlyTs = [...a].filter((v) => !b.has(v));
  const onlyDb = [...b].filter((v) => !a.has(v));
  if (onlyTs.length || onlyDb.length) {
    console.log(`❌ ${key} 不一致`);
    if (onlyTs.length) console.log(`     只在 enums.ts: ${JSON.stringify(onlyTs)}  → 校验会放行、写库时 500`);
    if (onlyDb.length) console.log(`     只在数据库:    ${JSON.stringify(onlyDb)}  → 合法值会被接口拒绝`);
    problems++;
  }
}

for (const key of Object.keys(db)) {
  if (key.startsWith("documents_new.")) continue; // 迁移中间表
  if (!ts[key]) {
    console.log(`⚠️  ${key}: 数据库有 CHECK 约束，但 enums.ts 没登记（写入前不会被校验）`);
    problems++;
  }
}

if (problems === 0) {
  console.log(`✅ 枚举白名单与数据库 CHECK 完全一致（共 ${Object.keys(ts).length} 列）`);
  process.exit(0);
}
console.log(`\n共 ${problems} 处不一致`);
process.exit(1);
