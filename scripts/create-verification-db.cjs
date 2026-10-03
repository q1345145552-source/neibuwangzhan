#!/usr/bin/env node
// Release checks only. Executes the real schema initializer on one NEW /tmp fixture.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const filename = process.argv[2];
if (!filename || !path.isAbsolute(filename) || !/^\/(?:private\/)?tmp\/xt-release-[^/]+\/fixture\.db$/.test(filename) || fs.existsSync(filename)) {
  throw new Error('Expected a new /tmp/xt-release-*/fixture.db, never a business database');
}
process.env.DB_PATH = filename;
process.env.NODE_ENV = 'test';
process.env.ALLOW_EMPTY_DB = '1';
// No installation, build emit, global config edit, HTTP or external DB access.
require.extensions['.ts'] = function(module, file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  module._compile(code, file);
};
const db = require('../src/lib/db.ts').getDb();
console.log('created isolated verification database: ' + db.name);
db.close();
