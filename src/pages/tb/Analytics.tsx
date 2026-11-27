import React, { useMemo, useState } from 'react';
import { Badge, Card, CardHeader, Empty, ExtLink, Select, cx } from '../../components/ui';
import { cascadeTotals, fmtInt, pct, TbCampaign, TbResult } from '../../lib/tb';
import type { TbData } from './TbPage';

const WHO_HANDBOOK = 'https://www.who.int/publications-detail-redirect/9789240022614';

/** The screening cascade, in the order WHO's handbook (section 2.7.2) monitors it. */
const STEPS: { key: string; label: string; note: string }[] = [
  { key: 'people_reached', label: 'Reached by outreach', note: 'People reached by community sensitisation' },
  { key: 'screened', label: 'Screened', note: 'Symptom screen (cough of 2+ weeks, fever, weight loss, night sweats)' },
  { key: 'presumptive', label: 'Symptomatic', note: 'Flagged by the clinician as symptomatic and referred for a test' },
  { key: 'tested', label: 'Tested', note: 'Sputum tested with Xpert' },
  { key: 'confirmed', label: 'TB found', note: 'Bacteriologically confirmed' },
  { key: 'started_treatment', label: 'Started treatment', note: 'Registered and on treatment' },
];

const STATUS_CLS: Record<string, string> = { planned: 'bg-gray-100 text-gray-700', active: 'bg-brand-50 text-brand-700', done: 'bg-green-50 text-green-700', cancelled: 'bg-gray-100 text-gray-400' };

/** Campaign analytics: how much screening is done and left, who was found, and where people were lost. */
export default function Analytics({ data }: { data: TbData }) {
  const { campaigns, results } = data;
  const [scope, setScope] = useState('');
  const shown = useMemo(() => campaigns.data.filter((c) => !scope || c.id === scope), [campaigns.data, scope]);
  const ids = new Set(shown.map((c) => c.id));
  const rows = results.data.filter((r) => ids.has(r.campaign_id));
  const t = cascadeTotals(rows);
  const target = shown.reduce((s, c) => s + (c.target_screened || 0), 0);

  if (!campaigns.data.length) return <Empty icon="chart" title="No campaigns yet">Plan a campaign from a town on Find and act; its results show here.</Empty>;

  const preDx = Math.max(0, t.presumptive - t.tested);
  const preTx = Math.max(0, t.confirmed - t.started_treatment);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Select className="w-[320px] max-w-full" value={scope} onChange={setScope} placeholder="All campaigns" options={campaigns.data.map((c) => ({ value: c.id, label: c.name }))} />
        <span className="ml-auto text-xs text-gray-500">Indicators follow the <ExtLink href={WHO_HANDBOOK}>WHO screening handbook, section 2.7.2</ExtLink></span>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="People screened" value={fmtInt(t.screened)} sub={target ? `${pct(t.screened, target)} of ${fmtInt(target)} target · ${fmtInt(Math.max(0, target - t.screened))} left` : 'No target set'} bar={target ? t.screened / target : undefined} />
        <Kpi label="Community outreach" value={fmtInt(t.outreach_sessions)} sub={t.people_reached ? `sessions · ${fmtInt(t.people_reached)} people reached` : 'screening sessions'} />
        <Kpi label="Symptomatic" value={fmtInt(t.presumptive)} sub={`${pct(t.presumptive, t.screened)} of screened, flagged by the clinician`} />
        <Kpi label="TB found" value={fmtInt(t.confirmed)} sub={t.confirmed ? `1 case per ${fmtInt(t.screened / t.confirmed)} screened` : '—'} />
        <Kpi label="Started treatment" value={pct(t.started_treatment, t.confirmed)} sub={`${fmtInt(t.started_treatment)} of ${fmtInt(t.confirmed)} confirmed`} />
        <Kpi label="Lost to follow-up" value={fmtInt(preDx + preTx)} sub={`${fmtInt(preDx)} not tested · ${fmtInt(preTx)} not started on treatment`} alert={preDx + preTx > 0} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
        <Card>
          <CardHeader title="Screening cascade" subtitle="Bars are to scale. Red lines are people lost to follow-up; grey lines are people who screened or tested negative" />
          {!t.screened ? <p className="text-sm text-gray-500">No results reported for these campaigns yet.</p> : <Cascade t={t} />}
        </Card>
        <Card>
          <CardHeader title="After diagnosis" subtitle="Contact investigation and preventive treatment" />
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Pair label="Household contacts identified" value={fmtInt(t.contacts_identified)} />
            <Pair label="Contacts screened" value={`${fmtInt(t.contacts_screened)} (${pct(t.contacts_screened, t.contacts_identified)})`} />
            <Pair label="Preventive treatment started" value={fmtInt(t.tpt_started)} />
            <Pair label="Drug-resistant TB (RR)" value={fmtInt(t.rr_confirmed)} />
          </dl>
        </Card>
      </div>

      <Card pad={false}>
        <div className="p-5 pb-2"><CardHeader title={scope ? 'By screening point' : 'By campaign'} subtitle={scope ? 'Results reported for each point' : 'Progress, yield and losses for each campaign'} /></div>
        <div className="overflow-x-auto">
          {scope ? <BySpot rows={rows} /> : <ByCampaign campaigns={shown} results={results.data} onOpen={setScope} />}
        </div>
      </Card>
    </div>
  );
}

