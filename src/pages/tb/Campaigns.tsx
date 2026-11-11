import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, Drawer, Empty, Field, Modal, Select, TextArea, TextInput, cx } from '../../components/ui';
import { useMe } from '../../components/Layout';
import { uid } from '../../lib/store';
import { peopleOptions, personName, usePeople } from '../../lib/team';
import { cascadeTotals, createCampaign, expectedPositivity, fmtInt, pct, SETTINGS, tbRemove, tbSave, TbCampaign, TbResult, TbTask } from '../../lib/tb';
import type { TbData } from './TbPage';

const STATUS_CLS: Record<string, string> = { planned: 'bg-gray-100 text-gray-700', active: 'bg-brand-50 text-brand-700', done: 'bg-green-50 text-green-700', cancelled: 'bg-red-50 text-red-700' };
const nns = (p: number | null) => (p && p > 0 ? Math.round(1 / p) : null);
const natRateOf = (data: TbData) => { const n = data.dist.data.meta?.national; return n ? (n.incidence / n.pop) * 1e5 : null; };

export default function Campaigns({ data, onPlan }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void }) {
  const { campaigns, results, tasks, dist, P } = data;
  const [open, setOpen] = useState<string | null>(null);
  const byCampaign = useMemo(() => {
    const m: Record<string, TbResult[]> = {};
    for (const r of results.data) (m[r.campaign_id] ||= []).push(r);
    return m;
  }, [results.data]);
  const list = [...campaigns.data].sort((a, b) => (b.start_date || b.created_at || '').localeCompare(a.start_date || a.created_at || ''));
  const all = cascadeTotals(results.data);
  // predicted confirmed cases across reported campaigns
  const predicted = campaigns.data.reduce((s, c) => {
    const t = cascadeTotals(byCampaign[c.id] || []);
    const d = dist.data.list.find((x) => x.id === c.district_id);
    return s + t.screened * (expectedPositivity(c.setting, d, P, natRateOf(data)) ?? 0);
  }, 0);
  const noCampaign = dist.data.list.filter((d) => !campaigns.data.some((c) => c.district_id === d.id)).sort((a, b) => a.rank - b.rank).slice(0, 6);
  const current = campaigns.data.find((c) => c.id === open) || null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card className="xl:col-span-2 min-w-0">
          <CardHeader title="What campaigns are teaching us" subtitle="What screening actually found, against the published yield for each setting" right={<Button variant="primary" icon="plus" onClick={() => onPlan({ setting: 'community', playbook_id: 'acf_community' })}>New campaign</Button>} />
          {all.screened ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Mini label="People screened" value={fmtInt(all.screened)} />
              <Mini label="Confirmed TB" value={fmtInt(all.confirmed)} sub={`expected ≈ ${predicted.toFixed(0)}`} />
              <Mini label="Screened per case found" value={all.confirmed ? fmtInt(all.screened / all.confirmed) : '—'} sub={predicted ? `expected ${fmtInt(all.screened / predicted)}` : ''} />
              <Mini label="Started treatment" value={pct(all.started_treatment, all.confirmed)} sub={`${fmtInt(all.started_treatment)} of ${fmtInt(all.confirmed)}`} />
              <Mini label="Cough AI: confirmed among flagged" value={pct(all.cough_flagged_confirmed, all.cough_flagged)} sub="positive predictive value" />
              <Mini label="X-ray AI: confirmed among flagged" value={pct(all.cxr_flagged_confirmed, all.cxr_flagged)} sub="positive predictive value" />
              <Mini label="Cases the cough AI flagged" value={pct(all.cough_flagged_confirmed, all.confirmed)} sub="share of confirmed (sensitivity, approx.)" />
              <Mini label="Cases the X-ray AI flagged" value={pct(all.cxr_flagged_confirmed, all.confirmed)} sub="share of confirmed (sensitivity, approx.)" />
            </div>
          ) : (
            <p className="text-[15px] text-gray-600">No results reported yet. When teams enter campaign results, this shows how many people it took to find one case against the published yield, and how well the cough AI (HeAR) and X-ray AI flags matched GeneXpert results.</p>
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Top-ranked districts with no screening yet" subtitle="From the Where to act ranking" />
          <ul className="space-y-2">
            {noCampaign.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0"><span className="block truncate text-[15px]">{d.name}</span><span className="text-xs text-gray-500">rank {d.rank} · ≈{fmtInt(d.missed)} missed a year</span></span>
                <Button className="shrink-0" onClick={() => onPlan({ district_id: d.id, district_name: d.name, setting: 'community', playbook_id: 'acf_community', name: `${d.name}: community case-finding` })}>Plan</Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card pad={false}>
        <div className="p-6 pb-2"><CardHeader title="Campaigns" subtitle="Click one to see its cascade, tasks and results" /></div>
        {!list.length ? (
          <div className="p-6 pt-0"><Empty icon="target" title="No campaigns yet">Start from a hotspot on the map, a city area, or "New campaign".</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                  <th className="px-6 py-2.5 font-medium">Campaign</th><th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Dates</th>
                  <th className="px-3 py-2.5 font-medium text-right">Screened</th><th className="px-3 py-2.5 font-medium text-right">Confirmed</th><th className="px-3 py-2.5 font-medium text-right">Per case</th><th className="px-3 py-2.5 font-medium">Tasks</th>
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const t = cascadeTotals(byCampaign[c.id] || []);
                  const ct = tasks.data.filter((x) => x.campaign_id === c.id);
                  return (
                    <tr key={c.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(c.id)}>
                      <td className="px-6 py-3 min-w-[260px]"><div className="font-medium text-gray-900">{c.name}</div><div className="text-sm text-gray-500">{[c.district_name, SETTINGS.find((s) => s.value === c.setting)?.label].filter(Boolean).join(' · ')}</div></td>
                      <td className="px-3 py-3"><Badge className={STATUS_CLS[c.status]}>{c.status}</Badge></td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">{c.start_date || '—'}{c.end_date ? ` → ${c.end_date}` : ''}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtInt(t.screened)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{fmtInt(t.confirmed)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{t.confirmed ? fmtInt(t.screened / t.confirmed) : '—'}</td>
                      <td className="px-3 py-3 text-sm whitespace-nowrap">{ct.filter((x) => x.status === 'done').length}/{ct.length} done</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Drawer open={!!current} onClose={() => setOpen(null)} title={current?.name} subtitle={current ? [current.district_name, SETTINGS.find((s) => s.value === current.setting)?.label].filter(Boolean).join(' · ') : ''}>
        {current && <CampaignDetail c={current} data={data} rows={byCampaign[current.id] || []} tasks={tasks.data.filter((x) => x.campaign_id === current.id)} onDeleted={() => setOpen(null)} />}
      </Drawer>
    </div>
  );
}

function Mini({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 p-4 min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums mt-1">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const CASCADE: { key: string; label: string }[] = [
  { key: 'screened', label: 'Screened' }, { key: 'presumptive', label: 'Flagged (AI or symptoms)' }, { key: 'tested', label: 'Tested (GeneXpert)' },
  { key: 'confirmed', label: 'Confirmed TB' }, { key: 'started_treatment', label: 'Started treatment' },
];

function CampaignDetail({ c, data, rows, tasks, onDeleted }: { c: TbCampaign; data: TbData; rows: TbResult[]; tasks: TbTask[]; onDeleted: () => void }) {
  const me = useMe();
  const people = usePeople();
  const [adding, setAdding] = useState(false);
  const t = cascadeTotals(rows);
  const d = data.dist.data.list.find((x) => x.id === c.district_id);
  const exp = expectedPositivity(c.setting, d, data.P, natRateOf(data));
  const obs = t.screened ? t.confirmed / t.screened : 0;
  const max = Math.max(t.screened, 1);
  const today = new Date().toISOString().slice(0, 10);
  const save = (patch: Partial<TbCampaign>) => tbSave('tb_campaigns', { ...c, ...patch });

  return (
    <>
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Status"><Select value={c.status} onChange={(v) => save({ status: v as any })} options={['planned', 'active', 'done', 'cancelled'].map((s) => ({ value: s, label: s }))} /></Field>
          <Field label="Start"><TextInput type="date" value={c.start_date || ''} onChange={(e) => save({ start_date: e.target.value || null })} /></Field>
          <Field label="End"><TextInput type="date" value={c.end_date || ''} onChange={(e) => save({ end_date: e.target.value || null })} /></Field>
          <Field label="Lead"><Select value={c.owner || ''} onChange={(v) => save({ owner: v || null })} placeholder="Unassigned" options={peopleOptions(people, c.owner)} /></Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Cascade" subtitle={`Expected about 1 case per ${nns(exp) ?? '—'} screened${t.screened ? `; observed ${t.confirmed ? `1 per ${Math.round(t.screened / t.confirmed)}` : 'none yet'}` : ''}`} right={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add results</Button>} />
        <div className="space-y-2.5">
          {CASCADE.map((s, i) => {
            const v = t[s.key] || 0;
            const prev = i ? t[CASCADE[i - 1].key] || 0 : 0;
            return (
              <div key={s.key}>
                <div className="flex justify-between text-sm"><span>{s.label}</span><span className="tabular-nums">{fmtInt(v)}{i > 0 && prev ? <span className="text-gray-400"> · {pct(v, prev)}</span> : null}</span></div>
                <div className="h-2.5 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.max((v / max) * 100, v ? 1.5 : 0)}%` }} /></div>
              </div>
            );
          })}
        </div>
        {t.screened > 0 && (
          <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
            <Mini label="Cough AI flags confirmed" value={pct(t.cough_flagged_confirmed, t.cough_flagged)} sub={`${fmtInt(t.cough_flagged)} flagged`} />
            <Mini label="X-ray AI flags confirmed" value={pct(t.cxr_flagged_confirmed, t.cxr_flagged)} sub={`${fmtInt(t.cxr_flagged)} flagged`} />
            <Mini label="Contacts screened" value={fmtInt(t.contacts_screened)} sub={`of ${fmtInt(t.contacts_identified)} identified`} />
            <Mini label="Preventive treatment started" value={fmtInt(t.tpt_started)} />
          </div>
        )}
        {t.screened > 0 && exp != null && <p className="text-xs text-gray-500 mt-3">Yield {obs > exp * 1.3 ? 'is well above' : obs < exp * 0.7 ? 'is well below' : 'is close to'} the published yield for this setting ({pct(obs, 1)} vs {pct(exp, 1)}).</p>}
      </Card>

      <Card>
        <CardHeader title="Tasks" subtitle="Generated from the playbook; assigned by role" />
        {!tasks.length && <p className="text-sm text-gray-500">No tasks.</p>}
        <ul className="divide-y divide-gray-100">
          {[...tasks].sort((a, b) => (a.due || '').localeCompare(b.due || '')).map((x) => (
            <li key={x.id} className="py-2.5 flex flex-wrap items-center gap-3">
              <input type="checkbox" checked={x.status === 'done'} onChange={(e) => tbSave('tb_tasks', { ...x, status: e.target.checked ? 'done' : 'todo', updated_at: new Date().toISOString() })} aria-label="Done" />
              <div className="min-w-0 flex-1">
                <div className={cx('text-[15px]', x.status === 'done' && 'line-through text-gray-400')}>{x.title}</div>
                <div className={cx('text-xs', x.status !== 'done' && x.due && x.due < today ? 'text-red-600' : 'text-gray-500')}>{x.role}{x.assignee ? ` · ${personName(x.assignee)}` : ' · unassigned'}{x.due ? ` · due ${x.due}` : ''}</div>
              </div>
              <Select className="w-[180px] [&_select]:h-9 [&_select]:text-sm" value={x.assignee || ''} onChange={(v) => tbSave('tb_tasks', { ...x, assignee: v || null })} placeholder="Assign" options={peopleOptions(people, x.assignee)} />
            </li>
          ))}
        </ul>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader title="Reports" />
          <ul className="text-sm divide-y divide-gray-100">
            {rows.map((r) => (
              <li key={r.id} className="py-2 flex justify-between gap-3">
                <span>{r.report_date} · {fmtInt(r.screened)} screened · {fmtInt(r.confirmed)} confirmed{r.reported_by ? ` · ${personName(r.reported_by)}` : ''}</span>
                <button type="button" className="text-gray-400 hover:text-red-600" onClick={() => window.confirm('Delete this report?') && tbRemove('tb_campaign_results', r.id)}>Delete</button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex justify-end">
        <Button variant="ghost" icon="trash" onClick={async () => { if (window.confirm('Delete this campaign, its tasks and results?')) { await tbRemove('tb_campaigns', c.id); onDeleted(); } }}>Delete campaign</Button>
      </div>
      {adding && <ResultsForm c={c} me={me.email} onClose={() => setAdding(false)} />}
    </>
  );
}

const FIELDS: { key: keyof TbResult; label: string; hint?: string }[] = [
  { key: 'screened', label: 'People screened' }, { key: 'cough_flagged', label: 'Flagged by cough AI (HeAR)' }, { key: 'cxr_flagged', label: 'Flagged by X-ray AI' },
  { key: 'presumptive', label: 'Presumptive TB (any flag or symptoms)' }, { key: 'tested', label: 'Tested with GeneXpert' }, { key: 'confirmed', label: 'Confirmed TB' },
  { key: 'rr_confirmed', label: 'Rifampicin-resistant' }, { key: 'cough_flagged_confirmed', label: 'Confirmed among cough-AI flagged' }, { key: 'cxr_flagged_confirmed', label: 'Confirmed among X-ray-AI flagged' },
  { key: 'started_treatment', label: 'Started treatment' }, { key: 'contacts_identified', label: 'Household contacts identified' }, { key: 'contacts_screened', label: 'Contacts screened' }, { key: 'tpt_started', label: 'Preventive treatment started' },
];

function ResultsForm({ c, me, onClose }: { c: TbCampaign; me: string; onClose: () => void }) {
  const [v, setV] = useState<Record<string, any>>({ report_date: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState('');
  const save = async () => {
    const n = (k: string) => Number(v[k] || 0);
    if (n('confirmed') > n('screened') || n('tested') > n('screened')) return setErr('Confirmed and tested cannot exceed people screened.');
    if (n('cough_flagged_confirmed') > n('cough_flagged') || n('cxr_flagged_confirmed') > n('cxr_flagged')) return setErr('Confirmed among flagged cannot exceed the number flagged.');
    const row: any = { id: uid('tbr'), campaign_id: c.id, report_date: v.report_date, notes: v.notes || null, reported_by: me };
    for (const f of FIELDS) row[f.key] = n(f.key as string);
    await tbSave('tb_campaign_results', row);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add campaign results" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <p className="text-sm text-gray-500">Enter the numbers for this reporting day or week. Leave unknown fields empty.</p>
      <Field label="Report date"><TextInput type="date" className="w-full" value={v.report_date} onChange={(e) => setV({ ...v, report_date: e.target.value })} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {FIELDS.map((f) => (
          <Field key={f.key as string} label={f.label}><TextInput type="number" min={0} className="w-full" value={v[f.key as string] ?? ''} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} /></Field>
        ))}
      </div>
      <Field label="Notes"><TextArea rows={2} value={v.notes || ''} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

export function CampaignForm({ data, initial, me, onClose, onSaved }: { data: TbData; initial: Partial<TbCampaign>; me: string; onClose: () => void; onSaved: () => void }) {
  const people = usePeople();
  const [c, setC] = useState<Partial<TbCampaign>>({ status: 'planned', start_date: new Date().toISOString().slice(0, 10), owner: me, ...initial });
  const [busy, setBusy] = useState(false);
  const d = data.dist.data.list.find((x) => x.id === c.district_id);
  const pb = data.playbooks.data.find((p) => p.id === c.playbook_id);
  const exp = expectedPositivity(c.setting, d, data.P, natRateOf(data));
  const districts = [...data.dist.data.list].sort((a, b) => a.name.localeCompare(b.name));
  const save = async () => {
    if (!c.name?.trim()) return;
    setBusy(true);
    try {
      await createCampaign({ ...(c as TbCampaign), id: uid('tbc'), name: c.name.trim(), predicted_positivity: exp }, pb, people, me);
      onSaved();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Plan a case-finding campaign" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={busy || !c.name?.trim()}>{busy ? 'Creating…' : `Create${pb ? ` with ${pb.steps.length} tasks` : ''}`}</Button></>}>
      <Field label="Name"><TextInput className="w-full" value={c.name || ''} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Ashaiman markets screening" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="District"><Select value={c.district_id || ''} onChange={(v) => setC({ ...c, district_id: v || null, district_name: districts.find((x) => x.id === v)?.name || null })} placeholder="Choose" options={districts.map((x) => ({ value: x.id, label: `${x.name} (${x.region})` }))} /></Field>
        <Field label="Setting"><Select value={c.setting || ''} onChange={(v) => setC({ ...c, setting: v, playbook_id: c.playbook_id || (v === 'prison' || v === 'mine' || v === 'market' ? 'acf_congregate' : v === 'outreach' ? 'blind_spot' : 'acf_community') })} options={SETTINGS} /></Field>
        <Field label="Playbook" hint={pb?.trigger || undefined}><Select value={c.playbook_id || ''} onChange={(v) => setC({ ...c, playbook_id: v || null })} placeholder="No playbook (no tasks)" options={data.playbooks.data.filter((p) => p.enabled).map((p) => ({ value: p.id, label: p.name }))} /></Field>
        <Field label="Lead"><Select value={c.owner || ''} onChange={(v) => setC({ ...c, owner: v || null })} placeholder="Unassigned" options={peopleOptions(people, c.owner)} /></Field>
        <Field label="Start date"><TextInput type="date" className="w-full" value={c.start_date || ''} onChange={(e) => setC({ ...c, start_date: e.target.value })} /></Field>
        <Field label="People to screen (target)"><TextInput type="number" min={0} className="w-full" value={c.target_screened ?? ''} onChange={(e) => setC({ ...c, target_screened: e.target.value ? Number(e.target.value) : null })} /></Field>
      </div>
      <div className="rounded-xl bg-orange-50 text-orange-900 text-sm p-3">
        Expected yield: about <b>1 confirmed case per {nns(exp) ?? '—'}</b> people screened ({SETTINGS.find((s) => s.value === c.setting)?.label || 'setting'}).
        {c.target_screened && exp != null ? <> At {fmtInt(c.target_screened)} screened, expect about <b>{(c.target_screened * exp).toFixed(0)}</b> cases.</> : null}
      </div>
      {pb && (
        <div className="text-sm">
          <div className="font-medium mb-1">Tasks that will be created</div>
          <ol className="list-decimal pl-5 space-y-0.5 text-gray-700">{pb.steps.map((s) => <li key={s.key}>{s.title} <span className="text-gray-400">· {s.role} · day {s.due_days}</span></li>)}</ol>
          <p className="text-xs text-gray-500 mt-1">Each task goes to the person with that role on the People page (same district first).</p>
        </div>
      )}
      <Field label="Notes"><TextArea rows={2} value={c.notes || ''} onChange={(e) => setC({ ...c, notes: e.target.value })} /></Field>
    </Modal>
  );
}
