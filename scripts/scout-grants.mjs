// Grant scout: finds open opportunities like the ones the team tracks (foundation calls, tech-philanthropy
// partnerships, innovation funds, Global Fund / UN tenders, EU calls) and has Gemini write them up in the
// team's sheet format: funder, funding range, deadline, sector, geography, fit, eligible as, description.
//
// Channels (all configurable on the Sources page, category "grants"):
//   scout_search  Gemini with Google Search grounding; url = the search brief
//   scout_page    a funder's "open calls" page; Gemini reads it when it changes
//   scout_feed    an RSS feed of opportunities (aggregators)
//   scout_eu      EU Funding & Tenders portal search; url = search text
//   scout_web     free web + news search (Bing RSS); url = search queries, one per line. Gemini reads the hits.
import {
  HAS_GEMINI, HAS_SB, chunk, gemini, geminiAvailable, geminiStatus, hash, http, loadSources, log, orgContext, parseFeed,
  readJson, recordRun, reportSource, sb, stripHtml, today, writeJson,
} from './lib.mjs';

const MAX_NEW = Number(process.env.MAX_SCOUT_NEW || 60);
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const FIT_SCORE = { high: 80, medium: 55, 'medium - low': 40, low: 25, 'not eligible': 5 };
const FITS = ['High', 'Medium', 'Medium - Low', 'Low', 'Not eligible'];

const fetchPage = (url) => http(url, { headers: { 'user-agent': BROWSER_UA, accept: 'text/html,application/xhtml+xml,*/*' } }, 30000).then((r) => r.text());

/* ---------- de-duplication ---------- */
const STOP = new Set('the and for with from that this call calls open grant grants program programme fund funding proposals proposal request rfp 2025 2026 2027 2028 round edition initiative challenge'.split(' '));
const words = (s) => new Set(String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(' ').filter((w) => w.length > 2 && !STOP.has(w)));
function similar(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
}
const deepPath = (u) => {
  try {
    const x = new URL(u);
    return x.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length >= 2 ? x.host + x.pathname.replace(/\/+$/, '') : null;
  } catch {
    return null;
  }
};
function isDuplicate(c, known) {
  const p = deepPath(c.url);
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  return known.some((k) => (p && deepPath(k.url) === p && similar(c.title, k.title) >= 0.3) ||
    (host(c.url) && host(c.url) === host(k.url) && similar(c.title, k.title) >= 0.5) || (similar(c.title, k.title) >= 0.7 && (similar(c.funder, k.funder) >= 0.5 || !c.funder || !k.funder)));
}

/* ---------- structured output (Gemini must return valid JSON in this shape) ---------- */
const S = (props, req = []) => ({ type: 'OBJECT', properties: props, required: req });
const STR = { type: 'STRING', nullable: true };
const LIST = { type: 'ARRAY', items: { type: 'STRING' } };
const RAW_SCHEMA = { type: 'ARRAY', items: S({ title: { type: 'STRING' }, funder: STR, url: STR, deadline_text: STR, amount: STR, text: STR }, ['title']) };
const WRITEUP_SCHEMA = {
  type: 'ARRAY',
  items: S({
    i: { type: 'INTEGER' }, relevant: { type: 'BOOLEAN' }, open: { type: 'BOOLEAN' }, title: STR, funder: STR, funding_range: STR,
    amount_usd: { type: 'NUMBER', nullable: true }, deadline: STR, deadline_text: STR, sector: STR, geography: STR, countries: LIST,
    fit: { type: 'STRING', enum: ['High', 'Medium', 'Medium - Low', 'Low', 'Not eligible'] }, eligible_as: STR, description: STR,
    requirements: STR, strengths: LIST, weaknesses: LIST, why: STR, themes: LIST,
  }, ['i', 'relevant', 'open', 'fit']),
};
const HEALTHY = /health|medic|disease|clinic|epidemi|diagnos|hospital|nutrition|maternal|vaccin|tubercul|malaria|hiv|pandemic|public service|social impact|development|lmic|africa|india|global south/i;
const JUNK = /scholarship|fellowship|phd|master'?s|student|playwright|film|music|art(ist)?s? |restaurant|essay|photography|journalis|internship|conference|webinar/i;

