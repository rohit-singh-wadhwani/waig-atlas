import React, { useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, CardHeader, Drawer, Empty, ExtLink, Field, Modal, Segmented, Select, TextArea, TextInput, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useMe } from '../../components/Layout';
import { linkLabel } from '../../components/Checkpoints';
import { fmtTime } from '../../lib/format';
import { uid, uploadFile } from '../../lib/store';
import { peopleOptions, personName, usePeople } from '../../lib/team';
import { cascadeTotals, createCampaign, expectedPositivity, fmtInt, pct, SETTINGS, tbRemove, tbSave, TbCampaign, TbFile, TbResult, TbTask, TbTaskUpdate } from '../../lib/tb';
import type { TbData } from './TbPage';

const STATUS_CLS: Record<string, string> = { planned: 'bg-gray-100 text-gray-700', active: 'bg-brand-50 text-brand-700', done: 'bg-green-50 text-green-700', cancelled: 'bg-red-50 text-red-700' };
const nns = (p: number | null) => (p && p > 0 ? Math.round(1 / p) : null);
const natRateOf = (data: TbData) => { const n = data.dist.data.meta?.national; return n ? (n.incidence / n.pop) * 1e5 : null; };

type Filter = 'open' | 'overdue' | 'week' | 'doing' | 'blocked' | 'done';
const TASK_STATUS = [{ value: 'todo', label: 'To do' }, { value: 'doing', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }];
const STATUS_DOT: Record<string, string> = { todo: 'bg-gray-300', doing: 'bg-brand-500', blocked: 'bg-red-500', done: 'bg-green-500' };
// playbook steps where screening numbers are produced, so the task offers "Enter results"
const RESULT_STEPS = ['screen', 'sputum', 'test', 'treat', 'contacts', 'outreach', 'report', 'track', 'opd'];
const day = (d: Date) => d.toISOString().slice(0, 10);
// the guideline documents playbook steps cite (see tb_playbooks.sources)
const GUIDES: { prefix: string; title: string; url: string }[] = [
  { prefix: 'WHO', title: 'WHO operational handbook on TB, Module 2', url: 'https://www.who.int/publications-detail-redirect/9789240022614' },
  { prefix: 'DAK', title: 'Ghana TB Digital Adaptation Kit', url: 'https://media.path.org/documents/Ghana_Digital_Adaptation_Kit_for_TB_2025.pdf' },
];
const mapsLink = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;

