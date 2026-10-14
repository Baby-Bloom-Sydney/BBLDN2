'use client';

/**
 * Verification-levels chart. Unit 3d re-labels the five levels to 3a's ladder (0 Unverified · 1 Registered ·
 * 2 ID verified · 3 Provisional, awaiting approval · 4 Fully verified). Never: computes levels itself.
 */
import { useState } from 'react';

interface LevelData {
  level: number;
  count: number;
}

interface VerificationLevelsProps {
  current: LevelData[];
  cumulative: LevelData[];
  failedCount: number;
}

const LABELS = [
  'Level 0 — Unverified',
  'Level 1 — Registered',
  'Level 2 — ID Verified',
  'Level 3 — Provisional (awaiting approval)',
  'Level 4 — Fully Verified',
];

const COLORS = ['#94a3b8', '#60a5fa', '#a78bfa', '#c084fc', '#34d399'];

export function VerificationLevels({
  current,
  cumulative,
  failedCount,
}: VerificationLevelsProps) {
  const [mode, setMode] = useState<'current' | 'cumulative'>('current');
  const data = mode === 'current' ? current : cumulative;

  const allCounts = [...data.map((v) => v.count), failedCount];
  const maxCount = Math.max(...allCounts, 1);

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900">
            Verification Levels
          </h3>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
              mode === 'current'
                ? 'bg-amber-50 text-amber-600'
                : 'bg-blue-50 text-blue-600'
            }`}
          >
            {mode}
          </span>
        </div>
        <div className="flex rounded-md border border-slate-200 overflow-hidden">
          <button
            onClick={() => setMode('current')}
            className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
              mode === 'current'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setMode('cumulative')}
            className={`px-2.5 py-1 text-[10px] font-medium transition-colors ${
              mode === 'cumulative'
                ? 'bg-slate-800 text-white'
                : 'bg-white text-slate-500 hover:bg-slate-50'
            }`}
          >
            Total
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-400 mb-3">
        {mode === 'current'
          ? 'Nannies currently at each verification level'
          : 'Total nannies that have reached each level'}
      </p>

      <div className="space-y-3">
        {data.map(({ level, count }) => {
          const barWidth = Math.max((count / maxCount) * 100, 4);
          return (
            <div key={level}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-slate-600">{LABELS[level]}</span>
                <span className="font-bold text-slate-900 tabular-nums">
                  {count}
                </span>
              </div>
              <div className="h-5 rounded bg-slate-100">
                <div
                  className="h-full rounded transition-all duration-500"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: COLORS[level],
                  }}
                />
              </div>
            </div>
          );
        })}

        {failedCount > 0 && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-600">Failed</span>
              <span className="font-bold text-slate-900 tabular-nums">
                {failedCount}
              </span>
            </div>
            <div className="h-5 rounded bg-slate-100">
              <div
                className="h-full rounded bg-red-400 transition-all duration-500"
                style={{
                  width: `${Math.max((failedCount / maxCount) * 100, 4)}%`,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
