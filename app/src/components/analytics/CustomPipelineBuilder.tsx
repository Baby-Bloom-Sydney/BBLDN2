'use client';

import { useState, useEffect, useRef, useMemo, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { PipelineTable } from './PipelineTable';

interface CatalogStage {
  label: string;
  tooltip?: string;
  total: number;
  tags?: ('N' | 'P' | 'T' | 'V')[];
}

export interface CatalogCategory {
  name: string;
  key: string;
  stages: CatalogStage[];
}

const DROPDOWN_COLUMNS = [
  { title: 'Traffic', keys: ['wtg'] },
  { title: 'Nanny', keys: ['kn', 'nf', 'pd', 'nc'] },
  { title: 'Parent', keys: ['kp', 'pf', 'pc'] },
  { title: 'Verification', keys: ['nv', 'ni', 'nw'] },
  { title: 'DFY Matchmaking', keys: ['df', 'dc'] },
  { title: 'Growth & BSR', keys: ['vn', 'vp', 'vb', 'bs', 'bn'] },
];

const ENTITY_TAGS: Record<string, ('N' | 'P' | 'T' | 'V')[]> = {
  wtg: ['T'],
  nf: ['N'], pd: ['N'], nc: ['N'],
  nv: ['V', 'N'], ni: ['V', 'N'], nw: ['V', 'N'],
  pf: ['P'], pc: ['P'],
  dc: ['N'],
  kn: ['N'], kp: ['P'],
  vn: ['N'], vp: ['P'], vb: ['P'],
  bs: ['P'], bn: ['N'],
};

interface CustomEntry {
  key: string;
  index: number;
}

function parseCustomParam(param: string): CustomEntry[] {
  if (!param) return [];
  return param.split(',').map(part => {
    const [key, idx] = part.split('.');
    return { key, index: parseInt(idx) };
  }).filter(e => !isNaN(e.index));
}

function serializeCustomParam(entries: CustomEntry[]): string {
  return entries.map(e => `${e.key}.${e.index}`).join(',');
}

interface CustomPipelineBuilderProps {
  catalog: CatalogCategory[];
  customStages: { label: string; tooltip?: string; total: number; liveTotal?: number; tags?: ('N' | 'P' | 'T' | 'V')[]; override?: { count?: 'all' | 'unique'; min?: number; max?: number; mode?: 'alltime' | 'live' }; medianDwell?: number | null }[];
}

function CustomBuilderInner({ catalog, customStages }: CustomPipelineBuilderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  // Local entries for instant checkbox toggling (flushed to URL on dropdown close)
  const [localEntries, setLocalEntries] = useState<CustomEntry[] | null>(null);

  const entries = useMemo(
    () => parseCustomParam(searchParams.get('custom') || ''),
    [searchParams]
  );

  // When dropdown opens, snapshot current entries into local state
  function openDropdown() {
    setLocalEntries([...entries]);
    setDropdownOpen(true);
  }

  // Flush local entries to URL and close
  const closeDropdown = useCallback(() => {
    if (localEntries !== null) {
      const params = new URLSearchParams(searchParams.toString());
      if (localEntries.length > 0) {
        params.set('custom', serializeCustomParam(localEntries));
      } else {
        params.delete('custom');
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    }
    setLocalEntries(null);
    setDropdownOpen(false);
  }, [localEntries, searchParams, router, pathname]);

  // Close dropdown on outside click
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

  function updateURL(newEntries: CustomEntry[]) {
    const params = new URLSearchParams(searchParams.toString());
    if (newEntries.length > 0) {
      params.set('custom', serializeCustomParam(newEntries));
    } else {
      params.delete('custom');
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // Use local entries when dropdown is open, otherwise URL entries
  const activeEntries = localEntries ?? entries;

  // Build a set of selected stage keys for checkbox state
  const selectedSet = useMemo(() => {
    const set = new Set<string>();
    for (const e of activeEntries) set.add(`${e.key}.${e.index}`);
    return set;
  }, [activeEntries]);

  function toggleStage(catKey: string, stageIdx: number) {
    if (localEntries === null) return;
    const key = `${catKey}.${stageIdx}`;
    if (selectedSet.has(key)) {
      const idx = localEntries.findIndex(e => e.key === catKey && e.index === stageIdx);
      if (idx !== -1) {
        setLocalEntries(localEntries.filter((_, i) => i !== idx));
      }
    } else {
      setLocalEntries([...localEntries, { key: catKey, index: stageIdx }]);
    }
  }

  function removeStage(rowIndex: number) {
    const next = entries.filter((_, i) => i !== rowIndex);
    updateURL(next);
  }

  function reorderStage(fromIndex: number, toIndex: number) {
    const next = [...entries];
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    updateURL(next);
  }

  // Group catalog by logical columns
  const catalogMap = useMemo(() => {
    const map = new Map<string, CatalogCategory>();
    for (const cat of catalog) map.set(cat.key, cat);
    return map;
  }, [catalog]);

  return (
    <div>
      {/* Add Stage Button + Dropdown */}
      <div className="mb-4" ref={dropdownRef}>
        <button
          onClick={() => dropdownOpen ? closeDropdown() : openDropdown()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-slate-600"
        >
          <span className="text-sm leading-none">+</span>
          Add Stage
          <span className="text-[10px] text-slate-400 ml-0.5">{dropdownOpen ? '▴' : '▾'}</span>
        </button>

        {dropdownOpen && (
          <div className="mt-2 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden">
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
                              <span className={`truncate ${isSelected ? 'text-slate-900 font-medium' : 'text-slate-700'}`}>{stage.label}</span>
                              <span className="text-slate-300 tabular-nums flex-shrink-0 text-[10px] ml-auto">{stage.total}</span>
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

      {/* Table or Empty State */}
      {customStages.length > 0 ? (
        <PipelineTable
          title="Custom Pipeline"
          subtitle="Custom stage selection from all tables"
          metricType="cumulative"
          stages={customStages}
          tableKey="custom"
          onRemoveStage={removeStage}
          onReorderStage={reorderStage}
        />
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 py-16 text-center">
          <p className="text-sm font-medium text-slate-400">No stages selected</p>
          <p className="text-xs text-slate-300 mt-1">
            Use the dropdown above to add stages from any table
          </p>
        </div>
      )}
    </div>
  );
}

export function CustomPipelineBuilder({ catalog, customStages }: CustomPipelineBuilderProps) {
  return (
    <Suspense fallback={null}>
      <CustomBuilderInner catalog={catalog} customStages={customStages} />
    </Suspense>
  );
}
