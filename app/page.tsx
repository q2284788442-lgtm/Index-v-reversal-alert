"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Bar = [string, number, number, number, number, number];
type SignalPoint = [number, number, number, number, number, number];
type ShapeSignal = {
  id: string;
  kind: "V" | "INV_V";
  status: "complete" | "right";
  horizon: "short" | "long";
  alert: number;
  left: number;
  pivot: number;
  right: number;
  alertTime: string;
  leftTime: string;
  pivotTime: string;
  rightTime: string;
  pivotDelay: number;
  leftDuration: number;
  rightDuration: number;
  probability: number;
  leftScore: number;
  leftAmp: number;
  rightAmp: number;
  leftEff: number;
  rightEff: number;
  symmetry: number;
  threshold: number;
  nearPivot: boolean;
  strictStrength: number | null;
};

type DayPayload = {
  bars: Bar[];
  signals: SignalPoint[];
  shapes: ShapeSignal[];
  alerts: { low: number; high: number; total: number };
  shapeCounts: { complete: number; right: number };
};

type IndexMeta = {
  code: string;
  slug: string;
  name: string;
  dates: string[];
  alertDates: string[];
  counts: { low: number; high: number; total: number };
  shapeCounts: { complete: number; right: number };
  thresholds: { low: number; high: number };
};

type Manifest = {
  title: string;
  generatedAt: string;
  range: { min: string; max: string };
  matching: { shortMinutes: number; longMinutes: number; rightMinutes: number };
  indices: IndexMeta[];
};

type YearPayload = { code: string; name: string; year: number; days: Record<string, DayPayload> };

const formatNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

function nearestDate(dates: string[], target: string) {
  if (!dates.length) return target;
  if (dates.includes(target)) return target;
  return dates.find((date) => date >= target) ?? dates[dates.length - 1];
}

function shapeName(shape: ShapeSignal) {
  const base = shape.kind === "V" ? "V反" : "反V";
  return shape.status === "complete" ? `${base}（左+右）` : `${base}右`;
}

function Diamond({ x, y, color, selected }: { x: number; y: number; color: string; selected: boolean }) {
  const size = selected ? 8 : 6;
  return <polygon points={`${x},${y - size} ${x + size},${y} ${x},${y + size} ${x - size},${y}`} fill={color} stroke={selected ? "#fff" : color} strokeWidth={selected ? 2 : 1} className="shape-diamond" />;
}

