import { db, dataUrl, uid } from './store';

/* ---------- types ---------- */
/** Where a number comes from. Shown next to every figure. */
export type Basis = 'reported' | 'measured' | 'estimated';

export type TbDistrict = {
  id: string; name: string; region: string; pop: number; census_pop: number | null; area_km2: number;
  expected: number; expected_100k: number; vs_ghana: number; share: number; age_effect: number | null; risk_effect: number | null;
  adults: number | null; male: number | null; urban: number | null; poverty: number | null; crowding: number | null; one_room: number | null; hh_size: number | null; insured: number | null;
  hiv: number | null; thin: number | null; smoke: number | null; drive_min: number | null; walk_min: number | null; walk_far: number | null;
  facilities: number; hospitals: number; labs: number; fac_100k: number; markets: number; hubs: number; prisons: number; mines: number; towns: number; lon: number; lat: number;
  // joined in the app (members only)
  notified: number | null; notified_basis: string | null; detection: number | null; missed: number; screened: number; confirmed: number; rank: number; approach: ApproachKey;
};
export type TbHexRow = { h: string; p: number; e: number; k: number; f: number | null; w: number | null; t: number; r: [number, number][] };
export type TbTown = { id: number; nodata?: boolean; name: string; place: string; lon: number; lat: number; radius_km: number; area_km2: number; pop: number; expected: number; expected_km2: number; geom: any; facility_km: number | null; hospital_km: number | null; drive_min: number | null; walk_min: number | null };
export type TbVenue = { name: string; kind: string; cong: boolean; t?: number; lon: number; lat: number; pop_1km: number; expected_1km: number; facility_km: number | null; hospital_km: number | null; walk_min: number | null; district?: string; district_id?: string };
export type TbFacility = { name: string; kind: string; lab: boolean; lon: number; lat: number };
export type TbDetail = { id: string; hexes: TbHexRow[]; towns: TbTown[]; venues: TbVenue[]; facilities: TbFacility[] };
export type TbParam = { id: string; grp: string; label: string; value: number; unit?: string; description?: string; source_title?: string; source_url?: string; status: 'evidence' | 'assumption' | 'policy'; updated_at?: string; updated_by?: string };
export type TbStep = { key: string; title: string; role: string; due_days: number; detail?: string };
export type TbPlaybook = { id: string; name: string; trigger?: string; description?: string; setting?: string; steps: TbStep[]; source_title?: string; source_url?: string; enabled: boolean };
export type TbCampaign = {
  id: string; name: string; city?: string | null; district_id?: string | null; district_name?: string | null; hex_ids?: string[]; setting?: string | null; playbook_id?: string | null;
  status: 'planned' | 'active' | 'done' | 'cancelled'; start_date?: string | null; end_date?: string | null; owner?: string | null; target_screened?: number | null;
  predicted_positivity?: number | null; notes?: string | null; created_by?: string | null; created_at?: string;
  town?: string | null; spots?: { name: string; kind: string; lon: number; lat: number; pop_1km?: number }[] | null;
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
  updated_at: string; error?: string;
  sources: { name: string; url: string; ok: boolean; note?: string; at: string }[];
  method?: { far_minutes: number; catchment_km: number; who_age_year?: number; age_groups?: string[]; attributable: Record<string, number>; attributable_year: number | null; census_missing?: string[] };
  national?: { year: number; incidence: number; incidence_lo?: number | null; incidence_hi?: number | null; notified: number; cdr: number; pop: number; rate_100k?: number; tbhiv_pct?: number | null };
  counts?: Record<string, number>;
};
export type Dhims2Status = { checked_at: string; connected: boolean; configured?: boolean; message: string; items?: { key: string; name: string }[]; districts_matched?: number; districts_total?: number; unmatched?: string[]; months?: string[] };

/* ---------- loading ---------- */
const json = async (f: string) => {
  const r = await fetch(dataUrl('tb/' + f), { cache: 'no-cache' });
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  // older pipeline runs wrote NaN for missing values, which strict JSON rejects
  return JSON.parse((await r.text()).replace(/\bNaN\b/g, 'null'));
};

