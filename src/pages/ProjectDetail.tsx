import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader, useMe } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Empty, ExtLink, Field, IconButton, KpiCard, Modal, Progress, Select, TextInput, cx } from '../components/ui';
import Icon from '../components/Icon';
import BlockEditor from '../components/BlockEditor';
import Gantt from '../components/Gantt';
import Stepper from '../components/Stepper';
import { Attachments, Comments } from '../components/Collab';
import { useData, useLocalPref } from '../lib/hooks';
import { db, uid } from '../lib/store';
import { addMilestone, milestoneProgress, teamProgress } from '../lib/projects';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate, fmtTime, relDays } from '../lib/format';
import { TEAM, TEAMS, personName } from '../lib/team';
import type { MilestoneTemplate, Page, Project, ProjectMilestone, Task } from '../lib/types';
import { PROJECT_STATUS } from './Projects';
import { placeLabel } from './Grants';

const MS_STATUS: { value: ProjectMilestone['status']; label: string; dot: string }[] = [
  { value: 'not_started', label: 'Not started', dot: 'bg-gray-300' },
  { value: 'in_progress', label: 'In progress', dot: 'bg-brand-500' },
  { value: 'blocked', label: 'Blocked', dot: 'bg-red-500' },
  { value: 'done', label: 'Done', dot: 'bg-green-600' },
];
const TASK_STATUS: { value: Task['status']; label: string; cls: string }[] = [
  { value: 'todo', label: 'To do', cls: 'bg-gray-100 text-gray-700' },
  { value: 'in_progress', label: 'In progress', cls: 'bg-brand-50 text-brand-700' },
  { value: 'blocked', label: 'Blocked', cls: 'bg-red-50 text-red-700' },
  { value: 'done', label: 'Done', cls: 'bg-green-50 text-green-700' },
];

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
  const tasks = useData(() => (pid ? db.list<Task>('tasks', { project_id: pid }) : Promise.resolve([])), [pid], []);
  const [configuring, setConfiguring] = useState(false);
  const [editingProject, setEditingProject] = useState(false);
  const [railOnly, setRailOnly] = useLocalPref('milestone-panel-collapsed', false);

  const milestones = useMemo(() => [...ms.data].sort((a, b) => a.order - b.order), [ms.data]);
  const current = milestones.find((m) => m.id === mid) || null;

  if (projects.loading) return <div className="text-gray-500">Loading…</div>;
  if (!project) return <Card><Empty icon="folder" title="Project not found"><Link to="/projects" className="text-brand-700">Back to projects</Link></Empty></Card>;

  const pr = milestoneProgress(milestones);
  const next = milestones.find((m) => m.status !== 'done' && m.target_date);
  const openTasks = tasks.data.filter((t) => t.status !== 'done');
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
        <KpiCard icon="activity" label="Overall progress" value={`${pr}%`} foot={`${milestones.filter((m) => m.status === 'done').length} of ${milestones.length} milestones done`} />
        <KpiCard icon="calendar" tint="orange" label="Next deadline" value={next ? fmtDate(next.target_date, { day: 'numeric', month: 'short' }) : '—'} foot={next ? `${next.name} · ${relDays(next.target_date)}` : undefined} onClick={() => next && nav(`/projects/${project.slug}/${next.id}`)} />
        <KpiCard icon="clipboard" tint="purple" label="Open tasks" value={openTasks.length} foot={`${tasks.data.filter((t) => t.status === 'blocked').length} blocked`} />
        <KpiCard icon="users" tint="blue" label="Teams involved" value={new Set(tasks.data.map((t) => t.team)).size} />
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
                const s = MS_STATUS.find((x) => x.value === m.status) || MS_STATUS[0];
                const sel = current?.id === m.id;
                return (
                  <Link key={m.id} to={`/projects/${project.slug}/${m.id}`} title={`${i + 1}. ${m.name} · ${s.label}`} className={cx('relative w-11 h-11 rounded-xl flex items-center justify-center text-[15px] font-semibold', sel ? 'bg-brand-50 text-brand-700 ring-1 ring-brand-200' : 'text-gray-700 hover:bg-gray-50')}>
                    {i + 1}
                    <span className={cx('absolute top-1.5 right-1.5 w-2 h-2 rounded-full ring-2 ring-white', s.dot)} />
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
              const s = MS_STATUS.find((x) => x.value === m.status) || MS_STATUS[0];
              const late = m.status !== 'done' && (daysUntil(m.target_date) ?? 1) < 0;
              return (
                <Link key={m.id} to={`/projects/${project.slug}/${m.id}`} className={cx('block rounded-xl px-3 py-2.5', current?.id === m.id ? 'bg-brand-50' : 'hover:bg-gray-50')}>
                  <div className="flex items-center gap-3">
                    <span className={cx('w-2.5 h-2.5 rounded-full shrink-0', s.dot)} title={s.label} />
                    <span className={cx('text-[15px] flex-1 leading-snug', current?.id === m.id ? 'text-brand-700 font-medium' : 'text-gray-800')}>{i + 1}. {m.name}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 pl-5">
                    <div className="h-1.5 flex-1 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-brand-500" style={{ width: `${m.status === 'done' ? 100 : m.progress}%` }} /></div>
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
            <Overview project={project} milestones={milestones} tasks={tasks.data} onSelect={(id) => nav(`/projects/${project.slug}/${id}`)} />
          ) : (
            <MilestoneView key={current.id} project={project} m={current} page={pages.data.find((p) => p.milestone_id === current.id)} tasks={tasks.data.filter((t) => t.milestone_id === current.id)} me={me.email} />
          )}
        </div>
      </div>

      <ConfigureMilestones open={configuring} onClose={() => setConfiguring(false)} project={project} milestones={milestones} />
      <EditProject open={editingProject} onClose={() => setEditingProject(false)} project={project} save={saveProject} />
    </>
  );
}

