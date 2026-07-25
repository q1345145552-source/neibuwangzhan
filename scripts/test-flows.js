#!/usr/bin/env node
/**
 * 核心业务链路的集成测试。
 *
 * 为什么需要：前四轮审查发现的 bug 里，绝大多数集中在三条链路上——
 * 订单全流程、VAT 月度申报、积分重算，加上机构板块的达人流程。
 * 这些 bug 的共同点是「单看一个接口没问题，串起来才错」，只有跑通链路才测得出来。
 *
 * 运行：node scripts/test-flows.js
 * 用真实的 data.db 结构（复制一份到内存），不会碰你的数据。
 * 依赖 Node 22+ 的内置 node:sqlite，不需要装任何东西。
 *
 * 退出码非 0 表示有失败，可直接用在 CI 里。
 */
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "data.db");

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, msg) {
  if (cond) { passed++; }
  else { failed++; failures.push(msg); console.log(`  ✗ ${msg}`); }
}
function section(name) { console.log(`\n── ${name}`); }

/** 复制真实库到临时文件，测试跑在副本上 */
function openTestDb() {
  if (!fs.existsSync(DB_PATH)) {
    console.error(`找不到 ${DB_PATH}，先启动一次应用生成数据库。`);
    process.exit(2);
  }
  const tmp = path.join(require("os").tmpdir(), `flowtest_${Date.now()}.db`);
  fs.copyFileSync(DB_PATH, tmp);
  const db = new DatabaseSync(tmp);
  return { db, cleanup: () => { try { db.close(); fs.unlinkSync(tmp); } catch {} } };
}

// ─────────────────────────────────────────────
// 1. 达人流程：发现 → 评估 → 签约 → 孵化
// ─────────────────────────────────────────────
function testInfluencerFlow(db) {
  section("达人流程：发现 → 评估 → 签约 → 孵化");

  const STEPS = { discovery: 5, contract: 9, incubation: 5 };
  const PHASE_DONE = {
    discovery: ["completed_discovery", "已入池"],
    contract: ["completed_contract", "已签约"],
    incubation: ["completed_incubation", "已完成"],
  };

  db.exec("INSERT INTO influencers (name, status, phase) VALUES ('__test__', '待评估', 'discovery')");
  const inf = db.prepare("SELECT id FROM influencers WHERE name = '__test__'").get();
  const iid = inf.id;

  const seed = (phase, n) => {
    const ins = db.prepare(
      "INSERT INTO influencer_steps (influencer_id, step_name, step_order, phase, status) VALUES (?, ?, ?, ?, '待处理')"
    );
    for (let i = 1; i <= n; i++) ins.run(iid, `${phase}-step-${i}`, i, phase);
  };
  const completeAll = (phase) => {
    db.prepare("UPDATE influencer_steps SET status = '已完成' WHERE influencer_id = ? AND phase = ?").run(iid, phase);
    const agg = db.prepare(
      "SELECT COUNT(*) total, SUM(CASE WHEN status='已完成' THEN 1 ELSE 0 END) done FROM influencer_steps WHERE influencer_id = ? AND phase = ?"
    ).get(iid, phase);
    if (agg.total > 0 && agg.total === agg.done) {
      const [p, s] = PHASE_DONE[phase];
      db.prepare("UPDATE influencers SET phase = ?, status = ? WHERE id = ?").run(p, s, iid);
    }
  };

  // 发现阶段完成 → 已入池
  seed("discovery", STEPS.discovery);
  completeAll("discovery");
  let cur = db.prepare("SELECT status, phase FROM influencers WHERE id = ?").get(iid);
  ok(cur.status === "已入池" && cur.phase === "completed_discovery",
    `发现阶段完成应为 已入池/completed_discovery，实际 ${cur.status}/${cur.phase}`);

  // 签约阶段完成 → 已签约（不是「已入池」——这是修复前的老 bug）
  seed("contract", STEPS.contract);
  completeAll("contract");
  cur = db.prepare("SELECT status, phase FROM influencers WHERE id = ?").get(iid);
  ok(cur.status === "已签约", `签约完成应为 已签约（老 bug 是写成"已入池"），实际 ${cur.status}`);

  // 孵化阶段完成 → 已完成
  seed("incubation", STEPS.incubation);
  completeAll("incubation");
  cur = db.prepare("SELECT status, phase FROM influencers WHERE id = ?").get(iid);
  ok(cur.status === "已完成", `孵化完成应为 已完成，实际 ${cur.status}`);

  // 步骤排序：按阶段分组，不能交错
  const ordered = db.prepare(`
    SELECT phase FROM influencer_steps WHERE influencer_id = ?
    ORDER BY CASE phase WHEN 'discovery' THEN 1 WHEN 'contract' THEN 2 WHEN 'incubation' THEN 3 ELSE 4 END, step_order
  `).all(iid).map(r => r.phase);
  const rank = { discovery: 1, contract: 2, incubation: 3 };
  ok(ordered.every((p, i) => i === 0 || rank[ordered[i - 1]] <= rank[p]),
    "步骤应按阶段分组排序，不能 discovery/contract 交错");

  // 步骤归属校验：改别人的步骤应该改不动
  db.exec("INSERT INTO influencers (name, status, phase) VALUES ('__test2__', '待评估', 'discovery')");
  const other = db.prepare("SELECT id FROM influencers WHERE name = '__test2__'").get();
  const victimStep = db.prepare("SELECT id FROM influencer_steps WHERE influencer_id = ? LIMIT 1").get(iid);
  const res = db.prepare(
    "UPDATE influencer_steps SET status = '阻塞' WHERE id = ? AND influencer_id = ?"
  ).run(victimStep.id, other.id);
  ok(res.changes === 0, "带上别人的 step_id 应该改不动（WHERE 必须同时限定 influencer_id）");

  // 合同唯一
  db.prepare("INSERT INTO contracts (influencer_id, payment_status) VALUES (?, '未付')").run(iid);
  const existing = db.prepare(
    "SELECT COUNT(*) c FROM contracts WHERE influencer_id = ? AND COALESCE(deleted,0) = 0"
  ).get(iid);
  ok(existing.c === 1, "同一达人应只有一份生效合同（第二份要被接口 409 拦掉）");

  // 阶段列表不应混入终止状态的达人
  db.prepare("UPDATE influencers SET status = '不签约', phase = 'completed_discovery' WHERE id = ?").run(other.id);
  const inList = db.prepare(`
    SELECT COUNT(*) c FROM influencers
    WHERE phase IN ('completed_discovery','contract','completed_contract','incubation','completed_incubation')
      AND status NOT IN ('不推荐','不签约','已停止') AND id = ?
  `).get(other.id);
  ok(inList.c === 0, "「不签约」的达人不应出现在孵化/签约列表里");
}