function CandleChart({
  day,
  selectedMinute,
  selectedShape,
  onSelectMinute,
  onSelectShape,
}: {
  day: DayPayload;
  selectedMinute: number;
  selectedShape: string | null;
  onSelectMinute: (index: number) => void;
  onSelectShape: (shape: ShapeSignal) => void;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const width = 1220;
  const height = 560;
  const margin = { left: 22, right: 72, top: 28, bottom: 42 };
  const volumeHeight = 72;
  const priceBottom = height - margin.bottom - volumeHeight - 18;
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = priceBottom - margin.top;
  const rawMin = Math.min(...day.bars.map((bar) => bar[3]));
  const rawMax = Math.max(...day.bars.map((bar) => bar[2]));
  const padding = Math.max((rawMax - rawMin) * 0.08, rawMax * 0.0004);
  const minPrice = rawMin - padding;
  const maxPrice = rawMax + padding;
  const maxVolume = Math.max(...day.bars.map((bar) => bar[5]), 1);
  const step = plotWidth / Math.max(1, day.bars.length);
  const candleWidth = Math.max(1.2, Math.min(3.2, step * 0.64));
  const x = (index: number) => margin.left + step * (index + 0.5);
  const y = (price: number) => margin.top + ((maxPrice - price) / (maxPrice - minPrice)) * plotHeight;
  const volumeY = (volume: number) => height - margin.bottom - (volume / maxVolume) * volumeHeight;
  const gridPrices = Array.from({ length: 6 }, (_, index) => minPrice + ((maxPrice - minPrice) * index) / 5).reverse();
  const active = hovered ?? selectedMinute;
  const activeBar = day.bars[active];
  const minuteFromPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const localX = ((event.clientX - rect.left) / rect.width) * width;
    return Math.max(0, Math.min(day.bars.length - 1, Math.floor((localX - margin.left) / step)));
  };

  return (
    <div className="chart-shell" data-testid="candle-chart">
      <div className="chart-head">
        <div><span className="eyebrow">分钟K线</span><strong>模型报警后的左右侧路径</strong></div>
        <div className="legend" aria-label="图例">
          <span><i className="legend-candle up" />上涨</span><span><i className="legend-candle down" />下跌</span>
          <span><i className="legend-dot v" />V反路径</span><span><i className="legend-dot inv" />反V路径</span>
        </div>
      </div>
      <div className="svg-wrap">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="分钟K线与模型左右侧路径" onPointerMove={(event) => setHovered(minuteFromPointer(event))} onPointerLeave={() => setHovered(null)} onPointerDown={(event) => onSelectMinute(minuteFromPointer(event))}>
          <defs>
            <linearGradient id="volumeFade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2cd4c6" stopOpacity="0.42" /><stop offset="1" stopColor="#2cd4c6" stopOpacity="0.05" /></linearGradient>
            <filter id="shapeGlow"><feGaussianBlur stdDeviation="2.4" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          </defs>
          {gridPrices.map((price) => <g key={price}><line x1={margin.left} x2={width - margin.right} y1={y(price)} y2={y(price)} className="grid-line" /><text x={width - margin.right + 10} y={y(price) + 4} className="axis-label">{formatNumber.format(price)}</text></g>)}
          <rect x={x(119) + step / 2} y={margin.top} width={step} height={height - margin.top - margin.bottom} className="session-gap" /><text x={x(119) + step} y={margin.top + 16} className="session-label">午间</text>
          {day.bars.map((bar, index) => {
            const [, open, high, low, close, volume] = bar;
            const rising = close >= open;
            const color = rising ? "#ff5d55" : "#26c77a";
            return <g key={`${bar[0]}-${index}`}><line x1={x(index)} x2={x(index)} y1={y(high)} y2={y(low)} stroke={color} strokeWidth="1" /><rect x={x(index) - candleWidth / 2} y={Math.min(y(open), y(close))} width={candleWidth} height={Math.max(1.2, Math.abs(y(open) - y(close)))} fill={color} rx="0.4" /><rect x={x(index) - Math.max(0.7, candleWidth * 0.35)} y={volumeY(volume)} width={Math.max(1.4, candleWidth * 0.7)} height={Math.max(1, height - margin.bottom - volumeY(volume))} fill={rising ? "#ff5d55" : "url(#volumeFade)"} opacity="0.42" /></g>;
          })}
          {day.shapes.map((shape) => {
            const selected = selectedShape === shape.id;
            const color = shape.kind === "V" ? "#f5b942" : "#2bd8e6";
            const directionClass = shape.kind === "V" ? "v" : "inv";
            return <g key={`signal-${shape.id}`} className={`signal-marker ${directionClass} ${selected ? "selected" : ""}`} role="button" aria-label={`${shapeName(shape)}极值点 ${shape.pivotTime}`} onPointerDown={(event) => { event.stopPropagation(); onSelectShape(shape); }}>
              <title>{`${shapeName(shape)}极值点 · ${shape.pivotTime} · 报警 ${shape.alertTime}`}</title>
              <line x1={x(shape.pivot)} x2={x(shape.pivot)} y1={margin.top} y2={priceBottom} stroke={color} className="signal-marker-hit" />
              <line x1={x(shape.pivot)} x2={x(shape.pivot)} y1={margin.top} y2={priceBottom} stroke={color} className="signal-marker-line" filter={selected ? "url(#shapeGlow)" : undefined} />
              <circle cx={x(shape.pivot)} cy={margin.top + 8} r={selected ? 5.5 : 4} fill={color} className="signal-marker-dot" filter={selected ? "url(#shapeGlow)" : undefined} />
              <text x={x(shape.pivot)} y={margin.top + 11} textAnchor="middle" className="signal-marker-label">{shape.kind === "V" ? "V" : "∧"}</text>
            </g>;
          })}
          {day.shapes.map((shape) => {
            const selected = selectedShape === shape.id;
            const color = shape.kind === "V" ? "#f5b942" : "#2bd8e6";
            const leftY = y(day.bars[shape.left][4]);
            const pivotY = y(day.bars[shape.pivot][4]);
            const rightY = y(day.bars[shape.right][4]);
            return <g key={shape.id} className={`shape-overlay ${selected ? "selected" : ""}`} role="button" aria-label={`${shapeName(shape)} ${shape.alertTime}`} onPointerDown={(event) => { event.stopPropagation(); onSelectShape(shape); }}>
              {shape.status === "complete" ? <polyline points={`${x(shape.left)},${leftY} ${x(shape.pivot)},${pivotY} ${x(shape.right)},${rightY}`} fill="none" stroke={color} strokeWidth={selected ? 2.8 : 1.7} strokeDasharray={selected ? "0" : "5 4"} opacity={selected ? 1 : 0.78} filter={selected ? "url(#shapeGlow)" : undefined} /> : <>
                <polyline points={`${x(shape.left)},${leftY} ${x(shape.pivot)},${pivotY}`} fill="none" stroke={color} strokeWidth={selected ? 2.1 : 1.35} opacity={selected ? 0.5 : 0.24} />
                <polyline points={`${x(shape.pivot)},${pivotY} ${x(shape.right)},${rightY}`} fill="none" stroke={color} strokeWidth={selected ? 2.3 : 1.5} strokeDasharray="3 3" opacity={selected ? 0.78 : 0.42} />
              </>}
              <circle cx={x(shape.left)} cy={leftY} r={selected ? 4.5 : 3} fill={color} opacity={shape.status === "complete" ? 1 : selected ? 0.55 : 0.28} /><text x={x(shape.left)} y={leftY - 9} textAnchor="middle" fill={color} opacity={shape.status === "complete" ? 1 : selected ? 0.6 : 0.32} className="side-label">左</text>
              <Diamond x={x(shape.pivot)} y={pivotY} color={color} selected={selected} />
              <circle cx={x(shape.right)} cy={rightY} r={selected ? 5 : 3.5} fill={color} opacity={shape.status === "complete" ? 1 : selected ? 0.85 : 0.5} /><text x={x(shape.right)} y={rightY - 9} textAnchor="middle" fill={color} opacity={shape.status === "complete" ? 1 : selected ? 0.9 : 0.55} className="side-label">右</text>
              <text x={x(shape.pivot)} y={shape.kind === "V" ? pivotY + 25 : pivotY - 17} textAnchor="middle" fill={color} className="shape-label">{shapeName(shape)}</text>
            </g>;
          })}
          {[0, 30, 60, 90, 119, 120, 150, 180, 210, 239].filter((index) => index < day.bars.length).map((index) => <text key={index} x={x(index)} y={height - 13} textAnchor="middle" className="axis-label time">{day.bars[index][0]}</text>)}
          {activeBar ? <g pointerEvents="none"><line x1={x(active)} x2={x(active)} y1={margin.top} y2={height - margin.bottom} className="crosshair" /><circle cx={x(active)} cy={y(activeBar[4])} r="4" className="hover-point" /></g> : null}
        </svg>
        {activeBar ? <div className="ohlc-float"><strong>{activeBar[0]}</strong><span>开 {formatNumber.format(activeBar[1])}</span><span>高 {formatNumber.format(activeBar[2])}</span><span>低 {formatNumber.format(activeBar[3])}</span><span>收 {formatNumber.format(activeBar[4])}</span></div> : null}
      </div>
    </div>
  );
}

