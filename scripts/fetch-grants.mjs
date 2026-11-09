// Fetch open funding calls, extract structured fields and score suitability with Gemini.
import { HAS_GEMINI, HAS_SB, geminiAvailable, geminiStatus, chunk, gemini, getJson, getText, hash, http, loadSources, log, orgContext, parseFeed, readJson, recordRun, reportSource, sb, stripHtml, today, toIso, writeJson } from './lib.mjs';

const MAX_NEW = Number(process.env.MAX_NEW_GRANTS || 40);

function mdY(s) {
  // Grants.gov dates are MM/DD/YYYY
  const m = String(s || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : toIso(s)?.slice(0, 10) || null;
}

async function collect(src) {
  switch (src.type) {
    case 'grantsgov': {
      const r = await http('https://api.grants.gov/v1/api/search2', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ keyword: src.url, oppStatuses: 'forecasted|posted', rows: 60 }),
      });
      const j = await r.json();
      const hits = j?.data?.oppHits || [];
      return hits.map((h) => ({
        title: h.title, url: `https://www.grants.gov/search-results-detail/${h.id}`, funder: h.agency || h.agencyCode || 'US Government',
        deadline: mdY(h.closeDate), open_date: mdY(h.openDate), text: `${h.title}. Agency: ${h.agency}. Number: ${h.number}. Status: ${h.oppStatus}.`,
      }));
    }
    case 'rss': {
      const items = parseFeed(await getText(src.url));
      return items.map((i) => ({ title: i.title, url: i.url, open_date: i.date?.slice(0, 10) || null, text: i.text }));
    }
    case 'json':
    case 'html': {
      if (!HAS_GEMINI) throw new Error('needs Gemini to extract items');
      const raw = src.type === 'json' ? JSON.stringify(await getJson(src.url)).slice(0, 60000) : stripHtml(await getText(src.url)).slice(0, 60000);
      const out = await gemini(`From the content below, list every currently open funding opportunity, grant call or tender relevant to health or AI.
Return a JSON array of {"title","url","funder","deadline":"YYYY-MM-DD or null","text":"one-paragraph description"}. Use absolute URLs; if an item has no own URL use "${src.url}".
CONTENT (${src.url}):
${raw}`);
      return Array.isArray(out) ? out : [];
    }
    case 'gemini_search': {
      if (!HAS_GEMINI) throw new Error('needs Gemini');
      const out = await gemini(`Today is ${today()}. Search the web: ${src.url}
Only include calls whose deadline is after today, or rolling calls. Return ONLY a JSON array of
{"title","url":"official call page","funder","deadline":"YYYY-MM-DD or null","amount":"as stated or null","text":"2-3 sentence description incl. eligibility"}. Max 15 items.`, { search: true });
      return Array.isArray(out) ? out : [];
    }
    default:
      throw new Error(`unknown type ${src.type}`);
  }
}

async function pageText(url) {
  try {
    return stripHtml(await getText(url)).slice(0, 7000);
  } catch {
    return '';
  }
}

async function enrich(batch, context) {
  const items = batch.map((b, i) => ({ i, title: b.title, url: b.url, funder: b.funder || '', deadline_hint: b.deadline || null, text: `${b.text || ''}\n${b.page || ''}`.slice(0, 6000) }));
  const prompt = `You help Wadhwani AI Global (WAIG) triage funding calls. Today is ${today()}.
ORGANISATION CONTEXT:
${context}

For each item below return an object with:
- "i": the item index
- "relevant": true only if the call could fund health, public health, global health, health AI/digital health, or AI for development work that WAIG could plausibly apply to (as prime or sub-grantee)
- "title": clean title
- "funder": funding organisation
- "summary": 2 plain sentences: what it funds and for whom
- "amount_text": as stated (e.g. "Up to $500,000") or null
- "amount_usd": number in USD (convert roughly if another currency; null if unknown)
- "deadline": "YYYY-MM-DD" or null if rolling/unknown
- "eligibility": who can apply (1-3 short lines)
- "requirements": key requirements or deliverables (1-3 short lines)
- "countries": ISO 3166-1 alpha-3 codes of eligible/target countries; ["GLOBAL"] if open worldwide or not country-specific
- "themes": up to 4 short tags (e.g. "TB", "AI", "maternal health")
- "score": 0-100 suitability for WAIG given its context (fit of theme, geography, eligibility, size, WAIG strengths)
- "strengths": up to 3 short reasons WAIG fits
- "weaknesses": up to 3 short gaps or risks
- "score_reason": one sentence explaining the score
Return a JSON array only.
ITEMS:
${JSON.stringify(items)}`;
  const out = await gemini(prompt);
  return Array.isArray(out) ? out : [];
}

// Where a source's calls are usually eligible, used when Gemini can't read the call
function defaultCountries(sourceId = '') {
  if (/^(grantsgov|nih)/.test(sourceId)) return ['USA'];
  if (/^ukri/.test(sourceId)) return ['GBR'];
  return ['GLOBAL'];
}

function rawGrant(b, now) {
  return { id: b.id, title: b.title, funder: b.funder || '', summary: (b.text || '').slice(0, 400), amount_text: b.amount || null, amount_usd: null, deadline: b.deadline || null, open_date: b.open_date || null, eligibility: null, requirements: null, countries: defaultCountries(b.source_id), regions: [], themes: [], url: b.url, source_id: b.source_id, source_name: b.source_name, fetched_at: now, score: null, strengths: [], weaknesses: [], score_reason: null };
}

