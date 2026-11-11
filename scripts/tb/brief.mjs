// Weekly TB brief: Gemini writes a short, grounded action brief for Ghana and each city from the pipeline outputs,
// private estimates, campaigns, results, tasks and the evidence table. Numbers must come from the inputs only.
import fs from 'node:fs';
import path from 'node:path';
import { HAS_GEMINI, HAS_SB, gemini, geminiStatus, log, sb, today } from '../lib.mjs';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'public', 'data', 'tb');
const read = (f) => JSON.parse(fs.readFileSync(path.join(OUT, f), 'utf8'));
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const districts = read('districts.geojson').features.map((f) => f.properties);
  const hexes = read('cities.geojson').features.map((f) => f.properties);
  const meta = read('meta.json');
  const [est, campaigns, results, tasks, params, playbooks, cities] = await Promise.all([
    sb.select('tb_estimates', 'select=*'), sb.select('tb_campaigns', 'select=*'), sb.select('tb_campaign_results', 'select=*'),
    sb.select('tb_tasks', 'select=status,due,role,campaign_id'), sb.select('tb_parameters', 'select=id,label,value,unit,status'),
    sb.select('tb_playbooks', 'select=id,name,trigger&enabled=eq.true'), sb.select('tb_cities', 'select=*&enabled=eq.true'),
  ]);
  const estBy = new Map(est.map((e) => [e.district_id, e]));
  const merged = districts.map((d) => ({ ...d, ...(estBy.get(d.id) ? { expected: estBy.get(d.id).expected, hidden: estBy.get(d.id).hidden, notified_uploaded: estBy.get(d.id).notified, gap: estBy.get(d.id).gap, calibration: estBy.get(d.id).calibration, blind: estBy.get(d.id).blind_spot, priority: estBy.get(d.id).priority, rank: estBy.get(d.id).rank } : {}) }));
  const brief = (d) => ({ district: d.name, region: d.region, rank: d.rank, pop: Math.round(d.pop), expected: r1(d.expected), hidden: r1(d.hidden), hidden_per_100k: r1(d.hidden_100k), notified_uploaded: d.notified_uploaded ?? null, blind_spot: r1(d.blind), travel_min: d.minutes, pct_over_1h: d.pct_far, crowding_x: d.m_density, poverty_x: d.m_poverty, risk_factors_x: d.m_risk, prisons: d.prisons, mines: d.mines, markets: d.markets, transport_hubs: d.hubs, facilities: d.facilities, campaign_calibration: d.calibration ?? null });
  const sum = (rows, k) => rows.reduce((s, r) => s + (r[k] || 0), 0);
  const campSummary = campaigns.map((c) => {
    const rs = results.filter((r) => r.campaign_id === c.id);
    const ts = tasks.filter((t) => t.campaign_id === c.id);
    return { name: c.name, district: c.district_name, city: c.city, setting: c.setting, status: c.status, start: c.start_date, screened: sum(rs, 'screened'), confirmed: sum(rs, 'confirmed'), started_treatment: sum(rs, 'started_treatment'), cough_flagged: sum(rs, 'cough_flagged'), cough_flagged_confirmed: sum(rs, 'cough_flagged_confirmed'), cxr_flagged: sum(rs, 'cxr_flagged'), cxr_flagged_confirmed: sum(rs, 'cxr_flagged_confirmed'), predicted_positivity: c.predicted_positivity, tasks_open: ts.filter((t) => t.status !== 'done').length, tasks_overdue: ts.filter((t) => t.status !== 'done' && t.due && t.due < today()).length };
  });
  const evidence = params.map((p) => `${p.id}: ${p.label} = ${p.value} ${p.unit || ''} [${p.status}]`).join('\n');

  const scopes = [{ name: 'Ghana', districts: merged, hexes: [] }];
  for (const c of cities) {
    const ch = hexes.filter((h) => h.city === c.id);
    const names = new Set(ch.map((h) => h.district));
    scopes.push({ name: c.name.split(' (')[0], city: c, districts: merged.filter((d) => names.has(d.name)), hexes: ch });
  }

  for (const s of scopes) {
    const top = [...s.districts].sort((a, b) => a.rank - b.rank).slice(0, s.city ? 8 : 12).map(brief);
    const blind = [...s.districts].sort((a, b) => b.blind - a.blind).slice(0, 5).map((d) => ({ district: d.name, blind_spot: r1(d.blind), travel_min: d.minutes, pct_over_1h: d.pct_far, facilities: d.facilities }));
    const topHex = [...s.hexes].sort((a, b) => b.hidden - a.hidden).slice(0, 10).map((h) => ({ district: h.district, pop: h.pop, density: h.density, rwi: h.rwi, facility_km: h.facility_km, nearby: h.sites, hidden: h.hidden }));
    const camps = campSummary.filter((c) => !s.city || c.city === s.city.id || s.districts.some((d) => d.name === c.district));
    const input = {
      scope: s.name, today: today(), national: meta.national, model_note: `Open-data model; access from ${meta.access_basis}; private inputs: ${meta.private}`,
      priority_districts: top, blind_spots: blind, priority_hexagons_0_7km2: topHex, campaigns: camps, playbooks,
      city_partner: s.city?.city_partner || null,
    };
    const prompt = `You write the weekly TB case-finding brief for ${s.name} for Wadhwani AI Global, Aurum Institute and Ghana Health Service partners.
Use ONLY the numbers in INPUT and EVIDENCE. Never invent figures, places, organisations or results. Say "modelled" for model outputs and "reported" for campaign or uploaded data. If campaigns or notifications are missing, say so plainly and say what data would fix it.
Facility, market, prison and mine counts come from OpenStreetMap and are often incomplete in rural districts: write "mapped facilities" and never claim a district has no health facility.
Write in plain English for a district health director, in Markdown, max ~450 words, with these sections:
## Situation (2-3 sentences with the key numbers)
## Where to act in the next 4 weeks (numbered, 3-5 items: place, why — cite drivers such as crowding, poverty, distance to care, prisons/mines/markets — and which playbook id to use; include expected people screened per case found when you can compute it as 1/(prev_general_ghana/100000 × cxr_cad_sensitivity × risk), otherwise omit)
## Blind spots (where we have no picture, and the cheapest way to look)
## What campaigns are telling us (observed vs expected yield; cough-AI and X-ray-AI confirmation rates; overdue tasks) — or "No campaign results yet"
## Data to request (specific datasets/partners that would most improve the next brief)
INPUT:
${JSON.stringify(input)}
EVIDENCE (model parameters):
${evidence}`;
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
