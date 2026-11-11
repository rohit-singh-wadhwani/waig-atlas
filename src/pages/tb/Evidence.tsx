import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, ExtLink, Field, Modal, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { fmtTime } from '../../lib/format';
import { tbSave, TbParam, TbPlaybook, TbStep } from '../../lib/tb';
import type { TbData } from './TbPage';

export default function Evidence({ data }: { data: TbData }) {
  const { dist, params, playbooks, cities } = data;
  const meta = dist.data.meta;
  const groups = useMemo(() => {
    const g: Record<string, TbParam[]> = {};
    for (const p of params.data) (g[p.grp] ||= []).push(p);
    return g;
  }, [params.data]);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<TbPlaybook | null>(null);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Card className="min-w-0">
          <CardHeader title="Data feeds" subtitle={meta ? `Last weekly run ${fmtTime(meta.updated_at)}${meta.access_basis ? ` · access from ${meta.access_basis}` : ''}` : 'Not run yet'} />
          <ul className="space-y-2.5">
            {(meta?.sources || []).map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[15px]">
                <Icon name={s.ok ? 'checkCircle' : 'alert'} size={17} className={cx('mt-0.5 shrink-0', s.ok ? 'text-green-600' : 'text-red-600')} />
                <span className="min-w-0">
                  <ExtLink href={s.url}>{s.name}</ExtLink>
                  {s.note && <span className="block text-xs text-gray-500">{s.note}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-gray-500 mt-4">Private inputs: {meta?.private || '—'}. Phone-based mobility (GSS/Telecel/Flowminder), DHIMS2 and TB e-Tracker data need a data-sharing agreement; upload them below when you have them.</p>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Your data" subtitle="Private to signed-in team members; used at the next weekly model run" right={<Button variant="primary" icon="upload" onClick={() => setUploading(true)}>Upload notifications</Button>} />
          <ul className="text-[15px] space-y-2 text-gray-700">
            <li><b>District notifications</b> (NTP / DHIMS2 / partner reports): turn the modelled detection gap into a measured one.</li>
            <li><b>Campaign results</b> (Campaigns tab): every report recalibrates the district estimate and measures how the cough AI and X-ray AI perform against GeneXpert.</li>
            <li><b>Cities</b>: {cities.data.map((c) => c.name).join(', ') || 'none'}. Edit below.</li>
          </ul>
        </Card>
      </div>

      <Card pad={false}>
        <div className="p-6 pb-2">
          <CardHeader title="Evidence and model parameters" subtitle='Every number the model uses. "Evidence" means the value was checked against the cited source; "Assumption" means it needs local data or verification. Edits apply at the next weekly run.' />
        </div>
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className="border-t border-gray-100">
            <div className="px-6 pt-4 pb-1 text-[13px] font-medium tracking-wider uppercase text-gray-500">{g}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <tbody>
                  {list.map((p) => <ParamRow key={p.id} p={p} />)}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <CardHeader title="Response playbooks" subtitle="What a campaign turns into: ordered tasks for named roles. Edit steps to match how the district actually works." />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {playbooks.data.map((p) => (
            <div key={p.id} className="rounded-xl border border-gray-200 p-4 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900">{p.name}</div>
                  <div className="text-xs text-gray-500">{p.trigger}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={p.enabled} onChange={(e) => tbSave('tb_playbooks', { ...p, enabled: e.target.checked })} />On</label>
                  <Button onClick={() => setEditing(p)}>Edit</Button>
                </div>
              </div>
              {p.description && <p className="text-sm text-gray-600 mt-2">{p.description}</p>}
              <ol className="list-decimal pl-5 mt-2 text-sm text-gray-700 space-y-0.5">{p.steps.map((s) => <li key={s.key}>{s.title} <span className="text-gray-400">· {s.role} · day {s.due_days}</span></li>)}</ol>
              {p.source_url && <div className="mt-2 text-xs"><ExtLink href={p.source_url}>{p.source_title || 'Source'}</ExtLink></div>}
            </div>
          ))}
        </div>
      </Card>

      <CitiesCard data={data} />
      {uploading && <UploadNotifications data={data} onClose={() => setUploading(false)} />}
      {editing && <PlaybookEditor p={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function ParamRow({ p }: { p: TbParam }) {
  const me = useMe();
  const [v, setV] = useState(String(p.value));
  const save = () => {
    const n = Number(v);
    if (!isFinite(n) || n === Number(p.value)) return setV(String(p.value));
    tbSave('tb_parameters', { ...p, value: n, updated_at: new Date().toISOString(), updated_by: me.email });
  };
  return (
    <tr className="border-t border-gray-50 align-top">
      <td className="px-6 py-3 min-w-[280px]">
        <div className="text-gray-900">{p.label}</div>
        {p.description && <div className="text-xs text-gray-500 mt-0.5">{p.description}</div>}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <TextInput className="w-24 h-9 text-sm text-right" value={v} onChange={(e) => setV(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <span className="text-sm text-gray-500 ml-2">{p.unit}</span>
      </td>
      <td className="px-3 py-3"><Badge className={p.status === 'evidence' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-800'}>{p.status === 'evidence' ? 'Evidence' : 'Assumption'}</Badge></td>
      <td className="px-3 pr-6 py-3 text-sm min-w-[220px]">{p.source_url ? <ExtLink href={p.source_url}>{p.source_title || 'Source'}</ExtLink> : <span className="text-gray-400">{p.source_title || 'No source yet'}</span>}</td>
    </tr>
  );
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
        <p className="text-[15px]">Saved {done} rows. The detection gap updates at the next weekly model run.</p>
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

function PlaybookEditor({ p, onClose }: { p: TbPlaybook; onClose: () => void }) {
  const [steps, setSteps] = useState<TbStep[]>(p.steps.map((s) => ({ ...s })));
  const [name, setName] = useState(p.name);
  const upd = (i: number, patch: Partial<TbStep>) => setSteps(steps.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const save = async () => {
    await tbSave('tb_playbooks', { ...p, name, steps: steps.filter((s) => s.title.trim()), updated_at: new Date().toISOString() } as any);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Edit playbook" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <Field label="Name"><TextInput className="w-full" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
            <TextInput className="w-full h-9 text-sm" value={s.title} placeholder="Step" onChange={(e) => upd(i, { title: e.target.value })} />
            <div className="flex gap-2">
              <TextInput className="flex-1 min-w-0 h-9 text-sm" value={s.role} placeholder="Role" onChange={(e) => upd(i, { role: e.target.value })} />
              <TextInput className="w-24 h-9 text-sm" type="number" value={s.due_days} onChange={(e) => upd(i, { due_days: Number(e.target.value) })} title="Due (days after start)" />
              <Button onClick={() => setSteps(steps.filter((_, j) => j !== i))} icon="trash">Remove</Button>
            </div>
          </div>
        ))}
      </div>
      <Button icon="plus" onClick={() => setSteps([...steps, { key: `step${Date.now()}`, title: '', role: '', due_days: 7 }])}>Add step</Button>
    </Modal>
  );
}

function CitiesCard({ data }: { data: TbData }) {
  const [n, setN] = useState({ name: '', lat: '', lon: '', radius_km: '15' });
  const add = () => {
    const lat = Number(n.lat), lon = Number(n.lon);
    if (!n.name.trim() || !isFinite(lat) || !isFinite(lon)) return;
    tbSave('tb_cities', { id: n.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n.name.trim(), lat, lon, radius_km: Number(n.radius_km) || 15, h3_res: 8, enabled: true } as any);
    setN({ name: '', lat: '', lon: '', radius_km: '15' });
  };
  return (
    <Card>
      <CardHeader title="Cities" subtitle="Each city gets a fine hexagon map (about 0.7 km² per hexagon) at the next weekly run" />
      <ul className="divide-y divide-gray-100 mb-4">
        {data.cities.data.map((c) => (
          <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-3 text-[15px]">
            <span className="font-medium min-w-[180px]">{c.name}</span>
            <span className="text-sm text-gray-500">{Number(c.lat).toFixed(3)}, {Number(c.lon).toFixed(3)} · {c.radius_km} km radius</span>
            <TextInput className="w-56 h-9 text-sm" placeholder="City partner (e.g. Accra Metropolitan Assembly)" defaultValue={c.city_partner || ''} onBlur={(e) => e.target.value !== (c.city_partner || '') && tbSave('tb_cities', { ...c, city_partner: e.target.value || null } as any)} />
            <label className="text-sm inline-flex items-center gap-1.5"><input type="checkbox" checked={c.enabled !== false} onChange={(e) => tbSave('tb_cities', { ...c, enabled: e.target.checked } as any)} />On</label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <TextInput className="w-48" placeholder="City name" value={n.name} onChange={(e) => setN({ ...n, name: e.target.value })} />
        <TextInput className="w-28" placeholder="Latitude" value={n.lat} onChange={(e) => setN({ ...n, lat: e.target.value })} />
        <TextInput className="w-28" placeholder="Longitude" value={n.lon} onChange={(e) => setN({ ...n, lon: e.target.value })} />
        <TextInput className="w-28" placeholder="Radius km" value={n.radius_km} onChange={(e) => setN({ ...n, radius_km: e.target.value })} />
        <Button icon="plus" onClick={add}>Add city</Button>
      </div>
    </Card>
  );
}
