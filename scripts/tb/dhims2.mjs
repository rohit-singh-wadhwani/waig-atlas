// DHIMS2 (Ghana Health Service DHIS2) sync: monthly TB numbers per district into Supabase tb_notifications.
// Runs only when the DHIMS2 secrets are set; otherwise it records "not connected" and exits cleanly.
//   DHIMS2_URL       e.g. https://dhims.chimgh.org/dhims   (base URL of the DHIS2 instance)
//   DHIMS2_USERNAME / DHIMS2_PASSWORD   or   DHIMS2_TOKEN (personal access token)
//   DHIMS2_DX        optional: pin the data items, e.g. "abc123:notified,def456:bact_confirmed,ghi789:presumptive"
// Only aggregate district counts are read. No patient-level data.
import fs from 'node:fs';
import path from 'node:path';
import { DATA, HAS_SB, log, sb } from '../lib.mjs';

const OUT = path.join(DATA, 'tb', 'dhims2.json');
const { DHIMS2_URL, DHIMS2_USERNAME, DHIMS2_PASSWORD, DHIMS2_TOKEN, DHIMS2_DX } = process.env;
const status = (o) => fs.writeFileSync(OUT, JSON.stringify({ checked_at: new Date().toISOString(), ...o }, null, 1));

// What we look for when DHIMS2_DX is not pinned. First matching data element or indicator wins.
const WANT = [
  { key: 'notified', re: /(new\s*(and|&)\s*relapse|all\s*forms|tb\s*cases?\s*notified|notified)/i },
  { key: 'bact_confirmed', re: /bacteriolog\w*\s*confirmed/i },
  { key: 'presumptive', re: /presumptive/i },
  { key: 'tested', re: /(tested|genexpert|xpert)/i },
];

const norm = (s) => String(s || '').toLowerCase().replace(/\b(municipal|metropolitan|metro|district|assembly|municipality)\b/g, '').replace(/[^a-z]/g, '');

async function api(p) {
  const headers = { accept: 'application/json' };
  if (DHIMS2_TOKEN) headers.authorization = `ApiToken ${DHIMS2_TOKEN}`;
  else headers.authorization = 'Basic ' + Buffer.from(`${DHIMS2_USERNAME}:${DHIMS2_PASSWORD}`).toString('base64');
  const r = await fetch(`${DHIMS2_URL.replace(/\/$/, '')}/api/${p}`, { headers });
  if (!r.ok) throw new Error(`${p.split('?')[0]}: HTTP ${r.status}`);
  return r.json();
}

async function pickItems() {
  if (DHIMS2_DX) return DHIMS2_DX.split(',').map((x) => { const [id, key] = x.split(':'); return { id: id.trim(), key: (key || 'notified').trim(), name: id.trim() }; });
  const [de, ind] = await Promise.all([
    api('dataElements.json?filter=name:ilike:tb&fields=id,name&paging=false').catch(() => ({ dataElements: [] })),
    api('indicators.json?filter=name:ilike:tb&fields=id,name&paging=false').catch(() => ({ indicators: [] })),
  ]);
  const all = [...(de.dataElements || []), ...(ind.indicators || [])].filter((x) => /\btb\b|tubercul/i.test(x.name));
  const out = [];
  for (const w of WANT) {
    const hit = all.find((x) => w.re.test(x.name) && !out.some((o) => o.id === x.id));
    if (hit) out.push({ id: hit.id, key: w.key, name: hit.name });
  }
  return out;
}

async function main() {
  if (!DHIMS2_URL || !(DHIMS2_TOKEN || (DHIMS2_USERNAME && DHIMS2_PASSWORD))) {
    status({ connected: false, message: 'Not connected: DHIMS2 credentials are not set.' });
    log('DHIMS2 not configured; skipping');
    return;
  }
  if (!HAS_SB) throw new Error('needs SUPABASE_SERVICE_ROLE_KEY');
  try {
    const items = await pickItems();
    if (!items.some((i) => i.key === 'notified')) throw new Error('no TB notification data item found; set DHIMS2_DX');
    const geo = JSON.parse(fs.readFileSync(path.join(DATA, 'tb', 'districts.geojson'), 'utf8')).features.map((f) => f.properties);
    const byName = new Map(geo.map((d) => [norm(d.name), d]));
    const ous = (await api('organisationUnits.json?level=3&fields=id,name&paging=false')).organisationUnits || [];
    const ouMap = new Map();
    for (const o of ous) {
      const d = byName.get(norm(o.name));
      if (d) ouMap.set(o.id, d);
    }
    const dx = items.map((i) => i.id).join(';');
    const res = await api(`analytics.json?dimension=dx:${dx}&dimension=pe:LAST_12_MONTHS&dimension=ou:LEVEL-3&skipMeta=true`);
    const H = Object.fromEntries((res.headers || []).map((h, i) => [h.name, i]));
    const keyOf = Object.fromEntries(items.map((i) => [i.id, i.key]));
    const rows = new Map();
    for (const r of res.rows || []) {
      const d = ouMap.get(r[H.ou]);
      if (!d) continue;
      const pe = r[H.pe];
      const period = /^\d{6}$/.test(pe) ? `${pe.slice(0, 4)}-${pe.slice(4)}` : pe;
      const id = `${d.id}|${period}`;
      const row = rows.get(id) || { id, district_id: d.id, district_name: d.name, period, source: 'DHIMS2', uploaded_by: 'dhims2-sync' };
      row[keyOf[r[H.dx]]] = Math.round(Number(r[H.value]));
      rows.set(id, row);
    }
    const list = [...rows.values()].map(({ presumptive, tested, ...r }) => r); // table keeps notified and bact_confirmed
    for (let i = 0; i < list.length; i += 200) await sb.upsert('tb_notifications', list.slice(i, i + 200));
    const months = [...new Set(list.map((r) => r.period))].sort();
    status({ connected: true, message: `Synced ${list.length} district-months`, items: items.map(({ key, name }) => ({ key, name })), districts_matched: ouMap.size, districts_total: geo.length, unmatched: ous.filter((o) => !ouMap.has(o.id)).map((o) => o.name).slice(0, 40), months: months.length ? [months[0], months[months.length - 1]] : [] });
    log('DHIMS2 synced', list.length, 'rows,', ouMap.size, 'districts matched');
  } catch (e) {
    status({ connected: false, configured: true, message: `DHIMS2 sync failed: ${e.message}` });
    log('DHIMS2 failed', e.message);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
