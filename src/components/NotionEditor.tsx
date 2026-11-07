import '@blocknote/core/fonts/inter.css';
import '@blocknote/mantine/style.css';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BlockNoteSchema, defaultBlockSpecs, filterSuggestionItems, insertOrUpdateBlock } from '@blocknote/core';
import { createReactBlockSpec, getDefaultReactSlashMenuItems, SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/mantine';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import { SERIES } from './ChartCard';

/* ------------------------------------------------------------------ */
/* Mermaid diagram block                                                */
/* ------------------------------------------------------------------ */

let mmdSeq = 0;
function MermaidView({ code }: { code: string }) {
  const [svg, setSvg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    const m = (window as any).mermaid;
    if (!m) {
      setErr('Diagram library not loaded');
      return;
    }
    try {
      m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', fontFamily: 'Inter, sans-serif', themeVariables: { primaryColor: '#eff7f7', primaryBorderColor: '#3e8a8b', lineColor: '#6b7280', fontSize: '14px' } });
    } catch {}
    m.render(`nb-mmd-${++mmdSeq}`, code)
      .then((r: any) => alive && (setSvg(r.svg), setErr('')))
      .catch((e: any) => alive && setErr(String(e?.message || e).slice(0, 200)));
    return () => {
      alive = false;
    };
  }, [code]);
  if (err) return <div className="text-sm text-red-600">Diagram error: {err}</div>;
  return <div className="overflow-x-auto [&_svg]:max-w-full [&_svg]:h-auto" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function EditDialog({ title, children, onClose, onSave }: { title: string; children: React.ReactNode; onClose: () => void; onSave: () => void }) {
  // Rendered in a portal so typing never reaches the editor underneath.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" onMouseDown={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-gray-900/30" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="px-6 pt-5 pb-2 text-lg font-semibold">{title}</div>
        <div className="px-6 py-3 space-y-3 overflow-y-auto min-h-0">{children}</div>
        <div className="px-6 pb-5 pt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 h-10 rounded-xl border border-gray-200 text-sm">Cancel</button>
          <button type="button" onClick={onSave} className="px-4 h-10 rounded-xl bg-brand-600 text-white text-sm font-medium">Save</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const MermaidBlock = createReactBlockSpec(
  { type: 'mermaid', propSchema: { code: { default: 'flowchart LR\n  A[Start] --> B[Step] --> C[Done]' } }, content: 'none' },
  { render: (props: any) => <MermaidRender {...props} /> }
);

function MermaidRender({ block, editor }: any) {
      const [open, setOpen] = useState(false);
      const [draft, setDraft] = useState(block.props.code);
      return (
        <div className="w-full rounded-xl border border-gray-100 bg-white p-3 group/mmd relative" contentEditable={false}>
          <MermaidView code={block.props.code} />
          {editor.isEditable && (
            <button type="button" onClick={() => { setDraft(block.props.code); setOpen(true); }} className="absolute top-2 right-2 opacity-0 group-hover/mmd:opacity-100 transition-opacity text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
              Edit diagram
            </button>
          )}
          {open && (
            <EditDialog title="Edit diagram" onClose={() => setOpen(false)} onSave={() => { editor.updateBlock(block, { props: { code: draft } }); setOpen(false); }}>
              <p className="text-sm text-gray-500">Mermaid syntax. Preview updates as you type.</p>
              <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={10} className="w-full font-mono text-[13px] border border-gray-200 rounded-xl p-3 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              <div className="border border-gray-100 rounded-xl p-3"><MermaidView code={draft} /></div>
            </EditDialog>
          )}
        </div>
      );
}

/* ------------------------------------------------------------------ */
/* Chart block: data edited as a small table (CSV)                      */
/* ------------------------------------------------------------------ */

function parseCsv(csv: string) {
  const rows = csv.trim().split(/\r?\n/).map((r) => r.split(',').map((c) => c.trim()));
  const head = rows[0] || [];
  const body = rows.slice(1).filter((r) => r.length > 1);
  return {
    labels: body.map((r) => r[0]),
    series: head.slice(1).map((name, i) => ({ name, values: body.map((r) => Number(r[i + 1]) || 0) })),
  };
}

function ChartView({ kind, title, data }: { kind: string; title: string; data: string }) {
  const { labels, series } = parseCsv(data);
  const opts: any = { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: series.length > 1 || kind === 'pie', position: 'bottom' }, title: { display: !!title, text: title, align: 'start', font: { size: 14, weight: '600' } } }, scales: kind === 'pie' ? undefined : { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: '#f1f2f4' } } } };
  const ds = series.map((s, i) => ({ label: s.name, data: s.values, backgroundColor: kind === 'pie' ? labels.map((_, k) => SERIES[k % SERIES.length]) : SERIES[i % SERIES.length], borderColor: SERIES[i % SERIES.length], borderWidth: kind === 'line' ? 2 : 0, borderRadius: 4, tension: 0.25 }));
  return (
    <div style={{ height: 260 }}>
      {kind === 'line' ? <Line data={{ labels, datasets: ds }} options={opts} /> : kind === 'pie' ? <Doughnut data={{ labels, datasets: ds.slice(0, 1) }} options={opts} /> : <Bar data={{ labels, datasets: ds }} options={opts} />}
    </div>
  );
}

