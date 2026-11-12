import React, { useMemo, useState } from 'react';
import { Button, Card, CardHeader, ExtLink, Field, Modal, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { fmtTime } from '../../lib/format';
import { tbSave } from '../../lib/tb';
import type { TbData } from './TbPage';

/** What each feed gives us and what it is used for, matched on the feed name the pipeline reports. */
const CATALOG: { match: RegExp; group: string; gives: string; use: string }[] = [
  { match: /attributable/i, group: 'TB numbers', gives: 'TB cases linked to HIV, undernourishment, smoking, alcohol, diabetes', use: 'Splitting expected cases by risk' },
  { match: /WHO/i, group: 'TB numbers', gives: 'Ghana\'s estimated and notified TB cases, by year', use: 'National totals: expected, found, missed' },
  { match: /DHS/i, group: 'Who is at risk', gives: 'HIV, thinness and smoking rates by region', use: 'Which regions carry more risk' },
  { match: /Wealth/i, group: 'Who is at risk', gives: 'Relative wealth of each ~2 km area', use: 'Poorer areas' },
  { match: /WorldPop/i, group: 'Where people live and reach care', gives: 'Population on a 100 m grid', use: 'Spreading cases to where people live' },
  { match: /Malaria Atlas|travel time/i, group: 'Where people live and reach care', gives: 'Travel time to the nearest health facility', use: 'Who is far from care' },
  { match: /health facilities/i, group: 'Where people live and reach care', gives: 'Clinics and hospitals', use: 'Distance to care, facility counts' },
  { match: /congregate|sites/i, group: 'Where people live and reach care', gives: 'Markets, lorry stations, prisons, mines', use: 'Screening venues and key populations' },
  { match: /geoBoundaries/i, group: 'Boundaries', gives: 'Region and district boundaries', use: 'Map and district totals' },
];
const describe = (name: string) => CATALOG.find((c) => c.match.test(name)) || { group: 'Other', gives: '', use: '' };
const cleanName = (n: string) => n.replace(/\s*\((\d[\d,]*)\s*\w*\)$/, '').replace(/^OpenStreetMap: /, 'OpenStreetMap · ');

export default function Evidence({ data }: { data: TbData }) {
  const { dist, params, results, campaigns } = data;
  const meta = dist.data.meta;
  const [uploading, setUploading] = useState(false);
  const sources = meta?.sources || [];
  const okCount = sources.filter((s) => s.ok).length;
  const groups = useMemo(() => {
    const g: Record<string, typeof sources> = {};
    for (const s of sources) (g[describe(s.name).group] ||= []).push(s);
    return ['TB numbers', 'Who is at risk', 'Where people live and reach care', 'Boundaries', 'Other'].filter((k) => g[k]).map((k) => [k, g[k]] as const);
  }, [sources]);
  const notifDistricts = (dist.data as any).notifiedDistricts ?? (dist.data as any).list?.filter((d: any) => d.notified_uploaded != null).length ?? 0;
  const evidence = params.data.filter((p) => p.status === 'evidence');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile ok={okCount === sources.length && sources.length > 0} title="Open datasets" value={`${okCount} of ${sources.length} pulled`} sub={meta ? `Last refresh ${fmtTime(meta.updated_at)} · weekly` : 'Not run yet'} />
        <Tile ok={false} warn title="DHIMS2 district data" value="Not connected" sub="Needs a read-only account from NTP / GHS" />
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
                      <td className="px-6 py-3 min-w-[260px]"><ExtLink href={s.url}>{cleanName(s.name)}</ExtLink>{count && <span className="block text-xs text-gray-500">{count[1]} {count[2] || 'records'}</span>}</td>
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
            <Step n={1}><b>Expected cases:</b> WHO's national estimate, shared across Ghana by where people live and each region's risk.</Step>
            <Step n={2}><b>Found:</b> notified cases. Until district data is connected, Ghana's national rate ({meta?.national ? `${Math.round(meta.national.cdr * 100)}%` : '—'}) is used everywhere.</Step>
            <Step n={3}><b>Hidden (missed):</b> expected minus found.</Step>
            <Step n={4}><b>Where to screen:</b> places with the most hidden cases, plus prisons, mines, markets and lorry stations.</Step>
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

      <CitiesCard data={data} />
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

function CitiesCard({ data }: { data: TbData }) {
  const [adding, setAdding] = useState(false);
  const [n, setN] = useState({ name: '', lat: '', lon: '', radius_km: '10' });
  const add = () => {
    const lat = Number(n.lat), lon = Number(n.lon);
    if (!n.name.trim() || !isFinite(lat) || !isFinite(lon)) return;
    tbSave('tb_cities', { id: n.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n.name.trim(), lat, lon, radius_km: Number(n.radius_km) || 10, h3_res: 8, enabled: true } as any);
    setN({ name: '', lat: '', lon: '', radius_km: '10' });
    setAdding(false);
  };
  return (
    <Card>
      <CardHeader title={`Cities mapped (${data.cities.data.filter((c) => c.enabled !== false).length})`} subtitle="Each gets a detailed hexagon map. New cities appear after the next weekly refresh." right={!adding && <Button icon="plus" onClick={() => setAdding(true)}>Add city</Button>} />
      <div className="flex flex-wrap gap-2">
        {data.cities.data.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-2 rounded-full border border-gray-200 px-3 py-1 text-sm">
            {c.name}<span className="text-gray-400">{c.radius_km} km</span>
          </span>
        ))}
      </div>
      {adding && (
        <div className="flex flex-wrap gap-2 mt-4">
          <TextInput className="w-48" placeholder="City name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
          <TextInput className="w-28" placeholder="Latitude" value={n.lat} onChange={(e) => setN({ ...n, lat: e.target.value })} />
          <TextInput className="w-28" placeholder="Longitude" value={n.lon} onChange={(e) => setN({ ...n, lon: e.target.value })} />
          <TextInput className="w-28" placeholder="Radius km" value={n.radius_km} onChange={(e) => setN({ ...n, radius_km: e.target.value })} />
          <Button variant="primary" onClick={add}>Add</Button>
          <Button onClick={() => setAdding(false)}>Cancel</Button>
        </div>
      )}
    </Card>
  );
}
