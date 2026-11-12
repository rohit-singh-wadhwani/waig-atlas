import React, { useMemo, useState } from 'react';
import { PageHeader, useMe } from '../../components/Layout';
import { Empty, KpiCard, Segmented } from '../../components/ui';
import { useData, useLocalPref } from '../../lib/hooks';
import { fmtInt, loadTbDistricts, loadTbLayers, tbList, TbCampaign, TbCity, TbParam, TbPlaybook, TbResult, TbTask } from '../../lib/tb';
import WhereToAct from './WhereToAct';
import CityScreening from './CityScreening';
import Campaigns, { CampaignForm } from './Campaigns';
import TaskBoard from './TaskBoard';
import Evidence from './Evidence';
import Brief from './Brief';

type Tab = 'act' | 'city' | 'campaigns' | 'data' | 'brief';
const TABS: Tab[] = ['act', 'city', 'campaigns', 'data', 'brief'];

/** Shared data for every TB tab, loaded once. */
export function useTbData() {
  const dist = useData(loadTbDistricts, [], { geo: null, list: [], meta: null, national: null, dhims2: null, notifiedDistricts: 0, notifRows: 0 });
  const layers = useData(loadTbLayers, [], { facilities: null, sites: null, cities: null, siteList: [] });
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
  const [pref, setTab] = useLocalPref<Tab>('tb-tab-v2', 'act');
  const tab: Tab = TABS.includes(pref) ? pref : 'act';
  const [plan, setPlan] = useState<Partial<TbCampaign> | null>(null);
  const { dist, tasks } = data;
  const nat = dist.data.meta?.national;
  const open = tasks.data.filter((t) => t.status !== 'done');
  const nd = dist.data.notifiedDistricts;

  return (
    <>
      <PageHeader
        title="TB Surveillance · Ghana"
        subtitle="Where people with TB are being missed, where to screen next and with what, and what our screening finds. Every number is labelled reported, measured or estimated."
        updatedAt={dist.data.meta?.updated_at}
      />
      {!dist.loading && !dist.data.geo ? (
        <Empty icon="map" title="The TB data job hasn't run yet">It runs weekly; the first run takes about 10 minutes.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
            <KpiCard icon="activity" tint="orange" label={`New TB cases expected, ${nat?.year ?? ''}`} value={fmtInt(nat?.incidence)} foot={nat?.incidence_lo ? `WHO estimate, range ${fmtInt(nat.incidence_lo)} to ${fmtInt(nat.incidence_hi)}` : 'WHO estimate'} />
            <KpiCard icon="checkCircle" tint="teal" label={`Notified, ${nat?.year ?? ''}`} value={fmtInt(nat?.notified)} foot={nat ? `${Math.round(nat.cdr * 100)}% of expected cases found (WHO)` : ''} />
            <KpiCard icon="alert" tint="red" label="Missed each year" value={fmtInt(nat ? nat.incidence - nat.notified : null)} foot="Expected minus notified, nationally" />
            <KpiCard icon="database" tint="purple" label="District notifications" value={nd ? `${nd} of ${dist.data.list.length}` : 'Not connected'} foot={nd ? 'districts with notifications loaded' : 'Needs DHIMS2 access or an upload'} onClick={() => setTab('data')} />
          </div>
          <div className="mb-5 overflow-x-auto">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'act', label: 'Where to act' },
                { value: 'city', label: 'City screening sites' },
                { value: 'campaigns', label: `Campaigns & tasks${open.length ? ` (${open.length} open)` : ''}` },
                { value: 'data', label: 'Data sources' },
                { value: 'brief', label: 'Weekly brief' },
              ]}
            />
          </div>
          {tab === 'act' && <WhereToAct data={data} onPlan={setPlan} goData={() => setTab('data')} />}
          {tab === 'city' && <CityScreening data={data} onPlan={setPlan} />}
          {tab === 'campaigns' && (
            <div className="space-y-6">
              <Campaigns data={data} onPlan={setPlan} />
              <TaskBoard data={data} />
            </div>
          )}
          {tab === 'data' && <Evidence data={data} />}
          {tab === 'brief' && <Brief />}
        </>
      )}
      {plan && <CampaignForm data={data} initial={plan} me={me.email} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); setTab('campaigns'); }} />}
    </>
  );
}