export async function loadTbPublic() {
  const [districts, meta, national, dhims2] = await Promise.all([json('districts.geojson').catch(() => null), json('meta.json').catch(() => null), json('national.json').catch(() => null), json('dhims2.json').catch(() => null)]);
  return { districts, meta: meta as TbMeta | null, national: national as { years: any[]; latest: any } | null, dhims2: dhims2 as Dhims2Status | null };
}
const detailCache = new Map<string, Promise<TbDetail | null>>();
/** Hexagons, towns, screening spots and facilities for one district (loaded when the district is opened). */
export function loadDistrictDetail(id: string) {
  if (!detailCache.has(id)) detailCache.set(id, json(`d/${id}.json`).catch(() => null));
  return detailCache.get(id)!;
}
export const loadKeySites = () => json('keysites.json').catch(() => []) as Promise<TbVenue[]>;
export const loadReportedRegions = () => json('reported_regions.json').catch(() => ({})) as Promise<Record<string, { period: string; tb: number }[]>>;

type NotifRow = { district_id: string; period: string; notified: number | null; source?: string | null };

/** Annual notifications per district from monthly, quarterly or yearly rows: the latest 12 months, else the latest year. */
export function annualNotified(rows: NotifRow[]) {
  const by = new Map<string, NotifRow[]>();
  for (const r of rows) if (r.notified != null) by.set(r.district_id, [...(by.get(r.district_id) || []), r]);
  const out = new Map<string, { value: number; basis: string }>();
  by.forEach((list, id) => {
    const months = list.filter((r) => /^\d{4}-\d{2}$/.test(r.period)).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 12);
    if (months.length >= 6) {
      const sum = months.reduce((s, r) => s + Number(r.notified), 0);
      out.set(id, { value: (sum * 12) / months.length, basis: `${months.length} months to ${months[0].period}${months.length < 12 ? ', annualised' : ''}` });
      return;
    }
    const quarters = list.filter((r) => /^\d{4}-?Q[1-4]$/i.test(r.period)).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 4);
    if (quarters.length >= 2) {
      const sum = quarters.reduce((s, r) => s + Number(r.notified), 0);
      out.set(id, { value: (sum * 4) / quarters.length, basis: `${quarters.length} quarters to ${quarters[0].period}${quarters.length < 4 ? ', annualised' : ''}` });
      return;
    }
    const years = list.filter((r) => /^\d{4}$/.test(r.period)).sort((a, b) => b.period.localeCompare(a.period));
    if (years.length) out.set(id, { value: Number(years[0].notified), basis: `year ${years[0].period}` });
  });
  return out;
}

/* ---------- prioritisation: transparent rules, no hand-set weights ---------- */
export type ApproachKey = 'detection_gap' | 'outreach' | 'facility';
export const APPROACH: Record<ApproachKey, { label: string; short: string; cls: string; setting: string; playbook: string; who: string; how: string }> = {
  detection_gap: {
    label: 'Find out why cases are not being notified', short: 'Detection gap', cls: 'bg-red-50 text-red-700', setting: 'facility', playbook: 'detection_gap',
    who: 'WHO Module 2 (2021) and NTP data review practice',
    how: 'Far fewer cases are notified than expected. Check presumptive TB registers, GeneXpert use and missing reports at the main facilities before screening more people.',
  },
  outreach: {
    label: 'Mobile X-ray outreach to remote communities', short: 'Remote outreach', cls: 'bg-amber-50 text-amber-800', setting: 'outreach', playbook: 'acf_community',
    who: 'WHO Module 2 (2021), 2.2: people with structural risk factors, including poor access to care',
    how: 'Many people live more than an hour on foot from a health facility, so cases go undiagnosed. Take chest X-ray with AI reading and sputum collection to them.',
  },
  facility: {
    label: 'Screen clinic attendees and household contacts', short: 'Clinics + contacts', cls: 'bg-brand-50 text-brand-700', setting: 'facility', playbook: 'acf_community',
    who: 'WHO Module 2 (2021), 2.4 household contacts and 2.7 people attending health care',
    how: 'Most people can reach care. Screen adults attending clinics with X-ray + AI, and trace the household contacts of every notified case.',
  },
};