/* ---------- channels ---------- */
function pageDigest(html, base) {
  const links = [];
  const re = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < 200) {
    const text = stripHtml(m[2]).slice(0, 100);
    if (text.length < 4) continue;
    try {
      links.push(`${text} -> ${new URL(m[1], base).href}`);
    } catch {}
  }
  const body = html.replace(/<(nav|footer|header)[\s\S]*?<\/\1>/gi, ' ');
  return { text: stripHtml(body).slice(0, 24000), links: links.join('\n').slice(0, 12000) };
}

async function fromPage(src, state) {
  const html = await fetchPage(src.url);
  const { text, links } = pageDigest(html, src.url);
  if (text.length < 300) throw new Error(`page has little readable text (${text.length} chars); it may need JavaScript`);
  const h = hash(text);
  if (state.pages[src.id] === h) return { items: [], note: 'unchanged since last run' };
  if (!HAS_GEMINI) throw new Error('needs Gemini to read the page');
  const out = await gemini(`Today is ${today()}. Below is the text and link list of ${src.url} (${src.name}).
List every funding opportunity on it that is OPEN now or opening soon: grant calls, RFPs, challenges, prizes, tenders, accelerator/fund open calls, including always-open (rolling) application routes.
Skip closed calls, past winners, news, events and jobs. Use the link list to give each item its own absolute URL (else "${src.url}").
Return a JSON array (empty if none) of {"title","funder","url","deadline_text":"as written, or Rolling","amount":"as written or null","text":"2-4 sentences: what it funds, who can apply, where"}.
PAGE TEXT:
${text}
LINKS:
${links}`, { schema: RAW_SCHEMA });
  state.pages[src.id] = h;
  return { items: Array.isArray(out) ? out : [] };
}

async function fromSearch(src) {
  if (!HAS_GEMINI) throw new Error('needs Gemini');
  const out = await gemini(`Today is ${today()}. Use Google Search to find funding opportunities that are OPEN now (deadline after today, or rolling) for this brief:
${src.url}
Prefer official funder pages. Include calls announced recently. Return ONLY a JSON array (max 12) of
{"title","funder","url":"official call page","deadline_text":"as stated, or Rolling","amount":"as stated or null","text":"2-4 sentences incl. who can apply and where"}.`, { search: true });
  return { items: Array.isArray(out) ? out : [] };
}

async function fromFeed(src) {
  const items = parseFeed(await fetchPage(src.url)).slice(0, 30);
  const keep = items.filter((i) => !JUNK.test(i.title) && HEALTHY.test(`${i.title} ${i.text || ''}`));
  return { items: keep.map((i) => ({ title: i.title, url: i.url, funder: '', deadline_text: null, amount: null, text: (i.text || '').slice(0, 800) })), note: `${items.length} in feed, ${keep.length} look relevant` };
}

