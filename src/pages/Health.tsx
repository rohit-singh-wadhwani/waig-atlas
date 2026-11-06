import React, { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge, Card, CardHeader, Empty, ExtLink, KpiCard, Select, cx } from '../components/ui';
import WorldMap, { MapPoint } from '../components/WorldMap';
import ChartCard from '../components/ChartCard';
import { useData } from '../lib/hooks';
import { loadHealth, loadInsights } from '../lib/store';
import { useWorld, NO_COUNTRIES, REGIONS } from '../lib/world';
import { fmtDate, fmtNum } from '../lib/format';

const NO_YEARS: number[] = [];

export default function HealthPage() {
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const health = useData(loadHealth, [], { updated_at: null, indicators: [] });
  const insights = useData(loadInsights, [], { items: [], updated_at: null });
  const inds = health.data.indicators;
  const [key, setKey] = useState('');
  const [year, setYear] = useState('');
  const [region, setRegion] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [showAlerts, setShowAlerts] = useState(true);

  const ind = inds.find((i) => i.key === key) || inds[0];
  useEffect(() => {
    if (ind && !key) setKey(ind.key);
  }, [ind, key]);
  const years = ind?.years ?? NO_YEARS;
  // default to the most recent year with decent coverage
  const bestYear = useMemo(() => {
    if (!ind) return '';
    const counts = years.map((y) => Object.values(ind.values).filter((v) => v[y] !== undefined).length);
    const max = Math.max(0, ...counts);
    for (let i = years.length - 1; i >= 0; i--) if (counts[i] >= max * 0.6) return String(years[i]);
    return String(years[years.length - 1] || '');
  }, [ind, years]);
  useEffect(() => setYear(bestYear), [bestYear]);

  const regionSet = useMemo(() => new Set(countries.filter((c) => !region || c.region === region).map((c) => c.iso3)), [countries, region]);
  const values = useMemo(() => {
    const out: Record<string, number> = {};
    if (!ind || !year) return out;
    for (const [iso, byYear] of Object.entries(ind.values)) if (byYear[year] !== undefined && (!region || regionSet.has(iso))) out[iso] = byYear[year];
    return out;
  }, [ind, year, region, regionSet]);

  const ranked = Object.entries(values).sort((a, b) => b[1] - a[1]);
  const nameOf = (iso: string) => countries.find((c) => c.iso3 === iso)?.name || iso;
  const median = ranked.length ? ranked[Math.floor(ranked.length / 2)][1] : null;
  const fmt = (v: number) => `${fmtNum(v, v < 10 ? 1 : 0)}`;

  const alerts = insights.data.items.filter((i) => i.kind === 'outbreak').sort((a, b) => b.published_at.localeCompare(a.published_at));
  const recentAlerts = alerts.filter((a) => Date.now() - +new Date(a.published_at) < 90 * 86400000);
  const points: MapPoint[] = showAlerts
    ? recentAlerts.flatMap((a) =>
        a.countries
          .map((iso) => countries.find((c) => c.iso3 === iso))
          .filter(Boolean)
          .map((c) => ({ id: a.id + c!.iso3, kind: 'Outbreak alert', lng: c!.lng, lat: c!.lat, size: 7, color: '#d03b3b', label: a.title, sub: `${c!.name} · ${fmtDate(a.published_at)} · ${a.source_name}`, items: a.summary ? [{ label: a.summary }] : [], href: a.url, cta: 'Read the notice' }))
      )
    : [];

  const trendIsos = sel ? [sel] : ranked.slice(0, 3).map(([i]) => i);
  const trend = ind ? trendIsos.map((iso) => ({ name: nameOf(iso), values: years.map((y) => ind.values[iso]?.[y] ?? NaN) })) : [];

  return (
    <>
      <PageHeader title="Global Health Map" subtitle="Disease burden from open datasets, with outbreak alerts layered on top. Prediction layers come next." updatedAt={health.data.updated_at} />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <Select className="w-[340px]" value={ind?.key || ''} onChange={(v) => { setKey(v); setSel(null); }} options={inds.map((i) => ({ value: i.key, label: i.name }))} />
        <Select className="w-[130px]" value={year} onChange={setYear} options={[...years].reverse().map((y) => ({ value: String(y), label: String(y) }))} />
        <Select className="w-[200px]" value={region} onChange={(r) => { setRegion(r); setSel(null); }} placeholder="All regions" options={REGIONS.map((r) => ({ value: r, label: r }))} />
        <Select className="w-[220px]" value={sel || ''} onChange={(v) => setSel(v || null)} placeholder="All countries" options={countries.filter((c) => !region || c.region === region).map((c) => ({ value: c.iso3, label: c.name }))} />
        <label className="inline-flex items-center gap-2 text-[15px] text-gray-700 bg-white border border-gray-200 rounded-xl px-4 h-11">
          <input type="checkbox" checked={showAlerts} onChange={(e) => setShowAlerts(e.target.checked)} className="accent-red-600" />
          Outbreak alerts (90d)
        </label>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard icon="database" label="Indicators loaded" value={inds.length} foot={`${new Set(inds.map((i) => i.source_name)).size} open sources`} />
        <KpiCard icon="globe" tint="blue" label="Countries with data" value={ranked.length} foot={year ? `for ${year}` : undefined} />
        <KpiCard icon="trending" tint="orange" label="Highest burden" value={ranked[0] ? fmt(ranked[0][1]) : '—'} foot={ranked[0] ? nameOf(ranked[0][0]) : undefined} onClick={() => ranked[0] && setSel(ranked[0][0])} />
        <KpiCard icon="activity" tint="purple" label="Median" value={median !== null ? fmt(median) : '—'} foot={ind?.unit} />
        <KpiCard icon="alert" tint="red" label="Outbreak alerts" value={recentAlerts.length} foot="WHO disease outbreak news, 90d" />
        <KpiCard icon="pin" tint="green" label={sel ? nameOf(sel) : 'Selected country'} value={sel && values[sel] !== undefined ? fmt(values[sel]) : '—'} foot={sel ? `${ind?.unit || ''} · rank ${ranked.findIndex(([i]) => i === sel) + 1 || '—'}` : 'click the map'} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6 mb-6">
        <Card>
          <CardHeader
            title={ind ? `${ind.name}, ${year}` : 'Health map'}
            subtitle={ind ? <span>Unit: {ind.unit} · Source: <ExtLink href={ind.source_url}>{ind.source_name}</ExtLink></span> : undefined}
          />
          <WorldMap geo={world?.geo || null} values={values} valueLabel={(v) => `${fmt(v)} ${ind?.unit || ''}`} legendTitle={ind?.unit} points={points} selected={sel} onCountryClick={(iso) => setSel(sel === iso ? null : iso)} height={480} />
          {!health.loading && !inds.length && <Empty icon="globe" title="No datasets yet">The health datasets job runs daily, or trigger it from GitHub Actions.</Empty>}
        </Card>
        <Card className="flex flex-col">
          <CardHeader title={region ? `Highest burden in ${region}` : 'Highest burden'} subtitle={ind ? `${ind.unit}, ${year}` : undefined} />
          <ol className="space-y-2 overflow-y-auto max-h-[480px] pr-1">
            {ranked.slice(0, 15).map(([iso, v], i) => (
              <li key={iso}>
                <button type="button" onClick={() => setSel(iso)} className={cx('w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-50', sel === iso && 'bg-brand-50')}>
                  <div className="flex justify-between text-[15px]">
                    <span className="text-gray-800"><span className="text-gray-400 tabular-nums mr-2">{i + 1}</span>{nameOf(iso)}</span>
                    <span className="tabular-nums font-medium text-gray-900">{fmt(v)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 mt-1 overflow-hidden">
                    <div className="h-full rounded-full bg-brand-500" style={{ width: `${(v / ranked[0][1]) * 100}%` }} />
                  </div>
                </button>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {ind && trend.length > 0 && (
          <ChartCard title={sel ? `${nameOf(sel)} over time` : 'Top 3 over time'} subtitle={`${ind.name} · ${ind.unit}`} labels={years.map(String)} series={trend} modes={['line', 'bars']} valueFmt={(v) => (isNaN(v) ? '—' : fmt(v))} />
        )}
        <Card>
          <CardHeader title="Outbreak alerts" subtitle="WHO Disease Outbreak News, newest first" />
          <ul className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
            {alerts.slice(0, 20).map((a) => (
              <li key={a.id} className="py-2.5">
                <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-gray-900 hover:text-brand-700">{a.title}</a>
                <div className="text-sm text-gray-500 flex gap-2 mt-0.5">
                  <span>{fmtDate(a.published_at)}</span>
                  {a.diseases?.slice(0, 2).map((d) => <Badge key={d} className="bg-red-50 text-red-700">{d}</Badge>)}
                </div>
              </li>
            ))}
          </ul>
          {!alerts.length && <Empty icon="alert" title="No alerts loaded yet" />}
        </Card>
      </div>
    </>
  );
}
