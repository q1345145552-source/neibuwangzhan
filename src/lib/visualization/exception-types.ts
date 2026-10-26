import type { Source } from './types';
export const EXCEPTION_CATEGORIES = {
  outbox_waiting:'本地出站待发送',outbox_retry:'本地出站曾失败待重试',outbox_unknown:'出站记录无法判断',
  step_pending:'步骤需求未交',unsubmitted:'补件需求未提交',returned:'补件退回待重交',review:'补件待审核',
  file_returned:'未关联需求的退回文件',file_review:'未关联需求的待审文件',material_unknown:'资料记录无法判断',blocked:'真实阻塞步骤',
  finance_waiting:'收入待核对',finance_not_arrived:'收入未到账',
  data_inconsistent:'已证数据不一致',data_historical:'历史关系待核对',data_unknown:'数据完整性无法判断',
  manual_leave:'请假审批',manual_attendance:'考勤补签',manual_notice:'通知与规则落实',manual_report:'日报待阅',manual_meeting:'会议心得',manual_todo:'未完成待办',manual_problem:'问题验收',manual_issue:'待处理工单',cancel_pending:'取消申请待处理',
} as const;
export type ExceptionCategory=keyof typeof EXCEPTION_CATEGORIES;
export type ExceptionGroup='outbox'|'materials'|'finance'|'data'|'manual';
export const EXCEPTION_GROUPS:Record<ExceptionGroup,string>={outbox:'本地出站',materials:'资料与阻塞事实',finance:'财务待核对',data:'数据待核对',manual:'原人工事项'};
export type OrderRef={id:string;source:Source|'unknown';status:string;href:string};
export type ExceptionItem={
  key:string;recordId:string;group:ExceptionGroup;category:ExceptionCategory;unit:'事件'|'需求项'|'文件'|'步骤'|'财务记录'|'核对项'|'事项';
  title:string;state:string;channel:'progress'|'documents'|null;kind?:string;
  orders:OrderRef[];matchedOrders:OrderRef[];link:string|null;reason:string|null;notes:string[];
  date:string|null;dateLabel:string;closedMaterial:boolean;orderApplicable:boolean;
  attempts?:number|null;nextAttemptAt?:string|null;failureCategory?:string;atExistingThreshold?:boolean;
  currency?:'CNY'|'THB'|'unknown';amountCents?:number|null;
};
export type ExceptionOptions={group:'all'|ExceptionGroup;category:'all'|ExceptionCategory;channel:'all'|'progress'|'documents';source:string;status:string;order:string;materialScope:'active'|'closed'|'all';currency:'all'|'CNY'|'THB'|'unknown';from:string;to:string;start:number|null;end:number|null;page:number;pageSize:number};
export function parseExceptionOptions(url:URL):ExceptionOptions {
  const p=url.searchParams;
  for(const key of p.keys())if(!['group','category','channel','source','status','order','materialScope','currency','from','to','page','pageSize'].includes(key)||p.getAll(key).length!==1)throw Error('QUERY');
  const get=(key:string,fallback:string)=>p.get(key)||fallback;
  const group=get('group','all'),category=get('category','all'),channel=get('channel','all'),source=get('source','all'),status=get('status','all'),order=get('order',''),materialScope=get('materialScope','active'),currency=get('currency','all');
  if(!['all',...Object.keys(EXCEPTION_GROUPS)].includes(group)||!['all',...Object.keys(EXCEPTION_CATEGORIES)].includes(category)||!['all','progress','documents'].includes(channel)||!['all','local','commerce','saved_source','conflict'].includes(source)||!['all','待处理','进行中','已完成','客户取消','unknown'].includes(status)||!['active','closed','all'].includes(materialScope)||!['all','CNY','THB','unknown'].includes(currency)||order.length>200)throw Error('QUERY');
  const from=get('from',''),to=get('to','');if(Boolean(from)!==Boolean(to))throw Error('QUERY');
  const day=(s:string)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw Error('QUERY');const t=Date.parse(s+'T00:00:00+07:00');if(!Number.isFinite(t)||new Date(t+7*3600000).toISOString().slice(0,10)!==s)throw Error('QUERY');return t;};
  const start=from?day(from):null,end=to?day(to):null;if(start!==null&&end!==null&&(end<=start||end-start>366*86400000))throw Error('QUERY');
  const integer=(key:string,fallback:number,max:number)=>{const s=get(key,String(fallback));if(!/^[1-9]\d*$/.test(s)||Number(s)>max)throw Error('QUERY');return Number(s);};
  return {group,category,channel,source,status,order,materialScope,currency,from,to,start,end,page:integer('page',1,1000000),pageSize:integer('pageSize',20,100)} as ExceptionOptions;
}
