import React, { useMemo, useState } from 'react';
import TbMap, { breaksFor, TbLegend } from '../../components/TbMap';
import { Badge, Button, Card, CardHeader, Drawer, Segmented, Select, cx } from '../../components/ui';
import { APPROACH, ApproachKey, approachOf, expectedPositivity, fmtInt, rulesFrom, TbCampaign, TbDistrict, TbSite } from '../../lib/tb';
import { BasisTag, esc, Figure, kmFmt, PartsBar, pctFmt } from './common';
import type { TbData } from './TbPage';

type Metric = 'missed' | 'walk_far';

export default function WhereToAct({ data, onPlan, goData }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void; goData: () => void }) {
  const { dist, layers, campaigns, P } = data;
  const rules = rulesFrom(P);
  const nat = dist.data.meta?.national;
  const natRate = nat ? (nat.incidence / nat.pop) * 1e5 : null;
  const list = useMemo(() => dist.data.list.map((d) => ({ ...d, approach: approachOf(d, rules) })), [dist.data.list, rules.walkFarShare, rules.lowDetection]); // eslint-disable-line react-hooks/exhaustive-deps
  const [metric, setMetric] = useState<Metric>('missed');
  const [region, setRegion] = useState('');
  const [appr, setAppr] = useState('');
  const [all, setAll] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const sel = list.find((d) => d.id === selId) || null;
  const regions = useMemo(() => Array.from(new Set(list.map((d) => d.region))).sort(), [list]);
  const shown = list.filter((d) => (!region || d.region === region) && (!appr || d.approach === appr));
  const breaks = useMemo(() => breaksFor(list.map((d) => Number(d[metric] ?? NaN))), [list, metric]);
  const fmt = metric === 'walk_far' ? (v: number) => pctFmt(v) : (v: number) => fmtInt(v);
  const connected = dist.data.notifiedDistricts > 0;
  const rateRange = useMemo(() => { const r = list.map((d) => d.expected_100k).filter((x) => isFinite(x)); return r.length ? [Math.min(...r), Math.max(...r)] : [0, 0]; }, [list]);
  const keySites = useMemo(() => layers.data.siteList.filter((s) => s.kind === 'prison' || s.kind === 'mine / quarry').sort((a, b) => (a.kind === b.kind ? b.pop_1km - a.pop_1km : a.kind === 'prison' ? -1 : 1)), [layers.data.siteList]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of list) c[d.approach] = (c[d.approach] || 0) + 1;
    return c;
  }, [list]);

  // map colours follow the merged list (notifications change "missed")
  const geo = useMemo(() => {
    if (!dist.data.geo) return null;
    const by = new Map(list.map((d) => [d.id, d]));
    return { ...dist.data.geo, features: dist.data.geo.features.map((f: any) => ({ ...f, properties: { ...f.properties, ...by.get(f.properties.id) } })) };
  }, [dist.data.geo, list]);

  const tip = (pr: any) =>
    `<b>${esc(pr.name)}</b> · ${esc(pr.region)}<br/>Missed cases a year: <b>${fmtInt(Number(pr.missed))}</b> (${fmtInt(Number(pr.missed_100k))} per 100k)<br/>` +
    `People over 1 h walk from care: ${pr.walk_far != null && pr.walk_far !== 'null' ? pctFmt(Number(pr.walk_far)) : '—'}`;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="How priorities are set" subtitle="Three rules, applied in order. No hand-set weights: every number is reported, measured or estimated from those, and labelled." />
        <ol className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <li className="rounded-xl bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-900">1. Key populations first</div>
            <p className="text-sm text-gray-600 mt-1">Prisons and mining communities are screened wherever they are. Published screening finds TB in 1 in {prevNns(P.prev_prison)} prisoners and 1 in {prevNns(P.prev_miners)} miners, far above the general population.</p>
          </li>
          <li className="rounded-xl bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-900">2. Rank districts by missed cases</div>
            <p className="text-sm text-gray-600 mt-1">Missed = expected cases a year minus cases notified. Expected comes from WHO's national estimate, split by population and each region's HIV, undernourishment and smoking rates.</p>
          </li>
          <li className="rounded-xl bg-gray-50 p-4">
            <div className="text-sm font-semibold text-gray-900">3. Pick the approach</div>
            <p className="text-sm text-gray-600 mt-1">
              Notified below {rules.lowDetection != null ? pctFmt(rules.lowDetection) : '—'} of expected → fix detection first. At least {rules.walkFarShare != null ? pctFmt(rules.walkFarShare) : '—'} of people over an hour's walk from care → mobile outreach. Otherwise → clinics and household contacts.
            </p>
          </li>
        </ol>
      </Card>

      {!connected && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[15px] text-amber-900 flex flex-wrap items-center gap-3 justify-between">
          <span className="min-w-0">
            <b>District notifications are not connected yet.</b> Until DHIMS2 is linked (or notifications are uploaded), "missed" applies Ghana's national detection rate ({pctFmt(nat?.cdr)}) to every district, so the ranking shows where most cases are expected, not where detection is weakest.
          </span>
          <Button onClick={goData}>Connect data</Button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_440px] gap-6 items-start">
        <Card className="min-w-0">
          <CardHeader
            title="Missed TB cases by district"
            subtitle={metric === 'missed' ? 'Missed cases a year in each district. Click a district for the full picture.' : 'Share of people more than one hour on foot from the nearest health facility (Malaria Atlas Project).'}
            right={<Segmented size="sm" value={metric} onChange={setMetric} options={[{ value: 'missed', label: 'Missed cases' }, { value: 'walk_far', label: 'Far from care' }]} />}
          />
          {!connected && <p className="text-xs text-gray-500 mb-3">Rates per person differ little between districts today ({fmtInt(rateRange[0])} to {fmtInt(rateRange[1])} expected per 100,000) because risk-factor surveys are regional. District notifications will show the real differences.</p>}
          <TbMap districts={geo} metric={metric} breaks={breaks} selectedId={sel?.id} onSelect={(pr) => setSelId(pr.id)} tooltip={tip} height={600} />
          <TbLegend title={metric === 'missed' ? 'Missed a year' : 'Over 1 h walk'} breaks={breaks} fmt={fmt} />
        </Card>

        <Card className="min-w-0" pad={false}>
          <div className="p-6 pb-3">
            <CardHeader title="Where to act next" subtitle={`Ranked by missed cases a year${connected ? '' : ' (national detection rate applied)'}`} />
            <div className="flex flex-wrap gap-2">
              <Select className="w-[200px] [&_select]:h-9 [&_select]:text-sm" value={region} onChange={setRegion} placeholder="All regions" options={regions.map((r) => ({ value: r, label: r.replace(/ Region$/, '') }))} />
              <Select className="w-[220px] [&_select]:h-9 [&_select]:text-sm" value={appr} onChange={setAppr} placeholder="All approaches" options={(Object.keys(APPROACH) as ApproachKey[]).map((k) => ({ value: k, label: `${APPROACH[k].short} (${counts[k] || 0})` }))} />
            </div>
          </div>
          <ol className="divide-y divide-gray-100 border-t border-gray-100">
            {shown.slice(0, all ? shown.length : 15).map((d) => (
              <li key={d.id}>
                <button type="button" onClick={() => setSelId(d.id)} className={cx('w-full text-left px-6 py-3 flex gap-3 hover:bg-gray-50', sel?.id === d.id && 'bg-gray-50')}>
                  <span className="w-7 text-sm text-gray-400 tabular-nums pt-0.5">{d.rank}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-3">
                      <span className="font-medium text-gray-900 truncate">{d.name}</span>
                      <span className="shrink-0 text-right"><span className="tabular-nums font-semibold text-gray-900">{fmtInt(d.missed)}</span><span className="text-xs text-gray-500"> missed/yr</span></span>
                    </span>
                    <span className="block text-xs text-gray-500 truncate">
                      {d.region.replace(/ Region$/, '')} · expected {fmtInt(d.expected)} · notified {d.notified != null ? fmtInt(d.notified) : 'not connected'}
                    </span>
                    <span className="flex flex-wrap gap-1 mt-1.5">
                      <Badge className={APPROACH[d.approach].cls}>{APPROACH[d.approach].short}</Badge>
                      {d.walk_far != null && d.walk_far >= 0.05 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{pctFmt(d.walk_far)} &gt;1 h walk</span>}
                      {d.prisons > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{d.prisons} prison{d.prisons > 1 ? 's' : ''}</span>}
                      {d.mines > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{d.mines} mine/quarry</span>}
                      {d.screened > 0 && <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-50 text-green-700">{fmtInt(d.screened)} screened</span>}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {shown.length > 15 && (
            <div className="px-6 py-3 border-t border-gray-100"><button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setAll(!all)}>{all ? 'Show top 15' : `Show all ${shown.length}`}</button></div>
          )}
        </Card>
      </div>

      <KeyPopulations sites={keySites} P={P} onPlan={onPlan} />

      <Drawer open={!!sel} onClose={() => setSelId(null)} title={sel?.name} subtitle={sel ? `${sel.region} · ${fmtInt(sel.pop)} people · rank ${sel.rank} of ${list.length}` : ''}>
        {sel && <DistrictDetail d={sel} sites={layers.data.siteList.filter((s) => s.district_id === sel.id)} campaigns={campaigns.data.filter((c) => c.district_id === sel.id)} P={P} natRate={natRate} cdr={nat?.cdr ?? null} onPlan={onPlan} />}
      </Drawer>
    </div>
  );
}

