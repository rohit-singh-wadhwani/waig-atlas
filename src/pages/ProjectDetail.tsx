import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, useMe } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Empty, Field, IconButton, KpiCard, Modal, Select, TextInput, cx } from '../components/ui';
import Icon from '../components/Icon';
import Gantt from '../components/Gantt';
import Checkpoints, { StatusBadge } from '../components/Checkpoints';
import { Attachments, Comments } from '../components/Collab';
import { useData, useLocalPref } from '../lib/hooks';
import { db, uid } from '../lib/store';
import { addMilestone, checkpointDone, flowOf, isDone, KIND_DOT, lostBefore, milestoneProgress, statusOf } from '../lib/projects';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate, fmtTime, relDays } from '../lib/format';
import { NEW_TEAM, peopleOptions, personName, pickTeam, teamOptions, usePeople } from '../lib/team';
import type { Checkpoint, MilestoneTemplate, Page, Project, ProjectMilestone } from '../lib/types';
import { PROJECT_STATUS } from './Projects';
import { placeLabel } from './Grants';

const NotionEditor = React.lazy(() => import('../components/NotionEditor'));

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'GHS', 'INR', 'KES', 'NGN', 'ZAR', 'CHF', 'CAD'];
export function money(v?: number | null, cur?: string | null) {
  if (v == null || !isFinite(Number(v))) return '—';
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: cur || 'USD', notation: Number(v) >= 1e6 ? 'compact' : 'standard', maximumFractionDigits: Number(v) >= 1e6 ? 2 : 0 }).format(Number(v));
  } catch {
    return `${cur || ''} ${Number(v).toLocaleString('en-GB')}`;
  }
}


