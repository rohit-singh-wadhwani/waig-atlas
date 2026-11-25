import React, { useMemo, useState } from 'react';
import { PageHeader, useMe } from '../../components/Layout';
import { Empty, Segmented } from '../../components/ui';
import { useData, useLocalPref } from '../../lib/hooks';
import { latestTbPriorities, loadTbDistricts, tbList, TbCampaign, TbParam, TbPlaybook, TbResult, TbTask, TbTaskUpdate } from '../../lib/tb';
import Explorer from './Explorer';
import Campaigns, { CampaignForm } from './Campaigns';
import Evidence from './Evidence';
import Analytics from './Analytics';

type Tab = 'explore' | 'campaigns' | 'analytics' | 'data';
const TABS: Tab[] = ['explore', 'campaigns', 'analytics', 'data'];

/** Shared data for every TB tab, loaded once. */
export function useTbData() {
  const dist = useData(loadTbDistricts, [], { geo: null, list: [], meta: null, national: null, dhims2: null, notifiedDistricts: 0, notifRows: 0 });
  const params = useData(() => tbList<TbParam>('tb_parameters'), [], []);
  const playbooks = useData(() => tbList<TbPlaybook>('tb_playbooks'), [], []);
  const campaigns = useData(() => tbList<TbCampaign>('tb_campaigns'), [], []);
  const results = useData(() => tbList<TbResult>('tb_campaign_results'), [], []);
  const tasks = useData(() => tbList<TbTask>('tb_tasks'), [], []);
  const updates = useData(() => tbList<TbTaskUpdate>('tb_task_updates'), [], []);
  const priorities = useData(latestTbPriorities, [], null);
  const P = useMemo(() => Object.fromEntries(params.data.map((p) => [p.id, Number(p.value)])) as Record<string, number>, [params.data]);
  return { dist, params, playbooks, campaigns, results, tasks, updates, priorities, P };
}
export type TbData = ReturnType<typeof useTbData>;

export default function TbPage() {
  const me = useMe();
  const data = useTbData();
  const [pref, setTab] = useLocalPref<Tab>('tb-tab-v3', 'explore');
  const tab: Tab = TABS.includes(pref) ? pref : 'explore';
  const [plan, setPlan] = useState<Partial<TbCampaign> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null); // campaign to open when arriving from a map flag
  const { dist, tasks } = data;
  const open = tasks.data.filter((t) => t.status !== 'done');

  return (
    <>
      <PageHeader
        title="TB Surveillance · Ghana"
        subtitle="Find where TB is most likely, drill into a district and town, pick screening spots and hand out the work."
        updatedAt={dist.data.meta?.updated_at}
      />
      {!dist.loading && !dist.data.geo ? (
        <Empty icon="map" title="The TB data job hasn't run yet">It runs weekly; the first run takes about 10 minutes.</Empty>
      ) : (
        <>
          <div className="mb-5 overflow-x-auto">
            <Segmented<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { value: 'explore', label: 'Find and act' },
                { value: 'campaigns', label: `Campaigns & tasks${open.length ? ` (${open.length} open)` : ''}` },
                { value: 'analytics', label: 'Analytics' },
                { value: 'data', label: 'Data sources' },
              ]}
            />
          </div>
          {tab === 'explore' && <Explorer data={data} goTab={(t, id) => { setOpenId(id || null); setTab(t as Tab); }} />}
          {tab === 'campaigns' && (
            <Campaigns data={data} onPlan={setPlan} openId={openId} />
          )}
          {tab === 'data' && <Evidence data={data} />}
          {tab === 'analytics' && <Analytics data={data} />}
        </>
      )}
      {plan && <CampaignForm data={data} initial={plan} me={me.email} onClose={() => setPlan(null)} onSaved={() => { setPlan(null); setTab('campaigns'); }} />}
    </>
  );
}
