import React, { useMemo, useState } from 'react';
import { Button, Card, CardHeader, ExtLink, Field, Modal, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { fmtTime } from '../../lib/format';
import { fmtInt, tbSave } from '../../lib/tb';
import type { TbData } from './TbPage';

/** What each feed gives us and what it is used for, matched on the feed name the pipeline reports. */
const CATALOG: { match: RegExp; group: string; gives: string; use: string }[] = [
  { match: /DHIMS/i, group: 'TB numbers', gives: 'Monthly reported TB cases for Ashanti, Eastern and Volta, 2016-2023', use: 'Reported trend in those regions' },
  { match: /age group and sex/i, group: 'TB numbers', gives: 'Ghana TB cases by age group and sex', use: 'Expected cases from each district\'s age and sex mix' },
  { match: /attributable/i, group: 'TB numbers', gives: 'TB cases linked to HIV, undernourishment, smoking, alcohol', use: 'Regional risk adjustment' },
  { match: /WHO Global/i, group: 'TB numbers', gives: 'Ghana\'s estimated and notified TB cases, by year', use: 'National totals: expected, found, missed' },
  { match: /Census: population/i, group: 'Who lives where', gives: 'Population by district, single age and sex', use: 'Age and sex mix of each district' },
  { match: /WorldPop/i, group: 'Who lives where', gives: 'Population on a 100 m grid, 2026', use: 'People in each hexagon, town and spot; settlement density' },
  { match: /Open Buildings/i, group: 'Who lives where', gives: 'Every building footprint in Ghana (Google and Microsoft, combined by VIDA)', use: 'Buildings and people per building; high density points' },
  { match: /Census district boundaries/i, group: 'Boundaries', gives: 'The 261 districts used by GHS and DHIMS2', use: 'Map, district totals, joining DHIMS2' },
  { match: /sleeping rooms/i, group: 'Who is at risk', gives: 'Household size and sleeping rooms by district', use: 'Crowded homes' },
  { match: /poverty/i, group: 'Who is at risk', gives: 'Share of people in multidimensional poverty, by district', use: 'Poorer districts' },
  { match: /DHS/i, group: 'Who is at risk', gives: 'HIV, thinness and smoking rates by region', use: 'Which regions carry more risk' },
  { match: /OpenStreetMap/i, group: 'Places and access', gives: 'Health facilities, towns and villages, markets, lorry stations, prisons, mines, ports, industrial zones, schools, places of worship, roads', use: 'Town areas, screening spots, congregate sites, road access' },
  { match: /WHO\/KEMRI|Ghana Health Service facility/i, group: 'Places and access', gives: 'Public health facilities incl. CHPS compounds, merged with OpenStreetMap (duplicates within 100 m removed)', use: 'One facility list for every distance, travel time and facility count' },
  { match: /Malaria Atlas|friction/i, group: 'Places and access', gives: 'Walking and driving speed for every ~1 km of Ghana (2020)', use: 'Walk and drive time to the merged facility list; who is far from care' },
];
const describe = (name: string) => CATALOG.find((c) => c.match.test(name)) || { group: 'Other', gives: '', use: '' };
const cleanName = (n: string) => n.replace(/\s*\((\d[\d,]*)\s*\w*\)$/, '').replace(/^OpenStreetMap: /, 'OpenStreetMap · ');

export default function Evidence({ data }: { data: TbData }) {
  const { dist, params, results, campaigns } = data;
  const meta = dist.data.meta;
  const [uploading, setUploading] = useState(false);
  const sources = useMemo(() => meta?.sources || [], [meta]);
  const okCount = sources.filter((s) => s.ok).length;
  const groups = useMemo(() => {
    const g: Record<string, typeof sources> = {};
    for (const s of sources) (g[describe(s.name).group] ||= []).push(s);
    return ['TB numbers', 'Who lives where', 'Who is at risk', 'Where people live and reach care', 'Boundaries', 'Other'].filter((k) => g[k]).map((k) => [k, g[k]] as const);
  }, [sources]);
  const notifDistricts = dist.data.notifiedDistricts;
  const dh = dist.data.dhims2;
  const P = data.P;
  const evidence = params.data.filter((p) => p.status === 'evidence');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile ok={okCount === sources.length && sources.length > 0} title="Open datasets" value={`${okCount} of ${sources.length} pulled`} sub={meta ? `Last refresh ${fmtTime(meta.updated_at)} · weekly` : 'Not run yet'} />
        <Tile ok={!!dh?.connected} warn={!dh?.connected} title="DHIMS2 district data" value={dh?.connected ? `${dh.districts_matched} districts` : 'Not connected'} sub={dh?.connected ? `${dh.months?.[0]} to ${dh.months?.[1]}` : dh?.configured ? dh.message : 'Needs a read-only account from NTP / GHS'} />
        <Tile ok={notifDistricts > 0} warn={!notifDistricts} title="Uploaded notifications" value={notifDistricts ? `${notifDistricts} districts` : 'None yet'} sub={<button type="button" className="text-brand-700 hover:underline" onClick={() => setUploading(true)}>Upload from a report</button>} />
        <Tile ok={results.data.length > 0} warn={!results.data.length} title="Campaign results" value={results.data.length ? `${results.data.length} reports` : 'None yet'} sub={`${campaigns.data.length} campaign${campaigns.data.length === 1 ? '' : 's'}`} />
      </div>

      <Card pad={false}>
        <div className="p-6 pb-2"><CardHeader title="Datasets in use" subtitle="Pulled automatically every week. Click a name to open the source." /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="px-6 py-2.5 font-medium">Dataset</th><th className="px-3 py-2.5 font-medium">What it gives</th><th className="px-3 py-2.5 font-medium">Used for</th><th className="px-6 py-2.5 font-medium text-right">Status</th>
              </tr>
            </thead>
            {groups.map(([g, list]) => (
              <tbody key={g}>
                <tr><td colSpan={4} className="px-6 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{g}</td></tr>
                {list.map((s, i) => {
                  const d = describe(s.name);
                  const count = s.name.match(/\((\d[\d,]*)\s+([a-z]+)\)$/i);
                  return (
                    <tr key={i} className="border-b border-gray-100 align-top">
                      <td className="px-6 py-3 min-w-[260px]"><ExtLink href={s.page || s.url}>{cleanName(s.name)}</ExtLink>{count && <span className="block text-xs text-gray-500">{count[1]} {count[2] || 'records'}</span>}</td>
                      <td className="px-3 py-3 text-sm text-gray-700 min-w-[220px]">{d.gives}</td>
                      <td className="px-3 py-3 text-sm text-gray-700 min-w-[200px]">{d.use}</td>
                      <td className="px-6 py-3 text-right whitespace-nowrap">
                        <span className={cx('inline-flex items-center gap-1.5 text-sm', s.ok ? 'text-green-700' : 'text-red-700')} title={s.note || ''}><Icon name={s.ok ? 'checkCircle' : 'alert'} size={16} />{s.ok ? 'Pulled' : 'Failed'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </div>
        <p className="px-6 py-4 text-xs text-gray-500">Not used yet because they need data-sharing agreements: DHIMS2 district TB data, the TB e-Tracker, GeneXpert results (GxAlert), and phone-based movement data.</p>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="How the numbers are made" />
          <ol className="space-y-2.5 text-[15px] text-gray-700">
            <Step n={1}><b>Expected cases:</b> WHO's TB rates for each age group and sex, applied to each district's Census 2021 population, grown to 2026 with WorldPop. The cases WHO links to HIV, undernourishment and smoking are scaled by the region's survey rates. All districts add up to WHO's {fmtInt(meta?.national?.incidence)}.</Step>
            <Step n={2}><b>Inside a district:</b> towns are the area nearest each OpenStreetMap place; hexagons (H3, ~0.74 km²) carry WorldPop people, buildings and expected cases (people × district rate). Each hexagon's high density point is its spot with the most buildings within ~350 m, counted inside that hexagon only, and moved to a road inside the hexagon when one is close. Town figures are the sum of their hexagons.</Step>
            <Step n={3}><b>Access:</b> one facility list (OpenStreetMap + WHO/KEMRI). Distance is the straight line to the facility reached fastest; walk and drive time is the route to that same facility over Malaria Atlas travel speeds.</Step>
            <Step n={4}><b>Approach:</b> notified below {P.rule_low_detection != null ? `${Math.round(P.rule_low_detection * 100)}%` : '—'} of expected → fix detection (needs DHIMS2); {P.rule_walk_far_share != null ? `${Math.round(P.rule_walk_far_share * 100)}%` : '—'}+ of people over an hour's walk from care → mobile outreach; otherwise community and contact screening. Playbooks follow the <ExtLink href="https://www.who.int/publications-detail-redirect/9789240022614">WHO screening handbook</ExtLink> and <ExtLink href="https://media.path.org/documents/Ghana_Digital_Adaptation_Kit_for_TB_2025.pdf">Ghana's TB adaptation kit</ExtLink>.</Step>
          </ol>
        </Card>
        <Card>
          <CardHeader title="Published evidence used" subtitle="Share of people screened who turn out to have TB" />
          <ul className="divide-y divide-gray-100">
            {evidence.map((p) => (
              <li key={p.id} className="py-2.5 flex items-start justify-between gap-4 text-[15px]">
                <span className="min-w-0">{p.label}{p.source_url && <span className="block text-xs"><ExtLink href={p.source_url}>{p.source_title}</ExtLink></span>}</span>
                <span className="shrink-0 font-semibold tabular-nums">{p.value}{p.unit === '%' ? '%' : ` ${p.unit || ''}`}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {uploading && <UploadNotifications data={data} onClose={() => setUploading(false)} />}
    </div>
  );
}

function Tile({ ok, warn, title, value, sub }: { ok: boolean; warn?: boolean; title: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 min-w-0">
      <div className="flex items-center gap-2 text-sm text-gray-500"><Icon name={ok ? 'checkCircle' : warn ? 'alert' : 'clock'} size={16} className={ok ? 'text-green-600' : warn ? 'text-amber-600' : 'text-gray-400'} />{title}</div>
      <div className="text-xl font-semibold text-gray-900 mt-1.5">{value}</div>
      {sub && <div className="text-sm text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return <li className="flex gap-3"><span className="shrink-0 w-6 h-6 rounded-full bg-gray-100 text-gray-600 text-xs font-semibold grid place-items-center mt-0.5">{n}</span><span>{children}</span></li>;
}

const norm = (s: string) => s.toLowerCase().replace(/\b(municipal|metropolitan|district|assembly|metro|municipality)\b/g, '').replace(/[^a-z]/g, '');

function UploadNotifications({ data, onClose }: { data: TbData; onClose: () => void }) {
  const me = useMe();
  const [text, setText] = useState('');
  const [source, setSource] = useState('');
  const [done, setDone] = useState<number | null>(null);
  const index = useMemo(() => new Map(data.dist.data.list.map((d) => [norm(d.name), d])), [data.dist.data.list]);
  const rows = useMemo(() => {
    return text.split(/\r?\n/).map((l) => l.split(/\t|,/).map((x) => x.trim())).filter((r) => r.length >= 3 && r[0] && !/^district/i.test(r[0])).map((r) => {
      const d = index.get(norm(r[0]));
      return { raw: r[0], d, period: r[1], notified: Number(r[2]), bact: r[3] ? Number(r[3]) : null };
    });
  }, [text, index]);
  const ok = rows.filter((r) => r.d && r.period && isFinite(r.notified));
  const save = async () => {
    for (const r of ok) await tbSave('tb_notifications', { id: `${r.d!.id}|${r.period}`, district_id: r.d!.id, district_name: r.d!.name, period: r.period, notified: r.notified, bact_confirmed: r.bact, source: source || null, uploaded_by: me.email } as any);
    setDone(ok.length);
  };
  return (
    <Modal open onClose={onClose} title="Upload district TB notifications" footer={done != null ? <Button variant="primary" onClick={onClose}>Close</Button> : <><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!ok.length}>Save {ok.length} rows</Button></>}>
      {done != null ? (
        <p className="text-[15px]">Saved {done} rows. Reload the page to see them.</p>
      ) : (
        <>
          <p className="text-sm text-gray-600">Paste from a spreadsheet: <b>district, period, notified</b> and optionally <b>bacteriologically confirmed</b>. Period can be a year (2025), month (2025-07) or quarter (2025-Q3).</p>
          <TextArea rows={8} className="font-mono text-[13px]" placeholder={'District, Period, Notified, Bact. confirmed\nAccra Metropolitan, 2025, 1200, 800'} value={text} onChange={(e) => setText(e.target.value)} />
          <Field label="Source (optional)"><TextInput className="w-full" placeholder="e.g. NTP quarterly report Q3 2025" value={source} onChange={(e) => setSource(e.target.value)} /></Field>
          {rows.length > 0 && <p className="text-sm">{ok.length} of {rows.length} rows matched a district{rows.length > ok.length ? `; not matched: ${rows.filter((r) => !r.d).map((r) => r.raw).slice(0, 6).join(', ')}` : ''}.</p>}
        </>
      )}
    </Modal>
  );
}
