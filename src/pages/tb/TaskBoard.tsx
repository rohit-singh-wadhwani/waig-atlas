import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, CardHeader, Empty, Field, Modal, Segmented, Select, TextInput, cx } from '../../components/ui';
import { useMe } from '../../components/Layout';
import { uid } from '../../lib/store';
import { peopleOptions, personName, usePeople } from '../../lib/team';
import { tbSave, TbTask } from '../../lib/tb';
import type { TbData } from './TbPage';

type Scope = 'mine' | 'open' | 'overdue' | 'done';

export default function TaskBoard({ data }: { data: TbData }) {
  const me = useMe();
  const people = usePeople();
  const { tasks, campaigns, playbooks, dist } = data;
  const [scope, setScope] = useState<Scope>('open');
  const [role, setRole] = useState('');
  const [adding, setAdding] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const roles = useMemo(() => Array.from(new Set([...playbooks.data.flatMap((p) => p.steps.map((s) => s.role)), ...tasks.data.map((t) => t.role || '')].filter(Boolean))).sort(), [playbooks.data, tasks.data]);
  const list = tasks.data
    .filter((t) => (scope === 'done' ? t.status === 'done' : t.status !== 'done'))
    .filter((t) => scope !== 'mine' || t.assignee === me.email)
    .filter((t) => scope !== 'overdue' || (t.due && t.due < today))
    .filter((t) => !role || t.role === role)
    .sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'));
  const count = (s: Scope) => tasks.data.filter((t) => (s === 'done' ? t.status === 'done' : t.status !== 'done') && (s !== 'mine' || t.assignee === me.email) && (s !== 'overdue' || (t.due && t.due < today))).length;
  const camp = (id?: string | null) => campaigns.data.find((c) => c.id === id)?.name;
  const set = (t: TbTask, patch: Partial<TbTask>) => tbSave('tb_tasks', { ...t, ...patch, updated_at: new Date().toISOString() });

  return (
    <Card pad={false}>
      <div className="p-6 pb-3">
        <CardHeader
          title="Tasks"
          subtitle="Created from playbooks when a campaign is planned, and assigned by role. Set roles and districts on the People page."
          right={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add task</Button>}
        />
        <div className="flex flex-wrap gap-3 items-center">
          <Segmented<Scope> size="sm" value={scope} onChange={setScope} options={[{ value: 'open', label: `Open (${count('open')})` }, { value: 'mine', label: `Mine (${count('mine')})` }, { value: 'overdue', label: `Overdue (${count('overdue')})` }, { value: 'done', label: `Done (${count('done')})` }]} />
          <Select className="w-[240px]" value={role} onChange={setRole} placeholder="All roles" options={roles.map((r) => ({ value: r, label: r }))} />
        </div>
      </div>
      {!list.length ? (
        <div className="p-6 pt-0"><Empty icon="checkCircle" title="Nothing here">Tasks appear when you plan a campaign from the map or the Campaigns tab.</Empty></div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="px-6 py-2.5 font-medium">Task</th><th className="px-3 py-2.5 font-medium">Role</th><th className="px-3 py-2.5 font-medium">Assignee</th><th className="px-3 py-2.5 font-medium">Due</th><th className="px-3 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((t) => (
                <tr key={t.id} className="border-b border-gray-100 align-top">
                  <td className="px-6 py-3 min-w-[300px]">
                    <div className="text-gray-900">{t.title}</div>
                    <div className="text-sm text-gray-500">{[camp(t.campaign_id), t.district_name].filter(Boolean).join(' · ')}</div>
                    {t.detail && <div className="text-xs text-gray-500 mt-0.5">{t.detail}</div>}
                  </td>
                  <td className="px-3 py-3 text-sm min-w-[160px]">{t.role || '—'}</td>
                  <td className="px-3 py-3 min-w-[190px]"><Select className="[&_select]:h-9 [&_select]:text-sm" value={t.assignee || ''} onChange={(v) => set(t, { assignee: v || null })} placeholder="Unassigned" options={peopleOptions(people, t.assignee)} /></td>
                  <td className={cx('px-3 py-3 text-sm whitespace-nowrap', t.status !== 'done' && t.due && t.due < today && 'text-red-600 font-medium')}>
                    <input type="date" className="bg-transparent" value={t.due || ''} onChange={(e) => set(t, { due: e.target.value || null })} />
                    {t.status !== 'done' && t.due && t.due < today && <Badge className="bg-red-50 text-red-700 ml-1">overdue</Badge>}
                  </td>
                  <td className="px-3 py-3 min-w-[140px]"><Select className="[&_select]:h-9 [&_select]:text-sm" value={t.status} onChange={(v) => set(t, { status: v as any })} options={[{ value: 'todo', label: 'To do' }, { value: 'doing', label: 'In progress' }, { value: 'blocked', label: 'Blocked' }, { value: 'done', label: 'Done' }]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddTask roles={roles} campaigns={campaigns.data.map((c) => ({ value: c.id, label: c.name }))} districts={dist.data.list.map((d) => ({ value: d.id, label: d.name }))} me={me.email} people={peopleOptions(people)} onClose={() => setAdding(false)} />}
    </Card>
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
        <Field label="Assignee"><Select value={t.assignee || ''} onChange={(v) => setT({ ...t, assignee: v || null })} placeholder="Unassigned" options={people} /></Field>
        <Field label="Campaign"><Select value={t.campaign_id || ''} onChange={(v) => setT({ ...t, campaign_id: v || null })} placeholder="None" options={campaigns} /></Field>
        <Field label="District"><Select value={t.district_id || ''} onChange={(v) => setT({ ...t, district_id: v || null })} placeholder="None" options={districts} /></Field>
        <Field label="Due"><TextInput type="date" className="w-full" value={t.due || ''} onChange={(e) => setT({ ...t, due: e.target.value })} /></Field>
      </div>
      <datalist id="tb-roles">{roles.map((r) => <option key={r} value={r} />)}</datalist>
    </Modal>
  );
}
