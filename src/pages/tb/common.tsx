import React from 'react';
import { cx } from '../../components/ui';
import type { Basis } from '../../lib/tb';

export const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const pctFmt = (v: number | null | undefined, digits = 0) => (v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);

const BASIS: Record<Basis, { label: string; cls: string; title: string }> = {
  reported: { label: 'Reported', cls: 'bg-green-50 text-green-700 ring-green-200', title: 'Counted by a real system: WHO, DHIMS2, uploads or campaign reports' },
  measured: { label: 'Measured', cls: 'bg-sky-50 text-sky-700 ring-sky-200', title: 'From an open dataset: WorldPop, Malaria Atlas, OpenStreetMap, DHS' },
  estimated: { label: 'Estimated', cls: 'bg-amber-50 text-amber-800 ring-amber-200', title: 'Calculated from reported and measured data; see Data sources' },
};

/** Small tag saying where a number comes from. */
export function BasisTag({ b, className }: { b: Basis; className?: string }) {
  const x = BASIS[b];
  return <span title={x.title} className={cx('inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', x.cls, className)}>{x.label}</span>;
}

export function Figure({ label, value, basis, sub }: { label: string; value: React.ReactNode; basis: Basis; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 min-w-0">
      <div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500">{label}</span><BasisTag b={basis} /></div>
      <div className="text-xl font-semibold text-gray-900 tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export const PART_LABEL: Record<string, string> = { hiv: 'HIV', und: 'Undernourishment', smk: 'Smoking', alc: 'Harmful alcohol use', dia: 'Diabetes', other: 'Not linked to a listed risk factor' };
export const PART_COLOR: Record<string, string> = { hiv: '#b91c1c', und: '#ea580c', smk: '#ca8a04', alc: '#7c3aed', dia: '#0891b2', other: '#cbd5e1' };

/** Stacked bar of expected cases by WHO risk factor. */
export function PartsBar({ parts }: { parts: Record<string, number | undefined> }) {
  const keys = ['hiv', 'und', 'smk', 'alc', 'dia', 'other'].filter((k) => (parts[k] || 0) > 0);
  const total = keys.reduce((s, k) => s + (parts[k] || 0), 0) || 1;
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-[2px] bg-white">
        {keys.map((k) => <span key={k} style={{ width: `${((parts[k] || 0) / total) * 100}%`, background: PART_COLOR[k] }} title={`${PART_LABEL[k]}: ${Math.round(parts[k] || 0)}`} />)}
      </div>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
        {keys.map((k) => (
          <li key={k} className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 min-w-0"><span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PART_COLOR[k] }} /><span className="truncate">{PART_LABEL[k]}</span></span>
            <span className="tabular-nums text-gray-700">{Math.round(parts[k] || 0).toLocaleString('en-GB')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const kmFmt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
