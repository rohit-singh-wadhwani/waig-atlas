// TB map signals: an agent reads the latest TB news for Ghana (Google News and Bing News feeds, free), asks Gemini
// which articles report something tied to a place (clusters, stock-outs, screening drives, new diagnostic sites,
// facility problems, congregate settings, funding or policy), checks the place against the districts and towns in our
// data, and stores the ones it can pin. Gemini only reads and sorts the fetched articles, so every link is a real
// article; it never searches or writes links itself. They show as pins on the TB map.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, HAS_GEMINI, HAS_SB, gemini, hash, http, log, parseFeed, readJson, sb } from '../lib.mjs';

const KINDS = ['cluster or outbreak', 'stock-out', 'screening drive', 'new diagnostic site', 'facility problem', 'congregate setting', 'funding or policy'];
const DAYS = 120; // articles and signals older than this are ignored or removed
const QUERIES = ['tuberculosis Ghana', 'TB screening Ghana', 'TB cases Ghana district', 'GeneXpert Ghana', 'tuberculosis Ghana prison OR mine OR market'];
const FEEDS = [
  (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${DAYS}d`)}&hl=en-GH&gl=GH&ceid=GH:en`,
  (q) => `https://www.bing.com/news/search?format=rss&count=30&q=${encodeURIComponent(q)}`,
];

/** Bing news links carry the article address in a url= parameter. */
function unwrap(u) {
  try {
    const x = new URL(u);
    return /bing\.com$/.test(x.hostname) && x.searchParams.get('url') ? x.searchParams.get('url') : u;
  } catch {
    return u;
  }
}

/** Recent articles from the news feeds, one per headline. */
async function articles(since) {
  const out = new Map();
  const got = {};
  for (const q of QUERIES) {
    for (const feed of FEEDS) {
      const host = new URL(feed(q)).hostname;
      try {
        const xml = await (await http(feed(q), {}, 30000)).text();
        const items = parseFeed(xml);
        got[host] = (got[host] || 0) + items.length;
        for (const it of items) {
          const [title, source = ''] = it.title.split(/ - (?=[^-]+$)/);
          const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (!/tuberculosis|\btb\b/i.test(`${it.title} ${it.text}`) || (it.date && it.date.slice(0, 10) < since) || out.has(key)) continue;
          out.set(key, { title, source, url: unwrap(it.url), date: it.date ? it.date.slice(0, 10) : null, text: (it.text || '').replace(title, '').slice(0, 300) });
        }
      } catch (e) {
        log('feed failed', feed(q).slice(0, 60), e.message);
      }
    }
  }
  log('feed items', got, '→', out.size, 'recent TB articles');
  return [...out.values()];
}

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
  const arts = (await articles(since)).slice(0, 80);
  const rows = [];
  if (arts.length) {
    const list = arts.map((a, i) => `[${i}] ${a.date || ''} | ${a.source} | ${a.title} | ${a.text}`).join('\n');
    const prompt = `Below are recent news articles about tuberculosis (TB) in Ghana, one per line as [number] date | publisher | headline | snippet.
Pick the ones that report something tied to a specific place in Ghana (a town, community, district, facility, prison, mine or market) and that fall into one of these kinds: ${KINDS.join('; ')}.
Return ONLY a JSON array. Each item: {"n": the article number, "kind": one of the kinds above, "town": town or community name or "", "district": Ghana district name or "", "summary": one sentence on what happened and why it matters for finding TB cases}.
Use only what the headline and snippet say; skip national items with no place, items outside Ghana, and general awareness pieces.

${list}`;
    const out = await gemini(prompt, { json: true, temperature: 0.1 });
    const picks = Array.isArray(out) ? out : Array.isArray(out?.items) ? out.items : [];
    log('Gemini picked', picks.length, 'place-tied articles of', arts.length);
    for (const it of picks) {
      const a = arts[Number(it?.n)];
      if (!a || !KINDS.includes(it.kind)) continue;
      const p = place(it, gz);
      if (!p) {
        log('cannot place', a.title, '|', it.town, '|', it.district);
        continue;
      }
      rows.push({
        id: hash(`${a.url}|${p.place}`), title: a.title.slice(0, 200), summary: String(it.summary || '').slice(0, 400), kind: it.kind,
        place: p.place, district_id: p.district.id, district_name: p.district.name, lon: p.lon, lat: p.lat, precision: p.precision,
        url: a.url, source: a.source.slice(0, 120), published: a.date,
      });
    }
  }
  if (rows.length) await sb.upsert('tb_signals', rows);
  const old = await sb.select('tb_signals', `select=id&published=lt.${since}`);
  for (const r of old) await sb.remove('tb_signals', r.id);
  log('signals:', arts.length, 'recent articles,', rows.length, 'placed,', old.length, 'expired');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
