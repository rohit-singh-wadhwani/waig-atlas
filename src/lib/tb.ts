import { db, dataUrl, supabase, uid } from './store';

/* ---------- types ---------- */
export type TbDistrict = {
  id: string; name: string; region: string; pop: number; area_km2: number; density: number; rwi: number; minutes: number; pct_far: number;
  facilities: number; hospitals: number; labs: number; markets: number; hubs: number; prisons: number; mines: number;
  hiv: number | null; thin: number | null; smoke: number | null; m_risk: number; m_density: number; m_poverty: number;
  expected: number; cdr: number; hidden: number; hidden_100k: number; prev_adult: number; blind: number; priority: number; rank: number;
  flows: { id: string; name: string; share: number; lon: number; lat: number }[]; lon: number; lat: number;
  // private overlay (uploaded notifications, campaign calibration)
  notified?: number | null; gap?: number | null; calibration?: number | null; private?: boolean;
};
export type TbHex = { h3: string; city: string; district: string; pop: number; density: number; rwi: number; facility_km: number; hospital_km: number; minutes: number; sites: string[]; expected: number; hidden: number; hidden_100k: number; score: number };
export type TbParam = { id: string; grp: string; label: string; value: number; unit?: string; description?: string; source_title?: string; source_url?: string; status: 'evidence' | 'assumption'; updated_at?: string; updated_by?: string };
export type TbStep = { key: string; title: string; role: string; due_days: number; detail?: string };
export type TbPlaybook = { id: string; name: string; trigger?: string; description?: string; setting?: string; steps: TbStep[]; source_title?: string; source_url?: string; enabled: boolean };
export type TbCampaign = {
  id: string; name: string; city?: string | null; district_id?: string | null; district_name?: string | null; hex_ids?: string[]; setting?: string | null; playbook_id?: string | null;
  status: 'planned' | 'active' | 'done' | 'cancelled'; start_date?: string | null; end_date?: string | null; owner?: string | null; target_screened?: number | null;
  predicted_positivity?: number | null; notes?: string | null; created_by?: string | null; created_at?: string;
};
export type TbResult = {
  id: string; campaign_id: string; report_date: string; screened: number; cough_flagged: number; cxr_flagged: number; presumptive: number; tested: number; confirmed: number;
  rr_confirmed: number; started_treatment: number; contacts_identified: number; contacts_screened: number; tpt_started: number; cough_flagged_confirmed: number; cxr_flagged_confirmed: number;
  notes?: string; reported_by?: string;
};
export type TbTask = {
  id: string; campaign_id?: string | null; title: string; detail?: string | null; role?: string | null; assignee?: string | null; district_id?: string | null; district_name?: string | null;
  due?: string | null; status: 'todo' | 'doing' | 'done' | 'blocked'; priority?: string; step_key?: string | null; outcome?: string | null; created_by?: string | null; created_at?: string; updated_at?: string;
};
export type TbCity = { id: string; name: string; lat: number; lon: number; radius_km: number; h3_res: number; city_partner?: string | null; enabled: boolean };
export type TbMeta = {
  updated_at: string; access_basis?: string; private?: string; error?: string;
  sources: { name: string; url: string; ok: boolean; note?: string; at: string }[];
  national?: { year: number; incidence: number; notified: number; cdr: number; pop: number };
  counts?: { districts: number; facilities: number; sites: number; hexagons: number };
};

