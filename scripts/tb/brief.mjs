// TB summary (refreshed daily with the news feed): what changed, what is new in TB news and research, and action
// items for each audience. Gemini writes it as structured JSON from the inputs below only.
import fs from 'node:fs';
import path from 'node:path';
import { HAS_GEMINI, HAS_SB, gemini, geminiStatus, log, sb, today } from '../lib.mjs';

const DATA = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'public', 'data');
const read = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8').replace(/\bNaN\b/g, 'null'));
const r0 = (x) => (x == null ? null : Math.round(x));

const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence: the single most important thing right now.' },
    situation: { type: 'array', items: { type: 'string' }, description: '2-4 short bullets with the key numbers, each labelled reported/estimated.' },
    whats_new: {
      type: 'array', description: 'Up to 5 recent TB news or research items from NEWS that matter for Ghana programme work.',
      items: { type: 'object', properties: { id: { type: 'string' }, why_it_matters: { type: 'string' } }, required: ['id', 'why_it_matters'] },
    },
    actions: {
      type: 'array', description: '4-8 concrete action items.',
      items: {
        type: 'object',
        properties: {
          audience: { type: 'string', enum: ['Health workers', 'District health teams', 'National TB Programme / Government', 'Partners (Aurum, Wadhwani AI)'] },
          action: { type: 'string', description: 'Imperative, specific: what to do and where.' },
          why: { type: 'string', description: 'The evidence from INPUT or NEWS behind it.' },
          where: { type: 'string', description: 'District or town names from INPUT, or "National".' },
          priority: { type: 'string', enum: ['now', 'this month', 'next quarter'] },
        },
        required: ['audience', 'action', 'why', 'priority'],
      },
    },
    data_gaps: { type: 'array', items: { type: 'string' }, description: '1-3 data gaps that limit decisions, with who could close them.' },
  },
  required: ['headline', 'situation', 'whats_new', 'actions', 'data_gaps'],
};

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const meta = read('tb/meta.json');
  const nat = meta.national;
  const districts = read('tb/districts.geojson').features.map((f) => f.properties).sort((a, b) => b.expected - a.expected);
  const keysites = read('tb/keysites.json');
  const dhims2 = fs.existsSync(path.join(DATA, 'tb/dhims2.json')) ? read('tb/dhims2.json') : { connected: false };
  const insights = (read('insights.json').insights || [])
    .filter((i) => /tuberc|\btb\b/i.test(`${i.title} ${i.summary || ''}`) || (i.diseases || []).some((x) => /tuberc|^tb$/i.test(x)))
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')))
    .slice(0, 25);
  const [notif, campaigns, results, tasks] = await Promise.all([
    sb.select('tb_notifications', 'select=district_id,period,notified'), sb.select('tb_campaigns', 'select=*'),
    sb.select('tb_campaign_results', 'select=*'), sb.select('tb_tasks', 'select=status,due,campaign_id,role,title'),
  ]);
  const sum = (rows, k) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const input = {
    today: today(),
    national_reported: { year: nat.year, expected_cases_who: nat.incidence, notified_who: nat.notified, found_share: nat.cdr, rate_per_100k: nat.rate_100k },
    district_notifications: dhims2.connected ? `DHIMS2 connected (${dhims2.districts_matched} districts)` : notif.length ? `${new Set(notif.map((n) => n.district_id)).size} districts uploaded` : 'not connected: district figures are estimates',
    top_districts_estimated: districts.slice(0, 10).map((d) => ({ district: d.name, region: d.region, expected_cases: r0(d.expected), rate_per_100k: r0(d.expected_100k), vs_ghana: d.vs_ghana, poverty_pct: d.poverty, people_per_sleeping_room: d.crowding, insured_share: d.insured, share_over_1h_walk: d.walk_far, prisons: d.prisons, mines: d.mines })),
    highest_rate_districts_estimated: [...districts].sort((a, b) => b.expected_100k - a.expected_100k).slice(0, 5).map((d) => ({ district: d.name, rate_per_100k: r0(d.expected_100k), vs_ghana: d.vs_ghana })),
    far_from_care_districts: [...districts].sort((a, b) => (b.walk_far || 0) - (a.walk_far || 0)).slice(0, 5).map((d) => ({ district: d.name, share_over_1h_walk: d.walk_far, facilities: d.facilities })),
    key_population_sites: { prisons: keysites.filter((k) => k.kind === 'prison').length, mines_quarries: keysites.filter((k) => k.kind !== 'prison').length },
    campaigns: campaigns.map((c) => {
      const rs = results.filter((r) => r.campaign_id === c.id);
      const ts = tasks.filter((t) => t.campaign_id === c.id);
      return { name: c.name, district: c.district_name, town: c.town, status: c.status, start: c.start_date, screened: sum(rs, 'screened'), confirmed: sum(rs, 'confirmed'), started_treatment: sum(rs, 'started_treatment'), tasks_open: ts.filter((t) => t.status !== 'done').length, tasks_overdue: ts.filter((t) => t.status !== 'done' && t.due && t.due < today()).length };
    }),
  };
  const news = insights.map((i) => ({ id: i.id, title: i.title, summary: (i.summary || '').slice(0, 400), source: i.source_name, date: String(i.published_at || '').slice(0, 10), countries: i.countries }));
  const prompt = `You write the TB situation summary for Ghana for Wadhwani AI Global, Aurum Institute and Ghana Health Service partners.
Audience: health workers, district health teams and the National TB Programme. Plain English, short sentences, no jargon.
Rules: use ONLY numbers and facts from INPUT and NEWS. Never invent figures, places, organisations or results. Label figures "reported" or "estimated".
If district notifications are not connected, say district figures are estimates and include one data gap about DHIMS2 access.
Actions must be specific and doable: name the district or town from INPUT, say who does what. Prefer actions on campaigns that are overdue or have no results yet.
whats_new: pick only NEWS items relevant to TB programmes (case finding, diagnostics, treatment, funding, policy), prefer Ghana or West Africa; reference them by id; skip if none.
INPUT:
${JSON.stringify(input)}
NEWS:
${JSON.stringify(news)}`;
  const out = await gemini(prompt, { json: true, schema: SCHEMA, quality: true, temperature: 0.2 });
  const byId = new Map(insights.map((i) => [i.id, i]));
  out.whats_new = (out.whats_new || []).filter((w) => byId.has(w.id)).map((w) => ({ ...w, title: byId.get(w.id).title, url: byId.get(w.id).url, source: byId.get(w.id).source_name, date: String(byId.get(w.id).published_at || '').slice(0, 10) }));
  await sb.upsert('tb_briefs', [{ id: `ghana-${today()}`, scope: 'Ghana', generated_at: new Date().toISOString(), model: geminiStatus.lastModel || 'Gemini', content: out, content_md: out.headline, inputs: { ...input, news_considered: news.length } }]);
  log('summary written', out.actions?.length, 'actions', out.whats_new?.length, 'news');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
