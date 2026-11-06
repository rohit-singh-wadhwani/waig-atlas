import React from 'react';
import type { StageMilestone } from '../lib/types';
import { daysUntil, fmtDate } from '../lib/format';
import Icon from './Icon';
import { cx } from './ui';

/** Checkpoints as a connected row of cards that wraps cleanly at any width. */
export default function Stepper({ stages, onChange, compact }: { stages: StageMilestone[]; onChange?: (s: StageMilestone[]) => void; compact?: boolean }) {
  const set = (i: number, patch: Partial<StageMilestone>) => onChange && onChange(stages.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const current = stages.findIndex((s) => !s.done_at);
  const doneCount = stages.filter((s) => s.done_at).length;

  return (
    <div>
      {/* progress rail */}
      <div className="flex items-center gap-1.5 mb-3" aria-hidden="true">
        {stages.map((s, i) => (
          <span key={s.key} className={cx('h-1.5 flex-1 rounded-full', s.done_at ? 'bg-green-600' : i === current ? 'bg-brand-400' : 'bg-gray-200')} />
        ))}
        <span className="text-xs text-gray-500 tabular-nums pl-2 shrink-0">{doneCount}/{stages.length}</span>
      </div>
      <ol className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${compact ? 120 : 190}px, 1fr))` }}>
        {stages.map((s, i) => {
          const done = !!s.done_at;
          const active = i === current;
          const d = daysUntil(s.target);
          const late = !done && d !== null && d < 0;
          return (
            <li key={s.key} className={cx('rounded-xl border p-3.5 min-w-0 flex flex-col', done ? 'border-green-200 bg-green-50/60' : active ? 'border-brand-300 bg-brand-50/70' : 'border-gray-200 bg-white')}>
              <div className="flex items-start gap-2.5">
                <button
                  type="button"
                  disabled={!onChange}
                  onClick={() => set(i, { done_at: done ? null : new Date().toISOString() })}
                  className={cx('mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors', done ? 'bg-green-600 border-green-600 text-white' : active ? 'border-brand-500 text-brand-600 bg-white' : 'border-gray-300 text-gray-400 bg-white', onChange && 'hover:ring-2 hover:ring-brand-100')}
                  title={done ? 'Mark not done' : 'Mark done'}
                  aria-label={`${s.label}: ${done ? 'done, click to undo' : 'click to mark done'}`}
                >
                  {done ? <Icon name="check" size={14} strokeWidth={3} /> : <span className="text-[11px] font-semibold">{i + 1}</span>}
                </button>
                <span className="font-medium text-gray-900 text-[15px] leading-snug min-w-0 break-words">{s.label}</span>
              </div>
              {!compact && (
                <div className="mt-3 space-y-1.5">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-gray-500">Target date</div>
                  {onChange ? (
                    <input
                      type="date"
                      aria-label={`${s.label} target date`}
                      value={(s.target || '').slice(0, 10)}
                      onChange={(e) => set(i, { target: e.target.value || null })}
                      className="w-full min-w-0 border border-gray-200 rounded-lg px-2.5 h-9 text-sm text-gray-800 bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
                    />
                  ) : (
                    <div className="text-sm text-gray-800">{fmtDate(s.target)}</div>
                  )}
                  <div className={cx('text-xs pt-0.5', done ? 'text-green-700' : late ? 'text-red-600' : 'text-gray-500')}>
                    {done ? `Done ${fmtDate(s.done_at)}` : late ? `${-d!}d overdue` : d !== null ? `${d}d to go` : 'No target set'}
                  </div>
                  {s.note && <div className="text-xs text-gray-500 leading-snug">{s.note}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
