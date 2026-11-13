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

export const kmFmt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);
