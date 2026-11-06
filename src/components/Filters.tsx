import React from 'react';
import { Segmented, Select } from './ui';
import type { Country } from '../lib/types';
import { REGIONS } from '../lib/world';

export type Range = '7' | '30' | '90' | 'all';
export type Filters = { range: Range; from: string; to: string; region: string; country: string };
export const defaultFilters: Filters = { range: 'all', from: '', to: '', region: '', country: '' };

export function FilterBar({
  value, onChange, countries, rangeLabel = 'all', children, ranges = ['7', '30', '90', 'all'], rangeNames,
}: {
  value: Filters;
  onChange: (f: Filters) => void;
  countries: Country[];
  rangeLabel?: string;
  children?: React.ReactNode;
  ranges?: Range[];
  rangeNames?: Partial<Record<Range, string>>;
}) {
  const names: Record<Range, string> = { '7': '7 days', '30': '30 days', '90': '90 days', all: 'All time', ...rangeNames };
  const inRegion = value.region ? countries.filter((c) => c.region === value.region) : countries;
  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <Segmented value={value.range} onChange={(r) => onChange({ ...value, range: r, from: '', to: '' })} options={ranges.map((r) => ({ value: r, label: names[r] }))} />
      <input type="date" aria-label="From date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value, range: 'all' })} className="bg-white border border-gray-200 rounded-xl px-3 h-11 text-[15px] text-gray-700" />
      <span className="text-gray-400">to</span>
      <input type="date" aria-label="To date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value, range: 'all' })} className="bg-white border border-gray-200 rounded-xl px-3 h-11 text-[15px] text-gray-700" />
      <Select className="w-[200px]" value={value.region} onChange={(r) => onChange({ ...value, region: r, country: '' })} placeholder="All regions" options={REGIONS.map((r) => ({ value: r, label: r }))} />
      <Select className="w-[220px]" value={value.country} onChange={(c) => onChange({ ...value, country: c })} placeholder="All countries" options={inRegion.map((c) => ({ value: c.iso3, label: c.name }))} />
      {children}
    </div>
  );
}

/** Does an item's date fall within the chosen window? `future` windows look ahead (deadlines). */
export function inWindow(dateIso: string | null | undefined, f: Filters, future = false): boolean {
  if (f.from || f.to) {
    if (!dateIso) return false;
    const d = dateIso.slice(0, 10);
    if (f.from && d < f.from) return false;
    if (f.to && d > f.to) return false;
    return true;
  }
  if (f.range === 'all') return true;
  if (!dateIso) return false;
  const n = Number(f.range);
  const t = +new Date(dateIso);
  const now = Date.now();
  return future ? t >= now - 86400000 && t <= now + n * 86400000 : t >= now - n * 86400000;
}

export function matchesPlace(isoList: string[] | undefined, f: Filters, countries: Country[]): boolean {
  const list = isoList || [];
  if (f.country) return list.includes(f.country) || list.includes('GLOBAL');
  if (f.region) {
    if (list.includes('GLOBAL')) return true;
    const set = new Set(countries.filter((c) => c.region === f.region).map((c) => c.iso3));
    return list.some((i) => set.has(i));
  }
  return true;
}
