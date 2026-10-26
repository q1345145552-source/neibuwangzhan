"use client";
import { useVisualizationDialog } from './dialog-focus';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import type { BottleneckFilter, BottleneckRow, StepTiming, bottleneckSummary } from '@/lib/visualization/bottlenecks';
import { displayTime } from './model';
import styles from './bottlenecks.module.css';

export const bottleneckNames: Record<BottleneckFilter, string> = {
  all: '全部卡点情况', blocked: '当前阻塞', overdue: '当前步骤超时',
  timing_unknown: '步骤超时无法判断', affected: '任一已知卡点', closed_blocked: '关闭订单仍有阻塞',
};
type Stats = ReturnType<typeof bottleneckSummary>;
function countText(count: number, unknown: number, total: number) {
  return count === 0 && unknown > 0 && unknown >= total ? '无法判断' : `${unknown ? '已知 ' : ''}${count}份`;
}
export function BottleneckOverview({ stats, filter, choose, unknownScope }: { stats: Stats; unknownScope: number; filter: BottleneckFilter; choose: (value: BottleneckFilter) => void }) {
  return <section aria-label="卡点与步骤超时分析" className={styles.overview}>
    <h2>卡点与步骤超时</h2>
    <p>当前催办只计未完成、未取消办理份。类别可重叠，不能把各卡份数相加。资料未交、退回、待审继续在下方分别列示，待审不当客户缺资料。</p>
    <div className={styles.cards}>
      <button aria-pressed={filter === 'blocked'} onClick={() => choose('blocked')}><span>当前阻塞</span><strong>{countText(stats.blocked.orders, stats.blocked.unknownOrders + unknownScope, stats.liveOrders + unknownScope)}</strong><small>{stats.blocked.steps}条已知阻塞步骤 · {stats.blocked.unknownOrders}份含未知步骤或未记录步骤</small></button>
      <button aria-pressed={filter === 'overdue'} onClick={() => choose('overdue')}><span>当前步骤超时</span><strong>{countText(stats.overdue.orders, stats.overdue.unknownOrders + unknownScope, stats.liveOrders + unknownScope)}</strong><small>{stats.overdue.steps}条已知超时步骤 · {stats.overdue.unknownOrders}份含未知步骤或未记录步骤</small></button>
      <button aria-pressed={filter === 'timing_unknown'} onClick={() => choose('timing_unknown')}><span>步骤超时无法判断</span><strong>{stats.unknown.orders}份</strong><small>已识别{stats.unknown.steps}条无法判断的当前步骤；未记录步骤另提示</small></button>
      <button aria-pressed={filter === 'affected'} onClick={() => choose('affected')}><span>任一已知卡点（去重）</span><strong>{stats.affectedOrders}份</strong><small>阻塞 / 超时 / 需求未交或退回 · 按办理份去重，未知记录未补算</small></button>
    </div>
    {stats.timingFailed && <p className={styles.warning} role="status">超时模块部分读取失败，无法判断部分步骤；已知阻塞和资料事实仍可查看。请使用页面“重新读取”重试。</p>}
    <p>卡点卡片按来源、负责人、订单状态、日期和资料类别公共筛选；“步骤卡点”只收窄下方办理列表。{unknownScope>0&&<>另有{unknownScope}份无法判断是否符合公共筛选，未补入卡点数字。</>}{stats.closedBlocked.orders > 0 && <button onClick={() => choose('closed_blocked')}>查看关闭订单仍有阻塞：{stats.closedBlocked.orders}份 / {stats.closedBlocked.steps}步骤（不计当前催办）</button>}</p>
    <details><summary>工作日与起点规则</summary><p>曼谷周一至周六08:00–17:00，周日和泰国假日排除，9小时为1工作日。预计天数只认建单快照；起点依次为较晚的最近重启/首次开始、前序最近完成、内部创建。比较采用未舍入的已用工作日，大于预计才超时；显示最多6位小数。没有配置、记录或读取失败均不补0。没有当前步骤不代表已签收。</p></details>
  </section>;
}
const basisNames = { restart: '最近重启', started: '首次开始', previous: '前序最近完成', created: '内部创建' };
function days(value: number | null) {
  if (value === null) return '无法判断';
  if (value > 0 && value < 0.000001) return '小于0.000001';
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 6 });
}
type DetailKind = 'blocked' | 'overdue' | 'timing_unknown' | 'current';
function StepDialog({ row, kind, close }: { row: BottleneckRow; kind: DetailKind; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [page, setPage] = useState(1);
  useVisualizationDialog(dialog);
  const blocked = kind === 'blocked';
  const timing = row.bottleneck.timing?.filter(t => kind === 'overdue' ? t.overdue === true : kind === 'timing_unknown' ? t.overdue === null : true) || [];
  const items = blocked ? row.bottleneck.blockedSteps || [] : timing;
  const title = blocked ? '真实阻塞步骤' : kind === 'current' ? '全部当前步骤时间' : bottleneckNames[kind];
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); close(); }}>
    <header><div><h2 id={titleId}>{title}</h2><p>{row.id} · 共{items.length}条步骤 · {!row.bottleneck.eligible ? '不计当前催办' : '当前筛选范围'}</p></div><button aria-label="关闭步骤明细" onClick={close}>关闭</button></header>
    <p>订单负责人：{row.owner || '未分配'}。按步骤ID进入原订单核对；没有单步骤锚点，不附加链接参数。</p>
    {row.bottleneck.problems.map(text => <p className={styles.warning} key={text}>{text}</p>)}
    <div className={styles.items}>{items.slice((page - 1) * 20, page * 20).map(item => {
      const t = item as StepTiming;
      return <article key={item.id}><h3>步骤 #{item.id} · {item.name}</h3><p>{item.status} · 步骤经办人：{item.assignee || '未分配'}</p>
        {blocked ? <p>{'current' in item && item.current ? '原规则当前步骤' : '不是原规则当前步骤，不计当前超时'}</p> : <>
          <p><strong>{t.overdue === null ? '无法判断是否超时' : t.overdue ? '已超时（按未舍入值比较）' : '未超时'}</strong></p>
          <dl><div><dt>建单预计</dt><dd>{days(t.expectedDays)} 工作日</dd></div><div><dt>已用</dt><dd>{days(t.elapsedDays)} 工作日</dd></div><div><dt>超出</dt><dd>{days(t.excessDays)} 工作日</dd></div><div><dt>有效起点</dt><dd>{t.since ? displayTime(t.since) + '（曼谷）' : '无法判断'}{t.sinceBasis && <><br />依据：{basisNames[t.sinceBasis]}</>}</dd></div></dl>
          {t.reasons.map(reason => <p className={styles.warning} key={reason}>{reason}</p>)}
        </>}
        <Link prefetch={false} href={row.href}>进入原订单（步骤 #{item.id}）</Link>
      </article>;
    })}</div>
    {items.length === 0 && <p>没有可列出的匹配步骤。{row.steps?.length === 0 ? '未记录步骤，不能判断超时或签收。' : row.bottleneck.timingState === 'closed' ? '关闭订单不计算当前步骤超时。' : row.bottleneck.timingState === 'no_current' ? '没有当前未关闭步骤；不代表已签收。' : '请查看读取状态和缺口提示。'}</p>}
    <footer><button disabled={page === 1} onClick={() => setPage(page - 1)}>上一页步骤</button><span>第{page}页 / {Math.max(1, Math.ceil(items.length / 20))}页 · 共{items.length}条</span><button disabled={page * 20 >= items.length} onClick={() => setPage(page + 1)}>下一页步骤</button></footer>
  </dialog>;
}
export function OrderBottlenecks({ row }: { row: BottleneckRow }) {
  const [kind, setKind] = useState<DetailKind | null>(null);
  const b = row.bottleneck, overdue = b.timing?.filter(t => t.overdue === true).length || 0;
  const unknown = b.timing?.filter(t => t.overdue === null).length || 0;
  return <section className={styles.order} aria-label={'办理份卡点 ' + row.id}>
    <h3>步骤卡点与时间</h3>
    {!b.eligible && <p>{b.eligibilityUnknown ? '订单原状态无法判断，未计入当前催办' : '已完成 / 已取消范围：只展示不一致事实，不计当前催办或超时'}</p>}
    <div className={styles.actions}>
      <button disabled={!b.blockedSteps?.length} onClick={() => setKind('blocked')}>{b.eligible ? '当前阻塞步骤' : '原阻塞步骤'}：{b.blockedSteps === null ? '无法判断' : `${b.blockedSteps.length}条`}</button>
      {b.eligible && <><button disabled={overdue === 0} onClick={() => setKind('overdue')}>已知超时步骤：{overdue}条</button>{(unknown > 0 || b.timingState === 'unknown' || b.timingState === 'failed' || row.steps?.length === 0) && <button onClick={() => setKind('timing_unknown')}>超时无法判断：{unknown > 0 ? `${unknown}条步骤` : row.steps?.length === 0 ? '未记录步骤' : '当前步骤未知'}</button>}<button onClick={() => setKind('current')}>查看全部当前步骤时间</button></>}
    </div>
    {b.problems.map(text => <p className={styles.warning} key={text}>{text}</p>)}
    {kind && <StepDialog row={row} kind={kind} close={() => setKind(null)} />}
  </section>;
}
