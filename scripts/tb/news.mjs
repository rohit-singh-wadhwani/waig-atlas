// TB news summary (daily): reads the latest TB news from free Google News and Bing News feeds (Ghana first, then West
// Africa and global), and Gemini writes a short summary from the newest 45 of them: what's new (outbreaks, interventions, diagnostics, policy,
// funding), and 2-3 actions for the Ghana programme. Gemini only reads the fetched articles and cites them by number,
// so every source link is a real article. Stored in Supabase (tb_news), shown on the TB page and the Overview.
import path from 'node:path';
import { DATA, HAS_GEMINI, HAS_SB, gemini, geminiStatus, http, log, parseFeed, readJson, sb, today } from '../lib.mjs';

const DAYS = 45; // only articles from this window
const QUERIES = [
  ['Ghana', 'tuberculosis Ghana'], ['Ghana', 'TB screening Ghana'], ['Ghana', 'Ghana Health Service tuberculosis'],
  ['West Africa', 'tuberculosis Nigeria OR "Côte d\'Ivoire" OR Togo OR "Burkina Faso" OR "West Africa"'],
  ['Global', 'tuberculosis WHO'], ['Global', 'tuberculosis vaccine OR diagnostic OR treatment'], ['Global', 'tuberculosis funding Global Fund OR USAID'],
];
const FEEDS = [
  (q) => `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:${DAYS}d`)}&hl=en-GH&gl=GH&ceid=GH:en`,
  (q) => `https://www.bing.com/news/search?format=rss&count=30&q=${encodeURIComponent(q)}`,
];
const KINDS = ['outbreak', 'intervention', 'diagnostics', 'treatment', 'policy', 'funding', 'research'];
const SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One sentence: the most important TB development right now for Ghana programme work.' },
    points: {
      type: 'array', description: '3-5 items, Ghana first, most important first.',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'One short sentence: what happened and why it matters.' },
          scope: { type: 'string', enum: ['Ghana', 'West Africa', 'Global'] },
          kind: { type: 'string', enum: KINDS },
          n: { type: 'array', items: { type: 'integer' }, description: 'Numbers of the articles this comes from.' },
        },
        required: ['text', 'scope', 'kind', 'n'],
      },
    },
    actions: {
      type: 'array', description: '2-3 concrete actions that follow from the points.',
      items: {
        type: 'object',
        properties: { action: { type: 'string', description: 'Imperative, specific.' }, who: { type: 'string', description: 'A role, e.g. District TB Officer, National TB Programme, Partners.' }, why: { type: 'string', description: 'Which point it follows from.' } },
        required: ['action', 'who', 'why'],
      },
    },
  },
  required: ['headline', 'points', 'actions'],
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

/** Recent TB articles from the feeds, one per headline, tagged with the scope of the query that found them. */
async function articles(since) {
  const out = new Map();
  const got = {};
  for (const [scope, q] of QUERIES) {
    for (const feed of FEEDS) {
      const host = new URL(feed(q)).hostname;
      try {
        const items = parseFeed(await (await http(feed(q), {}, 30000)).text());
        got[host] = (got[host] || 0) + items.length;
        for (const it of items) {
          const [title, source = ''] = it.title.split(/ - (?=[^-]+$)/);
          const key = title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
          if (!/tuberculosis|\btb\b/i.test(`${it.title} ${it.text}`) || (it.date && it.date.slice(0, 10) < since) || out.has(key)) continue;
          out.set(key, { scope, title, source, url: unwrap(it.url), date: it.date ? it.date.slice(0, 10) : null, text: (it.text || '').replace(title, '').slice(0, 300) });
        }
      } catch (e) {
        log('feed failed', host, q, e.message);
      }
    }
  }
  log('feed items', got, '→', out.size, 'recent TB articles');
  return [...out.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function main() {
  if (!HAS_GEMINI || !HAS_SB) throw new Error('needs GEMINI_API_KEY and SUPABASE_SERVICE_ROLE_KEY');
  const since = new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10);
  // the newest articles, Ghana first, kept short enough for a fast model
  const all = await articles(since);
  const arts = [...all.filter((a) => a.scope === 'Ghana').slice(0, 25), ...all.filter((a) => a.scope !== 'Ghana').slice(0, 20)];
  if (!arts.length) throw new Error('no recent TB articles in the feeds');
  const districts = readJson(path.join(DATA, 'tb', 'districts.geojson'), { features: [] }).features.map((f) => f.properties);
  const top = [...districts].sort((a, b) => b.expected - a.expected).slice(0, 8).map((d) => d.name);
  const campaigns = (await sb.select('tb_campaigns', 'select=name,district_name,status')).filter((c) => c.status !== 'done');
  const list = arts.map((a, i) => `[${i}] ${a.date || ''} | ${a.scope} | ${a.source} | ${a.title} | ${a.text}`).join('\n');
  const prompt = `You brief Ghana TB programme staff (district teams, the National TB Programme, partners such as Aurum Institute) on the latest TB news.
Below are recent news articles, one per line as [number] date | scope | publisher | headline | snippet.
Write a short, plain-English summary using ONLY these articles: no outside facts, no invented numbers or places. Cite each point's articles by number.
Prefer Ghana, then West Africa, then global items that change what a programme should do (outbreaks, screening drives, new diagnostics or treatment, guideline changes, funding cuts or new funding). Skip awareness pieces and opinion.
Actions: 2-3, specific and doable, following from the points. Where useful, tie them to the highest-burden districts (${top.join(', ')})${campaigns.length ? ` or our open campaigns (${campaigns.map((c) => `${c.name}, ${c.district_name}`).join('; ')})` : ''}.

${list}`;
  const out = await gemini(prompt, { json: true, schema: SCHEMA, temperature: 0.2 });
  const points = (out.points || [])
    .map((p) => ({ text: p.text, scope: p.scope, kind: p.kind, sources: [...new Set(p.n || [])].map((n) => arts[n]).filter(Boolean).map(({ title, url, source, date }) => ({ title, url, source, date })) }))
    .filter((p) => p.text && p.sources.length);
  if (!out.headline || !points.length) throw new Error('Gemini returned no usable summary');
  await sb.upsert('tb_news', [{ id: `news-${today()}`, generated_at: new Date().toISOString(), model: geminiStatus.lastModel || 'Gemini', headline: out.headline, points, actions: (out.actions || []).slice(0, 3), articles: arts.length }]);
  const old = await sb.select('tb_news', `select=id&generated_at=lt.${new Date(Date.now() - 30 * 864e5).toISOString()}`);
  for (const r of old) await sb.remove('tb_news', r.id);
  log('news summary:', arts.length, 'articles,', points.length, 'points,', out.actions?.length || 0, 'actions');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
