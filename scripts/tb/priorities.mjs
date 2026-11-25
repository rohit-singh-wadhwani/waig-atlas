// TB AI priorities (daily). Ranks the districts a programme officer should screen in next, and which towns to start
// with, from two kinds of evidence:
//   1. the dashboard's own figures for each district (expected cases and rate, settlement density, facilities, travel
//      time, key populations, poverty, crowding, campaigns already there), and
//   2. what has been reported recently about those places: news (Google News and Bing News feeds, searched nationally
//      and by district name) and research (PubMed).
// Gemini reads both and returns a ranked list with a one-line reason and the factors behind it. Every factor quotes a
// figure it was given or cites a fetched item by number, so each source link is real; picks and towns outside the
// lists it was given are dropped. Stored in Supabase (tb_priorities) and shown in the TB page's district list.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, HAS_GEMINI, HAS_SB, gemini, geminiStatus, http, log, parseFeed, readJson, sb, today } from '../lib.mjs';

const NEWS_DAYS = 90; // news window: TB reports are sparse, so a quarter
const PAPER_DAYS = 730; // research window
const PER_LIST = 12; // districts taken from each data ranking into the candidate set
const SEARCHED = 25; // candidates also searched in the news by name
const MAX_CANDIDATES = 50;
const MAX_PICKS = 10;
const TOWNS_SHOWN = 5; // towns per candidate given to the model
const MIN_TOWN_POP = 5000; // smaller places are not matched by name in articles (too many common words)

const FEEDS = [
  (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${NEWS_DAYS}d`)}&hl=en-GH&gl=GH&ceid=GH:en`,
  (q) => `https://www.bing.com/news/search?format=rss&count=30&q=${encodeURIComponent(q)}`,
];
const NATIONAL = ['tuberculosis Ghana', 'TB screening Ghana', 'TB outbreak Ghana', 'Ghana Health Service tuberculosis', 'tuberculosis Ghana prison OR mine OR market'];

const SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two sentences at most: where to focus screening now and the main reason.' },
    picks: {
      type: 'array', description: `Up to ${MAX_PICKS} districts, highest priority first.`,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The district id exactly as given.' },
          why: { type: 'string', description: 'One line, at most 20 words: why this district now.' },
          signal: { type: 'string', enum: ['data', 'news', 'research', 'mixed'], description: 'What mainly lifted it: its figures, recent news, research, or a mix.' },
          factors: {
            type: 'array', description: '2-5 factors, strongest first.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: ['data', 'news', 'research'] },
                text: { type: 'string', description: 'One sentence quoting the figure, or saying what the item reports.' },
                n: { type: 'array', items: { type: 'integer' }, description: 'Item numbers for news or research factors; empty for data.' },
              },
              required: ['kind', 'text', 'n'],
            },
          },
          towns: {
            type: 'array', description: '1-3 towns to start with, from that district\'s town list.',
            items: { type: 'object', properties: { name: { type: 'string' }, why: { type: 'string', description: 'At most 15 words.' } }, required: ['name', 'why'] },
          },
        },
        required: ['id', 'why', 'signal', 'factors', 'towns'],
      },
    },
  },
  required: ['summary', 'picks'],
};

