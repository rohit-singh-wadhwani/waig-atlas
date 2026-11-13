import React, { useEffect, useMemo, useState } from 'react';
import ExplorerMap, { bboxOf, breaksFor, TB_RAMP, VENUE_COLORS } from '../../components/ExplorerMap';
import { Badge, Button, Field, Select, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { useData } from '../../lib/hooks';
import { uid } from '../../lib/store';
import { peopleOptions, personName, usePeople } from '../../lib/team';
import { APPROACH, approachOf, createCampaign, expectedPositivity, fmtInt, loadDistrictDetail, loadReportedRegions, rulesFrom, tbSave, TbCampaign, TbDistrict, TbHexRow, TbTask, TbTown, TbVenue } from '../../lib/tb';
import { BasisTag, esc, kmFmt, pctFmt } from './common';
import type { TbData } from './TbPage';

const GHANA: [number, number, number, number] = [-3.3, 4.6, 1.3, 11.2];
const townKey = (t: TbTown) => String(t.id);
const venueKey = (v: TbVenue) => `${v.kind}|${v.lon}|${v.lat}`;
const KIND_LABEL: Record<string, string> = { 'transport hub': 'Lorry station', market: 'Market', prison: 'Prison', 'mine / quarry': 'Mine / quarry', school: 'School', 'place of worship': 'Church / mosque', 'community centre': 'Community centre', pharmacy: 'Pharmacy', 'NGO office': 'NGO office' };
const distKm = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((a.lat - b.lat) * 110.57, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
const signedPct = (r: number | null | undefined) => (r == null ? '—' : `${r >= 1 ? '+' : '−'}${Math.abs(Math.round((r - 1) * 100))}%`);

/** District-level signals: where a district sits among all 261 (1 = worst). Higher is worse unless flipped. */
const SIGNALS: { key: keyof TbDistrict; label: string; fmt: (v: number) => string; worse: 'high' | 'low'; flag: string; source: string }[] = [
  { key: 'poverty', label: 'Multidimensional poverty', fmt: (v) => `${v.toFixed(0)}% of people`, worse: 'high', flag: 'Poorer', source: 'GSS Census 2021' },
  { key: 'crowding', label: 'People per sleeping room', fmt: (v) => v.toFixed(1), worse: 'high', flag: 'Crowded homes', source: 'GSS Census 2021' },
  { key: 'walk_far', label: 'Over 1 hour walk to care', fmt: (v) => pctFmt(v), worse: 'high', flag: 'Far from care', source: 'Malaria Atlas Project' },
  { key: 'insured', label: 'Health insurance coverage', fmt: (v) => pctFmt(v), worse: 'low', flag: 'Low insurance', source: 'GSS Census 2021' },
  { key: 'fac_100k', label: 'Mapped facilities per 100k', fmt: (v) => v.toFixed(1), worse: 'low', flag: 'Few facilities', source: 'OpenStreetMap' },
];

export default function Explorer({ data, goTab }: { data: TbData; goTab: (t: string) => void }) {
  const { dist, campaigns, P } = data;
  const rules = rulesFrom(P);
  const nat = dist.data.meta?.national;
  const natRate = nat?.rate_100k ?? (nat ? (nat.incidence / nat.pop) * 1e5 : null);
  const list = useMemo(() => dist.data.list.map((d) => ({ ...d, approach: approachOf(d, rules) })), [dist.data.list, rules.walkFarShare, rules.lowDetection]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(list.map((d) => [d.id, d])), [list]);
  const rank = useMemo(() => {
    const out: Record<string, Map<string, number>> = {};
    for (const s of SIGNALS) {
      const vals = list.filter((d) => d[s.key] != null).sort((a, b) => (s.worse === 'high' ? Number(b[s.key]) - Number(a[s.key]) : Number(a[s.key]) - Number(b[s.key])));
      out[s.key as string] = new Map(vals.map((d, i) => [d.id, i / Math.max(vals.length - 1, 1)]));
    }
    return out; // 0 = worst district
  }, [list]);

  const [districtId, setDistrictId] = useState<string | null>(null);
  const [tKey, setTKey] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [selHex, setSelHex] = useState<string[]>([]);
  const [pins, setPins] = useState<Pin[]>([]);
  const [pinMode, setPinMode] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const d = districtId ? byId.get(districtId) || null : null;
  const detail = useData(() => (districtId ? loadDistrictDetail(districtId) : Promise.resolve(null)), [districtId], null);
  const det = detail.data && detail.data.id === districtId ? detail.data : null;
  const town = det && tKey ? det.towns.find((t) => townKey(t) === tKey) || null : null;
  useEffect(() => { setTKey(null); setPicked([]); setPlanning(false); setCreated(null); }, [districtId]);
  useEffect(() => { setPicked([]); setSelHex([]); setPins([]); setPinMode(false); setPlanning(false); setCreated(null); }, [tKey]);

  // venues: in a town, everything within its radius + 1 km; in a district, only congregate settings
  const venues = useMemo(() => {
    if (!det) return [] as TbVenue[];
    const vs = town ? det.venues.filter((v) => (v.t != null ? v.t === town.id : distKm(v, town) <= town.radius_km + 1)) : [];
    return [...vs].sort((a, b) => b.expected_1km - a.expected_1km);
  }, [det, town]);

  // ---------- map data ----------
  const geo = useMemo(() => {
    const g = dist.data.geo;
    if (!g) return null;
    return { ...g, features: g.features.map((f: any) => ({ ...f, properties: { ...f.properties, ...byId.get(f.properties.id), parts: undefined } })) };
  }, [dist.data.geo, byId]);
  const dBreaks = useMemo(() => breaksFor(list.map((x) => x.expected_100k)), [list]);
  const townHexes = useMemo(() => {
    if (!det || !town) return [];
    const r = town.radius_km + 1.5;
    return det.hexes.filter((h) => (h.t != null ? h.t === town.id : distKm({ lon: h.r[0][0], lat: h.r[0][1] }, town) <= r));
  }, [det, town]);
  // once hexagons are chosen, only gathering places inside them are offered
  const hexVenues = useMemo(() => {
    if (!selHex.length) return venues;
    const rings = townHexes.filter((h) => selHex.includes(h.h)).map((h) => h.r);
    return venues.filter((v) => rings.some((r) => inRing([v.lon, v.lat], r)));
  }, [venues, selHex, townHexes]);
  const pickedVenues = hexVenues.filter((v) => picked.includes(venueKey(v)));
  const spots: Spot[] = [...pickedVenues.map((v) => ({ name: v.name || KIND_LABEL[v.kind] || v.kind, kind: v.kind, lon: v.lon, lat: v.lat, pop_1km: v.pop_1km })), ...pins.map((x) => ({ name: x.name, kind: 'screening point', lon: x.lon, lat: x.lat }))];
  const pinFc = useMemo(() => ({ type: 'FeatureCollection', features: pins.map((x) => ({ type: 'Feature', properties: { id: x.id, name: x.name }, geometry: { type: 'Point', coordinates: [x.lon, x.lat] } })) }), [pins]);
  const hexFc = useMemo(() => (town ? { type: 'FeatureCollection', features: townHexes.map((h) => ({ type: 'Feature', properties: { h: h.h, p: h.p, e: h.e, k: h.k, f: h.f, w: h.w }, geometry: { type: 'Polygon', coordinates: [[...h.r, h.r[0]]] } })) } : null), [town, townHexes]);
  const hBreaks = useMemo(() => breaksFor(townHexes.map((h) => h.k)), [townHexes]);
  const townFc = useMemo(() => (det ? { type: 'FeatureCollection', features: det.towns.filter((t) => t.geom).map((t) => ({ type: 'Feature', properties: { key: townKey(t), nodata: !!t.nodata, name: t.name, place: t.place, pop: t.pop, expected: t.expected, expected_km2: t.expected_km2, lon: t.lon, lat: t.lat }, geometry: t.geom })) } : null), [det]);
  const tBreaks = useMemo(() => (det ? breaksFor(det.towns.filter((t) => !t.nodata).map((t) => t.expected_km2)) : []), [det]);
  const venueFc = useMemo(() => ({ type: 'FeatureCollection', features: venues.map((v) => ({ type: 'Feature', properties: { ...v, key: venueKey(v) }, geometry: { type: 'Point', coordinates: [v.lon, v.lat] } })) }), [venues]);
  const facFc = useMemo(() => (det && town ? { type: 'FeatureCollection', features: det.facilities.filter((f) => distKm(f, town) <= town.radius_km + 3).map((f) => ({ type: 'Feature', properties: f, geometry: { type: 'Point', coordinates: [f.lon, f.lat] } })) } : null), [det, town]);
  const fit = useMemo<[number, number, number, number]>(() => {
    if (town) {
      const b = bboxOf(town.geom);
      if (b) return b;
      const r = town.radius_km + 1.2, dLat = r / 110.57, dLon = r / (111.32 * Math.cos((town.lat * Math.PI) / 180));
      return [town.lon - dLon, town.lat - dLat, town.lon + dLon, town.lat + dLat];
    }
    if (d && dist.data.geo) return bboxOf(dist.data.geo.features.find((f: any) => f.properties.id === d.id)?.geometry) || GHANA;
    return GHANA;
  }, [town, d, dist.data.geo]);

  const tip = (pr: any, layer: string) => {
    if (layer === 'd-fill') return districtId ? '' : `<b>${esc(pr.name)}</b> · ${esc(String(pr.region))}<br/>About <b>${fmtInt(Number(pr.expected))}</b> new TB cases a year<br/>${fmtInt(Number(pr.expected_100k))} per 100,000 (${signedPct(Number(pr.vs_ghana))} vs Ghana)<br/><i>Click to open</i>`;
    if (layer === 'h-fill') return `${fmtInt(Number(pr.p))} people · ≈${Number(pr.e).toFixed(1)} TB cases a year<br/>Nearest facility ${kmFmt(Number(pr.f))}<br/><i>${pinMode ? (selHex.includes(pr.h) ? 'Click to drop a screening point here' : 'Select this hexagon first') : selHex.includes(pr.h) ? 'Click to unselect' : 'Click to select'}</i>`;
    if (layer === 'pins') return `<b>${esc(pr.name)}</b><br/>Screening point you placed`;
    if (layer === 'town-fill' && (pr.nodata === true || pr.nodata === 'true')) return town ? '' : `<b>${esc(pr.name)}</b> (${esc(pr.place)})<br/>No population mapped in this area<br/><i>Click to open</i>`;
    if (layer === 'town-fill') return town ? '' : `<b>${esc(pr.name)}</b> (${esc(pr.place)})<br/>${fmtInt(Number(pr.pop))} people · ≈${Number(pr.expected).toFixed(0)} TB cases a year<br/><i>Click to open</i>`;
    if (layer === 'venues') return `<b>${esc(pr.name || KIND_LABEL[pr.kind] || pr.kind)}</b><br/>${esc(KIND_LABEL[pr.kind] || pr.kind)} · ${fmtInt(Number(pr.pop_1km))} people within 1 km<br/><i>Click to ${town ? 'add to campaign' : 'open its town'}</i>`;
    if (layer === 'facilities') return `<b>${esc(pr.name || 'Health facility')}</b><br/>${esc(pr.kind)}${pr.lab === true || pr.lab === 'true' ? ' · lab' : ''}`;
    return '';
  };
  const toggleHex = (pr: any) => {
    const h = String(pr.h);
    setSelHex((x) => (x.includes(h) ? x.filter((y) => y !== h) : [...x, h]));
    if (selHex.includes(h)) setPins((x) => x.filter((y) => y.h !== h)); // unselecting drops its points
  };
  const dropPin = (ll: [number, number], h: string) => {
    setPins((x) => [...x, { id: uid('pin'), name: `Screening point ${x.length + 1}`, lon: Math.round(ll[0] * 1e5) / 1e5, lat: Math.round(ll[1] * 1e5) / 1e5, h }]);
    setPinMode(false);
  };
  const toggle = (k: string) => setPicked((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]));
  const onVenue = (pr: any) => {
    if (town) return toggle(pr.key);
    if (!det) return;
    const near = [...det.towns].sort((a, b) => distKm(a, pr) - distKm(b, pr))[0];
    if (near) { setTKey(townKey(near)); setTimeout(() => setPicked([pr.key]), 0); }
  };

  return (
    <div>
      <nav className="flex flex-wrap items-center gap-1.5 text-[15px] mb-4" aria-label="Where you are">
        <Crumb on={() => setDistrictId(null)} active={!d}>Ghana</Crumb>
        {d && <><Sep /><Crumb on={() => setTKey(null)} active={!town}>{d.name}</Crumb><span className="text-gray-400 text-sm">{d.region}</span></>}
        {town && <><Sep /><Crumb active>{town.name}</Crumb></>}
        <span className="ml-auto text-sm text-gray-500 hidden md:inline">{!d ? 'Click a district on the map or in the list' : !town ? 'Click a town to open it' : pinMode ? 'Click inside a selected hexagon to place the point' : 'Select hexagons, then pick spots or place a point'}</span>
      </nav>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_460px] gap-5 items-start">
        <div className="xl:sticky xl:top-4">
          <div className="h-[440px] md:h-[560px] xl:h-[calc(100vh-170px)] xl:min-h-[560px]">
            <ExplorerMap districts={geo} districtMetric="expected_100k" districtBreaks={dBreaks} focusId={districtId} hexes={hexFc} hexBreaks={hBreaks} towns={townFc} townBreaks={tBreaks} venues={venueFc} facilities={facFc}
              picked={picked} focusTown={tKey} selectedHexes={selHex} pins={pinFc} pinMode={pinMode} onHex={toggleHex} onPin={dropPin} fit={fit} onDistrict={(pr) => setDistrictId(pr.id)} onTown={(pr) => setTKey(pr.key)} onVenue={onVenue} tooltip={tip} />
          </div>
          <MapLegend level={!d ? 'ghana' : town ? 'town' : 'district'} breaks={!d ? dBreaks : town ? hBreaks : tBreaks} />
        </div>
        <aside className="min-w-0 space-y-4">
          {!d && <GhanaPanel list={list} nat={nat} natRate={natRate} rank={rank} campaigns={campaigns.data} notified={dist.data.notifiedDistricts} onOpen={setDistrictId} goTab={goTab} data={data} />}
          {d && !town && <DistrictPanel d={d} det={det} loading={detail.loading} rank={rank} n={list.length} venues={venues} campaigns={campaigns.data.filter((c) => c.district_id === d.id)} onTown={(t) => setTKey(townKey(t))} rules={rules} />}
          {d && town && !planning && !created && (
            <TownPanel d={d} town={town} venues={hexVenues} hexes={townHexes} selHex={selHex} clearHex={() => { setSelHex([]); setPins([]); }} pins={pins} setPins={setPins} pinMode={pinMode} setPinMode={setPinMode} spots={spots} facilities={det?.facilities.filter((f) => distKm(f, town) <= town.radius_km + 3).sort((a, b) => distKm(a, town) - distKm(b, town)) || []}
              picked={picked} toggle={toggle} campaigns={campaigns.data.filter((c) => c.district_id === d.id && c.town === town.name)} onPlan={() => setPlanning(true)} />
          )}
          {d && town && planning && !created && <PlanPanel d={d} town={town} spots={spots} hexIds={selHex} reachHex={townHexes.filter((h) => selHex.includes(h.h)).reduce((a, h) => a + h.p, 0)} data={data} onCancel={() => setPlanning(false)} onCreated={(id) => { setCreated(id); setPlanning(false); }} natRate={natRate} />}
          {d && town && created && <CreatedPanel id={created} data={data} onDone={() => { setCreated(null); setPicked([]); setSelHex([]); setPins([]); }} goTab={goTab} />}
        </aside>
      </div>
    </div>
  );
}

