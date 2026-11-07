import React from 'react';
import { PageHeader, useMe } from '../components/Layout';
import { Card, CardHeader } from '../components/ui';
import { useData } from '../lib/hooks';
import { db } from '../lib/store';
import { fmtTime } from '../lib/format';
import { DEFAULT_ORG_CONTEXT } from '../lib/defaults';
import type { OrgContext } from '../lib/types';

const NotionEditor = React.lazy(() => import('../components/NotionEditor'));

export default function OrgContextPage() {
  const me = useMe();
  const ctx = useData(() => db.list<OrgContext & { id: string; updated_by?: string }>('org_context'), [], []);
  const row = ctx.data.find((r) => r.id === 'main');
  const save = ({ md }: { md: string }) => db.upsert('org_context', { id: 'main', content_md: md, updated_at: new Date().toISOString() } as any).then(() => undefined);
  return (
    <>
      <PageHeader title="Org Context" subtitle={`What Gemini knows about us when it scores grants. Edited by ${me.name.split(' ')[0]} and the team.`} />
      <Card>
        <CardHeader title="Context page" subtitle={row ? `Last saved ${fmtTime(row.updated_at)} · the next grants run uses this version` : 'Showing the default. Edit any block to save your own.'} />
        <div className="-mx-2 sm:-mx-4">
          {!ctx.loading && (
            <React.Suspense fallback={<div className="text-sm text-gray-400 py-4 px-4">Loading editor…</div>}>
              <NotionEditor md={row?.content_md || DEFAULT_ORG_CONTEXT} onSave={save} />
            </React.Suspense>
          )}
        </div>
      </Card>
    </>
  );
}
