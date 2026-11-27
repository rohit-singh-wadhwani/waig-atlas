import React, { useState } from 'react';
import { cx } from '../../components/ui';
import type { Basis } from '../../lib/tb';

export const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
export const pctFmt = (v: number | null | undefined, digits = 0) => (v == null || !isFinite(v) ? '—' : `${(v * 100).toFixed(digits)}%`);

export const BASIS: Record<Basis, { label: string; cls: string; title: string }> = {
  reported: { label: 'Reported', cls: 'bg-green-50 text-green-700 ring-green-200', title: 'Counted by a real system: WHO, DHIMS2, uploads or campaign reports' },
  measured: { label: 'Measured', cls: 'bg-sky-50 text-sky-700 ring-sky-200', title: 'From an open dataset: WorldPop, Malaria Atlas, OpenStreetMap, DHS' },
  estimated: { label: 'Estimated', cls: 'bg-amber-50 text-amber-800 ring-amber-200', title: 'Calculated from reported and measured data; see Data sources' },
};

/** Small tag saying where a number comes from. `bare` drops the browser tooltip when a richer one is shown. */
export function BasisTag({ b, className, bare }: { b: Basis; className?: string; bare?: boolean }) {
  const x = BASIS[b];
  return <span title={bare ? undefined : x.title} className={cx('inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset whitespace-nowrap', x.cls, className)}>{x.label}</span>;
}

export const kmFmt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : v < 1 ? `${Math.round(v * 1000)} m` : `${v.toFixed(1)} km`);

export function Panel({ title, sub, right, children, className }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-2xl border border-gray-200 bg-white p-5', className)}>
      {(title || right) && (
        <div className="mb-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {title && <h3 className="text-base font-semibold text-gray-900 min-w-0">{title}</h3>}
            {right}
          </div>
          {sub && <p className="text-sm text-gray-500 mt-1">{sub}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

/** One hover/focus popover for an explanation, positioned so it never leaves the screen. */
export function Tip({ text, label, children }: { text: React.ReactNode; label: string; children: React.ReactNode }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const show = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const w = 300;
    setPos({ x: Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)), y: r.bottom + 6 });
  };
  return (
    <span className="inline-flex shrink-0 cursor-help" tabIndex={0} aria-label={label}
      onMouseEnter={(e) => show(e.currentTarget)} onMouseLeave={() => setPos(null)}
      onFocus={(e) => show(e.currentTarget)} onBlur={() => setPos(null)}>
      {children}
      {pos && <span role="tooltip" className="fixed z-50 w-[300px] rounded-lg bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg pointer-events-none" style={{ left: pos.x, top: pos.y }}>{text}</span>}
    </span>
  );
}

/** The Reported / Measured / Estimated tag; hovering shows what the tag means and how this number was made. */
export function HowTag({ b, how }: { b: 'reported' | 'measured' | 'estimated'; how?: string }) {
  const x = BASIS[b];
  return (
    <Tip label={`${x.label}: ${how || x.title}`} text={<><b>{x.label}:</b> {x.title.charAt(0).toLowerCase() + x.title.slice(1)}.{how && <span className="block mt-1.5">{how}</span>}</>}>
      <BasisTag b={b} bare />
    </Tip>
  );
}

/** A "?" that explains a term or a figure on hover. */
export function Why({ text }: { text: string }) {
  return <Tip label={text} text={text}><span className="w-4 h-4 rounded-full border border-gray-400 text-gray-500 text-[10px] font-semibold grid place-items-center hover:border-gray-700 hover:text-gray-800">?</span></Tip>;
}

export function Stat({ label, value, sub, basis, how }: { label: string; value: React.ReactNode; sub?: React.ReactNode; basis?: 'reported' | 'measured' | 'estimated'; how?: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 min-w-0">
      <div className="flex items-start justify-between gap-2 text-xs text-gray-500"><span className="min-w-0">{label}</span>{basis && <HowTag b={basis} how={how} />}</div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/** The screening cascade as a horizontal funnel: one column per step, block height to scale, each label on one line,
 *  and the share kept from the step before. `t` uses campaign result keys (see cascadeTotals). */
const FUNNEL: { key: string; label: string; tone: string }[] = [
  { key: 'screened', label: 'Screened', tone: 'bg-brand-300' }, { key: 'presumptive', label: 'Symptomatic', tone: 'bg-brand-500' },
  { key: 'tested', label: 'Tested', tone: 'bg-brand-600' }, { key: 'confirmed', label: 'TB found', tone: 'bg-red-700' },
  { key: 'started_treatment', label: 'Treated', tone: 'bg-green-600' },
];
export function Funnel({ t }: { t: Record<string, number> }) {
  const top = Math.max(t.screened || 0, 1);
  return (
    <div>
      <ol className="grid grid-cols-5 gap-1">
        {FUNNEL.map((s, i) => {
          const v = t[s.key] || 0, prev = i ? t[FUNNEL[i - 1].key] || 0 : 0;
          return (
            <li key={s.key} className="min-w-0">
              <div className="text-[11px] text-gray-500 whitespace-nowrap truncate">{s.label}</div>
              <div className="text-[15px] font-semibold tabular-nums text-gray-900 whitespace-nowrap">{v.toLocaleString('en-GB')}</div>
              <div className="h-12 flex items-center"><div className={cx('w-full rounded-sm', s.tone)} style={{ height: `${Math.max(6, (v / top) * 48)}px` }} /></div>
              <div className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap">{i ? (prev ? `${Math.round((v / prev) * 100)}%` : '—') : ' '}</div>
            </li>
          );
        })}
      </ol>
      <p className="text-[11px] text-gray-400 mt-0.5">Each % is the share of the step before.</p>
    </div>
  );
}
