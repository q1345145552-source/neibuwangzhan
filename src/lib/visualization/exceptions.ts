import { createHash } from 'node:crypto';
import type { Reader, Row } from './types';
import { classifyOrders, incomeReviewState, text, unique, validAmount } from './aggregate';
import { QUERIES } from './queries';
import { delivery, parseDelivery } from './delivery';
import { utcMillis } from './time';
import { bossPendingSubmissions } from '../boss-submissions';
import { EXCEPTION_CATEGORIES, type ExceptionCategory, type ExceptionGroup, type ExceptionItem, type ExceptionOptions, type OrderRef } from './exception-types';

export const EXCEPTION_QUERIES = {
  progress:'SELECT id, inbox_id, status, attempts, next_attempt_at, last_error, created_at, sent_at FROM sync_progress_outbox',
  documentsOutbox:'SELECT id, submission_id, payload, status, attempts, next_attempt_at, last_error, created_at, sent_at FROM sync_document_outbox',
  submissions:'SELECT id, submission_id, source_order_no, internal_order_id, document_id, withdrawn FROM sync_documents',
  requests:'SELECT id, source_order_no, internal_order_id, created_at FROM sync_document_requests',
  cancels:'SELECT id, source_order_no, internal_order_id, line_no, copy_no, status, created_at FROM sync_cancel_requests',
  documents:'SELECT id, order_id FROM documents',
  certificates:'SELECT id, order_id FROM certificates',
} as const;
export type ExceptionModule={id:string;group:ExceptionGroup;label:string;status:'success'|'unknown'|'failed';message:string};
const identifier=(v:unknown):string|null=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
// Existing local order IDs are opaque TEXT keys; do not impose payload's external-ID format.
const orderKey=(v:unknown):string|null=>typeof v==='string'&&v.length>0?v:null;
const opaque=(v:unknown)=>identifier(v)||'不可识别-'+createHash('sha256').update(String(v)).digest('hex').slice(0,12);
const date=(v:unknown)=>{const t=utcMillis(v);return t===null?null:new Date(t).toISOString();};
/** Never return/substitute raw errors, even when they contain an URL, token or customer data. */
export function safeFailureCategory(value:unknown):string {
  if(typeof value!=='string'||!value.trim())return '未记录失败类别';
  if(/timeout|timed out|AbortError/i.test(value))return '请求超时或中止';
  if(/ECONNREFUSED|ENOTFOUND|ECONNRESET|fetch failed/i.test(value))return '连接或解析异常';
  if(/HTTP [45]\d\d\b/.test(value))return 'HTTP响应异常';
  if(/客户站未确认/.test(value))return '本地未取得匹配回执';
  return '其他发送失败（原文已隐藏）';
}
export function exceptions(reader:Reader,o:ExceptionOptions,now:Date=new Date()) {
  const cache=new Map<string,Row[]|null>();
  const cached:Reader={all(sql,...args){const key=JSON.stringify([sql,args]);if(!cache.has(key)){try{cache.set(key,reader.all(sql,...args));}catch{cache.set(key,null);}}const rows=cache.get(key);if(rows===null)throw Error('READ_FAILED');return rows!;},get(sql,...args){return this.all(sql,...args)[0];}};
  const modules:ExceptionModule[]=[],items:ExceptionItem[]=[];
  const addModule=(id:string,group:ExceptionGroup,label:string,status:ExceptionModule['status'],message='')=>modules.push({id,group,label,status,message});
  const read=(sql:string):Row[]|null=>{try{return cached.all(sql);}catch{return null;}};
  const rawOrders=read(QUERIES.orders),inbox=read(QUERIES.inbox),sales=read(QUERIES.sales),lines=read(QUERIES.lines),fulfillments=read(QUERIES.fulfillments),parents=read(QUERIES.parents);
  const orders=rawOrders?unique(rawOrders,'id').rows:null;
  const graphKnown=!!orders&&!!inbox&&!!sales&&!!lines&&!!fulfillments&&!!parents;
  const classified:Row[]=graphKnown?classifyOrders(orders!,fulfillments!,inbox!,parents!,lines!,sales!).rows:orders?.map(r=>({...r,source:'unknown'}))||[];
  const orderMap=new Map<string,OrderRef>(classified.filter(r=>orderKey(r.id)).map(r=>[String(r.id),{id:String(r.id),source:r.source as OrderRef['source'],status:text(r.status)||'unknown',href:'/orders/'+encodeURIComponent(String(r.id))}]));
  const refs=(ids:unknown[])=>[...new Set(ids.map(orderKey).filter((v):v is string=>!!v))].map(id=>orderMap.get(id)).filter((r):r is OrderRef=>!!r).sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const base=(key:string,recordId:unknown,group:ExceptionGroup,category:ExceptionCategory,unit:ExceptionItem['unit'],title:string,orderIds:unknown[],when:unknown,dateLabel:string):ExceptionItem=>({key,recordId:opaque(recordId),group,category,unit,title,state:EXCEPTION_CATEGORIES[category],channel:null,orders:refs(orderIds),matchedOrders:[],link:null,reason:null,notes:[],date:date(when),dateLabel,closedMaterial:false,orderApplicable:true});
  const submissions=read(EXCEPTION_QUERIES.submissions),requests=read(EXCEPTION_QUERIES.requests),cancels=read(EXCEPTION_QUERIES.cancels),docs=read(EXCEPTION_QUERIES.documents),certificates=read(EXCEPTION_QUERIES.certificates);

  function mapDocumentEvent(row:Row):{ids:unknown[];kind:string;reason:string|null} {
    const bad=(reason:string)=>({ids:[],kind:'事件类型无法判断',reason});
    if(typeof row.payload!=='string'||row.payload.length>1000000)return bad('本地事件内容无法解析');
    let p:Record<string,unknown>;
    try{const value=JSON.parse(row.payload);if(!value||typeof value!=='object'||Array.isArray(value))return bad('本地事件内容格式无效');p=value;}catch{return bad('本地事件内容无法解析');}
    const source=identifier(p.source_order_no),key=identifier(row.submission_id);
    if(!key)return bad('事件对象编号无法判断');
    if(Object.hasOwn(p,'source_order_no')&&!source)return bad('来源编号类型或格式无法判断');
    const event=p.event===undefined?'review':p.event;
    if(event==='review'){
      if(identifier(p.submission_id)!==key)return bad('资料提交编号不一致');
      if(!submissions||!docs||!orders)return bad('本地资料映射读取失败');
      const linked=submissions.filter(s=>s.submission_id===key);
      if(!linked.length)return bad('未找到本地资料副本关系');
      const sourceSet=new Set(linked.map(s=>identifier(s.source_order_no)));
      if(sourceSet.size!==1||sourceSet.has(null)||(source&&!sourceSet.has(source)))return bad('本地资料来源关系冲突');
      if(linked.some(s=>!orderMap.has(String(s.internal_order_id))||!docs.some(d=>d.id===s.document_id&&d.order_id===s.internal_order_id)))return bad('本地资料副本目标缺失或不一致');
      return {ids:linked.map(s=>s.internal_order_id),kind:'资料审核结果',reason:null};
    }
    if(event==='request'||event==='cancel'){
      if(!source||identifier(p.request_id)!==key)return bad('申请编号或来源无法核对');
      const table=event==='request'?requests:cancels;
      if(!table||!orders)return bad('本地申请映射读取失败');
      const matches=table.filter(r=>r.id===key&&r.source_order_no===source);
      if(matches.length!==1||!orderMap.has(String(matches[0].internal_order_id)))return bad('申请对应办理份缺失或关系不唯一');
      if(event==='cancel'&&(!Number.isSafeInteger(p.line_no)||Number(p.line_no)<=0||!Number.isSafeInteger(p.copy_no)||Number(p.copy_no)<=0||p.line_no!==matches[0].line_no||p.copy_no!==matches[0].copy_no))return bad('取消申请份序无法核对');
      return {ids:[matches[0].internal_order_id],kind:event==='request'?'补件要求':'取消申请结果',reason:null};
    }
    if(event==='delivery'){
      if(!source||identifier(p.delivery_id)!==key)return bad('交付编号或来源无法核对');
      const m=/^(doc|cert)-([1-9]\d*)$/.exec(key);if(!m||!Number.isSafeInteger(Number(m[2])))return bad('交付目标编号无法识别');
      const table=m[1]==='doc'?docs:certificates;if(!table||!orders||!inbox)return bad('本地交付映射读取失败');
      const matches=table.filter(r=>r.id===Number(m[2]));
      if(matches.length!==1||!orderMap.has(String(matches[0].order_id)))return bad('本地交付目标缺失或不唯一');
      const target=matches[0].order_id;
      if(!inbox.some(i=>i.internal_order_id===target&&i.source_order_no===source))return bad('交付目标来源未能核对');
      return {ids:[target],kind:'交付文件或撤回结果',reason:null};
    }
    return bad('本地事件类型无法识别');
  }
  const channelInfo:Record<string,{state:ExceptionModule['status'];lastSentAt:string|null;lastSentState:'known'|'unrecorded'|'unknown'|'failed';invalidSentTimes:number}>={};
  for(const channel of ['progress','documents'] as const){
    const rows=read(channel==='progress'?EXCEPTION_QUERIES.progress:EXCEPTION_QUERIES.documentsOutbox);
    if(!rows){addModule('outbox_'+channel,'outbox',channel==='progress'?'进度出站':'资料出站','failed','队列读取失败，不显示伪0');channelInfo[channel]={state:'failed',lastSentAt:null,lastSentState:'failed',invalidSentTimes:0};continue;}
    let unknown=unique(rows,'id').conflicts,invalidSentTimes=0;const acknowledgements:string[]=[];
    for(const row of unique(rows,'id').rows){
      const status=row.status,attempts=row.attempts;
      const validState=(status==='pending'||status==='sent')&&typeof attempts==='number'&&Number.isSafeInteger(attempts)&&attempts>=0&&!row._conflict;
      if(status==='sent'){const acknowledged=date(row.sent_at);if(acknowledged)acknowledgements.push(acknowledged);else invalidSentTimes++;}
      if(validState&&status==='sent'&&date(row.sent_at))continue;
      const category:ExceptionCategory=!validState||status==='sent'?'outbox_unknown':attempts===0?'outbox_waiting':'outbox_retry';
      const item=base('outbox:'+channel+':'+opaque(row.id),row.id,'outbox',category,'事件',channel==='progress'?'办理进度出站事件':'资料通道出站事件',[],row.created_at,'出站事件创建时间');item.channel=channel;
      item.attempts=typeof attempts==='number'&&Number.isSafeInteger(attempts)&&attempts>=0?attempts:null;
      item.atExistingThreshold=validState&&status==='pending'&&Number(attempts)>=6; // Existing ALERT_ATTEMPTS=6; never triggers notifications.
      item.nextAttemptAt=date(row.next_attempt_at);item.failureCategory=safeFailureCategory(row.last_error);
      if(!validState)item.notes.push('队列状态或尝试次数无法判断');
      if(status==='sent')item.notes.push('原记录为已发送，回执时间无法判断，不当当前失败');
      if(!item.date)item.notes.push('事件创建时间缺失或无效');
      if(row.next_attempt_at!==null&&row.next_attempt_at!==''&&!item.nextAttemptAt)item.notes.push('下次尝试时间缺失或无效');
      if(channel==='progress'){
        const links=inbox?.filter(i=>i.id===row.inbox_id)||[];
        if(!inbox||!orders)item.reason='本地进度映射读取失败';
        else if(links.length!==1||!orderMap.has(String(links[0].internal_order_id)))item.reason='进度事件尚未找到唯一有效办理份关系';
        else item.orders=refs([links[0].internal_order_id]);
        item.kind='办理进度';
      }else{const mapped=mapDocumentEvent(row);item.orders=refs(mapped.ids);item.reason=mapped.reason;item.kind=mapped.kind;}
      if(!item.orders.length&&!item.reason)item.reason='未关联有效内部办理份';
      if(category==='outbox_unknown'||item.notes.length||item.reason)unknown++;
      items.push(item);
    }
    acknowledgements.sort();channelInfo[channel]={state:unknown||invalidSentTimes?'unknown':'success',lastSentAt:acknowledgements.at(-1)||null,lastSentState:invalidSentTimes?'unknown':acknowledgements.length?'known':'unrecorded',invalidSentTimes};
    addModule('outbox_'+channel,'outbox',channel==='progress'?'进度出站':'资料出站',unknown||invalidSentTimes?'unknown':'success',unknown||invalidSentTimes?'部分事件或回执信息无法判断；只展示已证本地事实':'');
  }

  try{
    const d=delivery(cached,parseDelivery(new URL('http://local/visualization/delivery?status=all')),now,true);
    if(d.status==='failed')throw Error('FAILED');
    let uncertain=d.status==='unknown';
    for(const row of d.items){
      const closed=['已完成','客户取消'].includes(row.status);
      if(!row.facts||row.steps===null)uncertain=true;
      for(const fact of row.facts||[]){
        if(fact.category==='satisfied')continue;
        const category:ExceptionCategory=fact.category==='unknown'?'material_unknown':fact.category;
        const unit=fact.kind.includes('文件')?'文件':'需求项';
        const item=base('material:'+row.id+':'+fact.kind+':'+fact.id,fact.id,'materials',category,unit,fact.name,[row.id],row.createdAt,'办理份内部创建时间');
        item.closedMaterial=closed;item.notes.push(fact.kind+' #'+fact.id+' · '+fact.status);item.link=row.href;if(fact.documentId)item.notes.push('对应文档 #'+fact.documentId);if(closed)item.notes.push('关闭订单的不一致或历史事实，不计当前催办');items.push(item);
      }
      for(const step of row.steps?.filter(s=>s.status==='阻塞')||[]){const item=base('blocked:'+row.id+':'+step.id,step.id,'materials','blocked','步骤',step.name,[row.id],row.createdAt,'办理份内部创建时间');item.closedMaterial=closed;item.link=row.href;item.notes.push('步骤 #'+step.id+' · 经办人：'+(step.assignee||'未分配'));if(closed)item.notes.push('关闭订单仍有阻塞，不计当前催办');items.push(item);}
    }
    addModule('materials','materials','资料与阻塞',uncertain?'unknown':'success',uncertain?'交付读取含无法判断项（可能包括时间依赖）；缺口不当0、不当违规':'' );
  }catch{addModule('materials','materials','资料与阻塞','failed','交付事实读取失败');}

  const financeRaw=read(QUERIES.finances),financeRows=financeRaw?unique(financeRaw,'id').rows:null;
  if(!financeRows||!orders)addModule('finance','finance','财务待核对','failed','财务记录或订单范围读取失败');
  else{
    let unknown=financeRaw?unique(financeRaw,'id').conflicts:0;
    for(const r of financeRows){const kind=incomeReviewState(r);if(!kind)continue;if(!orderMap.has(String(r.order_id))){unknown++;continue;}
      const item=base('finance:'+opaque(r.id),r.id,'finance',kind==='waiting'?'finance_waiting':'finance_not_arrived','财务记录','内部收入记录 #'+opaque(r.id),[r.order_id],r.created_at,'财务记录创建时间');
      item.currency=r.currency==='CNY'||r.currency==='THB'?r.currency:'unknown';item.amountCents=validAmount(r.amount)?Math.round(r.amount*100):null;
      if(item.currency==='unknown')item.notes.push('币种未记录或无法识别');if(item.amountCents===null)item.notes.push('金额无效，未补入金额小计');if(!item.orders.length)item.reason=orders?'所属办理份缺失或未关联':'订单关系读取失败';
      if(!item.date)item.notes.push('记录创建时间缺失或无效');if(item.notes.length||item.reason)unknown++;items.push(item);
    }
    addModule('finance','finance','财务待核对',unknown?'unknown':'success',unknown?'金额、币种或所属关系部分无法判断；断链财务仅列数据待核对，不补入订单范围小计':'未核对不当欠款，未到账不当逾期；取消订单现存记录仍保留');
  }

  function dataItem(key:string,id:unknown,category:'data_inconsistent'|'data_historical'|'data_unknown',title:string,orderIds:unknown[],when:unknown,notes:string[]){const item=base('data:'+key,id,'data',category,'核对项',title,orderIds,when,'对应对象内部创建时间');item.notes=notes;item.reason=item.orders.length?null:'没有可靠内部订单目标，不构造链接';items.push(item);}
  let dataUnavailable=false;
  if(!orders||!financeRows||!inbox||!sales||!lines||!fulfillments||!parents||!submissions||!docs)dataUnavailable=true;
  for(const r of orders||[])if(!date(r.created_at)||r._conflict)dataItem('order:'+opaque(r.id),r.id,'data_unknown','办理份日期或记录完整性待核对',[r.id],r.created_at,[!date(r.created_at)?'内部创建日期缺失或无效':'相同编号记录内容冲突']);
  for(const r of financeRows||[]){const notes=[];if(!date(r.created_at))notes.push('财务记录创建日期缺失或无效');if(r.currency!=='CNY'&&r.currency!=='THB')notes.push('币种未记录或无法识别');if(!validAmount(r.amount))notes.push('金额不符合原金额规则');if(orders&&!orderMap.has(String(r.order_id)))notes.push('记录所属办理份不存在');if(notes.length)dataItem('finance:'+opaque(r.id),r.id,orders&&!orderMap.has(String(r.order_id))?'data_inconsistent':'data_unknown','财务记录数据待核对',[r.order_id],r.created_at,notes);}
  for(const [table,label] of [[sales,'商城父交易'],[parents,'已保存来源父交易']] as const)for(const r of table||[])if(!date(r.created_at)||!['CNY','THB'].includes(text(r.currency)))dataItem('parent:'+label+':'+opaque(r.id||r.source_order_no),r.id||r.source_order_no,'data_unknown',label+'日期或币种待核对',[],r.created_at,['父记录日期或币种缺失/无法判断，不构造父详情地址']);
  if(graphKnown){
    for(const r of classified)if(r.source==='conflict')dataItem('source:'+opaque(r.id),r.id,'data_inconsistent','同一办理份存在冲突父关系',[r.id],r.created_at,['保留原关系，不自动认领或修复']);
    for(const r of inbox!){if(orderKey(r.internal_order_id)&&!orderMap.has(String(r.internal_order_id)))dataItem('inbox_target:'+opaque(r.id),r.id,'data_inconsistent','来源映射目标办理份不存在',[],null,['来源记录对应内部目标不存在']);
      else if(orderKey(r.internal_order_id)&&!parents!.some(p=>p.source_order_no===r.source_order_no))dataItem('inbox_parent:'+opaque(r.id),r.id,'data_historical','历史来源映射缺父快照',[r.internal_order_id],orders!.find(o=>o.id===r.internal_order_id)?.created_at,['可能为历史已知欠缺，不声称新故障或历史发生量']);}
    for(const r of fulfillments!){const line=lines!.find(l=>l.id===r.line_id);if(!orderMap.has(String(r.order_id))||!line||!sales!.some(s=>s.id===line.sale_id))dataItem('fulfillment:'+createHash('sha256').update(JSON.stringify([r.line_id,r.order_id,r.copy_no])).digest('hex').slice(0,16),r.order_id,'data_inconsistent','商城办理关系目标缺失',[r.order_id],null,['办理份、明细或父交易目标缺失；不自动补关系']);}
  }
  if(submissions&&docs&&orders){
    for(const submission of new Set(submissions.map(s=>text(s.submission_id)).filter(Boolean))){const linked=submissions.filter(s=>s.submission_id===submission);const sourceIds=new Set(linked.map(s=>identifier(s.source_order_no)).filter(Boolean));if(sourceIds.size>1)dataItem('submission_source:'+opaque(submission),submission,'data_inconsistent','同一资料提交存在冲突来源关系',linked.map(s=>s.internal_order_id),null,['保留全部本地副本关系，不自动认领来源']);}
    for(const s of submissions){if(!orderMap.has(String(s.internal_order_id))||!docs.some(d=>d.id===s.document_id&&d.order_id===s.internal_order_id))dataItem('submission:'+opaque(s.id),s.id,s.withdrawn===1?'data_historical':'data_inconsistent','本地资料副本关系待核对',[s.internal_order_id],orders.find(o=>o.id===s.internal_order_id)?.created_at,[s.withdrawn===1?'撤回后的历史副本目标不完整，不当当前违规':'有效资料副本目标缺失或不一致']);}
  }
  const allDataFailed=[orders,financeRows,inbox,sales,lines,fulfillments,parents,submissions,docs].every(value=>value===null);
  addModule('data','data','数据待核对',allDataFailed?'failed':dataUnavailable?'unknown':'success',allDataFailed?'对象读取失败，无法判断核对项数量':dataUnavailable?'部分对象读取失败，已知核对项不是完整清单':'仅记录可证不一致或完整性缺口；不统计违规率');

  try{
    const facade={prepare:(sql:string)=>{
      // Original read semantics, minimum necessary projection instead of report/reflection SELECT *.
      const safeSql=sql.startsWith('SELECT r.*,r.report_date')?sql.replace('r.*','r.id,r.employee_name,r.report_date,r.submitted_at,r.created_at,r.boss_rating,r.boss_comment'):sql.startsWith('SELECT r.*,m.title')?sql.replace('r.*','r.id,r.employee_name,r.created_at,r.updated_at,r.content,r.images'):sql;
      return {all:(...args:unknown[])=>cached.all(safeSql,...args),get:(...args:unknown[])=>cached.get(safeSql,...args)};
    }};
    const pending=bossPendingSubmissions(facade as unknown as Parameters<typeof bossPendingSubmissions>[0]);
    for(const r of pending.items){const category=('manual_'+r.category) as ExceptionCategory;if(!(category in EXCEPTION_CATEGORIES))continue;const item=base('manual:'+r.id,r.source_id,'manual',category,'事项',EXCEPTION_CATEGORIES[category]+' #'+r.source_id,[],r.submitted_at,'原事项提交/创建时间');item.orderApplicable=false;item.link=r.href;item.notes.push(r.summary.slice(0,180),'原提交人/负责人：'+r.employee_name);items.push(item);}
    addModule('manual_boss','manual','原老板待处理','success','沿原精确分类与链接，不与办理份相加');
  }catch{addModule('manual_boss','manual','原老板待处理','failed','原事项读取失败');}
  if(!cancels)addModule('manual_cancel','manual','取消申请','failed','取消申请读取失败');
  else{for(const r of unique(cancels,'id').rows.filter(r=>r.status==='pending')){const item=base('cancel:'+opaque(r.id),r.id,'manual','cancel_pending','事项','取消申请 #'+opaque(r.id),[r.internal_order_id],r.created_at,'取消申请创建时间');if(!item.orders.length)item.reason='取消申请未关联有效办理份';items.push(item);}addModule('manual_cancel','manual','取消申请','success','仅pending申请；不提供审批或发送操作');}

  const distinct=[...new Map(items.map(i=>[i.key,i])).values()];
  let unknownScope=0,notApplicable=0;
  const common=distinct.filter(item=>{
    if(o.group!=='all'&&item.group!==o.group)return false;
    if(o.channel!=='all'&&item.channel!==o.channel){notApplicable++;return false;}
    if(item.group==='materials'&&o.materialScope!=='all'&&(o.materialScope==='closed')!==item.closedMaterial)return false;
    if(o.currency!=='all'&&item.currency!==o.currency){if(item.group!=='finance')notApplicable++;return false;}
    if(o.start!==null){const t=utcMillis(item.date);if(t===null){unknownScope++;return false;}if(t<o.start||t>=o.end!)return false;}
    const orderFilter=o.source!=='all'||o.status!=='all'||!!o.order;
    if(orderFilter){
      if(!item.orderApplicable){notApplicable++;return false;}
      if(!item.orders.length){unknownScope++;return false;}
      item.matchedOrders=item.orders.filter(r=>(o.source==='all'||r.source===o.source)&&(o.status==='all'||r.status===o.status)&&(!o.order||r.id===o.order));
      if(!item.matchedOrders.length){if(item.orders.some(r=>o.source!=='all'&&r.source==='unknown'||o.status!=='all'&&r.status==='unknown'))unknownScope++;return false;}
    }else item.matchedOrders=item.orders;
    return true;
  });
  const categoryCounts:Partial<Record<ExceptionCategory,{count:number;unit:ExceptionItem['unit'];orders:number;CNY:number;THB:number;unknownMoney:number}>>={};
  for(const item of common){const entry=categoryCounts[item.category]||{count:0,unit:item.unit,orders:0,CNY:0,THB:0,unknownMoney:0};entry.count++;if(item.group==='finance'){if(item.amountCents!==null&&item.amountCents!==undefined&&(item.currency==='CNY'||item.currency==='THB')&&Number.isSafeInteger(entry[item.currency]+item.amountCents))entry[item.currency]+=item.amountCents;else entry.unknownMoney++;}categoryCounts[item.category]=entry;}
  for(const category of Object.keys(categoryCounts) as ExceptionCategory[])categoryCounts[category]!.orders=new Set(common.filter(i=>i.category===category).flatMap(i=>i.matchedOrders.map(r=>r.id))).size;
  const groups=Object.fromEntries((['outbox','materials','finance','data','manual'] as ExceptionGroup[]).map(group=>{
    const relevant=modules.filter(m=>m.group===group),rows=common.filter(i=>i.group===group);
    const units:Record<string,number>={};for(const row of rows)units[row.unit]=(units[row.unit]||0)+1;
    const state=relevant.every(m=>m.status==='failed')?'failed':relevant.some(m=>m.status!=='success')?'unknown':'success';
    return [group,{state,units,impactOrders:new Set(rows.flatMap(i=>i.matchedOrders.map(r=>r.id))).size,unlinkedItems:rows.filter(i=>!i.orders.length&&i.orderApplicable).length}];
  })) as Record<ExceptionGroup,{state:'success'|'unknown'|'failed';units:Record<string,number>;impactOrders:number;unlinkedItems:number}>;
  const selected=common.filter(i=>o.category==='all'||i.category===o.category).sort((a,b)=>a.key.localeCompare(b.key,'en'));
  const matchedOrders=new Set(selected.flatMap(i=>i.matchedOrders.map(r=>r.id)));
  const relevant=modules.filter(m=>o.group==='all'||m.group===o.group);
  const status=relevant.every(m=>m.status==='failed')?'failed':relevant.some(m=>m.status!=='success')||unknownScope>0?'unknown':'success';
  return {status,generatedAt:now.toISOString(),viewerRole:'admin' as const,selection:o,modules,groups,channels:channelInfo,categories:categoryCounts,total:status==='failed'?null:selected.length,items:selected.slice((o.page-1)*o.pageSize,o.page*o.pageSize),impactOrders:status==='failed'?null:matchedOrders.size,unlinkedItems:selected.filter(i=>!i.orders.length&&i.orderApplicable).length,unknownScope,notApplicable,scope:'内部已保存记录；不同类别可重叠，不是全域待办业务总量'};
}
export type ExceptionSnapshot=ReturnType<typeof exceptions>;