function Overview({ project, milestones, tasks, onSelect }: { project: Project; milestones: ProjectMilestone[]; tasks: Task[]; onSelect: (id: string) => void }) {
  const teams = teamProgress(tasks);
  return (
    <>
      <Card>
        <CardHeader title="Milestone timeline" subtitle="Bars run from start to target date; the darker share is progress. Click a row to open it." />
        <Gantt milestones={milestones} onSelect={onSelect} />
      </Card>
      <div className="grid grid-cols-1 2xl:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Progress by team" subtitle="Share of each team's tasks that are done" />
          {teams.length ? (
            <ul className="space-y-4">
              {teams.map((t) => (
                <li key={t.team}>
                  <div className="flex justify-between text-[15px] mb-1.5">
                    <span className="text-gray-800 font-medium">{t.team}</span>
                    <span className="text-gray-500 tabular-nums">{t.done}/{t.total} done{t.blocked ? ` · ${t.blocked} blocked` : ''} · <span className="text-gray-900 font-medium">{t.pct}%</span></span>
                  </div>
                  <Progress value={t.pct} />
                </li>
              ))}
            </ul>
          ) : <Empty icon="users" title="No tasks yet" />}
        </Card>
        <Card>
          <CardHeader title="Milestones" subtitle="Status, owner and dates" />
          <ul className="divide-y divide-gray-100">
            {milestones.map((m) => {
              const s = MS_STATUS.find((x) => x.value === m.status) || MS_STATUS[0];
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => onSelect(m.id)} className="w-full text-left py-2.5 flex items-center gap-3 hover:bg-gray-50 rounded-lg px-1">
                    <span className={cx('w-2.5 h-2.5 rounded-full', s.dot)} />
                    <span className="flex-1 text-[15px] text-gray-800">{m.name}</span>
                    <span className="text-sm text-gray-500 w-32 truncate">{personName(m.owner)}</span>
                    <span className="text-sm text-gray-500 w-24 text-right">{fmtDate(m.target_date, { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>
      <TaskList project={project} tasks={tasks} milestones={milestones} />
      <Attachments entityType="project" entityId={project.id} title="Project attachments" subtitle="Dashboards, proposals, contracts, decks, data folders" />
      <Comments entityType="project" entityId={project.id} title="Project discussion" />
    </>
  );
}

function MilestoneView({ project, m, page, tasks, me }: { project: Project; m: ProjectMilestone; page?: Page; tasks: Task[]; me: string }) {
  const save = (patch: Partial<ProjectMilestone>) => db.upsert('project_milestones', { ...m, ...patch } as any);
  const savePage = async (md: string) => {
    const p: Page = page ? { ...page, content_md: md, updated_at: new Date().toISOString(), updated_by: me } : { id: uid('pg'), project_id: project.id, milestone_id: m.id, title: m.name, content_md: md, updated_at: new Date().toISOString(), updated_by: me };
    await db.upsert('pages', p as any);
  };
  const headings = (page?.content_md || '').split('\n').filter((l) => /^##\s/.test(l)).map((l) => l.replace(/^##\s+/, ''));

  return (
    <>
      <Card>
        <CardHeader title={m.name} subtitle="Milestone tracking" />
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
          <Field label="Status"><Select value={m.status} onChange={(v) => save({ status: v as ProjectMilestone['status'], progress: v === 'done' ? 100 : m.progress })} options={MS_STATUS.map((s) => ({ value: s.value, label: s.label }))} /></Field>
          <Field label="Owner"><Select value={m.owner || ''} onChange={(v) => save({ owner: v })} placeholder="Unassigned" options={TEAM.map((p) => ({ value: p.email, label: p.name }))} /></Field>
          <Field label="Team"><Select value={m.team || ''} onChange={(v) => save({ team: v })} placeholder="—" options={TEAMS.map((t) => ({ value: t, label: t }))} /></Field>
          <Field label="Start"><TextInput type="date" className="w-full" value={(m.start_date || '').slice(0, 10)} onChange={(e) => save({ start_date: e.target.value || null })} /></Field>
          <Field label="Target"><TextInput type="date" className="w-full" value={(m.target_date || '').slice(0, 10)} onChange={(e) => save({ target_date: e.target.value || null })} /></Field>
        </div>
        <div className="mt-5">
          <div className="text-sm mb-1.5 text-gray-600">Progress (%)</div>
          <ProgressSlider value={m.status === 'done' ? 100 : m.progress} onCommit={(v) => save({ progress: v, status: v === 100 ? 'done' : m.status === 'done' || (m.status === 'not_started' && v > 0) ? 'in_progress' : m.status })} />
        </div>
        {m.stages?.length ? (
          <div className="mt-5">
            <div className="text-[13px] font-medium tracking-wider uppercase text-gray-500 mb-2">Checkpoints</div>
            <Stepper stages={m.stages} onChange={(stages) => save({ stages, progress: Math.round((stages.filter((s) => s.done_at).length / stages.length) * 100) })} />
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader
          title="Page"
          subtitle={page ? `Last edited ${fmtTime(page.updated_at)}${page.updated_by ? ` by ${personName(page.updated_by)}` : ''} · click any block to edit` : 'Click to start writing'}
        />
        {headings.length > 3 && (
          <div className="flex flex-wrap gap-1.5 mb-5 pb-4 border-b border-gray-100">
            {headings.map((h) => (
              <a key={h} href={`#${slugId(h)}`} onClick={(e) => { e.preventDefault(); document.getElementById(slugId(h))?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }} className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 hover:border-brand-300 hover:text-brand-700">{h}</a>
            ))}
          </div>
        )}
        <div className="pl-8">
          <BlockEditor md={page?.content_md || ''} onSave={savePage} />
        </div>
      </Card>

      <TaskList project={project} tasks={tasks} milestones={[m]} milestoneId={m.id} />
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

function TaskList({ project, tasks, milestones, milestoneId }: { project: Project; tasks: Task[]; milestones: ProjectMilestone[]; milestoneId?: string }) {
  const [title, setTitle] = useState('');
  const [team, setTeam] = useState(TEAMS[0]);
  const [filter, setFilter] = useState('');
  const add = async () => {
    if (!title.trim()) return;
    await db.upsert('tasks', { id: uid('t'), project_id: project.id, milestone_id: milestoneId || null, title: title.trim(), team, status: 'todo' } as any);
    setTitle('');
  };
  const list = tasks.filter((t) => !filter || t.team === filter).sort((a, b) => TASK_STATUS.findIndex((s) => s.value === a.status) - TASK_STATUS.findIndex((s) => s.value === b.status));
  return (
    <Card>
      <CardHeader title="Tasks" subtitle={`${tasks.filter((t) => t.status !== 'done').length} open · ${tasks.length} total`} right={<Select className="w-[200px]" value={filter} onChange={setFilter} placeholder="All teams" options={TEAMS.map((t) => ({ value: t, label: t }))} />} />
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <tbody>
            {list.map((t) => (
              <tr key={t.id} className="border-b border-gray-100">
                <td className="py-2.5 pr-3">
                  <div className="text-gray-900">{t.url ? <ExtLink href={t.url}>{t.title}</ExtLink> : t.title}</div>
                  {!milestoneId && t.milestone_id && <div className="text-xs text-gray-500">{milestones.find((m) => m.id === t.milestone_id)?.name}</div>}
                </td>
                <td className="py-2.5 px-2 text-sm text-gray-600 whitespace-nowrap">{t.team}</td>
                <td className="py-2.5 px-2 w-[170px]"><Select value={t.owner || ''} onChange={(v) => db.upsert('tasks', { ...t, owner: v } as any)} placeholder="Unassigned" options={TEAM.map((p) => ({ value: p.email, label: p.name }))} className="[&_select]:h-9 [&_select]:text-sm" /></td>
                <td className="py-2.5 px-2 w-[150px]"><Select value={t.status} onChange={(v) => db.upsert('tasks', { ...t, status: v } as any)} options={TASK_STATUS.map((s) => ({ value: s.value, label: s.label }))} className="[&_select]:h-9 [&_select]:text-sm" /></td>
                <td className="py-2.5 pl-2 w-[140px]"><TextInput type="date" value={(t.due || '').slice(0, 10)} onChange={(e) => db.upsert('tasks', { ...t, due: e.target.value || null } as any)} className="h-9 text-sm px-2 w-full" /></td>
                <td className="py-2.5 pl-1 w-8"><button type="button" className="text-gray-300 hover:text-red-500" title="Delete task" onClick={() => db.remove('tasks', t.id)}><Icon name="trash" size={15} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!list.length && <p className="text-sm text-gray-500 py-3">No tasks yet.</p>}
      <div className="flex flex-wrap gap-2 mt-4">
        <TextInput className="flex-1 min-w-[220px]" placeholder="Add a task…" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} />
        <Select className="w-[200px]" value={team} onChange={setTeam} options={TEAMS.map((t) => ({ value: t, label: t }))} />
        <Button variant="primary" icon="plus" onClick={add}>Add</Button>
      </div>
    </Card>
  );
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
        <Field label="Lead"><Select value={p.lead || ''} onChange={(v) => setP({ ...p, lead: v })} options={TEAM.map((x) => ({ value: x.email, label: x.name }))} /></Field>
        <Field label="Start"><TextInput type="date" className="w-full" value={(p.start_date || '').slice(0, 10)} onChange={(e) => setP({ ...p, start_date: e.target.value })} /></Field>
        <Field label="End"><TextInput type="date" className="w-full" value={(p.end_date || '').slice(0, 10)} onChange={(e) => setP({ ...p, end_date: e.target.value })} /></Field>
        <Field label="Country"><Select value={p.countries[0] || ''} onChange={(v) => setP({ ...p, countries: v ? [v] : [] })} placeholder="—" options={(world?.countries || []).map((c) => ({ value: c.iso3, label: c.name }))} /></Field>
        <Field label="Funder"><TextInput className="w-full" value={p.funder || ''} onChange={(e) => setP({ ...p, funder: e.target.value })} /></Field>
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