const Sep = () => <Icon name="chevronRight" size={16} className="text-gray-400" />;
function Crumb({ children, on, active }: { children: React.ReactNode; on?: () => void; active?: boolean }) {
  return active ? <span className="font-semibold text-gray-900">{children}</span> : <button type="button" onClick={on} className="text-brand-700 hover:underline">{children}</button>;
}

function MapLegend({ level, breaks }: { level: 'ghana' | 'district' | 'town'; breaks: number[] }) {
  const fmt = (v: number) => (level === 'ghana' ? fmtInt(v) : v < 1 ? v.toFixed(2) : v.toFixed(1));
  const labels = breaks.length ? [`< ${fmt(breaks[0])}`, ...breaks.slice(0, -1).map((b, i) => `${fmt(b)}–${fmt(breaks[i + 1])}`), `> ${fmt(breaks[breaks.length - 1])}`] : [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 mt-3">
      <span className="font-medium text-gray-700">{level === 'ghana' ? 'Expected TB cases per 100,000 a year' : level === 'district' ? 'Town areas: expected cases per km² a year' : 'Expected cases per km² a year'}</span>
      {labels.map((l, i) => <span key={i} className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm" style={{ background: TB_RAMP[Math.min(i, TB_RAMP.length - 1)] }} />{l}</span>)}
      {level === 'district' && <span className="inline-flex items-center gap-1.5"><span className="w-3.5 h-3.5 rounded-sm bg-[#d1d5db]" />No population mapped</span>}
      {level === 'district' && <span className="w-full text-gray-500">Each area is the part of the district nearest to that town, village or suburb (OpenStreetMap).</span>}
      {level === 'town' && <span className="w-full text-gray-500">Blank parts of the town area have no people mapped by WorldPop (farmland, forest, water).</span>}
      {level === 'town' && (
        <>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#1d4ed8]" />Health facility</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-[#7c3aed]" />Screening spot</span>
        </>
      )}
    </div>
  );
}

function Panel({ title, sub, right, children, className }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
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

function Stat({ label, value, sub, basis }: { label: string; value: React.ReactNode; sub?: React.ReactNode; basis?: 'reported' | 'measured' | 'estimated' }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3 min-w-0">
      <div className="flex items-center justify-between gap-2 text-xs text-gray-500"><span>{label}</span>{basis && <BasisTag b={basis} />}</div>
      <div className="text-lg font-semibold text-gray-900 tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function flagsFor(d: TbDistrict, rank: Record<string, Map<string, number>>) {
  const out: string[] = [];
  for (const s of SIGNALS) {
    const r = rank[s.key as string]?.get(d.id);
    if (r != null && r <= 0.2) out.push(s.flag);
  }
  if (d.prisons) out.push(`${d.prisons} prison${d.prisons > 1 ? 's' : ''}`);
  if (d.mines) out.push(`${d.mines} mine/quarry`);
  return out;
}

// ---------------- level 1: Ghana ----------------
function GhanaPanel({ list, nat, natRate, rank, campaigns, notified, onOpen, goTab, data }: { list: TbDistrict[]; nat: any; natRate: number | null; rank: Record<string, Map<string, number>>; campaigns: TbCampaign[]; notified: number; onOpen: (id: string) => void; goTab: (t: string) => void; data: TbData }) {
  const [sort, setSort] = useState<'count' | 'rate'>('count');
  const [region, setRegion] = useState('');
  const [all, setAll] = useState(false);
  const regions = useMemo(() => Array.from(new Set(list.map((d) => d.region))).sort(), [list]);
  const shown = [...list].filter((d) => !region || d.region === region).sort((a, b) => (sort === 'count' ? b.expected - a.expected : b.expected_100k - a.expected_100k));
  const active = campaigns.filter((c) => c.status === 'planned' || c.status === 'active');
  return (
    <>
      <Panel title="Ghana" sub={nat ? `WHO estimate for ${nat.year}` : ''}>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="New TB cases a year" value={fmtInt(nat?.incidence)} basis="reported" sub={natRate ? `${fmtInt(natRate)} per 100,000` : undefined} />
          <Stat label="Found and notified" value={fmtInt(nat?.notified)} basis="reported" sub={nat ? `${Math.round(nat.cdr * 100)}% of expected` : ''} />
          <Stat label="Missed each year" value={fmtInt(nat ? nat.incidence - nat.notified : null)} basis="estimated" sub="Expected minus notified" />
          <Stat label="Campaigns running" value={active.length} sub={<button type="button" className="text-brand-700 hover:underline" onClick={() => goTab('campaigns')}>{campaigns.length} in total</button>} />
        </div>
        {!notified && <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mt-3">District notifications are not connected yet (needs DHIMS2), so district figures are expected cases, not measured gaps.</p>}
      </Panel>

      <Panel title="Where TB is most likely" sub="Expected new cases from each district's age and sex mix (Census 2021), WHO's rates, and its region's HIV, undernourishment and smoking."
        right={<div className="flex rounded-lg bg-gray-100 p-0.5 text-sm shrink-0">{(['count', 'rate'] as const).map((k) => <button key={k} type="button" onClick={() => setSort(k)} className={cx('px-2.5 py-1 rounded-md', sort === k ? 'bg-white shadow-sm font-medium' : 'text-gray-600')}>{k === 'count' ? 'Most cases' : 'Highest rate'}</button>)}</div>}>
        <Select className="w-full mb-2 [&_select]:h-9 [&_select]:text-sm" value={region} onChange={setRegion} placeholder="All 16 regions" options={regions.map((r) => ({ value: r, label: r }))} />
        <ol className="divide-y divide-gray-100 -mx-1">
          {shown.slice(0, all ? shown.length : 12).map((d, i) => {
            const flags = flagsFor(d, rank);
            return (
              <li key={d.id}>
                <button type="button" onClick={() => onOpen(d.id)} className="w-full text-left px-1 py-2.5 flex gap-3 hover:bg-gray-50 rounded-lg">
                  <span className="w-6 text-sm text-gray-400 tabular-nums pt-0.5">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-gray-900 truncate">{d.name}</span>
                      <span className="shrink-0 tabular-nums font-semibold">{sort === 'count' ? fmtInt(d.expected) : fmtInt(d.expected_100k)}<span className="text-xs font-normal text-gray-500">{sort === 'count' ? ' cases/yr' : ' /100k'}</span></span>
                    </span>
                    <span className="flex items-center justify-between gap-2 text-xs text-gray-500">
                      <span className="truncate">{d.region} · {(d.share * 100).toFixed(1)}% of Ghana's cases</span>
                      <span className={cx('shrink-0 font-medium', d.vs_ghana >= 1 ? 'text-red-700' : 'text-green-700')}>{signedPct(d.vs_ghana)} vs Ghana</span>
                    </span>
                    {flags.length > 0 && <span className="flex flex-wrap gap-1 mt-1">{flags.map((f) => <span key={f} className="text-[11px] px-1.5 py-px rounded bg-orange-50 text-orange-800">{f}</span>)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        {shown.length > 12 && <button type="button" className="text-sm text-brand-700 hover:underline mt-2" onClick={() => setAll(!all)}>{all ? 'Show top 12' : `Show all ${shown.length}`}</button>}
      </Panel>

      {active.length > 0 && (
        <Panel title="Campaigns running" right={<button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => goTab('campaigns')}>All campaigns</button>}>
          <ul className="space-y-2">{active.slice(0, 5).map((c) => <li key={c.id} className="text-sm flex justify-between gap-3"><button type="button" className="text-left text-gray-900 hover:underline truncate" onClick={() => c.district_id && onOpen(c.district_id)}>{c.name}</button><Badge className="bg-green-50 text-green-700 shrink-0">{c.status}</Badge></li>)}</ul>
        </Panel>
      )}
      <NewsPanel data={data} />
    </>
  );
}

function NewsPanel({ data }: { data: TbData }) {
  const news = useData(() => fetch(`${process.env.PUBLIC_URL || ''}/data/insights.json`).then((r) => r.json()).catch(() => ({ insights: [] })), [], { insights: [] } as any);
  const items = (news.data.insights || []).filter((i: any) => /tuberc|\btb\b/i.test(`${i.title} ${i.summary || ''}`) || (i.diseases || []).some((x: string) => /tuberc|^tb$/i.test(x)))
    .sort((a: any, b: any) => Number((b.countries || []).includes('GHA')) - Number((a.countries || []).includes('GHA')) || String(b.published_at || '').localeCompare(String(a.published_at || ''))).slice(0, 4);
  if (!items.length) return null;
  return (
    <Panel title="TB news and research" sub="From the Latest Insights feed">
      <ul className="space-y-2.5">{items.map((i: any) => <li key={i.id} className="text-sm"><a href={i.url} target="_blank" rel="noreferrer" className="text-gray-900 hover:underline">{i.title}</a><span className="block text-xs text-gray-500">{i.source_name}{i.published_at ? ` · ${String(i.published_at).slice(0, 10)}` : ''}</span></li>)}</ul>
    </Panel>
  );
}

// ---------------- level 2: district ----------------
function DistrictPanel({ d, det, loading, rank, n, venues, campaigns, onTown, rules }: { d: TbDistrict; det: any; loading: boolean; rank: Record<string, Map<string, number>>; n: number; venues: TbVenue[]; campaigns: TbCampaign[]; onTown: (t: TbTown) => void; rules: any }) {
  const a = APPROACH[d.approach];
  const reported = useData(loadReportedRegions, [], {} as Record<string, { period: string; tb: number }[]>);
  const series = reported.data[d.region] || null;
  const [allTowns, setAllTowns] = useState(false);
  const [tSort, setTSort] = useState<'cases' | 'far'>('cases');
  const noData: TbTown[] = det ? det.towns.filter((t: TbTown) => t.nodata) : [];
  const towns: TbTown[] = det ? [...det.towns].filter((t: TbTown) => !t.nodata).sort((x: TbTown, y: TbTown) => (tSort === 'cases' ? y.expected - x.expected : (y.facility_km ?? 0) - (x.facility_km ?? 0))) : [];
  const key = (det?.venues || []).filter((v: TbVenue) => v.kind === 'prison' || v.kind === 'mine / quarry');
  return (
    <>
      <Panel title={d.name} sub={`${d.region} · ${fmtInt(d.pop)} people (2026) · ${d.urban != null ? `${Math.round(d.urban * 100)}% urban` : ''}`}>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="Expected new cases a year" value={fmtInt(d.expected)} basis="estimated" sub={`${(d.share * 100).toFixed(1)}% of Ghana's cases`} />
          <Stat label="Rate per 100,000" value={fmtInt(d.expected_100k)} basis="estimated" sub={<span className={d.vs_ghana >= 1 ? 'text-red-700' : 'text-green-700'}>{signedPct(d.vs_ghana)} vs Ghana</span>} />
          <Stat label="Notified a year" value={d.notified != null ? fmtInt(d.notified) : 'Not connected'} basis="reported" sub={d.notified != null ? `${pctFmt(d.detection)} of expected` : 'Needs DHIMS2'} />
          <Stat label="Our screening here" value={d.screened ? `${fmtInt(d.confirmed)} found` : 'None yet'} basis="reported" sub={d.screened ? `${fmtInt(d.screened)} screened` : `${campaigns.length} campaign${campaigns.length === 1 ? '' : 's'}`} />
        </div>
      </Panel>

      <Panel title="Towns to start with" sub="Click a town to see its neighbourhoods and screening spots."
        right={<div className="flex rounded-lg bg-gray-100 p-0.5 text-sm shrink-0">{(['cases', 'far'] as const).map((k) => <button key={k} type="button" onClick={() => setTSort(k)} className={cx('px-2.5 py-1 rounded-md whitespace-nowrap', tSort === k ? 'bg-white shadow-sm font-medium' : 'text-gray-600')}>{k === 'cases' ? 'Most cases' : 'Farthest from care'}</button>)}</div>}>
        {loading && !det ? <p className="text-sm text-gray-500">Loading…</p> : !det ? <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Town details for this district could not be loaded. The district figures above are still correct.</p> : !towns.length ? <p className="text-sm text-gray-500">No towns or villages are mapped in OpenStreetMap for this district.</p> : (
          <>
            <ol className="divide-y divide-gray-100 -mx-1">
              {towns.slice(0, allTowns ? towns.length : 8).map((t, i) => (
                <li key={townKey(t)}>
                  <button type="button" onClick={() => onTown(t)} className="w-full text-left px-1 py-2.5 flex gap-3 hover:bg-gray-50 rounded-lg">
                    <span className="w-6 text-sm text-gray-400 tabular-nums pt-0.5">{i + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2"><span className="font-medium truncate">{t.name}</span><span className="tabular-nums font-semibold shrink-0">≈{fmtInt(t.expected)}<span className="text-xs font-normal text-gray-500"> cases/yr</span></span></span>
                      <span className="block text-xs text-gray-500">{t.place} · {fmtInt(t.pop)} people · nearest facility {kmFmt(t.facility_km)}{t.walk_min != null ? ` · ${t.walk_min < 5 ? 'under 5' : fmtInt(t.walk_min)} min walk` : ''}</span>
                    </span>
                    <Icon name="chevronRight" size={16} className="text-gray-400 mt-1" />
                  </button>
                </li>
              ))}
            </ol>
            {towns.length > 8 && <button type="button" className="text-sm text-brand-700 hover:underline mt-2" onClick={() => setAllTowns(!allTowns)}>{allTowns ? 'Show top 8' : `Show all ${towns.length}`}</button>}
            {noData.length > 0 && (
              <p className="text-xs text-gray-600 bg-gray-50 rounded-lg px-3 py-2 mt-3">
                <b>{noData.length} place{noData.length > 1 ? 's' : ''} with no population mapped</b> (shown grey on the map): {noData.slice(0, 12).map((t) => t.name).join(', ')}{noData.length > 12 ? ` and ${noData.length - 12} more` : ''}. WorldPop finds no homes there, so there is nothing to estimate; check locally if people live there.
              </p>
            )}
          </>
        )}
      </Panel>

      <Panel title="Why this district" sub={`Where it sits among Ghana's ${n} districts`}>
        <ul className="space-y-3">
          <Driver label="Age and sex mix" value={d.age_effect != null ? `${signedPct(d.age_effect)} TB vs Ghana` : '—'} note={d.adults != null ? `${Math.round(d.adults * 100)}% adults, ${Math.round((d.male || 0) * 100)}% male · Census 2021` : 'Census 2021'} />
          <Driver label="Regional HIV, undernourishment, smoking" value={d.risk_effect != null ? `${signedPct(d.risk_effect)} TB vs Ghana` : '—'} note={`${d.region} region (DHS): HIV ${d.hiv ?? '—'}%, thin adults ${d.thin ?? '—'}%, tobacco ${d.smoke ?? '—'}%`} />
          {SIGNALS.map((s) => {
            const v = d[s.key] as number | null;
            const r = rank[s.key as string]?.get(d.id);
            return <Driver key={s.key as string} label={s.label} value={v != null ? s.fmt(v) : '—'} note={s.source} pos={r} />;
          })}
        </ul>
      </Panel>

      <Panel title="Recommended approach" right={<Badge className={a.cls}>{a.short}</Badge>}>
        <p className="text-[15px] font-medium text-gray-900">{a.label}</p>
        <p className="text-sm text-gray-600 mt-1">{a.how}</p>
        <p className="text-xs text-gray-500 mt-2">Rule: {rules.walkFarShare != null ? `${Math.round(rules.walkFarShare * 100)}%+ of people over 1 hour's walk → outreach` : ''}{rules.lowDetection != null ? `; notified below ${Math.round(rules.lowDetection * 100)}% of expected → fix detection` : ''}. {a.who}</p>
      </Panel>

      {det && (key.length > 0 || d.facilities > 0) && (
        <Panel title="Settings and services" sub="OpenStreetMap; may be incomplete">
          <div className="grid grid-cols-3 gap-2.5 mb-3">
            <Stat label="Facilities" value={d.facilities} sub={`${d.hospitals} hospitals`} basis="measured" />
            <Stat label="Labs" value={d.labs} basis="measured" />
            <Stat label="Markets, stations" value={d.markets + d.hubs} basis="measured" />
          </div>
          {key.length > 0 && <ul className="space-y-1.5 text-sm">{key.map((v: TbVenue) => <li key={venueKey(v)} className="flex justify-between gap-3"><span className="truncate">{v.name || KIND_LABEL[v.kind]}<span className="text-gray-500"> · {KIND_LABEL[v.kind]}</span></span><span className="text-gray-500 shrink-0">key population</span></li>)}</ul>}
        </Panel>
      )}

      {series && <TrendPanel region={d.region} series={series} />}
      {campaigns.length > 0 && <Panel title="Campaigns in this district"><ul className="space-y-1.5 text-sm">{campaigns.map((c) => <li key={c.id} className="flex justify-between gap-3"><span className="truncate">{c.name}</span><Badge className="bg-green-50 text-green-700">{c.status}</Badge></li>)}</ul></Panel>}
    </>
  );
}

function Driver({ label, value, note, pos }: { label: string; value: React.ReactNode; note?: string; pos?: number }) {
  // pos: 0 = worst district, 1 = best
  const worse = pos != null ? Math.round((1 - pos) * 100) : null;
  return (
    <li>
      <div className="flex items-baseline justify-between gap-3 text-sm"><span className="text-gray-700">{label}</span><span className="font-semibold tabular-nums text-gray-900 text-right">{value}</span></div>
      {pos != null && (
        <div className="mt-1 flex items-center gap-2">
          <div className="relative h-1.5 flex-1 rounded-full bg-gradient-to-r from-red-400 via-amber-300 to-green-400"><span className="absolute -top-1 w-1 h-3.5 rounded bg-gray-900" style={{ left: `calc(${(pos * 100).toFixed(1)}% - 2px)` }} /></div>
          <span className="text-[11px] text-gray-500 w-[150px] text-right">{worse != null && worse >= 50 ? `worse than ${worse}% of districts` : `better than ${100 - (worse || 0)}% of districts`}</span>
        </div>
      )}
      {note && <div className="text-[11px] text-gray-400 mt-0.5">{note}</div>}
    </li>
  );
}

function TrendPanel({ region, series }: { region: string; series: { period: string; tb: number }[] }) {
  const years = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of series) m.set(s.period.slice(0, 4), (m.get(s.period.slice(0, 4)) || 0) + s.tb);
    return Array.from(m.entries()).sort();
  }, [series]);
  const max = Math.max(...years.map(([, v]) => v), 1);
  return (
    <Panel title={`Reported TB, ${region} region`} sub="Monthly DHIMS II counts summed by year (Mendeley Data extract, region level)" right={<BasisTag b="reported" />}>
      <div className="flex items-end gap-1.5 h-24" role="img" aria-label={`Reported TB by year: ${years.map(([y, v]) => `${y} ${v}`).join(', ')}`}>
        {years.map(([y, v]) => (
          <div key={y} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${y}: ${v.toLocaleString('en-GB')}`}>
            <span className="text-[10px] text-gray-500 tabular-nums">{v.toLocaleString('en-GB')}</span>
            <div className="w-full rounded-t bg-brand-500/80" style={{ height: `${(v / max) * 64}px` }} />
            <span className="text-[10px] text-gray-500">{y.slice(2)}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ---------------- level 3: town ----------------
type Pin = { id: string; name: string; lon: number; lat: number; h: string };
type Spot = { name: string; kind: string; lon: number; lat: number; pop_1km?: number };

/** Point-in-polygon (ray casting) for a hexagon ring. */
function inRing(pt: [number, number], ring: [number, number][]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

type TownPanelProps = {
  d: TbDistrict; town: TbTown; venues: TbVenue[]; hexes: TbHexRow[]; selHex: string[]; clearHex: () => void; pins: Pin[]; setPins: React.Dispatch<React.SetStateAction<Pin[]>>;
  pinMode: boolean; setPinMode: (b: boolean) => void; spots: Spot[]; facilities: any[]; picked: string[]; toggle: (k: string) => void; campaigns: TbCampaign[]; onPlan: () => void;
};
function TownPanel({ d, town, venues, hexes, selHex, clearHex, pins, setPins, pinMode, setPinMode, spots, facilities, picked, toggle, campaigns, onPlan }: TownPanelProps) {
  const [kind, setKind] = useState('');
  const kinds = Array.from(new Set(venues.map((v) => v.kind)));
  const shown = venues.filter((v) => !kind || v.kind === kind);
  const ordered = [...shown.filter((v) => picked.includes(venueKey(v))), ...shown.filter((v) => !picked.includes(venueKey(v)))];
  const sel = hexes.filter((h) => selHex.includes(h.h));
  const selPop = sel.reduce((a, h) => a + h.p, 0), selExp = sel.reduce((a, h) => a + h.e, 0);
  return (
    <>
      <Panel title={town.name} sub={`${town.place} in ${d.name}`}>
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="People living here" value={fmtInt(town.pop)} basis="measured" sub={town.area_km2 ? `${town.area_km2} km² area` : undefined} />
          <Stat label="Expected TB cases a year" value={`≈${fmtInt(town.expected)}`} basis="estimated" />
          <Stat label="Nearest health facility" value={kmFmt(town.facility_km)} basis="measured" sub={town.walk_min != null ? `${town.walk_min < 5 ? 'under 5' : fmtInt(town.walk_min)} min walk` : undefined} />
          <Stat label="Nearest hospital" value={kmFmt(town.hospital_km)} basis="measured" sub={town.drive_min != null ? `${fmtInt(town.drive_min)} min drive` : undefined} />
        </div>
        {town.nodata && <p className="text-sm mt-3 text-gray-700 bg-gray-50 rounded-lg px-3 py-2">No population is mapped in this area, so there are no estimates. If people live here, screening can still be planned.</p>}
        {campaigns.length > 0 && <p className="text-sm mt-3 text-green-800 bg-green-50 rounded-lg px-3 py-2">✓ {campaigns.length} campaign{campaigns.length > 1 ? 's' : ''} already here: {campaigns.map((c) => c.name).join(', ')}</p>}
      </Panel>

      <Panel title="1. Select hexagons" sub="Click hexagons on the map to choose the areas to cover. Darker ones are expected to have more TB per km²."
        right={selHex.length > 0 && <button type="button" className="text-sm text-brand-700 hover:underline" onClick={clearHex}>Clear</button>}>
        {!selHex.length ? <p className="text-sm text-gray-500">None selected: the whole town is covered.</p> : (
          <div className="grid grid-cols-3 gap-2.5">
            <Stat label="Hexagons" value={String(selHex.length)} basis="measured" sub={`≈${(selHex.length * 0.74).toFixed(1)} km²`} />
            <Stat label="People" value={fmtInt(selPop)} basis="measured" />
            <Stat label="Expected cases a year" value={`≈${selExp < 10 ? selExp.toFixed(1) : fmtInt(selExp)}`} basis="estimated" />
          </div>
        )}
      </Panel>

      <Panel title="2. Choose where to screen" sub={selHex.length ? 'Gathering places inside the selected hexagons. Tick one, or place your own point if there is none.' : 'Gathering places in this town, ranked by people living within 1 km.'}>
        {venues.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-3">
            <Chip on={!kind} onClick={() => setKind('')}>All ({venues.length})</Chip>
            {kinds.map((k) => <Chip key={k} on={kind === k} onClick={() => setKind(k)} color={VENUE_COLORS[k]}>{KIND_LABEL[k] || k} ({venues.filter((v) => v.kind === k).length})</Chip>)}
          </div>
        )}
        {!venues.length ? <p className="text-sm text-gray-700 bg-amber-50 rounded-lg px-3 py-2">No gathering places are mapped {selHex.length ? 'inside these hexagons' : `in ${town.name}`} in OpenStreetMap. Place a screening point where the team will set up (a junction, a chief's house, a borehole).</p> : (
          <ul className="divide-y divide-gray-100 -mx-1 max-h-[360px] overflow-y-auto">
            {ordered.slice(0, 40).map((v) => {
              const k = venueKey(v), on = picked.includes(k);
              return (
                <li key={k}>
                  <label className={cx('flex gap-3 px-1 py-2.5 rounded-lg cursor-pointer', on ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                    <input type="checkbox" checked={on} onChange={() => toggle(k)} className="mt-1" />
                    <span className="min-w-0 flex-1">
                      <span className="flex justify-between gap-2"><span className="font-medium truncate">{v.name || `Unnamed ${KIND_LABEL[v.kind]?.toLowerCase() || v.kind}`}</span><span className="text-sm tabular-nums shrink-0">{fmtInt(v.pop_1km)} <span className="text-xs text-gray-500">within 1 km</span></span></span>
                      <span className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5"><span className="w-2 h-2 rounded-full" style={{ background: VENUE_COLORS[v.kind] || '#64748b' }} />{KIND_LABEL[v.kind] || v.kind} · facility {kmFmt(v.facility_km)}</span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="mt-3">
          {pins.length > 0 && (
            <ul className="space-y-1.5 mb-2">
              {pins.map((x) => (
                <li key={x.id} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-600 shrink-0" />
                  <TextInput className="flex-1 min-w-0" value={x.name} onChange={(e) => setPins((ps) => ps.map((y) => (y.id === x.id ? { ...y, name: e.target.value } : y)))} />
                  <span className="text-xs text-gray-500 tabular-nums shrink-0">{x.lat.toFixed(4)}, {x.lon.toFixed(4)}</span>
                  <button type="button" aria-label="Remove point" className="text-gray-400 hover:text-red-600" onClick={() => setPins((ps) => ps.filter((y) => y.id !== x.id))}><Icon name="x" size={16} /></button>
                </li>
              ))}
            </ul>
          )}
          <Button icon="pin" disabled={!selHex.length} onClick={() => setPinMode(!pinMode)} className={pinMode ? 'ring-2 ring-red-500' : ''}>{pinMode ? 'Click a selected hexagon… (cancel)' : 'Place a screening point'}</Button>
          {!selHex.length && <p className="text-xs text-gray-500 mt-1">Select a hexagon first to place a point inside it.</p>}
        </div>
        <div className="sticky bottom-0 bg-white pt-3 mt-3 border-t border-gray-100 flex items-center justify-between gap-3">
          <span className="text-sm text-gray-600">{spots.length ? `${spots.length} screening spot${spots.length > 1 ? 's' : ''}` : 'No spots yet: plan for the selected area'}</span>
          <Button variant="primary" icon="target" className="whitespace-nowrap shrink-0" onClick={onPlan}>Plan campaign</Button>
        </div>
      </Panel>

      {facilities.length > 0 && (
        <Panel title="Where to refer and test" sub="Mapped health facilities nearby">
          <ul className="space-y-1.5 text-sm">{facilities.slice(0, 6).map((f, i) => <li key={i} className="flex justify-between gap-3"><span className="truncate">{f.name || 'Unnamed facility'}<span className="text-gray-500"> · {f.kind}{f.lab ? ' · lab' : ''}</span></span><span className="text-gray-500 shrink-0">{kmFmt(distKm(f, town))}</span></li>)}</ul>
        </Panel>
      )}
    </>
  );
}

function Chip({ children, on, onClick, color }: { children: React.ReactNode; on: boolean; onClick: () => void; color?: string }) {
  return (
    <button type="button" onClick={onClick} className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs', on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700 hover:border-gray-400')}>
      {color && <span className="w-2 h-2 rounded-full" style={{ background: color }} />}{children}
    </button>
  );
}

// ---------------- level 4: plan + tasks ----------------
function PlanPanel({ d, town, spots, hexIds, reachHex, data, onCancel, onCreated, natRate }: { d: TbDistrict; town: TbTown; spots: Spot[]; hexIds: string[]; reachHex: number; data: TbData; onCancel: () => void; onCreated: (id: string) => void; natRate: number | null }) {
  const me = useMe();
  const people = usePeople();
  const keyPop = spots.find((s) => s.kind === 'prison' || s.kind === 'mine / quarry');
  const defaultPb = keyPop ? 'acf_congregate' : APPROACH[d.approach].playbook;
  const [name, setName] = useState(`${town.name}: TB screening${spots.length ? ` at ${spots.length} spot${spots.length > 1 ? 's' : ''}` : ''}`);
  const [pb, setPb] = useState(data.playbooks.data.find((p) => p.id === defaultPb)?.id || data.playbooks.data[0]?.id || '');
  const [start, setStart] = useState(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
  const [owner, setOwner] = useState(me.email);
  const [target, setTarget] = useState('');
  const [saving, setSaving] = useState(false);
  const reach = hexIds.length ? reachHex : town.pop;
  const setting = keyPop ? (keyPop.kind === 'prison' ? 'prison' : 'mine') : spots.some((s) => s.kind === 'market' || s.kind === 'transport hub') ? 'market' : APPROACH[d.approach].setting;
  const y = expectedPositivity(setting, d, data.P, natRate);
  const playbook = data.playbooks.data.find((p) => p.id === pb);
  const save = async () => {
    setSaving(true);
    const id = uid('tbc');
    await createCampaign({ id, name: name.trim() || `${town.name}: TB screening`, district_id: d.id, district_name: d.name, town: town.name, setting, playbook_id: pb || null, status: 'planned', start_date: start, owner, target_screened: target ? Number(target) : null, predicted_positivity: y, hex_ids: hexIds, spots } as TbCampaign, playbook, people.map((p) => ({ email: p.email, role: p.role, district: p.district })), me.email);
    setSaving(false);
    onCreated(id);
  };
  return (
    <Panel title="Plan a campaign" sub={`${town.name}, ${d.name}`}>
      <div className="space-y-3">
        <Field label="Campaign name"><TextInput className="w-full" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Playbook (what the team will do)"><Select value={pb} onChange={setPb} options={data.playbooks.data.filter((p) => p.enabled !== false).map((p) => ({ value: p.id, label: p.name }))} placeholder="No playbook" /></Field>
        {playbook && <p className="text-xs text-gray-500 -mt-1">{playbook.steps.length} tasks will be created: {playbook.steps.map((s) => s.role).filter((r, i, a) => a.indexOf(r) === i).join(', ')}.</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><TextInput type="date" className="w-full" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Lead"><Select value={owner} onChange={setOwner} options={peopleOptions(people, owner)} /></Field>
        </div>
        <Field label="Target to screen (optional)"><TextInput className="w-full" inputMode="numeric" placeholder={`${fmtInt(reach)} people live in the ${hexIds.length ? 'selected hexagons' : 'town'}`} value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ''))} /></Field>
        {target && y ? <p className="text-sm text-gray-700">Expect about <b>{fmtInt(Number(target) * y)}</b>* people with TB found.<span className="block text-xs text-gray-500 mt-0.5">* Assumption: published screening yield for this setting (Kranzer et al. 2010 review{setting === 'prison' || setting === 'mine' ? '' : ', general population 0.7%'}), scaled by {d.name}'s expected rate vs Ghana. Replace with your own results once the first campaign reports.</span></p> : null}
        {hexIds.length > 0 && <p className="text-sm text-gray-700">{hexIds.length} hexagon{hexIds.length > 1 ? 's' : ''} selected</p>}
        {spots.length > 0 && <div className="text-sm"><div className="text-xs text-gray-500 mb-1">Spots</div><ul className="space-y-1">{spots.map((s, i) => <li key={i} className="flex items-center gap-2"><span className="w-2 h-2 rounded-full" style={{ background: VENUE_COLORS[s.kind] || '#dc2626' }} />{s.name}<span className="text-gray-500">· {KIND_LABEL[s.kind] || s.kind}</span></li>)}</ul></div>}
        <div className="flex justify-end gap-2 pt-2"><Button onClick={onCancel}>Back</Button><Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Creating…' : 'Create campaign and tasks'}</Button></div>
      </div>
    </Panel>
  );
}

function CreatedPanel({ id, data, onDone, goTab }: { id: string; data: TbData; onDone: () => void; goTab: (t: string) => void }) {
  const people = usePeople();
  const c = data.campaigns.data.find((x) => x.id === id);
  const tasks = data.tasks.data.filter((t) => t.campaign_id === id).sort((a, b) => (a.due || '').localeCompare(b.due || ''));
  const set = (t: TbTask, patch: Partial<TbTask>) => tbSave('tb_tasks', { ...t, ...patch, updated_at: new Date().toISOString() });
  return (
    <Panel title="✓ Campaign created" sub={c?.name}>
      <p className="text-sm text-gray-600 mb-3">Assign each task. People with a matching role on the People page were assigned automatically.</p>
      {!tasks.length ? <p className="text-sm text-gray-500">No playbook tasks. Add tasks on the Campaigns & tasks tab.</p> : (
        <ul className="divide-y divide-gray-100">
          {tasks.map((t) => (
            <li key={t.id} className="py-2.5">
              <div className="text-sm font-medium text-gray-900">{t.title}</div>
              <div className="flex flex-wrap items-center gap-2 mt-1.5">
                <span className="text-xs text-gray-500 w-full sm:w-auto sm:flex-1">{t.role} · due {t.due}</span>
                <Select className="w-[200px] [&_select]:h-8 [&_select]:text-sm" value={t.assignee || ''} onChange={(v) => set(t, { assignee: v || null })} placeholder="Unassigned" options={peopleOptions(people, t.assignee)} />
              </div>
              {t.assignee && <div className="text-[11px] text-gray-400 mt-0.5">Assigned to {personName(t.assignee)}</div>}
            </li>
          ))}
        </ul>
      )}
      <div className="flex justify-end gap-2 pt-3"><Button onClick={() => goTab('campaigns')}>Open in Campaigns</Button><Button variant="primary" onClick={onDone}>Done</Button></div>
    </Panel>
  );
}
