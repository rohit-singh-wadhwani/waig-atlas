import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Badge, Button, Card, CardHeader, Drawer, Empty, ExtLink, Field, Modal, Segmented, Select, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { linkLabel } from '../../components/Checkpoints';
import { fmtTime } from '../../lib/format';
import { uid, uploadFile } from '../../lib/store';
import { peopleOptions, personName, usePeople } from '../../lib/team';
import { cascadeTotals, createCampaign, expectedPositivity, fmtInt, SETTINGS, tbRemove, tbSave, TbCampaign, TbFile, TbResult, TbTask, TbTaskUpdate } from '../../lib/tb';
import { Funnel } from './common';
import { roleOptions } from './Roles';
import type { TbData } from './TbPage';

const STATUS_CLS: Record<string, string> = { planned: 'bg-gray-100 text-gray-700', active: 'bg-brand-50 text-brand-700', done: 'bg-green-50 text-green-700', cancelled: 'bg-red-50 text-red-700' };
const nns = (p: number | null) => (p && p > 0 ? Math.round(1 / p) : null);
const natRateOf = (data: TbData) => { const n = data.dist.data.meta?.national; return n ? (n.incidence / n.pop) * 1e5 : null; };

type Filter = 'open' | 'overdue' | 'week' | 'doing' | 'blocked' | 'done';
const TASK_STATUS = [{ value: 'todo', label: 'To do' }, { value: 'doing', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }];
// playbook steps where screening numbers are produced, so the task offers "Enter results"
const RESULT_STEPS = ['screen', 'sputum', 'test', 'treat', 'contacts', 'outreach', 'report', 'track', 'opd'];
const day = (d: Date) => d.toISOString().slice(0, 10);
// the guideline documents playbook steps cite (see tb_playbooks.sources)
const GUIDES: { prefix: string; title: string; url: string }[] = [
  { prefix: 'WHO', title: 'WHO operational handbook on TB, Module 2', url: 'https://www.who.int/publications-detail-redirect/9789240022614' },
  { prefix: 'DAK', title: 'Ghana TB Digital Adaptation Kit', url: 'https://media.path.org/documents/Ghana_Digital_Adaptation_Kit_for_TB_2025.pdf' },
];
/** Role options from the staffing norms, plus any role name already in use that is not one of them. */
const withOthers = (opts: { value: string; label: string }[], names: string[]) => [...opts, ...names.filter((n) => n && !opts.some((o) => o.value === n)).map((n) => ({ value: n, label: n }))];
const mapsLink = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