function Kpi({ label, value, sub, bar, alert }: { label: string; value: React.ReactNode; sub?: React.ReactNode; bar?: number; alert?: boolean }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 min-w-0">
      <div className="text-xs text-gray-500">{label}</div>
      <div className={cx('text-2xl font-semibold tabular-nums mt-1', alert ? 'text-red-700' : 'text-gray-900')}>{value}</div>
      {bar != null && <div className="h-1.5 rounded-full bg-gray-100 mt-2 overflow-hidden"><div className="h-full bg-brand-600" style={{ width: `${Math.min(100, bar * 100)}%` }} /></div>}
      {sub && <div className="text-xs text-gray-500 mt-1.5">{sub}</div>}
    </div>
  );
}

function Pair({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="font-semibold tabular-nums text-gray-900">{value}</dd>
    </div>
  );
}

/** Horizontal cascade, one hue; widths relative to people screened, with the drop between steps written out. */
/** Drops that are losses to follow-up (WHO 2.7.2); the other drops are people who tested or screened negative. */
const LOSS: Record<number, string> = { 3: 'symptomatic not tested (lost before diagnosis)', 5: 'confirmed not started on treatment (lost before treatment)' };
const DROP: Record<number, string> = { 1: 'reached but not screened', 2: 'screened negative', 4: 'tested negative' };

/** Bars to scale; the "reached" step shows only when campaigns reported reach. */
function Cascade({ t }: { t: Record<string, number> }) {
  const base = Math.max(t.people_reached || 0, t.screened || 0, 1);
  const steps = STEPS.filter((s) => s.key !== 'people_reached' || t.people_reached > 0);
  return (
    <ol className="space-y-2.5">
      {steps.map((s, i) => {
        const v = t[s.key] || 0;
        const prev = i > 0 ? t[steps[i - 1].key] || 0 : null;
        const w = Math.min(100, (v / base) * 100);
        return (
          <li key={s.key} title={s.note}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-gray-800">{s.label}</span>
              <span className="tabular-nums text-gray-900 font-medium">{fmtInt(v)}{prev != null && <span className="text-xs text-gray-500 font-normal"> · {pct(v, prev)} of previous</span>}</span>
            </div>
            <div className="h-3 mt-1 rounded bg-gray-100 overflow-hidden"><div className={cx('h-full rounded', i === 0 ? 'bg-brand-300' : 'bg-brand-600')} style={{ width: `${Math.max(w, v ? 0.8 : 0)}%` }} /></div>
            {prev != null && prev > v && <div className={cx('text-xs mt-0.5', LOSS[STEPS.indexOf(s)] ? 'text-red-700' : 'text-gray-500')}>{fmtInt(prev - v)} {LOSS[STEPS.indexOf(s)] || DROP[STEPS.indexOf(s)]}</div>}
          </li>
        );
      })}
    </ol>
  );
}

function ByCampaign({ campaigns, results, onOpen }: { campaigns: TbCampaign[]; results: TbResult[]; onOpen: (id: string) => void }) {
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-gray-500 border-y border-gray-100 bg-gray-50/60">
        <tr>{['Campaign', 'Status', 'Screened', 'Symptomatic', 'Tested', 'TB found', 'On treatment', 'Lost to follow-up', 'Screened per case'].map((h) => <th key={h} className="text-left font-medium px-4 py-2 whitespace-nowrap">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {campaigns.map((c) => {
          const t = cascadeTotals(results.filter((r) => r.campaign_id === c.id));
          const lost = Math.max(0, t.presumptive - t.tested) + Math.max(0, t.confirmed - t.started_treatment);
          return (
            <tr key={c.id} className="hover:bg-gray-50">
              <td className="px-4 py-2.5 min-w-[220px]"><button type="button" className="text-left font-medium text-gray-900 hover:underline" onClick={() => onOpen(c.id)}>{c.name}</button><div className="text-xs text-gray-500">{c.district_name}</div></td>
              <td className="px-4 py-2.5"><Badge className={STATUS_CLS[c.status]}>{c.status}</Badge></td>
              <td className="px-4 py-2.5 tabular-nums whitespace-nowrap">{fmtInt(t.screened)}{c.target_screened ? <span className="text-gray-500"> / {fmtInt(c.target_screened)}</span> : null}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.presumptive)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.tested)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.confirmed)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.started_treatment)}</td>
              <td className={cx('px-4 py-2.5 tabular-nums', lost > 0 && 'text-red-700 font-medium')}>{fmtInt(lost)}</td>
              <td className="px-4 py-2.5 tabular-nums">{t.confirmed ? fmtInt(t.screened / t.confirmed) : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function BySpot({ rows }: { rows: TbResult[] }) {
  const spots = Array.from(new Set(rows.map((r) => r.spot || 'Not specified')));
  if (!spots.length) return <p className="px-5 pb-5 text-sm text-gray-500">No results reported for this campaign yet.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="text-xs text-gray-500 border-y border-gray-100 bg-gray-50/60">
        <tr>{['Screening point', 'Outreach sessions', 'Screened', 'Symptomatic', 'Tested', 'TB found', 'On treatment', 'Lost to follow-up'].map((h) => <th key={h} className="text-left font-medium px-4 py-2 whitespace-nowrap">{h}</th>)}</tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {spots.map((sp) => {
          const t = cascadeTotals(rows.filter((r) => (r.spot || 'Not specified') === sp));
          const lost = Math.max(0, t.presumptive - t.tested) + Math.max(0, t.confirmed - t.started_treatment);
          return (
            <tr key={sp}>
              <td className="px-4 py-2.5 font-medium text-gray-900 min-w-[200px]">{sp}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.outreach_sessions)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.screened)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.presumptive)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.tested)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.confirmed)}</td>
              <td className="px-4 py-2.5 tabular-nums">{fmtInt(t.started_treatment)}</td>
              <td className={cx('px-4 py-2.5 tabular-nums', lost > 0 && 'text-red-700 font-medium')}>{fmtInt(lost)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
