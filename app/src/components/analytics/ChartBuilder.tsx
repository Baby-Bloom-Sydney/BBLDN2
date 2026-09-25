'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import type { CatalogCategory } from './CustomPipelineBuilder';

// ── Constants ──

const DROPDOWN_COLUMNS = [
  { title: 'Traffic', keys: ['wtg'] },
  { title: 'Nanny', keys: ['kn', 'nf', 'pd', 'nc'] },
  { title: 'Parent', keys: ['kp', 'pf', 'pc'] },
  { title: 'Verification', keys: ['nv', 'ni', 'nw', 'pv'] },
  { title: 'DFY Matchmaking', keys: ['df', 'dc'] },
  { title: 'Growth & BSR', keys: ['vn', 'vp', 'vb', 'bs', 'bn'] },
];

const PALETTE = [
  '#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b',
  '#10b981', '#6366f1', '#f43f5e', '#06b6d4',
];

const METRIC_OPTIONS = [
  { value: 'total_unique', label: 'Total (Unique)' },
  { value: 'total_all', label: 'Total (All)' },
  { value: 'live_unique', label: 'Live (Unique)' },
  { value: 'live_all', label: 'Live (All)' },
  { value: 'median_dwell_ms', label: 'Median Dwell' },
];

const RANGE_PRESETS = [
  { label: '7d', value: '7' },
  { label: '30d', value: '30' },
  { label: '90d', value: '90' },
  { label: 'All', value: 'all' },
];

const ENTITY_TAGS: Record<string, ('N' | 'P' | 'T' | 'V')[]> = {
  wtg: ['T'],
  nf: ['N'], pd: ['N'], nc: ['N'],
  nv: ['V', 'N'], ni: ['V', 'N'], nw: ['V', 'N'],
  pf: ['P'], pc: ['P'], pv: ['V', 'P'],
  kn: ['N'], kp: ['P'],
  dc: ['N'],
  vn: ['N'], vp: ['P'], vb: ['P'],
  bs: ['P'], bn: ['N'],
};

// Catalog keys that differ from snapshot section_keys
const SNAPSHOT_KEY_MAP: Record<string, string> = { wtg: 'wt' };
function snapshotKey(catalogKey: string): string {
  return SNAPSHOT_KEY_MAP[catalogKey] || catalogKey;
}

// ── Types ──

interface ChartSeries {
  sectionKey: string;
  stageIndex: number;
  metric: string;
}

interface SnapshotStage {
  label: string;
  total_unique: number;
  total_all: number;
  live_unique: number | null;
  live_all: number | null;
  median_dwell_ms: number | null;
}

interface SnapshotRow {
  snapshot_date: string;
  section_key: string;
  stages: SnapshotStage[];
}

// ── Helpers ──

function parseSeries(param: string): ChartSeries[] {
  if (!param) return [];
  return param.split(',').map(part => {
    const [key, idx, metric] = part.split('.');
    return { sectionKey: key, stageIndex: parseInt(idx), metric: metric || 'total_unique' };
  }).filter(s => !isNaN(s.stageIndex));
}

function serializeSeries(series: ChartSeries[]): string {
  return series.map(s => `${s.sectionKey}.${s.stageIndex}.${s.metric}`).join(',');
}