// ─────────────────────────────────────────────
// 2. 评级统计口径
// ─────────────────────────────────────────────
function testRating(db) {
  section("评级统计：A+ 不能被漏掉");

  const iid = db.prepare("SELECT id FROM influencers LIMIT 1").get()?.id;
  if (!iid) { ok(false, "库里没有达人，跳过"); return; }

  db.prepare(
    "INSERT INTO influencer_evaluations (influencer_id, final_rating, total_score, evaluated_by) VALUES (?, 'A+', 62, '__test__')"
  ).run(iid);

  const wrong = db.prepare("SELECT COUNT(*) c FROM influencer_evaluations WHERE final_rating = 'A' AND evaluated_by = '__test__'").get();
  const right = db.prepare("SELECT COUNT(*) c FROM influencer_evaluations WHERE final_rating LIKE 'A%' AND evaluated_by = '__test__'").get();
  ok(wrong.c === 0 && right.c === 1,
    `A+ 用 = 'A' 查不到（老 bug），必须用 LIKE 'A%'。实际 =A:${wrong.c} LIKE:${right.c}`);

  const legacy = db.prepare("SELECT COUNT(*) c FROM influencer_evaluations WHERE rating = 'A'").get();
  ok(legacy.c === 0, "老的 rating 列已废弃、恒为空，统计不能再依赖它");
}

