// Shared helpers for the scheduled jobs. Node 20+, no dependencies.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const DATA = path.join(ROOT, 'public', 'data');
fs.mkdirSync(DATA, { recursive: true });

const { GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
export const HAS_GEMINI = !!GEMINI_API_KEY;
export const HAS_SB = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const hash = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 16);
export const today = () => new Date().toISOString().slice(0, 10);

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, file), 'utf8'));
  } catch {
    return fallback;
  }
}
export function writeJson(file, data) {
  fs.writeFileSync(path.join(DATA, file), JSON.stringify(data, null, file.endsWith('.geojson') ? 0 : 1));
}

export function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

/* ---------------- HTTP ---------------- */

const UA = 'WAIG-Atlas/0.1 (+https://github.com/rohit-singh-wadhwani/waig-atlas)';
export async function http(url, opts = {}, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, accept: '*/*', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText} for ${url.slice(0, 120)}`);
    return r;
  } finally {
    clearTimeout(t);
  }
}
export const getText = async (url, opts) => (await http(url, opts)).text();
export const getJson = async (url, opts) => (await http(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } })).json();

export function stripHtml(s = '') {
  return String(s)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, '–')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Minimal RSS 2.0 / Atom parser. */
export function parseFeed(xml) {
  const items = [];
  const tag = (block, name) => {
    const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
    return m ? stripHtml(m[1]) : '';
  };
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  for (const b of blocks) {
    items.push({ title: tag(b, 'title'), url: tag(b, 'link') || (b.match(/<guid[^>]*>([^<]+)<\/guid>/i) || [])[1] || '', date: tag(b, 'pubDate') || tag(b, 'dc:date'), text: tag(b, 'description') || tag(b, 'content:encoded') });
  }
  const entries = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of entries) {
    const href = (b.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i) || b.match(/<link[^>]*href="([^"]+)"/i) || [])[1] || '';
    items.push({ title: tag(b, 'title'), url: href, date: tag(b, 'published') || tag(b, 'updated'), text: tag(b, 'summary') || tag(b, 'content') || tag(b, 'media:description') });
  }
  return items
    .filter((i) => i.title && i.url)
    .map((i) => ({ ...i, date: toIso(i.date), text: i.text.slice(0, 1500) }));
}

export function toIso(d) {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(+t) ? null : t.toISOString();
}

/* ---------------- Gemini ---------------- */

const STARTED = Date.now();
const BUDGET_MS = Number(process.env.GEMINI_BUDGET_MIN || 14) * 60000; // stop calling Gemini after this, keep raw items
let lastCall = 0;
let spacing = 6500; // ms between calls; grows when per-minute limits bite
const deadModels = new Set(); // model or model:search that is missing / out of daily quota
export const geminiStatus = { calls: 0, ok: 0, lastError: null, models: [] };
let models = null;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Pick flash models this key can actually call, newest first, lite variants last. */
async function discoverModels() {
  if (models) return models;
  if (process.env.GEMINI_MODEL) return (models = process.env.GEMINI_MODEL.split(',').map((x) => x.trim()));
  const fallback = ['gemini-flash-lite-latest', 'gemini-flash-latest', 'gemini-2.5-flash-lite'];
  try {
    const r = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': GEMINI_API_KEY } });
    const j = await r.json();
    const names = (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /flash/.test(n) && !/image|tts|audio|live|thinking|exp|embedding|8b/.test(n));
    const ver = (n) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || (/latest/.test(n) ? 99 : 0));
    const ranked = names.sort((a, b) => Number(!/lite/.test(a)) - Number(!/lite/.test(b)) || Number(/preview/.test(a)) - Number(/preview/.test(b)) || ver(b) - ver(a));
    models = ranked.length ? ranked.slice(0, 5) : fallback;
  } catch (e) {
    models = fallback;
  }
  geminiStatus.models = models;
  log('Gemini models:', models.join(', '));
  return models;
}

function quotaInfo(j) {
  const raw = JSON.stringify(j || {});
  const delay = Number(((raw.match(/"retryDelay":"(\d+(?:\.\d+)?)s"/) || [])[1]) || 0);
  const daily = /PerDay|per day|"limit":\s*0|limit: 0/i.test(raw) && !/PerMinute/.test(raw);
  return { msg: (j?.error?.message || '').slice(0, 160), delay, daily };
}

export function geminiAvailable() {
  if (!HAS_GEMINI || Date.now() - STARTED > BUDGET_MS) return false;
  return !models || !models.every((m) => deadModels.has(m));
}

export async function gemini(prompt, { json = true, search = false, temperature = 0.2, schema = null } = {}) {
  if (!HAS_GEMINI) throw new Error('GEMINI_API_KEY not set');
  if (Date.now() - STARTED > BUDGET_MS) throw new Error('Gemini time budget for this run used up');
  const list = await discoverModels();
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature, ...(json && !search ? { responseMimeType: 'application/json', ...(schema ? { responseSchema: schema } : {}) } : {}) },
    ...(search ? { tools: [{ google_search: {} }] } : {}),
  };
  let firstErr = null;
  const note = (e) => {
    firstErr = firstErr || e;
    geminiStatus.lastError = e.message;
  };
  for (const model of list) {
    const key = model + (search ? ':search' : '');
    if (deadModels.has(model) || deadModels.has(key)) continue;
    for (let attempt = 0; attempt < 3; attempt++) {
      const wait = spacing - (Date.now() - lastCall);
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      geminiStatus.calls++;
      let r;
      try {
        r = await fetch(`${BASE}/models/${model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
          body: JSON.stringify(body),
        });
      } catch (e) {
        note(new Error(`Gemini network error: ${e.message}`));
        continue;
      }
      const j = await r.json().catch(() => ({}));
      if (r.status === 404) {
        deadModels.add(model);
        note(new Error(`Gemini model ${model} not available`));
        break;
      }
      if (r.status === 429) {
        const q = quotaInfo(j);
        note(new Error(`Gemini ${model}${search ? ' (search)' : ''} quota: ${q.msg}`));
        if (search && /plan and billing/i.test(q.msg)) {
          for (const m of list) deadModels.add(m + ':search'); // no search quota on this key at all
          break;
        }
        if (q.daily || attempt === 2) {
          deadModels.add(key);
          break;
        }
        spacing = Math.min(Math.round(spacing * 1.5), 20000);
        await sleep(Math.min(60000, Math.max(10000, (q.delay || 15) * 1000)));
        continue;
      }
      if (r.status >= 500) {
        note(new Error(`Gemini ${model} ${r.status}`));
        await sleep(8000);
        continue;
      }
      if (!r.ok) {
        const e = new Error(`Gemini ${model} ${r.status}: ${(j?.error?.message || '').slice(0, 200)}`);
        note(e);
        if (r.status === 401 || r.status === 403) throw e; // bad key
        if (search && r.status === 400) deadModels.add(key); // search tool not allowed on this model
        break;
      }
      const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      geminiStatus.ok++;
      if (!json) return text;
      return parseJsonLoose(text);
    }
  }
  throw firstErr || new Error('Gemini failed: no model available');
}

