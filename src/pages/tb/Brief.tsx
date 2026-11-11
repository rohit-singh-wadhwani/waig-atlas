import React, { useMemo, useState } from 'react';
import { Card, CardHeader, Empty, Segmented } from '../../components/ui';
import { useData } from '../../lib/hooks';
import { fmtTime } from '../../lib/format';
import { tbList } from '../../lib/tb';

type BriefRow = { id: string; scope: string; generated_at: string; model?: string; content_md: string };

function render(md: string) {
  const safe = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const m = (window as any).marked;
  return m ? m.parse(safe) : `<pre>${safe}</pre>`;
}

export default function Brief() {
  const briefs = useData(() => tbList<BriefRow>('tb_briefs'), [], []);
  const latest = useMemo(() => {
    const by: Record<string, BriefRow> = {};
    for (const b of briefs.data) if (!by[b.scope] || b.generated_at > by[b.scope].generated_at) by[b.scope] = b;
    return by;
  }, [briefs.data]);
  const scopes = Object.keys(latest).sort((a, b) => (a === 'Ghana' ? -1 : b === 'Ghana' ? 1 : a.localeCompare(b)));
  const [scope, setScope] = useState('');
  const cur = latest[scope] || latest[scopes[0]];
  if (!scopes.length) return <Empty icon="sparkles" title="No brief yet">Gemini writes a brief for Ghana and each city after the weekly data run.</Empty>;
  return (
    <Card>
      <CardHeader
        title={`Weekly TB brief · ${cur.scope}`}
        subtitle={`Written by ${cur.model || 'Gemini'} on ${fmtTime(cur.generated_at)} from the data on this page only. Check numbers before quoting them.`}
        right={scopes.length > 1 ? <Segmented size="sm" value={cur.scope} onChange={setScope} options={scopes.map((s) => ({ value: s, label: s }))} /> : undefined}
      />
      <div className="prose-atlas max-w-none" dangerouslySetInnerHTML={{ __html: render(cur.content_md) }} />
    </Card>
  );
}