const ChartBlock = createReactBlockSpec(
  {
    type: 'chart',
    propSchema: { kind: { default: 'bar', values: ['bar', 'line', 'pie'] as const }, title: { default: 'Chart title' }, data: { default: 'Label,Value\nA,10\nB,20\nC,15' } },
    content: 'none',
  },
  { render: (props: any) => <ChartRender {...props} /> }
);

function ChartRender({ block, editor }: any) {
      const [open, setOpen] = useState(false);
      const [d, setD] = useState({ kind: block.props.kind as string, title: block.props.title, data: block.props.data });
      return (
        <div className="w-full rounded-xl border border-gray-100 bg-white p-3 group/chart relative" contentEditable={false}>
          <ChartView kind={block.props.kind} title={block.props.title} data={block.props.data} />
          {editor.isEditable && (
            <button type="button" onClick={() => { setD({ kind: block.props.kind, title: block.props.title, data: block.props.data }); setOpen(true); }} className="absolute top-2 right-2 opacity-0 group-hover/chart:opacity-100 transition-opacity text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
              Edit chart
            </button>
          )}
          {open && (
            <EditDialog title="Edit chart" onClose={() => setOpen(false)} onSave={() => { editor.updateBlock(block, { props: { kind: d.kind as any, title: d.title, data: d.data } }); setOpen(false); }}>
              <div className="grid grid-cols-[1fr_160px] gap-3">
                <input value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Title" className="border border-gray-200 rounded-xl px-3 h-10 text-sm" />
                <select value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value })} className="border border-gray-200 rounded-xl px-3 h-10 text-sm bg-white">
                  <option value="bar">Bar</option>
                  <option value="line">Line</option>
                  <option value="pie">Donut</option>
                </select>
              </div>
              <p className="text-sm text-gray-500">Data: first row is headers (label, then one column per series). Paste from a spreadsheet as comma-separated values.</p>
              <textarea value={d.data} onChange={(e) => setD({ ...d, data: e.target.value })} rows={8} className="w-full font-mono text-[13px] border border-gray-200 rounded-xl p-3" />
              <div className="border border-gray-100 rounded-xl p-3"><ChartView kind={d.kind} title={d.title} data={d.data} /></div>
            </EditDialog>
          )}
        </div>
      );
}

/* ------------------------------------------------------------------ */
/* Schema, templates, markdown mirror                                   */
/* ------------------------------------------------------------------ */

const schema = BlockNoteSchema.create({ blockSpecs: { ...defaultBlockSpecs, mermaid: MermaidBlock, chart: ChartBlock } });
type Editor = typeof schema.BlockNoteEditor;

const TEMPLATES: { title: string; subtext: string; aliases: string[]; block: any }[] = [
  { title: 'Flowchart', subtext: 'Boxes and arrows (Mermaid)', aliases: ['mermaid', 'diagram', 'flow'], block: { type: 'mermaid', props: { code: 'flowchart LR\n  A[Input] --> B[Process] --> C[Output]' } } },
  { title: 'Timeline / Gantt', subtext: 'Tasks over time (Mermaid)', aliases: ['gantt', 'timeline', 'plan'], block: { type: 'mermaid', props: { code: 'gantt\n  dateFormat YYYY-MM-DD\n  axisFormat %b %y\n  section Work\n  Task one :a1, 2026-11-10, 21d\n  Task two :after a1, 14d' } } },
  { title: 'Sequence diagram', subtext: 'Who calls whom (Mermaid)', aliases: ['sequence', 'api'], block: { type: 'mermaid', props: { code: 'sequenceDiagram\n  participant App\n  participant API\n  App->>API: request\n  API-->>App: response' } } },
  { title: 'Bar chart', subtext: 'Compare values', aliases: ['chart', 'graph', 'bar'], block: { type: 'chart', props: { kind: 'bar', title: 'Bar chart', data: 'Label,Value\nA,10\nB,20\nC,15' } } },
  { title: 'Line chart', subtext: 'Trend over time', aliases: ['chart', 'graph', 'line', 'trend'], block: { type: 'chart', props: { kind: 'line', title: 'Trend', data: 'Month,Actual,Target\nJan,10,12\nFeb,14,15\nMar,18,18' } } },
  { title: 'Donut chart', subtext: 'Share of a whole', aliases: ['chart', 'pie', 'donut'], block: { type: 'chart', props: { kind: 'pie', title: 'Split', data: 'Part,Share\nA,50\nB,30\nC,20' } } },
];

