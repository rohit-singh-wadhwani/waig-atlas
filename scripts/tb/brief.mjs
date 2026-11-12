// Weekly TB brief: Gemini writes a short, grounded action brief for Ghana and each city from the same data the
// TB pages show (public pipeline files + members-only notifications, campaigns and results). Numbers must come
// from the inputs only; every figure is labelled reported, measured or estimated.
import fs from 'node:fs';
import path from 'node:path';
import { HAS_GEMINI, HAS_SB, gemini, geminiStatus, log, sb, today } from '../lib.mjs';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'public', 'data', 'tb');
const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const r0 = (x) => (x == null ? null : Math.round(x));
const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

// same rules as src/lib/tb.ts
function annual(rows) {
  const by = new Map();
  for (const r of rows) if (r.notified != null) by.set(r.district_id, [...(by.get(r.district_id) || []), r]);
  const out = new Map();
  for (const [id, list] of by) {
    const m = list.filter((r) => /^\d{4}-\d{2}$/.test(r.period)).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 12);
    if (m.length >= 6) { out.set(id, (m.reduce((s, r) => s + Number(r.notified), 0) * 12) / m.length); continue; }
    const q = list.filter((r) => /^\d{4}-?Q[1-4]$/i.test(r.period)).sort((a, b) => b.period.localeCompare(a.period)).slice(0, 4);
    if (q.length >= 2) { out.set(id, (q.reduce((s, r) => s + Number(r.notified), 0) * 4) / q.length); continue; }
    const y = list.filter((r) => /^\d{4}$/.test(r.period)).sort((a, b) => b.period.localeCompare(a.period));
    if (y.length) out.set(id, Number(y[0].notified));
  }
  return out;
}
const approach = (d, P) =>
  d.detection != null && P.rule_low_detection != null && d.detection < P.rule_low_detection ? 'detection_gap'
    : d.walk_far != null && P.rule_walk_far_share != null && d.walk_far >= P.rule_walk_far_share ? 'remote_outreach'
    : 'clinics_and_contacts';

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const meta = read('meta.json');
  const nat = meta.national;
  const districts = read('districts.geojson').features.map((f) => f.properties);
  const keysites = read('keysites.json');
  const [notif, campaigns, results, tasks, params] = await Promise.all([
    sb.select('tb_notifications', 'select=district_id,period,notified'), sb.select('tb_campaigns', 'select=*'), sb.select('tb_campaign_results', 'select=*'),
    sb.select('tb_tasks', 'select=status,due,campaign_id'), sb.select('tb_parameters', 'select=id,label,value,unit,status')
  ]);
  const P = Object.fromEntries(params.map((p) => [p.id, Number(p.value)]));
  const ann = annual(notif);
  for (const d of districts) {
    d.notified = ann.has(d.id) ? ann.get(d.id) : null;
    d.detection = d.notified != null ? d.notified / d.expected : null;
    d.missed = d.notified != null ? Math.max(d.expected - d.notified, 0) : d.expected * (1 - nat.cdr);
    d.approach = approach(d, P);
  }
  districts.sort((a, b) => b.missed - a.missed);
  const row = (d, i) => ({
    rank: i + 1, district: d.name, region: d.region, people: d.pop, expected_cases_estimated: r0(d.expected), rate_per_100k_estimated: r0(d.expected_100k), vs_ghana: r2(d.vs_ghana),
    notified_reported: d.notified != null ? r0(d.notified) : 'not connected', missed_estimated: r0(d.missed), poverty_pct_census: d.poverty, people_per_sleeping_room_census: d.crowding,
    insured_share_census: r2(d.insured), share_over_1h_walk_measured: r2(d.walk_far), mapped_facilities: d.facilities, prisons: d.prisons, mines_quarries: d.mines, approach: d.approach,
  });
  const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const campSummary = campaigns.map((c) => {
    const rs = results.filter((r) => r.campaign_id === c.id);
    const ts = tasks.filter((t) => t.campaign_id === c.id);
    return { name: c.name, district: c.district_name, city: c.city, setting: c.setting, status: c.status, start: c.start_date, screened: sum(rs, 'screened'), confirmed: sum(rs, 'confirmed'), started_treatment: sum(rs, 'started_treatment'), cough_ai_flagged: sum(rs, 'cough_flagged'), cough_ai_flagged_confirmed: sum(rs, 'cough_flagged_confirmed'), xray_ai_flagged: sum(rs, 'cxr_flagged'), xray_ai_flagged_confirmed: sum(rs, 'cxr_flagged_confirmed'), tasks_open: ts.filter((t) => t.status !== 'done').length, tasks_overdue: ts.filter((t) => t.status !== 'done' && t.due && t.due < today()).length };
  });
  const yields = params.filter((p) => p.status === 'evidence').map((p) => `${p.label}: ${p.value} ${p.unit || ''}`).join('\n');

  const scopes = [{ name: 'Ghana' }, ...districts.slice(0, 5).map((d) => ({ name: d.name, district: d }))];
  for (const s of scopes) {
    const ds = s.district ? [s.district] : districts;
    let towns = [];
    if (s.district) {
      try { towns = JSON.parse(fs.readFileSync(path.join(OUT, 'd', `${s.district.id}.json`), 'utf8')).towns || []; } catch { towns = []; }
    }
    const venues = towns.slice(0, 8).map((t) => ({ town: t.name, people_measured: t.pop, expected_cases_estimated: r0(t.expected), nearest_facility_km: t.facility_km }));
    const key = keysites.filter((x) => !s.district || x.district_id === s.district.id).sort((a, b) => b.pop_1km - a.pop_1km).slice(0, 8)
      .map((x) => ({ site: x.name || `unnamed ${x.kind}`, type: x.kind, district: x.district, people_within_1km_measured: x.pop_1km }));
    const camps = campSummary.filter((c) => !s.district || c.district === s.district.name);
    const input = {
      scope: s.name, today: today(), national_reported: { year: nat.year, expected_cases_who: nat.incidence, notified_who: nat.notified, detection_rate: nat.cdr },
      district_notifications_connected: ann.size > 0, rules: { low_detection_ratio: P.rule_low_detection ?? null, far_walk_share: P.rule_walk_far_share ?? null },
      priority_districts: ds.slice(0, 12).map(row), towns_to_visit: venues, key_population_sites: key, campaigns: camps,
    };
    const prompt = `You write the weekly TB case-finding brief for ${s.name} for Wadhwani AI Global, Aurum Institute and Ghana Health Service partners.
Use ONLY the numbers in INPUT and EVIDENCE. Never invent figures, places, organisations or results. Keep each figure's label: "reported" (WHO, DHIMS2, campaign reports), "measured" (open datasets) or "estimated".
If district_notifications_connected is false, say once that district "missed" figures apply the national detection rate, so they show where most cases are expected rather than where detection is weakest, and that DHIMS2 access would fix this.
Map data comes from OpenStreetMap and misses sites: say "mapped" and never claim a place has no facility.
Write in plain English for a district health director, in Markdown, max ~400 words, with these sections:
## Situation (2-3 sentences with the key numbers)
## Where to act in the next 4 weeks (numbered, 3-5 items: place, why, and the approach — detection_gap = review notification and testing at main facilities; remote_outreach = mobile X-ray to communities over an hour's walk from care; clinics_and_contacts = screen clinic attendees with X-ray + AI and trace household contacts. Use towns_to_visit for named places.)
## Key populations (prisons and mining sites to screen, with the published yields from EVIDENCE)
## What our screening is telling us (observed yield vs published yield; cough-AI and X-ray-AI confirmation rates; overdue tasks) — or "No screening results yet"
## Data to request (the one or two datasets that would most sharpen next week's brief)
INPUT:
${JSON.stringify(input)}
EVIDENCE (published screening yields):
${yields}`;
    try {
      const md = await gemini(prompt, { json: false, quality: true, temperature: 0.2 });
      const text = typeof md === 'string' ? md.trim() : JSON.stringify(md);
      await sb.upsert('tb_briefs', [{ id: `${s.name.toLowerCase().replace(/\W+/g, '-')}-${today()}`, scope: s.name, generated_at: new Date().toISOString(), model: geminiStatus.lastModel || 'Gemini', content_md: text, inputs: input }]);
      log('brief written', s.name, text.length, 'chars');
    } catch (e) {
      log('brief failed', s.name, e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
