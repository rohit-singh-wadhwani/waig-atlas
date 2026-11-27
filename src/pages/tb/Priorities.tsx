import React from 'react';
import { Link } from 'react-router-dom';
import { Card, CardHeader, ExtLink, cx } from '../../components/ui';
import { fmtDate } from '../../lib/format';
import { TbPriorities, TbPriorityPick } from '../../lib/tb';

// The daily AI ranking of where to screen next, shown in the district list, inside a district, and on the Overview.

const SIGNAL: Record<TbPriorityPick['signal'], { label: string; cls: string }> = {
  data: { label: 'From the figures', cls: 'bg-gray-100 text-gray-700' },
  news: { label: 'Recent news', cls: 'bg-violet-50 text-violet-800' },
  research: { label: 'Research', cls: 'bg-sky-50 text-sky-800' },
  mixed: { label: 'Figures + reports', cls: 'bg-violet-50 text-violet-800' },
};
const KIND: Record<'data' | 'news' | 'research', { label: string; cls: string }> = {
  data: { label: 'Dashboard', cls: 'text-gray-600 bg-white border border-gray-200' },
  news: { label: 'News', cls: 'text-violet-800 bg-violet-50' },
  research: { label: 'Research', cls: 'text-sky-800 bg-sky-50' },
};

/** What the ranking was made from, in one line. */
export const priorityInputs = (p: TbPriorities) =>
  `AI insights from the dashboard figures of ${p.inputs.districts} districts, ${p.inputs.news} news reports from the last ${p.inputs.news_days} days and ${p.inputs.research} research papers · ${fmtDate(p.generated_at)}`;

/** How the ranking works, for the "?" beside it. */
export const PRIORITY_HOW = 'Each day an AI model reads the dashboard figures for the leading districts (expected cases and rate, dense settlements, health facilities, walking time to care, prisons, mines and ports, poverty, crowding, campaigns already there) together with recent news (Google News, Bing News) and research (PubMed) that names those places. It ranks where to screen next and says why. A recent report can lift a district above one with more modelled cases. Every figure it quotes comes from the dashboard, every report links to its source, and towns are picked from the district\'s own list.';

export const SignalTag = ({ s }: { s: TbPriorityPick['signal'] }) => <span className={cx('shrink-0 rounded px-1.5 py-px text-[11px] font-medium', SIGNAL[s].cls)}>{SIGNAL[s].label}</span>;

/** The factors behind a pick, strongest first, each with its source links. */
export function Factors({ pick }: { pick: TbPriorityPick }) {
  return (
    <ul className="space-y-2">
      {pick.factors.map((f, i) => (
        <li key={i} className="flex gap-2 text-sm text-gray-700">
          <span className={cx('mt-0.5 h-fit shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide', KIND[f.kind].cls)}>{KIND[f.kind].label}</span>
          <span>{f.text}{f.sources.length > 0 && <span className="ml-1.5 inline-flex flex-wrap gap-x-2 text-xs">{f.sources.slice(0, 3).map((s) => <ExtLink key={s.url} href={s.url}>{s.source || 'Source'}{s.date ? `, ${fmtDate(s.date)}` : ''}</ExtLink>)}</span>}</span>
        </li>
      ))}
    </ul>
  );
}

/** "Start with" towns for a pick; clickable when the district's towns are on screen. */
export function Towns({ pick, onTown }: { pick: TbPriorityPick; onTown?: (name: string) => void }) {
  if (!pick.towns.length) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-200/70">
      <div className="text-xs font-medium text-gray-500 mb-1.5">Start with</div>
      <ul className="space-y-1.5">
        {pick.towns.map((t) => (
          <li key={t.name} className="text-sm">
            {onTown ? <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => onTown(t.name)}>{t.name}</button> : <span className="font-medium text-gray-900">{t.name}</span>}
            <span className="text-gray-600"> · {t.why}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Inside a district the AI ranked: its place in the ranking, the reasoning, and which towns to start with. */
export function DistrictInsight({ pick, rank, total, onTown }: { pick: TbPriorityPick; rank: number; total: number; onTown: (name: string) => void }) {
  return (
    <section className="rounded-2xl border border-violet-200 bg-violet-50/40 p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-gray-900">AI priority {rank} of {total}</h3>
        <SignalTag s={pick.signal} />
      </div>
      <p className="text-sm text-gray-800 mt-1.5 leading-relaxed">{pick.why}</p>
      <div className="mt-3"><Factors pick={pick} /></div>
      <Towns pick={pick} onTown={onTown} />
    </section>
  );
}

/** Overview: the top of today's ranking, linking into TB surveillance. */
export function PrioritiesCard({ p, top = 5 }: { p: TbPriorities; top?: number }) {
  return (
    <Card>
      <CardHeader title="Where to screen for TB next" subtitle={priorityInputs(p)} right={<Link to="/tb" className="text-sm text-brand-700 hover:underline whitespace-nowrap">Open TB surveillance</Link>} />
      {p.summary && <p className="text-sm text-gray-800 mb-3">{p.summary}</p>}
      <ol className="divide-y divide-gray-100">
        {p.picks.slice(0, top).map((x, i) => (
          <li key={x.district_id} className="py-2.5 flex gap-3">
            <span className="w-5 text-sm text-gray-400 tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-2"><span className="font-medium text-gray-900">{x.district_name}</span><SignalTag s={x.signal} /></span>
              <span className="block text-sm text-gray-600 mt-0.5">{x.why}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