async function fromEu(src) {
  const form = new FormData();
  form.append('query', new Blob([JSON.stringify({ bool: { must: [{ terms: { type: ['1', '2', '8'] } }, { terms: { status: ['31094501', '31094502'] } }] } })], { type: 'application/json' }));
  form.append('languages', new Blob([JSON.stringify(['en'])], { type: 'application/json' }));
  form.append('sort', new Blob([JSON.stringify({ field: 'sortStatus', order: 'ASC' })], { type: 'application/json' }));
  const url = `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=${encodeURIComponent(src.url)}&pageSize=50&pageNumber=1`;
  const r = await http(url, { method: 'POST', body: form }, 40000);
  const j = await r.json();
  const one = (v) => (Array.isArray(v) ? v[0] : v) || '';
  return {
    items: (j.results || []).map((x) => {
      const md = x.metadata || {};
      const id = one(md.identifier) || one(md.callIdentifier);
      const deadline = one(md.deadlineDate);
      return {
        title: `${one(md.title) || x.summary || x.title || id}${id ? ` (${id})` : ''}`,
        funder: 'European Commission',
        url: id ? `https://ec.europa.eu/info/funding-tenders/opportunities/portal/screen/opportunities/topic-details/${id}` : x.url,
        deadline_text: deadline ? String(deadline).slice(0, 10) : null,
        amount: null,
        text: stripHtml(one(md.descriptionByte) || x.content || x.summary || '').slice(0, 1500),
      };
    }).filter((i) => i.title && i.url && (!i.deadline_text || i.deadline_text >= today()) && /health|medic|disease|clinic|epidemi|diagnos|pandemic|care/i.test(`${i.title} ${i.text}`)),
  };
}

/** Bing returns search results as RSS for free; news links carry the real URL in a url= parameter. */
function unwrapBing(u) {
  try {
    const x = new URL(u);
    const real = x.searchParams.get('url');
    return /bing\.com$/.test(x.hostname) && real ? real : u;
  } catch {
    return u;
  }
}
const SKIP_HOSTS = /(linkedin|facebook|twitter|x\.com|youtube|instagram|reddit|wikipedia|indeed|glassdoor)\./i;
function ddgParse(html) {
  const out = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html))) {
    const next = html.indexOf('class="result__a"', re.lastIndex);
    const snip = html.slice(re.lastIndex, next < 0 ? re.lastIndex + 3000 : next).match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    m[3] = snip ? snip[1] : '';
    let url = m[1].replace(/&amp;/g, '&');
    try {
      const u = new URL(url, 'https://duckduckgo.com');
      url = u.searchParams.get('uddg') || u.href;
    } catch {}
    if (/duckduckgo\.com\/y\.js|ad_provider/.test(url)) continue; // ads
    out.push({ title: stripHtml(m[2]), url, text: stripHtml(m[3] || '') });
  }
  return out;
}
async function fromWeb(src) {
  const queries = String(src.url).split(/\n|;/).map((q) => q.trim()).filter(Boolean);
  const seen = new Set();
  const items = [];
  const raw = { ddg: 0, bing: 0, news: 0 };
  for (const q of queries) {
    const enc = q.split(/\s+/).map(encodeURIComponent).join('+');
    const engines = [
      ['ddg', async () => ddgParse(await fetchPage(`https://html.duckduckgo.com/html/?q=${enc}`))],
      ['bing', async () => parseFeed(await fetchPage(`https://www.bing.com/search?format=rss&count=20&q=${enc}`))],
      ['news', async () => parseFeed(await fetchPage(`https://www.bing.com/news/search?format=rss&count=20&q=${enc}`))],
    ];
    const terms = [...words(q.replace(/\bOR\b/g, ' '))];
    const need = Math.min(2, terms.length);
    for (const [name, run] of engines) {
      let hits = [];
      try {
        hits = await run();
      } catch (e) {
        log('web search', name, 'failed:', e.message);
      }
      raw[name] += hits.length;
      for (const i of hits) {
        const url = unwrapBing(i.url);
        if (!url || seen.has(url) || SKIP_HOSTS.test(url)) continue;
        // keep hits that mention the query's key words and look like funding (search engines pad with junk)
        const hay = `${i.title} ${i.text || ''}`.toLowerCase();
        if (JUNK.test(i.title) || terms.filter((t) => hay.includes(t)).length < need || !/(grant|fund|call|proposal|rfp|tender|prize|challenge|award|apply|applications)/.test(hay)) continue;
        seen.add(url);
        items.push({ title: i.title, url, funder: '', deadline_text: null, amount: null, text: (i.text || '').slice(0, 600) });
      }
    }
  }
  const note = `search hits: DuckDuckGo ${raw.ddg}, Bing ${raw.bing}, Bing News ${raw.news}; ${items.length} look like funding calls`;
  if (!raw.ddg && !raw.bing && !raw.news) throw new Error(`web search returned nothing (${note})`);
  return { items: items.slice(0, 25), note };
}

