import React from 'react';
import { OUTREACH_COLOR } from '../../components/ExplorerMap';
import { Button, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { expectedPositivity, fmtInt, OutreachArea, OutreachCommunity, OutreachCounts, TbDistrict } from '../../lib/tb';
import { esc, HowTag, kmFmt, Panel } from './common';


const MONTH = (p: string, year = false) => new Date(`${p}-01T00:00:00`).toLocaleString('en-GB', { month: 'short', ...(year ? { year: 'numeric' } : {}) });
export const spanOf = (a: OutreachArea) => (a.months.length ? `${MONTH(a.months[0].period)}–${MONTH(a.months[a.months.length - 1].period, true)}` : '');
const share = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—');
const oneIn = (pos: number, screened: number) => (pos > 0 ? `1 in ${fmtInt(screened / pos)}` : 'none found');
/** A short name for the area: the directorate name without "Metro Health Directorate". */
export const placeOf = (a: OutreachArea) => a.name.replace(/\s+(Metro(politan)?|Municipal|District)?\s*Health Directorate$/i, '');

const howOf = (a: OutreachArea) => `Monthly community outreach returns${a.sharedBy ? ` shared by ${a.sharedBy}` : ''}: people screened, presumed, tested, positive and started on treatment, by community, as written in the report (every month's community rows add up to the report's own totals). Source: ${a.source || 'outreach report'}.`;

/** The five-step outreach cascade, each step as a share of the one before. */
function Cascade({ t }: { t: OutreachCounts }) {
  const steps: [string, number, string | null][] = [
    ['Screened', t.screened, null], ['Presumed TB', t.presumed, share(t.presumed, t.screened)], ['Tested', t.tested, share(t.tested, t.presumed)],
    ['TB positive', t.positive, share(t.positive, t.tested)], ['On treatment', t.treated, share(t.treated, t.positive)],
  ];
  return (
    <ol className="grid grid-cols-5 gap-1.5">
      {steps.map(([label, n, of], i) => (
        <li key={label} className={cx('rounded-lg px-2 py-2 min-w-0', i === 3 ? 'bg-red-50' : 'bg-gray-50')}>
          <div className="text-[11px] text-gray-500 leading-tight">{label}</div>
          <div className={cx('text-base font-semibold tabular-nums', i === 3 ? 'text-red-800' : 'text-gray-900')}>{fmtInt(n)}</div>
          <div className="text-[11px] text-gray-500 tabular-nums">{of ? `${of} of prev.` : ' '}</div>
        </li>
      ))}
    </ol>
  );
}

/** Top of the right panel: the outreach area the demo is about, with one click to open it. */
export function OutreachCard({ area, onOpen }: { area: OutreachArea; onOpen: () => void }) {
  const t = area.totals;
  const missing = area.months.filter((m) => !m.has_data).map((m) => MONTH(m.period));
  return (
    <section className="rounded-2xl border-2 bg-white p-5" style={{ borderColor: OUTREACH_COLOR }}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide" style={{ color: OUTREACH_COLOR }}>Outreach area</div>
          <h3 className="text-base font-semibold text-gray-900">{placeOf(area)} · {spanOf(area)}</h3>
          <p className="text-sm text-gray-500">Community TB outreach{area.sharedBy ? `, shared by ${area.sharedBy}` : ''}</p>
        </div>
        <HowTag b="reported" how={howOf(area)} />
      </div>
      <Cascade t={t} />
      <p className="text-sm text-gray-700 mt-3"><b>{oneIn(t.positive, t.screened)}</b> people screened had TB, across {area.communities.length} communities.</p>
      <p className="text-xs text-gray-500 mt-1">{area.reported} of {area.months.length} months reported{missing.length ? ` · no report for ${missing.join(', ')}` : ''}.</p>
      <Button variant="primary" icon="map" className="mt-3" onClick={onOpen}>Open {placeOf(area)}</Button>
    </section>
  );
}

/** Two aligned rows of monthly bars (screened, then TB positive), each on its own scale; months without a report are marked. */
function Months({ area }: { area: OutreachArea }) {
  const rows = area.months.map((m) => ({ m, v: m.has_data ? m.reported : null }));
  const row = (label: string, key: keyof OutreachCounts, color: string) => {
    const max = Math.max(1, ...rows.map((r) => (r.v ? r.v[key] : 0)));
    return (
      <div>
        <div className="text-xs text-gray-500 mb-1">{label}</div>
        <div className="flex items-end gap-1 h-16">
          {rows.map(({ m, v }) => (
            <div key={m.period} className="flex-1 h-full flex flex-col justify-end items-center" title={`${MONTH(m.period, true)}: ${v ? `${fmtInt(v[key])} ${label.toLowerCase()}` : 'no report'}`}>
              {v ? <>
                <span className="text-[10px] tabular-nums text-gray-600">{fmtInt(v[key])}</span>
                <span className="w-full rounded-t" style={{ height: `${Math.max(3, (v[key] / max) * 44)}px`, background: color }} />
              </> : <span className="w-full border-t-2 border-dashed border-gray-300" />}
            </div>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className="space-y-2">
      {row('Screened', 'screened', '#94a3b8')}
      {row('TB positive', 'positive', OUTREACH_COLOR)}
      <div className="flex gap-1">{rows.map(({ m }) => <span key={m.period} className="flex-1 text-center text-[10px] text-gray-500">{MONTH(m.period)}</span>)}</div>
      <p className="text-[11px] text-gray-400">Dashed: no report for that month (a gap, not zero).</p>
    </div>
  );
}

/** Where a community sits on the map, in words. */
export function placeWords(c: OutreachCommunity) {
  const s = c.site;
  if (!s || s.lon == null) return 'Not found in OpenStreetMap, so not on the map';
  if (s.match === 'feature') return `Placed at "${s.osm_name}" (OpenStreetMap); the community centre itself is not mapped`;
  if (s.match === 'close') return `OpenStreetMap spells it "${s.osm_name}"`;
  return `OpenStreetMap ${s.osm_place || 'place'}`;
}

/** District level: what outreach found here, month by month and community by community, beside the model. */
export function OutreachDetail({ area, d, P, natRate, onCommunity }: { area: OutreachArea; d: TbDistrict; P: Record<string, number>; natRate: number | null; onCommunity: (c: OutreachCommunity) => void }) {
  const here = area.id === d.id;
  const comms = here ? area.communities : area.communities.filter((c) => c.site?.district_id === d.id);
  if (!comms.length) return null;
  const t = area.totals;
  const model = expectedPositivity('community', d, P, natRate);
  return (
    <Panel title={here ? `Outreach in ${placeOf(area)}` : 'Outreach communities in this district'} right={<HowTag b="reported" how={howOf(area)} />}
      sub={here ? `${spanOf(area)} · ${area.reported} of ${area.months.length} months reported · ${area.communities.length} communities` : `Reported by ${area.name}; these communities lie inside ${d.name}.`}
    >
      {here && <>
        <Cascade t={t} />
        <div className="mt-4"><Months area={area} /></div>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <div className="rounded-xl bg-red-50 p-3">
            <div className="flex items-start justify-between gap-2 text-xs text-gray-600"><span>Found by outreach</span><HowTag b="reported" how={`${fmtInt(t.positive)} positive ÷ ${fmtInt(t.screened)} screened, all reported months.`} /></div>
            <div className="text-lg font-semibold text-red-800 tabular-nums">{t.screened ? `${((t.positive / t.screened) * 100).toFixed(1)}%` : '—'}</div>
            <div className="text-xs text-gray-600">of people screened had TB</div>
          </div>
          <div className="rounded-xl bg-gray-50 p-3">
            <div className="flex items-start justify-between gap-2 text-xs text-gray-600"><span>Model for this district</span><HowTag b="estimated" how="Expected share positive if everyone aged 15+ is screened: Ghana's community prevalence survey yield (Parameters) scaled by this district's expected rate against Ghana's." /></div>
            <div className="text-lg font-semibold text-gray-900 tabular-nums">{model != null ? `${(model * 100).toFixed(1)}%` : '—'}</div>
            <div className="text-xs text-gray-600">if everyone 15+ were screened</div>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">The two measure different things: the model screens everyone aged 15+, while outreach yield depends on whom the teams screen.</p>
        {area.notes.map((n) => <p key={n.period} className="text-sm bg-amber-50 text-amber-900 rounded-lg px-3 py-2 mt-3"><b>{MONTH(n.period, true)}:</b> {n.note}</p>)}
      </>}
      <table className="w-full text-sm mt-4">
        <thead><tr className="text-xs text-gray-500 text-left"><th className="font-normal pb-1.5">Community</th><th className="font-normal pb-1.5 text-right">Screened</th><th className="font-normal pb-1.5 text-right">TB+</th><th className="font-normal pb-1.5 text-right">Yield</th></tr></thead>
        <tbody className="divide-y divide-gray-100">
          {comms.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-gray-50" onClick={() => onCommunity(c)}>
              <td className="py-2 pr-2">
                <span className="flex items-center gap-1.5 font-medium text-gray-900"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c.site?.lon != null ? OUTREACH_COLOR : '#d1d5db' }} />{c.name}</span>
                <span className="block text-xs text-gray-500">{c.periods.length} visit{c.periods.length === 1 ? '' : 's'} · {placeWords(c)}</span>
              </td>
              <td className="py-2 text-right tabular-nums">{fmtInt(c.totals.screened)}</td>
              <td className="py-2 text-right tabular-nums font-semibold">{fmtInt(c.totals.positive)}</td>
              <td className="py-2 text-right tabular-nums text-gray-600 whitespace-nowrap">{oneIn(c.totals.positive, c.totals.screened)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-500 mt-2 flex gap-1.5"><Icon name="pin" size={13} className="mt-px shrink-0" />Click a community to find it on the map. Each is placed from the same OpenStreetMap snapshot as the rest of the map.</p>
    </Panel>
  );
}

/** Town level: outreach communities that sit in this town's area. */
export function OutreachInTown({ comms }: { comms: OutreachCommunity[] }) {
  if (!comms.length) return null;
  return (
    <Panel title="Outreach here" sub="Communities in this town's area that outreach teams visited">
      <ul className="divide-y divide-gray-100 text-sm">
        {comms.map((c) => (
          <li key={c.id} className="py-2 flex justify-between gap-3">
            <span className="min-w-0"><span className="font-medium">{c.name}</span><span className="block text-xs text-gray-500">{c.periods.length} visit{c.periods.length === 1 ? '' : 's'}{c.site?.facility ? ` · nearest facility ${c.site.facility} (${kmFmt(c.site.facility_km)})` : ''}</span></span>
            <span className="text-right tabular-nums shrink-0"><b>{fmtInt(c.totals.positive)}</b> TB+<span className="block text-xs text-gray-500">{fmtInt(c.totals.screened)} screened</span></span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Map points for located communities (circle size follows TB found) and their hover text. */
export function outreachFc(areas: OutreachArea[]) {
  const features = areas.flatMap((a) => a.communities.filter((c) => c.site?.lon != null && c.site.lat != null).map((c) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [c.site!.lon, c.site!.lat] },
    properties: { id: c.id, name: c.name, pos: c.totals.positive, scr: c.totals.screened, visits: c.periods.length, where: placeWords(c), fac: c.site!.facility || '', fkm: c.site!.facility_km ?? '', walk: c.site!.walk_min ?? '', area: placeOf(a) },
  })));
  return { type: 'FeatureCollection', features };
}
export const outreachTip = (pr: any) => `<b>${esc(pr.name)}</b> · outreach (${esc(pr.area)})<br/><b>${fmtInt(Number(pr.pos))}</b> TB positive of ${fmtInt(Number(pr.scr))} screened in ${pr.visits} visit${Number(pr.visits) === 1 ? '' : 's'}${pr.fac ? `<br/>Nearest facility: ${esc(pr.fac)}${pr.fkm !== '' ? ` (${kmFmt(Number(pr.fkm))}${pr.walk !== '' ? `, ${fmtInt(Number(pr.walk))} min walk` : ''})` : ''}` : ''}<br/><span style="color:#6b7280">${esc(pr.where)}</span>`;
