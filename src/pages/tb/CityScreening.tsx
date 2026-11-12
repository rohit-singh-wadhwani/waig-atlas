import React, { useEffect, useMemo, useState } from 'react';
import TbMap, { breaksFor, TbLegend } from '../../components/TbMap';
import { Button, Card, CardHeader, Empty, Segmented, cx } from '../../components/ui';
import TitleSelect from '../../components/TitleSelect';
import { expectedPositivity, fmtInt, TbCampaign, TbHex, TbSite } from '../../lib/tb';
import { BasisTag, esc, kmFmt } from './common';
import type { TbData } from './TbPage';

type Metric = 'expected_km2' | 'density';
const DEDUPE_KM = 0.6; // venues closer than this share most of their catchment; keep the larger one

const distKm = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const dy = (a.lat - b.lat) * 110.57, dx = (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
};

export default function CityScreening({ data, onPlan }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void }) {
  const { layers, cities, dist, P, campaigns } = data;
  const [city, setCity] = useState('');
  const [metric, setMetric] = useState<Metric>('expected_km2');
  const [showFac, setShowFac] = useState(false);
  const [picked, setPicked] = useState<TbSite | null>(null);
  const [all, setAll] = useState(false);
  const enabled = cities.data.filter((c) => c.enabled !== false);
  useEffect(() => {
    if (!city && enabled.length) setCity(enabled[0].id);
  }, [city, enabled]);
  useEffect(() => setPicked(null), [city]);
  const c = enabled.find((x) => x.id === city);
  const nat = dist.data.meta?.national;
  const natRate = nat ? (nat.incidence / nat.pop) * 1e5 : null;
  const catchment = dist.data.meta?.method?.catchment_km;

  const hexFc = useMemo(() => {
    const fc = layers.data.cities;
    if (!fc || !city) return null;
    return { type: 'FeatureCollection', features: fc.features.filter((f: any) => f.properties.city === city) };
  }, [layers.data.cities, city]);
  const hexes: TbHex[] = useMemo(() => (hexFc ? hexFc.features.map((f: any) => f.properties) : []), [hexFc]);
  const breaks = useMemo(() => breaksFor(hexes.map((h) => Number(h[metric]))), [hexes, metric]);
  const fit = useMemo<[number, number, number, number] | null>(() => {
    if (!c) return null;
    const dLat = c.radius_km / 110.57, dLon = c.radius_km / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat];
  }, [c]);

  // screening venues inside the city: markets and lorry stations, ranked by expected cases among people within walking distance
  const venues = useMemo(() => {
    if (!c) return [] as TbSite[];
    const inCity = layers.data.siteList
      .filter((s) => (s.kind === 'market' || s.kind === 'transport hub') && distKm(s, c) <= c.radius_km && (s.expected_1km ?? 0) > 0)
      .sort((a, b) => (b.expected_1km ?? 0) - (a.expected_1km ?? 0));
    const kept: TbSite[] = [];
    for (const s of inCity) if (!kept.some((k) => distKm(k, s) < DEDUPE_KM)) kept.push(s);
    // venues that already have a campaign come first
    const has = (s: TbSite) => campaigns.data.some((cp) => cp.status !== 'cancelled' && cp.name === `${s.name || 'Market'}: TB screening`);
    return [...kept.filter(has), ...kept.filter((s) => !has(s))];
  }, [layers.data.siteList, c, campaigns.data]);
  const campOf = (s: TbSite) => campaigns.data.find((cp) => cp.status !== 'cancelled' && cp.name === `${s.name || 'Market'}: TB screening`);
  const venueFc = useMemo(() => ({ type: 'FeatureCollection', features: venues.slice(0, all ? venues.length : 20).map((s) => ({ type: 'Feature', properties: s, geometry: { type: 'Point', coordinates: [s.lon, s.lat] } })) }), [venues, all]);
  const facFc = useMemo(() => {
    const fc = layers.data.facilities;
    if (!showFac || !fc || !fit) return null;
    return { type: 'FeatureCollection', features: fc.features.filter((f: any) => { const [x, y] = f.geometry.coordinates; return x >= fit[0] && x <= fit[2] && y >= fit[1] && y <= fit[3]; }) };
  }, [layers.data.facilities, showFac, fit]);
  const totals = useMemo(() => ({ pop: hexes.reduce((s, h) => s + h.pop, 0), exp: hexes.reduce((s, h) => s + h.expected, 0) }), [hexes]);

  const tip = (pr: any, layer: string) => {
    if (layer === 'site') return `<b>${esc(pr.name || 'Unnamed ' + pr.kind)}</b><br/>${esc(pr.kind)} · ${fmtInt(Number(pr.pop_1km))} people within 1 km<br/>≈${Number(pr.expected_1km).toFixed(0)} TB cases a year among them`;
    if (layer === 'facility') return `<b>${esc(pr.name || 'Health facility')}</b><br/>${esc(pr.kind)}`;
    return `<b>${esc(pr.district)}</b><br/>${fmtInt(Number(pr.pop))} people · ${fmtInt(Number(pr.density))} per km²<br/>≈${Number(pr.expected).toFixed(1)} TB cases a year expected<br/>Nearest facility ${kmFmt(Number(pr.facility_km))}`;
  };

  if (!enabled.length || !hexes.length) return <Empty icon="map" title="No city data yet">Add a city on the Data & method tab; it is mapped at the next weekly run.</Empty>;
  const shown = venues.slice(0, all ? venues.length : 20);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_480px] gap-6 items-start">
        <Card className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            {enabled.length > 1 ? <TitleSelect label="City" value={city} onChange={setCity} options={enabled.map((x) => ({ value: x.id, label: x.name }))} /> : <h3 className="text-xl font-semibold">{c?.name}</h3>}
            <Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'expected_km2', label: 'Expected cases per km²' }, { value: 'density', label: 'People per km²' }]} />
          </div>
          <p className="text-[15px] text-gray-500 mt-1 mb-4">{`${fmtInt(totals.pop)} people within ${c?.radius_km} km · about ${fmtInt(totals.exp)} TB cases expected a year`}</p>
          <TbMap hexes={hexFc} sites={venueFc} facilities={facFc} metric={metric} breaks={breaks} fit={fit} highlight={picked ? [picked.lon, picked.lat] : null} tooltip={tip} height={620} />
          <div className="flex flex-wrap items-start justify-between gap-3">
            <TbLegend title={metric === 'density' ? 'People per km²' : 'Expected cases per km² a year'} breaks={breaks} fmt={(v) => (metric === 'density' ? fmtInt(v) : v < 0.1 ? v.toFixed(2) : v.toFixed(1))} sites />
            <label className="inline-flex items-center gap-2 mt-3 text-sm text-gray-700 cursor-pointer select-none"><input type="checkbox" checked={showFac} onChange={(e) => setShowFac(e.target.checked)} /> Health facilities</label>
          </div>
        </Card>

        <Card className="min-w-0" pad={false}>
          <div className="p-6 pb-3">
            <CardHeader title="Best places to hold screening" subtitle={`Markets and lorry stations, ranked by TB cases expected each year among people living within ${catchment ?? 1} km. Nearby duplicates merged.`} />
          </div>
          <ol className="divide-y divide-gray-100 border-t border-gray-100">
            {shown.map((s, i) => {
              const p = expectedPositivity('market', dist.data.list.find((d) => d.id === s.district_id), P, natRate);
              return (
                <li key={i} className={cx('px-6 py-3 flex gap-3 cursor-pointer hover:bg-gray-50', picked === s && 'bg-gray-50', campOf(s) && 'bg-green-50/60')} onClick={() => setPicked(s)}>
                  <span className="w-6 text-sm text-gray-400 tabular-nums pt-0.5">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-gray-900 truncate">{s.name || `Unnamed ${s.kind}`}</span>
                      <span className="shrink-0 text-right"><span className="tabular-nums font-semibold">{fmtInt(s.expected_1km)}</span><span className="text-xs text-gray-500"> cases/yr nearby</span></span>
                    </span>
                    <span className="block text-xs text-gray-500">{s.kind === 'transport hub' ? 'Lorry station / bus terminal' : 'Market'} · {s.district} · {fmtInt(s.pop_1km)} people within 1 km</span>
                    {campOf(s) && <span className="inline-block mt-1 text-[11px] px-1.5 py-px rounded bg-green-100 text-green-800 font-medium">✓ Campaign {campOf(s)!.status}</span>}
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-600">
                      <span>Nearest facility {kmFmt(s.facility_km)}{s.walk_min != null ? ` · ${s.walk_min < 5 ? 'under 5' : fmtInt(s.walk_min)} min walk` : ''}</span>
                      {p != null && <span>≈1 case per {fmtInt(1 / p)} screened</span>}
                    </span>
                  </span>
                  <Button className="shrink-0 self-center" onClick={(e: any) => { e.stopPropagation(); onPlan({ name: `${s.name || 'Market'}: TB screening`, city, district_id: s.district_id, district_name: s.district, setting: 'market', playbook_id: 'acf_congregate' }); }}>Plan</Button>
                </li>
              );
            })}
          </ol>
          {venues.length > 20 && <div className="px-6 py-3 border-t border-gray-100"><button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setAll(!all)}>{all ? 'Show top 20' : `Show all ${venues.length}`}</button></div>}
          <div className="px-6 pb-5 pt-2 text-xs text-gray-500 space-y-1">
            <div><BasisTag b="measured" /> People within 1 km: WorldPop 100 m grid. Venues and facilities: OpenStreetMap.</div>
            <div><BasisTag b="estimated" /> Cases nearby: people within 1 km × the district's expected rate. Yield: general-population screening yield scaled to the district.</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
