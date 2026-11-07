import React, { useState } from 'react';
import { PageHeader } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Empty, ExtLink, Field, KpiCard, Modal, Segmented, Select, TextArea, TextInput, cx } from '../components/ui';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db, DEMO, loadRunLog } from '../lib/store';
import { fmtTime, timeAgo } from '../lib/format';
import type { Source } from '../lib/types';

export const REPO = process.env.REACT_APP_REPO || 'rohit-singh-wadhwani/waig-atlas';

const TYPES = [
  { value: 'scout_search', label: 'Grant scout: Gemini web search (brief in URL field)' },
  { value: 'scout_page', label: 'Grant scout: funder page (Gemini reads it when it changes)' },
  { value: 'scout_feed', label: 'Grant scout: opportunities feed (RSS)' },
  { value: 'scout_web', label: 'Grant scout: free web + news search (one query per line)' },
  { value: 'scout_eu', label: 'Grant scout: EU Funding & Tenders search (text in URL field)' },
  { value: 'rss', label: 'RSS / Atom feed' },
  { value: 'json', label: 'JSON API (Gemini extracts items)' },
  { value: 'html', label: 'Web page (Gemini extracts items)' },
  { value: 'gemini_search', label: 'Gemini web search (query in URL field)' },
  { value: 'grantsgov', label: 'Grants.gov search API' },
  { value: 'who_don', label: 'WHO Disease Outbreak News API' },
  { value: 'pubmed', label: 'PubMed query' },
  { value: 'gho', label: 'WHO GHO indicator code' },
  { value: 'opendengue', label: 'OpenDengue national data' },
  { value: 'worldbank', label: 'World Bank procurement API' },
];

