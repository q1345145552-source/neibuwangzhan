#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- Node custom server, no network forwarding. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(process.env.INTERNAL_APP_ROOT||process.cwd()),requireApp=createRequire(path.join(root,'package.json'));
const customerDist=path.resolve(process.env.CUSTOMER_DIST||''),port=Number(process.env.CUSTOMER_PORT||56314),internalPort=Number(process.env.INTERNAL_PORT||56315);
if(!process.env.CUSTOMER_DIST||!fs.existsSync(path.join(customerDist,'index.html')))throw Error('Original customer production build required');
if(!Number.isInteger(port)||!Number.isInteger(internalPort)||port===internalPort||Math.min(port,internalPort)<1024||Math.max(port,internalPort)>65535)throw Error('Two distinct unprivileged local ports required');
if(process.env.COMMERCE_CUSTOMER_BRIDGE_ENABLED!=='1')throw Error('Explicit customer compatibility switch required');
const app=requireApp('next')({dev:false,dir:root,hostname:'127.0.0.1',port:internalPort,webpack:true}),handle=app.getRequestHandler();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.pdf':'application/pdf'};
const servers=[];
function sendFile(req,res,file){
 const st=fs.statSync(file);res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':st.size,'Cache-Control':path.basename(file)==='index.html'?'no-store':'public, max-age=0','X-Content-Type-Options':'nosniff'});
 if(req.method==='HEAD')res.end();else fs.createReadStream(file).on('error',()=>res.destroy()).pipe(res);
}
function customer(req,res){
 const url=new URL(req.url,'http://127.0.0.1:'+port);
 if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
  // In-process dispatch into the internal application's route handler; no proxy or second DB.
  req.url='/api/customer-bridge'+url.pathname.slice(4)+url.search;
  return handle(req,res).catch(error=>{console.error(error);if(!res.headersSent)res.writeHead(500);res.end();});
 }
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 try{
  const decoded=decodeURIComponent(url.pathname);const file=path.resolve(customerDist,'.'+decoded);
  if(file!==customerDist&&!file.startsWith(customerDist+path.sep)){res.writeHead(400);res.end();return;}
  if(fs.existsSync(file)&&fs.statSync(file).isFile())return sendFile(req,res,file);
  if(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/uploads/')){res.writeHead(404);res.end();return;}
  return sendFile(req,res,path.join(customerDist,'index.html'));
 }catch{res.writeHead(400);res.end();}
}
function listen(port,listener){return new Promise((resolve,reject)=>{const server=http.createServer(listener);servers.push(server);server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});}
(async()=>{
 await app.prepare();
 try{await listen(internalPort,(req,res)=>handle(req,res));await listen(port,customer);}
 catch(error){for(const server of servers)server.close();await app.close();throw error;}
 console.log(JSON.stringify({ready:true,pid:process.pid,customer:'http://127.0.0.1:'+port+'/login',internal:'http://127.0.0.1:'+internalPort+'/login',oneProcess:true,oneDatabase:process.env.DB_PATH,unchangedCustomerBuild:customerDist}));
})().catch(error=>{console.error(error);process.exit(1);});
let closing=false;async function stop(){if(closing)return;closing=true;for(const server of servers)server.close();await app.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
