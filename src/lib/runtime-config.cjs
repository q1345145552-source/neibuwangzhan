// Next and direct DB/backup entrypoints share one environment and root-relative path.
const path = require('node:path');
const { loadEnvConfig } = require('@next/env');
// Next bundles this file under .next; process.cwd() is the deployed project root.
const projectRoot = path.resolve(process.env.INTERNAL_APP_ROOT || process.cwd());
loadEnvConfig(projectRoot, process.env.NODE_ENV !== 'production');
const databasePath = path.resolve(projectRoot, process.env.DB_PATH || 'data.db');
module.exports = { databasePath };
