import React, { useEffect, useMemo, useState } from 'react';
import TbMap, { breaksFor, TbLegend } from '../../components/TbMap';
import { Button, Card, CardHeader, Empty, Segmented, Select } from '../../components/ui';
import { fmtInt, TbCampaign, TbHex } from '../../lib/tb';
import type { TbData } from './TbPage';

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const HEX_METRICS = [
  { key: 'hidden', label: 'Hidden cases', fmt: (v: number) => v.toFixed(1), help: 'Estimated undiagnosed cases per year in each ~0.7 km² hexagon.' },
  { key: 'hidden_100k', label: 'Hidden per 100k', fmt: (v: number) => v.toFixed(0), help: 'Undiagnosed cases per 100,000 residents.' },
  { key: 'density', label: 'People per km²', fmt: (v: number) => Math.round(v).toLocaleString('en-GB'), help: 'WorldPop 100 m population.' },
];

function reasons(h: TbHex) {
  const r: string[] = [];
  if (h.density > 15000) r.push('very dense');
  else if (h.density > 6000) r.push('dense');
  if (h.rwi < -0.2) r.push('poorer area');
  if (h.facility_km > 2) r.push(`${h.facility_km.toFixed(1)} km to nearest facility`);
  if (h.sites?.length) r.push(`near ${h.sites.join(', ')}`);
  return r;
}

export default function CityView({ data, onPlan }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void }) {
  const { layers, cities, dist } = data;
  const [city, setCity] = useState<string>('');
  const [metric, setMetric] = useState('hidden');
  const [show, setShow] = useState({ facilities: true, sites: true });
  const [picked, setPicked] = useState<string[]>([]);
  const enabled = cities.data.filter((c) => c.enabled !== false);
  useEffect(() => {
    if (!city && enabled.length) setCity(enabled[0].id);
  }, [city, enabled]);
  const c = enabled.find((x) => x.id === city);
  const hexFc = useMemo(() => {
    const fc = layers.data.cities;
    if (!fc || !city) return null;
    return { type: 'FeatureCollection', features: fc.features.filter((f: any) => f.properties.city === city) };
  }, [layers.data.cities, city]);
  const hexes: TbHex[] = useMemo(() => (hexFc ? hexFc.features.map((f: any) => f.properties) : []), [hexFc]);
  const m = HEX_METRICS.find((x) => x.key === metric)!;
  const breaks = useMemo(() => breaksFor(hexes.map((h) => Number((h as any)[metric]))), [hexes, metric]);
  const top = useMemo(() => [...hexes].sort((a, b) => b.hidden - a.hidden).slice(0, 12), [hexes]);
  const fit = useMemo<[number, number, number, number] | null>(() => {
    if (!c) return null;
    const dLat = c.radius_km / 110.57, dLon = c.radius_km / (111.32 * Math.cos((c.lat * Math.PI) / 180));
    return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat];
  }, [c]);
  const clip = (fc: any) => (fc && fit ? { type: 'FeatureCollection', features: fc.features.filter((f: any) => { const [x, y] = f.geometry.coordinates; return x >= fit[0] && x <= fit[2] && y >= fit[1] && y <= fit[3]; }) } : null);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const pickedHexes = hexes.filter((h) => picked.includes(h.h3));

  const plan = () => {
    const byD: Record<string, number> = {};
    for (const h of pickedHexes) byD[h.district] = (byD[h.district] || 0) + h.pop;
    const dname = Object.entries(byD).sort((a, b) => b[1] - a[1])[0]?.[0];
    const d = dist.data.list.find((x) => x.name === dname);
    onPlan({ name: `${c?.name.split(' (')[0]}: ${pickedHexes.length} hotspot area${pickedHexes.length > 1 ? 's' : ''}`, city, district_id: d?.id, district_name: d?.name, hex_ids: picked, setting: 'community', playbook_id: 'acf_community', target_screened: Math.round(pickedHexes.reduce((s, h) => s + h.pop, 0) * 0.6 * 0.3) });
  };

  if (!enabled.length) return <Empty icon="map" title="No cities configured">Add a city on the Evidence & data tab.</Empty>;
  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
      <Card className="min-w-0">
        <CardHeader
          title={c?.name || 'City'}
          subtitle={`${m.help} Click hexagons to select an area for a campaign.`}
          right={
            <div className="flex flex-wrap gap-2">
              <Select className="w-[200px] [&_select]:h-9 [&_select]:text-sm" value={city} onChange={(v) => { if (v) { setCity(v); setPicked([]); } }} options={enabled.map((x) => ({ value: x.id, label: x.name.split(' (')[0] }))} />
              <Segmented size="sm" value={metric} onChange={setMetric} options={HEX_METRICS.map((x) => ({ value: x.key, label: x.label }))} />
            </div>
          }
        />
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          {([['facilities', 'Health facilities'], ['sites', 'Markets, transport, prisons, mines']] as const).map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <TbMap
          districts={dist.data.geo}
          hexes={hexFc}
          facilities={show.facilities ? clip(layers.data.facilities) : null}
          sites={show.sites ? clip(layers.data.sites) : null}
          metric={metric}
          breaks={breaks}
          fit={fit}
          selectedHexes={picked}
          onSelectHex={(pr) => toggle(pr.h3)}
          tooltip={(pr, layer) =>
            layer === 'hex'
              ? `<b>${esc(pr.district)}</b><br/>${fmtInt(Number(pr.pop))} people · ${fmtInt(Number(pr.density))}/km²<br/>Hidden ≈ ${Number(pr.hidden).toFixed(1)} / year<br/>Nearest facility ${Number(pr.facility_km).toFixed(1)} km`
              : layer === 'facility' || layer === 'site'
              ? `<b>${esc(pr.name || pr.kind)}</b><br/>${esc(pr.kind)}`
              : `<b>${esc(pr.name)}</b>`
          }
          height={560}
        />
        <TbLegend title={m.label} breaks={breaks} fmt={m.fmt} />
      </Card>

      <Card className="min-w-0">
        <CardHeader
          title="Where to screen first"
          subtitle="Hexagons with the most estimated hidden cases"
          right={picked.length ? <Button variant="primary" icon="target" onClick={plan}>Plan for {picked.length}</Button> : undefined}
        />
        <ol className="divide-y divide-gray-100">
          {top.map((h, i) => (
            <li key={h.h3} className="py-2.5 flex gap-3 items-start">
              <input type="checkbox" className="mt-1.5" checked={picked.includes(h.h3)} onChange={() => toggle(h.h3)} aria-label={`Select area ${i + 1}`} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-gray-900 truncate">{h.district}</span>
                  <span className="text-sm tabular-nums shrink-0">≈{h.hidden.toFixed(1)} hidden</span>
                </div>
                <div className="text-xs text-gray-500">{fmtInt(h.pop)} people · {fmtInt(h.density)}/km²</div>
                <div className="flex flex-wrap gap-1 mt-1">{reasons(h).map((r) => <span key={r} className="text-[11px] px-1.5 py-px rounded bg-orange-50 text-orange-800">{r}</span>)}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-xs text-gray-500 mt-3">
          Hexagon estimates share out the district estimate by population, crowding, wealth, distance to care and nearby markets, lorry stations, prisons and mines. Campaign results in these areas sharpen them.
        </p>
      </Card>
    </div>
  );
}
