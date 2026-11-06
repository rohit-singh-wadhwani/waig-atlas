import React, { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Empty, IconButton, TextArea, TextInput } from '../components/ui';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db, uid } from '../lib/store';
import type { MilestoneTemplate, TemplateMilestone } from '../lib/types';

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export default function TemplatesPage() {
  const templates = useData(() => db.list<MilestoneTemplate>('milestone_templates'), [], []);
  const [openId, setOpenId] = useState<string | null>(null);
  const add = async () => {
    const t: MilestoneTemplate = { id: uid('tpl'), name: 'New template', description: '', milestones: [{ key: 'milestone-1', name: 'Milestone 1', sections: [{ key: 'overview', title: 'Overview' }] }] };
    await db.upsert('milestone_templates', t as any);
    setOpenId(t.id);
  };
  return (
    <>
      <PageHeader title="Milestone Templates" subtitle="The milestone and section structure new projects start from. Each project can still change its own." actions={<Button variant="primary" icon="plus" onClick={add}>New template</Button>} />
      <div className="space-y-6">
        {templates.data.map((t) => (
          <TemplateCard key={t.id} t={t} open={openId === t.id} onToggle={() => setOpenId(openId === t.id ? null : t.id)} />
        ))}
        {!templates.loading && !templates.data.length && <Card><Empty icon="layers" title="No templates yet" /></Card>}
      </div>
    </>
  );
}

function TemplateCard({ t, open, onToggle }: { t: MilestoneTemplate; open: boolean; onToggle: () => void }) {
  const [draft, setDraft] = useState<MilestoneTemplate>(t);
  React.useEffect(() => setDraft(t), [t]);
  const setM = (i: number, m: TemplateMilestone) => setDraft({ ...draft, milestones: draft.milestones.map((x, k) => (k === i ? m : x)) });
  const moveM = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= draft.milestones.length) return;
    const ms = [...draft.milestones];
    [ms[i], ms[j]] = [ms[j], ms[i]];
    setDraft({ ...draft, milestones: ms });
  };
  const save = async () => {
    await db.upsert('milestone_templates', draft as any);
    onToggle();
  };
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
          {t.milestones.map((m, i) => (
            <li key={m.key + i} className="border border-gray-200 rounded-xl p-4">
              <div className="font-medium text-gray-900">{i + 1}. {m.name}</div>
              {m.stages?.length ? <div className="text-xs text-brand-700 mt-1">Checkpoints: {m.stages.map((s) => s.label).join(' → ')}</div> : null}
              <ul className="mt-2 text-sm text-gray-600 space-y-0.5">
                {m.sections.map((s) => <li key={s.key} className="flex gap-1.5"><Icon name="chevronRight" size={14} className="mt-1 text-gray-400" />{s.title}</li>)}
              </ul>
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
            <div key={i} className="border border-gray-200 rounded-xl p-4">
              <div className="flex gap-2 items-center">
                <span className="text-gray-400 w-6 text-right">{i + 1}.</span>
                <TextInput className="flex-1" value={m.name} onChange={(e) => setM(i, { ...m, name: e.target.value, key: key(e.target.value) })} />
                <IconButton icon="arrowUp" title="Move up" onClick={() => moveM(i, -1)} />
                <IconButton icon="arrowDown" title="Move down" onClick={() => moveM(i, 1)} />
                <IconButton icon="trash" title="Remove milestone" onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, k) => k !== i) })} />
              </div>
              <div className="grid md:grid-cols-2 gap-3 mt-3 pl-8">
                <label className="block text-sm">
                  <span className="text-gray-600">Sections (one per line)</span>
                  <TextArea rows={Math.max(3, m.sections.length)} value={m.sections.map((s) => s.title).join('\n')} onChange={(e) => setM(i, { ...m, sections: e.target.value.split('\n').filter((x) => x.trim()).map((x) => ({ key: key(x), title: x.trim() })) })} />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600">Checkpoints (optional, one per line)</span>
                  <TextArea rows={3} value={(m.stages || []).map((s) => s.label).join('\n')} onChange={(e) => setM(i, { ...m, stages: e.target.value.split('\n').filter((x) => x.trim()).map((x) => ({ key: key(x), label: x.trim() })) })} placeholder={'Submission\nReview 1\nReview 2\nGrant'} />
                </label>
              </div>
            </div>
          ))}
          <div className="flex justify-between">
            <Button icon="plus" onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, { key: `milestone-${draft.milestones.length + 1}`, name: `Milestone ${draft.milestones.length + 1}`, sections: [] }] })}>Add milestone</Button>
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
