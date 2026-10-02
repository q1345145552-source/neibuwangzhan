'use strict';
// Runs the real Next production lifecycle in an isolated minimal application.
// Production instrumentation/progress sources are copied verbatim. Only DB factory
// is replaced by a fixture connection; outbound fetch is intercepted before boot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const Database = require('better-sqlite3');
const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync('/tmp/xt-progress-startup-');
const next = require.resolve('next/dist/bin/next');
const dbPath = path.join(temp, 'fixture.sqlite');
const fetched = path.join(temp, 'fetch.jsonl');
const touched = path.join(temp, 'db-touched.txt');
fs.mkdirSync(path.join(temp, 'src/lib'), { recursive: true });
fs.mkdirSync(path.join(temp, 'src/app'), { recursive: true });
fs.symlinkSync(path.join(root, 'node_modules'), path.join(temp, 'node_modules'), 'dir');
for (const relative of ['src/instrumentation.ts', 'src/lib/progress-sync.ts']) {
  fs.copyFileSync(path.join(root, relative), path.join(temp, relative));
}
fs.writeFileSync(path.join(temp, 'package.json'), JSON.stringify({ name: 'progress-startup-fixture', private: true, dependencies: { next: '16.2.9', react: '19.2.4', 'react-dom': '19.2.4' } }));
fs.writeFileSync(path.join(temp, 'next.config.js'), 'module.exports = { experimental: { cpus: 1 } };\n');
fs.writeFileSync(path.join(temp, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'esnext', moduleResolution: 'bundler', jsx: 'react-jsx', strict: true, esModuleInterop: true, skipLibCheck: true, noEmit: true, plugins: [{ name: 'next' }] }, include: ['**/*.ts', '**/*.tsx', '.next/types/**/*.ts'], exclude: ['node_modules'] }));
fs.writeFileSync(path.join(temp, 'src/app/layout.tsx'), 'export default function Layout({ children }: { children: React.ReactNode }) { return <html><body>{children}</body></html>; }\n');
fs.writeFileSync(path.join(temp, 'src/app/page.tsx'), 'export default function Page() { return <p>Local progress startup fixture</p>; }\n');
fs.writeFileSync(path.join(temp, 'src/lib/db.ts'), `import Database from 'better-sqlite3';
import fs from 'node:fs';
let db: Database.Database;
export function getDb() {
  fs.appendFileSync(process.env.DB_TOUCH_MARKER!, process.env.NEXT_PHASE + '\\n');
  return db ??= new Database(process.env.DB_PATH!);
}
`);
// 客户可见步骤名只在入队时调用，启动补传不经过它；真实映射由 test-sync-public-steps.mts 覆盖。
fs.writeFileSync(path.join(temp, 'src/lib/commerce-fulfillment.ts'), `export function publicStepNames(names: readonly string[]): string[] {
  return names.map(() => '办理事项');
}
`);
fs.writeFileSync(path.join(temp, 'preload.cjs'), `const fs = require('node:fs');
globalThis.fetch = async (url, options) => {
  if (String(url) !== 'https://fixture.invalid/api/sync/progress') throw Error('Unexpected outbound URL intercepted');
  fs.appendFileSync(process.env.FETCH_MARKER, JSON.stringify({ url, body: JSON.parse(options.body) }) + '\\n');
  return new Response(JSON.stringify({ok:true,...JSON.parse(options.body)}), { status: 200 });
};
`);
const db = new Database(dbPath);
db.exec(`CREATE TABLE sync_progress_outbox(id TEXT PRIMARY KEY,inbox_id TEXT,payload TEXT,status TEXT DEFAULT 'pending',created_at TEXT DEFAULT (datetime('now')),sent_at TEXT,attempts INTEGER DEFAULT 0,next_attempt_at TEXT,last_error TEXT);
  INSERT INTO sync_progress_outbox(id,inbox_id,payload) VALUES('before-restart','fixture-inbox','{"source_order_no":"FIXTURE-001","seq":1,"status":"待处理","steps":[]}');`);
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1', CUSTOMER_SYNC_URL: 'https://fixture.invalid', SYNC_SECRET: 'fixture-only', DB_PATH: dbPath, DB_TOUCH_MARKER: touched, FETCH_MARKER: fetched, NODE_OPTIONS: `--require ${path.join(temp, 'preload.cjs')}` };
delete env.NEXT_PHASE;
delete env.NEXT_RUNTIME;
function launch(args) {
  const child = spawn(process.execPath, [next, ...args], { cwd: temp, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal, output })); });
  return { child, done, get output() { return output; } };
}
const pause = ms => new Promise(resolve => { const timer = setTimeout(resolve, ms); timer.unref(); });
async function waitFor(run, check, timeout = 30000) {
  const started = Date.now();
  while (!check()) {
    if (run.child.exitCode !== null) throw Error(`Next exited early: ${run.output}`);
    if (Date.now() - started > timeout) throw Error(`Timed out: ${run.output}`);
    await pause(50);
  }
}
async function stop(run) {
  run.child.kill('SIGTERM');
  const result = await Promise.race([run.done, pause(10000).then(() => null)]);
  if (!result) { run.child.kill('SIGKILL'); await run.done; throw Error('Next did not terminate cleanly'); }
  assert.ok(result.code === 0 || result.code === 143 || result.signal === 'SIGTERM', JSON.stringify(result));
  return result;
}
let active;
const stopResults = [];
(async () => {
  active = launch(['build', '--webpack']);
  const result = await Promise.race([active.done, pause(120000).then(() => null)]);
  if (!result) throw Error('Isolated build timeout');
  fs.writeFileSync(path.join(temp, 'build.log'), result.output);
  assert.equal(result.code, 0, result.output);
  active = null;
  assert.equal(fs.existsSync(touched), false, 'build must not open even the fixture database');
  assert.equal(fs.existsSync(fetched), false, 'build must not attempt progress transmission');
  console.log('PASS real Next build: no database access, no transmission');
  for (const iteration of [1, 2]) {
    if (iteration === 2) db.prepare('INSERT INTO sync_progress_outbox(id,inbox_id,payload) VALUES(?,?,?)').run('second-restart', 'fixture-inbox', JSON.stringify({ source_order_no: 'FIXTURE-001', seq: 2, status: '已完成', steps: [] }));
    active = launch(['start', '--hostname', '127.0.0.1', '--port', '0']);
    await waitFor(active, () => /Ready in/.test(active.output));
    await waitFor(active, () => db.prepare("SELECT COUNT(*) n FROM sync_progress_outbox WHERE status='pending'").get().n === 0);
    const sent = fs.readFileSync(fetched, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(sent.length, iteration);
    const exit = await stop(active);
    stopResults.push({ code: exit.code, signal: exit.signal });
    fs.writeFileSync(path.join(temp, `start-${iteration}.log`), exit.output);
    active = null;
    console.log(`PASS real Next start ${iteration}: pending seq=${iteration} sent before any HTTP request; clean stop`);
  }
  fs.writeFileSync(path.join(temp, 'results.json'), JSON.stringify({ next: require('next/package.json').version, build_exit: result.code, restarts: 2, stop_results: stopResults, http_requests: 0, fetched: fs.readFileSync(fetched, 'utf8').trim().split('\n').length, fixture: temp }, null, 2));
  console.log(`PASS lifecycle evidence ${temp}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (active && active.child.exitCode === null) { active.child.kill('SIGTERM'); await active.done; }
  db.close();
});
