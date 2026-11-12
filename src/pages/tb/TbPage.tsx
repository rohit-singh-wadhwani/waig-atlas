import React, { useMemo, useState } from 'react';
import { PageHeader, useMe } from '../../components/Layout';
import { Empty, KpiCard, Segmented } from '../../components/ui';
import { useData, useLocalPref } from '../../lib/hooks';
import { fmtInt, loadTbDistricts, loadTbLayers, tbList, TbCampaign, TbCity, TbParam, TbPlaybook, TbResult, TbTask } from '../../lib/tb';
import Hotspots from './Hotspots';
import CityView from './CityView';
import Campaigns, { CampaignForm } from './Campaigns';
import TaskBoard from './TaskBoard';
import Evidence from './Evidence';
import Brief from './Brief';

type Tab = 'hotspots' | 'city' | 'campaigns' | 'tasks' | 'evidence' | 'brief';

/** Shared data for every TB tab, loaded once. */
export function useTbData() {
  const dist = useData(loadTbDistricts, [], { geo: null, list: [], meta: null, national: null, hasPrivate: false });
  const layers = useData(loadTbLayers, [], { facilities: null, sites: null, cities: null });
  const params = useData(() => tbList<TbParam>('tb_parameters'), [], []);
  const playbooks = useData(() => tbList<TbPlaybook>('tb_playbooks'), [], []);
  const campaigns = useData(() => tbList<TbCampaign>('tb_campaigns'), [], []);
  const results = useData(() => tbList<TbResult>('tb_campaign_results'), [], []);
  const tasks = useData(() => tbList<TbTask>('tb_tasks'), [], []);
  const cities = useData(() => tbList<TbCity>('tb_cities'), [], []);
  const P = useMemo(() => Object.fromEntries(params.data.map((p) => [p.id, Number(p.value)])) as Record<string, number>, [params.data]);
  return { dist, layers, params, playbooks, campaigns, results, tasks, cities, P };
}
export type TbData = ReturnType<typeof useTbData>;

export default function TbPage() {
  const me = useMe();
  const data = useTbData();
  const [tab, setTab] = useLocalPref<Tab>('tb-tab', 'hotspots');
  const [plan, setPlan] = useState<Partial<TbCampaign> | null>(null);
  const { dist, campaigns, tasks } = data;
  const nat = dist.data.meta?.national;
  const today = new Date().toISOString().slice(0, 10);
  const open = tasks.data.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && t.due < today);
  const active = campaigns.data.filter((c) => c.status === 'active' || c.status === 'planned');

  return (
    <>
      <PageHeader
        title="TB Surveillance · Ghana"
        subtitle="Where undiagnosed TB is likely to be, where we are blind, and the case-finding work to close the gap. Built only from open data feeds and your team's own uploads."
        updatedAt={dist.data.meta?.updated_at}
      />
      {!dist.loading && !dist.data.geo ? (
        <Empty icon="map" title="The TB data job hasn't run yet">It runs weekly; the first run takes about 10 minutes.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KpiCard icon="activity" tint="orange" label={`Estimated new TB cases, ${nat?.year ?? ''}`} value={fmtInt(nat?.incidence)} foot="WHO estimate for Ghana" />
            <KpiCard icon="checkCircle" tint="teal" label="Notified" value={fmtInt(nat?.notified)} foot={nat ? `${Math.round(nat.cdr * 100)}% of estimated cases found` : ''} />
            <KpiCard icon="alert" tint="red" label="Missing each year" value={fmtInt(nat ? nat.incidence - nat.notified : null)} foot="Estimated minus notified" />
            <KpiCard icon="target" tint="purple" label="Case-finding campaigns" value={active.length} foot={overdue.length ? `${overdue.length} overdue tasks` : `${open.length} open tasks`} onClick={() => setTab('campaigns')} />
          </div>
          <div className="mb-5">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'hotspots', label: 'Hotspots' },
                { value: 'city', label: 'City view' },
                { value: 'campaigns', label: `Campaigns (${campaigns.data.length})` },
                { value: 'tasks', label: `Tasks (${open.length})` },
                { value: 'evidence', label: 'Data sources' },
                { value: 'brief', label: 'AI brief' },
              ]}
            />
          </div>
          {tab === 'hotspots' && <Hotspots data={data} onPlan={setPlan} />}
          {tab === 'city' && <CityView data={data} onPlan={setPlan} />}
          {tab === 'campaigns' && <Campaigns data={data} onPlan={setPlan} />}
          {tab === 'tasks' && <TaskBoard data={data} />}
          {tab === 'evidence' && <Evidence data={data} />}
          {tab === 'brief' && <Brief />}
        </>
      )}
      {plan && <CampaignForm data={data} initial={plan} me={me.email} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); setTab('campaigns'); }} />}
    </>
  );
}