function sid(s: ChartSeries): string {
  return `${s.sectionKey}.${s.stageIndex}.${s.metric}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function fmtDwell(ms: number | null): string {
  if (ms === null || ms === undefined) return '--';
  const mins = ms / 60_000;
  if (mins < 1) return '<1m';
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 24) {
    const h = Math.floor(hrs);
    const m = Math.round((hrs - h) * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(hrs / 24)}d`;
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

// ── Component ──

interface ChartBuilderProps {
  catalog: CatalogCategory[];
}

function ChartBuilderInner({ catalog }: ChartBuilderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [localSeries, setLocalSeries] = useState<ChartSeries[] | null>(null);
  const [snapshotData, setSnapshotData] = useState<SnapshotRow[]>([]);
  const [loading, setLoading] = useState(false);

  // ── URL state ──
  const series = useMemo(() => parseSeries(searchParams.get('chart') || ''), [searchParams]);
  const chartFrom = searchParams.get('chart_from') || '';
  const chartTo = searchParams.get('chart_to') || '';

  // ── Catalog map ──
  const catalogMap = useMemo(() => {
    const map = new Map<string, CatalogCategory>();
    for (const cat of catalog) map.set(cat.key, cat);
    return map;
  }, [catalog]);

  function getLabel(s: ChartSeries): string {
    const cat = catalogMap.get(s.sectionKey);
    if (!cat) return `${s.sectionKey}.${s.stageIndex}`;
    const stage = cat.stages[s.stageIndex];
    return stage ? stage.label : `${cat.name} #${s.stageIndex}`;
  }

  function getCatLabel(s: ChartSeries): string {
    const cat = catalogMap.get(s.sectionKey);
    return cat ? cat.name : s.sectionKey;
  }

  // ── URL updates ──
  function pushParams(params: URLSearchParams) {
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function updateSeries(next: ChartSeries[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.length > 0) params.set('chart', serializeSeries(next));
    else params.delete('chart');
    pushParams(params);
  }

  function setDates(from: string, to: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set('chart_from', from);
    else params.delete('chart_from');
    if (to) params.set('chart_to', to);
    else params.delete('chart_to');
    pushParams(params);
  }

  function setPreset(days: number) {
    if (days === 0) {
      setDates('', ''); // "All" — no date filter
    } else {
      setDates(daysAgo(days), new Date().toISOString().slice(0, 10));
    }
  }

  // Determine which preset is active (if any)
  const activePreset = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (!chartFrom && !chartTo) return 'all';
    if (chartTo && chartTo !== today) return null; // custom end date
    for (const p of RANGE_PRESETS) {
      if (p.value === 'all') continue;
      if (chartFrom === daysAgo(parseInt(p.value))) return p.value;
    }
    return null;
  }, [chartFrom, chartTo]);

  // ── Dropdown ──
  function openDropdown() {
    setLocalSeries([...series]);
    setDropdownOpen(true);
  }

  const closeDropdown = useCallback(() => {
    if (localSeries !== null) {
      const params = new URLSearchParams(searchParams.toString());
      if (localSeries.length > 0) params.set('chart', serializeSeries(localSeries));
      else params.delete('chart');
      pushParams(params);
    }
    setLocalSeries(null);
    setDropdownOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localSeries, searchParams, pathname]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handle(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        closeDropdown();
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [dropdownOpen, closeDropdown]);

  const active = localSeries ?? series;
  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    for (const s of active) set.add(`${s.sectionKey}.${s.stageIndex}`);
    return set;
  }, [active]);

  function toggleStage(catKey: string, stageIdx: number) {
    if (localSeries === null) return;
    const key = `${catKey}.${stageIdx}`;
    if (selectedSet.has(key)) {
      setLocalSeries(localSeries.filter(s => !(s.sectionKey === catKey && s.stageIndex === stageIdx)));
    } else {
      setLocalSeries([...localSeries, { sectionKey: catKey, stageIndex: stageIdx, metric: 'total_unique' }]);
    }
  }

  // ── Fetch snapshot data ──
  useEffect(() => {
    if (series.length === 0) { setSnapshotData([]); return; }

    const sections = Array.from(new Set(series.map(s => snapshotKey(s.sectionKey))));

    let qs = `sections=${sections.join(',')}`;
    if (chartFrom) qs += `&from=${chartFrom}`;
    if (chartTo) qs += `&to=${chartTo}`;

    setLoading(true);
    fetch(`/api/admin/pipeline-snapshots?${qs}`)
      .then(r => r.json())
      .then((data: SnapshotRow[]) => { setSnapshotData(Array.isArray(data) ? data : []); setLoading(false); })
      .catch(() => { setSnapshotData([]); setLoading(false); });
  }, [series, chartFrom, chartTo]);

  // ── Transform for Recharts ──
  const chartData = useMemo(() => {
    if (snapshotData.length === 0 || series.length === 0) return [];

    const byDate = new Map<string, Record<string, number | null>>();
    for (const row of snapshotData) {
      if (!byDate.has(row.snapshot_date)) {
        byDate.set(row.snapshot_date, {});
      }
      const entry = byDate.get(row.snapshot_date)!;
      for (const s of series) {
        if (snapshotKey(s.sectionKey) !== row.section_key) continue;
        const stage = row.stages?.[s.stageIndex];
        if (!stage) continue;
        entry[sid(s)] = (stage as unknown as Record<string, number | null>)[s.metric] ?? null;
      }
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values }));
  }, [snapshotData, series]);

  // ── Dual Y-axis detection ──
  const hasDwell = series.some(s => s.metric === 'median_dwell_ms');
  const hasCount = series.some(s => s.metric !== 'median_dwell_ms');
  const dualAxis = hasDwell && hasCount;

  return (
    <div>
      {/* ── Controls ── */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        {/* Add Metric */}
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => dropdownOpen ? closeDropdown() : openDropdown()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
          >
            <span className="text-sm leading-none">+</span>
            Add Metric
            <span className="text-[10px] text-slate-400 ml-0.5">{dropdownOpen ? '▴' : '▾'}</span>
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 mt-2 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden z-50 w-[calc(100vw-3rem)] max-w-[900px]">
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 divide-x divide-slate-100">
                {DROPDOWN_COLUMNS.map(col => {
                  const cats = col.keys.map(k => catalogMap.get(k)).filter(Boolean) as CatalogCategory[];
                  if (cats.length === 0) return null;
                  return (
                    <div key={col.title} className="py-2">
                      <div className="px-3 pb-1.5 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                        {col.title}
                      </div>
                      {cats.map(cat => (
                        <div key={cat.key}>
                          <div className="px-3 pt-2 pb-1 text-[9px] font-semibold text-slate-400 uppercase tracking-wider border-t border-slate-50 first:border-t-0">
                            {cat.name}
                          </div>
                          {cat.stages.map((stage, si) => {
                            const isSelected = selectedSet.has(`${cat.key}.${si}`);
                            const tags = stage.tags || ENTITY_TAGS[cat.key] || [];
                            return (
                              <button
                                key={`${cat.key}.${si}`}
                                onClick={() => toggleStage(cat.key, si)}
                                className={`w-full text-left px-3 py-1 text-[11px] transition-colors flex items-center gap-1.5 ${
                                  isSelected ? 'bg-violet-50' : 'hover:bg-slate-50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  readOnly
                                  className="w-3 h-3 rounded border-slate-300 text-violet-500 focus:ring-violet-400 pointer-events-none flex-shrink-0"
                                />
                                {tags.length > 0 && (
                                  <span className="flex gap-0 flex-shrink-0">
                                    {tags.map((t, ti) => (
                                      <span key={ti} className={`text-[8px] font-bold w-3 text-center ${
                                        t === 'N' ? 'text-blue-400' : t === 'P' ? 'text-pink-400' : t === 'T' ? 'text-amber-400' : 'text-emerald-400'
                                      }`}>
                                        {t}
                                      </span>
                                    ))}
                                  </span>
                                )}
                                <span className={`truncate ${isSelected ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>
                                  {stage.label}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Date Range Presets */}
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          {RANGE_PRESETS.map(p => (
            <button
              key={p.value}
              onClick={() => setPreset(p.value === 'all' ? 0 : parseInt(p.value))}
              className={`px-3 py-1 text-[11px] font-medium transition-colors ${
                activePreset === p.value
                  ? 'bg-slate-800 text-white'
                  : 'bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Custom Date Inputs */}
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={chartFrom}
            onChange={(e) => setDates(e.target.value, chartTo)}
            className="px-2 py-1 text-[11px] text-slate-600 bg-white border border-slate-200 rounded-md outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
          />
          <span className="text-[10px] text-slate-400">to</span>
          <input
            type="date"
            value={chartTo}
            onChange={(e) => setDates(chartFrom, e.target.value)}
            className="px-2 py-1 text-[11px] text-slate-600 bg-white border border-slate-200 rounded-md outline-none focus:border-violet-400 focus:ring-1 focus:ring-violet-200"
          />
        </div>

        {series.length > 0 && (
          <span className="text-[10px] text-slate-400 tabular-nums">
            {chartData.length} day{chartData.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Active Series ── */}
      {series.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {series.map((s, i) => (
            <div
              key={sid(s)}
              className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[11px]"
            >
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
              />
              <span className="text-slate-400">{getCatLabel(s)}</span>
              <span className="font-medium text-slate-700">{getLabel(s)}</span>
              <select
                value={s.metric}
                onChange={(e) => {
                  const next = [...series];
                  next[i] = { ...next[i], metric: e.target.value };
                  updateSeries(next);
                }}
                className="text-[10px] text-slate-500 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 outline-none cursor-pointer"
              >
                {METRIC_OPTIONS.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => updateSeries(series.filter((_, j) => j !== i))}
                className="text-slate-300 hover:text-slate-500 transition-colors text-sm leading-none"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── Chart ── */}
      {series.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-400">No metrics selected</p>
          <p className="text-xs text-slate-300 mt-1">
            Use &ldquo;Add Metric&rdquo; to select stages to chart over time
          </p>
        </div>
      ) : loading ? (
        <div className="rounded-lg border border-slate-200 bg-white py-16 text-center">
          <p className="text-sm text-slate-400 animate-pulse">Loading chart data&hellip;</p>
        </div>
      ) : chartData.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-400">No snapshot data</p>
          <p className="text-xs text-slate-300 mt-1">No data found for the selected date range</p>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={chartData} margin={{ top: 8, right: dualAxis ? 48 : 16, bottom: 8, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: '#94a3b8' }}
                axisLine={false}
                tickLine={false}
                width={44}
              />
              {dualAxis && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={{ fontSize: 10, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={52}
                  tickFormatter={(v: number) => fmtDwell(v)}
                />
              )}
              <Tooltip
                contentStyle={{
                  fontSize: 11,
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                  padding: '8px 12px',
                }}
                labelFormatter={(label: any) => formatDate(String(label))}
                formatter={(value: any, name: any) => {
                  const match = series.find(s => sid(s) === name);
                  if (!match) return [value, name];
                  const lbl = `${getCatLabel(match)} — ${getLabel(match)}`;
                  if (match.metric === 'median_dwell_ms') return [fmtDwell(value), lbl];
                  return [value ?? '--', lbl];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                formatter={(value: string) => {
                  const match = series.find(s => sid(s) === value);
                  if (!match) return value;
                  const ml = METRIC_OPTIONS.find(o => o.value === match.metric)?.label || match.metric;
                  return `${getLabel(match)} (${ml})`;
                }}
              />
              {series.map((s, i) => (
                <Line
                  key={sid(s)}
                  yAxisId={dualAxis && s.metric === 'median_dwell_ms' ? 'right' : 'left'}
                  type="monotone"
                  dataKey={sid(s)}
                  name={sid(s)}
                  stroke={PALETTE[i % PALETTE.length]}
                  strokeWidth={2}
                  dot={{ r: 3, fill: PALETTE[i % PALETTE.length] }}
                  activeDot={{ r: 5 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Data Table ── */}
      {series.length > 0 && !loading && chartData.length > 0 && (
        <div className="mt-4 rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="text-left px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase tracking-wider sticky left-0 bg-white z-10 min-w-[160px]">
                  Metric
                </th>
                {chartData.map((d, di) => (
                  <th key={d.date} className="text-right px-2 py-2 text-[10px] font-medium text-slate-400 whitespace-nowrap min-w-[72px]">
                    {formatDate(d.date)}
                    {di === chartData.length - 1 && (
                      <span className="block text-[8px] text-slate-300 font-normal">latest</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {series.map((s, i) => {
                const id = sid(s);
                const isDwell = s.metric === 'median_dwell_ms';
                const metricLabel = METRIC_OPTIONS.find(o => o.value === s.metric)?.label || s.metric;
                return (
                  <tr key={id} className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/50">
                    <td className="px-3 py-2 sticky left-0 bg-white z-10">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: PALETTE[i % PALETTE.length] }}
                        />
                        <div className="min-w-0">
                          <span className="font-medium text-slate-700 block truncate">{getLabel(s)}</span>
                          <span className="text-[9px] text-slate-400">{getCatLabel(s)} &middot; {metricLabel}</span>
                        </div>
                      </div>
                    </td>
                    {chartData.map((d, di) => {
                      const val = (d as Record<string, any>)[id] as number | null;
                      const prev = di > 0 ? (chartData[di - 1] as Record<string, any>)[id] as number | null : null;
                      let pctChange: number | null = null;
                      if (val !== null && prev !== null && prev !== 0) {
                        pctChange = ((val - prev) / Math.abs(prev)) * 100;
                      }
                      return (
                        <td key={d.date} className="text-right px-2 py-2 tabular-nums whitespace-nowrap">
                          <span className="text-slate-700 font-medium">
                            {val === null ? '--' : isDwell ? fmtDwell(val) : val.toLocaleString("en-GB")}
                          </span>
                          {pctChange !== null && (
                            <span className={`block text-[9px] ${
                              pctChange > 0 ? 'text-emerald-500' : pctChange < 0 ? 'text-red-400' : 'text-slate-300'
                            }`}>
                              {pctChange > 0 ? '+' : ''}{pctChange.toFixed(1)}%
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function ChartBuilder({ catalog }: ChartBuilderProps) {
  return (
    <Suspense fallback={null}>
      <ChartBuilderInner catalog={catalog} />
    </Suspense>
  );
}
