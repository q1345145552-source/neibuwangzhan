"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { getStoredAuthToken } from '@/lib/auth-storage';
import type { DeliverySnapshot, DeliveryRow, Material, Fact } from '@/lib/visualization/delivery';
import { nextDay, sources, phases, displayTime as date } from './model';
import styles from './delivery.module.css';
import { useVisualizationViewer } from './shell';
import { BottleneckOverview, OrderBottlenecks, bottleneckNames } from './bottlenecks';
import type { BottleneckFilter } from '@/lib/visualization/bottlenecks';
const labels:Record<Material,string>={step_pending:'步骤需求未交',unsubmitted:'补件需求未提交',returned:'补件退回待重交',review:'补件待审核',file_returned:'未关联需求的退回文件',file_review:'未关联需求的待审文件',unknown:'无法判断的资料'};
const defaults={from:'',end:'',source:'all',status:'pool',owner:'',search:'',material:'all',bottleneck:'all'};
type Filters=typeof defaults;
function params(f:Filters,page:number){const p=new URLSearchParams({source:f.source,status:f.status,material:f.material,bottleneck:f.bottleneck,page:String(page),pageSize:'20'});if(f.owner==='u')p.set('ownerUnassigned','1');else if(f.owner.startsWith('v:'))p.set('owner',f.owner.slice(2));if(f.search)p.set('search',f.search);if(f.from&&f.end){p.set('from',f.from);p.set('to',nextDay(f.end));}return p.toString();}
function useDelivery(key:string,retry:number){
 const setViewer=useVisualizationViewer();
 const [state,set]=useState<{key:string;data:DeliverySnapshot|null;error:string;loading:boolean}>({key:'',data:null,error:'',loading:true});const sequence=useRef(0);
 useEffect(()=>{const n=++sequence.current,c=new AbortController(),id=key+'|'+retry;set({key:id,data:null,error:'',loading:true});
 const load=async()=>{try{const token=getStoredAuthToken();if(!token)throw Error('请先登录');const r=await fetch('/api/visualization/delivery?'+key,{headers:{Authorization:'Bearer '+token},cache:'no-store',signal:c.signal});if(r.status===403&&n===sequence.current&&!c.signal.aborted)setViewer('denied');if(!r.ok)throw Error(r.status===403?'当前账号无权读取订单交付':r.status===401?'登录已失效，请重新登录':r.status===400?'筛选条件无效，请检查日期和筛选':'读取失败，请重试');const data:DeliverySnapshot=await r.json();if(!data.generatedAt||!Array.isArray(data.items))throw Error('读取失败，请重试');if(n===sequence.current&&!c.signal.aborted){setViewer(data.viewerRole);set({key:id,data,error:'',loading:false});}}catch(e){if(n===sequence.current&&!c.signal.aborted)set({key:id,data:null,error:e instanceof Error?e.message:'读取失败，请重试',loading:false});}};
 void load();return()=>{++sequence.current;c.abort();};},[key,retry,setViewer]);return state.key===key+'|'+retry?state:{key,data:null,error:'',loading:true};
}
function MaterialsDialog({row,category,close}:{row:DeliveryRow;category:Material;close:()=>void}){
 const ref=useRef<HTMLDialogElement>(null);const[page,setPage]=useState(1);useEffect(()=>{const d=ref.current;d?.showModal();return()=>d?.close();},[]);
 const facts=row.facts?.filter(f=>f.category===category)||[],total=facts.length;
 return <dialog ref={ref} className={styles.dialog} onCancel={e=>{e.preventDefault();close();}} aria-labelledby="materials-title"><header><div><h2 id="materials-title">{labels[category]}</h2><p>{row.id} · {total}条{category.startsWith('file_')?'文件':'需求/记录'} · 当前范围</p></div><button onClick={close} aria-label="关闭资料明细">关闭</button></header>
 <p>按记录编号定位；进入原订单查看资料。此处不提供上传、审核或文件下载。</p>
 <div className={styles.details}>{facts.slice((page-1)*20,page*20).map((f:Fact)=><article key={f.kind+f.id}><strong>{f.name}</strong><p>{f.kind} #{f.id} · {f.status}</p>{f.documentId&&<p>文档 #{f.documentId} {f.submissionId&&<>· 来源提交 {f.submissionId}</>}</p>}<Link prefetch={false} href={row.href}>进入原订单（对应记录 #{f.id}）</Link></article>)}</div>
 <footer><button disabled={page===1} onClick={()=>setPage(page-1)}>上一页资料</button><span>第{page}页 / {Math.max(1,Math.ceil(total/20))}页 · 共{total}条</span><button disabled={page*20>=total} onClick={()=>setPage(page+1)}>下一页资料</button></footer></dialog>;
}
export function DeliveryBoard(){
 const[draft,setDraft]=useState<Filters>(defaults),[applied,setApplied]=useState<Filters>(defaults),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[validation,setValidation]=useState(''),[modal,setModal]=useState<{row:DeliveryRow;category:Material}|null>(null);
 const dirty=JSON.stringify(draft)!==JSON.stringify(applied),resource=useDelivery(params(applied,page),retry),data=dirty?null:resource.data;
 const edit=(k:keyof Filters,v:string)=>{setDraft(x=>({...x,[k]:v}));setValidation('');setModal(null);};
 const choose=(material:string)=>{setDraft(x=>({...x,material}));setApplied(x=>({...x,material}));setPage(1);setModal(null);};
 const chooseBottleneck=(bottleneck:BottleneckFilter)=>{setDraft(x=>({...x,bottleneck}));setApplied(x=>({...x,bottleneck}));setPage(1);setModal(null);};
 const apply=()=>{if(Boolean(draft.from)!==Boolean(draft.end)||draft.from>draft.end){setValidation('请填写完整且有效的起止日期');return;}setApplied({...draft});setPage(1);setModal(null);setRetry(x=>x+1);};
 return <section className={styles.board}><header className={styles.title}><div><p>内部已保存数据 · 只读</p><h1>订单交付</h1><p>一份办理一行 · 当前状态工作池</p></div>{data?.viewerRole==='admin'&&<Link prefetch={false} href="/visualization">数据总览与新增趋势</Link>}</header>
 <p className={styles.notice}>默认排除已完成、客户取消，包含以往积压。日期仅筛选内部创建范围，不代表历史工作池。来源只覆盖内部已有记录。订单负责人按已录原文精确匹配，经办人单列。</p>
 <form className={styles.filters} onSubmit={e=>{e.preventDefault();apply();}}>
 <label>开始日（曼谷）<input type="date" value={draft.from} onChange={e=>edit('from',e.target.value)}/></label><label>结束日（含当天）<input type="date" value={draft.end} onChange={e=>edit('end',e.target.value)}/></label>
 <label>来源<select aria-label="来源" value={draft.source} onChange={e=>edit('source',e.target.value)}>{Object.entries(sources).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>当前订单状态<select aria-label="当前订单状态" value={draft.status} onChange={e=>edit('status',e.target.value)}>{['pool','all','待处理','进行中','已完成','客户取消','unknown'].map(k=><option key={k} value={k}>{k==='pool'?'待交付工作池':k==='all'?'全部原状态':k==='unknown'?'状态未记录':k}</option>)}</select></label>
 <label>订单负责人（完整原文）<select aria-label="订单负责人（完整原文）" value={draft.owner} onChange={e=>edit('owner',e.target.value)}><option value="">全部负责人</option><option value="u">未分配</option>{resource.data?.owners.filter(Boolean).map(n=><option key={n} value={'v:'+n}>{n}</option>)}</select></label>
 <label>内部编号（精确匹配）<input value={draft.search} onChange={e=>edit('search',e.target.value)} maxLength={200}/></label>
 <label>资料类别<select aria-label="资料类别" value={draft.material} onChange={e=>edit('material',e.target.value)}><option value="all">全部资料情况</option>{Object.entries(labels).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>步骤卡点<select aria-label="步骤卡点" value={draft.bottleneck} onChange={e=>edit('bottleneck',e.target.value)}>{Object.entries(bottleneckNames).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <div className={styles.actions}><button type="submit">应用筛选</button><button type="button" onClick={()=>{setDraft({...defaults});setApplied({...defaults});setPage(1);setRetry(x=>x+1);setModal(null);}}>重置筛选</button></div></form>
 <div role="status" aria-live="polite">{validation|| (dirty?'筛选尚未应用，已隐藏旧结果':resource.loading?'正在读取订单交付…':resource.error)}</div>
 {!dirty&&(resource.error||data?.status==='failed')&&<div className={styles.notice}><p>{resource.error||'订单模块读取失败，无法判断数量'}</p><button onClick={()=>setRetry(x=>x+1)}>重试读取</button></div>}
 {data&&data.status!=='failed'&&data.summary&&<><p>读取时间：{date(data.generatedAt)}（曼谷） · {applied.from?`${applied.from} 至 ${applied.end}（含当天）内部创建`:'不限内部创建日期'} · 当前已确认匹配 <strong data-testid="delivery-total">{data.total}</strong> 份办理</p>
 {data.status==='unknown'&&<p className={styles.notice}>部分数据无法判断。{data.failed.length>0?'部分模块读取失败；已知结果继续展示。':''}全量读取中：来源未知{data.summary.sourceUnknownOrders}份，创建日期未知{data.summary.dateUnknownOrders}份；当前匹配中：未记录步骤{data.summary.stepsUnrecordedOrders}份，资料读取失败{data.summary.materialUnknownOrders}份，资料记录无法判断{data.summary.materialUnknownFacts}条。{data.gaps.map((g,i)=><span key={i}>另有{g.count}条记录或关联待核对。</span>)}筛选可能排除无法判断范围的记录。<button onClick={()=>setRetry(x=>x+1)}>重新读取</button></p>}
 {data.selectionUnknownOrders>0&&<p className={styles.notice}>另有{data.selectionUnknownOrders}份无法判断是否符合当前筛选；已知匹配数量不代表完整总量。</p>}
 {data.bottlenecks&&<BottleneckOverview stats={data.bottlenecks} filter={applied.bottleneck as BottleneckFilter} choose={chooseBottleneck} unknownScope={data.scopeUnknownOrders}/>}
 <div className={styles.cards}>{(Object.entries(labels) as [Material,string][]).map(([k,label])=><button key={k} onClick={()=>choose(k)} aria-pressed={applied.material===k}><span>{label}</span><strong>{data.summary!.materialUnknownOrders===(data.total||0)&&data.summary!.materialUnknownOrders>0?'无法判断':<>{data.summary!.materialUnknownOrders>0?'已知 ':''}{data.summary!.materials[k].items}{k.startsWith('file_')?'份文件':'条记录'}</>}</strong><small>涉及{data.summary!.materials[k].orders}份办理{data.summary!.materialUnknownOrders>0?` · 另有${data.summary!.materialUnknownOrders}份数量未知`:''}</small></button>)}</div>
 <p>步骤需求、补件需求和未关联文件分别计数，不相加作为完整率；待审不表示客户未交。没有需求记录显示“未记录需求”。</p>
 <div className={styles.rows}>{data.items.map(row=><article key={row.id} className={styles.row}><header><div><Link prefetch={false} href={row.href} className={styles.id}>{row.id}</Link><p>{row.business} · {sources[row.source as keyof typeof sources]||'来源无法判断'}</p></div><span>{row.status==='unknown'?'状态未记录':row.status}</span></header>
 <dl><div><dt>原业务阶段</dt><dd>{phases[row.phase]||'阶段未记录'}</dd></div><div><dt>订单负责人</dt><dd>{row.owner||'未分配'}</dd></div><div><dt>内部创建（曼谷）</dt><dd>{date(row.createdAt)}</dd></div></dl>
 <h3>当前步骤与经办人</h3>{row.steps===null?<p>步骤读取或字段异常，无法判断</p>:row.steps.length===0?<p>未记录步骤</p>:<><ul className={styles.steps}>{row.steps.filter(s=>s.current).map(s=><li key={s.id}><strong>{s.name}</strong> · {s.status}<br/>步骤经办人：{s.assignee||'未分配'}</li>)}</ul>{row.steps.every(s=>!s.current)&&<p>无未关闭步骤（不代表已签收）</p>}<details><summary>全部步骤与关闭状态（{row.steps.length}步）</summary><ul>{row.steps.map(s=><li key={s.id}>#{s.id} {s.name} · {s.status} · 经办人：{s.assignee||'未分配'}</li>)}</ul></details></>}
 <OrderBottlenecks row={row}/>
 <h3>当前资料事实</h3>{row.requirementCount===null?<p>需求数量无法判断</p>:row.requirementCount===0?<p>未记录需求</p>:<p>记录需求{row.requirementCount}项（步骤与补件分别列示）</p>}
 {row.counts?<div className={styles.materials}>{(Object.entries(labels) as [Material,string][]).map(([k,v])=><button key={k} disabled={row.counts![k]===0} onClick={()=>setModal({row,category:k})}>{v}：{row.counts![k]}{k.startsWith('file_')?'份文件':'条'}</button>)}</div>:<p>资料读取失败，无法判断</p>}
 {row.warnings.map(t=><p className={styles.warning} key={t}>{t}</p>)}<Link prefetch={false} href={row.href}>进入原订单</Link></article>)}</div>
 {data.total===0&&<p>{data.selectionUnknownOrders>0?'暂无可确认的匹配记录，仍有部分办理份无法判断。':'查询成功，当前筛选没有匹配记录。'}</p>}
 <footer className={styles.pagination}><button disabled={page===1} onClick={()=>{setPage(x=>x-1);setModal(null);}}>上一页</button><span>第{page}页 / {Math.max(1,Math.ceil((data.total||0)/20))}页 · 共{data.total}份</span><button disabled={page*20>=(data.total||0)} onClick={()=>{setPage(x=>x+1);setModal(null);}}>下一页</button></footer></>}
 {modal&&!dirty&&<MaterialsDialog key={modal.row.id+modal.category} {...modal} close={()=>setModal(null)}/>}</section>;
}
