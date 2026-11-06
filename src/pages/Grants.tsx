import React, { useMemo, useState } from 'react';
import { PageHeader, useMe } from '../components/Layout';
import { Badge, Button, Card, CardHeader, Drawer, Empty, ExtLink, Field, KpiCard, Progress, SectionLabel, Select, TextInput, cx } from '../components/ui';
import { FilterBar, Filters, defaultFilters, inWindow, matchesPlace } from '../components/Filters';
import WorldMap, { MapPoint } from '../components/WorldMap';
import ChartCard from '../components/ChartCard';
import Stepper from '../components/Stepper';
import { Attachments, Comments } from '../components/Collab';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db, loadGrants } from '../lib/store';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate, fmtTime, fmtUsd, relDays, scoreTone } from '../lib/format';
import { GRANT_STAGES, TEAM, personName } from '../lib/team';
import type { Country, Grant, GrantTracking } from '../lib/types';

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

export function newTracking(g: Grant): Tracked {
  return {
    id: g.id, grant_id: g.id, assignee: null, stage: 'submission', status: 'watching',
    milestones: GRANT_STAGES.map((s) => ({ key: s.key, label: s.label, target: s.key === 'submission' ? g.deadline || null : null, done_at: null })),
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
  const [f, setF] = useState<Filters>({ ...defaultFilters, range: 'all' });
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [fit, setFit] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const me = useMe();

  const tMap = useMemo(() => new Map(tracking.data.map((t) => [t.grant_id, t])), [tracking.data]);
  const grants = feed.data.items;

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return grants
      .filter((g) => inWindow(g.deadline, f, true))
      .filter((g) => matchesPlace(g.countries, f, countries))
      .filter((g) => !ql || `${g.title} ${g.funder} ${g.summary} ${(g.themes || []).join(' ')}`.toLowerCase().includes(ql))
      .filter((g) => !status || (tMap.get(g.id)?.status || 'watching') === status)
      .filter((g) => !fit || (fit === 'strong' ? (g.score ?? -1) >= 70 : fit === 'possible' ? (g.score ?? -1) >= 45 : true))
      .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  }, [grants, f, q, status, fit, tMap, countries]);

  const open = filtered.filter((g) => (daysUntil(g.deadline) ?? 1) >= 0);
  const closing30 = open.filter((g) => (daysUntil(g.deadline) ?? 999) <= 30);
  const strong = open.filter((g) => (g.score ?? 0) >= 70);
  const value = open.reduce((s, g) => s + (g.amount_usd || 0), 0);
  const pursuing = filtered.filter((g) => ['pursuing', 'submitted'].includes(tMap.get(g.id)?.status || ''));
  const mine = filtered.filter((g) => tMap.get(g.id)?.assignee === me.email);

  // Map: a bubble per country, sized by number of calls
  const points: MapPoint[] = useMemo(() => {
    const by = new Map<string, Grant[]>();
    for (const g of open) for (const c of g.countries || []) if (c !== 'GLOBAL') by.set(c, [...(by.get(c) || []), g]);
    return Array.from(by.entries())
      .map(([iso, list]) => {
        const c = countries.find((x) => x.iso3 === iso);
        if (!c) return null;
        const best = Math.max(...list.map((g) => g.score ?? 0));
        return { id: iso, lng: c.lng, lat: c.lat, size: 5 + Math.min(14, Math.sqrt(list.length) * 4), color: best >= 70 ? '#316d6e' : best >= 45 ? '#eda100' : '#9ca3af', label: `${c.name}: ${list.length} open call${list.length > 1 ? 's' : ''}`, sub: `Best fit ${best || '—'}` } as MapPoint;
      })
      .filter(Boolean) as MapPoint[];
  }, [open, countries]);
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
      <PageHeader title="Funds & Grants" subtitle="Open calls, scored against our past work and refreshed every 12 hours" updatedAt={feed.data.updated_at} />
      <FilterBar value={f} onChange={setF} countries={countries} rangeNames={{ '7': 'Closing 7d', '30': 'Closing 30d', '90': 'Closing 90d', all: 'All deadlines' }}>
        <Select className="w-[180px]" value={status} onChange={setStatus} placeholder="All statuses" options={STATUS.map((s) => ({ value: s.value, label: s.label }))} />
        <Select className="w-[170px]" value={fit} onChange={setFit} placeholder="Any fit" options={[{ value: 'strong', label: 'Strong fit (70+)' }, { value: 'possible', label: 'Possible fit (45+)' }]} />
        <div className="relative">
          <Icon name="search" size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <TextInput placeholder="Search calls" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 w-[220px]" />
        </div>
      </FilterBar>

      <Card className="mb-6">
        <SectionLabel>Open calls in view</SectionLabel>
        <div className="text-[44px] font-semibold text-gray-900 mt-3 leading-none tabular-nums">{feed.loading ? '—' : open.length}</div>
        <p className="text-[17px] text-gray-600 mt-4">
          {pursuing.length} pursuing or submitted · {grants.length} tracked in total · last fetch {fmtTime(feed.data.updated_at)}
        </p>
        <Progress className="mt-5" value={open.length ? (pursuing.length / open.length) * 100 : 0} />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard icon="clock" label="Closing in 30 days" value={closing30.length} foot="act on these first" onClick={() => setF({ ...f, range: '30' })} />
        <KpiCard icon="target" tint="green" label="Strong fit (70+)" value={strong.length} foot="Gemini suitability score" onClick={() => setFit('strong')} />
        <KpiCard icon="dollar" tint="orange" label="Funding available" value={fmtUsd(value)} foot="where amount is stated" />
        <KpiCard icon="flag" tint="purple" label="Pursuing" value={pursuing.length} foot="pursuing + submitted" onClick={() => setStatus('pursuing')} />
        <KpiCard icon="user" tint="blue" label="Assigned to me" value={mine.length} />
        <KpiCard icon="globe" tint="gray" label="Global / multi-country" value={globalCount} foot="not tied to one country" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6 mb-6">
        <Card>
          <CardHeader title="Where the money is" subtitle="Open calls by eligible country · teal = strong fit, amber = possible, grey = weak or unscored. Click a country to filter." />
          <WorldMap geo={world?.geo || null} points={points} selected={f.country || null} onPointClick={(iso) => setF({ ...f, country: iso })} onCountryClick={(iso) => setF({ ...f, country: f.country === iso ? '' : iso })} height={440} />
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Latest deals" subtitle="Newest first" />
          <div className="flex-1 overflow-y-auto -mx-2 max-h-[440px]">
            {[...open].sort((a, b) => (b.open_date || b.fetched_at).localeCompare(a.open_date || a.fetched_at)).slice(0, 25).map((g) => (
              <button key={g.id} type="button" onClick={() => setOpenId(g.id)} className="w-full text-left px-2 py-3 rounded-xl hover:bg-gray-50 border-b border-gray-100 last:border-0">
                <div className="flex items-start gap-2">
                  <span className="font-medium text-gray-900 text-[15px] leading-snug line-clamp-2 flex-1">{g.title}</span>
                  {g.score != null && <Badge className={scoreTone(g.score).cls}>{g.score}</Badge>}
                </div>
                <div className="text-sm text-gray-500 mt-1 flex flex-wrap gap-x-3">
                  <span>{g.funder}</span>
                  <span>{g.amount_text || fmtUsd(g.amount_usd)}</span>
                  <span className={cx((daysUntil(g.deadline) ?? 99) <= 14 && 'text-red-600')}>Due {fmtDate(g.deadline)}</span>
                </div>
              </button>
            ))}
            {!feed.loading && open.length === 0 && (
              <Empty icon="coins" title="No open calls in view">
                {grants.length ? 'Loosen the filters.' : 'The grants job has not run yet. It runs every 12 hours, or trigger it from GitHub Actions.'}
              </Empty>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        <ChartCard title="Deadlines by month" subtitle="Open calls closing each month, next 6 months" labels={months.map((m) => m.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }))} series={[{ name: 'Calls closing', values: byMonth.map((l) => l.length) }]} modes={['bars', 'line', 'area']} />
        <ChartCard title="Calls by source" subtitle="Where open calls in view came from" labels={bySource.map((x) => x.s)} series={[{ name: 'Open calls', values: bySource.map((x) => x.n) }]} modes={['bars', 'donut']} />
      </div>

      <Card pad={false}>
        <div className="p-6 pb-3">
          <CardHeader title="Funds & grants directory" subtitle={`${filtered.length} calls · sorted by fit, then deadline`} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[15px]">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-y border-gray-100 bg-gray-50/60">
                <th className="font-medium px-6 py-3">Call</th>
                <th className="font-medium px-3 py-3">Amount</th>
                <th className="font-medium px-3 py-3">Deadline</th>
                <th className="font-medium px-3 py-3">Where</th>
                <th className="font-medium px-3 py-3">Fit</th>
                <th className="font-medium px-3 py-3">Assignee</th>
                <th className="font-medium px-3 py-3">Stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((g) => {
                const t = tMap.get(g.id);
                const st = statusOf(t?.status);
                const stageIdx = t ? t.milestones.findIndex((m) => !m.done_at) : 0;
                const d = daysUntil(g.deadline);
                return (
                  <tr key={g.id} className="border-b border-gray-100 hover:bg-gray-50 cursor-pointer" onClick={() => setOpenId(g.id)}>
                    <td className="px-6 py-3 max-w-[420px]">
                      <div className="font-medium text-gray-900 line-clamp-1">{g.title}</div>
                      <div className="text-sm text-gray-500 line-clamp-1">{g.funder} · {g.source_name}</div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap tabular-nums">{g.amount_text || fmtUsd(g.amount_usd)}</td>
                    <td className={cx('px-3 py-3 whitespace-nowrap', d !== null && d < 0 ? 'text-gray-400' : d !== null && d <= 14 ? 'text-red-600' : '')}>
                      {fmtDate(g.deadline)}
                      <div className="text-xs text-gray-500">{relDays(g.deadline)}</div>
                    </td>
                    <td className="px-3 py-3 text-sm text-gray-600 max-w-[180px] truncate">{placeLabel(g.countries, countries)}</td>
                    <td className="px-3 py-3">{g.score != null ? <Badge className={scoreTone(g.score).cls}>{g.score} · {scoreTone(g.score).label}</Badge> : <span className="text-gray-400 text-sm">—</span>}</td>
                    <td className="px-3 py-3 text-sm whitespace-nowrap">{personName(t?.assignee)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <Badge className={st.cls}>{st.label}</Badge>
                      {t && t.status !== 'watching' && <div className="text-xs text-gray-500 mt-1">{stageIdx < 0 ? 'All stages done' : GRANT_STAGES[stageIdx]?.label}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!feed.loading && filtered.length === 0 && <Empty icon="coins" title="No calls match these filters" />}
        </div>
      </Card>

      <GrantDrawer grant={selected} tracking={selected ? tMap.get(selected.id) : undefined} countries={countries} onClose={() => setOpenId(null)} />
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

function GrantDrawer({ grant, tracking, countries, onClose }: { grant: Grant | null; tracking?: Tracked; countries: Country[]; onClose: () => void }) {
  if (!grant) return null;
  const t = tracking || newTracking(grant);
  const save = (patch: Partial<Tracked>) => db.upsert<Tracked>('grant_tracking', { ...t, ...patch, updated_at: new Date().toISOString() });
  const tone = scoreTone(grant.score);
  return (
    <Drawer
      open
      onClose={onClose}
      title={grant.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{grant.funder}</span>
          <ExtLink href={grant.url}>Open call ({grant.source_name})</ExtLink>
        </span>
      }
    >
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Amount', grant.amount_text || fmtUsd(grant.amount_usd)],
          ['Deadline', `${fmtDate(grant.deadline)} · ${relDays(grant.deadline)}`],
          ['Where', placeLabel(grant.countries, countries)],
          ['Fetched', fmtTime(grant.fetched_at)],
        ].map(([k, v]) => (
          <div key={k} className="bg-white border border-gray-200 rounded-xl p-3">
            <div className="text-xs text-gray-500">{k}</div>
            <div className="font-medium text-gray-900 mt-0.5 text-[15px]">{v}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader title="Summary" />
        <p className="text-[15px] text-gray-700 leading-relaxed">{grant.summary || 'No summary yet.'}</p>
        {(grant.eligibility || grant.requirements) && (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <SectionLabel>Eligibility</SectionLabel>
              <p className="text-[15px] text-gray-700 mt-1.5 whitespace-pre-line">{grant.eligibility || '—'}</p>
            </div>
            <div>
              <SectionLabel>Requirements</SectionLabel>
              <p className="text-[15px] text-gray-700 mt-1.5 whitespace-pre-line">{grant.requirements || '—'}</p>
            </div>
          </div>
        )}
        {grant.themes?.length ? (
          <div className="flex flex-wrap gap-1.5 mt-4">
            {grant.themes.map((th) => (
              <Badge key={th} className="bg-gray-100 text-gray-700">{th}</Badge>
            ))}
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Suitability" subtitle="Scored by Gemini against the Org Context page (past work, strengths, geographies)" right={<Badge className={tone.cls}>{tone.label}</Badge>} />
        <div className="flex gap-5 items-start">
          <ScoreRing score={grant.score} />
          <div className="flex-1 text-[15px] text-gray-700">{grant.score_reason || 'Not scored yet. Scores appear after the next grants run with a Gemini key.'}</div>
        </div>
        {(grant.strengths?.length || grant.weaknesses?.length) ? (
          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <div>
              <SectionLabel>Strengths</SectionLabel>
              <ul className="mt-2 space-y-1.5">
                {(grant.strengths || []).map((s) => (
                  <li key={s} className="flex gap-2 text-[15px] text-gray-700"><Icon name="checkCircle" size={17} className="text-green-600 mt-0.5 shrink-0" />{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <SectionLabel>Weaknesses / gaps</SectionLabel>
              <ul className="mt-2 space-y-1.5">
                {(grant.weaknesses || []).map((s) => (
                  <li key={s} className="flex gap-2 text-[15px] text-gray-700"><Icon name="alert" size={17} className="text-amber-600 mt-0.5 shrink-0" />{s}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </Card>

      <Card>
        <CardHeader title="Pursuit" subtitle="Self-managed: assign an owner, then tick stages as they happen" />
        <div className="grid md:grid-cols-2 gap-4 mb-4">
          <Field label="Assignee">
            <Select value={t.assignee || ''} onChange={(v) => save({ assignee: v || null, status: v && t.status === 'watching' ? 'pursuing' : t.status })} placeholder="Unassigned" options={TEAM.map((p) => ({ value: p.email, label: `${p.name} · ${p.team}` }))} />
          </Field>
          <Field label="Status">
            <Select value={t.status} onChange={(v) => save({ status: v as GrantTracking['status'] })} options={STATUS.map((s) => ({ value: s.value, label: s.label }))} />
          </Field>
        </div>
        <SectionLabel>Milestones</SectionLabel>
        <div className="mt-2">
          <Stepper stages={t.milestones} onChange={(m) => save({ milestones: m, stage: m.find((x) => !x.done_at)?.key || 'grant' })} />
        </div>
        {!tracking && <p className="text-xs text-gray-500 mt-3">Nothing saved yet. Any change above starts tracking this call.</p>}
      </Card>

      <Attachments entityType="grant" entityId={grant.id} subtitle="Concept notes, budgets, eligibility letters, partner LOIs" />
      <Comments entityType="grant" entityId={grant.id} />
      <div className="flex justify-end">
        <Button icon="external" onClick={() => window.open(grant.url, '_blank', 'noreferrer')}>Open original call</Button>
      </div>
    </Drawer>
  );
}
