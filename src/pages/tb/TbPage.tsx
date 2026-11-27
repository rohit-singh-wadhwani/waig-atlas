import React, { useMemo, useState } from 'react';
import { PageHeader, useMe } from '../../components/Layout';
import { Empty, Segmented } from '../../components/ui';
import { useData, useLocalPref } from '../../lib/hooks';
import { latestTbPriorities, loadTbDistricts, tbList, TbCampaign, TbParam, TbPlaybook, TbResult, TbStaffRole, TbTask, TbTaskUpdate } from '../../lib/tb';
import Explorer from './Explorer';
import Campaigns, { CampaignForm } from './Campaigns';
import Evidence from './Evidence';
import Analytics from './Analytics';
import { inScope, Persona, ScopeBanner, scopeOf, ViewAs } from './Roles';

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
  const roles = useData(() => tbList<TbStaffRole>('tb_staff_roles'), [], []);
  const P = useMemo(() => Object.fromEntries(params.data.map((p) => [p.id, Number(p.value)])) as Record<string, number>, [params.data]);
  return { dist, params, playbooks, campaigns, results, tasks, updates, priorities, P, roles, scope: null as ReturnType<typeof scopeOf> };
}
export type TbData = ReturnType<typeof useTbData>;

/** The same data narrowed to what a previewed role would see: its places, and (for facility and community staff) its tasks. */
function narrow(data: TbData, scope: ReturnType<typeof scopeOf>): TbData {
  if (!scope) return data;
  const camps = data.campaigns.data.filter((c) => inScope.campaign(scope, c));
  const ids = new Set(camps.map((c) => c.id));
  const tasks = data.tasks.data.filter((t) => inScope.task(scope, t, data.campaigns.data));
  const tids = new Set(tasks.map((t) => t.id));
  return {
    ...data, scope,
    campaigns: { ...data.campaigns, data: camps },
    results: { ...data.results, data: data.results.data.filter((r) => ids.has(r.campaign_id)) },
    tasks: { ...data.tasks, data: tasks },
    updates: { ...data.updates, data: data.updates.data.filter((u) => tids.has(u.task_id)) },
  };
}

export default function TbPage() {
  const me = useMe();
  const all = useTbData();
  const [persona, setPersona] = useLocalPref<Persona | null>('tb-viewas', null);
  const scope = useMemo(() => scopeOf(persona, all.dist.data.list, all.roles.data), [persona, all.dist.data.list, all.roles.data]);
  const data = useMemo(() => narrow(all, scope), [all, scope]);
  // the district with the most of our own screening is where a role preview starts
  const focus = [...all.dist.data.list].sort((a, b) => b.screened - a.screened).find((d) => d.screened > 0) || null;
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
        actions={<ViewAs value={persona} onChange={setPersona} roles={all.roles.data} list={dist.data.list} focus={focus} />}
      />
      {scope && <ScopeBanner scope={scope} onExit={() => setPersona(null)} counts={{ districts: scope.districts ? scope.districts.size : dist.data.list.length, campaigns: data.campaigns.data.length, tasks: open.length }} />}
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
