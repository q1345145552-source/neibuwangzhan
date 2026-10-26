import type { Reader, Row, Source } from './types';
import { classifyOrders, text, unique } from './aggregate';
import { QUERIES } from './queries';
import { utcMillis } from './time';
import { currentOpenSteps, STEP_STATUSES } from '../step-status';
export const DELIVERY_QUERIES = {
 orders: 'SELECT id, business_type_id, sub_service_type, status, phase, responsible_person, source_system, created_at FROM orders',
 business: 'SELECT id, name FROM business_types',
 steps: 'SELECT id, order_id, step_name, step_order, status, assignee FROM order_steps ORDER BY order_id, step_order, id',
 requirements: 'SELECT id, step_id, order_id, document_name, status FROM step_documents',
 requests: 'SELECT id, internal_order_id, name, submitted_at FROM sync_document_requests',
 documents: 'SELECT id, order_id, name, status, direction FROM documents',
 submissions: 'SELECT id, requirement_id, internal_order_id, document_id, submission_id, withdrawn FROM sync_documents',
} as const;
export const MATERIALS = ['step_pending','unsubmitted','returned','review','file_returned','file_review','unknown'] as const;
export type Material = typeof MATERIALS[number];
export type Fact = { id: string; kind: string; name: string; status: string; category: Material | 'satisfied'; documentId?: string; submissionId?: string };
export type DeliveryRow = { id: string; business: string; source: Source | 'unknown'; status: string; phase: string; owner: string; createdAt: string; href: string; steps: {id:string;name:string;status:string;assignee:string;current:boolean}[] | null; facts: Fact[] | null; requirementCount: number | null; counts: Record<Material,number> | null; warnings:string[] };
export type DeliveryOptions = { source:string; status:string; owner:string; ownerUnassigned:boolean; search:string; material:string; from:string; to:string; start:number|null; end:number|null; page:number; pageSize:number };
export function parseDelivery(url:URL):DeliveryOptions {
 const p=url.searchParams;const keys=['source','status','owner','ownerUnassigned','search','material','from','to','page','pageSize'];
 for(const k of p.keys()) if(!keys.includes(k)||p.getAll(k).length!==1) throw Error('QUERY');
 const source=p.get('source')||'all', status=p.get('status')||'pool',material=p.get('material')||'all';
 if(!['all','local','commerce','saved_source','conflict'].includes(source)||!['pool','all','待处理','进行中','已完成','客户取消','unknown'].includes(status)||!['all',...MATERIALS].includes(material)) throw Error('QUERY');
 const owner=p.get('owner')||'',search=p.get('search')||'',from=p.get('from')||'',to=p.get('to')||'';
 const ownerUnassigned=p.get('ownerUnassigned')==='1';if(p.has('ownerUnassigned')&&(!ownerUnassigned||owner))throw Error('QUERY');
 if(owner.length>200||search.length>200||Boolean(from)!==Boolean(to))throw Error('QUERY');
 const day=(s:string)=> {if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('QUERY');const t=Date.parse(s+'T00:00:00+07:00');if(!Number.isFinite(t)||new Date(t+7*3600000).toISOString().slice(0,10)!==s)throw Error('QUERY');return t;};
 const start=from?day(from):null,end=to?day(to):null;
 if(start!==null&&end!==null&&(end<=start||end-start>366*86400000))throw Error('QUERY');
 const integer=(k:string,d:number,max:number)=>{const v=p.get(k)||String(d);if(!/^[1-9]\d*$/.test(v)||Number(v)>max)throw Error('QUERY');return Number(v);};
 return {source,status,material,owner,ownerUnassigned,search,from,to,start,end,page:integer('page',1,1000000),pageSize:integer('pageSize',20,100)};
}
export function delivery(reader:Reader,o:DeliveryOptions) {
 const failed:string[]=[],gaps:{code:string;count:number}[]=[];
 const read=(key:string,sql:string):Row[]|null=>{try{const u=unique(reader.all(sql),'id');if(u.conflicts)gaps.push({code:key,count:u.conflicts});return u.rows;}catch{failed.push(key);return null;}};
 const raw=read('orders',DELIVERY_QUERIES.orders);
 const base={generatedAt:new Date().toISOString(),selection:o,scope:'staff-all-orders',failed,gaps};
 if(!raw)return {...base,status:'failed',items:[],total:null,summary:null,owners:[]};
 const business=read('business',DELIVERY_QUERIES.business),steps=read('steps',DELIVERY_QUERIES.steps),requirements=read('requirements',DELIVERY_QUERIES.requirements),requests=read('requests',DELIVERY_QUERIES.requests),documents=read('documents',DELIVERY_QUERIES.documents),submissions=read('submissions',DELIVERY_QUERIES.submissions);
 // Source graph uses the confirmed overview classifier, not source labels alone.
 const graphKeys=['sales','lines','fulfillments','inbox','parents'] as const;
 const graph=Object.fromEntries(graphKeys.map(k=>{try{return[k,reader.all(QUERIES[k])];}catch{failed.push(k);return[k,null];}}));
 const sourceKnown=graphKeys.every(k=>graph[k]!==null);
 const classified:{rows:Row[];gaps:{code:string;count:number}[]}=sourceKnown?classifyOrders(raw,graph.fulfillments!,graph.inbox!,graph.parents!,graph.lines!,graph.sales!):{rows:raw.map(r=>({...r,source:'unknown',href:'/orders/'+encodeURIComponent(text(r.id))})),gaps:[]};
 gaps.push(...classified.gaps);
 const rows:DeliveryRow[]=classified.rows.map(r=>{
 const id=text(r.id),warnings:string[]=[];
 const ss=steps?.filter(s=>s.order_id===id).sort((a,b)=>Number(a.step_order)-Number(b.step_order)||Number(a.id)-Number(b.id))??null;
 const stepValid=ss!==null&&ss.every(s=>typeof s.id==='number'&&typeof s.step_order==='number'&&typeof s.step_name==='string'&&STEP_STATUSES.includes(s.status as typeof STEP_STATUSES[number])&&(s.assignee===null||typeof s.assignee==='string'));
 const flowValid=typeof r.business_type_id==='number'&&(r.sub_service_type===null||typeof r.sub_service_type==='string');
 const current=stepValid&&flowValid?currentOpenSteps(Number(r.business_type_id),text(r.sub_service_type),ss!.map(s=>({...s,status:text(s.status)} as Row & {status:string}))):null;
 if(!stepValid||!flowValid)warnings.push('部分步骤数据无法判断');
 if(ss?.length===0)warnings.push('未记录步骤');
 const localReq=requirements?.filter(x=>x.order_id===id)??null, req=requests?.filter(x=>x.internal_order_id===id)??null;
 const docs=documents?.filter(x=>x.order_id===id)??null,subs=submissions?.filter(x=>x.internal_order_id===id)??null;
 let facts:Fact[]|null=null;
 if(localReq!==null&&req!==null&&docs!==null&&subs!==null){
 facts=[];
 for(const x of localReq){const valid=ss?.some(s=>s.id===x.step_id)&&!x._conflict;facts.push({id:String(x.id),kind:'步骤需求',name:text(x.document_name)||'名称未记录',status:text(x.status)||'状态未记录',category:!valid?'unknown':x.status==='pending'?'step_pending':x.status==='uploaded'?'satisfied':'unknown'});}
 for(const x of req){
 const related=subs.filter(s=>s.requirement_id==='sreq-'+x.id);
 const effective=related.filter(s=>s.withdrawn===0&&docs.some(d=>d.id===s.document_id)).sort((a,b)=>Number(b.id)-Number(a.id));
 const latest=effective[0],doc=latest?docs.find(d=>d.id===latest.document_id):null;
 const broken=related.some(s=>s._conflict||typeof s.withdrawn!=='number'||(s.withdrawn===0&&!docs.some(d=>d.id===s.document_id)));
 if(broken)warnings.push('补件关联存在缺失，仅展示可确认的最新有效资料');
 let category:Fact['category']='unknown';
 if(!x._conflict){if(doc&&!doc._conflict){category=doc.status==='已退回'?'returned':doc.status==='待审核'?'review':doc.status==='已审核'?'satisfied':'unknown';}else if(!broken&&Object.hasOwn(x,'submitted_at')&&!x.submitted_at&&related.length===0)category='unsubmitted';}
 facts.push({id:String(x.id),kind:'补件需求',name:text(x.name)||'名称未记录',status:doc?text(doc.status):category==='unsubmitted'?'未提交':'无法判断有效提交',category,documentId:doc?String(doc.id):undefined,submissionId:latest?text(latest.submission_id):undefined});
 }
 // A linked document is not a second unmet requirement. Withdrawn local copies are not live facts.
 for(const d of docs){const related=subs.filter(s=>s.document_id===d.id);if(related.some(s=>s.withdrawn===1)&&!related.some(s=>s.withdrawn===0))continue;
 const linked=related.some(s=>req.some(x=>s.requirement_id==='sreq-'+x.id));if(linked)continue;
 if(d.direction==='us_to_client')continue;
 if(d.direction!=='client_to_us'){facts.push({id:String(d.id),kind:'方向未记录的文件',name:text(d.name)||'名称未记录',status:text(d.status)||'状态未记录',category:'unknown'});continue;}
 const category=d._conflict?'unknown':d.status==='已退回'?'file_returned':d.status==='待审核'?'file_review':d.status==='已审核'?'satisfied':'unknown';
 facts.push({id:String(d.id),kind:'未关联需求的文件',name:text(d.name)||'名称未记录',status:text(d.status)||'状态未记录',category});}
 facts.sort((a,b)=>a.kind.localeCompare(b.kind,'en')||a.id.localeCompare(b.id,'en',{numeric:true}));
 }
 const counts=facts?Object.fromEntries(MATERIALS.map(k=>[k,facts.filter(f=>f.category===k).length])) as Record<Material,number>:null;
 if(!facts)warnings.push('资料读取失败，数量无法判断');
 if(counts?.unknown)warnings.push('部分资料无法判断：'+counts.unknown+'条');
 if(r.source==='conflict'||!sourceKnown)warnings.push(r.source==='conflict'?'来源关系冲突，仍只计一份':'来源读取失败，无法判断');
 if(r._conflict)warnings.push('办理份记录冲突');
 if(utcMillis(r.created_at)===null)warnings.push('内部创建日期无法判断');
 if(r.responsible_person!==null&&typeof r.responsible_person!=='string')warnings.push('负责人字段缺失');
 return {id,business:text(business?.find(b=>b.id===r.business_type_id)?.name)||'业务名称未记录',source:r.source as DeliveryRow['source'],status:text(r.status)||'unknown',phase:text(r.phase),owner:text(r.responsible_person),createdAt:text(r.created_at),href:'/orders/'+encodeURIComponent(id),steps:current?ss!.map(s=>({id:String(s.id),name:text(s.step_name),status:text(s.status),assignee:text(s.assignee),current:current.some(c=>c.id===s.id)})):null,facts,counts,requirementCount:localReq&&req?localReq.length+req.length:null,warnings};
 });
 const owners=[...new Set(rows.map(r=>r.owner))].sort();
 const selected=rows.filter(r=>{
 if(o.status==='pool'&&['已完成','客户取消'].includes(r.status))return false;
 if(!['pool','all'].includes(o.status)&&r.status!==o.status)return false;
 if(o.source!=='all'&&r.source!==o.source)return false;
 if(o.ownerUnassigned&&r.owner!=='')return false;
 if(o.owner&&r.owner!==o.owner)return false;
 if(o.search&&r.id!==o.search)return false;
 if(o.start!==null){const t=utcMillis(r.createdAt);if(t===null||t<o.start||t>=o.end!)return false;}
 if(o.material!=='all'&&(o.material==='unknown'?!(r.counts===null||r.counts.unknown>0):!(r.counts&&r.counts[o.material as Material]>0)))return false;
 return true;
 }).sort((a,b)=>a.id.localeCompare(b.id,'en',{numeric:true}));
 const summary={orders:selected.length,states: {} as Record<string,number>,materials:Object.fromEntries(MATERIALS.map(k=>[k,{items:0,orders:0}])) as Record<Material,{items:number;orders:number}>,materialUnknownOrders:0,stepsUnrecordedOrders:selected.filter(r=>r.steps?.length===0).length,materialUnknownFacts:selected.reduce((n,r)=>n+(r.counts?.unknown||0),0),dateUnknownOrders:rows.filter(r=>utcMillis(r.createdAt)===null).length,sourceUnknownOrders:rows.filter(r=>r.source==='unknown').length};
 for(const r of selected){summary.states[r.status]=(summary.states[r.status]||0)+1;if(!r.counts){summary.materialUnknownOrders++;summary.materials.unknown.orders++;continue;}for(const k of MATERIALS){summary.materials[k].items+=r.counts[k];if(r.counts[k])summary.materials[k].orders++;}}
 return {...base,status:failed.length||gaps.length||selected.some(r=>r.warnings.length)?'unknown':'success',total:selected.length,items:selected.slice((o.page-1)*o.pageSize,o.page*o.pageSize),summary,owners};
}
export type DeliverySnapshot=ReturnType<typeof delivery> & {viewerRole:'admin'|'employee'};
