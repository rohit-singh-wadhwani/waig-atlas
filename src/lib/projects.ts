import { db, uid } from './store';
import type { Checkpoint, FlowStatus, MilestoneTemplate, Page, Project, ProjectMilestone, Task, TemplateMilestone } from './types';

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || uid('p');
}

/** Used only when a milestone has no flow of its own (older data). */
export const FALLBACK_FLOW: FlowStatus[] = [
  { key: 'not_started', label: 'Not started', kind: 'todo' },
  { key: 'in_progress', label: 'In progress', kind: 'active' },
  { key: 'blocked', label: 'Blocked', kind: 'blocked' },
  { key: 'done', label: 'Done', kind: 'done' },
];
export const flowOf = (m: ProjectMilestone) => (m.flow && m.flow.length ? m.flow : FALLBACK_FLOW);
export const statusOf = (m: ProjectMilestone) => flowOf(m).find((s) => s.key === m.status) || flowOf(m)[0];
export const KIND_DOT: Record<FlowStatus['kind'], string> = { todo: 'bg-gray-300', active: 'bg-brand-500', blocked: 'bg-amber-500', done: 'bg-green-600', lost: 'bg-red-600' };
export const KIND_BADGE: Record<FlowStatus['kind'], string> = { todo: 'bg-gray-100 text-gray-700', active: 'bg-brand-50 text-brand-700', blocked: 'bg-amber-50 text-amber-800', done: 'bg-green-50 text-green-700', lost: 'bg-red-50 text-red-700' };
export const isDone = (m: ProjectMilestone) => statusOf(m).kind === 'done';

/** Checkpoints a template milestone starts with (older templates: sections become checkpoints, max 4). */
export function templateCheckpoints(m: TemplateMilestone): Checkpoint[] {
  const src = m.checkpoints && m.checkpoints.length ? m.checkpoints : m.sections.slice(0, 4).map((s) => ({ key: s.key, title: s.title, subtasks: [] }));
  return src.map((c) => ({ key: c.key, title: c.title, parallel: !!c.parallel, target: null, done_at: null, owner: null, subtasks: c.subtasks.map((t) => ({ key: t.key, title: t.title, done_at: null, owner: null, due: null })) }));
}

/** Progress from checkpoints: each sub-task counts once; a checkpoint without sub-tasks counts once. */
export function checkpointProgress(cps: Checkpoint[]) {
  const units = cps.reduce((n, c) => n + (c.subtasks.length || 1), 0);
  if (!units) return null;
  const done = cps.reduce((n, c) => n + (c.subtasks.length ? c.subtasks.filter((s) => s.done_at).length : c.done_at ? 1 : 0), 0);
  return Math.round((done / units) * 100);
}

export function pageSkeleton(m: TemplateMilestone): string {
  const parts = [`${m.description || ''}`.trim()].filter(Boolean);
  for (const c of templateCheckpoints(m)) {
    parts.push(`## ${c.title}`);
    if (c.subtasks.length) for (const t of c.subtasks) parts.push(`### ${t.title}\n\n_To fill._`);
    else parts.push('_To fill._');
  }
  return parts.join('\n\n');
}

export async function addMilestone(projectId: string, m: TemplateMilestone, order: number, by: string) {
  const flow = m.statuses && m.statuses.length ? m.statuses : FALLBACK_FLOW;
  const ms: ProjectMilestone = {
    id: uid('m'), project_id: projectId, key: m.key || slugify(m.name), name: m.name, order, status: flow[0].key, progress: 0,
    start_date: null, target_date: null, flow, checkpoints: templateCheckpoints(m),
  };
  await db.upsert('project_milestones', ms as any);
  const page: Page = { id: uid('pg'), project_id: projectId, milestone_id: ms.id, title: m.name, content_md: pageSkeleton(m), updated_at: new Date().toISOString(), updated_by: by };
  await db.upsert('pages', page as any);
  return ms;
}

export async function createProject(p: Omit<Project, 'id' | 'slug'>, template: MilestoneTemplate | null, by: string) {
  const project: Project = { ...p, id: uid('prj'), slug: slugify(p.name), template_id: template?.id, created_at: new Date().toISOString() };
  await db.upsert('projects', project as any);
  if (template) {
    let i = 0;
    for (const m of template.milestones) await addMilestone(project.id, m, i++, by);
  }
  return project;
}

export function milestoneProgress(ms: ProjectMilestone[]) {
  const counted = ms.filter((m) => statusOf(m).kind !== 'lost');
  if (!counted.length) return 0;
  return Math.round(counted.reduce((s, m) => s + (isDone(m) ? 100 : m.progress || 0), 0) / counted.length);
}

/** Milestones after a lost one may not be needed. */
export function lostBefore(ms: ProjectMilestone[], m: ProjectMilestone) {
  return ms.find((x) => x.order < m.order && statusOf(x).kind === 'lost') || null;
}

export function teamProgress(tasks: Task[]) {
  const by = new Map<string, { done: number; total: number; blocked: number }>();
  for (const t of tasks) {
    const k = t.team || 'Unassigned';
    const v = by.get(k) || { done: 0, total: 0, blocked: 0 };
    v.total++;
    if (t.status === 'done') v.done++;
    if (t.status === 'blocked') v.blocked++;
    by.set(k, v);
  }
  return Array.from(by.entries()).map(([team, v]) => ({ team, ...v, pct: v.total ? Math.round((v.done / v.total) * 100) : 0 }));
}
