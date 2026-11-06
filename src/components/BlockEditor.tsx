import React, { useEffect, useRef, useState } from 'react';
import Markdown from './Markdown';
import Icon from './Icon';
import { cx } from './ui';

/** Split markdown into blocks: headings, paragraphs, lists, tables and fenced code stay whole. */
export function splitBlocks(md: string): string[] {
  const lines = (md || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];
  let cur: string[] = [];
  let fence = false;
  const flush = () => {
    const b = cur.join('\n').trim();
    if (b) blocks.push(b);
    cur = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (!fence) {
        flush();
        fence = true;
        cur.push(line);
        continue;
      }
      cur.push(line);
      fence = false;
      flush();
      continue;
    }
    if (fence) {
      cur.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      flush();
      blocks.push(line.trim());
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    cur.push(line);
  }
  flush();
  return blocks;
}

const INSERTS: { label: string; md: string }[] = [
  { label: 'Text', md: 'Write here…' },
  { label: 'Heading', md: '## New section' },
  { label: 'Checklist', md: '- [ ] First item\n- [ ] Second item' },
  { label: 'Table', md: '| Item | Owner | Due |\n| --- | --- | --- |\n| | | |' },
  { label: 'Flowchart', md: '```mermaid\nflowchart LR\n  A[Start] --> B[Step] --> C[Done]\n```' },
  { label: 'Gantt', md: '```mermaid\ngantt\n  dateFormat YYYY-MM-DD\n  section Work\n  Task one :a1, 2026-11-10, 14d\n  Task two :after a1, 10d\n```' },
  { label: 'Sequence', md: '```mermaid\nsequenceDiagram\n  participant App\n  participant API\n  App->>API: request\n  API-->>App: response\n```' },
  { label: 'Link', md: '[Link title](https://)' },
];

export default function BlockEditor({ md, onSave, readOnly }: { md: string; onSave: (md: string) => Promise<void> | void; readOnly?: boolean }) {
  const [blocks, setBlocks] = useState<string[]>(() => splitBlocks(md));
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing === null) setBlocks(splitBlocks(md));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [md]);

  useEffect(() => {
    if (ta.current) {
      ta.current.focus();
      ta.current.style.height = 'auto';
      ta.current.style.height = ta.current.scrollHeight + 'px';
    }
  }, [editing]);

  const persist = async (next: string[]) => {
    setBlocks(next);
    setSaving(true);
    try {
      await onSave(next.join('\n\n'));
    } finally {
      setSaving(false);
    }
  };

  const commit = () => {
    if (editing === null) return;
    const next = [...blocks];
    const parts = splitBlocks(draft);
    next.splice(editing, 1, ...(parts.length ? parts : []));
    setEditing(null);
    if (next.join('\n\n') !== blocks.join('\n\n')) persist(next);
  };

  const insertAfter = (i: number, text: string) => {
    const next = [...blocks];
    next.splice(i + 1, 0, text);
    setBlocks(next);
    setMenu(null);
    setEditing(i + 1);
    setDraft(text);
  };

  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    const next = [...blocks];
    [next[i], next[j]] = [next[j], next[i]];
    persist(next);
  };

  const remove = (i: number) => persist(blocks.filter((_, k) => k !== i));

  if (!blocks.length && !readOnly) {
    return (
      <div className="border border-dashed border-gray-300 rounded-xl p-6 text-center text-gray-500">
        <p className="mb-3">This page is empty.</p>
        <div className="flex flex-wrap justify-center gap-2">
          {INSERTS.map((x) => (
            <button key={x.label} type="button" className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-sm hover:bg-gray-50" onClick={() => insertAfter(-1, x.md)}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      {saving && <div className="absolute -top-7 right-0 text-xs text-gray-400">Saving…</div>}
      {blocks.map((b, i) => (
        <div key={i} className="group relative -mx-3 px-3 rounded-lg hover:bg-gray-50/80">
          {!readOnly && editing !== i && (
            <div className="absolute -left-9 top-1 hidden group-hover:flex flex-col items-center gap-0.5 text-gray-400">
              <button type="button" title="Add block below" className="w-6 h-6 rounded hover:bg-gray-200 flex items-center justify-center" onClick={() => setMenu(menu === i ? null : i)}>
                <Icon name="plus" size={15} />
              </button>
              <button type="button" title="Move up" className="w-6 h-6 rounded hover:bg-gray-200 flex items-center justify-center" onClick={() => move(i, -1)}>
                <Icon name="arrowUp" size={13} />
              </button>
              <button type="button" title="Move down" className="w-6 h-6 rounded hover:bg-gray-200 flex items-center justify-center" onClick={() => move(i, 1)}>
                <Icon name="arrowDown" size={13} />
              </button>
            </div>
          )}
          {editing === i ? (
            <div className="py-2">
              <textarea
                ref={ta}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = e.target.scrollHeight + 'px';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditing(null);
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) commit();
                }}
                className="w-full font-mono text-[13.5px] leading-relaxed bg-white border border-brand-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-brand-200"
              />
              <div className="flex items-center gap-2 mt-2">
                <button type="button" onClick={commit} className="px-3 h-8 rounded-lg bg-brand-600 text-white text-sm">Save</button>
                <button type="button" onClick={() => setEditing(null)} className="px-3 h-8 rounded-lg border border-gray-200 text-sm">Cancel</button>
                <button type="button" onClick={() => { setEditing(null); remove(i); }} className="px-3 h-8 rounded-lg text-red-600 text-sm hover:bg-red-50 ml-auto">Delete block</button>
                <span className="text-xs text-gray-400">Markdown · Mermaid in ```mermaid fences · Ctrl/⌘+Enter to save</span>
              </div>
            </div>
          ) : (
            <div
              className={cx('py-1', !readOnly && 'cursor-text')}
              onClick={(e) => {
                if (readOnly || (e.target as HTMLElement).closest('a')) return;
                setEditing(i);
                setDraft(b);
                setMenu(null);
              }}
            >
              <Markdown md={b} />
            </div>
          )}
          {menu === i && (
            <div className="absolute left-0 z-20 mt-1 bg-white border border-gray-200 rounded-xl shadow-lg p-1.5 grid grid-cols-2 gap-1 w-64">
              {INSERTS.map((x) => (
                <button key={x.label} type="button" className="text-left px-3 py-1.5 rounded-lg text-sm hover:bg-brand-50" onClick={() => insertAfter(i, x.md)}>
                  {x.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      {!readOnly && (
        <button type="button" onClick={() => setMenu(menu === blocks.length - 1 ? null : blocks.length - 1)} className="mt-3 text-sm text-gray-500 hover:text-brand-700 inline-flex items-center gap-1">
          <Icon name="plus" size={15} /> Add block
        </button>
      )}
    </div>
  );
}
