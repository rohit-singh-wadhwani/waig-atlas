// One-off: templates get status flows + checkpoints with sub-tasks; existing project milestones are converted.
import fs from 'node:fs';
import { sb } from '../lib.mjs';

const tpls = JSON.parse(fs.readFileSync(new URL('./2026-11-milestone-templates.json', import.meta.url), 'utf8'));
for (const [id, milestones] of Object.entries(tpls)) {
  await sb.patch('milestone_templates', id, { milestones });
  console.log('template updated', id, milestones.length);
}
const projects = await sb.select('projects', 'select=id,template_id');
const ms = await sb.select('project_milestones', 'select=*');
const byTpl = (tid) => tpls[tid] || tpls.tpl_health_ai;
for (const m of ms) {
  if (m.checkpoints) continue;
  const p = projects.find((x) => x.id === m.project_id);
  const t = byTpl(p?.template_id).find((x) => x.key === m.key) || tpls.tpl_health_ai.find((x) => x.key === m.key);
  if (!t) continue;
  const checkpoints = t.checkpoints.map((c) => ({ ...c, target: null, done_at: null, owner: null, subtasks: c.subtasks.map((s) => ({ ...s, done_at: null, owner: null, due: null })) }));
  let status = m.status;
  const isGrant = t.statuses.some((s) => s.key === 'won');
  if (isGrant) {
    const done = (m.stages || []).filter((s) => s.done_at).map((s) => s.key);
    status = done.includes('grant') ? 'won' : done.includes('review1') || done.includes('review2') ? 'under_review' : done.includes('submission') ? 'application_done' : 'internal_alignment';
    // carry dates from the old checkpoints onto the closest new ones
    const old = Object.fromEntries((m.stages || []).map((s) => [s.key, s]));
    if (old.submission?.done_at) { checkpoints[2].done_at = old.submission.done_at; checkpoints[2].subtasks.forEach((s) => (s.done_at = old.submission.done_at)); checkpoints[0].done_at = checkpoints[1].done_at = old.submission.done_at; checkpoints[0].subtasks.forEach((s) => (s.done_at = old.submission.done_at)); checkpoints[1].subtasks.forEach((s) => (s.done_at = old.submission.done_at)); }
    if (old.submission?.target) checkpoints[2].target = old.submission.target;
  } else if (m.status === 'done') {
    for (const c of checkpoints) { c.done_at = new Date().toISOString(); c.subtasks.forEach((s) => (s.done_at = c.done_at)); }
  }
  const units = checkpoints.reduce((n, c) => n + (c.subtasks.length || 1), 0);
  const doneUnits = checkpoints.reduce((n, c) => n + (c.subtasks.length ? c.subtasks.filter((s) => s.done_at).length : c.done_at ? 1 : 0), 0);
  await sb.patch('project_milestones', m.id, { flow: t.statuses, checkpoints, status, progress: Math.round((doneUnits / units) * 100) });
  console.log('milestone', m.name, '->', status, Math.round((doneUnits / units) * 100) + '%');
}