function ProbabilityChart({ day, selectedMinute }: { day: DayPayload; selectedMinute: number }) {
  const width = 1220, height = 190, left = 22, right = 72, top = 20, bottom = 30;
  const step = (width - left - right) / Math.max(1, day.signals.length - 1);
  const x = (index: number) => left + index * step;
  const y = (value: number) => top + (1 - Math.max(0, Math.min(1, value))) * (height - top - bottom);
  return <div className="indicator-shell probability-shell"><div className="indicator-title"><span>5分钟模型概率</span><div className="legend"><span><i className="legend-alert low" />V反</span><span><i className="legend-alert high" />反V</span></div></div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="双向模型概率">
    {[0, .25, .5, .75, 1].map((value) => <g key={value}><line x1={left} x2={width - right} y1={y(value)} y2={y(value)} className="grid-line" /><text x={width - right + 10} y={y(value) + 4} className="axis-label">{Math.round(value * 100)}%</text></g>)}
    <polyline points={day.signals.map((s, i) => `${x(i)},${y(s[0])}`).join(" ")} fill="none" stroke="#f5b942" strokeWidth="2.1" /><polyline points={day.signals.map((s, i) => `${x(i)},${y(s[1])}`).join(" ")} fill="none" stroke="#2bd8e6" strokeWidth="2.1" />
    <line x1={x(selectedMinute)} x2={x(selectedMinute)} y1={top} y2={height - bottom} className="crosshair selected-line" /><circle cx={x(selectedMinute)} cy={y(day.signals[selectedMinute]?.[0] ?? 0)} r="4.5" fill="#f5b942" /><circle cx={x(selectedMinute)} cy={y(day.signals[selectedMinute]?.[1] ?? 0)} r="4.5" fill="#2bd8e6" />
  </svg></div>;
}