const CHANNELS = { scout_page: fromPage, scout_search: fromSearch, scout_feed: fromFeed, scout_eu: fromEu, scout_web: fromWeb };

/* ---------- write-up in the team's sheet format ---------- */
async function resolveUrl(u) {
  if (!/vertexaisearch\.cloud\.google\.com|grounding-api-redirect/.test(u || '')) return u;
  try {
    const r = await fetch(u, { redirect: 'manual' });
    return r.headers.get('location') || u;
  } catch {
    return u;
  }
}

function teamExamples(existing, tracking) {
  const st = new Map(tracking.map((t) => [t.grant_id, t.status]));
  const rated = existing.filter((g) => g.fit && (g.curated || ['dropped', 'pursuing', 'submitted', 'won'].includes(st.get(g.id))));
  return rated.slice(0, 45).map((g) => {
    const s = st.get(g.id) || 'watching';
    return `- ${g.funder} | ${g.title} | sector: ${g.sector || '?'} | eligible as: ${g.eligible_as || '?'} | team fit: ${g.fit} | team status: ${s === 'dropped' ? 'dropped (not pursued)' : s}`;
  }).join('\n');
}

async function writeUp(batch, context, examples) {
  const items = batch.map((b, i) => ({ i, title: b.title, funder: b.funder, url: b.url, deadline_text: b.deadline_text, amount: b.amount, text: `${b.text || ''}\n${b.page || ''}`.slice(0, 5000) }));
  const out = await gemini(`You are the grants scout for Wadhwani AI Global (WAIG). Today is ${today()}.
ORGANISATION CONTEXT:
${context}

HOW THE TEAM RATES OPPORTUNITIES (their own pipeline sheet; learn their taste from it):
${examples || '(no examples yet)'}

For each item below, write it up the way the team's sheet does. Return a JSON array of objects:
- "i": item index
- "relevant": false if it is not an organisational funding opportunity WAIG could pursue (e.g. individual fellowships, scholarships, student/academic-only, jobs, events, news, already closed); else true
- "open": false if the deadline has passed
- "title", "funder": clean names
- "funding_range": as stated (e.g. "Up to $500K", "$50K–$1M") or null
- "amount_usd": upper amount in USD (rough conversion) or null
- "deadline": "YYYY-MM-DD" or null if rolling/unknown
- "deadline_text": e.g. "Deadline 18 Mar 2027", "Opens 17 Nov 2026; Deadline 18 Mar 2027", "Rolling"
- "sector": like the sheet, e.g. "Healthcare (Primary Care, AI Tools)", "Cross-cutting (Development Innovation)"
- "geography": as stated, e.g. "Sub-Saharan Africa", "Global (LMICs)", "India, Kenya"
- "countries": ISO3 codes, or ["GLOBAL"]
- "fit": one of ${FITS.map((f) => `"${f}"`).join(', ')} using the team's rating style
- "eligible_as": how WAIG could apply, e.g. "NPO or PLC", "Consortium partner (EU lead required)", "Technical partner (govt applies)"
- "description": 2-3 sentences: what it funds and why it matters for WAIG
- "requirements": key requirements / application notes (1-3 short lines)
- "strengths": up to 3 short reasons WAIG fits
- "weaknesses": up to 3 short gaps or risks
- "why": one sentence explaining the fit rating
- "themes": up to 4 short tags
Return the JSON array only.
ITEMS:
${JSON.stringify(items)}`, { schema: WRITEUP_SCHEMA });
  return Array.isArray(out) ? out : [];
}

