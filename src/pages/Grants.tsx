import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, useMe } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Drawer, Empty, ExtLink, Field, KpiCard, Modal, Progress, SectionLabel, Segmented, Select, TextArea, TextInput, cx } from '../components/ui';
import { FilterBar, Filters, defaultFilters, inWindow, matchesPlace } from '../components/Filters';
import WorldMap, { MapPoint } from '../components/WorldMap';
import ChartCard from '../components/ChartCard';
import Checkpoints from '../components/Checkpoints';
import { Attachments, Comments } from '../components/Collab';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { DEMO, db, loadGrants } from '../lib/store';
import { FIT_OPTIONS, fitScore, parseCountries, parseDeadline, pipelineId } from '../lib/pipeline';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate, fmtTime, fmtUsd, relDays, scoreTone } from '../lib/format';
import { peopleOptions, personName, usePeople } from '../lib/team';
import type { Country, Grant, GrantCheckpoint, GrantTracking } from '../lib/types';
import { checkpointDone } from '../lib/projects';

type Tracked = GrantTracking & { id: string };
const STATUS: { value: GrantTracking['status']; label: string; cls: string }[] = [
  { value: 'watching', label: 'Watching', cls: 'bg-gray-100 text-gray-700' },
  { value: 'pursuing', label: 'Pursuing', cls: 'bg-brand-50 text-brand-700' },
  { value: 'submitted', label: 'Submitted', cls: 'bg-blue-50 text-blue-700' },
  { value: 'won', label: 'Won', cls: 'bg-green-50 text-green-700' },
  { value: 'lost', label: 'Not funded', cls: 'bg-red-50 text-red-700' },
  { value: 'dropped', label: 'Dropped', cls: 'bg-gray-100 text-gray-500' },
];
const statusOf = (s?: string) => STATUS.find((x) => x.value === s) || STATUS[0];
const STATUS_ORDER = ['submitted', 'pursuing', 'watching', 'won', 'lost', 'dropped'];
type View = 'pipeline' | 'discovered' | 'all';

/** Found by the daily grant scout (Gemini), rather than a raw feed like Grants.gov. */
export const isScout = (g: Grant) => String(g.source_id || '').startsWith('scout');
const isNew = (g: Grant) => isScout(g) && !g.curated && Date.now() - new Date(g.fetched_at).getTime() < 7 * 86400000;
/** Pipeline = the team's own entries, scout finds rated High/Medium, and anything the team is actively pursuing. */
function inPipeline(g: Grant, status?: string) {
  return !!g.curated || (isScout(g) && (g.score ?? 0) >= 55) || ['pursuing', 'submitted', 'won'].includes(status || '');
}

/** Upcoming deadlines first, then rolling / no date, then deadlines already passed. */
function dueKey(g: Grant) {
  const d = daysUntil(g.deadline);
  if (d === null) return '1';
  return d >= 0 ? `0${g.deadline}` : `2${g.deadline}`;
}

