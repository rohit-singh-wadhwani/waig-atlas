import React from 'react';
import type { StageMilestone } from '../lib/types';
import { daysUntil, fmtDate } from '../lib/format';
import Icon from './Icon';
import { cx } from './ui';

export default function Stepper({ stages, onChange, compact }: { stages: StageMilestone[]; onChange?: (s: StageMilestone[]) => void; compact?: boolean }) {
  const set = (i: number, patch: Partial<StageMilestone>) => onChange && onChange(stages.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const current = stages.findIndex((s) => !s.done_at);
  return (
    <ol className={cx('grid gap-3', compact ? 'grid-cols-4' : 'grid-cols-1 sm:grid-cols-2 xl:grid-cols-4')}>
      {stages.map((s, i) => {
        const done = !!s.done_at;
        const active = i === current;
        const d = daysUntil(s.target);
        const late = !done && d !== null && d < 0;
        return (
          <li key={s.key} className={cx('rounded-xl border p-3', done ? 'border-green-200 bg-green-50/50' : active ? 'border-brand-300 bg-brand-50/60' : 'border-gray-200 bg-white')}>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!onChange}
                onClick={() => set(i, { done_at: done ? null : new Date().toISOString() })}
                className={cx('w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0', done ? 'bg-green-600 border-green-600 text-white' : active ? 'border-brand-500 text-brand-600' : 'border-gray-300 text-gray-400')}
                title={done ? 'Mark not done' : 'Mark done'}
              >
                {done ? <Icon name="check" size={14} strokeWidth={3} /> : <span className="text-[11px] font-semibold">{i + 1}</span>}
              </button>
              <span className="font-medium text-gray-900 text-[15px]">{s.label}</span>
            </div>
            {!compact && (
              <div className="mt-2 text-sm">
                {onChange ? (
                  <label className="flex items-center gap-2 text-gray-500">
                    Target
                    <input type="date" value={(s.target || '').slice(0, 10)} onChange={(e) => set(i, { target: e.target.value || null })} className="border border-gray-200 rounded-lg px-2 h-8 text-gray-800 bg-white" />
                  </label>
                ) : (
                  <span className="text-gray-500">Target {fmtDate(s.target)}</span>
                )}
                <div className={cx('mt-1 text-xs', done ? 'text-green-700' : late ? 'text-red-600' : 'text-gray-500')}>
                  {done ? `Done ${fmtDate(s.done_at)}` : late ? `${-d!}d overdue` : d !== null ? `${d}d to go` : 'No target set'}
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
