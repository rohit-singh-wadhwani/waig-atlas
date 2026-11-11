import { db, uid } from './store';
import type { Checkpoint, FlowStatus, MilestoneTemplate, Page, Project, ProjectMilestone, TemplateCheckpoint, TemplateMilestone } from './types';

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

/** A template milestone's checkpoints (older templates: first 4 sections, no tasks). */
export function templateCheckpoints(m: TemplateMilestone): TemplateCheckpoint[] {
  if (m.checkpoints && m.checkpoints.length) return m.checkpoints.map((c) => ({ title: c.title, tasks: c.tasks || [] }));
  return (m.sections || []).slice(0, 4).map((s) => ({ title: s.title, tasks: [] }));
}

/** 0-1 completion of one checkpoint: a completion date means done; otherwise the share of tasks ticked. */
export function checkpointDone(c: Checkpoint) {
  if (c.completed_on) return 1;
  return c.tasks.length ? c.tasks.filter((t) => t.done).length / c.tasks.length : 0;
}

/** Milestone progress (%) from its checkpoints, or null if it has none. */
export function checkpointProgress(cps: Checkpoint[]) {
  if (!cps.length) return null;
  return Math.round((cps.reduce((s, c) => s + checkpointDone(c), 0) / cps.length) * 100);
}

export function pageSkeleton(m: TemplateMilestone): string {
  const parts = [`${m.description || ''}`.trim()].filter(Boolean);
  for (const c of templateCheckpoints(m)) parts.push(`## ${c.title}\n\n_To fill._`);
  return parts.join('\n\n');
}

export async function addMilestone(projectId: string, m: TemplateMilestone, order: number, by: string) {
  const flow = m.statuses && m.statuses.length ? m.statuses : FALLBACK_FLOW;
  const ms: ProjectMilestone = {
    id: uid('m'), project_id: projectId, key: m.key || slugify(m.name), name: m.name, order, status: flow[0].key, progress: 0,
    start_date: null, target_date: null, flow,
  };
  await db.upsert('project_milestones', ms as any);
  let pos = 0;
  for (const c of templateCheckpoints(m)) {
    const row: Checkpoint = { id: uid('cp'), milestone_id: ms.id, project_id: projectId, position: pos++, title: c.title, target_date: null, completed_on: null, owner: null, notes: null, tasks: c.tasks.map((t) => ({ id: uid('t'), title: t, done: false })) };
    await db.upsert('milestone_checkpoints', row as any);
  }
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
