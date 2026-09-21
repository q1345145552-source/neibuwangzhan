import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root=process.env.INTERNAL_SOURCE_ROOT||process.cwd();
const {readPendingCommerceRequest,reservePendingCommerceRequest,settlePendingCommerceRequest}=await import(pathToFileURL(path.join(root,'src/lib/commerce-pending-request.ts')).href);
class MemoryStorage {
  values=new Map<string,string>();writes=0;removals=0;fail:''|'get'|'set'|'remove'='';
  getItem(key:string){if(this.fail==='get')throw new Error('read unavailable');return this.values.get(key)??null;}
  setItem(key:string,value:string){if(this.fail==='set')throw new Error('quota unavailable');this.writes++;this.values.set(key,value);}
  removeItem(key:string){if(this.fail==='remove')throw new Error('remove unavailable');this.removals++;this.values.delete(key);}
}
const results:{name:string;passed:boolean;error?:string}[]=[];
function check(name:string,test:()=>void){try{test();results.push({name,passed:true});console.log('PASS '+name);}catch(e){results.push({name,passed:false,error:String(e)});console.error('FAIL '+name,e);}}
const a={request_id:'operation-a',revision:0,reason:'first',credits:[{order_id:'order-1',credit_cents:100}]};
const b={request_id:'operation-b',revision:1,reason:'next',credits:[{order_id:'order-1',credit_cents:200}]};
check('reserve persists complete request before transport and restores exact serialized input',()=>{const s=new MemoryStorage(),lease=reservePendingCommerceRequest(s,'key',a);assert.deepEqual(lease.request,a);assert.equal(lease.serialized,JSON.stringify(a));assert.deepEqual(readPendingCommerceRequest(s,'key'),lease);assert.equal(s.writes,1);});
check('old completion cannot clear a newer pending request',()=>{const s=new MemoryStorage(),old=reservePendingCommerceRequest(s,'key',a);assert(settlePendingCommerceRequest(s,'key',old));const next=reservePendingCommerceRequest(s,'key',b);assert.equal(settlePendingCommerceRequest(s,'key',old),false);assert.deepEqual(readPendingCommerceRequest(s,'key'),next);assert.equal(s.removals,1);});
check('stale retry adopts already saved newer complete input without overwriting it',()=>{const s=new MemoryStorage();reservePendingCommerceRequest(s,'key',b);const lease=reservePendingCommerceRequest(s,'key',a);assert.deepEqual(lease.request,b);assert.equal(s.writes,1);});
check('matching completion clears exactly once; repeated completion is harmless',()=>{const s=new MemoryStorage(),lease=reservePendingCommerceRequest(s,'key',a);assert(settlePendingCommerceRequest(s,'key',lease));assert(settlePendingCommerceRequest(s,'key',lease));assert.equal(s.removals,1);assert.equal(readPendingCommerceRequest(s,'key'),null);});
check('same id with changed payload is not silently replayed or overwritten',()=>{const s=new MemoryStorage();reservePendingCommerceRequest(s,'key',a);assert.throws(()=>reservePendingCommerceRequest(s,'key',{...a,reason:'different'}));assert.equal(s.writes,1);assert.deepEqual(readPendingCommerceRequest(s,'key')!.request,a);});
check('late cleanup compares complete saved input, not only its request id',()=>{const s=new MemoryStorage(),lease=reservePendingCommerceRequest(s,'key',a);s.values.set('key',JSON.stringify({...a,reason:'externally changed'}));assert.equal(settlePendingCommerceRequest(s,'key',lease),false);assert.equal(s.removals,0);});
check('malformed, null, array and missing-id records remain untouched and block reserve',()=>{for(const raw of ['{bad','null','[]','{}','{"request_id":""}']){const s=new MemoryStorage();s.values.set('key',raw);assert.throws(()=>readPendingCommerceRequest(s,'key'));assert.throws(()=>reservePendingCommerceRequest(s,'key',a));assert.equal(s.values.get('key'),raw);assert.equal(s.writes,0);assert.equal(s.removals,0);}});
check('account and action slots stay isolated',()=>{const s=new MemoryStorage(),lease=reservePendingCommerceRequest(s,'account-a-credit',a);reservePendingCommerceRequest(s,'account-b-credit',b);reservePendingCommerceRequest(s,'account-a-refund',b);assert(settlePendingCommerceRequest(s,'account-a-credit',lease));assert.deepEqual(readPendingCommerceRequest(s,'account-b-credit')!.request,b);assert.deepEqual(readPendingCommerceRequest(s,'account-a-refund')!.request,b);});
check('read, persistence and cleanup failures never manufacture a replacement operation',()=>{for(const failure of ['get','set','remove'] as const){const s=new MemoryStorage();if(failure==='remove'){const lease=reservePendingCommerceRequest(s,'key',a);s.fail=failure;assert.throws(()=>settlePendingCommerceRequest(s,'key',lease));assert.equal(s.values.get('key'),JSON.stringify(a));}else{s.fail=failure;assert.throws(()=>reservePendingCommerceRequest(s,'key',a));assert.equal(s.writes,0);}}});
check('existing serialized payload is reused verbatim rather than reformatted',()=>{const s=new MemoryStorage();s.values.set('key',JSON.stringify(a,null,2));const lease=reservePendingCommerceRequest(s,'key',a);assert.equal(lease.serialized,JSON.stringify(a,null,2));assert(settlePendingCommerceRequest(s,'key',lease));});
const output=process.env.MERGE_EVIDENCE;if(output){fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'commerce-pending-results.json'),JSON.stringify({root,results},null,2));}
console.log(`SUMMARY ${results.filter(x=>x.passed).length}/${results.length} pending request groups`);if(results.some(x=>!x.passed))process.exitCode=1;
