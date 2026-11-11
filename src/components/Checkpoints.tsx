import React, { useState } from 'react';
import { Button, Select, TextInput, cx } from './ui';
import Icon from './Icon';
import { checkpointProgress, flowOf, KIND_BADGE, statusOf } from '../lib/projects';
import { peopleOptions, usePeople } from '../lib/team';
import type { Checkpoint, FlowStatus, ProjectMilestone, Subtask } from '../lib/types';

const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.random().toString(36).slice(2, 6);
const now = () => new Date().toISOString();

/** Status flow for a milestone: a linear path, with won/lost (or done) at the end and blocked on the side. */
export function StatusFlow({ m, onChange }: { m: ProjectMilestone; onChange: (key: string) => void }) {
  const flow = flowOf(m);
  const cur = statusOf(m);
  const linear = flow.filter((s) => s.kind === 'todo' || s.kind === 'active');
  const ends = flow.filter((s) => s.kind === 'done' || s.kind === 'lost');
  const side = flow.filter((s) => s.kind === 'blocked');
  const curIdx = linear.findIndex((s) => s.key === cur.key);
  const reachedEnd = cur.kind === 'done' || cur.kind === 'lost';
  const chip = (s: FlowStatus, i: number, passed: boolean) => (
    <button
      key={s.key}
      type="button"
      onClick={() => onChange(s.key)}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
        s.key === cur.key
          ? s.kind === 'lost' ? 'bg-red-600 border-red-600 text-white' : s.kind === 'done' ? 'bg-green-600 border-green-600 text-white' : s.kind === 'blocked' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-brand-600 border-brand-600 text-white'
          : passed ? 'bg-brand-50 border-brand-200 text-brand-800' : 'bg-white border-gray-200 text-gray-600 hover:border-brand-300'
      )}
      title={`Set status: ${s.label}`}
    >
      {passed && s.key !== cur.key && <Icon name="check" size={13} />}
      {s.label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {linear.map((s, i) => (
        <React.Fragment key={s.key}>
          {chip(s, i, reachedEnd || (curIdx >= 0 && i < curIdx))}
          {i < linear.length - 1 && <span className="text-gray-300">→</span>}
        </React.Fragment>
      ))}
      {ends.length > 0 && <span className="text-gray-300">→</span>}
      {ends.map((s, i) => (
        <React.Fragment key={s.key}>
          {chip(s, i, false)}
          {i < ends.length - 1 && <span className="text-xs text-gray-400">or</span>}
        </React.Fragment>
      ))}
      {side.length > 0 && <span className="w-px h-6 bg-gray-200 mx-1" />}
      {side.map((s, i) => chip(s, i, false))}
    </div>
  );
}

export function StatusBadge({ m }: { m: ProjectMilestone }) {
  const s = statusOf(m);
  return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', KIND_BADGE[s.kind])}>{s.label}</span>;
}

const cpDone = (c: Checkpoint) => (c.subtasks.length ? c.subtasks.every((s) => s.done_at) : !!c.done_at);
const cpStarted = (c: Checkpoint) => c.subtasks.some((s) => s.done_at);

