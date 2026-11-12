import React, { useMemo, useState } from 'react';
import TbMap, { breaksFor, TbLegend } from '../../components/TbMap';
import { Badge, Button, Card, CardHeader, Drawer, Segmented } from '../../components/ui';
import { fmtInt, METRICS, TbCampaign, TbDistrict } from '../../lib/tb';
import type { TbData } from './TbPage';

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

/** Plain-language reasons a district scores high, from the model's multipliers. */
export function drivers(d: TbDistrict, avgMinutes: number) {
  const out: { label: string; tone: 'up' | 'down' }[] = [];
  if (d.m_poverty > 1.08) out.push({ label: 'poorer than average', tone: 'up' });
  if (d.m_density > 1.08) out.push({ label: 'crowded', tone: 'up' });
  if (d.m_risk > 1.25) out.push({ label: 'more HIV / undernutrition', tone: 'up' });
  if (d.minutes > avgMinutes * 1.5) out.push({ label: 'far from care', tone: 'up' });
  if (d.prisons) out.push({ label: `${d.prisons} prison${d.prisons > 1 ? 's' : ''}`, tone: 'up' });
  if (d.mines) out.push({ label: `${d.mines} mine/quarry sites`, tone: 'up' });
  if (d.calibration && d.calibration > 1.15) out.push({ label: 'campaigns found more than expected', tone: 'up' });
  if (d.calibration && d.calibration < 0.85) out.push({ label: 'campaigns found less than expected', tone: 'down' });
  return out;
}