const prevNns = (pct?: number) => (pct ? Math.round(100 / pct) : '—');

function KeyPopulations({ sites, P, onPlan }: { sites: TbSite[]; P: Record<string, number>; onPlan: (c: Partial<TbCampaign>) => void }) {
  const [all, setAll] = useState(false);
  const prisons = sites.filter((s) => s.kind === 'prison').length;
  return (
    <Card pad={false}>
      <div className="p-6 pb-3">
        <CardHeader
          title={`Key populations: ${prisons} prisons and ${sites.length - prisons} mine or quarry sites`}
          subtitle="Screen these regardless of district rank. Locations from OpenStreetMap, which misses some sites; add any you know of as a campaign."
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
              <th className="px-6 py-2.5 font-medium">Site</th><th className="px-3 py-2.5 font-medium">District</th>
              <th className="px-3 py-2.5 font-medium text-right">People living within 1 km <BasisTag b="measured" className="ml-1" /></th>
              <th className="px-3 py-2.5 font-medium text-right">Expected yield <BasisTag b="reported" className="ml-1" /></th>
              <th className="px-3 py-2.5 font-medium">Nearest facility</th><th className="px-6 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {sites.slice(0, all ? sites.length : 10).map((s, i) => {
              const prison = s.kind === 'prison';
              const prev = prison ? P.prev_prison : P.prev_miners;
              return (
                <tr key={i} className="border-b border-gray-100">
                  <td className="px-6 py-3 min-w-[240px]"><div className="text-gray-900">{s.name || (prison ? 'Unnamed prison' : 'Unnamed mine / quarry')}</div><div className="text-xs text-gray-500">{prison ? 'Prison' : 'Mine or quarry'}</div></td>
                  <td className="px-3 py-3 text-sm">{s.district || '—'}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{fmtInt(s.pop_1km)}</td>
                  <td className="px-3 py-3 text-right text-sm whitespace-nowrap">{prev ? `1 case per ${Math.round(100 / prev)} screened` : '—'}</td>
                  <td className="px-3 py-3 text-sm whitespace-nowrap">{kmFmt(s.facility_km)}</td>
                  <td className="px-6 py-3 text-right"><Button onClick={() => onPlan({ district_id: s.district_id, district_name: s.district, setting: prison ? 'prison' : 'mine', playbook_id: 'acf_congregate', name: `${s.name || (prison ? 'Prison' : 'Mining community')}: TB screening` })}>Plan</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {sites.length > 10 && <div className="px-6 py-3"><button type="button" className="text-sm text-brand-700 hover:underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${sites.length}`}</button></div>}
      <p className="px-6 pb-5 text-xs text-gray-500">Yields: Kranzer K et al., systematic review of TB screening yields (Lancet Infect Dis 2010), on the Data sources tab.</p>
    </Card>
  );
}

function DistrictDetail({ d, sites, campaigns, P, natRate, cdr, onPlan }: { d: TbDistrict; sites: TbSite[]; campaigns: TbCampaign[]; P: Record<string, number>; natRate: number | null; cdr: number | null; onPlan: (c: Partial<TbCampaign>) => void }) {
  const a = APPROACH[d.approach];
  const base = { district_id: d.id, district_name: d.name };
  const venues = [...sites].sort((x, y) => y.pop_1km - x.pop_1km).slice(0, 8);
  const p = expectedPositivity(a.setting, d, P, natRate);
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Figure label="Expected new cases a year" value={fmtInt(d.expected)} basis="estimated" sub={`${fmtInt(d.expected_100k)} per 100,000`} />
        <Figure label="Notified a year" value={d.notified != null ? fmtInt(d.notified) : 'Not connected'} basis="reported" sub={d.notified != null ? `${d.notified_basis} · ${pctFmt(d.detection)} of expected` : 'Connect DHIMS2 or upload notifications'} />
        <Figure label="Missed a year" value={fmtInt(d.missed)} basis="estimated" sub={d.notified != null ? 'expected minus notified' : `national detection rate ${pctFmt(cdr)} applied`} />
        <Figure label="Our screening here" value={d.screened ? `${fmtInt(d.confirmed)} found` : 'None yet'} basis="reported" sub={d.screened ? `${fmtInt(d.screened)} screened · 1 per ${d.confirmed ? fmtInt(d.screened / d.confirmed) : '—'}` : `${campaigns.length} campaign(s) planned`} />
      </div>

      <Card>
        <CardHeader title="Recommended approach" right={<Badge className={a.cls}>{a.short}</Badge>} />
        <div className="text-[15px] font-medium text-gray-900">{a.label}</div>
        <p className="text-[15px] text-gray-600 mt-1">{a.how}</p>
        <p className="text-xs text-gray-500 mt-2">{a.who}</p>
        <div className="flex flex-wrap items-center gap-3 mt-4">
          <Button variant="primary" icon="target" onClick={() => onPlan({ ...base, setting: a.setting, playbook_id: a.playbook, name: `${d.name}: ${a.short.toLowerCase()}` })}>Plan this</Button>
          {p != null && d.approach !== 'detection_gap' && <span className="text-sm text-gray-600">Expect about 1 case per {fmtInt(1 / p)} people screened <BasisTag b="estimated" /></span>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Why this many cases are expected" subtitle="WHO's cases attributable to each risk factor, split by population and this region's survey rates" />
        <PartsBar parts={d.parts} />
        <p className="text-xs text-gray-500 mt-3">Regional rates (DHS): HIV {d.hiv ?? '—'}% (2014) · thin adults {d.thin ?? '—'}% (2022) · tobacco use {d.smoke ?? '—'}% (2022).</p>
      </Card>

      <Card>
        <CardHeader title="Access to care" right={<BasisTag b="measured" />} />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <Mini label="Over 1 h walk to care" value={pctFmt(d.walk_far)} sub={d.walk_far_pop != null ? `${fmtInt(d.walk_far_pop)} people` : undefined} />
          <Mini label="Average walk to care" value={d.walk_min != null ? `${fmtInt(d.walk_min)} min` : '—'} />
          <Mini label="Average drive to care" value={`${fmtInt(d.minutes)} min`} />
          <Mini label="Health facilities mapped" value={fmtInt(d.facilities)} sub={`${d.hospitals} hospitals`} />
          <Mini label="Facilities per 100k" value={d.fac_100k.toFixed(1)} />
          <Mini label="Labs mapped" value={fmtInt(d.labs)} />
        </div>
        <p className="text-xs text-gray-500 mt-3">Travel times: Malaria Atlas Project. Facilities: OpenStreetMap, which misses some clinics.</p>
      </Card>

      {venues.length > 0 && (
        <Card pad={false}>
          <div className="p-6 pb-2"><CardHeader title="Places to screen in this district" subtitle="Markets, lorry stations, prisons and mines, by people living within 1 km" /></div>
          <ul className="divide-y divide-gray-100">
            {venues.map((s, i) => (
              <li key={i} className="px-6 py-3 flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-[15px]">{s.name || `Unnamed ${s.kind}`}</span>
                  <span className="text-xs text-gray-500">{s.kind} · {fmtInt(s.pop_1km)} people within 1 km · nearest facility {kmFmt(s.facility_km)}</span>
                </span>
                <Button className="shrink-0" onClick={() => onPlan({ ...base, setting: s.kind === 'prison' ? 'prison' : s.kind === 'mine / quarry' ? 'mine' : 'market', playbook_id: 'acf_congregate', name: `${s.name || s.kind}: TB screening` })}>Plan</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function Mini({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-3 min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  );
}
