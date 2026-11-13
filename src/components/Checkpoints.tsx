import React, { useEffect, useRef, useState } from 'react';
import { Select, cx } from './ui';
import Icon from './Icon';
import { db, uid } from '../lib/store';
import { checkpointDone, checkpointProgress, KIND_BADGE, statusOf } from '../lib/projects';
import { peopleOptions, usePeople } from '../lib/team';
import type { CheckpointBase, CheckpointTask, ProjectMilestone } from '../lib/types';

export function StatusBadge({ m }: { m: ProjectMilestone }) {
  const s = statusOf(m);
  return <span className={cx('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', KIND_BADGE[s.kind])}>{s.label}</span>;
}

const today = () => new Date().toISOString().slice(0, 10);

type Row = CheckpointBase & Record<string, any>;

/**
 * Checkpoint builder: a horizontal row of cards. Each card has a title, target and completion dates,
 * an owner, a note on what has to be done, and an optional list of tasks.
 * Used for project milestones (milestone_checkpoints) and grants (grant_checkpoints).
 */
export default function Checkpoints({ items, table, base, progress, onProgress, suggestions = [], hint }: {
  items: Row[];
  table: 'milestone_checkpoints' | 'grant_checkpoints';
  base: Record<string, string>; // e.g. { milestone_id, project_id } or { grant_id }
  progress?: number;
  onProgress?: (p: number) => void;
  suggestions?: string[];
  hint?: string;
}) {
  const people = usePeople();
  const [list, setList] = useState<Row[]>(() => [...items].sort((a, b) => a.position - b.position));
  const pending = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);
  const incoming = JSON.stringify([...items].sort((a, b) => a.position - b.position));
  useEffect(() => {
    if (!pending.current) setList(JSON.parse(incoming));
  }, [incoming]);

  const persist = async (next: Row[], changed: Row[], removed?: string) => {
    setList(next);
    pending.current++;
    try {
      if (removed) await db.remove(table, removed);
      for (const c of changed) await db.upsert(table, { ...c, updated_at: new Date().toISOString() } as any);
      const p = checkpointProgress(next);
      if (onProgress && p !== null && p !== progress) onProgress(p);
    } finally {
      pending.current--;
    }
  };
  const update = (id: string, patch: Partial<Row>) => {
    const next = list.map((c) => (c.id === id ? { ...c, ...patch } : c));
    persist(next, next.filter((c) => c.id === id));
  };
  const add = (title?: string) => {
    const c: Row = { ...base, id: uid('cp'), position: list.length, title: title || `Checkpoint ${list.length + 1}`, target_date: null, completed_on: null, owner: null, notes: null, tasks: [] };
    persist([...list, c], [c]);
    setTimeout(() => scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' }), 50);
  };
  const remove = (id: string) => {
    const next = list.filter((c) => c.id !== id).map((c, i) => ({ ...c, position: i }));
    persist(next, next.filter((c, i) => list.find((x) => x.id === c.id)?.position !== i), id);
  };
  const move = (id: string, d: -1 | 1) => {
    const i = list.findIndex((c) => c.id === id);
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    const renum = next.map((c, k) => ({ ...c, position: k }));
    persist(renum, [renum[i], renum[j]]);
  };

  const complete = list.filter((c) => c.completed_on).length;
  const pct = checkpointProgress(list);

  return (
    <div>
      <div className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-[17px] font-semibold text-gray-900">Checkpoints</h3>
          <button type="button" onClick={() => add()} className="inline-flex items-center gap-1.5 h-10 px-4 rounded-xl border border-gray-200 bg-white text-[15px] text-gray-800 hover:bg-gray-50">
            <Icon name="plus" size={16} />Add checkpoint
          </button>
        </div>
        <p className="text-sm text-gray-500 mt-1">{list.length ? `${complete} of ${list.length} complete · ${pct}%` : hint || 'Break this into checkpoints with dates, an owner and what needs doing.'}</p>
      </div>

      {!list.length && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-gray-500">Quick add:</span>
          {suggestions.map((t) => (
            <button key={t} type="button" onClick={() => add(t)} className="rounded-lg border border-dashed border-gray-300 px-3 py-1.5 text-gray-700 hover:border-brand-300 hover:text-brand-700">+ {t}</button>
          ))}
          <button type="button" onClick={async () => { const rows = suggestions.map((t, i) => ({ ...base, id: uid('cp'), position: i, title: t, target_date: null, completed_on: null, owner: null, notes: null, tasks: [] } as Row)); await persist(rows, rows); }} className="text-brand-700 hover:underline px-1">Add all</button>
        </div>
      )}

      {list.length > 0 && (
        <div ref={scroller} className="flex gap-4 overflow-x-auto pb-3 -mx-1 px-1 snap-x snap-mandatory">
          {list.map((c, i) => (
            <CheckpointCard key={c.id} c={c} n={i + 1} first={i === 0} last={i === list.length - 1} people={people} onChange={(patch) => update(c.id, patch)} onMove={(d) => move(c.id, d)} onRemove={() => window.confirm(`Remove "${c.title}"?`) && remove(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckpointCard({ c, n, first, last, people, onChange, onMove, onRemove }: {
  c: Row; n: number; first: boolean; last: boolean; people: any[]; onChange: (p: Partial<Row>) => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const [title, setTitle] = useState(c.title);
  const [notes, setNotes] = useState(c.notes || '');
  const [task, setTask] = useState('');
  useEffect(() => setTitle(c.title), [c.title]);
  useEffect(() => setNotes(c.notes || ''), [c.notes]);
  const done = !!c.completed_on;
  const late = !done && !!c.target_date && c.target_date < today();
  const frac = checkpointDone(c);

  const setTasks = (tasks: CheckpointTask[]) => {
    const allDone = tasks.length > 0 && tasks.every((t) => t.done);
    // ticking the last task completes the checkpoint; unticking one reopens it
    onChange({ tasks, completed_on: allDone ? c.completed_on || today() : tasks.length && c.completed_on && !allDone ? null : c.completed_on });
  };
  const addTask = () => {
    if (!task.trim()) return;
    setTasks([...c.tasks, { id: uid('t'), title: task.trim(), done: false }]);
    setTask('');
  };

  return (
    <section className={cx('snap-start shrink-0 w-[320px] rounded-2xl border bg-white flex flex-col', done ? 'border-green-300' : late ? 'border-red-200' : 'border-gray-200')} aria-label={`Checkpoint ${n}: ${c.title}`}>
      <header className={cx('px-4 pt-4 pb-3 rounded-t-2xl', done ? 'bg-green-50' : 'bg-gray-50/70')}>
        <div className="flex items-center gap-2">
          <span className={cx('w-6 h-6 rounded-full grid place-items-center text-xs font-semibold shrink-0', done ? 'bg-green-600 text-white' : 'bg-white border border-gray-300 text-gray-600')}>{done ? '✓' : n}</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title.trim() && title !== c.title && onChange({ title: title.trim() })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="flex-1 min-w-0 font-semibold text-gray-900 bg-transparent rounded-md px-1 py-0.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-200"
            aria-label="Checkpoint title"
          />
          <div className="flex items-center shrink-0 text-gray-400">
            <button type="button" disabled={first} onClick={() => onMove(-1)} className="p-1 rounded hover:text-gray-700 disabled:opacity-30" title="Move left"><Icon name="chevronsLeft" size={15} /></button>
            <button type="button" disabled={last} onClick={() => onMove(1)} className="p-1 rounded hover:text-gray-700 disabled:opacity-30" title="Move right"><Icon name="chevronsRight" size={15} /></button>
            <button type="button" onClick={onRemove} className="p-1 rounded hover:text-red-600" title="Remove checkpoint"><Icon name="trash" size={15} /></button>
          </div>
        </div>
        <div className="h-1.5 rounded-full bg-white mt-3 overflow-hidden border border-gray-100"><div className={cx('h-full', done ? 'bg-green-600' : 'bg-brand-500')} style={{ width: `${Math.round(frac * 100)}%` }} /></div>
      </header>

      <div className="px-4 py-3 space-y-3 flex-1">
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Target date
            <input type="date" value={c.target_date || ''} onChange={(e) => onChange({ target_date: e.target.value || null })} className={cx('mt-1 w-full border rounded-lg px-2 h-9 text-sm bg-white', late ? 'border-red-300 text-red-700' : 'border-gray-200 text-gray-900')} />
          </label>
          <label className="text-xs text-gray-500">
            Completed on
            <input type="date" value={c.completed_on || ''} onChange={(e) => onChange({ completed_on: e.target.value || null })} className={cx('mt-1 w-full border rounded-lg px-2 h-9 text-sm bg-white', done ? 'border-green-300 text-green-800' : 'border-gray-200 text-gray-900')} />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500 flex-1 min-w-0">
            Owner
            <Select className="mt-1 [&_select]:h-9 [&_select]:text-sm [&_select]:pl-2" value={c.owner || ''} onChange={(v) => onChange({ owner: v || null })} placeholder="—" options={peopleOptions(people, c.owner)} />
          </label>
          {!done && (
            <button type="button" onClick={() => onChange({ completed_on: today() })} className="self-end h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-700 hover:border-green-400 hover:text-green-700 whitespace-nowrap">Mark done</button>
          )}
        </div>

        <label className="block text-xs text-gray-500">
          What needs to be done
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => notes !== (c.notes || '') && onChange({ notes: notes.trim() || null })}
            rows={Math.min(6, Math.max(2, notes.split('\n').length))}
            placeholder="Notes, scope, links…"
            className="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm text-gray-900 resize-y focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>

        <div>
          <div className="text-xs text-gray-500 mb-1">Tasks{c.tasks.length ? ` · ${c.tasks.filter((t) => t.done).length}/${c.tasks.length}` : ''}</div>
          <ul className="space-y-1">
            {c.tasks.map((t) => (
              <TaskRow key={t.id} t={t} onChange={(patch) => setTasks(c.tasks.map((x) => (x.id === t.id ? { ...x, ...patch } : x)))} onRemove={() => setTasks(c.tasks.filter((x) => x.id !== t.id))} />
            ))}
          </ul>
          <div className="flex items-center gap-2 mt-1.5">
            <input value={task} onChange={(e) => setTask(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTask()} placeholder="Add a task and press Enter" className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 h-9 text-sm focus:outline-none focus:ring-2 focus:ring-brand-200" />
            <button type="button" onClick={addTask} disabled={!task.trim()} className="h-9 w-9 grid place-items-center rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40" title="Add task"><Icon name="plus" size={15} /></button>
          </div>
        </div>
      </div>
    </section>
  );
}

const URL_RE = /(https?:\/\/[^\s]+)/g;

/** Short label for a pasted link: Linear issues show their key and title, other links their site and last path part. */
function linkLabel(url: string) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (u.hostname.endsWith('linear.app')) {
      const i = parts.indexOf('issue');
      if (i >= 0 && parts[i + 1]) return `${parts[i + 1]}${parts[i + 2] ? ' · ' + decodeURIComponent(parts[i + 2]).replace(/-/g, ' ') : ''}`;
      const j = parts.findIndex((p) => p === 'project' || p === 'document');
      if (j >= 0 && parts[j + 1]) return `Linear ${parts[j]} · ${decodeURIComponent(parts[j + 1]).replace(/-[0-9a-f]{8,}$/i, '').replace(/-/g, ' ')}`;
    }
    const host = u.hostname.replace(/^www\./, '');
    const last = parts[parts.length - 1];
    return last ? `${host} · ${decodeURIComponent(last).slice(0, 40)}` : host;
  } catch {
    return url;
  }
}

/** Task text with links turned into clickable links. */
function TaskText({ text }: { text: string }) {
  const bits = text.split(URL_RE);
  return (
    <>
      {bits.map((b, i) =>
        /^https?:\/\//.test(b) ? (
          <a key={i} href={b} target="_blank" rel="noreferrer" title={b} onClick={(e) => e.stopPropagation()} className="text-blue-700 underline decoration-blue-300 underline-offset-2 hover:decoration-blue-700 [overflow-wrap:anywhere]">
            {linkLabel(b)}
          </a>
        ) : (
          <span key={i}>{b}</span>
        ),
      )}
    </>
  );
}

function TaskRow({ t, onChange, onRemove }: { t: CheckpointTask; onChange: (p: Partial<CheckpointTask>) => void; onRemove: () => void }) {
  const [v, setV] = useState(t.title);
  const [editing, setEditing] = useState(false);
  useEffect(() => setV(t.title), [t.title]);
  const commit = () => {
    setEditing(false);
    if (v.trim() && v !== t.title) onChange({ title: v.trim() });
    else setV(t.title);
  };
  return (
    <li className="group flex items-start gap-2">
      <input type="checkbox" checked={t.done} onChange={(e) => onChange({ done: e.target.checked })} aria-label={`Done: ${t.title}`} className="shrink-0 mt-1.5" />
      {editing ? (
        <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(t.title); setEditing(false); } }} className="flex-1 min-w-0 text-sm bg-white rounded px-1 py-0.5 ring-2 ring-brand-200 focus:outline-none text-gray-800" aria-label="Edit task" />
      ) : (
        <div role="button" tabIndex={0} onClick={() => setEditing(true)} onKeyDown={(e) => e.key === 'Enter' && setEditing(true)} title="Click to edit" className={cx('flex-1 min-w-0 text-sm rounded px-1 py-0.5 cursor-text hover:bg-gray-50 [overflow-wrap:anywhere]', t.done ? 'line-through text-gray-400' : 'text-gray-800')}>
          <TaskText text={t.title} />
        </div>
      )}
      <button type="button" onClick={onRemove} className="mt-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100" title="Remove task"><Icon name="x" size={14} /></button>
    </li>
  );
}
