#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Local renderer adapter; no downloads or databases. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module'),crypto=require('node:crypto');
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,i,all)=>i%2?pairs:[...pairs,[value,all[i+1]]],[]));
for(const key of ['--customer-root','--internal-root','--dist','--assets'])if(!args[key])throw Error('Missing '+key);
const customer=path.resolve(args['--customer-root']),internal=path.resolve(args['--internal-root']),dist=path.resolve(args['--dist']),assets=path.resolve(args['--assets']);
if(assets===customer||assets===internal||!fs.existsSync(path.join(dist,'index.html')))throw Error('Separate renderer directory and built original customer app required');
const server=path.join(customer,'server');fs.mkdirSync(assets,{recursive:true});
for(const name of ['fonts','templates'])fs.cpSync(path.join(server,name),path.join(assets,name),{recursive:true});
fs.copyFileSync(path.join(server,'logo_base64.txt'),path.join(assets,'logo_base64.txt'));
const modules=path.join(assets,'node_modules');if(!fs.existsSync(modules))fs.symlinkSync(path.join(server,'node_modules'),modules);
const original=fs.readFileSync(path.join(server,'invoice-generator.ts'),'utf8');let source=original.replace("import db from './db'",'');
const start=source.indexOf('  const order = db.prepare'),end=source.indexOf('  let ci: any = {}',start);if(start<0||end<start)throw Error('Original invoice source changed; review adapter before preparing');
source=source.slice(0,start)+'  const { order, invoice, user } = input\n'+source.slice(end);source=source.replace('generateInvoicePdf(orderId: string)','generateInvoicePdf(orderId: string, input: any)');
const ts=createRequire(path.join(internal,'package.json'))('typescript');fs.writeFileSync(path.join(assets,'invoice-renderer.cjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,esModuleInterop:true}}).outputText);
if(args['--catalog-assets']){
 const uploaded=path.join(path.resolve(args['--catalog-assets']),'uploads');
 if(!fs.existsSync(uploaded))throw Error('Catalog image snapshot required');
 fs.cpSync(uploaded,path.join(dist,'uploads'),{recursive:true});
}
console.log(JSON.stringify({prepared:true,originalInvoiceSourceSha256:crypto.createHash('sha256').update(original).digest('hex'),assets,dist,networkOperations:0,databaseOperations:0}));