function tableTemplate(title: string, aliases: string[], rows: string[][]) {
  return { title, subtext: 'Table template', aliases: ['table', ...aliases], block: { type: 'table', content: { type: 'tableContent', rows: rows.map((r) => ({ cells: r })) } } };
}
const TABLE_TEMPLATES = [
  tableTemplate('Status table', ['status', 'tracker'], [['Item', 'Owner', 'Status', 'Due'], ['', '', '', ''], ['', '', '', '']]),
  tableTemplate('Risk register', ['risk'], [['Risk', 'Likelihood', 'Impact', 'Mitigation'], ['', '', '', '']]),
  tableTemplate('Decision log', ['decision'], [['Date', 'Decision', 'Why', 'Owner'], ['', '', '', '']]),
];

function slashItems(editor: Editor) {
  const templates = [...TEMPLATES, ...TABLE_TEMPLATES].map((t) => ({
    title: t.title,
    subtext: t.subtext,
    aliases: t.aliases,
    group: 'Templates',
    onItemClick: () => insertOrUpdateBlock(editor as any, t.block),
  }));
  return [...getDefaultReactSlashMenuItems(editor as any), ...templates];
}

/** Convert legacy markdown (with ```mermaid fences and - [ ] checklists) into editor blocks. */
async function fromMarkdown(editor: Editor, md: string) {
  const parse = async (text: string): Promise<any[]> => (await (editor as any).tryParseMarkdownToBlocks(text)) || [];
  const textOf = (b: any) => (Array.isArray(b.content) ? b.content.map((c: any) => c.text || '').join('') : '');
  const out: any[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = async () => {
    if (buf.join('').trim()) out.push(...(await parse(buf.join('\n'))));
    buf = [];
  };
  for (const line of (md || '').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence && line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/);
    if (m) {
      await flush();
      const inline = (await parse(m[2]))[0]?.content;
      out.push({ type: 'checkListItem', props: { checked: m[1].toLowerCase() === 'x' }, content: Array.isArray(inline) && inline.length ? inline : m[2] });
    } else buf.push(line);
  }
  await flush();
  return out.map((b) => {
    if (b.type === 'codeBlock') {
      const code = textOf(b);
      const lang = (b.props?.language || '').toLowerCase();
      if (lang === 'mermaid' || /^(flowchart|graph|gantt|sequenceDiagram|xychart-beta|pie|timeline|classDiagram|stateDiagram)/.test(code.trim())) return { type: 'mermaid', props: { code } };
    }
    return b;
  });
}

/** Markdown copy kept alongside the blocks, for search, scoring and exports. */
async function toMarkdown(editor: Editor, doc: any[]) {
  const out: string[] = [];
  let run: any[] = [];
  const flush = async () => {
    if (run.length) out.push(String(await (editor as any).blocksToMarkdownLossy(run)).trim());
    run = [];
  };
  for (const b of doc) {
    if (b.type === 'mermaid') {
      await flush();
      out.push('```mermaid\n' + b.props.code + '\n```');
    } else if (b.type === 'chart') {
      await flush();
      out.push('```chart\n' + JSON.stringify(b.props) + '\n```');
    } else if (b.type === 'checkListItem') {
      await flush();
      const line = String(await (editor as any).blocksToMarkdownLossy([{ ...b, type: 'paragraph', props: {}, children: [] }])).trim();
      out.push(`- [${b.props?.checked ? 'x' : ' '}] ${line}`);
    } else run.push(b);
  }
  await flush();
  return out.filter(Boolean).join('\n\n');
}

export type EditorSave = { json: any[]; md: string };

export default function NotionEditor({ json, md, onSave, editable = true }: { json?: any[] | null; md?: string; onSave: (v: EditorSave) => void | Promise<void>; editable?: boolean }) {
  const editor = useCreateBlockNote({ schema, initialContent: json && json.length ? (json as any) : undefined }) as unknown as Editor;
  const [ready, setReady] = useState(!!(json && json.length) || !md);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<any>(null);
  const loadedMd = useRef(false);

  // Legacy pages only have markdown: convert once on first open.
  useEffect(() => {
    if (loadedMd.current || (json && json.length) || !md) return;
    loadedMd.current = true;
    fromMarkdown(editor, md).then((blocks) => {
      if (blocks.length) (editor as any).replaceBlocks((editor as any).document, blocks);
      setReady(true);
    });
  }, [editor, json, md]);

  const save = useMemo(
    () => () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(async () => {
        setSaving('saving');
        const doc = (editor as any).document;
        await onSave({ json: doc, md: await toMarkdown(editor, doc) });
        setSaving('saved');
        setTimeout(() => setSaving('idle'), 1500);
      }, 900);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor]
  );

  return (
    <div className="atlas-editor relative">
      <div className="absolute -top-7 right-0 text-xs text-gray-400">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'Saved' : 'Type / for blocks and templates'}</div>
      {!ready && <div className="text-sm text-gray-400 py-4">Loading page…</div>}
      <BlockNoteView editor={editor as any} editable={editable} theme="light" slashMenu={false} onChange={() => ready && save()}>
        <SuggestionMenuController triggerCharacter="/" getItems={async (query: string) => filterSuggestionItems(slashItems(editor) as any, query) as any} />
      </BlockNoteView>
    </div>
  );
}
