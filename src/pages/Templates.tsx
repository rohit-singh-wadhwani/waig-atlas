import React, { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Empty, IconButton, TextArea, TextInput } from '../components/ui';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db, uid } from '../lib/store';
import type { FlowStatus, MilestoneTemplate, TemplateCheckpoint, TemplateMilestone } from '../lib/types';
import { FALLBACK_FLOW, KIND_BADGE } from '../lib/projects';

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function TemplatesPage() {
  const templates = useData(() => db.list<MilestoneTemplate>('milestone_templates'), [], []);
  const [openId, setOpenId] = useState<string | null>(null);
  const add = async () => {
    const t: MilestoneTemplate = { id: uid('tpl'), name: 'New template', description: '', milestones: [blankMilestone(1)] };
    await db.upsert('milestone_templates', t as any);
    setOpenId(t.id);
  };
  return (
    <>
      <PageHeader title="Milestone Templates" subtitle="What new projects start with: milestones, each with a status flow and checkpoints made of sub-tasks. Each project can still change its own." actions={<Button variant="primary" icon="plus" onClick={add}>New template</Button>} />
      <div className="space-y-6">
        {templates.data.map((t) => (
          <TemplateCard key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
        ))}
        {!templates.loading && !templates.data.length && <Card><Empty icon="layers" title="No templates yet" /></Card>}
      </div>
    </>
  );
}

