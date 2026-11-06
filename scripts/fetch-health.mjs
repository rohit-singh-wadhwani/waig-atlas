// Fetch open epidemiological datasets into public/data/health.json, and country boundaries into world.geojson.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DATA, getJson, getText, http, loadSources, log, readJson, recordRun, reportSource, writeJson } from './lib.mjs';

const NE_URLS = [
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
];

const round = (c) => (Array.isArray(c[0]) ? c.map(round) : [Math.round(c[0] * 1000) / 1000, Math.round(c[1] * 1000) / 1000]);

async function world() {
  const out = path.join(DATA, 'world.geojson');
  if (fs.existsSync(out) && Date.now() - fs.statSync(out).mtimeMs < 30 * 86400000) return;
  for (const u of NE_URLS) {
    try {
      const g = JSON.parse(await getText(u));
      const features = g.features.map((f) => {
        const p = f.properties;
        const iso3 = p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3;
        return { type: 'Feature', geometry: { type: f.geometry.type, coordinates: round(f.geometry.coordinates) }, properties: { iso3, name: p.NAME || p.ADMIN, region: p.CONTINENT, subregion: p.SUBREGION, lng: p.LABEL_X, lat: p.LABEL_Y } };
      });
      writeJson('world.geojson', { type: 'FeatureCollection', features });
      log('world.geojson', features.length, 'countries');
      return;
    } catch (e) {
      log('world fetch failed', u, e.message);
    }
  }
}

const GHO = 'https://ghoapi.azureedge.net/api';

async function gho(src) {
  const code = src.url.trim();
  let name = src.name;
  let unit = src.unit || '';
  try {
    const meta = await getJson(`${GHO}/Indicator?$filter=IndicatorCode eq '${code}'`);
    const n = meta?.value?.[0]?.IndicatorName;
    if (n && !src.name_override) name = n;
  } catch {}
  if (!unit) unit = (name.match(/\(([^)]+)\)\s*$/) || [])[1] || 'value';
  const j = await getJson(`${GHO}/${code}?$filter=SpatialDimType eq 'COUNTRY'`);
  const values = {};
  for (const r of j.value || []) {
    if (r.NumericValue === null || r.NumericValue === undefined) continue;
    if (r.Dim1 && !/BTSX|BOTHSEXES|^SEX_BTSX$/i.test(r.Dim1)) continue; // both sexes only when split by sex
    if (r.Dim2 || r.Dim3) continue;
    const iso = r.SpatialDim;
    const y = String(r.TimeDim);
    values[iso] = values[iso] || {};
    if (values[iso][y] === undefined) values[iso][y] = Number(r.NumericValue);
  }
  return { name, unit, values, source_name: 'WHO Global Health Observatory', source_url: `https://www.who.int/data/gho/data/indicators/indicator-details/GHO/${code}` };
}

async function openDengue(src) {
  const list = await getJson('https://api.github.com/repos/OpenDengue/master-repo/contents/data/releases');
  const dirs = list.filter((d) => d.type === 'dir').map((d) => d.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = dirs[dirs.length - 1];
  const files = await getJson(`https://api.github.com/repos/OpenDengue/master-repo/contents/data/releases/${latest}`);
  const f = files.find((x) => /national/i.test(x.name) && /\.(zip|csv)$/i.test(x.name));
  if (!f) throw new Error(`no national extract in ${latest}`);
  const buf = Buffer.from(await (await http(f.download_url, {}, 120000)).arrayBuffer());
  let csv;
  if (/\.zip$/i.test(f.name)) {
    const tmp = path.join(os.tmpdir(), 'od.zip');
    fs.writeFileSync(tmp, buf);
    csv = execFileSync('unzip', ['-p', tmp], { maxBuffer: 1 << 30 }).toString('utf8');
  } else csv = buf.toString('utf8');
  const lines = csv.split(/\r?\n/);
  const head = lines[0].split(',').map((h) => h.replace(/"/g, '').trim());
  const ix = (n) => head.findIndex((h) => h.toLowerCase() === n.toLowerCase());
  const iIso = ix('ISO_A0'), iStart = ix('calendar_start_date'), iTot = ix('dengue_total'), iRes = ix('T_res');
  if (iIso < 0 || iStart < 0 || iTot < 0) throw new Error('unexpected OpenDengue columns: ' + head.slice(0, 12).join(','));
  const acc = {}; // iso -> year -> {Year, Month, Week}
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const c = line.split(',').map((x) => x.replace(/"/g, ''));
    const iso = c[iIso];
    const y = (c[iStart] || '').slice(0, 4);
    const v = Number(c[iTot]);
    if (!iso || !/^\d{4}$/.test(y) || !isFinite(v)) continue;
    const res = (iRes >= 0 ? c[iRes] : 'Year') || 'Year';
    acc[iso] = acc[iso] || {};
    acc[iso][y] = acc[iso][y] || { Year: 0, Month: 0, Week: 0 };
    const key = /year/i.test(res) ? 'Year' : /month/i.test(res) ? 'Month' : 'Week';
    acc[iso][y][key] += v;
  }
  const values = {};
  for (const [iso, ys] of Object.entries(acc)) for (const [y, r] of Object.entries(ys)) {
    const v = r.Year || r.Month || r.Week;
    if (v > 0) (values[iso] = values[iso] || {})[y] = v;
  }
  return { name: `Dengue cases reported (OpenDengue ${latest})`, unit: 'cases', values, source_name: 'OpenDengue', source_url: 'https://opendengue.org' };
}

async function main() {
  await world();
  const sources = (await loadSources('datasets')).filter((s) => s.enabled);
  const prev = readJson('health.json', { indicators: [] });
  const indicators = [];
  for (const src of sources) {
    try {
      const r = src.type === 'gho' ? await gho(src) : src.type === 'opendengue' ? await openDengue(src) : null;
      if (!r) throw new Error(`unknown dataset type ${src.type}`);
      const years = Array.from(new Set(Object.values(r.values).flatMap((v) => Object.keys(v)))).map(Number).filter((y) => y >= 2000).sort((a, b) => a - b);
      for (const iso of Object.keys(r.values)) for (const y of Object.keys(r.values[iso])) if (Number(y) < 2000) delete r.values[iso][y];
      indicators.push({ key: src.id, name: src.display_name || r.name, unit: src.unit || r.unit, source_name: r.source_name, source_url: r.source_url, years, values: r.values });
      await reportSource(src, 'ok', `${Object.keys(r.values).length} countries, ${years[0]}–${years[years.length - 1]}`, Object.keys(r.values).length);
    } catch (e) {
      const old = prev.indicators.find((i) => i.key === src.id);
      if (old) indicators.push(old);
      await reportSource(src, 'error', e.message + (old ? ' (kept previous data)' : ''), old ? Object.keys(old.values).length : 0);
      log(src.id, 'ERROR', e.message);
    }
  }
  writeJson('health.json', { updated_at: new Date().toISOString(), indicators });
  recordRun('health', true, `${indicators.length} indicators`);
}

main().catch((e) => {
  recordRun('health', false, e.message);
  console.error(e);
  process.exit(1);
});
