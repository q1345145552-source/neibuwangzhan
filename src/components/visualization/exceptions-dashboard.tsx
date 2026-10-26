"use client";
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { ExceptionSnapshot } from '@/lib/visualization/exceptions';
import { EXCEPTION_CATEGORIES,EXCEPTION_GROUPS,type ExceptionCategory,type ExceptionGroup,type ExceptionItem } from '@/lib/visualization/exception-types';
import { getStoredAuthToken } from '@/lib/auth-storage';
import { useVisualizationViewer } from './shell';
import { decimal, displayTime, nextDay, sources } from './model';
import styles from './exceptions.module.css';
const defaults={group:'all',category:'all',channel:'all',source:'all',status:'all',order:'',materialScope:'active',currency:'all',from:'',end:''};
type Filters=typeof defaults;
function query(f:Filters,page:number){const p=new URLSearchParams({group:f.group,category:f.category,channel:f.channel,source:f.source,status:f.status,order:f.order,materialScope:f.materialScope,currency:f.currency,page:String(page),pageSize:'20'});if(f.from&&f.end){p.set('from',f.from);p.set('to',nextDay(f.end));}return p.toString();}
function useExceptions(key:string,retry:number){
  const setViewer=useVisualizationViewer(),sequence=useRef(0);
  const [state,setState]=useState<{key:string;data:ExceptionSnapshot|null;loading:boolean;error:string}>({key:'',data:null,loading:true,error:''});
  useEffect(()=>{const generation=++sequence.current,controller=new AbortController(),id=key+'|'+retry;
    setState({key:id,data:null,loading:true,error:''});
    void(async()=>{try{const token=getStoredAuthToken();if(!token)throw Error('请先登录');const r=await fetch('/api/visualization/exceptions?'+key,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:controller.signal});
      if((r.status===403||r.status===401)&&generation===sequence.current&&!controller.signal.aborted)setViewer('denied');
      if(!r.ok)throw Error(r.status===403?'当前账号无权读取老板异常清单':r.status===401?'登录已失效，请重新登录':r.status===400?'筛选条件无效，请检查日期及选项':'异常清单读取失败，请重试');
      const data:ExceptionSnapshot=await r.json();if(!Array.isArray(data.items)||!Array.isArray(data.modules)||!data.generatedAt)throw Error('异常清单读取失败，请重试');
      if(generation===sequence.current&&!controller.signal.aborted){setViewer('admin');setState({key:id,data,loading:false,error:''});}
    }catch(e){if(generation===sequence.current&&!controller.signal.aborted)setState({key:id,data:null,loading:false,error:e instanceof Error?e.message:'读取失败，请重试'});}})();
    return()=>{++sequence.current;controller.abort();};
  },[key,retry,setViewer]);
  return state.key===key+'|'+retry?state:{key,data:null,loading:true,error:''};
}
function ItemDialog({item,close}:{item:ExceptionItem;close:()=>void}){
  const ref=useRef<HTMLDialogElement>(null),id=useId();const[page,setPage]=useState(1);
  useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id} onCancel={e=>{e.preventDefault();close();}}><header><div><h2 id={id}>{item.title}</h2><p>{EXCEPTION_CATEGORIES[item.category]} · {item.unit}编号 {item.recordId}</p></div><button onClick={close} aria-label="关闭异常明细">关闭</button></header>
    <p>{item.dateLabel}：{item.date?displayTime(item.date)+'（曼谷）':'无法判断'}{item.closedMaterial&&' · 关闭订单事实，不计当前催办'}</p>
    {item.channel&&<dl><div><dt>通道</dt><dd>{item.channel==='progress'?'进度出站':'资料出站'}</dd></div><div><dt>事件类型</dt><dd>{item.kind}</dd></div><div><dt>尝试次数</dt><dd>{item.attempts??'无法判断'}</dd></div><div><dt>下次尝试时间（本地记录）</dt><dd>{item.nextAttemptAt?displayTime(item.nextAttemptAt):'未记录或无法判断'}</dd></div><div><dt>安全提炼的失败类别</dt><dd>{item.failureCategory}</dd></div></dl>}
    {item.group==='finance'&&<p>币种：{item.currency==='CNY'?'人民币':item.currency==='THB'?'泰铢':'无法判断'} · 金额：{item.amountCents===null?'无法判断':decimal(item.amountCents)} · 对应finance_id：{item.recordId}。未核对不等于欠款，未到账不等于逾期。</p>}
    {item.atExistingThreshold&&<p>已达到原有6次提醒门槛；此页只读，不触发提醒或重试。</p>}
    {item.notes.map((note,i)=><p key={i}>{note}</p>)}
    {item.reason&&<p className={styles.warning}>{item.reason}</p>}
    {item.orders.length>0?<><h3>全部可信关联办理份：{item.orders.length}份</h3><p>其中符合当前订单筛选{item.matchedOrders.length}份；影响份只按匹配范围去重。</p><div className={styles.links}>{item.orders.slice((page-1)*20,page*20).map(order=><article key={order.id}><strong>{order.id}</strong><p>{sources[order.source]||'来源无法判断'} · {order.status==='unknown'?'状态无法判断':order.status}</p><Link prefetch={false} href={order.href}>进入原订单（对应{item.unit} #{item.recordId}）</Link></article>)}</div><footer><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页关联办理份</button><span>第{page}页 / {Math.ceil(item.orders.length/20)}页 · 共{item.orders.length}份</span><button disabled={page*20>=item.orders.length} onClick={()=>setPage(page+1)}>下一页关联办理份</button></footer></>:item.link?<Link prefetch={false} href={item.link}>进入原事项（#{item.recordId}）</Link>:<p>未关联可靠原记录，不构造跳转地址。</p>}
  </dialog>;
}
export function ExceptionsDashboard(){
  const[draft,setDraft]=useState<Filters>(defaults),[applied,setApplied]=useState<Filters>(defaults),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[error,setError]=useState(''),[detail,setDetail]=useState<ExceptionItem|null>(null);
  const dirty=JSON.stringify(draft)!==JSON.stringify(applied),resource=useExceptions(query(applied,page),retry),data=dirty?null:resource.data;
  const edit=(key:keyof Filters,value:string)=>{setDraft(f=>({...f,[key]:value,...(key==='group'?{channel:value==='outbox'||value==='all'?f.channel:'all',currency:value==='finance'||value==='all'?f.currency:'all',category:'all'}:{})}));setError('');setDetail(null);};
  const apply=()=>{if(Boolean(draft.from)!==Boolean(draft.end)||draft.from>draft.end){setError('请填写完整且有效的起止日期');return;}setApplied({...draft});setPage(1);setRetry(x=>x+1);setDetail(null);};
  const choose=(changes:Partial<Filters>)=>{setDraft(f=>({...f,...changes}));setApplied(f=>({...f,...changes}));setPage(1);setDetail(null);};
  const unavailable=data?.status==='failed';
  return <section className={styles.page}><header className={styles.heading}><div><p>老板专属 · 内部已保存记录</p><h1>异常与待核对清单</h1><p>只呈现可证事实，不代表客户站健康或两站全量。</p></div><Link prefetch={false} href="/visualization">返回数据总览</Link></header>
    <p className={styles.notice}>不同类别可以重叠，事件、需求、文件、步骤、财务记录和人工事项分单位，不能相加作为全域待办业务总量。默认不限当月；仅资料与阻塞使用未完成、未取消催办池。取消订单的出站结果和现存待核对收入继续保留。</p>
    <form onSubmit={e=>{e.preventDefault();apply();}} className={styles.filters}>
      <label>类别组<select aria-label="类别组" value={draft.group} onChange={e=>edit('group',e.target.value)}><option value="all">全部事实类别</option>{Object.entries(EXCEPTION_GROUPS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>精确分类<select aria-label="精确分类" value={draft.category} onChange={e=>edit('category',e.target.value)}><option value="all">全部精确分类</option>{Object.entries(EXCEPTION_CATEGORIES).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>通道（仅出站）<select aria-label="通道（仅出站）" value={draft.channel} onChange={e=>edit('channel',e.target.value)}><option value="all">全部 / 不限定通道</option><option value="progress">进度出站</option><option value="documents">资料出站</option></select></label>
      <label>办理份来源<select aria-label="办理份来源" value={draft.source} onChange={e=>edit('source',e.target.value)}>{Object.entries(sources).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
      <label>办理份当前状态<select aria-label="办理份当前状态" value={draft.status} onChange={e=>edit('status',e.target.value)}>{['all','待处理','进行中','已完成','客户取消','unknown'].map(k=><option key={k} value={k}>{k==='all'?'全部原状态':k==='unknown'?'状态无法判断':k}</option>)}</select></label>
      <label>内部办理编号（精确）<input value={draft.order} maxLength={200} onChange={e=>edit('order',e.target.value)}/></label>
      <label>资料 / 阻塞范围<select aria-label="资料 / 阻塞范围" value={draft.materialScope} onChange={e=>edit('materialScope',e.target.value)}><option value="active">当前催办池</option><option value="closed">只看关闭订单事实</option><option value="all">全部含关闭订单</option></select></label>
      <label>币种（仅财务记录）<select aria-label="币种（仅财务记录）" value={draft.currency} onChange={e=>edit('currency',e.target.value)}><option value="all">全部币种 / 不限定</option><option value="CNY">人民币</option><option value="THB">泰铢</option><option value="unknown">币种无法判断</option></select></label>
      <label>条目日期开始日（曼谷）<input type="date" value={draft.from} onChange={e=>edit('from',e.target.value)}/></label><label>条目日期结束日（含当天）<input type="date" value={draft.end} onChange={e=>edit('end',e.target.value)}/></label>
      <div className={styles.actions}><button type="submit">应用筛选</button><button type="button" onClick={()=>{setDraft({...defaults});setApplied({...defaults});setPage(1);setRetry(x=>x+1);setDetail(null);}}>重置筛选</button></div>
    </form>
    <p>日期分别按条目标注的字段筛选：出站事件创建、资料/阻塞的办理份创建、财务记录创建、原事项提交/创建。来源、当前状态和内部编号只匹配可信关联办理份；无订单人工事项不适用这些筛选。通道只适用出站，币种只适用财务记录。</p>
    <div role="status" aria-live="polite">{error||(dirty?'筛选尚未应用，旧结果已隐藏':resource.loading?'正在读取本地异常事实…':resource.error)}</div>
    {!dirty&&(resource.error||unavailable)&&<div className={styles.notice}><p>{resource.error||'所选数据均读取失败或无法判断，不显示伪0。'}</p><button onClick={()=>setRetry(x=>x+1)}>重试读取异常清单</button></div>}
    {data&&!unavailable&&<><div className={styles.reading}><p>读取时间：{displayTime(data.generatedAt)}（曼谷） · {applied.from?`${applied.from} 至 ${applied.end}（含当天）`:'不限条目日期'} · 已确认匹配事实记录 <strong data-testid="exceptions-total">{data.total}</strong> 条</p><button onClick={()=>{setDetail(null);setRetry(x=>x+1);}}>刷新只读清单</button></div>
      <p>匹配范围内已关联影响办理份 <strong data-testid="exceptions-impact">{data.impactOrders}</strong> 份（跨类别去重，非待办总量）；未关联事实{data.unlinkedItems}条。无订单人工事项不计影响份。</p>
      {(data.unknownScope>0||data.notApplicable>0)&&<p className={styles.notice}>另有{data.unknownScope}条无法判断是否符合筛选，未补入数字；{data.notApplicable}条不适用当前通道、币种或订单筛选。已知匹配不代表完整总量。</p>}
      <div className={styles.cards}>{(Object.entries(EXCEPTION_GROUPS) as [ExceptionGroup,string][]).map(([key,label])=>{const group=data.groups[key],active=applied.group==='all'||applied.group===key;return <button key={key} onClick={()=>choose({group:key,category:'all',channel:key==='outbox'?applied.channel:'all',currency:key==='finance'?applied.currency:'all'})} aria-pressed={applied.group===key}><span>{label}</span><strong>{!active?'切换查看':group.state==='failed'?'读取失败':group.state==='unknown'&&Object.keys(group.units).length===0?'无法判断':Object.keys(group.units).length===0?'0条':Object.entries(group.units).map(([unit,count])=>`${group.state==='unknown'?'已知 ':''}${count}${unit}`).join(' / ')}</strong>{active&&<small>影响{group.impactOrders}份 · 未关联{group.unlinkedItems}条{group.state==='unknown'?' · 仅已知小计':''}</small>}</button>;})}</div>
      {data.modules.filter(m=>(applied.group==='all'||m.group===applied.group)&&m.status!=='success').map(m=><p className={styles.notice} key={m.id}>{m.label}：{m.status==='failed'?'读取失败':'部分数据无法判断'}。{m.message}</p>)}
      <section aria-label="本地通道回执" className={styles.receipts}><h2>本地通道回执</h2><p>各通道全量本地记录的最近合法sent_at，不随清单筛选变化；未记录不等于从未同步，不表示对侧健康。</p>{(['progress','documents'] as const).map(channel=>{const c=data.channels[channel];return <p key={channel}>{channel==='progress'?'进度出站':'资料出站'}：{c.lastSentState==='failed'?'读取失败':c.lastSentState==='unrecorded'?'未记录':c.lastSentAt?displayTime(c.lastSentAt)+'（曼谷）':'无法判断'}{c.lastSentState==='unknown'&&`；另有${c.invalidSentTimes}条回执时间无法判断，当前仅已知最近值`}</p>;})}</section>
      <div className={styles.categoryCards}>{Object.entries(data.categories).map(([category,value])=><div key={category}><button aria-pressed={applied.category===category} onClick={()=>choose({category})}>{EXCEPTION_CATEGORIES[category as ExceptionCategory]}：{value.count}{value.unit} · 影响{value.orders}份</button>{(category==='finance_waiting'||category==='finance_not_arrived')&&<div className={styles.actions}><button onClick={()=>choose({category,currency:'CNY'})}>人民币 {decimal(value.CNY)}</button><button onClick={()=>choose({category,currency:'THB'})}>泰铢 {decimal(value.THB)}</button><span>币种或金额无法判断{value.unknownMoney}笔；金额仅已知小计</span></div>}</div>)}</div>
      <p>分类卡片沿公共筛选；精确分类仅收窄下方清单。金额分币种且只作原记录小计，不是欠款、逾期、净额或利润。</p>
      <div className={styles.rows}>{data.items.map(item=><article key={item.key}><header><div><span className={styles.tag}>{EXCEPTION_CATEGORIES[item.category]}</span><h2>{item.title}</h2></div><span>{item.unit} #{item.recordId}</span></header><p>{item.dateLabel}：{item.date?displayTime(item.date):'无法判断'}（曼谷）</p>{item.channel&&<p>{item.channel==='progress'?'进度出站':'资料出站'} · {item.kind} · 尝试{item.attempts??'无法判断'}次 · {item.failureCategory}{item.atExistingThreshold&&' · 达到既有提醒门槛'}</p>}{item.closedMaterial&&<p>关闭订单事实，不计当前催办</p>}<p>全部关联{item.orders.length}份，当前匹配{item.matchedOrders.length}份{item.reason&&' · '+item.reason}</p><button onClick={()=>setDetail(item)} aria-label={'查看异常明细 '+item.recordId+' '+EXCEPTION_CATEGORIES[item.category]}>查看准确明细</button></article>)}</div>
      {data.total===0&&<p>{data.unknownScope>0||data.modules.some(m=>(applied.group==='all'||m.group===applied.group)&&m.status!=='success')?'暂无可确认匹配记录；仍有缺口或读取失败，不能据此判断没有异常。':'查询成功，当前筛选没有匹配记录。'}</p>}
      <footer className={styles.pagination}><button disabled={page===1} onClick={()=>{setPage(x=>x-1);setDetail(null);}}>上一页事实</button><span>第{page}页 / {Math.max(1,Math.ceil((data.total||0)/20))}页 · 共{data.total}条匹配事实</span><button disabled={page*20>=(data.total||0)} onClick={()=>{setPage(x=>x+1);setDetail(null);}}>下一页事实</button></footer></>}
    {detail&&!dirty&&<ItemDialog key={detail.key} item={detail} close={()=>setDetail(null)}/>}
  </section>;
}