const GRANT_FLOW: FlowStatus[] = [
  { key: 'internal_alignment', label: 'Internal alignment', kind: 'active' },
  { key: 'proposal_done', label: 'Proposal done', kind: 'active' },
  { key: 'application_done', label: 'Application done', kind: 'active' },
  { key: 'under_review', label: 'Under review', kind: 'active' },
  { key: 'won', label: 'Grant won', kind: 'done' },
  { key: 'lost', label: 'Grant lost', kind: 'lost' },
];
const KINDS: { value: FlowStatus['kind']; label: string }[] = [
  { value: 'todo', label: 'Not started' }, { value: 'active', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done / won' }, { value: 'lost', label: 'Lost / dropped' },
];
function blankMilestone(n: number): TemplateMilestone {
  return { key: `milestone-${n}`, name: `Milestone ${n}`, statuses: FALLBACK_FLOW, checkpoints: [{ key: 'checkpoint-1', title: 'Checkpoint 1', subtasks: [] }], sections: [{ key: 'checkpoint-1', title: 'Checkpoint 1' }] };
}
/** Older templates: sections become checkpoints (max 4) and the old review steps are dropped. */
function normalise(m: TemplateMilestone): TemplateMilestone {
  const checkpoints = m.checkpoints && m.checkpoints.length ? m.checkpoints : m.sections.slice(0, 4).map((x) => ({ key: x.key, title: x.title, subtasks: [] }));
  return { ...m, statuses: m.statuses && m.statuses.length ? m.statuses : FALLBACK_FLOW, checkpoints };
}
const withSections = (m: TemplateMilestone): TemplateMilestone => ({ ...m, sections: (m.checkpoints || []).map((c) => ({ key: c.key, title: c.title })) });

function TemplateCard({ t, open, onToggle }: { t: MilestoneTemplate; open: boolean; onToggle: () => void }) {
  const [draft, setDraft] = useState<MilestoneTemplate>({ ...t, milestones: t.milestones.map(normalise) });
  React.useEffect(() => setDraft({ ...t, milestones: t.milestones.map(normalise) }), [t]);
  const setM = (i: number, m: TemplateMilestone) => setDraft({ ...draft, milestones: draft.milestones.map((x, k) => (k === i ? m : x)) });
  const moveM = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.milestones.length) return;
    const ms = [...draft.milestones];
    [ms[i], ms[j]] = [ms[j], ms[i]];
    setDraft({ ...draft, milestones: ms });
  };
  const save = async () => {
    await db.upsert('milestone_templates', { ...draft, milestones: draft.milestones.map(withSections) } as any);
    onToggle();
  };
  const view = t.milestones.map(normalise);
  return (
    <Card>
      <CardHeader
        title={t.name}
        subtitle={t.description}
        right={
          <>
            <Badge className="bg-gray-100 text-gray-700">{t.milestones.length} milestones</Badge>
            <Button icon={open ? 'x' : 'edit'} onClick={onToggle}>{open ? 'Close' : 'Edit'}</Button>
          </>
        }
      />
      {!open ? (
        <ol className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {view.map((m, i) => (
            <li key={m.key + i} className="border border-gray-200 rounded-xl p-4 min-w-0">
              <div className="font-medium text-gray-900">{i + 1}. {m.name}</div>
              <div className="flex flex-wrap gap-1 mt-2">
                {(m.statuses || []).map((s) => <span key={s.key} className={`text-[11px] rounded px-1.5 py-px ${KIND_BADGE[s.kind]}`}>{s.label}</span>)}
              </div>
              <ol className="mt-3 space-y-2 text-sm">
                {(m.checkpoints || []).map((c, k) => (
                  <li key={c.key}>
                    <div className="text-gray-800"><span className="text-gray-400 tabular-nums">{k + 1}.</span> {c.title}{c.parallel && <span className="ml-1.5 text-[11px] text-brand-700 bg-brand-50 rounded px-1.5">parallel</span>}</div>
                    {c.subtasks.length > 0 && <ul className="pl-5 text-xs text-gray-500 list-disc">{c.subtasks.map((x) => <li key={x.key}>{x.title}</li>)}</ul>}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ol>
      ) : (
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <TextInput value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Template name" />
            <TextInput value={draft.description || ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="Description" />
          </div>
          {draft.milestones.map((m, i) => (
            <MilestoneEditor key={i} m={m} n={i + 1} onChange={(x) => setM(i, x)} onUp={() => moveM(i, -1)} onDown={() => moveM(i, 1)} onRemove={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, k) => k !== i) })} />
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            <Button icon="plus" onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, blankMilestone(draft.milestones.length + 1)] })}>Add milestone</Button>
            <div className="flex gap-2">
              <Button variant="danger" icon="trash" onClick={() => window.confirm('Delete this template? Existing projects keep their milestones.') && db.remove('milestone_templates', t.id)}>Delete template</Button>
              <Button variant="primary" onClick={save}>Save template</Button>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function MilestoneEditor({ m, n, onChange, onUp, onDown, onRemove }: { m: TemplateMilestone; n: number; onChange: (m: TemplateMilestone) => void; onUp: () => void; onDown: () => void; onRemove: () => void }) {
  const statuses = m.statuses || [];
  const cps = m.checkpoints || [];
  const setS = (k: number, patch: Partial<FlowStatus>) => onChange({ ...m, statuses: statuses.map((s, j) => (j === k ? { ...s, ...patch, key: patch.label ? key(patch.label).replace(/-/g, '_') : s.key } : s)) });
  const setC = (k: number, patch: Partial<TemplateCheckpoint>) => onChange({ ...m, checkpoints: cps.map((c, j) => (j === k ? { ...c, ...patch } : c)) });
  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-4">
      <div className="flex gap-2 items-center">
        <span className="text-gray-400 w-6 text-right">{n}.</span>
        <TextInput className="flex-1 min-w-0" value={m.name} onChange={(e) => onChange({ ...m, name: e.target.value, key: key(e.target.value) })} />
        <IconButton icon="arrowUp" title="Move up" onClick={onUp} />
        <IconButton icon="arrowDown" title="Move down" onClick={onDown} />
        <IconButton icon="trash" title="Remove milestone" onClick={onRemove} />
      </div>
      <div className="pl-8 space-y-4">
        <TextInput className="w-full" value={m.description || ''} onChange={(e) => onChange({ ...m, description: e.target.value })} placeholder="What this milestone is for (optional)" />

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-sm font-medium text-gray-700">Status flow</span>
            <div className="flex gap-1.5">
              <Button className="h-8 text-sm" onClick={() => onChange({ ...m, statuses: GRANT_FLOW })}>Use grant flow</Button>
              <Button className="h-8 text-sm" onClick={() => onChange({ ...m, statuses: FALLBACK_FLOW })}>Use simple flow</Button>
            </div>
          </div>
          <ol className="space-y-1.5">
            {statuses.map((s, k) => (
              <li key={k} className="flex flex-wrap gap-2 items-center">
                <span className="text-xs text-gray-400 w-4 tabular-nums">{k + 1}</span>
                <TextInput className="flex-1 min-w-[160px] h-9 text-sm" value={s.label} onChange={(e) => setS(k, { label: e.target.value })} />
                <select value={s.kind} onChange={(e) => setS(k, { kind: e.target.value as FlowStatus['kind'] })} className="border border-gray-200 rounded-lg h-9 px-2 text-sm bg-white" aria-label="Status type">
                  {KINDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
                <IconButton icon="x" title="Remove status" onClick={() => onChange({ ...m, statuses: statuses.filter((_, j) => j !== k) })} />
              </li>
            ))}
          </ol>
          <button type="button" className="text-sm text-brand-700 mt-1.5 inline-flex items-center gap-1" onClick={() => onChange({ ...m, statuses: [...statuses, { key: `status_${statuses.length + 1}`, label: 'New status', kind: 'active' }] })}><Icon name="plus" size={14} />Add status</button>
          <p className="text-xs text-gray-500 mt-1">"Lost / dropped" puts a red dot on the milestones after this one. "Done / won" counts the milestone as complete.</p>
        </div>

        <div>
          <div className="text-sm font-medium text-gray-700 mb-2">Checkpoints <span className="font-normal text-gray-500">· each is a section of the milestone page; sub-tasks are its linear steps. Up to 4 keeps it simple.</span></div>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {cps.map((c, k) => (
              <div key={k} className="rounded-xl border border-gray-200 p-3 space-y-2 min-w-0">
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-gray-400 tabular-nums">{k + 1}.</span>
                  <TextInput className="flex-1 min-w-0 h-9 text-sm" value={c.title} onChange={(e) => setC(k, { title: e.target.value, key: key(e.target.value) })} />
                  <IconButton icon="trash" title="Remove checkpoint" onClick={() => onChange({ ...m, checkpoints: cps.filter((_, j) => j !== k) })} />
                </div>
                {k > 0 && <label className="text-xs text-gray-600 inline-flex items-center gap-2"><input type="checkbox" checked={!!c.parallel} onChange={(e) => setC(k, { parallel: e.target.checked })} />Runs in parallel with the previous one</label>}
                <TextArea rows={Math.max(2, c.subtasks.length + 1)} className="text-sm" placeholder={'Sub-tasks, one per line'} value={c.subtasks.map((x) => x.title).join('\n')} onChange={(e) => setC(k, { subtasks: e.target.value.split('\n').map((x, j) => ({ key: key(x) || `step-${j}`, title: x })) })} onBlur={() => setC(k, { subtasks: c.subtasks.filter((x) => x.title.trim()).map((x) => ({ ...x, title: x.title.trim() })) })} />
              </div>
            ))}
            <button type="button" onClick={() => onChange({ ...m, checkpoints: [...cps, { key: `checkpoint-${cps.length + 1}`, title: `Checkpoint ${cps.length + 1}`, subtasks: [] }] })} className="rounded-xl border border-dashed border-gray-300 p-3 text-sm text-gray-500 hover:border-brand-300 hover:text-brand-700 min-h-[100px] inline-flex items-center justify-center gap-1.5">
              <Icon name="plus" size={15} />Add checkpoint
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