export default function Hotspots({ data, onPlan }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void }) {
  const { dist, layers, campaigns, P } = data;
  const [metric, setMetric] = useState<string>('priority');
  const [show, setShow] = useState({ blind: true, facilities: false, sites: false, links: true });
  const [sel, setSel] = useState<TbDistrict | null>(null);
  const list = dist.data.list;
  const m = METRICS.find((x) => x.key === metric)!;
  const breaks = useMemo(() => breaksFor(list.map((d) => Number((d as any)[metric]))), [list, metric]);
  const blindCut = useMemo(() => (list.length ? [...list].map((d) => d.blind).sort((a, b) => a - b)[Math.floor(list.length * 0.85)] : null), [list]);
  const avgMin = useMemo(() => list.reduce((s, d) => s + d.minutes * d.pop, 0) / Math.max(1, list.reduce((s, d) => s + d.pop, 0)), [list]);
  const ranked = useMemo(() => [...list].sort((a, b) => Number((b as any)[metric]) - Number((a as any)[metric])).slice(0, 15), [list, metric]);
  const fmt = m.fmt;

  const tip = (pr: any, layer: string) => {
    if (layer === 'facility') return `<b>${esc(pr.name || 'Health facility')}</b><br/>${esc(pr.kind)}${pr.lab === true || pr.lab === 'true' ? ' · lab' : ''}`;
    if (layer === 'site') return `<b>${esc(pr.name || pr.kind)}</b><br/>${esc(pr.kind)}`;
    return `<b>${esc(pr.name)}</b> · ${esc(pr.region)}<br/>${m.label}: <b>${fmt(Number(pr[metric]))}</b><br/>Hidden cases ≈ ${fmtInt(Number(pr.hidden))} · blind-spot ${Number(pr.blind).toFixed(0)}`;
  };

  return (
    <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_420px] gap-6">
      <Card className="min-w-0">
        <CardHeader title="Where undiagnosed TB is likely to be" subtitle={m.help} right={<Segmented size="sm" value={metric} onChange={setMetric} options={METRICS.map((x) => ({ value: x.key, label: x.label }))} />} />
        <div className="flex flex-wrap gap-2 mb-3 text-sm">
          {([['blind', 'Blind spots'], ['links', 'Travel links'], ['facilities', 'Health facilities'], ['sites', 'Markets, transport, prisons, mines']] as const).map(([k, label]) => (
            <label key={k} className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 cursor-pointer select-none">
              <input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
        <TbMap
          districts={dist.data.geo}
          facilities={show.facilities ? layers.data.facilities : null}
          sites={show.sites ? layers.data.sites : null}
          metric={metric}
          breaks={breaks}
          blindThreshold={show.blind ? blindCut : null}
          selectedId={sel?.id}
          flowFrom={show.links && sel ? [sel.lon, sel.lat] : null}
          flows={show.links && sel ? sel.flows : []}
          onSelect={(pr) => setSel(list.find((d) => d.id === pr.id) || null)}
          tooltip={tip}
          height={560}
        />
        <TbLegend title={m.label} breaks={breaks} fmt={fmt} blind={show.blind} />
        <p className="text-xs text-gray-500 mt-2">
          {dist.data.hasPrivate ? 'Includes notifications and campaign results your team uploaded.' : 'Open-data model only: upload district notifications on the Data sources tab to measure the real detection gap.'} Travel links are modelled from population and distance until GSS/Flowminder movement data is shared.
        </p>
      </Card>

      <Card className="min-w-0">
        <CardHeader title={`Top districts by ${m.label.toLowerCase()}`} subtitle="Click a district for the evidence and to plan case-finding" />
        <ol className="divide-y divide-gray-100">
          {ranked.map((d, i) => (
            <li key={d.id}>
              <button type="button" onClick={() => setSel(d)} className="w-full text-left py-3 flex gap-3 hover:bg-gray-50 rounded-lg px-2">
                <span className="w-6 text-sm text-gray-400 tabular-nums pt-0.5">{i + 1}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="font-medium text-gray-900 truncate">{d.name}</span>
                    <span className="text-sm tabular-nums text-gray-900 shrink-0">{fmt(Number((d as any)[metric]))}</span>
                  </span>
                  <span className="block text-xs text-gray-500 truncate">{d.region} · ≈{fmtInt(d.hidden)} hidden cases · {fmtInt(d.pop)} people</span>
                  <span className="flex flex-wrap gap-1 mt-1">
                    {drivers(d, avgMin).slice(0, 3).map((x) => (
                      <span key={x.label} className="text-[11px] px-1.5 py-px rounded bg-orange-50 text-orange-800">{x.label}</span>
                    ))}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      </Card>

      <Drawer open={!!sel} onClose={() => setSel(null)} title={sel?.name} subtitle={sel ? `${sel.region} · ${fmtInt(sel.pop)} people · rank ${sel.rank} of ${list.length}` : ''}>
        {sel && <DistrictDetail d={sel} avgMin={avgMin} campaigns={campaigns.data.filter((c) => c.district_id === sel.id)} P={P} onPlan={onPlan} />}
      </Drawer>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900 tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

function DistrictDetail({ d, avgMin, campaigns, P, onPlan }: { d: TbDistrict; avgMin: number; campaigns: TbCampaign[]; P: Record<string, number>; onPlan: (c: Partial<TbCampaign>) => void }) {
  const notified = d.notified ?? d.expected * d.cdr;
  const base = { district_id: d.id, district_name: d.name };
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Expected new cases / year" value={fmtInt(d.expected)} sub={d.calibration && d.calibration !== 1 ? `adjusted ×${d.calibration.toFixed(2)} by campaign results` : 'from WHO national estimate'} />
        <Stat label={d.notified != null ? 'Notified (uploaded)' : 'Notified (modelled)'} value={fmtInt(notified)} sub={d.notified != null ? `gap ${fmtInt(d.gap)}` : 'upload notifications to replace this'} />
        <Stat label="Hidden cases / year" value={fmtInt(d.hidden)} sub={`${d.hidden_100k.toFixed(0)} per 100,000`} />
        <Stat label="Blind-spot score" value={`${d.blind.toFixed(0)} / 100`} sub={`${Math.round(d.pct_far * 100)}% of people > 1 h from care`} />
      </div>

      <Card>
        <CardHeader title="Why this district" subtitle="Each factor multiplies the national rate" />
        <ul className="space-y-2 text-[15px]">
          <li>Risk factors (HIV {d.hiv ?? '—'}%, thin adults {d.thin ?? '—'}%, smoking {d.smoke ?? '—'}%, regional DHS): <b>×{d.m_risk.toFixed(2)}</b></li>
          <li>Crowding ({fmtInt(d.density)} people/km²): <b>×{d.m_density.toFixed(2)}</b></li>
          <li>Wealth (Meta Relative Wealth Index {d.rwi.toFixed(2)}): <b>×{d.m_poverty.toFixed(2)}</b></li>
          <li>Access: {d.minutes.toFixed(0)} min average to care (Ghana average {avgMin.toFixed(0)}), so about <b>{Math.round(d.cdr * 100)}%</b> of cases are expected to be diagnosed</li>
        </ul>
        <div className="flex flex-wrap gap-1.5 mt-3">{drivers(d, avgMin).map((x) => <Badge key={x.label} className="bg-orange-50 text-orange-800">{x.label}</Badge>)}</div>
      </Card>

      <Card>
        <CardHeader title="Health system and congregate settings" subtitle="OpenStreetMap; may be incomplete" />
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Facilities" value={d.facilities} sub={`${d.hospitals} hospitals`} />
          <Stat label="Labs mapped" value={d.labs} />
          <Stat label="Markets / hubs" value={`${d.markets} / ${d.hubs}`} />
          <Stat label="Prisons" value={d.prisons} />
          <Stat label="Mines / quarries" value={d.mines} />
          <Stat label="People per facility" value={fmtInt(d.pop / Math.max(d.facilities, 1))} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Where people travel (modelled)" subtitle="Gravity model on population and distance; replace with GSS/Telecel/Flowminder data when shared" />
        <ul className="text-[15px] space-y-1.5">
          {d.flows.map((f) => (
            <li key={f.id} className="flex justify-between gap-3"><span className="truncate">{f.name}</span><span className="tabular-nums text-gray-500">{Math.round(f.share * 100)}% of trips</span></li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Act" subtitle={campaigns.length ? `${campaigns.length} campaign(s) already in this district` : 'No case-finding campaigns here yet'} />
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="target" onClick={() => onPlan({ ...base, setting: 'community', playbook_id: 'acf_community', name: `${d.name}: community case-finding` })}>Plan community case-finding</Button>
          {(d.prisons > 0 || d.mines > 0 || d.markets > 0) && (
            <Button icon="building" onClick={() => onPlan({ ...base, setting: d.prisons ? 'prison' : d.mines ? 'mine' : 'market', playbook_id: 'acf_congregate', name: `${d.name}: ${d.prisons ? 'prison' : d.mines ? 'mining community' : 'market'} screening` })}>Screen a congregate setting</Button>
          )}
          {d.blind >= 50 && <Button icon="search" onClick={() => onPlan({ ...base, setting: 'outreach', playbook_id: 'blind_spot', name: `${d.name}: blind-spot check` })}>Blind-spot check</Button>}
          {d.gap != null && d.gap > 0 && <Button icon="flag" onClick={() => onPlan({ ...base, setting: 'facility', playbook_id: 'detection_gap', name: `${d.name}: detection-gap review` })}>Detection-gap review</Button>}
        </div>
        <p className="text-xs text-gray-500 mt-3">Expected yield in a community campaign here: about 1 confirmed case per {Math.round(1 / ((d.prev_adult / 1e5) * (P.cxr_cad_sensitivity ?? 0.9)))} people screened with chest X-ray + AI.</p>
      </Card>
    </>
  );
}