/** Checkpoints (with linear sub-tasks) under a milestone. Parallel checkpoints run alongside the one before. */
export default function Checkpoints({ m, onSave }: { m: ProjectMilestone; onSave: (patch: Partial<ProjectMilestone>) => Promise<any> | void }) {
  const people = usePeople();
  // local copy so quick successive clicks build on each other instead of on the last saved version
  const [cps, setCps] = useState<Checkpoint[]>(m.checkpoints || []);
  const pending = React.useRef(0);
  const incoming = JSON.stringify(m.checkpoints || []);
  React.useEffect(() => {
    if (!pending.current) setCps(JSON.parse(incoming));
  }, [incoming]);
  const [newCp, setNewCp] = useState('');
  const commit = async (next: Checkpoint[]) => {
    setCps(next);
    pending.current++;
    try {
      const p = checkpointProgress(next);
      await onSave({ checkpoints: next, progress: p ?? m.progress });
    } finally {
      pending.current--;
    }
  };
  const setCp = (i: number, patch: Partial<Checkpoint>) => commit(cps.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const setSub = (i: number, j: number, patch: Partial<Subtask>) => {
    const c = cps[i];
    const subtasks = c.subtasks.map((s, k) => (k === j ? { ...s, ...patch } : s));
    setCp(i, { subtasks, done_at: subtasks.length && subtasks.every((s) => s.done_at) ? c.done_at || now() : null });
  };
  const toggleCp = (i: number) => {
    const c = cps[i];
    const done = !cpDone(c);
    setCp(i, { done_at: done ? now() : null, subtasks: c.subtasks.map((s) => ({ ...s, done_at: done ? s.done_at || now() : null })) });
  };
  const addCp = () => {
    if (!newCp.trim()) return;
    commit([...cps, { key: key(newCp), title: newCp.trim(), parallel: false, target: null, done_at: null, owner: null, subtasks: [] }]);
    setNewCp('');
  };

  // group consecutive parallel checkpoints for the rail
  const groups: number[][] = [];
  cps.forEach((c, i) => (c.parallel && groups.length ? groups[groups.length - 1].push(i) : groups.push([i])));
  const total = cps.reduce((n, c) => n + (c.subtasks.length || 1), 0);
  const done = cps.reduce((n, c) => n + (c.subtasks.length ? c.subtasks.filter((s) => s.done_at).length : c.done_at ? 1 : 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <div className="text-[13px] font-medium tracking-wider uppercase text-gray-500">Checkpoints</div>
        <div className="text-sm text-gray-500 tabular-nums">{done}/{total} done · {total ? Math.round((done / total) * 100) : 0}%</div>
      </div>

      {cps.length > 0 && (
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2 mb-4">
          {groups.map((g, gi) => (
            <React.Fragment key={gi}>
              <div className={cx('flex flex-col gap-1.5 min-w-[150px] flex-1', g.length > 1 && 'rounded-xl border border-dashed border-brand-200 p-1.5')}>
                {g.length > 1 && <div className="text-[11px] text-brand-700 px-1">In parallel</div>}
                {g.map((i) => {
                  const c = cps[i];
                  const d = cpDone(c), s = cpStarted(c);
                  return (
                    <a key={c.key} href={`#cp-${c.key}`} onClick={(e) => { e.preventDefault(); document.getElementById(`cp-${c.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }} className={cx('flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm border', d ? 'bg-green-50 border-green-200 text-green-900' : s ? 'bg-brand-50 border-brand-200 text-brand-900' : 'bg-white border-gray-200 text-gray-700')}>
                      <span className={cx('w-5 h-5 rounded-full grid place-items-center text-[11px] font-semibold shrink-0', d ? 'bg-green-600 text-white' : s ? 'bg-brand-600 text-white' : 'bg-gray-100 text-gray-600')}>{d ? '✓' : i + 1}</span>
                      <span className="truncate">{c.title}</span>
                    </a>
                  );
                })}
              </div>
              {gi < groups.length - 1 && <div className="self-center text-gray-300 shrink-0">→</div>}
            </React.Fragment>
          ))}
        </div>
      )}

      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
        {cps.map((c, i) => (
          <CheckpointCard
            key={c.key}
            c={c}
            index={i}
            people={people}
            onToggle={() => toggleCp(i)}
            onPatch={(patch) => setCp(i, patch)}
            onSub={(j, patch) => setSub(i, j, patch)}
            onAddSub={(title) => setCp(i, { subtasks: [...c.subtasks, { key: key(title), title, done_at: null, owner: null, due: null }], done_at: null })}
            onRemoveSub={(j) => setCp(i, { subtasks: c.subtasks.filter((_, k) => k !== j) })}
            onRemove={() => window.confirm(`Remove checkpoint "${c.title}" and its sub-tasks?`) && commit(cps.filter((_, k) => k !== i))}
          />
        ))}
        <div className="rounded-xl border border-dashed border-gray-300 p-4 flex flex-col gap-2 justify-center min-h-[120px]">
          <div className="text-sm text-gray-500">Add a checkpoint</div>
          <div className="flex gap-2">
            <TextInput className="flex-1 min-w-0 h-10" placeholder="e.g. Ethics approval" value={newCp} onChange={(e) => setNewCp(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCp()} />
            <Button icon="plus" onClick={addCp} disabled={!newCp.trim()}>Add</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CheckpointCard({ c, index, people, onToggle, onPatch, onSub, onAddSub, onRemoveSub, onRemove }: {
  c: Checkpoint; index: number; people: any[]; onToggle: () => void; onPatch: (p: Partial<Checkpoint>) => void; onSub: (j: number, p: Partial<Subtask>) => void;
  onAddSub: (t: string) => void; onRemoveSub: (j: number) => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(c.title);
  const [sub, setSub] = useState('');
  React.useEffect(() => setTitle(c.title), [c.title]);
  const d = cpDone(c);
  const today = new Date().toISOString().slice(0, 10);
  const late = !d && c.target && c.target < today;
  return (
    <div id={`cp-${c.key}`} className={cx('rounded-xl border p-4 flex flex-col gap-3 min-w-0', d ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white')}>
      <div className="flex items-start gap-2">
        <button type="button" onClick={onToggle} title={d ? 'Mark not done' : 'Mark done'} className={cx('mt-1 w-6 h-6 rounded-full border-2 grid place-items-center shrink-0', d ? 'bg-green-600 border-green-600 text-white' : 'border-gray-300 text-transparent hover:border-green-500')}>
          <Icon name="check" size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title !== c.title && onPatch({ title: title.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className="w-full font-medium text-gray-900 bg-transparent rounded px-1 -mx-1 focus:outline-none focus:ring-2 focus:ring-brand-200" aria-label="Checkpoint title" />
          <div className="text-xs text-gray-500 px-0">{index + 1}{c.parallel ? ' · runs in parallel' : ''}{d && c.done_at ? ` · done ${c.done_at.slice(0, 10)}` : ''}</div>
        </div>
        <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-500 mt-1" title="Remove checkpoint"><Icon name="trash" size={15} /></button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-gray-500 min-w-0">Target<input type="date" value={c.target || ''} onChange={(e) => onPatch({ target: e.target.value || null })} className={cx('mt-0.5 w-full border rounded-lg px-2 h-9 text-sm', late ? 'border-red-300 text-red-700' : 'border-gray-200 text-gray-900')} /></label>
        <label className="text-xs text-gray-500 min-w-0">Owner<Select className="mt-0.5 [&_select]:h-9 [&_select]:text-sm [&_select]:pl-2" value={c.owner || ''} onChange={(v) => onPatch({ owner: v || null })} placeholder="—" options={peopleOptions(people, c.owner)} /></label>
      </div>
      {index > 0 && (
        <label className="text-xs text-gray-600 inline-flex items-center gap-2"><input type="checkbox" checked={!!c.parallel} onChange={(e) => onPatch({ parallel: e.target.checked })} />Runs in parallel with the previous checkpoint</label>
      )}

      <ol className="space-y-1.5">
        {c.subtasks.map((s, j) => <SubRow key={s.key} s={s} n={j + 1} people={people} onPatch={(p) => onSub(j, p)} onRemove={() => onRemoveSub(j)} />)}
      </ol>
      <div className="flex gap-2">
        <TextInput className="flex-1 min-w-0 h-9 text-sm" placeholder="Add a sub-task…" value={sub} onChange={(e) => setSub(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && sub.trim()) { onAddSub(sub.trim()); setSub(''); } }} />
        <Button className="h-9" icon="plus" onClick={() => { if (sub.trim()) { onAddSub(sub.trim()); setSub(''); } }} disabled={!sub.trim()}>Add</Button>
      </div>
    </div>
  );
}

function SubRow({ s, n, people, onPatch, onRemove }: { s: Subtask; n: number; people: any[]; onPatch: (p: Partial<Subtask>) => void; onRemove: () => void }) {
  const [t, setT] = useState(s.title);
  const [more, setMore] = useState(false);
  React.useEffect(() => setT(s.title), [s.title]);
  return (
    <li className="group">
      <div className="flex items-start gap-2">
        <input type="checkbox" className="mt-1.5" checked={!!s.done_at} onChange={(e) => onPatch({ done_at: e.target.checked ? now() : null })} aria-label={`Done: ${s.title}`} />
        <span className="text-xs text-gray-400 mt-1 w-4 shrink-0 tabular-nums">{n}.</span>
        <input value={t} onChange={(e) => setT(e.target.value)} onBlur={() => t.trim() && t !== s.title && onPatch({ title: t.trim() })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} className={cx('flex-1 min-w-0 text-sm bg-transparent rounded px-1 py-0.5 focus:outline-none focus:ring-2 focus:ring-brand-200', s.done_at ? 'line-through text-gray-400' : 'text-gray-800')} aria-label="Sub-task" />
        <button type="button" onClick={() => setMore(!more)} className={cx('text-xs rounded px-1.5 py-0.5 shrink-0', s.owner || s.due ? 'text-brand-700 bg-brand-50' : 'text-gray-400 hover:text-gray-700')} title="Owner and due date">
          {s.owner ? s.owner.split('@')[0] : s.due ? s.due.slice(5) : '···'}
        </button>
        <button type="button" onClick={onRemove} className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100 shrink-0" title="Remove sub-task"><Icon name="x" size={14} /></button>
      </div>
      {more && (
        <div className="grid grid-cols-2 gap-2 pl-10 mt-1.5">
          <Select className="[&_select]:h-8 [&_select]:text-xs [&_select]:pl-2" value={s.owner || ''} onChange={(v) => onPatch({ owner: v || null })} placeholder="Owner" options={peopleOptions(people, s.owner)} />
          <input type="date" value={s.due || ''} onChange={(e) => onPatch({ due: e.target.value || null })} className="border border-gray-200 rounded-lg px-2 h-8 text-xs" />
        </div>
      )}
    </li>
  );
}