/* ---------- main ---------- */
async function main() {
  const sources = (await loadSources('grants')).filter((s) => s.enabled && CHANNELS[s.type]);
  const state = readJson('scout-state.json', { pages: {} });
  const rejected = new Set(readJson('scout-rejected.json', { ids: [] }).ids);
  // candidates found earlier but not written up yet (Gemini failed or the per-run cap was reached)
  const pending = readJson('scout-pending.json', { items: [] }).items || [];
  let existing = [];
  let tracking = [];
  if (HAS_SB) {
    existing = (await sb.select('grants', 'select=id,title,funder,url,fit,sector,eligible_as,curated,source_id')) || [];
    tracking = (await sb.select('grant_tracking', 'select=grant_id,status')) || [];
  } else existing = readJson('grants.json', { grants: [] }).grants || [];

  // tidy: drop scout finds that duplicate something the team already added (and nobody has picked up)
  if (HAS_SB) {
    const team = existing.filter((g) => g.curated);
    const touched = new Set(tracking.map((t) => t.grant_id));
    for (const g of existing.filter((g) => String(g.source_id || '').startsWith('scout') && !g.curated && !touched.has(g.id))) {
      if (!isDuplicate(g, team)) continue;
      await sb.remove('grants', g.id);
      rejected.add(g.id);
      existing = existing.filter((x) => x.id !== g.id);
      log('removed duplicate of a team entry:', g.title);
    }
  }

  // 1. collect candidates (searches first: they find the most, then pages, feeds, EU)
  const order = { scout_search: 0, scout_page: 1, scout_eu: 2, scout_feed: 3, scout_web: 4 };
  let groundingOff = null;
  sources.sort((a, b) => order[a.type] - order[b.type]);
  const candidates = [];
  const known = [...existing];
  for (const c of pending) {
    if (rejected.has(c.id) || known.some((k) => k.id === c.id) || isDuplicate(c, known)) continue;
    known.push(c);
    candidates.push(c);
  }
  for (const src of sources) {
    if (['scout_search', 'scout_page'].includes(src.type) && !geminiAvailable()) {
      await reportSource(src, 'skipped', HAS_GEMINI ? 'Skipped: Gemini quota or time budget used up this run' : 'Skipped: no Gemini key', 0);
      continue;
    }
    if (src.type === 'scout_search' && groundingOff) {
      await reportSource(src, 'skipped', `Skipped: ${groundingOff}`, 0);
      continue;
    }
    try {
      const { items, note } = await CHANNELS[src.type](src, state);
      let fresh = 0;
      for (const it of items) {
        if (!it?.title || !it?.url) continue;
        const c = { ...it, title: String(it.title).trim(), funder: String(it.funder || '').trim(), source_id: src.id, source_name: src.name };
        c.id = `sc_${hash(`${c.funder}|${c.title}`.toLowerCase())}`;
        if (rejected.has(c.id) || known.some((k) => k.id === c.id) || isDuplicate(c, known)) continue;
        known.push(c);
        candidates.push(c);
        fresh++;
      }
      await reportSource(src, 'ok', `${note ? note + ' · ' : ''}${items.length} seen, ${fresh} new`, items.length);
      log(src.id, items.length, 'seen', fresh, 'new', note || '');
    } catch (e) {
      const noGrounding = src.type === 'scout_search' && /quota|400|billing|not supported|tool|no model available/i.test(e.message);
      if (noGrounding) groundingOff = 'Gemini Google Search needs billing enabled on the Gemini key (free tier has no search quota). The free "web search" sources cover this meanwhile.';
      const msg = noGrounding ? groundingOff : e.message;
      await reportSource(src, 'error', msg, 0);
      log(src.id, 'ERROR', msg);
    }
  }

  // 2. write up in the sheet format and rate fit
  const now = new Date().toISOString();
  const pick = candidates.slice(0, MAX_NEW);
  for (const c of pick) c.url = await resolveUrl(c.url);
  for (const c of pick.filter((c) => (c.text || '').length < 700).slice(0, 40)) {
    try {
      c.page = pageDigest(await fetchPage(c.url), c.url).text.slice(0, 5000);
    } catch {}
  }
  const added = [];
  const leftover = [];
  if (HAS_GEMINI && pick.length) {
    const context = await orgContext();
    const examples = teamExamples(existing, tracking);
    const done = new Set();
    const writeBatch = async (batch) => {
      try {
        return await writeUp(batch, context, examples);
      } catch (e) {
        log('write-up batch failed, retrying one by one:', e.message);
        const out = [];
        for (const one of batch) {
          if (!geminiAvailable()) break;
          try {
            const [r] = await writeUp([one], context, examples);
            if (r) out.push({ ...r, i: batch.indexOf(one) });
          } catch (e2) {
            log('write-up failed for', one.title, e2.message);
          }
        }
        return out;
      }
    };
    for (const batch of chunk(pick, 4)) {
      if (!geminiAvailable()) break;
      {
        for (const r of await writeBatch(batch)) {
          const b = batch[r.i];
          if (!b || done.has(b.id)) continue;
          done.add(b.id);
          if (r.relevant === false || r.open === false || (r.deadline && r.deadline < today())) {
            rejected.add(b.id);
            log(' -', r.relevant === false ? 'not relevant' : 'closed', '|', b.title);
            continue;
          }
          if (isDuplicate({ title: r.title || b.title, funder: r.funder || b.funder, url: b.url }, existing)) {
            rejected.add(b.id);
            log(' = already tracked |', r.title || b.title);
            continue;
          }
          const fit = FITS.find((f) => f.toLowerCase() === String(r.fit || '').toLowerCase()) || null;
          added.push({
            id: b.id, title: r.title || b.title, funder: r.funder || b.funder || '', summary: r.description || b.text || '',
            amount_text: r.funding_range || b.amount || null, amount_usd: typeof r.amount_usd === 'number' ? r.amount_usd : null,
            deadline: r.deadline || null, deadline_text: r.deadline_text || b.deadline_text || null, open_date: null,
            eligibility: r.eligible_as || null, eligible_as: r.eligible_as || null, requirements: r.requirements || null,
            sector: r.sector || null, geography: r.geography || null, countries: r.countries?.length ? r.countries : ['GLOBAL'], regions: [],
            themes: r.themes || [], url: b.url, source_id: b.source_id, source_name: b.source_name, fetched_at: now, curated: false,
            fit, score: fit ? FIT_SCORE[fit.toLowerCase()] : null, strengths: r.strengths || [], weaknesses: r.weaknesses || [], score_reason: r.why || null,
            updated_at: now,
          });
        }
      }
    }
    leftover.push(...candidates.filter((c) => !done.has(c.id)));
  } else leftover.push(...candidates);

  if (HAS_SB && added.length) await sb.upsert('grants', added);
  writeJson('scout-state.json', { ...state, last_run: now });
  writeJson('scout-rejected.json', { ids: Array.from(rejected).slice(-5000) });
  writeJson('scout-pending.json', { items: leftover.slice(0, 300).map(({ page, ...c }) => c) });
  const good = added.filter((a) => (a.score || 0) >= 55).length;
  const msg = `${added.length} new opportunities written up (${good} rated High/Medium) from ${candidates.length} candidates (${leftover.length} queued for the next run) · Gemini ${geminiStatus.ok}/${geminiStatus.calls} calls ok${geminiStatus.lastError ? ` (last error: ${geminiStatus.lastError})` : ''}`;
  recordRun('scout', true, msg);
  log(msg);
  for (const a of added) log(' +', a.fit, '|', a.funder, '|', a.title, '|', a.deadline_text);
}

main().catch((e) => {
  recordRun('scout', false, e.message);
  console.error(e);
  process.exit(1);
});
