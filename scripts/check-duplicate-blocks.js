#!/usr/bin/env node
/**
 * 检测源文件里被整段复制的代码块。
 *
 * 为什么需要这个：2026-07-25 的一次改动把达人详情页的 JSX 尾部整段复制了一遍
 * （797 行 × 2），结果页面上标题栏、步骤区、侧栏全部渲染两次。
 * 而 tsc 和 eslint 都是通过的——两份完全合法的 JSX 并排放着不违反任何语法规则，
 * 类型也没问题。没有任何一道关卡能发现它，直到用户在浏览器里看到。
 *
 * 原理：把每一行规范化后建索引，找出现两次的长行，统计它们的行号差。
 * 如果大量成对行有相同的偏移量，说明是连续的一整块被复制了。
 * 偶然的重复（比如两个相似的弹窗）不会产生几十上百对相同偏移。
 *
 * 用法：node scripts/check-duplicate-blocks.js
 * 超过阈值以非 0 退出，可用在 CI 或提交前检查。
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "src");
const MIN_LINE_LEN = 40;   // 太短的行（`</div>`、`});`）到处都是，不作数
const THRESHOLD = 20;      // 同一偏移下超过这么多对，判定为整块复制

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

function findDuplicateBlock(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const pos = new Map();
  lines.forEach((l, i) => {
    const s = l.trim();
    if (s.length < MIN_LINE_LEN) return;
    if (!pos.has(s)) pos.set(s, []);
    pos.get(s).push(i + 1);
  });

  // 只看恰好出现两次的行，统计行号差
  const deltas = new Map();
  for (const positions of pos.values()) {
    if (positions.length !== 2) continue;
    const d = positions[1] - positions[0];
    if (!deltas.has(d)) deltas.set(d, []);
    deltas.get(d).push(positions);
  }

  let worst = null;
  for (const [delta, pairs] of deltas) {
    if (pairs.length < THRESHOLD) continue;
    if (!worst || pairs.length > worst.count) {
      const sorted = pairs.sort((a, b) => a[0] - b[0]);
      worst = {
        count: pairs.length,
        delta,
        firstStart: sorted[0][0],
        firstEnd: sorted[sorted.length - 1][0],
        secondStart: sorted[0][1],
        secondEnd: sorted[sorted.length - 1][1],
      };
    }
  }
  return worst;
}

const files = walk(ROOT);
const problems = [];
for (const f of files) {
  const dup = findDuplicateBlock(f);
  if (dup) problems.push({ file: path.relative(path.join(__dirname, ".."), f), ...dup });
}

if (problems.length === 0) {
  console.log(`✅ 未发现整块复制（扫描 ${files.length} 个文件）`);
  process.exit(0);
}

for (const p of problems) {
  console.log(`❌ ${p.file}`);
  console.log(`     ${p.count} 对行以相同的 ${p.delta} 行偏移重复 —— 疑似整块复制`);
  console.log(`     第一份 ${p.firstStart}–${p.firstEnd} 行，第二份 ${p.secondStart}–${p.secondEnd} 行`);
  console.log(`     核对方式：sed -n '${p.firstStart},${p.firstEnd}p' ${p.file} > /tmp/a`);
  console.log(`               sed -n '${p.secondStart},${p.secondEnd}p' ${p.file} > /tmp/b && diff /tmp/a /tmp/b`);
}
console.log(`\n共 ${problems.length} 个文件疑似有整块复制`);
process.exit(1);
