import React, { useMemo, useState } from 'react';
import { Button, Card, CardHeader, ExtLink, Field, Modal, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { fmtTime } from '../../lib/format';
import { fmtInt, tbSave } from '../../lib/tb';
import type { TbData } from './TbPage';

const cleanName = (n: string) => n.replace(/\s*\((\d[\d,]*)\s*\w*\)$/, '');

export default function Evidence({ data }: { data: TbData }) {
  const { dist, params, results, campaigns } = data;
  const meta = dist.data.meta;
  const [uploading, setUploading] = useState(false);
  const news = data.news.data;
  // the pipeline's own log of what it pulled this run (and what it chose not to use, with why), plus the daily news feed
  const sources = useMemo(() => [
    ...(meta?.sources || []),
    { name: 'TB news: Google News and Bing News feeds, summarised by Gemini', url: 'https://news.google.com/', page: 'https://news.google.com/', ok: !!news, at: news?.generated_at || '',
      note: news ? `${news.articles} articles read for the summary of ${fmtTime(news.generated_at)}` : 'No summary written yet', group: 'News', gives: 'Recent TB news for Ghana, West Africa and the world', use: 'The daily "Latest on TB" summary', aurum: null },
  ], [meta, news]);
  const used = sources.filter((s) => s.ok !== null);
  const okCount = used.filter((s) => s.ok).length;
  const groups = useMemo(() => {
    const g = new Map<string, typeof sources>();
    for (const s of sources) g.set(s.group || 'Other', [...(g.get(s.group || 'Other') || []), s]);
    // the pipeline sets the order; anything it doesn't name (the news feed) comes before "Not used yet"
    const order = [...(meta?.source_groups || []).filter((x) => x !== 'Not used yet'), 'News', 'Not used yet'];
    const at = (k: string) => (order.indexOf(k) < 0 ? order.length - 1.5 : order.indexOf(k));
    return [...g.entries()].sort((a, b) => at(a[0]) - at(b[0]));
  }, [sources, meta]);
  const notifDistricts = dist.data.notifiedDistricts;
  const dh = dist.data.dhims2;
  const P = data.P;
  const evidence = params.data.filter((p) => p.status === 'evidence');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <Tile ok={okCount === used.length && used.length > 0} title="Open datasets" value={`${okCount} of ${used.length} pulled`} sub={meta ? `Last refresh ${fmtTime(meta.updated_at)} · weekly` : 'Not run yet'} />
        <Tile ok={!!dh?.connected} warn={!dh?.connected} title="DHIMS2 district data" value={dh?.connected ? `${dh.districts_matched} districts` : 'Not connected'} sub={dh?.connected ? `${dh.months?.[0]} to ${dh.months?.[1]}` : dh?.configured ? dh.message : 'Needs a read-only account from NTP / GHS'} />
        <Tile ok={notifDistricts > 0} warn={!notifDistricts} title="Uploaded notifications" value={notifDistricts ? `${notifDistricts} districts` : 'None yet'} sub={<button type="button" className="text-brand-700 hover:underline" onClick={() => setUploading(true)}>Upload from a report</button>} />
        <Tile ok={results.data.length > 0} warn={!results.data.length} title="Campaign results" value={results.data.length ? `${results.data.length} reports` : 'None yet'} sub={`${campaigns.data.length} campaign${campaigns.data.length === 1 ? '' : 's'}`} />
      </div>

      <Card pad={false}>
        <div className="p-6 pb-2"><CardHeader title="Datasets" subtitle="Listed straight from the weekly pipeline run: what it pulled, the counts it got, and what it chose not to use and why. Tagged rows come from Aurum's data list. Click a name to open the source." /></div>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="px-6 py-2.5 font-medium">Dataset</th><th className="px-3 py-2.5 font-medium">What it gives</th><th className="px-3 py-2.5 font-medium">Used for</th><th className="px-6 py-2.5 font-medium">This run</th>
              </tr>
            </thead>
            {groups.map(([g, list]) => (
              <tbody key={g}>
                <tr><td colSpan={4} className="px-6 pt-4 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">{g}</td></tr>
                {list.map((s, i) => (
                  <tr key={i} className="border-b border-gray-100 align-top">
                    <td className="px-6 py-3 min-w-[240px]">
                      <ExtLink href={s.page || s.url}>{cleanName(s.name)}</ExtLink>
                      {s.aurum != null && <span className="ml-2 inline-block rounded bg-amber-50 px-1.5 py-px text-[11px] font-medium text-amber-800 align-[1px]">Aurum #{s.aurum}</span>}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-700 min-w-[200px]">{s.gives}</td>
                    <td className="px-3 py-3 text-sm text-gray-700 min-w-[180px]">{s.use}</td>
                    <td className="px-6 py-3 min-w-[230px] max-w-[320px]">
                      <span className={cx('inline-flex items-center gap-1.5 text-sm font-medium', s.ok === null ? 'text-gray-600' : s.ok ? 'text-green-700' : 'text-red-700')}>
                        <Icon name={s.ok === null ? 'clock' : s.ok ? 'checkCircle' : 'alert'} size={16} />{s.ok === null ? 'Not used' : s.ok ? 'Pulled' : 'Failed this run'}
                      </span>
                      {s.note && <span className="block text-xs text-gray-500 mt-0.5">{s.note}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
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
