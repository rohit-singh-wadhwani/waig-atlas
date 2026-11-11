import React from 'react';
import type { ProjectMilestone } from '../lib/types';
import { fmtDate } from '../lib/format';
import { cx } from './ui';
import { statusOf } from '../lib/projects';

const KIND_BAR: Record<string, string> = { todo: 'bg-gray-300', active: 'bg-brand-500', blocked: 'bg-amber-400', done: 'bg-green-600', lost: 'bg-red-400' };

export default function Gantt({ milestones, onSelect, selectedId }: { milestones: ProjectMilestone[]; onSelect?: (id: string) => void; selectedId?: string }) {
  const dated = milestones.filter((m) => m.start_date || m.target_date);
  if (!dated.length) return <p className="text-sm text-gray-500">Add start and target dates to milestones to see the timeline.</p>;
  const ts = dated.flatMap((m) => [m.start_date, m.target_date].filter(Boolean).map((d) => +new Date(d!)));
  ts.push(Date.now());
  const min = new Date(Math.min(...ts));
  min.setDate(1);
  const maxD = new Date(Math.max(...ts));
  const max = new Date(maxD.getFullYear(), maxD.getMonth() + 1, 1);
  const span = +max - +min;
  const pct = (d: number) => ((d - +min) / span) * 100;
  const months: Date[] = [];
  for (let d = new Date(min); d < max; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(d);
  const today = pct(Date.now());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-[200px_1fr] text-xs text-gray-500 mb-2">
          <span />
          <div className="relative h-5">
            {months.map((m, i) => (
              <span key={i} className="absolute top-0 whitespace-nowrap" style={{ left: `${pct(+m)}%` }}>
                {months.length > 14 && m.getMonth() % 2 ? '' : m.toLocaleDateString('en-GB', { month: 'short', year: m.getMonth() === 0 || i === 0 ? '2-digit' : undefined })}
              </span>
            ))}
          </div>
        </div>
        {milestones.map((m) => {
          const s = m.start_date ? +new Date(m.start_date) : m.target_date ? +new Date(m.target_date) - 14 * 86400000 : null;
          const e = m.target_date ? +new Date(m.target_date) : s;
          return (
            <button
              type="button"
              key={m.id}
              onClick={() => onSelect && onSelect(m.id)}
              className={cx('grid grid-cols-[200px_1fr] items-center w-full text-left py-1.5 rounded-lg hover:bg-gray-50', selectedId === m.id && 'bg-brand-50/70')}
            >
              <span className="text-sm text-gray-800 truncate pr-3 pl-1">{m.name}</span>
              <div className="relative h-7">
                {months.map((mo, i) => (
                  <span key={i} className="absolute top-0 bottom-0 border-l border-gray-100" style={{ left: `${pct(+mo)}%` }} />
                ))}
                {s !== null && e !== null && (
                  <span
                    className={cx('absolute top-1 h-5 rounded-md overflow-hidden', KIND_BAR[statusOf(m).kind])}
                    style={{ left: `${pct(s)}%`, width: `${Math.max(1.2, pct(e) - pct(s))}%` }}
                    title={`${m.name}: ${fmtDate(m.start_date)} → ${fmtDate(m.target_date)}`}
                  >
                    {statusOf(m).kind !== 'done' && m.progress > 0 && <span className="absolute inset-y-0 left-0 bg-black/15" style={{ width: `${m.progress}%` }} />}
                  </span>
                )}
                <span className="absolute top-0 bottom-0 border-l-2 border-red-400" style={{ left: `${today}%` }} />
              </div>
            </button>
          );
        })}
        <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-600 pl-1">
          {[['Done', 'bg-green-600'], ['In progress', 'bg-brand-500'], ['Blocked', 'bg-red-500'], ['Not started', 'bg-gray-300']].map(([l, c]) => (
            <span key={l} className="inline-flex items-center gap-1.5"><span className={cx('w-3 h-3 rounded-sm', c)} />{l}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="w-0 h-3 border-l-2 border-red-400" />Today</span>
        </div>
      </div>
    </div>
  );
}
