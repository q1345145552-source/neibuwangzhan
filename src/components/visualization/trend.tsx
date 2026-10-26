"use client";
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { bucketDays, bucketValue, trendDetail, trendScopeText, type TrendGroup } from './trend-model';
import { gapText, sources, type DetailSpec, type Filter, type Snapshot } from './model';
import styles from './trend.module.css';
import base from './dashboard.module.css';
export function CreationTrend({ data, filter, onOpen, onRetry }: { data: Snapshot; filter: Filter; onOpen(spec: DetailSpec): void; onRetry(): void }) {
  const chartScroll = useRef<HTMLDivElement>(null);
  const [unit, setUnit] = useState<'orders' | 'parents'>('orders');
  const [granularity, setGranularity] = useState<'day' | 'month'>('day');
  const [group, setGroup] = useState<TrendGroup>('total');
  const [selection, setSelection] = useState('all');
  const result = data.modules[unit];
  const noun = unit === 'orders' ? '办理份' : '可信父交易';
  const suffix = unit === 'orders' ? '份' : '笔';
  const failed = result.status === 'failed' || result.status === 'unsupported';
  const series = !failed && result.data && Array.isArray(result.data.trend) ? result.data.trend : null;
  const points = series ? bucketDays(series, granularity) : [];
  const options = [...new Set(points.flatMap(point => Object.keys(group === 'source' ? point.sources : point.statuses)))];
  const selected = options.includes(selection) ? selection : options[0] || (group === 'source' ? filter.source === 'all' ? 'local' : filter.source : 'unknown');
  const selectedLabel = group === 'total' ? '全部记录' : group === 'source' ? sources[selected] || '来源无法判断' : selected === 'unknown' ? '状态未记录' : selected;
  useEffect(() => { if (chartScroll.current) chartScroll.current.scrollLeft = 0; }, [unit, granularity, group, selected, filter.from, filter.end, filter.source]);
  const graph = points.map(point => ({ ...point, value: bucketValue(point, group, selected) }));
  const total = graph.reduce((sum, point) => sum + point.value, 0);
  const periodCount = !failed && result.data ? result.data.period.count : null;
  const missingDates = !failed && result.data ? result.data.period.dateUnknownCount : null;
  const openPoint = (index: number) => { const point = graph[index]; if (point) onOpen(trendDetail(point, unit, group, selected, selectedLabel)); };
  return <section className={styles.panel} aria-labelledby="creation-trend-heading">
    <h2 className={styles.heading} id="creation-trend-heading">内部创建趋势</h2>
    <p className={styles.intro}>{trendScopeText(filter)} · {sources[filter.source]}</p>
    <p className={styles.intro}>仅内部创建 / 接收量。包含后来取消和仍待确认的记录；状态沿当前保存值，不是历史当日状态快照。待确认是覆盖标签，不重复堆叠。父交易与办理份不同单位，不相加。</p>
    <div className={styles.controls}>
      <label className={styles.control}>趋势单位<select aria-label="趋势单位" value={unit} onChange={e => { setUnit(e.target.value as typeof unit); setGroup('total'); setSelection('all'); }}><option value="orders">办理份（份）</option><option value="parents">可信父交易（笔）</option></select></label>
      <label className={styles.control}>时间粒度<select aria-label="时间粒度" value={granularity} onChange={e => setGranularity(e.target.value as typeof granularity)}><option value="day">按日</option><option value="month">按月</option></select></label>
      <label className={styles.control}>分组方式<select aria-label="分组方式" value={group} onChange={e => { setGroup(e.target.value as TrendGroup); setSelection('all'); }}><option value="total">全部记录</option><option value="source">按来源查看</option>{unit === 'orders' && <option value="status">按当前真实状态查看</option>}</select></label>
      {group !== 'total' && <label className={styles.control}>{group === 'source' ? '趋势来源分类' : '趋势状态分类'}<select aria-label="趋势分类" value={selected} onChange={e => setSelection(e.target.value)}>{(options.length ? options : [selected]).map(key => <option key={key} value={key}>{group === 'source' ? sources[key] || '来源无法判断' : key === 'unknown' ? '状态未记录' : key}</option>)}</select></label>}
    </div>
    {failed || !series ? <div className={base.failed} role="alert"><p>{noun}趋势加载失败，未绘制零线。</p><button className={base.action} onClick={onRetry}>重试趋势</button></div> : <>
      {result.status === 'unknown' && <p className={base.warning}>部分数据无法判断，图表为已知创建日期的记录。{gapText(result.gaps)}</p>}
      {missingDates !== null && missingDates > 0 && <p className={base.warning}>另有 {missingDates} {suffix}创建日期无法判断，未放入任何日期。此数量来自当前来源范围，不代表发生在所选期间。 <button className={styles.pointButton} onClick={() => onOpen({ title: `${noun} · 创建日期无法判断`, detail: unit, subset: 'date_unknown' })}>查看日期未知记录</button></p>}
      <div className={styles.summary}><span>{selectedLabel}期间合计 <strong data-testid="trend-total">{total}</strong> {suffix}</span><span>全部已选来源期间新增：{periodCount} {suffix} · 与对应总览数字口径相同</span></div>
      <div className={styles.legend}><span className={styles.swatch} aria-hidden="true" />{selectedLabel} · 每{granularity === 'day' ? '日' : '月'}内部新增{noun}（{suffix}） · 纵轴从0起</div>
      {total === 0 && <p className={styles.empty}>查询成功，本范围该分类没有新增记录。下表仍覆盖完整日期。</p>}
      <div ref={chartScroll} className={styles.chartScroll} role="region" aria-label="内部创建趋势图，可局部横向滚动" tabIndex={0}>
        <div style={{ minWidth: Math.max(280, graph.length * (granularity === 'day' ? 30 : 88)), height: 270 }}>
          <ResponsiveContainer width="100%" height={270}>
            <BarChart key={`${unit}-${granularity}-${group}-${selected}-${filter.from}-${filter.end}`} data={graph} margin={{ top: 15, right: 18, left: 0, bottom: 25 }} accessibilityLayer>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} minTickGap={35} label={{ value: `曼谷内部创建${granularity === 'day' ? '日' : '月'}`, position: 'insideBottom', offset: -15, fontSize: 11 }} />
              <YAxis allowDecimals={false} domain={[0, 'auto']} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} label={{ value: suffix, position: 'insideTopLeft', fontSize: 11 }} />
              <Tooltip cursor={{ fill: 'var(--muted)' }} formatter={(value) => [`${value} ${suffix}`, `内部新增${noun}`]} labelFormatter={(label) => { const point = graph.find(p => p.label === label); return point ? `${point.from} 至 ${point.end}${point.partialMonth ? '（部分月）' : ''}` : String(label); }} contentStyle={{ borderRadius: 10, fontSize: 12, background: 'var(--card)', borderColor: 'var(--border)' }} />
              <Bar dataKey="value" name={`内部新增${noun}（${suffix}）`} fill="var(--chart-1)" maxBarSize={42} radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={(_item, index) => openPoint(index)} cursor="pointer" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <p className={styles.intro}>点击柱形或下表“查看明细”。零值日期也可从表格进入；长区间仅图表与表格局部滚动，不隐藏记录。{unit === 'parents' && '父记录没有统一真实状态，故只提供总量和来源分类，不从子份推造父单状态。'}</p>
      <h3 className={styles.dataHeading}>趋势数据表 · {noun}（{suffix}）</h3>
      <div className={styles.tableScroll} role="region" aria-label="趋势完整数据表，可滚动" tabIndex={0}>
        <table className={styles.table}><thead><tr><th scope="col">曼谷{granularity === 'day' ? '日期' : '月份'}</th><th scope="col">实际覆盖范围</th><th scope="col">{selectedLabel}新增（{suffix}）</th><th scope="col">原记录</th></tr></thead><tbody>{graph.map((point, index) => <tr key={point.label}><td>{point.label}{point.partialMonth && <small>部分月，仅所选日期</small>}</td><td>{point.from} 至 {point.end}</td><td>{point.value}</td><td><button className={styles.pointButton} aria-label={`查看${point.label}${selectedLabel}${noun}明细`} onClick={() => openPoint(index)}>查看明细</button></td></tr>)}</tbody></table>
      </div>
    </>}
  </section>;
}