export function parseJsonLoose(text) {
  const t = String(text || '').trim();
  try {
    return JSON.parse(t);
  } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const start = Math.min(...['[', '{'].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c))));
  const end = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
  if (isFinite(start) && end > start) {
    const body = t.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch (e) {
      // common model slips: trailing commas, smart quotes, raw newlines inside strings
      const fixed = body.replace(/,\s*([}\]])/g, '$1').replace(/[\u201c\u201d]/g, '"').replace(/"([^"\\]*?)\n([^"\\]*?)"/g, '"$1 $2"');
      try {
        return JSON.parse(fixed);
      } catch {
        throw e;
      }
    }
  }
  throw new Error('Could not parse JSON from Gemini');
}

/* ---------------- Supabase (service role) ---------------- */

async function sbFetch(pathq, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${pathq}`, {
    ...opts,
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}
export const sb = {
  select: (table, q = 'select=*') => sbFetch(`${table}?${q}`),
  upsert: async (table, rows) => {
    for (let i = 0; i < rows.length; i += 200)
      await sbFetch(table, { method: 'POST', headers: { prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 200)) });
  },
  remove: (table, id) => sbFetch(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'DELETE', headers: { prefer: 'return=minimal' } }),
  patch: (table, id, row) => sbFetch(`${table}?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { prefer: 'return=minimal' }, body: JSON.stringify(row) }),
};

/* ---------------- Sources & run log ---------------- */

const SOURCE_COLS = ['id', 'name', 'category', 'type', 'url', 'enabled', 'notes', 'kind', 'unit', 'display_name'];
const normSource = (s) => Object.fromEntries(SOURCE_COLS.map((k) => [k, s[k] ?? (k === 'enabled' ? true : null)]));

export async function loadSources(category) {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'sources.json'), 'utf8')).map(normSource);
  let all = config;
  if (HAS_SB) {
    try {
      const rows = await sb.select('sources');
      if (rows?.length) {
        // add any new sources from config that the table doesn't have yet
        const ids = new Set(rows.map((r) => r.id));
        const missing = config.filter((c) => !ids.has(c.id));
        if (missing.length) await sb.upsert('sources', missing);
        all = [...rows, ...missing];
      } else {
        await sb.upsert('sources', config);
      }
    } catch (e) {
      log('sources table unavailable, using config:', e.message);
    }
  }
  return all.filter((s) => s.category === category);
}

export async function reportSource(s, status, message, count) {
  const row = { last_run: new Date().toISOString(), last_status: status, last_message: String(message || '').slice(0, 300), item_count: count ?? null };
  Object.assign(s, row);
  if (HAS_SB) {
    try {
      await sb.patch('sources', s.id, row);
    } catch (e) {
      log('could not save source status', e.message);
    }
  }
  // public mirror of the latest status (config + status; no private data)
  const pub = readJson('sources.json', []);
  const i = pub.findIndex((p) => p.id === s.id);
  const merged = { ...normSource(s), ...row };
  if (i >= 0) pub[i] = merged;
  else pub.push(merged);
  writeJson('sources.json', pub);
}

export function recordRun(job, ok, message) {
  const r = readJson('runs.json', { runs: [] });
  r.runs.unshift({ job, at: new Date().toISOString(), ok, message: String(message).slice(0, 300) });
  r.runs = r.runs.slice(0, 60);
  writeJson('runs.json', r);
}

export async function orgContext() {
  if (HAS_SB) {
    try {
      const rows = await sb.select('org_context', 'select=content_md&id=eq.main');
      if (rows?.[0]?.content_md) return rows[0].content_md;
    } catch {}
  }
  try {
    return fs.readFileSync(path.join(ROOT, 'config', 'org-context.md'), 'utf8');
  } catch {
    return 'Wadhwani AI Global builds AI for public health in low- and middle-income countries.';
  }
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
