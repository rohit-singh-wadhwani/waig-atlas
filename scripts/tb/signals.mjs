// TB map signals: a Gemini agent with Google Search looks for recent TB events in Ghana that are tied to a place
// (clusters, stock-outs, screening drives, new diagnostic sites, facility problems, congregate settings), checks each
// against the districts and towns in our data, and stores the ones it can place. They show as pins on the TB map.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, HAS_GEMINI, HAS_SB, gemini, hash, log, readJson, sb } from '../lib.mjs';

const KINDS = ['cluster or outbreak', 'stock-out', 'screening drive', 'new diagnostic site', 'facility problem', 'congregate setting', 'funding or policy'];
const DAYS = 120; // signals older than this are removed

const norm = (s) => String(s || '').toLowerCase().replace(/\b(municipal|metropolitan|district|assembly|area|region)\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Places we can pin: every district (its centre) and every named town (its point), keyed by normalised name. */
function gazetteer() {
  const geo = readJson(path.join(DATA, 'tb', 'districts.geojson'), { features: [] });
  const districts = geo.features.map((f) => f.properties);
  const byDistrict = new Map(districts.map((d) => [norm(d.name), d]));
  const towns = new Map();
  for (const d of districts) {
    const file = path.join(DATA, 'tb', 'd', `${d.id}.json`);
    if (!fs.existsSync(file)) continue;
    for (const t of JSON.parse(fs.readFileSync(file, 'utf8').replace(/\bNaN\b/g, 'null')).towns || []) {
      const k = norm(t.name);
      if (k && !towns.has(k)) towns.set(k, { ...t, district: d });
    }
  }
  return { districts, byDistrict, towns };
}

function place(item, gz) {
  const t = gz.towns.get(norm(item.town || item.place));
  const d = gz.byDistrict.get(norm(item.district));
  if (t && (!d || t.district.id === d.id)) return { lon: t.lon, lat: t.lat, district: t.district, precision: 'town', place: t.name };
  if (d) return { lon: d.lon, lat: d.lat, district: d, precision: 'district', place: item.town || item.place || d.name };
  return null;
}

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const gz = gazetteer();
  const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  const prompt = `Use Google Search to find news, reports and official announcements published since ${since} about tuberculosis (TB) in Ghana that are tied to a specific place (a town, community, district, facility, prison, mine or market).
Include only these kinds: ${KINDS.join('; ')}.
Return ONLY a JSON array (no prose). Each item: {"title": short headline, "summary": one sentence on what happened and why it matters for TB case finding, "kind": one of the kinds above, "town": town or community name or "", "district": Ghana district name or "", "date": "YYYY-MM-DD" publication date, "url": the article or report URL, "source": publisher}.
Rules: Ghana only; real items you found with Search, never invented; skip national items with no place; at most 15 items.`;
  const out = await gemini(prompt, { search: true, json: true, temperature: 0.1 });
  const items = Array.isArray(out) ? out : Array.isArray(out?.items) ? out.items : [];
  const rows = [];
  for (const it of items) {
    if (!it?.title || !/^https?:\/\//.test(it.url || '') || !KINDS.includes(it.kind)) continue;
    if (it.date && it.date < since) continue;
    const p = place(it, gz);
    if (!p) {
      log('cannot place', it.title, '|', it.town, '|', it.district);
      continue;
    }
    rows.push({
      id: hash(`${it.url}|${p.place}`), title: String(it.title).slice(0, 200), summary: String(it.summary || '').slice(0, 400), kind: it.kind,
      place: p.place, district_id: p.district.id, district_name: p.district.name, lon: p.lon, lat: p.lat, precision: p.precision,
      url: it.url, source: String(it.source || '').slice(0, 120), published: /^\d{4}-\d{2}-\d{2}$/.test(it.date || '') ? it.date : null,
    });
  }
  if (rows.length) await sb.upsert('tb_signals', rows);
  const old = await sb.select('tb_signals', `select=id&published=lt.${since}`);
  for (const r of old) await sb.remove('tb_signals', r.id);
  log('signals', items.length, 'found,', rows.length, 'placed,', old.length, 'expired');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