/** What each playbook step produced in the daily reports, so a task shows the numbers its work led to. */
const STEP_DATA: Record<string, (keyof TbResult)[]> = {
  screen: ['screened', 'presumptive'], outreach: ['screened', 'presumptive'], opd: ['screened', 'presumptive'],
  sputum: ['presumptive', 'tested'], test: ['tested', 'confirmed', 'rr_confirmed'], treat: ['confirmed', 'started_treatment'],
  contacts: ['contacts_identified', 'contacts_screened', 'tpt_started'], track: ['presumptive', 'confirmed'],
};
const RESULT_LABEL: Partial<Record<keyof TbResult, string>> = {
  screened: 'Screened', presumptive: 'Symptomatic', tested: 'Tested', confirmed: 'TB found', rr_confirmed: 'Drug-resistant', started_treatment: 'Treated',
  contacts_identified: 'Contacts found', contacts_screened: 'Contacts screened', tpt_started: 'Preventive treatment',
};
const fmtDay = (iso?: string | null) => (iso ? new Date(iso.length > 10 ? iso : `${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const oneIn = (found: number, screened: number) => (found > 0 ? `1 in ${fmtInt(screened / found)}` : '—');

/** Campaigns & tasks: the overall cascade, then each campaign with its own cascade, daily reports and step-by-step task flow. */
export default function Campaigns({ data, onPlan, openId }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void; openId?: string | null }) {
  const me = useMe();
  const people = usePeople();
  const { campaigns, results, tasks, dist } = data;
  const [filter, setFilter] = useState<Filter>('open');
  const [mine, setMine] = useState(false);
  const [role, setRole] = useState('');
  const [settings, setSettings] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(openId ? [openId] : []);
  // arriving from a map flag: that campaign is opened and brought into view
  useEffect(() => { if (openId) document.getElementById(`campaign-${openId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [openId]);
  const today = day(new Date());
  const weekEnd = day(new Date(Date.now() + 7 * 864e5));
  const roles = useMemo(() => Array.from(new Set(tasks.data.map((t) => t.role || '').filter(Boolean))).sort(), [tasks.data]);
  const match = (t: TbTask, f: Filter) =>
    f === 'done' ? t.status === 'done'
    : t.status !== 'done' && (f === 'open' || (f === 'overdue' && !!t.due && t.due < today) || (f === 'week' && !!t.due && t.due >= today && t.due <= weekEnd) || (f === 'doing' && t.status === 'doing') || (f === 'blocked' && t.status === 'blocked'));
  const scoped = tasks.data.filter((t) => (!mine || t.assignee === me.email) && (!role || t.role === role));
  const count = (f: Filter) => scoped.filter((t) => match(t, f)).length;
  const hit = (t: TbTask) => scoped.includes(t) && match(t, filter);
  const camps = [...campaigns.data].sort((x, y) => (y.start_date || y.created_at || '').localeCompare(x.start_date || x.created_at || ''));
  // "Open" lists every campaign; any other view narrows the list to campaigns with tasks in it
  const shown = camps.filter((c) => filter === 'open' || tasks.data.some((t) => t.campaign_id === c.id && hit(t)));
  const loose = tasks.data.filter((t) => (!t.campaign_id || !campaigns.data.some((c) => c.id === t.campaign_id)) && hit(t));
  const all = cascadeTotals(results.data);
  const last = results.data.reduce((m, r) => (r.report_date > m ? r.report_date : m), '');
  const active = campaigns.data.filter((c) => c.status === 'active').length;
  const curTask = tasks.data.find((t) => t.id === openTask) || null;
  const curCampaign = campaigns.data.find((c) => c.id === settings) || null;
  const FILTERS: { value: Filter; label: string; tone?: string }[] = [
    { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue', tone: 'text-red-700' }, { value: 'week', label: 'Due this week' },
    { value: 'doing', label: 'In progress' }, { value: 'blocked', label: 'Blocked', tone: 'text-red-700' }, { value: 'done', label: 'Done' },
  ];
  const toggle = (id: string) => setExpanded((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="All campaigns" subtitle={`${campaigns.data.length} campaign${campaigns.data.length === 1 ? '' : 's'}, ${active} active · ${results.data.length} daily report${results.data.length === 1 ? '' : 's'}${last ? `, latest ${fmtDay(last)}` : ''}`}
          right={<><Button icon="plus" onClick={() => setAdding(true)}>Task</Button><Button variant="primary" icon="plus" onClick={() => onPlan({ setting: 'community', playbook_id: 'acf_community' })}>Campaign</Button></>} />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-6 items-start">
          {all.screened ? <Funnel t={all} /> : <p className="text-sm text-gray-500">No daily reports yet. Results entered on a campaign's screening tasks build this cascade.</p>}
          <div className="grid grid-cols-3 gap-2">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" onClick={() => setFilter(f.value)}
                className={cx('rounded-xl border px-3 py-2 text-left transition-colors', filter === f.value ? 'border-gray-900 bg-white shadow-sm' : 'border-gray-200 bg-gray-50/60 hover:bg-white')}>
                <div className={cx('text-xl font-semibold tabular-nums', count(f.value) && f.tone ? f.tone : 'text-gray-900')}>{count(f.value)}</div>
                <div className="text-xs text-gray-500 whitespace-nowrap">{f.label} tasks</div>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<'all' | 'mine'> size="sm" value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Mine' }]} />
        <Select className="w-[230px] [&_select]:h-9 [&_select]:text-sm" value={role} onChange={setRole} placeholder="All roles" options={roles.map((r) => ({ value: r, label: r }))} />
        <span className="text-sm text-gray-500 ml-auto">{shown.length} campaign{shown.length === 1 ? '' : 's'} · open one for its cascade and task flow</span>
      </div>

      {!shown.length && !loose.length ? (
        <Empty icon="checkCircle" title={camps.length ? 'Nothing in this view' : data.scope ? 'Nothing assigned here yet' : 'No campaigns yet'}>{camps.length ? 'Try another filter above.' : data.scope ? `Campaigns planned for ${data.scope.place} show here, with the tasks this role carries.` : 'Plan one from a town on Find and act; its tasks are created from the playbook.'}</Empty>
      ) : (
        <div className="space-y-3">
          {shown.map((c) => (
            <CampaignCard key={c.id} c={c} data={data} open={expanded.includes(c.id)} onToggle={() => toggle(c.id)} hit={hit} dim={filter !== 'open' || mine || !!role}
              onTask={setOpenTask} onSettings={() => setSettings(c.id)} />
          ))}
          {loose.length > 0 && (
            <Card>
              <CardHeader title="Tasks outside a campaign" />
              <TaskFlow tasks={loose} order={[]} onTask={setOpenTask} hit={hit} dim={false} today={today} />
            </Card>
          )}
        </div>
      )}

      <Drawer open={!!curCampaign} onClose={() => setSettings(null)} title={curCampaign?.name} subtitle={curCampaign ? [curCampaign.town, curCampaign.district_name, SETTINGS.find((x) => x.value === curCampaign.setting)?.label].filter(Boolean).join(' · ') : ''}>
        {curCampaign && <CampaignSettings c={curCampaign} rows={results.data.filter((r) => r.campaign_id === curCampaign.id)} onDeleted={() => setSettings(null)} />}
      </Drawer>
      <Drawer open={!!curTask} onClose={() => setOpenTask(null)} title={curTask?.title} subtitle={curTask ? [campaigns.data.find((c) => c.id === curTask.campaign_id)?.name, curTask.spot, curTask.role].filter(Boolean).join(' · ') : ''}>
        {curTask && <TaskWorkspace t={curTask} c={campaigns.data.find((x) => x.id === curTask.campaign_id) || null} data={data} />}
      </Drawer>
      {adding && <AddTask roles={withOthers(roleOptions(data.roles.data), roles)} campaigns={campaigns.data.map((c) => ({ value: c.id, label: c.name }))} districts={dist.data.list.map((d) => ({ value: d.id, label: d.name }))} me={me.email} people={peopleOptions(people)} onClose={() => setAdding(false)} />}
    </div>
  );
}

/** One campaign: a summary line; opened, its cascade, daily reports and the flow of its tasks. */
function CampaignCard({ c, data, open, onToggle, hit, dim, onTask, onSettings }: { c: TbCampaign; data: TbData; open: boolean; onToggle: () => void; hit: (t: TbTask) => boolean; dim: boolean; onTask: (id: string) => void; onSettings: () => void }) {
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const rows = data.results.data.filter((r) => r.campaign_id === c.id).sort((a, b) => a.report_date.localeCompare(b.report_date));
  const tasks = data.tasks.data.filter((t) => t.campaign_id === c.id);
  const t = cascadeTotals(rows);
  const done = tasks.filter((x) => x.status === 'done').length;
  const today = day(new Date());
  const late = tasks.filter((x) => x.status !== 'done' && x.due && x.due < today).length;
  const order = data.playbooks.data.find((p) => p.id === c.playbook_id)?.steps.map((s) => s.key) || [];
  const d = data.dist.data.list.find((x) => x.id === c.district_id);
  const exp = expectedPositivity(c.setting, d, data.P, natRateOf(data));
  const max = Math.max(1, ...rows.map((r) => r.screened || 0));
  return (
    <section id={`campaign-${c.id}`} className="rounded-2xl border border-gray-200 bg-white scroll-mt-4">
      <button type="button" onClick={onToggle} aria-expanded={open} className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-gray-50/70 rounded-2xl">
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={18} className="text-gray-400 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-gray-900">{c.name}</span><Badge className={STATUS_CLS[c.status]}>{c.status}</Badge>{late > 0 && <Badge className="bg-red-50 text-red-700">{late} overdue</Badge>}</span>
          <span className="block text-xs text-gray-500 truncate mt-0.5">{[c.town, c.district_name].filter(Boolean).join(', ')}{c.start_date ? ` · since ${fmtDay(c.start_date)}` : ''}{c.owner ? ` · lead ${personName(c.owner)}` : ''}</span>
        </span>
        <span className="hidden md:flex items-center gap-5 text-sm tabular-nums shrink-0">
          <span className="text-right"><span className="block font-semibold">{fmtInt(t.screened)}</span><span className="block text-[11px] text-gray-500">screened</span></span>
          <span className="text-right"><span className="block font-semibold text-red-700">{fmtInt(t.confirmed)}</span><span className="block text-[11px] text-gray-500">TB found</span></span>
          <span className="w-28"><span className="block h-1.5 rounded-full bg-gray-200 overflow-hidden"><span className="block h-full bg-green-500" style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} /></span><span className="block text-[11px] text-gray-500 mt-1">{done} of {tasks.length} steps done</span></span>
        </span>
      </button>
      {open && (
        <div className="border-t border-gray-100 px-5 py-5 space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-6">
            <div>
              <div className="text-sm font-medium text-gray-900 mb-2">Cascade</div>
              {t.screened ? <Funnel t={t} /> : <p className="text-sm text-gray-500">No daily reports yet.</p>}
              {t.screened > 0 && exp != null && <p className="text-xs text-gray-500 mt-2">{oneIn(t.confirmed, t.screened)} screened had TB; the published yield for this setting is about 1 in {fmtInt(1 / exp)}.</p>}
            </div>
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2"><span className="text-sm font-medium text-gray-900">Daily reports</span><span className="text-xs text-gray-500">{rows.length} report{rows.length === 1 ? '' : 's'}{rows.length ? `, ${fmtDay(rows[0].report_date)} to ${fmtDay(rows[rows.length - 1].report_date)}` : ''}</span></div>
              {rows.length ? (
                <div className="flex items-end gap-1 h-24">
                  {rows.map((r) => (
                    <div key={r.id} className="flex-1 min-w-[6px] h-full flex flex-col justify-end" title={`${fmtDay(r.report_date)}: ${fmtInt(r.screened)} screened, ${fmtInt(r.confirmed)} TB found`}>
                      <span className="w-full rounded-t bg-gray-300" style={{ height: `${Math.max(3, (r.screened / max) * 80)}px` }} />
                      <span className="w-full bg-red-700" style={{ height: `${r.screened ? Math.max(r.confirmed ? 2 : 0, (r.confirmed / max) * 80) : 0}px` }} />
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-500">Reports entered on the screening task show here, one bar per day.</p>}
              {rows.length > 0 && <p className="text-[11px] text-gray-500 mt-1.5 flex items-center gap-3"><span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300" />screened</span><span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-700" />TB found</span></p>}
            </div>
          </div>
          <div>
            <div className="text-sm font-medium text-gray-900 mb-2">Task flow</div>
            <TaskFlow tasks={tasks} order={order} onTask={onTask} hit={hit} dim={dim} today={today} />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button icon="settings" onClick={onSettings}>Campaign settings</Button>
            <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add daily report</Button>
          </div>
        </div>
      )}
      {adding && <ResultsForm c={c} task={tasks.find((x) => x.step_key === 'screen')} me={me.email} onClose={() => setAdding(false)} />}
    </section>
  );
}

const NODE_CLS: Record<TbTask['status'], string> = { done: 'border-green-200 bg-green-50', doing: 'border-brand-200 bg-brand-50', blocked: 'border-red-200 bg-red-50', todo: 'border-gray-200 bg-white' };
const NODE_ICON: Record<TbTask['status'], React.ReactNode> = {
  done: <Icon name="checkCircle" size={15} className="text-green-600" />, doing: <span className="w-2.5 h-2.5 rounded-full bg-brand-500 ring-[3px] ring-brand-200" />,
  blocked: <Icon name="alert" size={15} className="text-red-600" />, todo: <span className="w-3 h-3 rounded-full border-2 border-gray-300" />,
};
/** A step is done when all its tasks are; blocked if any is; under way once any has moved. */
const stepStatus = (ts: TbTask[]): TbTask['status'] => (ts.every((t) => t.status === 'done') ? 'done' : ts.some((t) => t.status === 'blocked') ? 'blocked' : ts.some((t) => t.status !== 'todo') ? 'doing' : 'todo');

/** The tasks as a flow of steps in playbook order; a step done at several spots lists them. */
function TaskFlow({ tasks, order, onTask, hit, dim, today }: { tasks: TbTask[]; order: string[]; onTask: (id: string) => void; hit: (t: TbTask) => boolean; dim: boolean; today: string }) {
  const groups = Array.from(tasks.reduce((m, t) => m.set(t.step_key || t.id, [...(m.get(t.step_key || t.id) || []), t]), new Map<string, TbTask[]>()).entries())
    .sort((a, b) => (order.indexOf(a[0]) + 1 || 999) - (order.indexOf(b[0]) + 1 || 999));
  return (
    <ol className="flex flex-wrap items-stretch gap-y-3">
      {groups.map(([key, ts], i) => {
        const status = stepStatus(ts);
        const t0 = ts[0];
        const late = ts.some((t) => t.status !== 'done' && t.due && t.due < today);
        return (
          <li key={key} className="flex flex-1 min-w-[124px] items-stretch">
            <div className={cx('flex-1 min-w-0 rounded-xl border p-3 transition-opacity', NODE_CLS[status], dim && !ts.some(hit) && 'opacity-35')}>
              <button type="button" onClick={() => onTask(t0.id)} className="w-full text-left">
                <span className="flex items-center justify-between text-[11px] text-gray-500"><span>Step {i + 1}</span>{NODE_ICON[status]}</span>
                <span className="block text-sm font-medium text-gray-900 leading-snug mt-1">{t0.title}</span>
                <span className="block text-[11px] text-gray-500 mt-1 truncate" title={t0.role || ''}>{t0.role || 'No role'}</span>
                <span className="flex items-center gap-1.5 mt-2 text-[11px]">
                  {t0.assignee ? <Avatar name={personName(t0.assignee)} size={18} /> : <span className="w-[18px] h-[18px] rounded-full border border-dashed border-gray-300" />}
                  <span className={cx('truncate', late ? 'text-red-600 font-medium' : 'text-gray-600')}>{status === 'done' ? `Done ${fmtDay(t0.updated_at)}` : t0.due ? `${late ? 'Overdue' : 'Due'} ${fmtDay(t0.due)}` : 'No due date'}</span>
                </span>
              </button>
              {ts.length > 1 && (
                <span className="mt-2 flex flex-wrap gap-1">{ts.map((t) => <button key={t.id} type="button" onClick={() => onTask(t.id)} title={t.spot || t.title} className={cx('text-[10px] px-1.5 py-px rounded border bg-white truncate max-w-full', t.status === 'done' ? 'border-green-300 text-green-800' : 'border-gray-300 text-gray-700')}>{t.spot || t.title}</button>)}</span>
              )}
            </div>
            {i < groups.length - 1 && <span className="w-4 shrink-0 grid place-items-center text-gray-300"><Icon name="chevronRight" size={14} /></span>}
          </li>
        );
      })}
    </ol>
  );
}

/** Everything about one task: owner, status, notes, links (incl. Linear), files, updates, results. */
function TaskWorkspace({ t, c, data }: { t: TbTask; c: TbCampaign | null; data: TbData }) {
  const me = useMe();
  const people = usePeople();
  const [note, setNote] = useState(t.detail || '');
  const [url, setUrl] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [results, setResults] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const save = (patch: Partial<TbTask>) => tbSave('tb_tasks', { ...t, ...patch, updated_at: new Date().toISOString() });
  const feed = data.updates.data.filter((u) => u.task_id === t.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const linked = data.results.data.filter((r) => r.task_id === t.id);
  const now = () => new Date().toISOString();
  const addLink = async () => {
    const u = url.trim();
    if (!/^https?:\/\//.test(u)) return setErr('Paste a full link starting with https://');
    setErr('');
    await save({ links: [...(t.links || []), { url: u, label: linkLabel(u), added_by: me.email, at: now() }] });
    setUrl('');
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try {
      const added: TbFile[] = [];
      for (const f of Array.from(files)) added.push({ name: f.name, url: await uploadFile(f, `tb-tasks/${t.id}`), size: f.size, added_by: me.email, at: now() });
      await save({ attachments: [...(t.attachments || []), ...added] });
    } catch (e: any) {
      setErr(e?.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const post = async () => {
    if (!comment.trim()) return;
    await tbSave('tb_task_updates', { id: uid('tbu'), task_id: t.id, campaign_id: t.campaign_id || null, author: me.email, body: comment.trim(), created_at: now() } as TbTaskUpdate);
    setComment('');
  };
  const linearUrl = () => {
    const place = c ? [c.town, c.district_name].filter(Boolean).join(', ') : t.district_name || '';
    const desc = [t.detail, c && `Campaign: ${c.name}${place ? ` (${place})` : ''}`, t.role && `Role: ${t.role}`, t.due && `Due: ${t.due}`, `From WAIG Atlas TB Surveillance`].filter(Boolean).join('\n\n');
    return `https://linear.app/new?title=${encodeURIComponent(t.title)}&description=${encodeURIComponent(desc)}`;
  };
  // the numbers this step led to, from the campaign's daily reports (this spot's, when the task is for one spot)
  const rows = c ? data.results.data.filter((r) => r.campaign_id === c.id && (!t.spot || !r.spot || r.spot === t.spot)) : [];
  const keys = STEP_DATA[t.step_key || ''] || [];
  const stepTotals = cascadeTotals(rows);
  const canReport = !!c && RESULT_STEPS.includes(t.step_key || '');

  return (
    <>
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Status"><Select value={t.status} onChange={(v) => save({ status: v as TbTask['status'] })} options={TASK_STATUS} /></Field>
          <Field label="Owner"><Select value={t.assignee || ''} onChange={(v) => save({ assignee: v || null })} placeholder="Unassigned" options={peopleOptions(people, t.assignee)} /></Field>
          <Field label="Due"><TextInput type="date" className="w-full" value={t.due || ''} onChange={(e) => save({ due: e.target.value || null })} /></Field>
        </div>
        <div className="mt-3">
          <Field label="Role"><Select value={t.role || ''} onChange={(v) => save({ role: v || null })} placeholder="No role" options={withOthers(roleOptions(data.roles.data), t.role ? [t.role] : [])} /></Field>
        </div>
        {(t.spot || t.guide) && (
          <div className="mt-3 rounded-lg bg-gray-50 px-3 py-2.5 text-sm space-y-1">
            {t.spot && (
              <div className="flex flex-wrap items-center gap-x-2">
                <Icon name="pin" size={14} className="text-gray-500" /><span className="font-medium text-gray-900">{t.spot}</span>
                {t.lat != null && t.lon != null && <><span className="text-xs text-gray-500 tabular-nums">{t.lat.toFixed(5)}, {t.lon.toFixed(5)}</span><ExtLink href={mapsLink(t.lat, t.lon)} className="text-xs">Directions</ExtLink></>}
              </div>
            )}
            {t.guide && (
              <div className="text-xs text-gray-600">
                Follows {t.guide}
                {GUIDES.filter((g) => t.guide!.includes(g.prefix)).map((g) => <span key={g.prefix}> · <ExtLink href={g.url}>{g.title}</ExtLink></span>)}
              </div>
            )}
          </div>
        )}
        <div className="mt-3" />
        <Field label="Instructions and notes"><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (t.detail || '') && save({ detail: note || null })} placeholder="What needs doing, decisions, contacts on the ground" /></Field>
      </Card>

      {c && (keys.length > 0 || canReport) && (
        <Card>
          <CardHeader title="From the daily reports" subtitle={rows.length ? `${rows.length} daily report${rows.length === 1 ? '' : 's'}${t.spot ? ` at ${t.spot}` : ''}, ${fmtDay(rows[0].report_date)} to ${fmtDay(rows[rows.length - 1].report_date)}` : 'No daily reports yet'}
            right={canReport ? <Button variant="primary" icon="plus" onClick={() => setResults(true)}>Add daily report</Button> : undefined} />
          {keys.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5">
              {keys.map((k) => <div key={k as string} className="rounded-xl bg-gray-50 p-3"><div className="text-xs text-gray-500">{RESULT_LABEL[k]}</div><div className="text-lg font-semibold tabular-nums">{fmtInt(stepTotals[k as string])}</div></div>)}
            </div>
          )}
          {rows.length > 0 && keys.length > 0 && keys.every((k) => !stepTotals[k as string]) && <p className="text-sm text-amber-800 bg-amber-50 rounded-lg px-3 py-2 mt-3">None of the daily reports so far include these numbers, so this step is still open.</p>}
          {linked.length > 0 && <p className="text-xs text-gray-500 mt-3">{linked.length} of these reports were entered on this task.</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Links" subtitle="Linear issues, documents, sheets, WhatsApp groups" right={<Button icon="external" onClick={() => window.open(linearUrl(), '_blank', 'noopener')}>Create in Linear</Button>} />
        {(t.links || []).length > 0 && (
          <ul className="space-y-1.5 mb-3">
            {(t.links || []).map((l, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Icon name="link" size={14} className="text-gray-400 shrink-0" />
                <ExtLink href={l.url} className="truncate min-w-0">{l.label || l.url}</ExtLink>
                <button type="button" aria-label="Remove link" className="ml-auto text-gray-400 hover:text-red-600" onClick={() => save({ links: (t.links || []).filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <TextInput className="flex-1 min-w-0" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addLink()} placeholder="Paste a link (e.g. the Linear issue after creating it)" />
          <Button onClick={addLink} disabled={!url.trim()}>Add</Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Files" subtitle="Photos, register scans, consent forms, reports" right={<Button icon="upload" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : 'Upload'}</Button>} />
        <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
        {!(t.attachments || []).length ? <p className="text-sm text-gray-500">No files yet.</p> : (
          <ul className="space-y-1.5">
            {(t.attachments || []).map((f, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <Icon name="paperclip" size={14} className="text-gray-400 shrink-0" />
                <ExtLink href={f.url} className="truncate min-w-0">{f.name}</ExtLink>
                <span className="text-xs text-gray-400 shrink-0">{f.size ? `${Math.max(1, Math.round(f.size / 1024))} KB` : ''}{f.added_by ? ` · ${personName(f.added_by)}` : ''}</span>
                <button type="button" aria-label="Remove file" className="ml-auto text-gray-400 hover:text-red-600" onClick={() => save({ attachments: (t.attachments || []).filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {err && <p className="text-sm text-red-600">{err}</p>}

      <Card>
        <CardHeader title="Updates" subtitle="Progress notes from the team, newest first" />
        <div className="flex gap-2 mb-3">
          <TextArea rows={2} className="flex-1" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add an update" />
          <Button variant="primary" className="self-end" onClick={post} disabled={!comment.trim()}>Post</Button>
        </div>
        {!feed.length ? <p className="text-sm text-gray-500">No updates yet.</p> : (
          <ul className="space-y-3">
            {feed.map((u) => (
              <li key={u.id} className="text-sm">
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">{personName(u.author)}</span>
                  <span>{fmtTime(u.created_at)}</span>
                </div>
                {u.body && <p className="text-gray-800 mt-0.5 whitespace-pre-wrap">{u.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {results && c && <ResultsForm c={c} task={t} me={me.email} onClose={() => setResults(false)} />}
    </>
  );
}

/** Campaign settings: status, dates, lead, where its figures come from, its daily reports, and deleting it. */
function CampaignSettings({ c, rows, onDeleted }: { c: TbCampaign; rows: TbResult[]; onDeleted: () => void }) {
  const people = usePeople();
  const save = (patch: Partial<TbCampaign>) => tbSave('tb_campaigns', { ...c, ...patch });
  return (
    <>
      <Card>
        <div className="flex flex-wrap gap-3 items-end">
          <Field label="Status"><Select value={c.status} onChange={(v) => save({ status: v as TbCampaign['status'] })} options={['planned', 'active', 'done', 'cancelled'].map((x) => ({ value: x, label: x }))} /></Field>
          <Field label="Start"><TextInput type="date" value={c.start_date || ''} onChange={(e) => save({ start_date: e.target.value || null })} /></Field>
          <Field label="End"><TextInput type="date" value={c.end_date || ''} onChange={(e) => save({ end_date: e.target.value || null })} /></Field>
          <Field label="Lead"><Select value={c.owner || ''} onChange={(v) => save({ owner: v || null })} placeholder="Unassigned" options={peopleOptions(people, c.owner)} /></Field>
        </div>
        {c.notes && <p className="text-sm text-gray-600 mt-4">{c.notes}</p>}
      </Card>
      <Card>
        <CardHeader title="Daily reports" subtitle={`${rows.length} report${rows.length === 1 ? '' : 's'}`} />
        {!rows.length ? <p className="text-sm text-gray-500">None yet.</p> : (
          <ul className="text-sm divide-y divide-gray-100">
            {[...rows].sort((a, b) => b.report_date.localeCompare(a.report_date)).map((r) => (
              <li key={r.id} className="py-2 flex justify-between gap-3">
                <span>{fmtDay(r.report_date)}{r.spot ? ` · ${r.spot}` : ''} · {fmtInt(r.screened)} screened · {fmtInt(r.presumptive)} symptomatic · {fmtInt(r.confirmed)} TB found{r.reported_by ? ` · ${personName(r.reported_by)}` : ''}</span>
                <button type="button" className="text-gray-400 hover:text-red-600 shrink-0" onClick={() => window.confirm('Delete this report?') && tbRemove('tb_campaign_results', r.id)}>Delete</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <div className="flex justify-end">
        <Button variant="ghost" icon="trash" onClick={async () => { if (window.confirm('Delete this campaign, its tasks and results?')) { await tbRemove('tb_campaigns', c.id); onDeleted(); } }}>Delete campaign</Button>
      </div>
    </>
  );
}

const FIELDS: { key: keyof TbResult; label: string; hint?: string }[] = [
  { key: 'outreach_sessions', label: 'Community outreach sessions' }, { key: 'people_reached', label: 'People reached by outreach' },
  { key: 'screened', label: 'People screened' }, { key: 'presumptive', label: 'Symptomatic (flagged by the clinician)' }, { key: 'tested', label: 'Tested with GeneXpert' },
  { key: 'confirmed', label: 'TB found (confirmed)' }, { key: 'rr_confirmed', label: 'Rifampicin-resistant' },
  { key: 'started_treatment', label: 'Started treatment' }, { key: 'contacts_identified', label: 'Household contacts identified' }, { key: 'contacts_screened', label: 'Contacts screened' }, { key: 'tpt_started', label: 'Preventive treatment started' },
];

function ResultsForm({ c, task, me, onClose }: { c: TbCampaign; task?: TbTask; me: string; onClose: () => void }) {
  const [v, setV] = useState<Record<string, any>>({ report_date: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState('');
  const save = async () => {
    const n = (k: string) => Number(v[k] || 0);
    if (n('presumptive') > n('screened') || n('tested') > n('screened') || n('confirmed') > n('tested')) return setErr('Each step cannot be larger than the one before it (screened, symptomatic, tested, TB found).');
    const row: any = { id: uid('tbr'), campaign_id: c.id, task_id: task?.id || null, spot: v.spot || task?.spot || null, report_date: v.report_date, notes: v.notes || null, reported_by: me };
    for (const f of FIELDS) row[f.key] = n(f.key as string);
    await tbSave('tb_campaign_results', row);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add a daily report" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <p className="text-sm text-gray-500">Enter the numbers for one screening day. Leave unknown fields empty.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Report date"><TextInput type="date" className="w-full" value={v.report_date} onChange={(e) => setV({ ...v, report_date: e.target.value })} /></Field>
        {(c.spots || []).length > 0 && <Field label="Screening point"><Select value={v.spot ?? task?.spot ?? ''} onChange={(x) => setV({ ...v, spot: x })} placeholder="Whole campaign" options={(c.spots || []).map((sp) => ({ value: sp.name, label: sp.name }))} /></Field>}
      </div>
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
        Expected yield*: about <b>1 confirmed case per {nns(exp) ?? '—'}</b> people screened ({SETTINGS.find((s) => s.value === c.setting)?.label || 'setting'}).
        {c.target_screened && exp != null ? <> At {fmtInt(c.target_screened)} screened, expect about <b>{(c.target_screened * exp).toFixed(0)}</b> cases.</> : null}
        <span className="block text-xs mt-1 text-orange-800">* Assumption: published screening yield for the setting (Kranzer et al. 2010), scaled by the district's expected rate vs Ghana.</span>
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

function AddTask({ roles, campaigns, districts, people, me, onClose }: { roles: { value: string; label: string }[]; campaigns: { value: string; label: string }[]; districts: { value: string; label: string }[]; people: { value: string; label: string }[]; me: string; onClose: () => void }) {
  const [t, setT] = useState<Partial<TbTask>>({ status: 'todo' });
  const save = async () => {
    if (!t.title?.trim()) return;
    await tbSave('tb_tasks', { ...(t as TbTask), id: uid('tbt'), title: t.title.trim(), district_name: districts.find((d) => d.value === t.district_id)?.label || null, created_by: me });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add task" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!t.title?.trim()}>Add</Button></>}>
      <Field label="Task"><TextInput className="w-full" value={t.title || ''} onChange={(e) => setT({ ...t, title: e.target.value })} /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Role"><Select value={t.role || ''} onChange={(v) => setT({ ...t, role: v || null })} placeholder="No role" options={roles} /></Field>
        <Field label="Owner"><Select value={t.assignee || ''} onChange={(v) => setT({ ...t, assignee: v || null })} placeholder="Unassigned" options={people} /></Field>
        <Field label="Campaign"><Select value={t.campaign_id || ''} onChange={(v) => setT({ ...t, campaign_id: v || null })} placeholder="None" options={campaigns} /></Field>
        <Field label="District"><Select value={t.district_id || ''} onChange={(v) => setT({ ...t, district_id: v || null })} placeholder="None" options={districts} /></Field>
        <Field label="Due"><TextInput type="date" className="w-full" value={t.due || ''} onChange={(e) => setT({ ...t, due: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