/** Campaigns & tasks: what is active, who owns it, what is late; each task opens into a workspace. */
export default function Campaigns({ data, onPlan }: { data: TbData; onPlan: (c: Partial<TbCampaign>) => void }) {
  const me = useMe();
  const people = usePeople();
  const { campaigns, results, tasks, updates, playbooks, dist } = data;
  const [filter, setFilter] = useState<Filter>('open');
  const [mine, setMine] = useState(false);
  const [role, setRole] = useState('');
  const [openCampaign, setOpenCampaign] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const today = day(new Date());
  const weekEnd = day(new Date(Date.now() + 7 * 864e5));
  const byCampaign = useMemo(() => {
    const m: Record<string, TbResult[]> = {};
    for (const r of results.data) (m[r.campaign_id] ||= []).push(r);
    return m;
  }, [results.data]);
  const roles = useMemo(() => Array.from(new Set([...playbooks.data.flatMap((p) => p.steps.map((s) => s.role)), ...tasks.data.map((t) => t.role || '')].filter(Boolean))).sort(), [playbooks.data, tasks.data]);
  const match = (t: TbTask, f: Filter) =>
    f === 'done' ? t.status === 'done'
    : t.status !== 'done' && (f === 'open' || (f === 'overdue' && !!t.due && t.due < today) || (f === 'week' && !!t.due && t.due >= today && t.due <= weekEnd) || (f === 'doing' && t.status === 'doing') || (f === 'blocked' && t.status === 'blocked'));
  const scoped = tasks.data.filter((t) => (!mine || t.assignee === me.email) && (!role || t.role === role));
  const count = (f: Filter) => scoped.filter((t) => match(t, f)).length;
  const shown = scoped.filter((t) => match(t, filter)).sort((x, y) => (x.due || '9999').localeCompare(y.due || '9999'));
  const camps = [...campaigns.data].sort((x, y) => (y.start_date || y.created_at || '').localeCompare(x.start_date || x.created_at || ''));
  const groups = [...camps.map((c) => ({ c, items: shown.filter((t) => t.campaign_id === c.id) })), { c: null as TbCampaign | null, items: shown.filter((t) => !t.campaign_id || !campaigns.data.some((c) => c.id === t.campaign_id)) }].filter((g) => g.items.length);
  const curCampaign = campaigns.data.find((c) => c.id === openCampaign) || null;
  const curTask = tasks.data.find((t) => t.id === openTask) || null;
  const FILTERS: { value: Filter; label: string; tone?: string }[] = [
    { value: 'open', label: 'Open' }, { value: 'overdue', label: 'Overdue', tone: 'text-red-700' }, { value: 'week', label: 'Due this week' },
    { value: 'doing', label: 'In progress' }, { value: 'blocked', label: 'Blocked', tone: 'text-red-700' }, { value: 'done', label: 'Done' },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {FILTERS.map((f) => (
          <button key={f.value} type="button" onClick={() => setFilter(f.value)}
            className={cx('rounded-xl border px-3.5 py-2.5 text-left transition-colors', filter === f.value ? 'border-gray-900 bg-white shadow-sm' : 'border-gray-200 bg-white/60 hover:bg-white')}>
            <div className={cx('text-2xl font-semibold tabular-nums', count(f.value) && f.tone ? f.tone : 'text-gray-900')}>{count(f.value)}</div>
            <div className="text-xs text-gray-500">{f.label}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5 items-start">
        <Card pad={false} className="min-w-0">
          <div className="p-5 pb-3">
            <CardHeader title={FILTERS.find((f) => f.value === filter)!.label + ' tasks'} subtitle="Grouped by campaign: open one to see its tasks, then click a task to add notes, links, files or results."
              right={<><Segmented<'all' | 'mine'> size="sm" value={mine ? 'mine' : 'all'} onChange={(v) => setMine(v === 'mine')} options={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Mine' }]} />
                <Select className="w-[200px] [&_select]:h-9 [&_select]:text-sm" value={role} onChange={setRole} placeholder="All roles" options={roles.map((r) => ({ value: r, label: r }))} />
                <Button icon="plus" onClick={() => setAdding(true)}>Task</Button></>} />
          </div>
          {!groups.length ? (
            <div className="px-5 pb-5"><Empty icon="checkCircle" title={tasks.data.length ? 'Nothing in this view' : 'No tasks yet'}>{tasks.data.length ? 'Try another filter above.' : 'Tasks are created from the playbook when you plan a campaign on Find and act.'}</Empty></div>
          ) : groups.map(({ c, items }) => {
            const key = c?.id || 'other';
            const open = groups.length === 1 || expanded.includes(key);
            const ct = c ? tasks.data.filter((x) => x.campaign_id === c.id) : [];
            const done = ct.filter((x) => x.status === 'done').length;
            const late = items.filter((t) => t.status !== 'done' && t.due && t.due < today).length;
            return (
              <section key={key} className="border-t border-gray-100">
                <div className="px-5 py-3 flex items-center gap-3 hover:bg-gray-50/70">
                  <button type="button" className="min-w-0 flex-1 flex items-start gap-2.5 text-left" aria-expanded={open} onClick={() => setExpanded((x) => (x.includes(key) ? x.filter((y) => y !== key) : [...x, key]))}>
                    <Icon name={open ? 'chevronDown' : 'chevronRight'} size={18} className="text-gray-400 mt-0.5 shrink-0" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-gray-900 truncate">{c ? c.name : 'Other tasks'}</span>
                      <span className="block text-xs text-gray-500 truncate">
                        {c ? [c.town, c.district_name].filter(Boolean).join(', ') + (c.start_date ? ` · starts ${c.start_date}` : '') + ' · ' : ''}
                        {items.length} {FILTERS.find((f) => f.value === filter)!.label.toLowerCase()}{late ? <span className="text-red-700"> · {late} overdue</span> : null}
                      </span>
                    </span>
                  </button>
                  {c && <Badge className={cx('shrink-0', STATUS_CLS[c.status])}>{c.status}</Badge>}
                  {c && ct.length > 0 && (
                    <span className="hidden sm:flex items-center gap-2 text-xs text-gray-500 shrink-0">
                      <span className="w-16 h-1.5 rounded-full bg-gray-200 overflow-hidden"><span className="block h-full bg-green-500" style={{ width: `${(done / ct.length) * 100}%` }} /></span>
                      {done}/{ct.length}
                    </span>
                  )}
                  {c && <button type="button" className="text-sm text-brand-700 hover:underline shrink-0" onClick={() => setOpenCampaign(c.id)}>Details</button>}
                </div>
                {open && (
                  <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/30">
                    {items.map((t) => <TaskRow key={t.id} t={t} today={today} updates={updates.data.filter((u) => u.task_id === t.id).length} onOpen={() => setOpenTask(t.id)} />)}
                  </ul>
                )}
              </section>
            );
          })}
        </Card>

        <div className="space-y-5 min-w-0">
          <Card>
            <CardHeader title="Campaigns" right={<Button variant="primary" icon="plus" onClick={() => onPlan({ setting: 'community', playbook_id: 'acf_community' })}>New</Button>} />
            {!camps.length ? <p className="text-sm text-gray-500">None yet. Plan one from a town on Find and act.</p> : (
              <ul className="divide-y divide-gray-100 -mx-1">
                {camps.map((c) => {
                  const ct = tasks.data.filter((x) => x.campaign_id === c.id);
                  const late = ct.filter((x) => x.status !== 'done' && x.due && x.due < today).length;
                  const tt = cascadeTotals(byCampaign[c.id] || []);
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setOpenCampaign(c.id)} className="w-full text-left px-1 py-2.5 rounded-lg hover:bg-gray-50">
                        <div className="flex items-center justify-between gap-2"><span className="font-medium text-gray-900 truncate">{c.name}</span><Badge className={STATUS_CLS[c.status]}>{c.status}</Badge></div>
                        <div className="text-xs text-gray-500 mt-0.5">{[c.town, c.district_name].filter(Boolean).join(', ')} · {ct.filter((x) => x.status === 'done').length}/{ct.length} tasks{late ? <span className="text-red-600"> · {late} late</span> : null}{tt.screened ? ` · ${fmtInt(tt.screened)} screened, ${fmtInt(tt.confirmed)} confirmed` : ''}</div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Drawer open={!!curCampaign} onClose={() => setOpenCampaign(null)} title={curCampaign?.name} subtitle={curCampaign ? [curCampaign.town, curCampaign.district_name, SETTINGS.find((x) => x.value === curCampaign.setting)?.label].filter(Boolean).join(' · ') : ''}>
        {curCampaign && <CampaignDetail c={curCampaign} data={data} rows={byCampaign[curCampaign.id] || []} tasks={tasks.data.filter((x) => x.campaign_id === curCampaign.id)} onOpenTask={(id) => { setOpenCampaign(null); setOpenTask(id); }} onDeleted={() => setOpenCampaign(null)} />}
      </Drawer>
      <Drawer open={!!curTask} onClose={() => setOpenTask(null)} title={curTask?.title} subtitle={curTask ? [campaigns.data.find((c) => c.id === curTask.campaign_id)?.name, curTask.role].filter(Boolean).join(' · ') : ''}>
        {curTask && <TaskWorkspace t={curTask} c={campaigns.data.find((x) => x.id === curTask.campaign_id) || null} data={data} />}
      </Drawer>
      {adding && <AddTask roles={roles} campaigns={campaigns.data.map((c) => ({ value: c.id, label: c.name }))} districts={dist.data.list.map((d) => ({ value: d.id, label: d.name }))} me={me.email} people={peopleOptions(people)} onClose={() => setAdding(false)} />}
    </div>
  );
}

function TaskRow({ t, today, updates, onOpen }: { t: TbTask; today: string; updates: number; onOpen: () => void }) {
  const late = t.status !== 'done' && !!t.due && t.due < today;
  const toggle = () => tbSave('tb_tasks', { ...t, status: t.status === 'done' ? 'todo' : 'done', updated_at: new Date().toISOString() });
  return (
    <li className="flex items-start gap-3 px-5 py-3 hover:bg-gray-50">
      <input type="checkbox" className="mt-1" checked={t.status === 'done'} onChange={toggle} aria-label="Done" />
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={cx('text-[15px]', t.status === 'done' ? 'line-through text-gray-400' : 'text-gray-900')}>{t.title}</div>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 mt-1 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1"><span className={cx('w-2 h-2 rounded-full', STATUS_DOT[t.status])} />{TASK_STATUS.find((x) => x.value === t.status)?.label}</span>
          <span>{t.assignee ? personName(t.assignee) : <span className="text-amber-700">Unassigned</span>}{t.role ? ` · ${t.role}` : ''}</span>
          {t.spot && <span className="inline-flex items-center gap-0.5"><Icon name="pin" size={12} />{t.spot}</span>}
          {t.due && <span className={cx(late && 'text-red-600 font-medium')}>{late ? 'Overdue · ' : 'Due '}{t.due}</span>}
          {(t.links?.length || 0) > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="link" size={12} />{t.links!.length}</span>}
          {(t.attachments?.length || 0) > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="paperclip" size={12} />{t.attachments!.length}</span>}
          {updates > 0 && <span className="inline-flex items-center gap-0.5"><Icon name="message" size={12} />{updates}</span>}
        </div>
      </button>
      <Icon name="chevronRight" size={16} className="text-gray-300 mt-1.5 shrink-0" />
    </li>
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
  const showResults = !!c && (RESULT_STEPS.includes(t.step_key || '') || linked.length > 0);

  return (
    <>
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Status"><Select value={t.status} onChange={(v) => save({ status: v as TbTask['status'] })} options={TASK_STATUS} /></Field>
          <Field label="Owner"><Select value={t.assignee || ''} onChange={(v) => save({ assignee: v || null })} placeholder="Unassigned" options={peopleOptions(people, t.assignee)} /></Field>
          <Field label="Due"><TextInput type="date" className="w-full" value={t.due || ''} onChange={(e) => save({ due: e.target.value || null })} /></Field>
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
        <Field label="Notes"><TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => note !== (t.detail || '') && save({ detail: note || null })} placeholder="What needs doing, decisions, contacts on the ground" /></Field>
      </Card>

      {showResults && (
        <Card>
          <CardHeader title="Screening results" subtitle={linked.length ? `${linked.length} report${linked.length > 1 ? 's' : ''} linked to this task` : 'Numbers from this step feed the campaign cascade'} right={<Button variant="primary" icon="plus" onClick={() => setResults(true)}>Enter results</Button>} />
          {linked.length > 0 && (
            <ul className="text-sm divide-y divide-gray-100">
              {linked.map((r) => <li key={r.id} className="py-2">{r.report_date} · {fmtInt(r.screened)} screened · {fmtInt(r.confirmed)} confirmed{r.reported_by ? ` · ${personName(r.reported_by)}` : ''}</li>)}
            </ul>
          )}
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

function CampaignDetail({ c, data, rows, tasks, onOpenTask, onDeleted }: { c: TbCampaign; data: TbData; rows: TbResult[]; tasks: TbTask[]; onOpenTask: (id: string) => void; onDeleted: () => void }) {
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
        <CardHeader title="Cascade" subtitle={`Expected* about 1 case per ${nns(exp) ?? '—'} screened${t.screened ? `; observed ${t.confirmed ? `1 per ${Math.round(t.screened / t.confirmed)}` : 'none yet'}` : ''}`} right={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add results</Button>} />
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
        <CardHeader title="Tasks" subtitle="Click one to open it" />
        {!tasks.length && <p className="text-sm text-gray-500">No tasks.</p>}
        <ul className="divide-y divide-gray-100 -mx-1">
          {[...tasks].sort((a, b) => (a.due || '').localeCompare(b.due || '')).map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onOpenTask(x.id)} className="w-full text-left px-1 py-2.5 rounded-lg hover:bg-gray-50 flex items-center gap-3">
                <span className={cx('w-2 h-2 rounded-full shrink-0', STATUS_DOT[x.status])} />
                <span className="min-w-0 flex-1">
                  <span className={cx('block text-[15px]', x.status === 'done' && 'line-through text-gray-400')}>{x.title}</span>
                  <span className={cx('block text-xs', x.status !== 'done' && x.due && x.due < today ? 'text-red-600' : 'text-gray-500')}>{x.role}{x.assignee ? ` · ${personName(x.assignee)}` : ' · unassigned'}{x.due ? ` · due ${x.due}` : ''}</span>
                </span>
                <Icon name="chevronRight" size={16} className="text-gray-300" />
              </button>
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
  { key: 'outreach_sessions', label: 'Community outreach sessions' }, { key: 'people_reached', label: 'People reached by outreach' },
  { key: 'screened', label: 'People screened' }, { key: 'cough_flagged', label: 'Flagged by cough AI (HeAR)' }, { key: 'cxr_flagged', label: 'Flagged by X-ray AI' },
  { key: 'presumptive', label: 'Presumptive TB (any flag or symptoms)' }, { key: 'tested', label: 'Tested with GeneXpert' }, { key: 'confirmed', label: 'Confirmed TB' },
  { key: 'rr_confirmed', label: 'Rifampicin-resistant' }, { key: 'cough_flagged_confirmed', label: 'Confirmed among cough-AI flagged' }, { key: 'cxr_flagged_confirmed', label: 'Confirmed among X-ray-AI flagged' },
  { key: 'started_treatment', label: 'Started treatment' }, { key: 'contacts_identified', label: 'Household contacts identified' }, { key: 'contacts_screened', label: 'Contacts screened' }, { key: 'tpt_started', label: 'Preventive treatment started' },
];

function ResultsForm({ c, task, me, onClose }: { c: TbCampaign; task?: TbTask; me: string; onClose: () => void }) {
  const [v, setV] = useState<Record<string, any>>({ report_date: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState('');
  const save = async () => {
    const n = (k: string) => Number(v[k] || 0);
    if (n('confirmed') > n('screened') || n('tested') > n('screened')) return setErr('Confirmed and tested cannot exceed people screened.');
    if (n('cough_flagged_confirmed') > n('cough_flagged') || n('cxr_flagged_confirmed') > n('cxr_flagged')) return setErr('Confirmed among flagged cannot exceed the number flagged.');
    const row: any = { id: uid('tbr'), campaign_id: c.id, task_id: task?.id || null, spot: v.spot || task?.spot || null, report_date: v.report_date, notes: v.notes || null, reported_by: me };
    for (const f of FIELDS) row[f.key] = n(f.key as string);
    await tbSave('tb_campaign_results', row);
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Add campaign results" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <p className="text-sm text-gray-500">Enter the numbers for this reporting day or week. Leave unknown fields empty.</p>
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

function AddTask({ roles, campaigns, districts, people, me, onClose }: { roles: string[]; campaigns: { value: string; label: string }[]; districts: { value: string; label: string }[]; people: { value: string; label: string }[]; me: string; onClose: () => void }) {
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
        <Field label="Role"><TextInput className="w-full" list="tb-roles" value={t.role || ''} onChange={(e) => setT({ ...t, role: e.target.value })} /></Field>
        <Field label="Owner"><Select value={t.assignee || ''} onChange={(v) => setT({ ...t, assignee: v || null })} placeholder="Unassigned" options={people} /></Field>
        <Field label="Campaign"><Select value={t.campaign_id || ''} onChange={(v) => setT({ ...t, campaign_id: v || null })} placeholder="None" options={campaigns} /></Field>
        <Field label="District"><Select value={t.district_id || ''} onChange={(v) => setT({ ...t, district_id: v || null })} placeholder="None" options={districts} /></Field>
        <Field label="Due"><TextInput type="date" className="w-full" value={t.due || ''} onChange={(e) => setT({ ...t, due: e.target.value })} /></Field>
      </div>
      <datalist id="tb-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
    </Modal>
  );
}