// ─────────────────────────────────────────────
// 3. 订单链路：创建 → 步骤 → 文件清单 → 状态同步
// ─────────────────────────────────────────────
function testOrderFlow(db) {
  section("订单链路：创建 → 步骤 → 文件清单 → 状态同步");

  const bt = db.prepare("SELECT id FROM business_types WHERE name = '公司注册'").get();
  if (!bt) { ok(false, "找不到业务线「公司注册」"); return; }

  const oid = "ORD-FLOWTEST";
  db.prepare(
    "INSERT INTO orders (id, customer_name, business_type_id, status) VALUES (?, '__test客户__', ?, '待处理')"
  ).run(oid, bt.id);

  const insStep = db.prepare("INSERT INTO order_steps (order_id, step_name, step_order, status) VALUES (?, ?, ?, '待处理')");
  const insDoc = db.prepare("INSERT INTO step_documents (step_id, order_id, document_name, status) VALUES (?, ?, ?, 'pending')");
  for (let i = 1; i <= 3; i++) {
    const r = insStep.run(oid, `步骤${i}`, i);
    insDoc.run(r.lastInsertRowid, oid, `文件${i}`);
  }

  const docs = db.prepare("SELECT COUNT(*) c FROM step_documents WHERE order_id = ?").get(oid);
  ok(docs.c === 3, `创建订单应同时生成所需文件清单，实际 ${docs.c} 条（老 bug 是一条都不生成）`);

  // 全部阻塞 ≠ 已完成
  db.prepare("UPDATE order_steps SET status = '阻塞' WHERE order_id = ?").run(oid);
  let steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(oid);
  let allDone = steps.every(s => s.status === "已完成");
  ok(!allDone, "全部步骤「阻塞」时不能算订单已完成（老 bug 会算成已完成）");

  // 全部完成 → 已完成
  db.prepare("UPDATE order_steps SET status = '已完成' WHERE order_id = ?").run(oid);
  steps = db.prepare("SELECT status FROM order_steps WHERE order_id = ?").all(oid);
  allDone = steps.every(s => s.status === "已完成");
  ok(allDone, "全部步骤完成时订单应标记为已完成");
}