export function deadlineLabel(g: Grant) {
  if (g.deadline) return fmtDate(g.deadline);
  return g.deadline_text ? g.deadline_text.split(/[;(]/)[0].trim() : 'No deadline';
}

function FitBadge({ g }: { g: Grant }) {
  if (g.fit) {
    const cls = /^high/i.test(g.fit) ? 'bg-green-50 text-green-700' : /^medium/i.test(g.fit) ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-600';
    return <Badge className={cls}>{g.fit}</Badge>;
  }
  if (g.score == null) return <span className="text-gray-400 text-sm">—</span>;
  return <Badge className={scoreTone(g.score).cls}>{g.score} · {scoreTone(g.score).label}</Badge>;
}

export function newTracking(g: Grant): Tracked {
  return {
    id: g.id, grant_id: g.id, assignee: null, status: 'watching',
  };
}

export function placeLabel(iso: string[], countries: Country[]) {
  if (!iso?.length) return '—';
  if (iso.includes('GLOBAL')) return 'Global';
  const names = iso.map((i) => countries.find((c) => c.iso3 === i)?.name || i);
  return names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3}` : names.join(', ');
}

export default function GrantsPage() {
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const feed = useData(loadGrants, [], { items: [], updated_at: null });
  const tracking = useData(() => db.list<Tracked>('grant_tracking'), [], []);
  const gcps = useData(() => db.list<GrantCheckpoint>('grant_checkpoints'), [], []);
  const [f, setF] = useState<Filters>({ ...defaultFilters, range: 'all' });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [view, setView] = useState<View>('pipeline');
  const [adding, setAdding] = useState(false);
  const [fit, setFit] = useState('');
  const [openId, setOpenIdState] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    const o = params.get('open');
    if (o) setOpenIdState(o);
  }, [params]);
  const setOpenId = (id: string | null) => {
    setOpenIdState(id);
    if (!id && params.get('open')) setParams({}, { replace: true });
  };
  const me = useMe();

  const tMap = useMemo(() => new Map(tracking.data.map((t) => [t.grant_id, t])), [tracking.data]);
  const grants = feed.data.items;

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return grants
      .filter((g) => view === 'all' || (view === 'pipeline') === inPipeline(g, tMap.get(g.id)?.status))
      .filter((g) => inWindow(g.deadline, f, true))
      .filter((g) => matchesPlace(g.countries, f, countries))
      .filter((g) => !ql || `${g.title} ${g.funder} ${g.summary} ${(g.themes || []).join(' ')} ${g.sector || ''} ${g.notes || ''}`.toLowerCase().includes(ql))
      .filter((g) => {
        const st = tMap.get(g.id)?.status || 'watching';
        return !status || (status === 'active' ? !['dropped', 'lost'].includes(st) : st === status);
      })
      .filter((g) => !fit || (fit === 'strong' ? (g.score ?? -1) >= 70 : fit === 'possible' ? (g.score ?? -1) >= 45 : true))
      .sort((a, b) =>
        view === 'pipeline'
          ? STATUS_ORDER.indexOf(tMap.get(a.id)?.status || 'watching') - STATUS_ORDER.indexOf(tMap.get(b.id)?.status || 'watching') || dueKey(a).localeCompare(dueKey(b)) || (b.score ?? -1) - (a.score ?? -1)
          : (b.score ?? -1) - (a.score ?? -1) || (a.deadline || '9999').localeCompare(b.deadline || '9999')
      );
  }, [grants, f, q, status, fit, tMap, countries, view]);
  const counts = useMemo(() => {
    const p = grants.filter((g) => inPipeline(g, tMap.get(g.id)?.status)).length;
    return { pipeline: p, discovered: grants.length - p, fresh: grants.filter((g) => isNew(g) && (g.score ?? 0) >= 55).length };
  }, [grants, tMap]);

  const open = filtered.filter((g) => (daysUntil(g.deadline) ?? 1) >= 0);
  const closing30 = open.filter((g) => (daysUntil(g.deadline) ?? 999) <= 30);
  const strong = open.filter((g) => (g.score ?? 0) >= 70);
  const value = open.reduce((s, g) => s + (g.amount_usd || 0), 0);
  const pursuing = filtered.filter((g) => ['pursuing', 'submitted'].includes(tMap.get(g.id)?.status || ''));
  const mine = filtered.filter((g) => tMap.get(g.id)?.assignee === me.email);
  const submitted = filtered.filter((g) => tMap.get(g.id)?.status === 'submitted');
  const unassigned = filtered.filter((g) => !tMap.get(g.id)?.assignee && !['dropped', 'lost'].includes(tMap.get(g.id)?.status || ''));
  const rolling = open.filter((g) => !g.deadline);

  // Map: a bubble per country, sized by number of calls
  const points: MapPoint[] = useMemo(() => {
    const by = new Map<string, Grant[]>();
    for (const g of open) for (const c of g.countries || []) if (c !== 'GLOBAL') by.set(c, [...(by.get(c) || []), g]);
    return Array.from(by.entries())
      .map(([iso, list]) => {
        const c = countries.find((x) => x.iso3 === iso);
        if (!c) return null;
        const best = Math.max(...list.map((g) => g.score ?? 0));
        const sorted = [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
        return {
          id: iso, kind: 'Open calls', lng: c.lng, lat: c.lat, size: 5 + Math.min(14, Math.sqrt(list.length) * 4), color: best >= 70 ? '#316d6e' : best >= 45 ? '#eda100' : '#9ca3af',
          label: `${c.name}: ${list.length} open call${list.length > 1 ? 's' : ''}`, sub: `Best fit ${best || 'not scored'} · list below is now filtered to ${c.name}`,
          items: sorted.map((g) => ({ label: g.title, href: `#/grants?open=${g.id}`, meta: `${g.fit ? `${g.fit} fit · ` : g.score != null ? `fit ${g.score} · ` : ''}${deadlineLabel(g)}` })),
        } as MapPoint;
      })
      .filter(Boolean) as MapPoint[];
  }, [open, countries]);
  // Country fills by best fit, plus a hover summary and a focus point on the busiest country
  const FIT = { strong: '#5aa5a6', possible: '#f3c766', weak: '#b8bec6' };
  const { fills, fillLabels, focus } = useMemo(() => {
    const fills: Record<string, string> = {};
    const fillLabels: Record<string, string> = {};
    let top: [string, number] = ['', 0];
    const by = new Map<string, Grant[]>();
    for (const g of open) for (const c of g.countries || []) if (c !== 'GLOBAL') by.set(c, [...(by.get(c) || []), g]);
    by.forEach((list, iso) => {
      const best = Math.max(...list.map((g) => g.score ?? 0));
      fills[iso] = best >= 70 ? FIT.strong : best >= 45 ? FIT.possible : FIT.weak;
      fillLabels[iso] = `${list.length} open call${list.length > 1 ? 's' : ''} · best fit ${best || 'not scored'} · click to filter`;
      if (list.length > top[1]) top = [iso, list.length];
    });
    const c = countries.find((x) => x.iso3 === (f.country || top[0]));
    return { fills, fillLabels, focus: c ? ([c.lng, c.lat] as [number, number]) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, countries, f.country]);
  const globalCount = open.filter((g) => g.countries?.includes('GLOBAL')).length;

  // Charts
  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() + i, 1));
  }, []);
  const byMonth = months.map((m) => open.filter((g) => g.deadline && new Date(g.deadline).getFullYear() === m.getFullYear() && new Date(g.deadline).getMonth() === m.getMonth()));
  const bySource = Array.from(new Set(open.map((g) => g.source_name))).map((s) => ({ s, n: open.filter((g) => g.source_name === s).length })).sort((a, b) => b.n - a.n).slice(0, 6);

  const selected = grants.find((g) => g.id === openId) || null;

  return (
    <>
      <PageHeader
        title="Funds & Grants"
        subtitle="A scout runs every morning: Gemini searches the web and funder pages, writes up open calls and rates fit the way the team does"
        updatedAt={feed.data.updated_at}
        actions={<Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Add opportunity</Button>}
      />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <Segmented value={view} onChange={(v) => { setView(v); setStatus(v === 'discovered' ? '' : 'active'); }} options={[
          { value: 'pipeline', label: `Pipeline (${counts.pipeline})` },
          { value: 'discovered', label: `Discovered (${counts.discovered})` },
          { value: 'all', label: 'All' },
        ]} />
        <span className="text-sm text-gray-500">{view === 'pipeline' ? `The team's opportunities plus High/Medium-fit calls the scout found${counts.fresh ? ` · ${counts.fresh} new this week` : ''}. Mark ones that don't fit as "Not relevant" and the scout learns from it.` : view === 'discovered' ? 'Lower-fit scout finds and raw listings from Grants.gov, NIH and UKRI. Add any good ones to the pipeline.' : ''}</span>
      </div>
      <FilterBar value={f} onChange={setF} countries={countries} rangeNames={{ '7': 'Closing 7d', '30': 'Closing 30d', '90': 'Closing 90d', all: 'All deadlines' }}>
        <Select className="w-[180px]" value={status} onChange={setStatus} placeholder="All statuses" options={[{ value: 'active', label: 'Active (not dropped)' }, ...STATUS.map((s) => ({ value: s.value, label: s.label }))]} />
        <Select className="w-[170px]" value={fit} onChange={setFit} placeholder="Any fit" options={[{ value: 'strong', label: 'High fit' }, { value: 'possible', label: 'Medium fit or better' }]} />
        <div className="relative">
          <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <TextInput placeholder="Search funder, call, notes" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-[220px]" />
        </div>
      </FilterBar>

      <Card className="mb-6">
        <SectionLabel>{view === 'pipeline' ? 'Active opportunities in view' : 'Open calls in view'}</SectionLabel>
        <div className="text-[44px] font-semibold text-gray-900 mt-3 leading-none tabular-nums">{feed.loading ? '—' : open.length}</div>
        <p className="text-[17px] text-gray-600 mt-4">
          {pursuing.length} pursuing or submitted · {counts.pipeline} in the team pipeline · {counts.discovered} discovered · last fetch {fmtTime(feed.data.updated_at)}
        </p>
        <Progress className="mt-5" value={open.length ? (pursuing.length / open.length) * 100 : 0} />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard icon="clock" label="Closing in 30 days" value={closing30.length} foot="act on these first" onClick={() => setF({ ...f, range: '30' })} />
        <KpiCard icon="target" tint="green" label="High fit" value={strong.length} foot={view === 'pipeline' ? 'team rating' : 'Gemini score 70+'} onClick={() => setFit('strong')} />
        {view === 'discovered' ? (
          <KpiCard icon="dollar" tint="orange" label="Funding available" value={fmtUsd(value)} foot="where amount is stated" />
        ) : (
          <KpiCard icon="checkCircle" tint="orange" label="Submitted" value={submitted.length} foot="awaiting review" onClick={() => setStatus('submitted')} />
        )}
        <KpiCard icon="flag" tint="purple" label="Pursuing" value={pursuing.length} foot="pursuing + submitted" onClick={() => setStatus('pursuing')} />
        <KpiCard icon="user" tint="blue" label={view === 'pipeline' ? 'No owner yet' : 'Assigned to me'} value={view === 'pipeline' ? unassigned.length : mine.length} foot={view === 'pipeline' ? 'needs a POC' : undefined} />
        <KpiCard icon="clock" tint="gray" label="Rolling / no fixed date" value={rolling.length} foot={`${globalCount} open worldwide`} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6 mb-6">
        <Card>
          <CardHeader title="Where the money is" subtitle="Open calls by eligible country · teal = strong fit, amber = possible, grey = weak or unscored. Click a country to filter." />
          <WorldMap geo={world?.geo || null} points={points} fills={fills} fillLabels={fillLabels} focus={focus} legend={[{ color: FIT.strong, label: 'Strong fit (70+)' }, { color: FIT.possible, label: 'Possible fit (45–69)' }, { color: FIT.weak, label: 'Weak fit or not scored' }]} overlay={globalCount ? <button type="button" onClick={() => setF({ ...f, country: '', region: '' })} className="bg-white/95 border border-gray-200 rounded-lg px-2.5 py-1 text-xs text-gray-700 shadow-card hover:border-brand-300">+ {globalCount} global / multi-country call{globalCount > 1 ? 's' : ''}</button> : undefined} selected={f.country || null} onPointClick={(iso) => setF({ ...f, country: iso })} onCountryClick={(iso) => setF({ ...f, country: f.country === iso ? '' : iso })} height={440} />
        </Card>
        <Card className="flex flex-col">
          <CardHeader title={view === 'pipeline' ? 'Up next' : 'Latest deals'} subtitle={view === 'pipeline' ? 'Nearest deadlines first, then rolling' : 'Newest first'} />
          <div className="flex-1 overflow-y-auto -mx-2 max-h-[440px]">
            {[...open].sort((a, b) => (view === 'pipeline' ? dueKey(a).localeCompare(dueKey(b)) : (b.open_date || b.fetched_at).localeCompare(a.open_date || a.fetched_at))).slice(0, 25).map((g) => (
              <button key={g.id} type="button" onClick={() => setOpenId(g.id)} className="w-full text-left px-2 py-3 rounded-xl hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <div className="flex items-start gap-2 min-w-0">
                  <span className="font-medium text-gray-900 text-[15px] leading-snug line-clamp-2 flex-1 min-w-0">{g.title}</span>
                  <FitBadge g={g} />
                </div>
                <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-3">
                  <span>{g.funder}</span>
                  <span>{g.amount_text || fmtUsd(g.amount_usd)}</span>
                  <span className={cx((daysUntil(g.deadline) ?? 99) <= 14 && 'text-red-600')}>{g.deadline ? `Due ${fmtDate(g.deadline)}` : deadlineLabel(g)}</span>
                  {tMap.get(g.id)?.assignee && <span>· {personName(tMap.get(g.id)?.assignee)}</span>}
                </div>
              </button>
            ))}
            {!feed.loading && open.length === 0 && (
              <Empty icon="coins" title="No open calls in view">
                {grants.length ? 'Loosen the filters, or switch view above.' : 'The scout runs every morning; you can also add an opportunity yourself.'}
              </Empty>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Deadlines by month" subtitle="Open calls closing each month, next 6 months" labels={months.map((m) => m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))} series={[{ name: 'Calls closing', values: byMonth.map((l) => l.length) }]} modes={['bars', 'line', 'area']} />
        {view === 'pipeline' ? (
          <ChartCard title="Pipeline by status" subtitle="Opportunities in view" labels={STATUS.map((s) => s.label)} series={[{ name: 'Opportunities', values: STATUS.map((s) => filtered.filter((g) => (tMap.get(g.id)?.status || 'watching') === s.value).length) }]} modes={['bars', 'donut']} />
        ) : (
          <ChartCard title="Calls by source" subtitle="Where open calls in view came from" labels={bySource.map((x) => x.s)} series={[{ name: 'Open calls', values: bySource.map((x) => x.n) }]} modes={['bars', 'donut']} />
        )}
      </div>

      <Card pad={false}>
        <div className="p-6 pb-3">
          <CardHeader title={view === 'pipeline' ? 'Pipeline' : 'Funds & grants directory'} subtitle={`${filtered.length} opportunities · ${view === 'pipeline' ? 'submitted and pursuing first, then by deadline' : 'sorted by fit, then deadline'}`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="font-medium px-6 py-3">Opportunity</th>
                <th className="font-medium px-3 py-3">Amount</th>
                <th className="font-medium px-3 py-3">Deadline</th>
                <th className="font-medium px-3 py-3">Where</th>
                <th className="font-medium px-3 py-3">Fit</th>
                <th className="font-medium px-3 py-3">POC</th>
                <th className="font-medium px-3 py-3">Stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const t = tMap.get(g.id);
                const st = statusOf(t?.status);
                const cps = gcps.data.filter((c) => c.grant_id === g.id).sort((a, b) => a.position - b.position);
                const nextCp = cps.find((c) => !checkpointDone(c));
                const d = daysUntil(g.deadline);
                return (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(g.id)}>
                    <td className="px-6 py-3 min-w-[300px] max-w-[460px]">
                      <div className="font-medium text-gray-900 line-clamp-2" title={g.title}>{g.title}</div>
                      <div className="text-sm text-gray-500 line-clamp-1">
                        {isNew(g) && <span className="mr-1.5 rounded bg-brand-600 px-1.5 py-px text-[11px] font-semibold text-white align-[1px]">NEW</span>}
                        {g.funder}{g.sector ? ` · ${g.sector}` : !g.curated ? ` · ${g.source_name}` : ''}
                      </div>
                    </td>
                    <td className="px-3 py-3 tabular-nums max-w-[200px]"><span className="line-clamp-2 text-sm">{g.amount_text || fmtUsd(g.amount_usd)}</span></td>
                    <td className={cx('px-3 py-3 whitespace-nowrap', d !== null && d < 0 ? 'text-gray-400' : d !== null && d <= 14 ? 'text-red-600' : '')}>
                      <span className="block max-w-[180px] truncate" title={g.deadline_text || ''}>{deadlineLabel(g)}</span>
                      {g.deadline && <div className="text-xs text-gray-500">{relDays(g.deadline)}</div>}
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-[180px] truncate">{placeLabel(g.countries, countries)}</td>
                    <td className="px-3 py-3"><FitBadge g={g} /></td>
                    <td className="px-3 py-3 text-sm whitespace-nowrap">{personName(t?.assignee)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Badge className={st.cls}>{st.label}</Badge>
                      {cps.length > 0 && <div className="text-xs text-gray-500 mt-1 max-w-[180px] truncate" title={nextCp?.title}>{nextCp ? `Next: ${nextCp.title}${nextCp.target_date ? ` · ${fmtDate(nextCp.target_date)}` : ''}` : 'All checkpoints done'}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!feed.loading && filtered.length === 0 && <Empty icon="coins" title="No calls match these filters" />}
        </div>
      </Card>

      <GrantDrawer grant={selected} tracking={selected ? tMap.get(selected.id) : undefined} checkpoints={selected ? gcps.data.filter((c) => c.grant_id === selected.id) : []} countries={countries} onClose={() => setOpenId(null)} />
      {adding && <GrantForm countries={countries} onClose={() => setAdding(false)} onSaved={(id) => { setAdding(false); setView('pipeline'); setOpenId(id); }} />}
    </>
  );
}

function ScoreRing({ score }: { score?: number | null }) {
  const s = score ?? 0;
  const r = 34;
  const c = 2 * Math.PI * r;
  const tone = s >= 70 ? '#0ca30c' : s >= 45 ? '#eda100' : '#9ca3af';
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`Suitability ${score ?? 'not scored'}`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="#eef0f2" strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke={tone} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${(s / 100) * c} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" fontSize="22" fontWeight="600" fill="#111827">{score ?? '—'}</text>
    </svg>
  );
}

function GrantDrawer({ grant, tracking, checkpoints, countries, onClose }: { grant: Grant | null; tracking?: Tracked; checkpoints: GrantCheckpoint[]; countries: Country[]; onClose: () => void }) {
  if (!grant) return null;
  const t = tracking || newTracking(grant);
  const save = (patch: Partial<Tracked>) => db.upsert<Tracked>('grant_tracking', { ...t, ...patch, updated_at: new Date().toISOString() });
  const tone = scoreTone(grant.score);
  return <GrantDrawerBody grant={grant} t={t} tracking={tracking} checkpoints={checkpoints} save={save} tone={tone} countries={countries} onClose={onClose} />;
}

function GrantDrawerBody({ grant, t, tracking, checkpoints, save, tone, countries, onClose }: any) {
  const me = useMe();
  const people = usePeople();
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(grant.notes || '');
  useEffect(() => setNotes(grant.notes || ''), [grant.id, grant.notes]);
  const saveGrant = (patch: Partial<Grant>) => db.upsert('grants' as any, { ...grant, ...patch, updated_at: new Date().toISOString() } as any);
  return (
    <Drawer
      open
      onClose={onClose}
      title={grant.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{grant.funder}</span>
          {/^https?:\/\/.+\..+/.test(grant.url) && <ExtLink href={grant.url}>Open call page</ExtLink>}
          <Badge className={grant.curated ? 'bg-brand-50 text-brand-700' : 'bg-gray-100 text-gray-600'}>{grant.curated ? 'Added by the team' : isScout(grant) ? `Found by the scout · ${fmtTime(grant.fetched_at)}` : `Discovered · ${grant.source_name}`}</Badge>
        </span>
      }
    >
      <div className="flex flex-wrap gap-2 -mt-1">
        {grant.curated ? (
          <Button icon="edit" onClick={() => setEditing(true)}>Edit details</Button>
        ) : (
          <Button variant="primary" icon="plus" onClick={() => saveGrant({ curated: true, added_by: me.email })}>{isScout(grant) && (grant.score ?? 0) >= 55 ? 'Keep in pipeline' : 'Add to pipeline'}</Button>
        )}
        {!grant.curated && t.status !== 'dropped' && <Button icon="x" onClick={() => save({ status: 'dropped' })}>Not relevant</Button>}
        {grant.curated && <Button variant="ghost" onClick={() => saveGrant({ curated: false })}>Remove from pipeline</Button>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Amount', grant.amount_text || fmtUsd(grant.amount_usd)],
          ['Deadline', grant.deadline ? `${fmtDate(grant.deadline)} · ${relDays(grant.deadline)}` : deadlineLabel(grant)],
          ['Where', grant.geography || placeLabel(grant.countries, countries)],
          [grant.curated ? 'Team fit' : 'Fit', grant.fit || (grant.score != null ? `${grant.score} / 100` : '—')],
        ].map(([k, v]) => (
          <div key={k} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">{k}</div>
            <div className="font-medium text-gray-900 mt-0.5 text-[15px] line-clamp-3" title={String(v)}>{v}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="Summary" />
        <p className="text-[15px] text-gray-700 leading-relaxed">{grant.summary || 'No summary yet.'}</p>
        {grant.deadline_text && grant.deadline_text !== deadlineLabel(grant) && <p className="text-sm text-gray-500 mt-3">Deadline note: {grant.deadline_text}</p>}
        {grant.sector && <p className="text-sm text-gray-500 mt-1">Sector: {grant.sector}</p>}
        {(grant.eligible_as || grant.eligibility || grant.requirements) && (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <SectionLabel>Eligible as</SectionLabel>
              <p className="text-[15px] text-gray-700 mt-1.5 whitespace-pre-line">{grant.eligible_as || grant.eligibility || '—'}</p>
            </div>
            <div>
              <SectionLabel>Key requirements / notes</SectionLabel>
              <p className="text-[15px] text-gray-700 mt-1.5 whitespace-pre-line">{grant.requirements || '—'}</p>
            </div>
          </div>
        )}
        {grant.themes?.length ? (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {grant.themes.map((th: string) => (
              <Badge key={th} className="bg-gray-100 text-gray-700">{th}</Badge>
            ))}
          </div>
        ) : null}
      </Card>

      {grant.curated && (
        <Card>
          <CardHeader title="Team notes" subtitle="Internal: approach, contacts, past grantees, open questions" right={notes !== (grant.notes || '') ? <Button variant="primary" className="h-9" onClick={() => saveGrant({ notes })}>Save notes</Button> : undefined} />
          <TextArea rows={Math.min(14, Math.max(4, notes.split('\n').length + 1))} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Suggested approach, focus areas, past grantees, contacts…" />
        </Card>
      )}

      {!grant.curated && (
      <Card>
        <CardHeader title="Suitability" subtitle={isScout(grant) ? "Gemini's rating, calibrated on how the team rated past opportunities and the Org Context page" : 'Scored by Gemini against the Org Context page (past work, strengths, geographies)'} right={grant.fit ? <FitBadge g={grant} /> : <Badge className={tone.cls}>{tone.label}</Badge>} />
        <div className="flex gap-5 items-start">
          <ScoreRing score={grant.score} />
          <div className="flex-1 text-[15px] text-gray-700">{grant.score_reason || 'Not scored yet. Scores appear after the next grants run with a Gemini key.'}</div>
        </div>
        {(grant.strengths?.length || grant.weaknesses?.length) ? (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <SectionLabel>Strengths</SectionLabel>
              <ul className="mt-2 space-y-1.5">
                {(grant.strengths || []).map((s: string) => (
                  <li key={s} className="flex gap-2 text-[15px] text-gray-700"><Icon name="checkCircle" size={17} className="text-green-600 mt-0.5 shrink-0" />{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel>Weaknesses / gaps</SectionLabel>
              <ul className="mt-2 space-y-1.5">
                {(grant.weaknesses || []).map((s: string) => (
                  <li key={s} className="flex gap-2 text-[15px] text-gray-700"><Icon name="alert" size={17} className="text-amber-600 mt-0.5 shrink-0" />{s}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Card>
      )}

      <Card>
        <CardHeader title="Pursuit" subtitle="Assign a POC, set the status, and plan the checkpoints to the decision" />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <Field label="POC">
            <Select value={t.assignee || ''} onChange={(v) => save({ assignee: v || null, status: v && t.status === 'watching' ? 'pursuing' : t.status })} placeholder="Unassigned" options={peopleOptions(people, t.assignee, true)} />
          </Field>
          <Field label="Status">
            <Select value={t.status} onChange={(v) => save({ status: v as GrantTracking['status'] })} options={STATUS.map((s) => ({ value: s.value, label: s.label }))} />
          </Field>
        </div>
        <div className="border-t border-gray-100 pt-4">
          <Checkpoints
            key={grant.id}
            items={checkpoints}
            table="grant_checkpoints"
            base={{ grant_id: grant.id }}
            onProgress={() => { if (!tracking) save({ status: t.status === 'watching' ? 'pursuing' : t.status }); }}
            suggestions={['Concept note', 'Full proposal', 'Submission', 'Review', 'Decision']}
            hint="Add checkpoints with a target date, owner and what needs doing — e.g. concept note, proposal, submission, review."
          />
        </div>
        {!tracking && <p className="text-xs text-gray-500 mt-3">Nothing saved yet. Any change above starts tracking this call.</p>}
      </Card>

      <Attachments entityType="grant" entityId={grant.id} subtitle="Concept notes, budgets, eligibility letters, partner LOIs" />
      <Comments entityType="grant" entityId={grant.id} />
      <div className="flex justify-end">
        {/^https?:\/\/.+\..+/.test(grant.url) && <Button icon="external" onClick={() => window.open(grant.url, '_blank', 'noreferrer')}>Open original call</Button>}
      </div>
      {editing && <GrantForm grant={grant} countries={countries} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </Drawer>
  );
}

/* ---------------- Add / edit an opportunity ---------------- */

function GrantForm({ grant, countries, onClose, onSaved }: { grant?: Grant; countries: Country[]; onClose: () => void; onSaved: (id: string) => void }) {
  const me = useMe();
  const [g, setG] = useState<Partial<Grant>>(grant || { curated: true, countries: ['GLOBAL'] });
  const [err, setErr] = useState<string | null>(null);
  const set = (patch: Partial<Grant>) => setG({ ...g, ...patch });
  const save = async () => {
    if (!g.title?.trim() || !g.funder?.trim()) return setErr('Funder and opportunity name are needed.');
    const id = grant?.id || pipelineId(g.funder!, g.title!);
    const deadline = g.deadline || parseDeadline(g.deadline_text) || null;
    const row: Grant = {
      ...(grant || {}),
      id, title: g.title!.trim(), funder: g.funder!.trim(), summary: g.summary || '', amount_text: g.amount_text || null, amount_usd: grant?.amount_usd ?? null,
      deadline, deadline_text: g.deadline_text || null, sector: g.sector || null, fit: g.fit || null, score: fitScore(g.fit) ?? grant?.score ?? null,
      score_reason: g.fit ? `Team rating: ${g.fit}` : grant?.score_reason, eligible_as: g.eligible_as || null, eligibility: g.eligible_as || grant?.eligibility || undefined,
      requirements: g.requirements || undefined, geography: g.geography || null, countries: parseCountries(g.geography, countries), url: g.url || 'https://',
      notes: g.notes || null, curated: true, source_id: grant?.source_id || 'manual', source_name: grant?.source_name || 'Team pipeline',
      fetched_at: grant?.fetched_at || new Date().toISOString(), added_by: grant?.added_by || me.email, updated_at: new Date().toISOString(),
    } as Grant;
    try {
      await db.upsert('grants' as any, row as any);
      onSaved(id);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  };
  const input = (label: string, key: keyof Grant, placeholder = '') => (
    <Field label={label}><TextInput className="w-full" value={(g[key] as string) || ''} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as any)} /></Field>
  );
  return (
    <Modal open onClose={onClose} title={grant ? 'Edit opportunity' : 'Add an opportunity'} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        {input('Donor / funder', 'funder', 'e.g. Rockefeller Foundation + OpenAI')}
        {input('Opportunity name', 'title', 'e.g. Cities Deliver: AI Solutions…')}
        {input('Funding range', 'amount_text', 'e.g. $500K–$2M per grant')}
        {input('Deadline', 'deadline_text', 'e.g. 29 Nov 2026, or Rolling')}
        {input('Sector focus', 'sector', 'e.g. Healthcare (surveillance)')}
        {input('Geography focus', 'geography', 'e.g. Rwanda, Kenya, or Global')}
        <Field label="WAIG fit"><Select value={g.fit || ''} onChange={(v) => set({ fit: v })} placeholder="Not rated" options={FIT_OPTIONS.map((o) => ({ value: o, label: o }))} /></Field>
        {input('Eligible as', 'eligible_as', 'e.g. NPO or PLC')}
      </div>
      {input('Link', 'url', 'https://…')}
      <Field label="Brief description"><TextArea rows={3} value={g.summary || ''} onChange={(e) => set({ summary: e.target.value })} /></Field>
      <Field label="Key requirements / notes"><TextArea rows={3} value={g.requirements || ''} onChange={(e) => set({ requirements: e.target.value })} /></Field>
      {err && <p className="text-sm text-red-600">{err}</p>}
    </Modal>
  );
}

