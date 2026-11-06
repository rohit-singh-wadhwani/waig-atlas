import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/Layout';
import { Badge, Card, CardHeader, Empty, KpiCard, Progress, SectionLabel } from '../components/ui';
import WorldMap, { MapPoint } from '../components/WorldMap';
import ChartCard from '../components/ChartCard';
import Icon from '../components/Icon';
import { useData } from '../lib/hooks';
import { db, loadGrants, loadInsights } from '../lib/store';
import { useWorld, NO_COUNTRIES } from '../lib/world';
import { daysUntil, fmtDate, fmtTime, fmtUsd, scoreTone } from '../lib/format';
import { personName } from '../lib/team';
import type { GrantTracking, Project, ProjectMilestone } from '../lib/types';
import { KINDS } from './Insights';

export default function OverviewPage() {
  const nav = useNavigate();
  const world = useWorld();
  const countries = world?.countries ?? NO_COUNTRIES;
  const grants = useData(loadGrants, [], { items: [], updated_at: null });
  const insights = useData(loadInsights, [], { items: [], updated_at: null });
  const tracking = useData(() => db.list<GrantTracking & { id: string }>('grant_tracking'), [], []);
  const projects = useData(() => db.list<Project>('projects'), [], []);
  const ms = useData(() => db.list<ProjectMilestone>('project_milestones'), [], []);

  const open = grants.data.items.filter((g) => (daysUntil(g.deadline) ?? 1) >= 0);
  const strong = open.filter((g) => (g.score ?? 0) >= 70);
  const closing = open.filter((g) => (daysUntil(g.deadline) ?? 999) <= 30);
  const tMap = new Map(tracking.data.map((t) => [t.grant_id, t]));
  const pursuing = open.filter((g) => ['pursuing', 'submitted'].includes(tMap.get(g.id)?.status || ''));
  const recent = insights.data.items.filter((i) => Date.now() - +new Date(i.published_at) < 7 * 86400000);
  const alerts = insights.data.items.filter((i) => i.kind === 'outbreak' && Date.now() - +new Date(i.published_at) < 30 * 86400000);
  const due = ms.data.filter((m) => m.status !== 'done' && m.target_date && (daysUntil(m.target_date) ?? 999) <= 45).sort((a, b) => (a.target_date || '').localeCompare(b.target_date || ''));

  const points: MapPoint[] = useMemo(() => {
    const out: MapPoint[] = [];
    const by = new Map<string, typeof open>();
    for (const g of open) for (const c of g.countries) if (c !== 'GLOBAL') by.set(c, [...(by.get(c) || []), g]);
    by.forEach((list, iso) => {
      const c = countries.find((x) => x.iso3 === iso);
      if (!c) return;
      const best = Math.max(...list.map((g) => g.score ?? 0));
      const sorted = [...list].sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
      out.push({
        id: 'g' + iso, kind: 'Open calls', lng: c.lng, lat: c.lat, size: 5 + Math.min(12, Math.sqrt(list.length) * 3.5),
        color: best >= 70 ? '#316d6e' : best >= 45 ? '#eda100' : '#9ca3af',
        label: `${c.name}: ${list.length} open call${list.length > 1 ? 's' : ''}`, sub: `Best fit ${best || 'not scored'}`,
        items: sorted.map((g) => ({ label: g.title, href: g.url, meta: `${g.score != null ? `fit ${g.score} · ` : ''}due ${fmtDate(g.deadline, { day: 'numeric', month: 'short' })}` })),
        href: '#/grants', cta: 'Open Funds & Grants',
      });
    });
    for (const a of alerts)
      for (const iso of a.countries) {
        const c = countries.find((x) => x.iso3 === iso);
        if (c) out.push({ id: 'o' + a.id + iso, kind: 'Outbreak alert', lng: c.lng + 1.5, lat: c.lat - 1.5, size: 6, color: '#d03b3b', label: a.title, sub: `${c.name} · ${fmtDate(a.published_at)} · ${a.source_name}`, items: a.summary ? [{ label: a.summary }] : [], href: a.url, cta: 'Read the notice' });
      }
    for (const p of projects.data)
      for (const iso of p.countries) {
        const c = countries.find((x) => x.iso3 === iso);
        const pm = ms.data.filter((m) => m.project_id === p.id).sort((a, b) => a.order - b.order);
        if (c)
          out.push({
            id: 'p' + p.id + iso, kind: 'Our project', lng: c.lng - 1.5, lat: c.lat + 1.5, size: 8, color: '#6250d6', label: p.name, sub: `${c.name}${p.funder ? ` · ${p.funder}` : ''}`,
            items: pm.map((m) => ({ label: m.name, href: `#/projects/${p.slug}/${m.id}`, meta: m.status === 'done' ? 'done' : `${m.progress}%${m.target_date ? ` · due ${fmtDate(m.target_date, { day: 'numeric', month: 'short' })}` : ''}` })),
            href: `#/projects/${p.slug}`, cta: 'Open project',
          });
      }
    return out;
  }, [open, alerts, projects.data, ms.data, countries]);

  const statusCounts = ['watching', 'pursuing', 'submitted', 'won', 'lost'].map((s) => tracking.data.filter((t) => t.status === s).length);

  return (
    <>
      <PageHeader title="Overview" subtitle="Funding pipeline, public-health signals and project delivery in one view" />

      <Card className="mb-6">
        <SectionLabel>Strong-fit open calls</SectionLabel>
        <div className="text-[44px] font-semibold text-gray-900 mt-3 leading-none tabular-nums">{grants.loading ? '—' : strong.length}</div>
        <p className="text-[17px] text-gray-600 mt-4">
          of {open.length} open calls · {pursuing.length} being pursued · grants last fetched {fmtTime(grants.data.updated_at)}
        </p>
        <Progress className="mt-5" value={strong.length ? (pursuing.length / strong.length) * 100 : 0} />
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        <KpiCard icon="coins" label="Open calls" value={open.length} foot={`${fmtUsd(open.reduce((s, g) => s + (g.amount_usd || 0), 0))} stated`} onClick={() => nav('/grants')} />
        <KpiCard icon="clock" tint="orange" label="Closing in 30 days" value={closing.length} onClick={() => nav('/grants')} />
        <KpiCard icon="newspaper" tint="purple" label="Insights, last 7 days" value={recent.length} onClick={() => nav('/insights')} />
        <KpiCard icon="alert" tint="red" label="Outbreak alerts (30d)" value={alerts.length} onClick={() => nav('/health')} />
        <KpiCard icon="folder" tint="green" label="Active projects" value={projects.data.filter((p) => ['active', 'scaling', 'applying'].includes(p.status)).length} onClick={() => nav('/projects')} />
        <KpiCard icon="calendar" tint="gray" label="Milestones due (45d)" value={due.length} foot={due[0] ? `next ${fmtDate(due[0].target_date, { day: 'numeric', month: 'short' })}` : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.6fr_1fr] gap-6 mb-6">
        <Card>
          <CardHeader title="World view" subtitle={<span className="inline-flex flex-wrap gap-x-3 gap-y-1">Click any dot for details. <Legend c="#316d6e" l="Open calls (teal strong fit, amber possible, grey weak/unscored)" /><Legend c="#d03b3b" l="Outbreak alerts (30d)" /><Legend c="#6250d6" l="Our projects" /></span>} />
          <WorldMap geo={world?.geo || null} points={points} height={420} />
        </Card>
        <Card className="flex flex-col">
          <CardHeader title="Best-fit deals" right={<Link to="/grants" className="text-sm text-brand-700">All grants</Link>} />
          <ul className="divide-y divide-gray-100 -mx-1 flex-1">
            {[...open].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 6).map((g) => (
              <li key={g.id} className="py-3 px-1">
                <div className="flex gap-2 items-start">
                  <a href={g.url} target="_blank" rel="noreferrer" className="font-medium text-[15px] text-gray-900 hover:text-brand-700 flex-1 line-clamp-2">{g.title}</a>
                  {g.score != null && <Badge className={scoreTone(g.score).cls}>{g.score}</Badge>}
                </div>
                <div className="text-sm text-gray-500 mt-0.5">{g.funder} · due {fmtDate(g.deadline)}</div>
              </li>
            ))}
          </ul>
          {!grants.loading && !open.length && <Empty icon="coins" title="No grants fetched yet" />}
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Card>
          <CardHeader title="Milestones coming up" subtitle="Across all projects, next 45 days" />
          <ul className="divide-y divide-gray-100">
            {due.slice(0, 8).map((m) => {
              const p = projects.data.find((x) => x.id === m.project_id);
              const d = daysUntil(m.target_date)!;
              return (
                <li key={m.id} className="py-2.5">
                  <Link to={`/projects/${p?.slug}/${m.id}`} className="font-medium text-[15px] text-gray-900 hover:text-brand-700">{m.name}</Link>
                  <div className="text-sm text-gray-500">{p?.name} · {personName(m.owner)} · <span className={d < 0 ? 'text-red-600' : ''}>{d < 0 ? `${-d}d overdue` : `in ${d}d`}</span></div>
                </li>
              );
            })}
          </ul>
          {!due.length && <Empty icon="calendar" title="Nothing due soon" />}
        </Card>
        <Card>
          <CardHeader title="Latest insights" right={<Link to="/insights" className="text-sm text-brand-700">All insights</Link>} />
          <ul className="divide-y divide-gray-100">
            {insights.data.items.slice().sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 6).map((i) => {
              const k = KINDS.find((x) => x.value === i.kind) || KINDS[0];
              return (
                <li key={i.id} className="py-2.5 flex gap-3">
                  <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${k.cls}`}><Icon name={k.icon} size={16} /></span>
                  <div className="min-w-0">
                    <a href={i.url} target="_blank" rel="noreferrer" className="text-[15px] text-gray-900 hover:text-brand-700 line-clamp-2">{i.title}</a>
                    <div className="text-xs text-gray-500">{i.source_name} · {fmtDate(i.published_at)}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {!insights.loading && !insights.data.items.length && <Empty icon="newspaper" title="No insights fetched yet" />}
        </Card>
        <ChartCard title="Grant pipeline" subtitle="Calls we track, by status" labels={['Watching', 'Pursuing', 'Submitted', 'Won', 'Not funded']} series={[{ name: 'Calls', values: statusCounts }]} modes={['bars', 'donut']} height={250} />
      </div>
    </>
  );
}

function Legend({ c, l }: { c: string; l: string }) {
  return <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />{l}</span>;
}