const norm = (s) => String(s || '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\b(municipal|metropolitan|metro|district|assembly|area)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const pct = (v) => (v == null ? '?' : `${Math.round(v * 100)}%`);
const num = (v) => (v == null ? '?' : Math.round(v).toLocaleString('en-US'));

/** Every district's dashboard figures, with its towns and gathering places from the district file. */
function loadDistricts() {
  const geo = readJson('tb/districts.geojson', { features: [] });
  return geo.features.map((f) => {
    const d = f.properties;
    const file = path.join(DATA, 'tb', 'd', `${d.id}.json`);
    const det = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8').replace(/\bNaN\b/g, 'null')) : { towns: [] };
    return { ...d, towns: [...(det.towns || [])].sort((a, b) => (b.expected || 0) - (a.expected || 0)) };
  });
}

/** Candidates: the top of each data ranking, so the model weighs districts that lead on any one measure. */
function candidates(dists) {
  const top = (arr, key, dir = -1) => [...arr].filter((d) => d[key] != null).sort((a, b) => dir * (a[key] - b[key])).slice(0, PER_LIST);
  const sized = dists.filter((d) => d.pop >= 50000); // per-person measures are noisy for very small districts
  const keySites = (d) => (d.prisons || 0) + (d.mines || 0) + (d.ports || 0);
  const lists = [
    top(dists, 'expected'), top(sized, 'expected_100k'), top(sized, 'fac_100k', 1), top(sized, 'walk_far'),
    [...dists].filter((d) => keySites(d) > 0).sort((a, b) => keySites(b) - keySites(a)).slice(0, PER_LIST),
  ];
  const out = new Map();
  for (const l of lists) for (const d of l) out.set(d.id, d);
  return [...out.values()];
}

/** Place names that identify a district in an article: its own name and its larger towns. */
function gazetteer(dists) {
  const g = new Map();
  for (const d of dists) {
    const k = norm(d.name);
    if (k.length > 3) g.set(k, d.id);
    for (const t of d.towns) if (t.pop >= MIN_TOWN_POP && norm(t.name).length > 4 && !g.has(norm(t.name))) g.set(norm(t.name), d.id);
  }
  return g;
}

const mentions = (text, g) => {
  const t = ` ${norm(text)} `;
  return [...new Set([...g.entries()].filter(([k]) => t.includes(` ${k} `)).map(([, id]) => id))];
};

/** Bing news links carry the article address in a url= parameter. */
function unwrap(u) {
  try {
    const x = new URL(u);
    return /bing\.com$/.test(x.hostname) && x.searchParams.get('url') ? x.searchParams.get('url') : u;
  } catch {
    return u;
  }
}

/** Recent TB news about Ghana, searched nationally and by the names of the leading candidate districts. */
async function news(queries) {
  const since = new Date(Date.now() - NEWS_DAYS * 864e5).toISOString().slice(0, 10);
  const out = new Map();
  for (const q of queries) {
    for (const feed of FEEDS) {
      try {
        for (const it of parseFeed(await (await http(feed(q), {}, 30000)).text())) {
          const [title, source = ''] = it.title.split(/ - (?=[^-]+$)/);
          const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (!/tuberculosis|\btb\b/i.test(`${it.title} ${it.text}`) || (it.date && it.date.slice(0, 10) < since) || out.has(key)) continue;
          out.set(key, { kind: 'news', title, source, url: unwrap(it.url), date: it.date ? it.date.slice(0, 10) : null, text: (it.text || '').replace(title, '').slice(0, 300) });
        }
      } catch (e) {
        log('feed failed', new URL(feed(q)).hostname, q, e.message);
      }
    }
  }
  return [...out.values()];
}

/** Recent research on TB in Ghana from PubMed (titles, journal, date). */
async function research() {
  const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
  try {
    const ids = (await (await http(`${base}/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=60&datetype=pdat&reldate=${PAPER_DAYS}&term=${encodeURIComponent('tuberculosis[tiab] AND Ghana[tiab]')}`)).json()).esearchresult?.idlist || [];
    if (!ids.length) return [];
    const sum = (await (await http(`${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`)).json()).result || {};
    return ids.map((id) => sum[id]).filter(Boolean).map((p) => ({
      kind: 'research', title: p.title, source: p.fulljournalname || p.source || 'PubMed', url: `https://pubmed.ncbi.nlm.nih.gov/${p.uid}/`,
      date: /^\d{4}/.test(p.sortpubdate || '') ? p.sortpubdate.slice(0, 10).replace(/\//g, '-') : null, text: '',
    }));
  } catch (e) {
    log('PubMed failed', e.message);
    return [];
  }
}

/** One line per candidate district: the figures the dashboard shows, its campaigns, top towns and the items naming it. */
function describe(d, items, camps, natRate) {
  const sites = [['prison', d.prisons], ['mine', d.mines], ['port', d.ports], ['market', d.markets]].filter(([, n]) => n).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(', ') || 'none mapped';
  const c = camps.filter((x) => x.district_id === d.id);
  const towns = d.towns.slice(0, TOWNS_SHOWN).map((t) => `${t.name} (${num(t.pop)} people, ${num(t.expected)} cases/yr, facility ${t.facility_km != null ? `${t.facility_km.toFixed(1)} km` : '?'})`).join('; ');
  const refs = items.map((it, i) => (it.places.includes(d.id) ? i : -1)).filter((i) => i >= 0);
  return [
    `${d.id} | ${d.name}, ${d.region}`,
    `expected ${num(d.expected)} cases/yr, ${num(d.expected_100k)} per 100k people (Ghana ${num(natRate)})`,
    `${num(d.pop)} people, ${pct(d.dense)} in dense settlements, ${d.ppb ? d.ppb.toFixed(1) : '?'} people per building`,
    `${num(d.facilities)} health facilities (${d.fac_100k != null ? d.fac_100k.toFixed(1) : '?'} per 100k), ${num(d.hospitals)} hospitals, ${pct(d.walk_far)} over 1 h walk from care`,
    `key sites: ${sites}; poverty ${d.poverty != null ? `${Math.round(d.poverty)}%` : '?'}; crowding ${d.crowding ? d.crowding.toFixed(1) : '?'} per room`,
    `campaigns here: ${c.length ? c.map((x) => `${x.name} (${x.status})`).join('; ') : 'none'}`,
    `towns: ${towns || 'none'}`,
    `items naming it: ${refs.length ? refs.map((i) => `[${i}]`).join(' ') : 'none'}`,
  ].join(' | ');
}

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const dists = loadDistricts();
  const byId = new Map(dists.map((d) => [d.id, d]));
  const natRate = readJson('tb/meta.json', {})?.national?.rate_100k ?? null;
  const camps = await sb.select('tb_campaigns', 'select=name,district_id,status');
  const g = gazetteer(dists);

  let cands = candidates(dists);
  const queries = [...NATIONAL, ...cands.slice(0, SEARCHED).map((d) => `tuberculosis "${d.name.replace(/\s*\(.*\)/, '').replace(/\b(Municipal|Metropolitan|District|Area)\b/g, '').replace(/\s+/g, ' ').trim()}"`)];
  const items = [...(await news(queries)), ...(await research())]
    .map((it) => ({ ...it, places: mentions(`${it.title} ${it.text}`, g) }))
    .filter((it) => it.places.length || /ghana/i.test(`${it.title} ${it.text}`));
  // districts named in recent news or research join the candidates even if their figures did not put them there
  for (const it of items) for (const id of it.places) if (!cands.some((d) => d.id === id) && byId.has(id)) cands.push(byId.get(id));
  cands = cands.slice(0, MAX_CANDIDATES);
  log('candidates', cands.length, '· items', items.length, `(${items.filter((x) => x.kind === 'news').length} news, ${items.filter((x) => x.kind === 'research').length} research)`);

  const prompt = `You help a Ghana TB programme officer decide which districts to screen in next, and which towns to start with.
Rank up to ${MAX_PICKS} of the candidate districts below. Use their figures (from the programme's dashboard) and the numbered news and research items.
How to weigh: expected cases and rate show where TB is likely; few facilities, long walks to care, dense settlements, crowding and poverty mean cases go unfound; prisons, mines and ports are WHO priority settings. A recent report of TB in a place (an outbreak, cluster, school or prison cases, stock-outs, a screening gap) can lift a district above one with higher modelled burden: say so when it does. A district with an active campaign is lower priority unless the evidence says more is needed there.
Rules: quote only figures given here; a news or research factor must cite item numbers that name that place; never invent places, numbers or events; town names must come from that district's town list.

CANDIDATE DISTRICTS (id | name, region | figures):
${cands.map((d) => describe(d, items, camps, natRate)).join('\n')}

ITEMS ([number] date | kind | publisher | title | snippet):
${items.map((it, i) => `[${i}] ${it.date || ''} | ${it.kind} | ${it.source} | ${it.title} | ${it.text}`).join('\n') || 'none found'}`;

  const out = await gemini(prompt, { json: true, schema: SCHEMA, temperature: 0.2 });
  const seen = new Set();
  const picks = (out.picks || []).flatMap((p) => {
    const d = cands.find((x) => x.id === p.id);
    if (!d || seen.has(d.id)) return [];
    seen.add(d.id);
    const factors = (p.factors || []).map((f) => ({
      kind: f.kind, text: f.text,
      sources: f.kind === 'data' ? [] : [...new Set(f.n || [])].map((n) => items[n]).filter((it) => it && it.places.includes(d.id)).map(({ title, url, source, date }) => ({ title, url, source, date })),
    })).filter((f) => f.text && (f.kind === 'data' || f.sources.length)); // a news or research factor without a matching item is dropped
    const towns = (p.towns || []).filter((t) => d.towns.some((x) => x.name === t.name)).slice(0, 3);
    return factors.length ? [{ district_id: d.id, district_name: d.name, why: p.why, signal: p.signal, factors, towns }] : [];
  }).slice(0, MAX_PICKS);
  if (!picks.length) throw new Error('the model returned no usable priorities');

  await sb.upsert('tb_priorities', [{
    id: `prio-${today()}`, generated_at: new Date().toISOString(), model: geminiStatus.lastModel || null, summary: out.summary || '', picks,
    inputs: { districts: cands.length, news: items.filter((x) => x.kind === 'news').length, research: items.filter((x) => x.kind === 'research').length, news_days: NEWS_DAYS, research_days: PAPER_DAYS },
  }]);
  const old = await sb.select('tb_priorities', `select=id&generated_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`);
  for (const r of old) await sb.remove('tb_priorities', r.id);
  log('priorities:', picks.length, 'picks from', cands.length, 'candidates and', items.length, 'items');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