export default function SourcesPage() {
  const sources = useData(() => db.list<Source>('sources'), [], []);
  const runs = useData(loadRunLog, [], { runs: [] });
  const [cat, setCat] = useState<'all' | Source['category']>('all');
  const [adding, setAdding] = useState(false);
  const list = sources.data.filter((s) => cat === 'all' || s.category === cat);
  const ok = sources.data.filter((s) => s.enabled && s.last_status === 'ok').length;
  const err = sources.data.filter((s) => s.enabled && s.last_status === 'error').length;
  const enabled = sources.data.filter((s) => s.enabled).length;
  const lastRun = sources.data.map((s) => s.last_run || '').sort().pop() || null;

  const toggle = (s: Source) => db.upsert('sources', { ...s, enabled: !s.enabled });

  return (
    <>
      <PageHeader
        title="Sources & Status"
        subtitle="Every feed the scheduled jobs read, with the result of its last run"
        updatedAt={lastRun}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add source</Button>}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <KpiCard icon="rss" label="Enabled sources" value={`${enabled} / ${sources.data.length}`} />
        <KpiCard icon="checkCircle" tint="green" label="Healthy" value={ok} foot="last run succeeded" />
        <KpiCard icon="alert" tint="red" label="Failing" value={err} foot="check message below" onClick={() => setCat('all')} />
        <KpiCard icon="clock" tint="gray" label="Last run" value={timeAgo(lastRun)} foot={fmtTime(lastRun)} />
      </div>

      {DEMO && (
        <div className="mb-6 flex gap-3 items-start bg-amber-50 border border-amber-200 text-amber-900 rounded-2xl px-5 py-4 text-[15px]">
          <Icon name="alert" size={20} className="mt-0.5 shrink-0" />
          <div>
            Demo mode: switching a source on or off here only changes this browser. The scheduled jobs read{' '}
            <ExtLink href={`https://github.com/${REPO}/blob/main/config/sources.json`}>config/sources.json</ExtLink> until Supabase is connected; after that they read this table.
          </div>
        </div>
      )}

      <Card pad={false}>
        <div className="p-6 pb-3">
          <CardHeader
            title="Sources"
            right={<Segmented size="sm" value={cat} onChange={setCat} options={[{ value: 'all', label: 'All' }, { value: 'grants', label: 'Grants' }, { value: 'insights', label: 'Insights' }, { value: 'datasets', label: 'Datasets' }]} />}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="font-medium px-6 py-3">On</th>
                <th className="font-medium px-3 py-3">Source</th>
                <th className="font-medium px-3 py-3">Category</th>
                <th className="font-medium px-3 py-3">Last run</th>
                <th className="font-medium px-3 py-3">Status</th>
                <th className="font-medium px-3 py-3 text-right">Items</th>
                <th className="font-medium px-3 py-3">Message</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className={cx('border-b border-gray-100', !s.enabled && 'opacity-60')}>
                  <td className="px-6 py-3">
                    <button type="button" role="switch" aria-checked={s.enabled} onClick={() => toggle(s)} className={cx('w-10 h-6 rounded-full relative transition-colors', s.enabled ? 'bg-brand-500' : 'bg-gray-300')} title={s.enabled ? 'Disable' : 'Enable'}>
                      <span className={cx('absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all', s.enabled ? 'left-[18px]' : 'left-0.5')} />
                    </button>
                  </td>
                  <td className="px-3 py-3 max-w-[340px]">
                    <div className="font-medium text-gray-900">{s.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {TYPES.find((t) => t.value === s.type)?.label || s.type} · {/^https?:/.test(s.url) ? <a className="text-brand-700 hover:underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a> : s.url}
                    </div>
                  </td>
                  <td className="px-3 py-3 capitalize">{s.category}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-sm">{fmtTime(s.last_run)}</td>
                  <td className="px-3 py-3">
                    {s.last_status === 'ok' ? (
                      <Badge className="bg-green-50 text-green-700"><Icon name="checkCircle" size={14} /> OK</Badge>
                    ) : s.last_status === 'error' ? (
                      <Badge className="bg-red-50 text-red-700"><Icon name="alert" size={14} /> Failing</Badge>
                    ) : s.last_status === 'skipped' ? (
                      <Badge className="bg-gray-100 text-gray-600">Skipped</Badge>
                    ) : (
                      <Badge className="bg-gray-100 text-gray-500">Not run</Badge>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{s.item_count ?? '—'}</td>
                  <td className="px-3 py-3 text-sm text-gray-500 max-w-[320px] truncate" title={s.last_message || ''}>{s.last_message || s.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!sources.loading && list.length === 0 && <Empty icon="rss" title="No sources yet" />}
        </div>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Job runs"
          subtitle="Scheduled on GitHub Actions: grants every 12h, insights every 3h, datasets daily"
          right={<ExtLink href={`https://github.com/${REPO}/actions`}>Run a job now</ExtLink>}
        />
        <ul className="divide-y divide-gray-100">
          {runs.data.runs.slice(0, 12).map((r, i) => (
            <li key={i} className="py-2.5 flex items-center gap-3 text-[15px]">
              <Icon name={r.ok ? 'checkCircle' : 'alert'} size={18} className={r.ok ? 'text-green-600' : 'text-red-600'} />
              <span className="font-medium w-28">{r.job}</span>
              <span className="text-gray-500 w-40">{fmtTime(r.at)}</span>
              <span className="text-gray-600 truncate">{r.message}</span>
            </li>
          ))}
        </ul>
        {!runs.data.runs.length && <Empty icon="clock" title="No runs recorded yet" />}
      </Card>

      <AddSource open={adding} onClose={() => setAdding(false)} />
    </>
  );
}

function AddSource({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [s, setS] = useState<Partial<Source>>({ category: 'insights', type: 'rss', enabled: true });
  const save = async () => {
    if (!s.name || !s.url) return;
    const id = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await db.upsert('sources', { id, name: s.name, category: s.category!, type: s.type!, url: s.url, enabled: true, notes: s.notes || '', last_status: null } as Source);
    setS({ category: 'insights', type: 'rss', enabled: true });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add a source" footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Add source</Button></>}>
      <Field label="Name"><TextInput className="w-full" value={s.name || ''} onChange={(e) => setS({ ...s, name: e.target.value })} placeholder="e.g. Ghana Health Service news" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category"><Select value={s.category || 'insights'} onChange={(v) => setS({ ...s, category: v as Source['category'] })} options={[{ value: 'grants', label: 'Grants' }, { value: 'insights', label: 'Insights' }, { value: 'datasets', label: 'Datasets' }]} /></Field>
        <Field label="Type"><Select value={s.type || 'rss'} onChange={(v) => setS({ ...s, type: v })} options={TYPES} /></Field>
      </div>
      <Field label="URL, query or code" hint="Gemini web search: write the brief in plain words. Free web search: separate queries with ;"><TextInput className="w-full" value={s.url || ''} onChange={(e) => setS({ ...s, url: e.target.value })} /></Field>
      <Field label="Notes"><TextArea rows={2} value={s.notes || ''} onChange={(e) => setS({ ...s, notes: e.target.value })} /></Field>
    </Modal>
  );
}