/* ---------- loading ---------- */
const json = async (f: string) => {
  const r = await fetch(dataUrl('tb/' + f), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json();
};

export async function loadTbPublic() {
  const [districts, meta, national] = await Promise.all([json('districts.geojson').catch(() => null), json('meta.json').catch(() => null), json('national.json').catch(() => null)]);
  return { districts, meta: meta as TbMeta | null, national: national as { years: any[]; latest: any } | null };
}
export const loadTbLayers = async () => {
  const [facilities, sites, cities] = await Promise.all([json('facilities.geojson').catch(() => null), json('sites.geojson').catch(() => null), json('cities.geojson').catch(() => null)]);
  return { facilities, sites, cities };
};

/** Districts with private estimates (uploaded notifications, campaign calibration) merged over the open-data model. */
export async function loadTbDistricts(): Promise<{ geo: any | null; list: TbDistrict[]; meta: TbMeta | null; national: any; hasPrivate: boolean }> {
  const { districts, meta, national } = await loadTbPublic();
  if (!districts) return { geo: null, list: [], meta, national, hasPrivate: false };
  let est: any[] = [];
  if (supabase) {
    try {
      est = await db.list<any>('tb_estimates' as any);
    } catch {}
  }
  const byId = new Map(est.map((e) => [e.district_id, e]));
  let hasPrivate = false;
  for (const f of districts.features) {
    const e = byId.get(f.properties.id);
    if (!e) continue;
    const pr = f.properties;
    if (e.notified != null || (e.calibration && Math.abs(e.calibration - 1) > 1e-6)) hasPrivate = true;
    Object.assign(pr, {
      expected: e.expected ?? pr.expected, hidden: e.hidden ?? pr.hidden, notified: e.notified, gap: e.gap, calibration: e.calibration,
      blind: e.blind_spot ?? pr.blind, priority: e.priority ?? pr.priority, rank: e.rank ?? pr.rank, private: true,
    });
    pr.hidden_100k = pr.pop ? (pr.hidden / pr.pop) * 1e5 : pr.hidden_100k;
  }
  return { geo: districts, list: districts.features.map((f: any) => f.properties as TbDistrict), meta, national, hasPrivate };
}

export const tbList = <T,>(table: string) => db.list<T>(table as any);
export const tbSave = <T extends { id: string }>(table: string, row: T) => db.upsert(table as any, row as any);
export const tbRemove = (table: string, id: string) => db.remove(table as any, id);

/* ---------- metrics shown on the map ---------- */
export const METRICS: { key: keyof TbDistrict & string; label: string; fmt: (v: number) => string; help: string }[] = [
  { key: 'priority', label: 'Priority', fmt: (v) => v.toFixed(0), help: 'Where to act first: hidden cases (count and rate) plus blind-spot score.' },
  { key: 'hidden', label: 'Hidden cases', fmt: (v) => Math.round(v).toLocaleString('en-GB'), help: 'Estimated people with TB each year who are not diagnosed or notified.' },
  { key: 'hidden_100k', label: 'Hidden per 100k', fmt: (v) => v.toFixed(0), help: 'Hidden cases per 100,000 people.' },
  { key: 'expected', label: 'Expected cases', fmt: (v) => Math.round(v).toLocaleString('en-GB'), help: "District share of WHO's national incidence, weighted by risk factors, crowding and poverty." },
  { key: 'blind', label: 'Blind spots', fmt: (v) => v.toFixed(0), help: 'Little or no visibility: far from care, few facilities, no data.' },
  { key: 'minutes', label: 'Travel time to care', fmt: (v) => `${v.toFixed(0)} min`, help: 'Population-weighted travel time to the nearest health facility.' },
];

/** Prevalence (fraction) to expect in a campaign, by setting. */
export function expectedPositivity(setting: string | null | undefined, d: TbDistrict | undefined, params: Record<string, number>) {
  const sens = params.cxr_cad_sensitivity ?? 0.9;
  const bySetting: Record<string, string> = { prison: 'prev_prison', mine: 'prev_miners', contacts: 'prev_contacts', plhiv: 'prev_plhiv' };
  const key = setting ? bySetting[setting] : undefined;
  const prev = key && params[key] != null ? params[key] / 100 : (d?.prev_adult ?? params.prev_general_ghana ?? 356) / 1e5;
  return prev * sens;
}

export const SETTINGS = [
  { value: 'community', label: 'Community hotspot (everyone 15+)' },
  { value: 'market', label: 'Market / lorry station' },
  { value: 'prison', label: 'Prison' },
  { value: 'mine', label: 'Mining community' },
  { value: 'contacts', label: 'Household contacts of index cases' },
  { value: 'plhiv', label: 'People living with HIV (ART clinic)' },
  { value: 'outreach', label: 'Blind-spot outreach' },
  { value: 'facility', label: 'Facility OPD screening' },
];

export function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Create a campaign and its tasks from the playbook steps; assign each step to a member holding that role (same district first). */
export async function createCampaign(c: TbCampaign, playbook: TbPlaybook | undefined, people: { email: string; role?: string | null; district?: string | null }[], me: string) {
  const saved = await tbSave('tb_campaigns', { ...c, created_by: me });
  if (playbook) {
    const start = c.start_date || new Date().toISOString().slice(0, 10);
    for (const s of playbook.steps) {
      const holders = people.filter((p) => p.role && p.role.toLowerCase() === s.role.toLowerCase());
      const who = holders.find((p) => p.district && c.district_name && p.district.toLowerCase() === c.district_name.toLowerCase()) || holders[0];
      await tbSave('tb_tasks', {
        id: uid('tbt'), campaign_id: c.id, title: s.title, detail: s.detail || null, role: s.role, assignee: who?.email || null, district_id: c.district_id || null,
        district_name: c.district_name || null, due: addDays(start, s.due_days), status: 'todo', step_key: s.key, created_by: me,
      } as TbTask);
    }
  }
  return saved;
}

export function cascadeTotals(rows: TbResult[]) {
  const keys: (keyof TbResult)[] = ['screened', 'cough_flagged', 'cxr_flagged', 'presumptive', 'tested', 'confirmed', 'rr_confirmed', 'started_treatment', 'contacts_identified', 'contacts_screened', 'tpt_started', 'cough_flagged_confirmed', 'cxr_flagged_confirmed'];
  const t: Record<string, number> = {};
  for (const k of keys) t[k as string] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  return t;
}

export const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '—');
export const fmtInt = (v: number | null | undefined) => (v == null || !isFinite(v) ? '—' : Math.round(v).toLocaleString('en-GB'));