function DetailPanel({ day, minute, shape }: { day: DayPayload; minute: number; shape: ShapeSignal | null }) {
  if (shape) {
    const colorClass = shape.kind === "V" ? "v" : "inv";
    return <aside className={`detail-panel ${colorClass}`} data-testid="shape-detail">
      <div className="detail-top"><div><span className="eyebrow">当前路径</span><h2>{shapeName(shape)}</h2></div><span className={`signal-badge ${colorClass}`}>{shape.horizon === "short" ? "短期" : "长期"}</span></div>
      <div className={`route-strip ${shape.status === "right" ? "right-only" : ""}`}>
        <div><span>{shape.kind === "V" ? "左侧最高点" : "左侧最低点"}</span><strong>{shape.leftTime}</strong></div><i /><div><span>极值点</span><strong>{shape.pivotTime}</strong></div><i /><div><span>{shape.kind === "V" ? "右侧最高点" : "右侧最低点"}</span><strong>{shape.rightTime}</strong></div>
      </div>
      <div className="metric-grid">
        <div><span>模型报警</span><strong>{shape.alertTime}</strong></div><div><span>模型概率</span><strong>{formatPercent(shape.probability)}</strong></div>
        <div><span>左侧规则分</span><strong>{shape.leftScore.toFixed(3)}</strong></div><div><span>报警距极值</span><strong>{shape.pivotDelay} min</strong></div>
        <div><span>左侧耗时</span><strong>{shape.leftDuration} min</strong></div><div><span>右侧耗时</span><strong>{shape.rightDuration} min</strong></div>
        <div><span>左侧振幅</span><strong>{shape.leftAmp.toFixed(2)}%</strong></div><div><span>右侧振幅</span><strong>{shape.rightAmp.toFixed(2)}%</strong></div>
        <div><span>左侧效率</span><strong>{shape.leftEff.toFixed(1)}%</strong></div><div><span>右侧效率</span><strong>{shape.rightEff.toFixed(1)}%</strong></div>
        <div><span>接近极值</span><strong>{shape.nearPivot ? "是" : "否"}</strong></div><div><span>严格确认</span><strong>{shape.status === "complete" ? "成立" : "未成立"}</strong></div>
      </div>
      <div className="score-row"><span>{shape.status === "complete" ? "严格事件强度" : "右侧反弹幅度"}</span><div className="score-track"><i style={{ width: `${Math.min(100, shape.status === "complete" ? (shape.strictStrength ?? 0) * 52 : shape.rightAmp * 18)}%` }} /></div><strong>{shape.status === "complete" ? (shape.strictStrength ?? 0).toFixed(2) : `${shape.rightAmp.toFixed(2)}%`}</strong></div>
    </aside>;
  }
  const bar = day.bars[minute], signal = day.signals[minute];
  if (!bar || !signal) return <aside className="detail-panel empty-detail"><span className="detail-icon">◇</span><strong>暂无分钟数据</strong></aside>;
  return <aside className="detail-panel live-detail"><div className="detail-top"><div><span className="eyebrow">当前分钟</span><h2>{bar[0]}</h2></div><span className="signal-badge neutral">观察中</span></div><div className="probability-focus low-focus"><span>V反概率</span><strong>{formatPercent(signal[0])}</strong><i><b style={{ width: formatPercent(signal[0]) }} /></i></div><div className="probability-focus high-focus"><span>反V概率</span><strong>{formatPercent(signal[1])}</strong><i><b style={{ width: formatPercent(signal[1]) }} /></i></div><div className="metric-grid live-metrics"><div><span>开盘</span><strong>{formatNumber.format(bar[1])}</strong></div><div><span>收盘</span><strong>{formatNumber.format(bar[4])}</strong></div><div><span>V反规则分</span><strong>{signal[2].toFixed(3)}</strong></div><div><span>反V规则分</span><strong>{signal[3].toFixed(3)}</strong></div></div></aside>;
}

