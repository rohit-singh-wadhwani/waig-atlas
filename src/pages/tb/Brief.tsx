import React, { useMemo, useState } from 'react';
import { Badge, Card, CardHeader, Empty, ExtLink, cx } from '../../components/ui';
import Icon from '../../components/Icon';
import { useData } from '../../lib/hooks';
import { fmtTime } from '../../lib/format';
import { tbList } from '../../lib/tb';

type Action = { audience: string; action: string; why: string; where?: string; priority: 'now' | 'this month' | 'next quarter' };
type Content = { headline: string; situation: string[]; whats_new: { id: string; title: string; url: string; source?: string; date?: string; why_it_matters: string }[]; actions: Action[]; data_gaps: string[] };
type BriefRow = { id: string; scope: string; generated_at: string; model?: string; content?: Content | null; content_md: string };

const AUDIENCES = ['Health workers', 'District health teams', 'National TB Programme / Government', 'Partners (Aurum, Wadhwani AI)'];
const PRIORITY: Record<string, string> = { now: 'bg-red-50 text-red-700', 'this month': 'bg-amber-50 text-amber-800', 'next quarter': 'bg-gray-100 text-gray-700' };

/** Latest TB summary: what's happening, what's new in TB news and research, and who should do what. */
export default function Brief() {
  const briefs = useData(() => tbList<BriefRow>('tb_briefs'), [], []);
  const cur = useMemo(() => briefs.data.filter((b) => b.content).sort((a, b) => b.generated_at.localeCompare(a.generated_at))[0], [briefs.data]);
  const [aud, setAud] = useState('');
  if (briefs.loading && !briefs.data.length) return null;
  if (!cur?.content) return <Empty icon="sparkles" title="No summary yet">It is written every morning after the news feed refreshes.</Empty>;
  const c = cur.content;
  const audiences = AUDIENCES.filter((a) => c.actions.some((x) => x.audience === a));
  const actions = c.actions.filter((x) => !aud || x.audience === aud).sort((a, b) => ['now', 'this month', 'next quarter'].indexOf(a.priority) - ['now', 'this month', 'next quarter'].indexOf(b.priority));
  return (
    <div className="space-y-5">
      <Card>
        <p className="text-xs text-gray-500">Updated {fmtTime(cur.generated_at)} · written by {cur.model || 'Gemini'} from the dashboard data and the news feed. Check numbers before quoting them.</p>
        <h2 className="text-xl font-semibold text-gray-900 mt-2">{c.headline}</h2>
        <ul className="mt-3 space-y-1.5 text-[15px] text-gray-700 list-disc pl-5">{c.situation.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start">
        <Card>
          <CardHeader title="Action items" subtitle="Who should do what, most urgent first" />
          <div className="flex flex-wrap gap-1.5 mb-4">
            <button type="button" onClick={() => setAud('')} className={cx('rounded-full border px-3 py-1 text-sm', !aud ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700')}>Everyone ({c.actions.length})</button>
            {audiences.map((a) => <button key={a} type="button" onClick={() => setAud(a)} className={cx('rounded-full border px-3 py-1 text-sm', aud === a ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-700')}>{a} ({c.actions.filter((x) => x.audience === a).length})</button>)}
          </div>
          <ul className="divide-y divide-gray-100">
            {actions.map((x, i) => (
              <li key={i} className="py-3.5 flex gap-3">
                <Icon name="checkCircle" size={18} className="text-brand-600 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-[15px] font-medium text-gray-900">{x.action}</div>
                  <div className="text-sm text-gray-600 mt-0.5">{x.why}</div>
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    <Badge className={PRIORITY[x.priority] || 'bg-gray-100 text-gray-700'}>{x.priority}</Badge>
                    <Badge className="bg-brand-50 text-brand-700">{x.audience}</Badge>
                    {x.where && <Badge className="bg-gray-100 text-gray-700">{x.where}</Badge>}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="What's new" subtitle="TB news and research from the Latest Insights feed" />
            {!c.whats_new.length ? <p className="text-sm text-gray-500">Nothing new relevant to Ghana's TB programme in the feed.</p> : (
              <ul className="space-y-3">
                {c.whats_new.map((n) => (
                  <li key={n.id} className="text-sm">
                    <ExtLink href={n.url}>{n.title}</ExtLink>
                    <div className="text-xs text-gray-500">{[n.source, n.date].filter(Boolean).join(' · ')}</div>
                    <div className="text-gray-700 mt-0.5">{n.why_it_matters}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {c.data_gaps.length > 0 && (
            <Card>
              <CardHeader title="Data gaps" subtitle="What would make these decisions sharper" />
              <ul className="space-y-1.5 text-sm text-gray-700 list-disc pl-5">{c.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