async function main() {
  const sources = (await loadSources('grants')).filter((s) => s.enabled && !String(s.type).startsWith('scout')); // scout_* sources run in scout-grants.mjs
  const prev = readJson('grants.json', { grants: [] }).grants || [];
  let existing = prev;
  if (HAS_SB) {
    try {
      existing = (await sb.select('grants', 'select=*')) || prev;
    } catch (e) {
      log('read grants from Supabase failed', e.message);
    }
  }
  // older unscored items were tagged GLOBAL; use the source's usual eligibility instead
  for (const g of existing) if (g.score == null && g.countries?.length === 1 && g.countries[0] === 'GLOBAL') g.countries = defaultCountries(g.source_id);
  const known = new Map(existing.map((g) => [g.id, g]));
  const rejected = new Set(readJson('grants-rejected.json', { ids: [] }).ids);
  const fresh = [];
  for (const src of sources) {
    try {
      const raw = await collect(src);
      const items = raw.filter((r) => r && r.title && r.url).map((r) => ({ ...r, id: hash(r.url + '|' + r.title.toLowerCase()), source_id: src.id, source_name: src.name }));
      const isNew = items.filter((r) => !known.has(r.id) && !rejected.has(r.id));
      fresh.push(...isNew);
      await reportSource(src, 'ok', `${items.length} items, ${isNew.length} new`, items.length);
      log(src.id, items.length, 'items', isNew.length, 'new');
    } catch (e) {
      await reportSource(src, e.skip ? 'skipped' : 'error', e.message, 0);
      log(src.id, e.skip ? 'SKIPPED' : 'ERROR', e.message);
    }
  }

  // de-duplicate across sources and drop calls already closed
  const bySrc = new Map();
  for (const f of fresh) bySrc.set(f.source_id, [...(bySrc.get(f.source_id) || []), f]);
  const mixed = [];
  for (let k = 0; mixed.length < fresh.length; k++) for (const list of bySrc.values()) if (list[k]) mixed.push(list[k]);
  const seen = new Set();
  const candidates = mixed.filter((g) => {
    const k = g.title.toLowerCase().replace(/\W+/g, ' ').trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return !g.deadline || g.deadline >= today();
  }).slice(0, MAX_NEW);
  if (HAS_GEMINI) {
    const unscored = existing.filter((g) => !g.curated && g.score == null && (!g.deadline || g.deadline >= today()) && !candidates.find((c) => c.id === g.id)).slice(0, 20);
    for (const g of unscored) candidates.push({ id: g.id, title: g.title, url: g.url, funder: g.funder, deadline: g.deadline, open_date: g.open_date, text: g.summary, source_id: g.source_id, source_name: g.source_name });
  }

  const now = new Date().toISOString();
  const added = [];
  if (HAS_GEMINI && candidates.length) {
    const context = await orgContext();
    for (const c of candidates.filter((c) => (c.text || '').length < 400).slice(0, 25)) c.page = await pageText(c.url);
    for (const batch of chunk(candidates, 6)) {
      if (!geminiAvailable()) {
        for (const b of batch) added.push(rawGrant(b, now));
        continue;
      }
      try {
        const res = await enrich(batch, context);
        for (const r of res) {
          const b = batch[r.i];
          if (!b) continue;
          if (r.relevant === false) {
            rejected.add(b.id);
            continue;
          }
          added.push({
            id: b.id, title: r.title || b.title, funder: r.funder || b.funder || '', summary: r.summary || '', amount_text: r.amount_text || b.amount || null,
            amount_usd: typeof r.amount_usd === 'number' ? r.amount_usd : null, deadline: r.deadline || b.deadline || null, open_date: b.open_date || null,
            eligibility: r.eligibility || null, requirements: r.requirements || null, countries: r.countries?.length ? r.countries : ['GLOBAL'], regions: [], themes: r.themes || [],
            url: b.url, source_id: b.source_id, source_name: b.source_name, fetched_at: now,
            score: typeof r.score === 'number' ? Math.round(r.score) : null, strengths: r.strengths || [], weaknesses: r.weaknesses || [], score_reason: r.score_reason || null,
          });
        }
      } catch (e) {
        log('enrich batch failed', e.message);
        for (const b of batch) added.push(rawGrant(b, now));
      }
    }
  } else {
    for (const b of candidates) added.push(rawGrant(b, now));
  }

  // keep calls whose deadline is unknown or within the last 60 days
  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const all = [...added, ...existing.filter((g) => !added.find((a) => a.id === g.id))].filter((g) => !g.deadline || g.deadline >= cutoff);

  writeJson('grants-rejected.json', { ids: Array.from(rejected).slice(-5000) });
  if (HAS_SB && added.length) await sb.upsert('grants', added);
  // Public file: listing fields only. Scores and fit notes stay in Supabase when it is connected.
  // Team-pipeline rows are private and never written to the public file.
  const pub = all.filter((g) => !g.curated).map((g) => (HAS_SB ? { ...g, score: null, strengths: [], weaknesses: [], score_reason: null, fit: null, eligible_as: null, notes: null } : g));
  writeJson('grants.json', { updated_at: now, grants: pub });
  const msg = `${added.length} new calls added (${candidates.length} candidates), ${all.length} tracked${HAS_GEMINI ? ` · Gemini ${geminiStatus.ok}/${geminiStatus.calls} calls ok${geminiStatus.lastError ? ` (last error: ${geminiStatus.lastError})` : ''}` : ' · no Gemini key: unscored'}`;
  recordRun('grants', true, msg);
  log(msg);
}

main().catch((e) => {
  recordRun('grants', false, e.message);
  console.error(e);
  process.exit(1);
});