export default function Home() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [code, setCode] = useState("000001.XSHG");
  const [date, setDate] = useState("");
  const [day, setDay] = useState<DayPayload | null>(null);
  const [selectedMinute, setSelectedMinute] = useState(0);
  const [selectedShape, setSelectedShape] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const cache = useRef(new Map<string, YearPayload>());

  useEffect(() => { fetch("/data/manifest.json").then((response) => { if (!response.ok) throw new Error("manifest"); return response.json(); }).then((payload: Manifest) => { setManifest(payload); const first = payload.indices[0]; setCode(first.code); setDate(first.alertDates[first.alertDates.length - 1] ?? first.dates[first.dates.length - 1]); }).catch(() => setNotice("模型数据加载失败，请重新启动页面。")); }, []);
  const indexMeta = useMemo(() => manifest?.indices.find((item) => item.code === code) ?? null, [manifest, code]);
  const loadDay = useCallback(async (targetCode: string, targetDate: string) => {
    if (!manifest || !targetDate) return;
    const meta = manifest.indices.find((item) => item.code === targetCode); if (!meta) return;
    const actualDate = nearestDate(meta.dates, targetDate); if (actualDate !== targetDate) { setDate(actualDate); setNotice(`已切换至最近交易日 ${actualDate}`); }
    const key = `${meta.slug}-${actualDate.slice(0, 4)}`; setLoading(true);
    try { let payload = cache.current.get(key); if (!payload) { const response = await fetch(`/data/${meta.slug}/${actualDate.slice(0, 4)}.json`); if (!response.ok) throw new Error("year"); payload = await response.json(); cache.current.set(key, payload!); } const nextDay = payload!.days[actualDate]; setDay(nextDay); const initial = nextDay.shapes[nextDay.shapes.length - 1] ?? null; setSelectedShape(initial?.id ?? null); setSelectedMinute(initial?.alert ?? nextDay.bars.length - 1); } catch { setNotice("该交易日数据暂时无法读取。"); } finally { setLoading(false); }
  }, [manifest]);
  useEffect(() => { if (!manifest || !date) return; const timer = window.setTimeout(() => void loadDay(code, date), 0); return () => window.clearTimeout(timer); }, [manifest, code, date, loadDay]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 2600); return () => window.clearTimeout(timer); }, [notice]);
  const moveDate = useCallback((direction: -1 | 1) => { if (!indexMeta || !date) return; const current = indexMeta.dates.indexOf(date); setDate(indexMeta.dates[Math.max(0, Math.min(indexMeta.dates.length - 1, current + direction))]); }, [indexMeta, date]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "ArrowLeft") moveDate(-1); if (event.key === "ArrowRight") moveDate(1); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [moveDate]);
  const selected = day?.shapes.find((shape) => shape.id === selectedShape) ?? null;
  const selectShape = (shape: ShapeSignal) => { setSelectedShape(shape.id); setSelectedMinute(shape.pivot); };
  const completeV = day?.shapes.filter((shape) => shape.status === "complete" && shape.kind === "V").length ?? 0;
  const completeInv = day?.shapes.filter((shape) => shape.status === "complete" && shape.kind === "INV_V").length ?? 0;

  return <main className="app-shell">
    <header className="topbar"><div className="brand"><span className="brand-mark">V</span><div><strong>左右侧模型观测台</strong><span>INDEX INTRADAY SIGNALS</span></div></div><div className="top-status"><i />模型与严格事件已加载 <span>{manifest?.range.min.slice(0, 4)}—{manifest?.range.max}</span></div></header>
    <section className="hero"><div><span className="hero-kicker">分钟级 · 模型报警后验路径</span><h1>日内V反 / 反V左右侧预警</h1><p>模型报警作为左侧起点；严格形态成立时合并展示左+右，未成立时展示候选极值后的右侧路径。</p></div><div className="hero-stat"><span>全历史模型报警</span><strong>{formatNumber.format(manifest?.indices.reduce((sum, item) => sum + item.counts.total, 0) ?? 0)}</strong><em>三个宽基指数</em></div></section>
    <section className="control-bar" aria-label="行情筛选"><label><span>指数</span><select value={code} onChange={(event) => { const nextCode = event.target.value; const nextMeta = manifest?.indices.find((item) => item.code === nextCode); setCode(nextCode); if (nextMeta) setDate(nearestDate(nextMeta.dates, date)); }} aria-label="指数">{manifest?.indices.map((item) => <option value={item.code} key={item.code}>{item.name} · {item.code}</option>)}</select></label><div className="date-stepper"><button onClick={() => moveDate(-1)} aria-label="上一个交易日">‹</button><label><span>交易日期</span><input type="date" value={date} min={manifest?.range.min} max={manifest?.range.max} onInput={(event) => setDate(event.currentTarget.value)} aria-label="交易日期" /></label><button onClick={() => moveDate(1)} aria-label="下一个交易日">›</button></div><div className="control-summary"><div><span>当前指数</span><strong>{indexMeta?.name ?? "—"}</strong></div><div><span>历史左+右</span><strong>{formatNumber.format(indexMeta?.shapeCounts.complete ?? 0)}</strong></div></div></section>
    <section className="summary-grid"><article><span>当日报警</span><strong>{day?.alerts.total ?? 0}</strong><em>次</em></article><article className="v-card"><span>V反（左+右）</span><strong>{completeV}</strong><em>条</em></article><article className="inv-card"><span>反V（左+右）</span><strong>{completeInv}</strong><em>条</em></article><article><span>右侧解释</span><strong>{day?.shapeCounts.right ?? 0}</strong><em>条</em></article><article><span>确认比例</span><strong>{day?.alerts.total ? formatPercent((day.shapeCounts.complete ?? 0) / day.alerts.total) : "—"}</strong><em>strict</em></article></section>
    <section className="workspace-grid"><div className={`chart-column ${loading ? "is-loading" : ""}`}>{day ? <CandleChart day={day} selectedMinute={selectedMinute} selectedShape={selectedShape} onSelectMinute={(index) => { setSelectedMinute(index); setSelectedShape(null); }} onSelectShape={selectShape} /> : <div className="chart-placeholder">正在读取行情…</div>}{day ? <ProbabilityChart day={day} selectedMinute={selectedMinute} /> : null}</div>{day ? <DetailPanel day={day} minute={selectedMinute} shape={selected} /> : <aside className="detail-panel empty-detail"><span className="detail-icon">◇</span><strong>正在加载</strong></aside>}</section>
    <section className="event-section"><div className="section-title"><div><span className="eyebrow">当日清单</span><h2>左右侧路径</h2></div><span>{date} · {day?.shapes.length ?? 0}条</span></div>{day?.shapes.length ? <div className="event-list">{day.shapes.map((shape, rowIndex) => <button key={shape.id} className={`event-row ${shape.kind === "V" ? "v" : "inv"} ${selectedShape === shape.id ? "active" : ""}`} onClick={() => selectShape(shape)}><span className="event-index">{String(rowIndex + 1).padStart(2, "0")}</span><span className="event-type">{shapeName(shape)}</span><span><small>左端 → 极值 → 右端</small>{shape.leftTime} → {shape.pivotTime} → {shape.rightTime}</span><span><small>报警 / 概率</small>{shape.alertTime} · {formatPercent(shape.probability)}</span><span><small>匹配</small>{shape.horizon === "short" ? "短期" : "长期"} · {shape.nearPivot ? "近极值" : "常规"}</span><span className="event-strength">{shape.status === "complete" ? "严格成立" : "右侧观察"}</span></button>)}</div> : <div className="empty-list"><span>◇</span><p>该交易日没有模型报警</p><button onClick={() => moveDate(-1)}>查看上一交易日</button></div>}</section>
    <footer><span>V / INV-V LEFT + RIGHT MONITOR</span><p>短期 ≤ {manifest?.matching.shortMinutes ?? 5} 分钟 · 长期 ≤ {manifest?.matching.longMinutes ?? 30} 分钟</p></footer>{notice ? <div className="toast" role="status">{notice}</div> : null}
  </main>;
}
