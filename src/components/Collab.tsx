import React, { useState } from 'react';
import { db, DEMO, uid, uploadFile } from '../lib/store';
import { useData } from '../lib/hooks';
import { fmtTime } from '../lib/format';
import type { Attachment, Comment } from '../lib/types';
import { Avatar, Button, Card, CardHeader, Empty, Select, TextArea, TextInput } from './ui';
import Icon from './Icon';
import { useMe } from './Layout';

export function Comments({ entityType, entityId, title = 'Comments' }: { entityType: string; entityId: string; title?: string }) {
  const me = useMe();
  const { data } = useData(() => db.list<Comment>('comments', { entity_type: entityType, entity_id: entityId }), [entityType, entityId], []);
  const [body, setBody] = useState('');
  const sorted = [...data].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const add = async () => {
    if (!body.trim()) return;
    await db.upsert('comments', { id: uid('c'), entity_type: entityType, entity_id: entityId, body: body.trim(), author: me.email, created_at: new Date().toISOString() });
    setBody('');
  };
  return (
    <Card>
      <CardHeader title={title} subtitle={`${sorted.length} comment${sorted.length === 1 ? '' : 's'}`} />
      <div className="space-y-4">
        {sorted.map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar name={c.author} size={32} />
            <div className="min-w-0 flex-1">
              <div className="text-sm">
                <span className="font-medium text-gray-900">{c.author.split('@')[0]}</span>
                <span className="text-gray-400 ml-2">{fmtTime(c.created_at)}</span>
              </div>
              <p className="text-[15px] text-gray-700 whitespace-pre-wrap mt-0.5">{c.body}</p>
            </div>
            {c.author === me.email && (
              <button type="button" className="text-gray-300 hover:text-red-500 self-start" title="Delete comment" onClick={() => db.remove('comments', c.id)}>
                <Icon name="trash" size={15} />
              </button>
            )}
          </div>
        ))}
        <div className="flex gap-3 pt-1">
          <Avatar name={me.name} size={32} />
          <div className="flex-1">
            <TextArea rows={2} placeholder="Add a comment…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && add()} />
            <div className="flex justify-end mt-2">
              <Button variant="primary" onClick={add} disabled={!body.trim()}>Comment</Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}

const KIND_ICON = { link: 'link', file: 'file', dashboard: 'dashboard', document: 'file' } as const;

export function Attachments({ entityType, entityId, title = 'Attachments', subtitle }: { entityType: string; entityId: string; title?: string; subtitle?: string }) {
  const me = useMe();
  const { data } = useData(() => db.list<Attachment>('attachments', { entity_type: entityType, entity_id: entityId }), [entityType, entityId], []);
  const [adding, setAdding] = useState(false);
  const [t, setT] = useState('');
  const [u, setU] = useState('');
  const [k, setK] = useState<Attachment['kind']>('link');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (url: string, title: string, kind: Attachment['kind']) => {
    await db.upsert('attachments', { id: uid('a'), entity_type: entityType, entity_id: entityId, title, url, kind, author: me.email, created_at: new Date().toISOString() });
  };
  const addLink = async () => {
    if (!/^https?:\/\//.test(u)) return setErr('Enter a full link starting with https://');
    await save(u, t || u, k);
    setT('');
    setU('');
    setAdding(false);
    setErr(null);
  };
  const onFile = async (f?: File | null) => {
    if (!f) return;
    setBusy(true);
    setErr(null);
    try {
      const url = await uploadFile(f, `${entityType}/${entityId}`);
      await save(url, f.name, 'file');
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={title}
        subtitle={subtitle || 'Links to dashboards, documents, folders or uploaded files'}
        right={
          <>
            {!DEMO && (
              <label className="inline-flex items-center gap-2 rounded-xl px-3 h-9 text-sm border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer">
                <Icon name="upload" size={16} /> {busy ? 'Uploading…' : 'Upload'}
                <input type="file" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              </label>
            )}
            <Button icon="plus" onClick={() => setAdding(!adding)} className="h-9">Add link</Button>
          </>
        }
      />
      {adding && (
        <div className="grid gap-2 mb-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
          <TextInput placeholder="Title" value={t} onChange={(e) => setT(e.target.value)} />
          <TextInput placeholder="https://…" value={u} onChange={(e) => setU(e.target.value)} />
          <Select value={k} onChange={(v) => setK(v as Attachment['kind'])} options={[{ value: 'link', label: 'Link' }, { value: 'dashboard', label: 'Dashboard' }, { value: 'document', label: 'Document' }]} />
          <Button variant="primary" onClick={addLink}>Save</Button>
        </div>
      )}
      {err && <p className="text-sm text-red-600 mb-3">{err}</p>}
      {data.length === 0 ? (
        <Empty icon="paperclip" title="Nothing attached yet" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {data.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5">
              <span className="w-9 h-9 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center shrink-0">
                <Icon name={KIND_ICON[a.kind] || 'link'} size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <a href={a.url} target="_blank" rel="noreferrer" className="font-medium text-gray-900 hover:text-brand-700 truncate block">{a.title}</a>
                <div className="text-xs text-gray-500 truncate">{a.kind} · {a.author.split('@')[0]} · {fmtTime(a.created_at)}</div>
              </div>
              <button type="button" className="text-gray-300 hover:text-red-500" title="Remove" onClick={() => db.remove('attachments', a.id)}>
                <Icon name="trash" size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {DEMO && <p className="text-xs text-gray-400 mt-3">File uploads switch on once Supabase is connected. Links work now.</p>}
    </Card>
  );
}
