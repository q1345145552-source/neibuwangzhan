#!/usr/bin/env node
const { databasePath } = require('../src/lib/runtime-config.cjs');
const policy = require('../src/lib/database-policy.cjs');
const action = process.argv[2];
async function main() {
  if (action === 'path') { policy.preflight(databasePath, 'internal', false); process.stdout.write(databasePath); }
  else if (action === 'backup' && process.argv[3]) {
    const result = await policy.backup(databasePath, process.argv[3], 'internal');
    process.stdout.write(JSON.stringify(result) + '\n');
  } else if (action === 'verify' && process.argv[3]) {
    policy.preflight(process.argv[3], 'internal', false); console.log('verified internal database');
  } else throw new Error('Usage: backup-source.cjs path | backup ABSOLUTE_DEST | verify ABSOLUTE_DATABASE');
}
main().catch(error => { console.error(error.message); process.exitCode = 10; });