export default function ProjectDetail() {
  const { slug, mid } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const projects = useData(() => db.list<Project>('projects'), [], []);
  const project = projects.data.find((p) => p.slug === slug);
  const pid = project?.id || '';
  const ms = useData(() => (pid ? db.list<ProjectMilestone>('project_milestones', { project_id: pid }) : Promise.resolve([])), [pid], []);
  const pages = useData(() => (pid ? db.list<Page>('pages', { project_id: pid }) : Promise.resolve([])), [pid], []);
  const cps = useData(() => (pid ? db.list<Checkpoint>('milestone_checkpoints', { project_id: pid }) : Promise.resolve([])), [pid], []);
  const [configuring, setConfiguring] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [railOnly, setRailOnly] = useLocalPref('milestone-panel-collapsed', false);

  const milestones = useMemo(() => [...ms.data].sort((a, b) => a.order - b.order), [ms.data]);
  const current = milestones.find((m) => m.id === mid) || null;

  if (projects.loading) return <div className="text-gray-500">Loading…</div>;
  if (!project) return <Card><Empty icon="folder" title="Project not found"><Link to="/projects" className="text-brand-700">Back to projects</Link></Empty></Card>;

  const pr = milestoneProgress(milestones);
  const next = milestones.find((m) => !isDone(m) && statusOf(m).kind !== 'lost' && m.target_date);
  const openCps = cps.data.filter((c) => !c.completed_on).length;
  const lostM = milestones.find((m) => statusOf(m).kind === 'lost');
  const st = PROJECT_STATUS.find((s) => s.value === project.status) || PROJECT_STATUS[0];
  const saveProject = (patch: Partial<Project>) => db.upsert('projects', { ...project, ...patch } as any);

  return (
    <>
      <div className="mb-3 pl-12 lg:pl-0">
        <Link to="/projects" className="text-sm text-gray-500 hover:text-brand-700 inline-flex items-center gap-1"><Icon name="chevronsLeft" size={15} /> Projects</Link>
      </div>
      <PageHeader title={project.name} subtitle={project.summary} actions={<Button icon="edit" onClick={() => setEditingProject(true)}>Edit project</Button>} />

      <div className="flex flex-wrap items-center gap-2 mb-6">
        <Badge className={st.cls}>{st.label}</Badge>
        <Badge className="bg-gray-100 text-gray-700"><Icon name="pin" size={13} />{placeLabel(project.countries, countries)}</Badge>
        {project.funder && <Badge className="bg-gray-100 text-gray-700"><Icon name="coins" size={13} />{project.funder}</Badge>}
        {project.diseases?.map((d) => <Badge key={d} className="bg-gray-100 text-gray-700">{d}</Badge>)}
        <span className="mx-1 text-gray-300">|</span>
        {project.links?.map((l) => (
          <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-brand-700 bg-white border border-gray-200 rounded-lg px-3 py-1.5 hover:border-brand-300">
            <Icon name={l.kind === 'dashboard' ? 'dashboard' : l.kind === 'repo' ? 'database' : 'link'} size={15} />{l.title}
          </a>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard icon="activity" label="Overall progress" value={`${pr}%`} foot={`${milestones.filter(isDone).length} of ${milestones.length} milestones · ${openCps} checkpoints open`} />
        <KpiCard icon="calendar" tint="orange" label="Next deadline" value={next ? fmtDate(next.target_date, { day: 'numeric', month: 'short' }) : '—'} foot={next ? `${next.name} · ${relDays(next.target_date)}` : undefined} onClick={() => next && nav(`/projects/${project.slug}/${next.id}`)} />
        <KpiCard icon="coins" tint="purple" label="Grant amount" value={<span className="text-[22px]">{money(project.grant_amount, project.currency)}</span>} foot={project.funder || 'Total award'} onClick={() => setEditingProject(true)} />
        <KpiCard icon="dollar" tint="blue" label="Contracted to us" value={<span className="text-[22px]">{money(project.contracted_amount, project.currency)}</span>} foot={project.grant_amount && project.contracted_amount ? `${Math.round((project.contracted_amount / project.grant_amount) * 100)}% of the grant` : 'Our share of the award'} onClick={() => setEditingProject(true)} />
        <KpiCard icon="user" tint="green" label="Lead" value={<span className="text-[20px]">{personName(project.lead)}</span>} />
        <KpiCard icon="clock" tint="gray" label="Timeline" value={<span className="text-[20px]">{fmtDate(project.end_date, { month: 'short', year: 'numeric' })}</span>} foot={`from ${fmtDate(project.start_date)}`} />
      </div>

      <div className={cx('grid grid-cols-1 gap-6', railOnly ? 'lg:grid-cols-[76px_1fr]' : 'xl:grid-cols-[300px_1fr]')}>
        {railOnly ? (
          <Card className="h-fit lg:sticky lg:top-6" pad={false}>
            <nav className="flex lg:flex-col items-center gap-2 p-3" aria-label="Milestones">
              <IconButton icon="chevronsRight" title="Show milestone panel" onClick={() => setRailOnly(false)} />
              <span className="hidden lg:block w-8 border-t border-gray-200 my-1" />
              <Link to={`/projects/${project.slug}`} title="Overview" className={cx('w-11 h-11 rounded-xl flex items-center justify-center', !current ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-gray-600 hover:bg-gray-50')}>
                <Icon name="dashboard" size={19} />
              </Link>
              {milestones.map((m, i) => {
                const s = statusOf(m);
                const sel = current?.id === m.id;
                const moot = lostBefore(milestones, m);
                return (
                  <Link key={m.id} to={`/projects/${project.slug}/${m.id}`} title={`${i + 1}. ${m.name} · ${s.label}${moot ? ' · may not be needed (grant lost)' : ''}`} className={cx('relative w-11 h-11 rounded-xl flex items-center justify-center text-[15px] font-semibold', sel ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : moot ? 'text-gray-400 hover:bg-gray-50' : 'text-gray-700 hover:bg-gray-50')}>
                    {i + 1}
                    <span className={cx('absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white', moot ? 'bg-red-600' : KIND_DOT[s.kind])} />
                  </Link>
                );
              })}
              <span className="hidden lg:block w-8 border-t border-gray-200 my-1" />
              <IconButton icon="settings" title="Configure milestones" onClick={() => setConfiguring(true)} />
            </nav>
          </Card>
        ) : (
        <Card className="h-fit lg:sticky lg:top-6" pad={false}>
          <div className="px-5 pt-5 pb-2 flex items-center justify-between">
            <span className="text-[13px] font-medium tracking-wider uppercase text-gray-500">Milestones</span>
            <div className="flex items-center">
              <IconButton icon="settings" title="Configure milestones" onClick={() => setConfiguring(true)} />
              <IconButton icon="chevronsLeft" title="Collapse milestone panel" onClick={() => setRailOnly(true)} />
            </div>
          </div>
          <nav className="px-3 pb-4 space-y-1">
            <Link to={`/projects/${project.slug}`} className={cx('flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px]', !current ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-50')}>
              <Icon name="dashboard" size={18} /> Overview
            </Link>
            {milestones.map((m, i) => {
              const s = statusOf(m);
              const moot = lostBefore(milestones, m);
              const late = !isDone(m) && !moot && (daysUntil(m.target_date) ?? 1) < 0;
              return (
                <Link key={m.id} to={`/projects/${project.slug}/${m.id}`} className={cx('block rounded-xl px-3 py-2.5', current?.id === m.id ? 'bg-brand-50' : 'hover:bg-gray-50')} title={moot ? `May not be needed: ${moot.name} was marked ${statusOf(moot).label}` : s.label}>
                  <div className="flex items-center gap-3">
                    <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', moot ? 'bg-red-600' : KIND_DOT[s.kind])} />
                    <span className={cx('text-[15px] flex-1 leading-snug', current?.id === m.id ? 'text-brand-700 font-medium' : moot ? 'text-gray-400' : 'text-gray-800')}>{i + 1}. {m.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 pl-5">
                    <span className="text-[11px] text-gray-500 truncate max-w-[110px]">{moot ? 'may not be needed' : s.label}</span>
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden"><div className={cx('h-full', s.kind === 'lost' ? 'bg-red-400' : 'bg-brand-500')} style={{ width: `${isDone(m) ? 100 : m.progress}%` }} /></div>
                    <span className={cx('text-xs tabular-nums', late ? 'text-red-600' : 'text-gray-500')}>{m.target_date ? fmtDate(m.target_date, { day: 'numeric', month: 'short' }) : ''}</span>
                  </div>
                </Link>
              );
            })}
          </nav>
        </Card>
        )}

        <div className="space-y-6 min-w-0">
          {!current ? (
            <Overview project={project} milestones={milestones} checkpoints={cps.data} lost={lostM || null} onSelect={(id) => nav(`/projects/${project.slug}/${id}`)} />
          ) : (
            <MilestoneView key={current.id} project={project} m={current} checkpoints={cps.data.filter((c) => c.milestone_id === current.id)} moot={lostBefore(milestones, current)} page={pages.data.find((p) => p.milestone_id === current.id)} me={me.email} />
          )}
        </div>
      </div>

      <ConfigureMilestones open={configuring} onClose={() => setConfiguring(false)} project={project} milestones={milestones} />
      <EditProject open={editingProject} onClose={() => setEditingProject(false)} project={project} save={saveProject} />
    </>
  );
}

function Overview({ project, milestones, checkpoints, lost, onSelect }: { project: Project; milestones: ProjectMilestone[]; checkpoints: Checkpoint[]; lost: ProjectMilestone | null; onSelect: (id: string) => void }) {
  return (
    <>
      {lost && (
        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-900 px-5 py-4 text-[15px] flex gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 mt-1.5 shrink-0" />
          <span><b>{lost.name}</b> is marked <b>{statusOf(lost).label}</b>. Milestones after it are marked with a red dot: they may not need to be filled in.</span>
        </div>
      )}
      <Card>
        <CardHeader title="Milestone timeline" subtitle="Bars run from start to target date; the darker share is progress. Click a row to open it." />
        <Gantt milestones={milestones} onSelect={onSelect} />
      </Card>
      <Card>
        <CardHeader title="Milestones and checkpoints" subtitle="Status, checkpoints done and owner. Click a milestone to work on it." />
        <ul className="divide-y divide-gray-100">
          {milestones.map((m) => {
            const cps = checkpoints.filter((c) => c.milestone_id === m.id).sort((a, b) => a.position - b.position);
            const moot = lostBefore(milestones, m);
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onSelect(m.id)} className="w-full text-left py-3 hover:bg-gray-50 rounded-lg px-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', moot ? 'bg-red-600' : KIND_DOT[statusOf(m).kind])} />
                    <span className={cx('flex-1 min-w-[160px] text-[15px]', moot ? 'text-gray-400' : 'text-gray-800')}>{m.name}</span>
                    <StatusBadge m={m} />
                    <span className="text-sm text-gray-500 w-28 truncate">{personName(m.owner)}</span>
                    <span className="text-sm text-gray-500 w-20 text-right tabular-nums">{fmtDate(m.target_date, { day: 'numeric', month: 'short' })}</span>
                  </div>
                  {cps.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2 pl-5">
                      {cps.map((c) => {
                        const f = checkpointDone(c);
                        return <span key={c.id} className={cx('text-xs rounded-md px-2 py-0.5 border', f === 1 ? 'bg-green-50 border-green-200 text-green-800' : f ? 'bg-brand-50 border-brand-200 text-brand-800' : 'bg-white border-gray-200 text-gray-600')}>{f === 1 ? '✓ ' : ''}{c.title}{c.tasks.length ? ` ${c.tasks.filter((t) => t.done).length}/${c.tasks.length}` : ''}</span>;
                      })}
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </Card>
      <Attachments entityType="project" entityId={project.id} title="Project attachments" subtitle="Dashboards, proposals, contracts, decks, data folders" />
      <Comments entityType="project" entityId={project.id} title="Project discussion" />
    </>
  );
}

function MilestoneView({ project, m, checkpoints, moot, page, me }: { project: Project; m: ProjectMilestone; checkpoints: Checkpoint[]; moot: ProjectMilestone | null; page?: Page; me: string }) {
  const people = usePeople();
  const save = (patch: Partial<ProjectMilestone>) => db.upsert('project_milestones', { ...m, ...patch } as any);
  const pageId = React.useRef(page?.id || uid('pg'));
  const savePage = async ({ json, md }: { json: any[]; md: string }) => {
    const base: Page = page || { id: pageId.current, project_id: project.id, milestone_id: m.id, title: m.name, content_md: '', updated_at: '' };
    await db.upsert('pages', { ...base, content_md: md, content_json: json, updated_at: new Date().toISOString(), updated_by: me } as any);
  };
  const headings = (page?.content_md || '').split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, ''));

  return (
    <>
      {moot && (
        <div className="rounded-2xl border border-red-200 bg-red-50 text-red-900 px-5 py-4 text-[15px] flex gap-3">
          <span className="w-2.5 h-2.5 rounded-full bg-red-600 mt-1.5 shrink-0" />
          <span><b>{moot.name}</b> was marked <b>{statusOf(moot).label}</b>, so this milestone may not be needed. You can still fill it in.</span>
        </div>
      )}
      <Card>
        <CardHeader title={m.name} subtitle="Status, team and dates" right={<StatusBadge m={m} />} />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Status"><Select value={statusOf(m).key} onChange={(v) => save({ status: v })} options={flowOf(m).map((s) => ({ value: s.key, label: s.label }))} /></Field>
          <Field label="Team"><Select value={m.team || ''} onChange={(v) => { const t = pickTeam(v); if (t !== null) save({ team: t }); }} placeholder="—" options={[...teamOptions(people, [m.team]), { value: NEW_TEAM, label: '+ New team…' }]} /></Field>
          <Field label="Start"><TextInput type="date" className="w-full" value={(m.start_date || '').slice(0, 10)} onChange={(e) => save({ start_date: e.target.value || null })} /></Field>
          <Field label="Target"><TextInput type="date" className="w-full" value={(m.target_date || '').slice(0, 10)} onChange={(e) => save({ target_date: e.target.value || null })} /></Field>
        </div>
        {!checkpoints.length && (
          <div className="mt-5">
            <div className="text-sm mb-1.5 text-gray-600">Progress (%) <span className="text-gray-400">· add checkpoints below and progress is calculated for you</span></div>
            <ProgressSlider value={isDone(m) ? 100 : m.progress} onCommit={(v) => save({ progress: v })} />
          </div>
        )}
      </Card>

      <Card>
        <Checkpoints items={checkpoints} table="milestone_checkpoints" base={{ milestone_id: m.id, project_id: m.project_id }} progress={m.progress} onProgress={(p) => save({ progress: p })} hint="Break this milestone into checkpoints with dates, an owner and what needs doing." />
      </Card>

      <Card>
        <CardHeader
          title="Page"
          subtitle={page ? `Last edited ${fmtTime(page.updated_at)}${page.updated_by ? ` by ${personName(page.updated_by)}` : ''} · click anywhere to type; use the toolbar to add tables, charts and diagrams` : 'Type / to add a table, chart, diagram or template'}
        />
        {headings.length > 3 && (
          <div className="flex flex-wrap gap-1.5 mb-5 pb-4 border-b border-gray-100">
            {headings.map((h) => (
              <a key={h} href={`#${slugId(h)}`} onClick={(e) => { e.preventDefault(); const el = Array.from(document.querySelectorAll('.atlas-editor h1, .atlas-editor h2, .atlas-editor h3, .prose-atlas h2')).find((x) => x.textContent?.trim() === h.trim()); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 hover:border-brand-300 hover:text-brand-700">{h}</a>
            ))}
          </div>
        )}
        <div className="-mx-2 sm:-mx-4">
          <React.Suspense fallback={<div className="text-sm text-gray-400 py-4 px-4">Loading editor…</div>}>
            <NotionEditor key={m.id} json={page?.content_json} md={page?.content_md || ''} onSave={savePage} />
          </React.Suspense>
        </div>
      </Card>

      <Attachments entityType="milestone" entityId={m.id} />
      <Comments entityType="milestone" entityId={m.id} />
    </>
  );
}

/** Slider keeps its own value while dragging and saves once on release, so it never snaps back. */
function ProgressSlider({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [v, setV] = useState(value);
  const dragging = React.useRef(false);
  React.useEffect(() => {
    if (!dragging.current) setV(value);
  }, [value]);
  const commit = () => {
    dragging.current = false;
    if (v !== value) onCommit(v);
  };
  return (
    <div className="flex items-center gap-4">
      <input
        type="range" min={0} max={100} step={5} value={v} aria-label="Progress"
        onChange={(e) => { dragging.current = true; setV(Number(e.target.value)); }}
        onMouseUp={commit} onTouchEnd={commit} onKeyUp={commit} onBlur={commit}
        className="flex-1 accent-[#316d6e] cursor-pointer"
      />
      <input
        type="number" min={0} max={100} step={5} value={v} aria-label="Progress percent"
        onChange={(e) => setV(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
        onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()}
        className="w-20 border border-gray-200 rounded-lg px-2 h-9 text-sm text-right tabular-nums"
      />
    </div>
  );
}

export function slugId(h: string) {
  return 'h-' + h.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

function ConfigureMilestones({ open, onClose, project, milestones }: { open: boolean; onClose: () => void; project: Project; milestones: ProjectMilestone[] }) {
  const me = useMe();
  const templates = useData(() => db.list<MilestoneTemplate>('milestone_templates'), [], []);
  const library = templates.data.flatMap((t) => t.milestones.map((m) => ({ t: t.name, m })));
  const [pick, setPick] = useState('');
  const [custom, setCustom] = useState('');
  const move = async (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= milestones.length) return;
    await db.upsert('project_milestones', { ...milestones[i], order: milestones[j].order } as any);
    await db.upsert('project_milestones', { ...milestones[j], order: milestones[i].order } as any);
  };
  const nextOrder = (milestones[milestones.length - 1]?.order ?? -1) + 1;
  const addFromLibrary = async () => {
    const x = library[Number(pick)];
    if (x) await addMilestone(project.id, x.m, nextOrder, me.email);
    setPick('');
  };
  const addCustom = async () => {
    if (!custom.trim()) return;
    await addMilestone(project.id, { key: custom.toLowerCase().replace(/\W+/g, '-'), name: custom.trim(), sections: [] }, nextOrder, me.email);
    setCustom('');
  };
  return (
    <Modal open={open} onClose={onClose} title="Configure milestones" footer={<Button variant="primary" onClick={onClose}>Done</Button>}>
      <p className="text-sm text-gray-500">Rename, reorder or remove milestones for this project. Removing one also removes its page.</p>
      <ul className="space-y-2">
        {milestones.map((m, i) => (
          <li key={m.id} className="flex items-center gap-2">
            <TextInput className="flex-1 h-10" defaultValue={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && db.upsert('project_milestones', { ...m, name: e.target.value.trim() } as any)} />
            <IconButton icon="arrowUp" title="Move up" onClick={() => move(i, -1)} />
            <IconButton icon="arrowDown" title="Move down" onClick={() => move(i, 1)} />
            <IconButton icon="trash" title="Remove" onClick={() => window.confirm(`Remove "${m.name}" and its page?`) && db.remove('project_milestones', m.id)} />
          </li>
        ))}
      </ul>
      <div className="border-t border-gray-100 pt-3 space-y-2">
        <div className="flex gap-2">
          <Select className="flex-1" value={pick} onChange={setPick} placeholder="Add from a template…" options={library.map((x, i) => ({ value: String(i), label: `${x.m.name} (${x.t})` }))} />
          <Button onClick={addFromLibrary} disabled={pick === ''}>Add</Button>
        </div>
        <div className="flex gap-2">
          <TextInput className="flex-1" placeholder="Or a blank milestone name" value={custom} onChange={(e) => setCustom(e.target.value)} />
          <Button onClick={addCustom} disabled={!custom.trim()}>Add</Button>
        </div>
      </div>
    </Modal>
  );
}

function EditProject({ open, onClose, project, save }: { open: boolean; onClose: () => void; project: Project; save: (p: Partial<Project>) => Promise<any> }) {
  const people = usePeople();
  const world = useWorld();
  const [p, setP] = useState<Project>(project);
  const [lt, setLt] = useState('');
  const [lu, setLu] = useState('');
  const [lk, setLk] = useState<Project['links'][number]['kind']>('dashboard');
  React.useEffect(() => setP(project), [project, open]);
  return (
    <Modal open={open} onClose={onClose} title="Edit project" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={async () => { await save(p); onClose(); }}>Save</Button></>}>
      <Field label="Name"><TextInput className="w-full" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
      <Field label="Summary"><TextInput className="w-full" value={p.summary} onChange={(e) => setP({ ...p, summary: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Status"><Select value={p.status} onChange={(v) => setP({ ...p, status: v as Project['status'] })} options={PROJECT_STATUS.map((s) => ({ value: s.value, label: s.label }))} /></Field>
        <Field label="Lead"><Select value={p.lead || ''} onChange={(v) => setP({ ...p, lead: v })} options={peopleOptions(people, p.lead)} /></Field>
        <Field label="Start"><TextInput type="date" className="w-full" value={(p.start_date || '').slice(0, 10)} onChange={(e) => setP({ ...p, start_date: e.target.value })} /></Field>
        <Field label="End"><TextInput type="date" className="w-full" value={(p.end_date || '').slice(0, 10)} onChange={(e) => setP({ ...p, end_date: e.target.value })} /></Field>
        <Field label="Country"><Select value={p.countries[0] || ''} onChange={(v) => setP({ ...p, countries: v ? [v] : [] })} placeholder="—" options={(world?.countries || []).map((c) => ({ value: c.iso3, label: c.name }))} /></Field>
        <Field label="Funder"><TextInput className="w-full" value={p.funder || ''} onChange={(e) => setP({ ...p, funder: e.target.value })} /></Field>
        <Field label="Grant amount" hint="Total award from the funder"><TextInput className="w-full" inputMode="decimal" placeholder="e.g. 1500000" value={p.grant_amount ?? ''} onChange={(e) => setP({ ...p, grant_amount: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })} /></Field>
        <Field label="Contracted amount" hint="Our share under the contract"><TextInput className="w-full" inputMode="decimal" placeholder="e.g. 450000" value={p.contracted_amount ?? ''} onChange={(e) => setP({ ...p, contracted_amount: e.target.value === '' ? null : Number(e.target.value.replace(/[^0-9.]/g, '')) })} /></Field>
        <Field label="Currency"><Select value={p.currency || 'USD'} onChange={(v) => setP({ ...p, currency: v })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} /></Field>
      </div>
      <Field label="Dashboard and document links">
        <ul className="space-y-1 mb-2">
          {p.links.map((l, i) => (
            <li key={l.url + i} className="flex items-center gap-2 text-sm">
              <Icon name={l.kind === 'dashboard' ? 'dashboard' : 'link'} size={15} className="text-brand-600" />
              <span className="flex-1 truncate">{l.title} · <span className="text-gray-500">{l.url}</span></span>
              <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => setP({ ...p, links: p.links.filter((_, k) => k !== i) })}><Icon name="x" size={15} /></button>
            </li>
          ))}
        </ul>
        <div className="rounded-xl border border-dashed border-gray-300 p-3 space-y-2">
          <div className="text-xs font-medium text-gray-500">Add a link</div>
          <TextInput className="w-full" placeholder="Title, e.g. QA dashboard" value={lt} onChange={(e) => setLt(e.target.value)} />
          <TextInput className="w-full" placeholder="https://…" value={lu} onChange={(e) => setLu(e.target.value)} />
          <div className="flex gap-2">
            <Select className="flex-1" value={lk} onChange={(v) => setLk(v as any)} options={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'document', label: 'Document' }, { value: 'repo', label: 'Repo' }, { value: 'link', label: 'Link' }]} />
            <Button icon="plus" className="h-11" onClick={() => { if (/^https?:\/\//.test(lu)) { setP({ ...p, links: [...p.links, { title: lt || lu, url: lu, kind: lk }] }); setLt(''); setLu(''); } }}>Add</Button>
          </div>
        </div>
      </Field>
    </Modal>
  );
}
