import { db, uid } from './store';
import type { MilestoneTemplate, Page, Project, ProjectMilestone, Task, TemplateMilestone } from './types';

export function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || uid('p');
}

export function pageSkeleton(m: TemplateMilestone): string {
  const parts = [`${m.description || ''}`.trim()].filter(Boolean);
  for (const s of m.sections) parts.push(`## ${s.title}\n\n_To fill._`);
  return parts.join('\n\n');
}

export async function addMilestone(projectId: string, m: TemplateMilestone, order: number, by: string) {
  const ms: ProjectMilestone = {
    id: uid('m'), project_id: projectId, key: m.key || slugify(m.name), name: m.name, order, status: 'not_started', progress: 0,
    start_date: null, target_date: null,
    stages: m.stages?.map((s) => ({ key: s.key, label: s.label, target: null, done_at: null })),
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
  if (!ms.length) return 0;
  return Math.round(ms.reduce((s, m) => s + (m.status === 'done' ? 100 : m.progress || 0), 0) / ms.length);
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