export type TbRules = { walkFarShare: number | null; lowDetection: number | null };
export const rulesFrom = (P: Record<string, number>): TbRules => ({ walkFarShare: P.rule_walk_far_share ?? null, lowDetection: P.rule_low_detection ?? null });

export function approachOf(d: Pick<TbDistrict, 'detection' | 'walk_far'>, r: TbRules): ApproachKey {
  if (d.detection != null && r.lowDetection != null && d.detection < r.lowDetection) return 'detection_gap';
  if (d.walk_far != null && r.walkFarShare != null && d.walk_far >= r.walkFarShare) return 'outreach';
  return 'facility';
}

/** Public district data joined with members-only notifications and campaign results, ranked by missed cases. */
export async function loadTbDistricts(): Promise<{ geo: any | null; list: TbDistrict[]; meta: TbMeta | null; national: any; dhims2: Dhims2Status | null; notifiedDistricts: number; notifRows: number }> {
  const { districts, meta, national, dhims2 } = await loadTbPublic();
  if (!districts) return { geo: null, list: [], meta, national, dhims2, notifiedDistricts: 0, notifRows: 0 };
  const [notif, camps, results] = await Promise.all([tbList<NotifRow>('tb_notifications'), tbList<TbCampaign>('tb_campaigns'), tbList<TbResult>('tb_campaign_results')]);
  const annual = annualNotified(notif);
  const campDistrict = new Map(camps.map((c) => [c.id, c.district_id]));
  const yieldBy = new Map<string, { s: number; c: number }>();
  for (const r of results) {
    const did = campDistrict.get(r.campaign_id);
    if (!did) continue;
    const y = yieldBy.get(did) || { s: 0, c: 0 };
    y.s += Number(r.screened) || 0;
    y.c += Number(r.confirmed) || 0;
    yieldBy.set(did, y);
  }
  const cdr = meta?.national?.cdr ?? null;
  for (const f of districts.features) {
    const pr = f.properties;
    const a = annual.get(pr.id);
    pr.notified = a ? a.value : null;
    pr.notified_basis = a ? a.basis : null;
    pr.detection = a && pr.expected ? a.value / pr.expected : null;
    pr.missed = a ? Math.max(pr.expected - a.value, 0) : cdr != null ? pr.expected * (1 - cdr) : pr.expected;
    pr.missed_100k = pr.pop ? (pr.missed / pr.pop) * 1e5 : 0;
    const y = yieldBy.get(pr.id);
    pr.screened = y?.s || 0;
    pr.confirmed = y?.c || 0;
  }
  const list = districts.features.map((f: any) => f.properties as TbDistrict).sort((a: TbDistrict, b: TbDistrict) => b.missed - a.missed);
  list.forEach((d: TbDistrict, i: number) => (d.rank = i + 1));
  return { geo: districts, list, meta, national, dhims2, notifiedDistricts: annual.size, notifRows: notif.length };
}

export const tbList = <T,>(table: string): Promise<T[]> => db.list<T>(table as any).then((r) => r || []).catch(() => [] as T[]);
export const tbSave = <T extends { id: string }>(table: string, row: T) => db.upsert(table as any, row as any);
export const tbRemove = (table: string, id: string) => db.remove(table as any, id);

/** Share of people screened expected to have TB, by setting. Key populations use published screening yields;
 *  community and clinic screening use the general-population yield scaled by the district's expected rate vs Ghana's. */
export function expectedPositivity(setting: string | null | undefined, d: TbDistrict | undefined, params: Record<string, number>, nationalRate?: number | null) {
  const bySetting: Record<string, string> = { prison: 'prev_prison', mine: 'prev_miners', contacts: 'prev_contacts', plhiv: 'prev_plhiv' };
  const key = setting ? bySetting[setting] : undefined;
  if (key && params[key] != null) return params[key] / 100;
  const base = params.prev_community_survey;
  if (base == null) return null;
  const ratio = d && nationalRate ? d.expected_100k / nationalRate : 1;
  return (base / 100) * ratio;
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
