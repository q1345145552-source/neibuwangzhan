"use client";
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { X, LoaderCircle } from 'lucide-react';
import { categories, decimal, displayTime, gapText, phases, query, sources, type DetailSpec, type Filter } from './model';
import { useOverviewResource } from './resource';
import type { Row } from '@/lib/visualization/types';
import s from './dashboard.module.css';
const value = (v: unknown) => typeof v === 'string' || typeof v === 'number' ? String(v) : '未记录';
function EntryLink({ href, children }: { href: unknown; children: React.ReactNode }) { return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//') ? <Link prefetch={false} className={s.link} href={href}>{children}</Link> : <span>缺少关联，无法定位</span>; }
function Children({ row }: { row: Row }) {
  const children = Array.isArray(row.fulfillments) ? row.fulfillments as Row[] : [];
  return <details><summary className="cursor-pointer">查看全部 {children.length} 份办理</summary><div className={s.children}>{children.length ? children.map((child, i) => <div className={s.child} key={String(child.id) + i}><EntryLink href={child.href}>{value(child.id)}</EntryLink><span>{value(child.status)}</span></div>) : <p>暂无可信关联办理份</p>}</div></details>;
}
function OrderRow({ row }: { row: Row }) { return <><td><EntryLink href={row.href}>{value(row.id)}</EntryLink></td><td>{sources[String(row.source)] || '来源无法判断'}</td><td>{value(row.status)}{row.awaiting_confirmation === true && <small>待确认（状态内覆盖标签）</small>}{row.awaiting_confirmation === null && <small>确认情况无法判断</small>}</td><td>{phases[String(row.phase)] || '阶段未记录'}</td><td>{displayTime(row.created_at)}</td><td><EntryLink href={row.href}>进入原订单</EntryLink></td></>; }
function FinanceRow({ row }: { row: Row }) { return <><td>{value(row.id)}<small>{row.kind === 'commerce_refund' ? '商城退款 · 非办理成本' : row.kind === 'cost' ? '成本' : '收入'}</small></td><td><EntryLink href={row.href}>{value(row.order_id)}</EntryLink><small>进入原订单查记录 #{value(row.id)}</small></td><td>{row.currency_known ? row.currency === 'CNY' ? '人民币' : '泰铢' : '币种未记录 / 无效'}</td><td>{row.amount_valid ? decimal(row.amount, false) : <>金额无效<small>原值：{value(row.amount)}</small></>}</td><td>{row.status === 'paid' ? row.type === 'income' ? '已记录到账' : '已付' : row.status === 'pending' ? row.type === 'income' ? '待核对' : '待付' : row.status === 'cancelled' ? '已取消' : value(row.status)}</td><td>{value(row.verify_by)}<small>{displayTime(row.verify_at)}</small></td></>; }
function BillingRow({ row }: { row: Row }) { return <><td>{value(row.id)}<small>人民币 · 本地商城账本</small></td>{['originalCents', 'creditedCents', 'receivedCents', 'refundedCents', 'dueCents'].map(key => <td key={key}>{decimal(row[key])}</td>)}<td><Children row={row} />{row.mappedIncomeDiffersFromPaid === true && <small>账本收款与已记录到账收入存在口径差异，未强制调整。</small>}{row.status === 'unknown' && <small>部分账本信息无法判断</small>}<small>应退：{decimal(row.refundDueCents)}（与余额分开）</small></td></>; }
export function DetailDialog({ filter, spec, onClose }: { filter: Filter; spec: DetailSpec; onClose(): void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [page, setPage] = useState(1), [retry, setRetry] = useState(0);
  const state = useOverviewResource(query(filter, spec, page), retry);
  useEffect(() => { const dialog = ref.current; if (dialog && !dialog.open) dialog.showModal(); return () => dialog?.close(); }, []);
  const details = state.data?.details;
  const data = details?.status === 'success' || details?.status === 'unknown' ? details.data : null;
  const headers = spec.detail === 'orders' ? ['内部编号', '来源', '真实状态', '原阶段', '内部创建日期 · 曼谷', '原入口'] : spec.detail === 'parents' ? ['可信父编号', '来源', '内部创建日期 · 曼谷', '关联办理份'] : spec.detail === 'finances' ? ['财务记录编号 / 类型', '所属订单', '币种', '金额 · 元', '状态', '核对人 / 时间 · 曼谷'] : spec.detail === 'billing' ? ['商城父编号', '原账面金额', '减免', '账本已记收款', '已退款', '余额', '关联办理 / 说明'] : ['事项编号 / 分类', '业务摘要', '提交时间 · 曼谷', '原业务入口'];
  return <dialog ref={ref} className={s.dialog} aria-labelledby="overview-details-title" onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className={s.dialogHeader}><div><h2 id="overview-details-title">{spec.title}</h2><p className={s.description}>{spec.detail === 'pending' ? '当前待处理事项 · 原分类，不适用订单来源或日期筛选' : `${spec.basis === 'period' ? `${spec.from || filter.from} 至 ${spec.end || filter.end} 内部新增` : '当前存量 · 不受日期范围影响'} · ${sources[spec.source || filter.source]}`}</p></div><button className={s.action} onClick={onClose} aria-label="关闭明细"><X size={16} /><span>关闭</span></button></div>
    <div className={s.dialogBody} aria-busy={state.loading}>
      {state.loading ? <div className={s.empty}><LoaderCircle size={18} className={s.spinner} />正在读取第 {page} 页…</div> : state.error || details?.status === 'failed' || !data ? <div className={s.failed} role="alert"><p>{state.error === 'forbidden' ? '无权限查看老板明细。' : state.error === 'login' ? '登录已失效，请重新登录。' : '此项明细加载失败，未用0或其他记录替代。'}</p><button className={s.action} onClick={() => setRetry(v => v + 1)}>重试明细</button></div> : <>
        {details?.status === 'unknown' && <div className={s.warning}>部分数据无法判断。{gapText(details.gaps)}</div>}
        <p className={s.description}>全量匹配 {data.total} {spec.detail === 'orders' ? '份' : spec.detail === 'parents' || spec.detail === 'billing' ? '笔' : '条'} · 每页 {data.pageSize} 条{spec.detail === 'finances' && ' · 不代表银行到账核验'}</p>
        {data.items.length === 0 ? <div className={s.empty}>查询成功，本范围没有匹配记录。</div> : <div className={s.tableWrap} role="region" aria-label="明细表，可局部横向滚动" tabIndex={0}><table className={s.table}><thead><tr>{headers.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{data.items.map((row, i) => <tr key={String(row.id) + i}>{spec.detail === 'orders' ? <OrderRow row={row} /> : spec.detail === 'parents' ? <><td>{value(row.parent_no ?? row.id)}</td><td>{sources[String(row.source)] || '来源无法判断'}</td><td>{displayTime(row.created_at)}</td><td><Children row={row} /></td></> : spec.detail === 'finances' ? <FinanceRow row={row} /> : spec.detail === 'billing' ? <BillingRow row={row} /> : <><td>{value(row.id)}<small>{categories[String(row.category)] || '原业务分类'}</small></td><td>{value(row.summary)}<small>{value(row.employee_name)}</small></td><td>{displayTime(row.submitted_at)}</td><td><EntryLink href={row.href}>定位原事项</EntryLink></td></>}</tr>)}</tbody></table></div>}
        <div className={s.pager}><span>第 {data.page} / {Math.max(1, Math.ceil(data.total / data.pageSize))} 页 · 共 {data.total} 条</span><div className={s.pagerButtons}><button className={s.action} disabled={page <= 1} onClick={() => setPage(p => p - 1)}>上一页</button><button className={s.action} disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>下一页</button></div></div>
      </>}
    </div>
  </dialog>;
}
