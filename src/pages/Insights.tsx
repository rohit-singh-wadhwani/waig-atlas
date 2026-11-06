import React, { useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge, Card, CardHeader, Empty, KpiCard, TextInput } from '../components/ui';
import { FilterBar, Filters, defaultFilters, inWindow, matchesPlace } from '../components/Filters';
import ChartCard from '../components/ChartCard';
import Icon, { IconName } from '../components/Icon';
import { useData } from '../lib/hooks';
import { loadInsights } from '../lib/store';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { fmtDate } from '../lib/format';
import type { Insight } from '../lib/types';
import { placeLabel } from './Grants';

export const KINDS: { value: Insight['kind']; label: string; icon: IconName; tint: string; cls: string }[] = [
  { value: 'news', label: 'News', icon: 'newspaper', tint: 'teal', cls: 'bg-brand-50 text-brand-700' },
  { value: 'outbreak', label: 'Outbreaks', icon: 'alert', tint: 'red', cls: 'bg-red-50 text-red-700' },
  { value: 'research', label: 'Research', icon: 'flask', tint: 'purple', cls: 'bg-purple-50 text-purple-700' },
  { value: 'social', label: 'Social', icon: 'message', tint: 'blue', cls: 'bg-blue-50 text-blue-700' },
  { value: 'tender', label: 'Tenders', icon: 'clipboard', tint: 'orange', cls: 'bg-orange-50 text-orange-700' },
  { value: 'report', label: 'Reports', icon: 'file', tint: 'gray', cls: 'bg-gray-100 text-gray-700' },
];

export default function InsightsPage() {
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const feed = useData(loadInsights, [], { items: [], updated_at: null });
  const [f, setF] = useState<Filters>({ ...defaultFilters, range: '30' });
  const [kind, setKind] = useState<string>('');
  const [q, setQ] = useState('');

  const base = useMemo(() => {
    const ql = q.toLowerCase();
    return feed.data.items
      .filter((i) => inWindow(i.published_at, f))
      .filter((i) => matchesPlace(i.countries, f, countries))
      .filter((i) => !ql || `${i.title} ${i.summary} ${(i.diseases || []).join(' ')}`.toLowerCase().includes(ql))
      .sort((a, b) => b.published_at.localeCompare(a.published_at));
  }, [feed.data.items, f, q, countries]);
  const list = kind ? base.filter((i) => i.kind === kind) : base;

  const days = useMemo(() => {
    const n = f.range === 'all' ? 30 : Math.min(Number(f.range), 90);
    return Array.from({ length: n }, (_, k) => {
      const d = new Date();
      d.setDate(d.getDate() - (n - 1 - k));
      return d.toISOString().slice(0, 10);
    });
  }, [f.range]);
  const activeKinds = KINDS.filter((k) => base.some((i) => i.kind === k.value));

  return (
    <>
      <PageHeader title="Latest Insights" subtitle="Public-health news, outbreaks, research, social updates and tenders, summarised" updatedAt={feed.data.updated_at} />
      <FilterBar value={f} onChange={setF} countries={countries}>
        <div className="relative">
          <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <TextInput placeholder="Search insights" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-[240px]" />
        </div>
      </FilterBar>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        {KINDS.map((k) => (
          <KpiCard key={k.value} icon={k.icon} tint={k.tint} label={k.label} value={base.filter((i) => i.kind === k.value).length} foot={kind === k.value ? 'showing only these' : 'click to filter'} onClick={() => setKind(kind === k.value ? '' : k.value)} />
        ))}
      </div>

      <div className="mb-6">
        <ChartCard
          title="Insights over time"
          subtitle="By publication date"
          labels={days.map((d) => fmtDate(d, { day: 'numeric', month: 'short' }))}
          series={activeKinds.slice(0, 3).map((k) => ({ name: k.label, values: days.map((d) => base.filter((i) => i.kind === k.value && i.published_at.slice(0, 10) === d).length) }))}
          modes={['stacked', 'line', 'area']}
          height={240}
          footer={activeKinds.length > 3 ? 'Showing the three busiest types; filter to see others.' : undefined}
        />
      </div>

      <Card pad={false}>
        <div className="p-6 pb-2">
          <CardHeader title={kind ? KINDS.find((k) => k.value === kind)!.label : 'All insights'} subtitle={`${list.length} items`} right={kind ? <button type="button" className="text-sm text-brand-700" onClick={() => setKind('')}>Show all types</button> : undefined} />
        </div>
        <ul className="divide-y divide-gray-100">
          {list.slice(0, 200).map((i) => {
            const k = KINDS.find((x) => x.value === i.kind) || KINDS[0];
            return (
              <li key={i.id} className="px-6 py-4 flex gap-4">
                <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${k.cls}`}>
                  <Icon name={k.icon} size={19} />
                </span>
                <div className="min-w-0 flex-1">
                  <a href={i.url} target="_blank" rel="noreferrer" className="font-medium text-[16px] text-gray-900 hover:text-brand-700">{i.title}</a>
                  {i.summary && <p className="text-[15px] text-gray-600 mt-1 line-clamp-3">{i.summary}</p>}
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-sm text-gray-500">
                    <Badge className={k.cls}>{k.label}</Badge>
                    <span>{i.source_name}</span>
                    <span>· {fmtDate(i.published_at)}</span>
                    {i.countries?.length ? <span>· {placeLabel(i.countries, countries)}</span> : null}
                    {i.diseases?.slice(0, 3).map((d) => <Badge key={d} className="bg-gray-100 text-gray-700">{d}</Badge>)}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        {!feed.loading && list.length === 0 && (
          <Empty icon="newspaper" title="Nothing in this window">{feed.data.items.length ? 'Widen the date range or clear filters.' : 'The insights job runs every 3 hours, or trigger it from GitHub Actions.'}</Empty>
        )}
      </Card>
    </>
  );
}
