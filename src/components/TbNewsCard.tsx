import React, { useState } from 'react';
import { Card, CardHeader, ExtLink, cx } from './ui';
import { fmtDate } from '../lib/format';
import type { TbNews } from '../lib/tb';

const SCOPE_CLS: Record<string, string> = { Ghana: 'bg-brand-50 text-brand-700', 'West Africa': 'bg-amber-50 text-amber-800', Global: 'bg-gray-100 text-gray-700' };

/** The daily Gemini summary of TB news: a headline, what's new (each with its articles) and what to do about it.
 *  Shows the top `first` points; the rest and the actions open on request so the card stays short. */
export default function TbNewsCard({ news, first = 3, flat }: { news: TbNews | null; first?: number; flat?: boolean }) {
  const [more, setMore] = useState(false);
  if (!news) return null;
  const points = more ? news.points : news.points.slice(0, first);
  const hidden = news.points.length - points.length + (more ? 0 : news.actions.length);
  return (
    <Wrap flat={flat}>
      <CardHeader title="Latest on TB" right={<span className="text-xs text-gray-500">AI summary · {fmtDate(news.generated_at)}</span>}
        subtitle={`Written by Gemini from ${news.articles} news articles of the last 45 days; every point links to its articles.`} />
      <p className="text-[15px] font-medium text-gray-900 mb-3">{news.headline}</p>
      <ul className="space-y-2.5">
        {points.map((p, i) => (
          <li key={i} className="text-sm text-gray-700">
            <span className={cx('inline-block text-[11px] font-medium px-1.5 py-px rounded mr-1.5 align-[1px]', SCOPE_CLS[p.scope] || SCOPE_CLS.Global)}>{p.scope}</span>
            {p.text}{' '}
            <span className="inline-flex flex-wrap gap-x-2 text-xs">{p.sources.slice(0, 2).map((s) => <ExtLink key={s.url} href={s.url}>{s.source || 'Source'}</ExtLink>)}</span>
          </li>
        ))}
      </ul>
      {more && news.actions.length > 0 && (
        <div className="mt-4 rounded-xl bg-gray-50 p-3">
          <div className="text-xs font-medium text-gray-500 mb-1.5">What to do</div>
          <ul className="space-y-1.5">{news.actions.map((a, i) => <li key={i} className="text-sm text-gray-800"><span className="font-medium">{a.who}:</span> {a.action}<span className="block text-xs text-gray-500">{a.why}</span></li>)}</ul>
        </div>
      )}
      {(hidden > 0 || more) && <button type="button" className="text-sm text-brand-700 hover:underline mt-3" onClick={() => setMore(!more)}>{more ? 'Show less' : `Show all${news.actions.length ? ' and what to do' : ''}`}</button>}
    </Wrap>
  );
}

/** A normal card, or the flatter panel style used beside the TB map. */
const Wrap = ({ flat, children }: { flat?: boolean; children: React.ReactNode }) =>
  flat ? <section className="rounded-2xl border border-gray-200 bg-white p-5">{children}</section> : <Card>{children}</Card>;