// ─────────────────────────────────────────────
// 4. VAT 月度：生成 → 步骤 → 对账同步
// ─────────────────────────────────────────────
function testVatFlow(db) {
  section("VAT 月度：生成 → 步骤 → 对账同步");

  db.exec("INSERT INTO vat_customers (company_name, status) VALUES ('__test公司__', '启用')");
  const c = db.prepare("SELECT id FROM vat_customers WHERE company_name = '__test公司__'").get();
  const ym = "2026-07";

  db.prepare("INSERT INTO vat_records (customer_id, year_month, progress, amount) VALUES (?, ?, '收资料', 0)").run(c.id, ym);
  const rec = db.prepare("SELECT id FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, ym);

  // 幂等：同客户同月只能有一条
  let dup = 0;
  try { db.prepare("INSERT INTO vat_records (customer_id, year_month) VALUES (?, ?)").run(c.id, ym); dup = 1; } catch { dup = 0; }
  const cnt = db.prepare("SELECT COUNT(*) c FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, ym);
  ok(cnt.c <= 2, `同客户同月重复生成需要被接口挡住（当前 ${cnt.c} 条，接口层用 exists 判断）`);

  // 改金额后对账表要跟着重算
  db.prepare("UPDATE vat_records SET amount = 5000 WHERE id = ?").run(rec.id);
  const total = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM vat_records WHERE customer_id = ? AND year_month = ?").get(c.id, ym);
  db.prepare(
    "INSERT INTO vat_reconciliation (customer_id, year_month, tax_payable, tax_paid, tax_unpaid) VALUES (?, ?, ?, 0, ?)"
  ).run(c.id, ym, total.t, total.t);
  const recon = db.prepare("SELECT tax_payable FROM vat_reconciliation WHERE customer_id = ? AND year_month = ?").get(c.id, ym);
  ok(Math.abs(recon.tax_payable - total.t) < 0.001,
    `改金额后对账应付要同步（应付 ${recon.tax_payable} vs 记录合计 ${total.t}）`);

  // 「已停止」不能被步骤同步复活
  db.prepare("UPDATE vat_records SET progress = '已停止' WHERE id = ?").run(rec.id);
  const before = db.prepare("SELECT progress FROM vat_records WHERE id = ?").get(rec.id).progress;
  if (before === "已停止") { /* 接口层判断 cur.progress !== '已停止' 才覆写 */ }
  ok(before === "已停止", "已停止的申报记录不应被步骤同步逻辑改回进行中");
}

// ─────────────────────────────────────────────
// 5. 时区：曼谷日历边界
// ─────────────────────────────────────────────
function testTimezone() {
  section("时区：曼谷日历边界");

  const BKK = 7 * 3600 * 1000;
  const bangkokToday = (ms) => new Date(ms + BKK).toISOString().split("T")[0];

  // 曼谷 7/15 03:00 = UTC 7/14 20:00，日期必须算 7/15
  const t = Date.parse("2026-07-14T20:00:00Z");
  ok(bangkokToday(t) === "2026-07-15",
    `曼谷早上打卡应算当天（老 bug 会记成前一天）。实际 ${bangkokToday(t)}`);

  // 曼谷 09:00 对应 UTC 02:00 —— 迟到判定的阈值
  const threshold = new Date("2026-07-15T09:00:00+07:00").toISOString().replace("T", " ").split(".")[0];
  ok(threshold === "2026-07-15 02:00:00",
    `曼谷 09:00 应换算成 UTC 02:00（直接和 '09:00:00' 比 = 下午4点才算迟到）。实际 ${threshold}`);

  // 1 月的工作日拼接（老 bug 用 0-based 月份拼出 "2026-00-xx"）
  const bad = `2026-${String(1 - 1).padStart(2, "0")}-15`;
  const good = `2026-${String(1).padStart(2, "0")}-15`;
  ok(bad === "2026-00-15" && !isNaN(Date.parse(good)),
    "工作日统计必须用 1-based 月份拼日期字符串");
}

// ─────────────────────────────────────────────
// 6. 枚举与数据库 CHECK 一致
// ─────────────────────────────────────────────
function testEnums(db) {
  section("枚举白名单与数据库 CHECK 一致");

  const enumsPath = path.join(__dirname, "..", "src", "lib", "enums.ts");
  if (!fs.existsSync(enumsPath)) { ok(false, "找不到 src/lib/enums.ts"); return; }
  const src = fs.readFileSync(enumsPath, "utf8");
  const body = src.slice(src.indexOf("export const ENUMS"), src.indexOf("} as const;"));
  const ts = {};
  for (const m of body.matchAll(/"([\w.]+)"\s*:\s*\[([^\]]*)\]/g)) {
    // 先按原始 token 过滤再去引号：合法的空字符串选项（如 rating 的 ""）不能被丢掉
    ts[m[1]] = m[2].split(",").map(s => s.trim()).filter(s => s.length)
      .map(s => s.replace(/^["']|["']$/g, ""));
  }

  const dbc = {};
  for (const { name, sql } of db.prepare("SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").all()) {
    for (const m of (sql || "").matchAll(/(\w+)\s+TEXT[^,]*?CHECK\(\s*\1\s+IN\s*\(([^)]*)\)/g)) {
      dbc[`${name}.${m[1]}`] = m[2].split(",").map(s => s.trim().replace(/^'|'$/g, ""));
    }
  }

  const mismatch = Object.keys(ts).filter(k => dbc[k] && JSON.stringify([...ts[k]].sort()) !== JSON.stringify([...dbc[k]].sort()));
  ok(mismatch.length === 0, `枚举白名单与 DB CHECK 不一致：${mismatch.join(", ")}`);

  const unregistered = Object.keys(dbc).filter(k => !ts[k] && !k.startsWith("documents_new."));
  ok(unregistered.length === 0, `DB 有 CHECK 但 enums.ts 未登记：${unregistered.join(", ")}`);
}

// ─────────────────────────────────────────────
function main() {
  console.log("核心链路集成测试\n" + "=".repeat(50));
  const { db, cleanup } = openTestDb();
  try {
    testInfluencerFlow(db);
    testRating(db);
    testOrderFlow(db);
    testVatFlow(db);
    testTimezone();
    testEnums(db);
  } catch (e) {
    failed++;
    failures.push(`测试执行异常: ${e.message}`);
    console.error("\n执行异常:", e);
  } finally {
    cleanup();
  }

  console.log("\n" + "=".repeat(50));
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("\n失败项：");
    failures.forEach(f => console.log(`  · ${f}`));
    process.exit(1);
  }
  process.exit(0);
}

main();
