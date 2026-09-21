#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- This executable is a CommonJS Node CLI. */
// Local-only copied runtime; never reads a real DB, .env, uploads or SSH credentials.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawn,spawnSync}=require('node:child_process'),net=require('node:net');
const root=path.resolve(__dirname,'..');
let catalogSnapshot=null;
for(let i=2;i<process.argv.length;i++){const arg=process.argv[i];if(arg==='--prepare-only')continue;if(arg==='--catalog'&&process.argv[i+1]&&!process.argv[i+1].startsWith('--')){catalogSnapshot=path.resolve(process.argv[++i]);if(!fs.statSync(catalogSnapshot).isFile())throw new Error('Catalog snapshot must be a file');continue;}throw new Error('Supported options: --prepare-only, --catalog /absolute/snapshot.json');}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'xt-commerce-preview-'));
const inputs=['src','public','package.json','package-lock.json','tsconfig.json','next-env.d.ts','next.config.mjs','postcss.config.mjs'];
for(const name of inputs)if(fs.existsSync(path.join(root,name)))fs.cpSync(path.join(root,name),path.join(dir,name),{recursive:true});
fs.symlinkSync(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
const password=crypto.randomBytes(15).toString('base64url')+'!a1';
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:dir,NODE_ENV:'development',DB_PATH:path.join(dir,'synthetic.db'),INTERNAL_APP_ROOT:dir,ALLOW_EMPTY_DB:'1',JWT_SECRET:crypto.randomBytes(32).toString('hex'),COMMERCE_PILOT_ENABLED:'1',SYNC_SECRET:'',CUSTOMER_SYNC_URL:'',NEXT_TELEMETRY_DISABLED:'1',PREVIEW_PASSWORD:password};
// Offline typography only; real business APIs. Loopback-only sockets.
fs.writeFileSync(path.join(dir,"font-fixture.cjs"),"module.exports = new Proxy({}, {get(_target, url) {if (typeof url !== \"string\") return undefined; const match=/family=([^:&]+)/.exec(url); const family=(match ? decodeURIComponent(match[1]).replace(/\\+/g,\" \") : \"Fixture Font\"); return `@font-face { font-family: \"${family}\"; src: local(\"Arial\"); font-style: normal; font-weight: 100 900; font-display: swap; }`;} });");
fs.writeFileSync(path.join(dir,"network-guard.cjs"),"const net=require(\"node:net\"),connect=net.Socket.prototype.connect; net.Socket.prototype.connect=function(...args){const v=args[0];const host=v&&typeof v===\"object\"?v.host:typeof args[1]===\"string\"?args[1]:null;if(host&&![\"localhost\",\"127.0.0.1\",\"::1\",\"0.0.0.0\"].includes(host))throw Error(\"Preview only permits loopback: \"+host);return connect.apply(this,args);};");
env.NEXT_FONT_GOOGLE_MOCKED_RESPONSES=path.join(dir,"font-fixture.cjs");
env.NODE_OPTIONS="--require "+path.join(dir,"network-guard.cjs");
const seed=String.raw`
const fs=require('node:fs'),ts=require('typescript'),bcrypt=require('bcryptjs');
process.env.NODE_ENV='test';
require.extensions['.ts']=function(mod,file){mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,file);};
const db=require('./src/lib/db.ts').getDb();db.prepare("UPDATE employees SET status='离职'").run();
for(const [name,role]of [['customer','client'],['admin','admin'],['employee','employee']]){
 const id=db.prepare('INSERT INTO employees(name,email,role,password,must_change_password) VALUES (?,?,?,?,0)').run('测试 '+name,name+'@example.test',role,bcrypt.hashSync(process.env.PREVIEW_PASSWORD,10)).lastInsertRowid;
 db.prepare("INSERT INTO client_scope_settings(employee_id,mode) VALUES (?,'explicit')").run(id);
}
db.prepare("INSERT INTO commerce_products(id,sku,name,price_cents,active) VALUES ('preview-registration','COM-001','测试公司注册（不含 VAT）',12345,1)").run();
db.prepare("INSERT INTO commerce_products(id,sku,name,price_cents,active) VALUES ('preview-trademark','TRA-006','测试泰国商标（1大类5小项）',34567,1)").run();db.close();console.log('Synthetic fixture ready');
`;
const seeded=spawnSync(process.execPath,['-e',seed],{cwd:dir,env,encoding:'utf8'});
if(seeded.status!==0){process.stderr.write(seeded.stdout+seeded.stderr);process.exit(seeded.status||1);}
const manifest={root:dir,database:env.DB_PATH,source:root,accounts:['customer@example.test','admin@example.test','employee@example.test'],password,sourceFiles:{}};
function hashes(directory,relative=''){for(const e of fs.readdirSync(directory,{withFileTypes:true})){if(e.name==='node_modules')continue;const abs=path.join(directory,e.name),rel=path.join(relative,e.name);if(e.isDirectory())hashes(abs,rel);else if(e.isFile()&&!rel.startsWith('synthetic.db'))manifest.sourceFiles[rel]=crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');}}
hashes(dir);fs.writeFileSync(path.join(dir,'preview-fixture.json'),JSON.stringify(manifest,null,2),{mode:0o600});
if(catalogSnapshot){
 const imported=spawnSync('python3',[path.join(root,'scripts/import-commerce-preview-catalog.py'),'--preview-root',dir,'--snapshot',catalogSnapshot,'--apply'],{cwd:dir,env,encoding:'utf8'});
 process.stdout.write(imported.stdout||'');process.stderr.write(imported.stderr||'');
 if(imported.error||imported.status!==0){console.error('Catalog import failed; preview not started',imported.error||imported.status);process.exit(imported.status||1);}
 env.COMMERCE_PREVIEW_CATALOG_ENABLED='1';
}
console.log('隔离副本：'+dir+'\n测试数据库：'+env.DB_PATH+'\n账号：'+manifest.accounts.join(' / ')+'\n本次随机测试密码：'+password);
if(process.argv.includes('--prepare-only'))process.exit(0);
// A cold dev watcher may report Ready before every nested route is registered.
// Use the same deterministic build/start path as the full HTTP acceptance suite.
const productionEnv={...env,NODE_ENV:'production'};
console.log('正在构建隔离预览并独立检查类型；完成后显示入口。');
for(const args of [[path.join(dir,'node_modules/next/dist/bin/next'),'build','--webpack'],[path.join(dir,'node_modules/typescript/bin/tsc'),'--noEmit','--incremental','false']]){
 console.log('PREVIEW VERIFY '+JSON.stringify({argv:[process.execPath,...args],cwd:dir}));
 const checked=spawnSync(process.execPath,args,{cwd:dir,env:productionEnv,stdio:'inherit',timeout:180000});
 if(checked.error||checked.status!==0){console.error('隔离预览校验失败，未启动服务',checked.error||checked.status);process.exit(checked.status||1);}
}

const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>{
 console.log('客户入口：http://127.0.0.1:'+port+'/shop\n员工入口：http://127.0.0.1:'+port+'/commerce\n按 Ctrl+C 停止；本地测试数据留在上述副本。');
 const child=spawn(process.execPath,[path.join(dir,'node_modules/next/dist/bin/next'),'start','-H','127.0.0.1','-p',String(port)],{cwd:dir,env:productionEnv,stdio:'inherit'});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
 child.on('exit',code=>{process.exitCode=code||0;});
});});
