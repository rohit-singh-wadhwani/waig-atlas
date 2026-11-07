// Fetch public-health news, outbreak notices, research, social posts and tenders; summarise and tag with Gemini.
import { HAS_GEMINI, chunk, geminiAvailable, geminiStatus, sleep, gemini, getJson, getText, hash, loadSources, log, parseFeed, readJson, recordRun, reportSource, stripHtml, today, toIso, writeJson } from './lib.mjs';

const KEEP_DAYS = 120;
const MAX_ENRICH = Number(process.env.MAX_ENRICH_INSIGHTS || 90);

function donUrl(p) {
  if (/^https?:/.test(p)) return p;
  const slug = String(p).replace(/^\/+/, '').replace(/^emergencies\/disease-outbreak-news\/item\//, '');
  return slug ? `https://www.who.int/emergencies/disease-outbreak-news/item/${slug}` : 'https://www.who.int/emergencies/disease-outbreak-news';
}

async function collect(src) {
  const kind = src.kind || src.notes?.match(/kind:(\w+)/)?.[1] || 'news';
  switch (src.type) {
    case 'rss':
      return parseFeed(await getText(src.url)).map((i) => ({ ...i, kind }));
    case 'who_don': {
      const j = await getJson(src.url);
      return (j.value || []).map((d) => ({
        title: d.Title || d.OverrideTitle,
        url: donUrl(d.ItemDefaultUrl || d.UrlName || ''),
        date: toIso(d.PublicationDateAndTime || d.PublicationDate),
        text: stripHtml(d.Summary || d.Overview || d.Epidemiology || '').slice(0, 1500),
        kind: 'outbreak',
      }));
    }
    case 'pubmed': {
      const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';
      const s = await getJson(`${base}/esearch.fcgi?db=pubmed&retmode=json&sort=pub_date&retmax=25&term=${encodeURIComponent(src.url)}`);
      const ids = s?.esearchresult?.idlist || [];
      if (!ids.length) return [];
      await sleep(1500); // NCBI allows ~3 requests a second without a key
      let sum;
      try {
        sum = await getJson(`${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`);
      } catch {
        await sleep(5000);
        sum = await getJson(`${base}/esummary.fcgi?db=pubmed&retmode=json&id=${ids.join(',')}`);
      }
      return ids.map((id) => sum.result?.[id]).filter(Boolean).map((r) => ({
        title: r.title, url: `https://pubmed.ncbi.nlm.nih.gov/${r.uid}/`, date: toIso(r.sortpubdate || r.pubdate), text: `${r.fulljournalname || r.source}. ${(r.authors || []).slice(0, 3).map((a) => a.name).join(', ')}`, kind: 'research',
      }));
    }
    case 'worldbank': {
      const j = await getJson(src.url);
      const rows = j.procnotices || j.documents || j.rows || [];
      const list = Array.isArray(rows) ? rows : Object.values(rows);
      return list.filter((r) => r && typeof r === 'object').map((r) => ({
        title: r.bid_description || r.project_name || r.notice_title || 'World Bank procurement notice',
        url: r.url || (r.id ? `https://projects.worldbank.org/en/projects-operations/procurement-detail/${r.id}` : 'https://projects.worldbank.org/en/projects-operations/procurement'),
        date: toIso(r.noticedate || r.notice_date || r.submission_date),
        text: [r.notice_type, r.project_ctry_name, r.project_name, r.submission_deadline_date ? `Deadline ${r.submission_deadline_date}` : ''].filter(Boolean).join(' · '),
        country_name: r.project_ctry_name,
        kind: 'tender',
      }));
    }
    case 'json':
    case 'html': {
      if (!HAS_GEMINI) throw new Error('needs Gemini to extract items');
      const raw = src.type === 'json' ? JSON.stringify(await getJson(src.url)).slice(0, 60000) : stripHtml(await getText(src.url)).slice(0, 60000);
      const out = await gemini(`List the latest items (news, notices, tenders or publications) in this content. Return a JSON array of {"title","url":"absolute URL","date":"YYYY-MM-DD or null","text":"1-2 sentences"}.
CONTENT (${src.url}):
${raw}`);
      return (Array.isArray(out) ? out : []).map((o) => ({ ...o, date: toIso(o.date), kind }));
    }
    case 'gemini_search': {
      if (!HAS_GEMINI) throw new Error('needs Gemini');
      if (!process.env.GEMINI_SEARCH) throw Object.assign(new Error('Skipped: Gemini web search needs a paid (billing-enabled) key; set repo variable GEMINI_SEARCH=1 to turn on'), { skip: true });
      const out = await gemini(`Today is ${today()}. Search the web: ${src.url}
Return ONLY a JSON array (max 12) of {"title","url":"original source URL","date":"YYYY-MM-DD","text":"1-2 sentence summary"} from the last 14 days.`, { search: true });
      return (Array.isArray(out) ? out : []).map((o) => ({ ...o, date: toIso(o.date), kind }));
    }
    default:
      throw new Error(`unknown type ${src.type}`);
  }
}

async function enrich(batch) {
  const items = batch.map((b, i) => ({ i, title: b.title, text: (b.text || '').slice(0, 1200), source: b.source_name, kind_hint: b.kind }));
  const out = await gemini(`You curate a public-health intelligence feed for a team building AI for TB, malaria, dengue and other health programmes in Africa and Asia.
For each item return {"i", "relevant": true if useful to public-health programme or health-AI teams, "summary": 1-2 plain sentences (no hype), "kind": one of news|outbreak|research|social|tender|report, "countries": ISO3 codes mentioned or [] , "diseases": up to 3 disease names or []}.
Return a JSON array only.
ITEMS: ${JSON.stringify(items)}`);
  return Array.isArray(out) ? out : [];
}

async function main() {
  const sources = (await loadSources('insights')).filter((s) => s.enabled);
  const prev = readJson('insights.json', { insights: [] }).insights || [];
  const known = new Set(prev.map((p) => p.id));
  const rejected = new Set(readJson('insights-rejected.json', { ids: [] }).ids);
  const fresh = [];
  for (const src of sources) {
    try {
      const raw = await collect(src);
      const items = raw
        .filter((r) => r && r.title && r.url)
        .map((r) => ({ ...r, id: hash(r.url), source_id: src.id, source_name: src.name, date: r.date || new Date().toISOString() }))
        .filter((r) => Date.now() - +new Date(r.date) < KEEP_DAYS * 86400000);
      const isNew = items.filter((r) => !known.has(r.id) && !rejected.has(r.id));
      fresh.push(...isNew);
      await reportSource(src, 'ok', `${items.length} recent items, ${isNew.length} new`, items.length);
      log(src.id, items.length, isNew.length);
    } catch (e) {
      await reportSource(src, e.skip ? 'skipped' : 'error', e.message, 0);
      log(src.id, e.skip ? 'SKIPPED' : 'ERROR', e.message);
    }
  }

  const uniq = [];
  const seen = new Set();
  for (const f of fresh.sort((a, b) => b.date.localeCompare(a.date))) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    uniq.push(f);
  }

  const added = [];
  const toEnrich = HAS_GEMINI ? uniq.slice(0, MAX_ENRICH) : [];
  for (const batch of chunk(toEnrich, 15)) {
    if (!geminiAvailable()) {
      for (const b of batch) added.push({ id: b.id, title: b.title, summary: (b.text || '').slice(0, 300), url: b.url, published_at: b.date, source_id: b.source_id, source_name: b.source_name, kind: b.kind, countries: [], diseases: [] });
      continue;
    }
    try {
      const res = await enrich(batch);
      for (const r of res) {
        const b = batch[r.i];
        if (!b) continue;
        if (r.relevant === false) {
          rejected.add(b.id);
          continue;
        }
        added.push({ id: b.id, title: b.title, summary: r.summary || '', url: b.url, published_at: b.date, source_id: b.source_id, source_name: b.source_name, kind: r.kind || b.kind, countries: r.countries || [], diseases: r.diseases || [] });
      }
    } catch (e) {
      log('enrich failed', e.message);
      for (const b of batch) added.push({ id: b.id, title: b.title, summary: (b.text || '').slice(0, 300), url: b.url, published_at: b.date, source_id: b.source_id, source_name: b.source_name, kind: b.kind, countries: [], diseases: [] });
    }
  }
  for (const b of HAS_GEMINI ? uniq.slice(MAX_ENRICH, 200) : uniq.slice(0, 200)) added.push({ id: b.id, title: b.title, summary: (b.text || '').slice(0, 300), url: b.url, published_at: b.date, source_id: b.source_id, source_name: b.source_name, kind: b.kind, countries: [], diseases: [] });

  const cutoff = Date.now() - KEEP_DAYS * 86400000;
  const all = [...added, ...prev].filter((i) => +new Date(i.published_at) >= cutoff).sort((a, b) => b.published_at.localeCompare(a.published_at)).slice(0, 2000);
  writeJson('insights.json', { updated_at: new Date().toISOString(), insights: all });
  writeJson('insights-rejected.json', { ids: Array.from(rejected).slice(-8000) });
  const msg = `${added.length} new insights (${uniq.length} candidates), ${all.length} kept${HAS_GEMINI ? ` · Gemini ${geminiStatus.ok}/${geminiStatus.calls} calls ok${geminiStatus.lastError ? ` (last error: ${geminiStatus.lastError})` : ''}` : ''}`;
  recordRun('insights', true, msg);
  log(msg);
}

main().catch((e) => {
  recordRun('insights', false, e.message);
  console.error(e);
  process.exit(1);
});
