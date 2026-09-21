#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This executable is a CommonJS Node CLI with a TypeScript require hook. */
'use strict';

// Actual schema -> ledger -> JSON -> component render, in three isolated TZs.
// Uses only in-memory SQLite; never imports getDb(), starts a server, or fetches.
// INTERNAL_SOURCE_ROOT selects a baseline/candidate; MERGE_EVIDENCE is optional.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.env.INTERNAL_SOURCE_ROOT || path.join(__dirname, '..'));
const zones = ['UTC', 'Asia/Bangkok', 'America/New_York'];

async function runZone() {
  const req = Module.createRequire(path.join(root, 'package.json'));
  const ts = req('typescript');
  const originalResolve = Module._resolveFilename;
  Module._resolveFilename = function (name, parent, ...rest) {
    return originalResolve.call(this, name.startsWith('@/') ? path.join(root, 'src', name.slice(2)) : name, parent, ...rest);
  };
  for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (m, file) => m._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, file);

  const Database = req('better-sqlite3');
  const { ensureAftercareSchema } = req('./src/lib/commerce-aftercare-schema.ts');
  const { readBilling } = req('./src/lib/commerce-ledger.ts');
  const { NextResponse } = req('next/server');
  const React = req('react');
  const { renderToStaticMarkup } = req('react-dom/server');
  const { CommerceAftercare } = req('./src/components/commerce-aftercare.tsx');
  const { toThaiTime } = req('./src/lib/time.ts');
  const checks = [];
  const snapshots = [];

  function check(name, action) {
    try { action(); checks.push({ name, passed: true }); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); }
  }
  function fixture() {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE commerce_sales(id TEXT PRIMARY KEY,created_at TEXT);
      CREATE TABLE employees(id INTEGER PRIMARY KEY);
      CREATE TABLE orders(id TEXT PRIMARY KEY);
      CREATE TABLE commerce_lines(id TEXT PRIMARY KEY,sale_id TEXT,line_no INTEGER);
      CREATE TABLE commerce_fulfillments(order_id TEXT,line_id TEXT,allocated_cents INTEGER,copy_no INTEGER);
      CREATE TABLE finances(id INTEGER PRIMARY KEY,amount REAL);
      CREATE TABLE commerce_receipt_finances(order_id TEXT,finance_id INTEGER);
      INSERT INTO commerce_sales VALUES('SALE-fixture','2026-09-13 16:00:00');
      INSERT INTO employees VALUES(1);
      INSERT INTO orders VALUES('ORDER-fixture');
      INSERT INTO commerce_lines VALUES('LINE-fixture','SALE-fixture',1);
      INSERT INTO commerce_fulfillments VALUES('ORDER-fixture','LINE-fixture',10000,1);
      INSERT INTO finances VALUES(1,100),(2,20);
      INSERT INTO commerce_receipt_finances VALUES('ORDER-fixture',1);
    `);
    ensureAftercareSchema(db);
    return db;
  }
  function insertHistory(db, utc) {
    db.prepare('INSERT INTO commerce_adjustments(id,sale_id,request_id,request_json,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?)')
      .run('CREDIT-fixture', 'SALE-fixture', 'credit-fixture-000001', '{}', '合成减免', 1, utc);
    db.prepare('INSERT INTO commerce_adjustment_items VALUES(?,?,?)').run('CREDIT-fixture', 'ORDER-fixture', 2000);
    db.prepare('INSERT INTO commerce_refunds(id,sale_id,request_id,request_json,reference,reason,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('REFUND-fixture', 'SALE-fixture', 'refund-fixture-000001', '{}', 'REFERENCE-fixture', '合成实退', 1, utc);
    db.prepare('INSERT INTO commerce_refund_items VALUES(?,?,?,?)').run('REFUND-fixture', 'ORDER-fixture', 2000, 2);
  }
  function render(billing) {
    const sale = { id: 'SALE-fixture', lines: [], cancellations: [], billing };
    return renderToStaticMarkup(React.createElement(CommerceAftercare, { sale, accountId: 1, role: 'employee', onUpdated() {} }));
  }
  function historyRows(markup) {
    return [...markup.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(match => match[1].replace(/<[^>]*>/g, ''))
      .filter(text => text.startsWith('减免 ') || text.startsWith('实退 '));
  }
  function expectedRows(expected) {
    return [`减免 ¥20.00 · 合成减免 · ${expected}`, `实退 ¥20.00 · 合成实退 · 凭证 REFERENCE-fixture · ${expected}`];
  }

  const defaults = fixture();
  try {
    const started = Math.floor(Date.now() / 1000);
    defaults.prepare('INSERT INTO commerce_adjustments(id,sale_id,request_id,request_json,reason,created_by) VALUES(?,?,?,?,?,?)')
      .run('CREDIT-default', 'SALE-fixture', 'default-credit-fixture', '{}', 'default UTC probe', 1);
    defaults.prepare('INSERT INTO commerce_refunds(id,sale_id,request_id,request_json,reference,reason,created_by) VALUES(?,?,?,?,?,?,?)')
      .run('REFUND-default', 'SALE-fixture', 'default-refund-fixture', '{}', 'default-reference', 'default UTC probe', 1);
    const ended = Math.floor(Date.now() / 1000);
    for (const table of ['commerce_adjustments', 'commerce_refunds']) {
      const value = defaults.prepare(`SELECT created_at FROM ${table}`).get().created_at;
      check(`${table}: schema default is UTC`, () => {
        assert.match(value, /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
        const epoch = Date.parse(value.replace(' ', 'T') + 'Z') / 1000;
        assert.ok(epoch >= started && epoch <= ended, `${value} must fall within UTC insertion interval`);
      });
      snapshots.push({ name: `${table}: default`, rawUtc: value, insertionEpochRange: [started, ended] });
    }
  } finally { defaults.close(); }

  const cases = [
    ['same-day', '2026-09-13 00:30:00', '2026-09-13 07:30'],
    ['before-midnight', '2026-09-13 16:59:59', '2026-09-13 23:59'],
    ['at-midnight', '2026-09-13 17:00:00', '2026-09-14 00:00'],
    ['reported-regression', '2026-09-13 18:30:00', '2026-09-14 01:30'],
    ['year-rollover', '2026-12-31 17:00:00', '2027-01-01 00:00'],
    ['leap-day-start', '2024-02-28 17:00:00', '2024-02-29 00:00'],
    ['leap-day-end', '2024-02-29 17:00:00', '2024-03-01 00:00'],
  ];
  for (const [name, utc, expected] of cases) {
    const db = fixture();
    try {
      insertHistory(db, utc);
      const billing = readBilling(db, 'SALE-fixture');
      const response = NextResponse.json({ billing });
      const api = JSON.parse(await response.text());
      const beforeRender = JSON.stringify(api.billing);
      const markup = render(api.billing);
      const displayed = historyRows(markup);
      check(`${name}: UTC unchanged through database, ledger and API`, () => {
        for (const table of ['commerce_adjustments', 'commerce_refunds']) assert.equal(db.prepare(`SELECT created_at FROM ${table}`).get().created_at, utc);
        for (const value of [billing.adjustments[0].created_at, billing.refunds[0].created_at, api.billing.adjustments[0].created_at, api.billing.refunds[0].created_at]) assert.equal(value, utc);
        assert.equal(response.status, 200);
      });
      check(`${name}: common formatter matches fixed Bangkok calendar expectation`, () => assert.equal(toThaiTime(utc), expected));
      check(`${name}: actual adjustment and refund rows display Bangkok`, () => assert.deepEqual(displayed, expectedRows(expected)));
      check(`${name}: rendering does not mutate UTC input or amounts`, () => {
        assert.equal(JSON.stringify(api.billing), beforeRender);
        assert.equal(api.billing.original_cents, 10000);
        assert.equal(api.billing.credited_cents, 2000);
        assert.equal(api.billing.refunded_cents, 2000);
        assert.equal(db.prepare('SELECT created_at FROM commerce_adjustments').get().created_at, utc);
        assert.equal(db.prepare('SELECT created_at FROM commerce_refunds').get().created_at, utc);
      });
      snapshots.push({ name, inputUtc: utc, apiUtc: [api.billing.adjustments[0].created_at, api.billing.refunds[0].created_at], expected: expectedRows(expected), displayed });
    } finally { db.close(); }
  }

  const empty = fixture();
  try {
    const billing = readBilling(empty, 'SALE-fixture');
    check('empty history has no history disclosure or invented dates', () => {
      const markup = render(billing);
      assert.deepEqual(historyRows(markup), []);
      assert.equal(markup.includes('查看减免与退款记录'), false);
      assert.equal(markup.includes('Invalid Date'), false);
    });
    insertHistory(empty, cases[3][1]);
    const populated = readBilling(empty, 'SALE-fixture');
    for (const key of ['adjustments', 'refunds']) check(`${key}: single record category renders alone`, () => {
      const onlyOne = { ...populated, [key === 'adjustments' ? 'refunds' : 'adjustments']: [] };
      assert.deepEqual(historyRows(render(onlyOne)), [expectedRows(cases[3][2])[key === 'adjustments' ? 0 : 1]]);
    });
    // Runtime display boundaries; not persisted nullable/invalid database dates.
    for (const [name, input, expected] of [
      ['ISO UTC', '2026-09-13T18:30:00Z', '2026-09-14 01:30'],
      ['explicit Bangkok offset', '2026-09-14T01:30:00+07:00', '2026-09-14 01:30'],
      ['explicit western offset', '2026-09-13T14:30:00-04:00', '2026-09-14 01:30'],
      ['empty string', '', ''], ['null value', null, ''], ['missing value', undefined, ''], ['invalid value', 'invalid-time', ''],
    ]) check(`${name}: display boundary uses formatter behavior`, () => {
      assert.equal(toThaiTime(input), expected);
      const view = {
        ...populated,
        adjustments: populated.adjustments.map(row => ({ ...row, created_at: input })),
        refunds: populated.refunds.map(row => ({ ...row, created_at: input })),
      };
      assert.deepEqual(historyRows(render(view)), expectedRows(expected));
    });
  } finally { empty.close(); }

  const report = { tz: process.env.TZ, sourceRoot: root, passed: checks.filter(item => item.passed).length, failed: checks.filter(item => !item.passed).length, checks, snapshots };
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.failed ? 1 : 0;
}

if (process.argv.includes('--zone-child')) {
  runZone().catch(error => { console.error(error.stack || String(error)); process.exitCode = 1; });
} else {
  const results = zones.map(tz => {
    const result = spawnSync(process.execPath, [__filename, '--zone-child'], {
      env: { ...process.env, TZ: tz, INTERNAL_SOURCE_ROOT: root }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
    });
    let report = null;
    try { report = JSON.parse(result.stdout); } catch { /* Keep raw output for setup failures. */ }
    return { tz, command: [process.execPath, __filename, '--zone-child'], env: { TZ: tz, INTERNAL_SOURCE_ROOT: root }, exitStatus: result.status, signal: result.signal, error: result.error?.message, stdout: result.stdout, stderr: result.stderr, report };
  });
  const report = {
    suite: 'commerce-time', sourceRoot: root,
    scope: 'Actual aftercare schema + ledger + NextResponse serializer + React server render; minimal relational fixture in memory, not an authenticated HTTP handler or browser.',
    passed: results.reduce((sum, result) => sum + (result.report?.passed || 0), 0),
    failed: results.reduce((sum, result) => sum + (result.report?.failed || 0), 0),
    results,
  };
  const ok = results.every(result => result.exitStatus === 0 && result.report && result.report.failed === 0);
  if (process.env.MERGE_EVIDENCE) {
    const output = path.resolve(process.env.MERGE_EVIDENCE);
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'commerce-time.json'), JSON.stringify(report, null, 2) + '\n');
  }
  for (const result of results) console.log(`${result.tz}: ${result.report?.passed ?? 0} passed, ${result.report?.failed ?? 'setup'} failed, exit ${result.exitStatus}`);
  for (const result of results) if (!result.report) process.stderr.write(result.stderr || result.error || 'Child did not emit a report\n');
  console.log(`commerce-time: ${ok ? 'PASS' : 'FAIL'} (${report.passed} passed, ${report.failed} failed; 3 timezones)`);
  process.exitCode = ok ? 0 : 1;
}
