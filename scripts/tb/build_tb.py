"""
TB surveillance data pipeline (Ghana).

Everything here is fetched from open sources on each run; model parameters, cities and playbooks
are read from Supabase (edited in the app). Outputs:
  public/data/tb/districts.geojson   district features + modelled burden (open data only)
  public/data/tb/cities.geojson      H3 hexagons for each city in tb_cities
  public/data/tb/facilities.geojson  OSM health facilities
  public/data/tb/sites.geojson       OSM congregate sites (markets, transport hubs, prisons, mines)
  public/data/tb/national.json       WHO estimates and notifications for Ghana
  public/data/tb/meta.json           sources, run status, parameter snapshot
  Supabase tb_estimates               private estimates using uploaded notifications + campaign results
"""
import csv, io, json, math, os, re, sys, time, traceback
from datetime import datetime, timezone

import numpy as np
import requests
import rasterio
from rasterio.features import rasterize
from rasterio.io import MemoryFile
from rasterio.windows import from_bounds
from scipy.spatial import cKDTree
from shapely.geometry import shape, mapping, Point
from shapely.strtree import STRtree
import h3

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'public', 'data', 'tb')
os.makedirs(OUT, exist_ok=True)
SB_URL = os.environ.get('SUPABASE_URL') or os.environ.get('REACT_APP_SUPABASE_URL') or 'https://sfjcioilzidqskzmqpog.supabase.co'
SB_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
S = requests.Session()
S.headers['user-agent'] = 'atlas-data-pipeline/1.0'
NOW = datetime.now(timezone.utc).isoformat()
SOURCES = []  # run log shown on the Data tab


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def source(name, url, ok, note=''):
    SOURCES.append({'name': name, 'url': url, 'ok': ok, 'note': note, 'at': NOW})
    log('SOURCE', name, 'OK' if ok else 'FAILED', note)


def get(url, **kw):
    for attempt in range(3):
        try:
            r = S.get(url, timeout=kw.pop('timeout', 180), **kw)
            r.raise_for_status()
            return r
        except Exception as e:
            if attempt == 2:
                raise
            log('retry', url[:90], e)
            time.sleep(5 * (attempt + 1))


# ---------------- Supabase ----------------
def sb(path, method='GET', body=None, prefer=None):
    if not SB_KEY:
        raise RuntimeError('SUPABASE_SERVICE_ROLE_KEY not set')
    h = {'apikey': SB_KEY, 'authorization': f'Bearer {SB_KEY}', 'content-type': 'application/json'}
    if prefer:
        h['prefer'] = prefer
    r = S.request(method, f'{SB_URL}/rest/v1/{path}', headers=h, data=json.dumps(body) if body is not None else None, timeout=60)
    if r.status_code >= 300:
        raise RuntimeError(f'Supabase {method} {path}: {r.status_code} {r.text[:200]}')
    return r.json() if r.text and method == 'GET' else None


# ---------------- helpers ----------------
def norm_region(s):
    s = re.sub(r'^\.+', '', s or '').lower()
    s = re.sub(r'\((pre|post) 20\d\d\)', '', s)
    s = s.replace('region', '').replace('-', ' ')
    return re.sub(r'\s+', ' ', s).strip()


def km_xy(lon, lat, lat0):
    return np.c_[np.asarray(lon) * 111.32 * math.cos(math.radians(lat0)), np.asarray(lat) * 110.57]


def haversine(lat1, lon1, lat2, lon2):
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 12742 * math.asin(math.sqrt(a))


def r2(x, n=2):
    return None if x is None or (isinstance(x, float) and not math.isfinite(x)) else round(float(x), n)


# ---------------- sources ----------------
def boundaries():
    out = {}
    for lvl in ['ADM1', 'ADM2']:
        meta = get(f'https://www.geoboundaries.org/api/current/gbOpen/GHA/{lvl}/').json()
        gj = get(meta['simplifiedGeometryGeoJSON']).json()
        out[lvl] = gj
        source(f'geoBoundaries Ghana {lvl} ({meta.get("boundaryYearRepresented")}, {meta.get("admUnitCount")} units)', meta['simplifiedGeometryGeoJSON'], True, meta.get('boundarySource', ''))
    return out['ADM1'], out['ADM2']


def worldpop():
    j = get('https://www.worldpop.org/rest/data/pop/cic2020_UNadj_100m?iso3=GHA').json()
    url = j['data'][-1]['files'][0]
    path = '/tmp/gha_pop.tif'
    if not os.path.exists(path):
        with S.get(url, stream=True, timeout=600) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    source('WorldPop constrained population 2020 (100 m, UN-adjusted)', url, True)
    return path


def map_travel_time():
    caps = get('https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCapabilities').text
    ids = re.findall(r'<wcs:CoverageId>([^<]+)</wcs:CoverageId>', caps)
    pick = [i for i in ids if 'Motorized' in i and 'Healthcare' in i and 'Travel_Time' in i] or [i for i in ids if 'Healthcare' in i]
    if not pick:
        raise RuntimeError('no healthcare travel-time coverage found')
    cov = sorted(pick)[-1]
    url = (f'https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId={cov}'
           f'&subset=Lat(4.4,11.3)&subset=Long(-3.4,1.3)&format=image/tiff')
    path = '/tmp/gha_travel.tif'
    for attempt in range(3):
        with S.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        try:
            ds = rasterio.open(path)
            ds.read(1)  # make sure the whole file is readable
            source(f'Malaria Atlas Project: motorised travel time to healthcare ({cov})', url.split('&subset')[0], True)
            return ds
        except Exception as e:
            log('travel-time raster unreadable, retrying', e)
            time.sleep(10)
    raise RuntimeError('travel-time raster download was incomplete three times')


MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
           'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']


def overpass(q, label):
    for attempt in range(2):
        for url in MIRRORS:
            try:
                r = S.post(url, data={'data': q}, timeout=300)
                r.raise_for_status()
                els = r.json()['elements']
                source(f'OpenStreetMap: {label} ({len(els)})', url, True)
                return els
            except Exception as e:
                log('overpass failed', url, str(e)[:120])
        time.sleep(30)
    return None  # caller falls back to the last good pull


def osm_points():
    area = 'area["ISO3166-1"="GH"][admin_level=2]->.a;'
    fac = overpass(f'[out:json][timeout:240];{area}(nwr["amenity"~"^(hospital|clinic|doctors|health_post)$"](area.a);nwr["healthcare"~"^(hospital|clinic|centre|laboratory|doctor)$"](area.a););out center tags;', 'health facilities')
    sites = overpass(f'[out:json][timeout:240];{area}(nwr["amenity"="marketplace"](area.a);nwr["amenity"="bus_station"](area.a);nwr["amenity"="prison"](area.a);nwr["landuse"="quarry"](area.a);nwr["industrial"="mine"](area.a);nwr["man_made"="mineshaft"](area.a););out center tags;', 'congregate sites')
    previous = lambda f: json.load(open(os.path.join(OUT, f)))['features'] if os.path.exists(os.path.join(OUT, f)) else []
    if fac is None:
        old = previous('facilities.geojson')
        source('OpenStreetMap: health facilities', MIRRORS[0], bool(old), f'Overpass unavailable; reused last good pull ({len(old)} facilities)' if old else 'Overpass unavailable and no earlier pull')
        fac = [{'lon': f['geometry']['coordinates'][0], 'lat': f['geometry']['coordinates'][1], 'tags': {'amenity': f['properties']['kind'], 'name': f['properties']['name'], **({'healthcare': 'laboratory'} if f['properties'].get('lab') else {})}} for f in old]
    if sites is None:
        old = previous('sites.geojson')
        rev = {'market': ('amenity', 'marketplace'), 'transport hub': ('amenity', 'bus_station'), 'prison': ('amenity', 'prison'), 'mine / quarry': ('landuse', 'quarry')}
        source('OpenStreetMap: congregate sites', MIRRORS[0], bool(old), f'Overpass unavailable; reused last good pull ({len(old)} sites)' if old else 'Overpass unavailable and no earlier pull')
        sites = [{'lon': f['geometry']['coordinates'][0], 'lat': f['geometry']['coordinates'][1], 'tags': {rev[f['properties']['kind']][0]: rev[f['properties']['kind']][1], 'name': f['properties']['name']}} for f in old]

    def pt(e):
        if 'lat' in e:
            return e['lon'], e['lat']
        c = e.get('center')
        return (c['lon'], c['lat']) if c else None

    facilities, seen = [], set()
    for e in fac:
        p = pt(e)
        if not p:
            continue
        t = e.get('tags', {})
        kind = t.get('amenity') or t.get('healthcare') or 'facility'
        if kind == 'centre':
            kind = 'clinic'
        key = (round(p[0], 4), round(p[1], 4))
        if key in seen:
            continue
        seen.add(key)
        facilities.append({'lon': p[0], 'lat': p[1], 'kind': kind, 'name': t.get('name') or '', 'lab': t.get('healthcare') == 'laboratory' or 'laboratory' in (t.get('healthcare:speciality') or '')})
    out_sites = []
    for e in sites:
        p = pt(e)
        if not p:
            continue
        t = e.get('tags', {})
        if t.get('amenity') == 'marketplace':
            kind = 'market'
        elif t.get('amenity') == 'bus_station':
            kind = 'transport hub'
        elif t.get('amenity') == 'prison':
            kind = 'prison'
        else:
            kind = 'mine / quarry'
        out_sites.append({'lon': p[0], 'lat': p[1], 'kind': kind, 'name': t.get('name') or ''})
    return facilities, out_sites


def rwi_points():
    j = get('https://data.humdata.org/api/3/action/package_show?id=relative-wealth-index').json()
    res = [r for r in j['result']['resources'] if re.search(r'gha|ghana', (r['name'] + r['url']).lower())]
    url = res[0]['url']
    rows = list(csv.DictReader(io.StringIO(get(url).text)))
    pts = np.array([[float(r['longitude']), float(r['latitude']), float(r['rwi'])] for r in rows])
    source(f'Meta Relative Wealth Index, Ghana ({len(pts)} tiles)', url, True)
    return pts


def dhs_regional():
    """Regional risk-factor prevalence. Returns {norm_region: {...}} using post-2022 regions; 2014 values mapped via the 2022 region hierarchy."""
    base = 'https://api.dhsprogram.com/rest/dhs/data?countryIds=GH&breakdown=subnational&f=json&perpage=1000'

    def fetch(survey, ind):
        return get(f'{base}&surveyIds={survey}&indicatorIds={ind}').json().get('Data', [])

    out, parent_of = {}, {}
    for ind, key in [('AN_NUTS_W_THN', 'thin_w'), ('AN_NUTS_M_THN', 'thin_m'), ('AH_TOBC_W_ANY', 'smoke_w'), ('AH_TOBC_M_ANY', 'smoke_m')]:
        parent = None
        for d in fetch('GH2022DHS', ind):
            lab = d['CharacteristicLabel']
            if not lab.startswith('..'):
                parent = norm_region(lab)
            else:
                parent_of[norm_region(lab)] = parent
            out.setdefault(norm_region(lab), {})[key] = d['Value']
    hiv = {norm_region(d['CharacteristicLabel']): d['Value'] for d in fetch('GH2014DHS', 'HA_HIVP_B_HIV')}
    for reg, v in out.items():
        v['hiv'] = hiv.get(reg, hiv.get(parent_of.get(reg, ''), None))
        v['thin'] = np.nanmean([x for x in [v.get('thin_w'), v.get('thin_m')] if x is not None]) if (v.get('thin_w') or v.get('thin_m')) else None
        v['smoke'] = np.nanmean([x for x in [v.get('smoke_w'), v.get('smoke_m')] if x is not None]) if (v.get('smoke_w') is not None or v.get('smoke_m') is not None) else None
    source('DHS Program API: Ghana DHS 2022 (thinness, smoking) and 2014 (HIV), by region', 'https://api.dhsprogram.com', True, f'{len(out)} regions')
    return out


def who_tb():
    def table(ds):
        txt = get(f'https://extranet.who.int/tme/generateCSV.asp?ds={ds}', timeout=300).text
        return [r for r in csv.DictReader(io.StringIO(txt)) if r.get('iso3') == 'GHA']

    est = sorted(table('estimates'), key=lambda r: int(r['year']))
    notif = {r['year']: r for r in table('notifications')}
    years = []
    for r in est:
        n = notif.get(r['year'], {})
        f = lambda k, src=r: float(src[k]) if src.get(k) not in (None, '', 'NA') else None
        years.append({'year': int(r['year']), 'pop': f('e_pop_num'), 'inc_100k': f('e_inc_100k'), 'inc_100k_lo': f('e_inc_100k_lo'), 'inc_100k_hi': f('e_inc_100k_hi'),
                      'inc_num': f('e_inc_num'), 'tbhiv_pct': f('e_tbhiv_prct'), 'notified': f('c_newinc', n) if n else None})
    latest = [y for y in years if y['inc_num'] and y['notified']][-1]
    latest['cdr'] = latest['notified'] / latest['inc_num']
    source(f'WHO Global TB Programme: Ghana estimates and notifications (latest {latest["year"]})', 'https://www.who.int/teams/global-programme-on-tuberculosis-and-lung-health/data', True)
    return years, latest


# ---------------- main build ----------------
def main():
    params = {p['id']: float(p['value']) for p in sb('tb_parameters?select=id,value')}
    cities = sb('tb_cities?select=*&enabled=eq.true')
    P = lambda k: params[k]
    log('parameters', len(params), 'cities', [c['id'] for c in cities])

    adm1, adm2 = boundaries()
    years, nat = who_tb()
    dhs = dhs_regional()
    facilities, sites = osm_points()
    rwi = rwi_points()
    try:
        tt = map_travel_time()
    except Exception as e:
        tt = None
        source('Malaria Atlas Project: travel time to healthcare', 'https://data.malariaatlas.org', False, f'{e}; using straight-line distance to the nearest OSM facility')

    # districts + regions
    regions = [(shape(f['geometry']), f['properties']['shapeName']) for f in adm1['features']]
    dists = []
    for i, f in enumerate(adm2['features']):
        g = shape(f['geometry'])
        c = g.representative_point()
        reg = next((n for rg, n in regions if rg.contains(c)), None)
        if reg is None:
            reg = min(regions, key=lambda x: x[0].distance(c))[1]
        dists.append({'i': i, 'id': f['properties']['shapeID'], 'name': f['properties']['shapeName'], 'region': reg, 'geom': g, 'lon': c.x, 'lat': c.y})

    # population on the 100 m grid; district sums
    with rasterio.open(worldpop()) as src:
        pop = src.read(1, masked=True).filled(0).astype('float32')
        pop[pop < 0] = 0
        transform, crs = src.transform, src.crs
    labels = rasterize([(d['geom'], d['i'] + 1) for d in dists], out_shape=pop.shape, transform=transform, dtype='int16')
    scale = (nat['pop'] or pop.sum()) / pop.sum()  # bring 2020 grid to WHO's latest population
    pop *= scale
    dsum = np.bincount(labels.ravel(), weights=pop.ravel(), minlength=len(dists) + 1)
    log('population total', int(pop.sum()), 'scale', round(scale, 3))

    # 1 km cells (10x10 blocks) for access and wealth
    H, W = (pop.shape[0] // 10) * 10, (pop.shape[1] // 10) * 10
    p1 = pop[:H, :W].reshape(H // 10, 10, W // 10, 10).sum(axis=(1, 3))
    lab1 = labels[5:H:10, 5:W:10][: p1.shape[0], : p1.shape[1]]
    rr, cc = np.nonzero(p1 > 0)
    xs, ys = rasterio.transform.xy(transform, rr * 10 + 5, cc * 10 + 5)
    clon, clat, cpop, clab = np.array(xs), np.array(ys), p1[rr, cc], lab1[rr, cc]
    lat0 = 7.9

    # travel time (minutes) per 1 km cell
    fac_xy = km_xy([f['lon'] for f in facilities], [f['lat'] for f in facilities], lat0) if facilities else None
    cell_xy = km_xy(clon, clat, lat0)
    fac_km = cKDTree(fac_xy).query(cell_xy)[0] if facilities else np.full(len(clon), np.nan)
    if tt is not None:
        band = tt.read(1).astype('float32')
        if not np.isfinite(band).any():
            raise RuntimeError('travel-time raster empty')
        rows, cols = rasterio.transform.rowcol(tt.transform, clon, clat)
        rows, cols = np.clip(rows, 0, band.shape[0] - 1), np.clip(cols, 0, band.shape[1] - 1)
        minutes = band[rows, cols]
        minutes[(minutes < 0) | ~np.isfinite(minutes)] = np.nan
        access_basis = 'MAP motorised travel time to healthcare'
    else:
        minutes = fac_km / 30 * 60  # 30 km/h straight-line proxy
        access_basis = 'straight-line distance to nearest OSM facility at 30 km/h'
    minutes = np.where(np.isnan(minutes), np.nanmedian(minutes), minutes)
    A = 0.5 ** (minutes / P('access_halflife_min'))

    # wealth per 1 km cell from the nearest RWI tile
    rwi_xy = km_xy(rwi[:, 0], rwi[:, 1], lat0)
    rwi_cell = rwi[cKDTree(rwi_xy).query(cell_xy)[1], 2]

    n = len(dists) + 1
    wsum = lambda v: np.bincount(clab, weights=cpop * v, minlength=n)
    cp = np.bincount(clab, weights=cpop, minlength=n)
    safe = np.where(cp > 0, cp, 1)
    d_minutes, d_far, d_A, d_rwi = wsum(minutes) / safe, wsum((minutes > 60).astype(float)) / safe, wsum(A) / safe, wsum(rwi_cell) / safe

    # facilities + sites per district
    tree = STRtree([d['geom'] for d in dists])

    def which(lon, lat):
        p = Point(lon, lat)
        for k in tree.query(p):
            if dists[k]['geom'].contains(p):
                return k
        return None

    for d in dists:
        d.update(facilities=0, hospitals=0, labs=0, markets=0, hubs=0, prisons=0, mines=0)
    for f in facilities:
        k = which(f['lon'], f['lat'])
        f['district'] = dists[k]['name'] if k is not None else None
        if k is None:
            continue
        dists[k]['facilities'] += 1
        dists[k]['hospitals'] += f['kind'] == 'hospital'
        dists[k]['labs'] += bool(f['lab'])
    kindkey = {'market': 'markets', 'transport hub': 'hubs', 'prison': 'prisons', 'mine / quarry': 'mines'}
    for s in sites:
        k = which(s['lon'], s['lat'])
        s['district'] = dists[k]['name'] if k is not None else None
        if k is not None:
            dists[k][kindkey[s['kind']]] += 1

    # model
    total_area = sum(d['geom'].area for d in dists)
    for d in dists:
        i = d['i'] + 1
        d['pop'] = float(dsum[i])
        # area in km2 from degrees (approximate at district latitude)
        d['area_km2'] = d['geom'].area * 111.32 * 110.57 * math.cos(math.radians(d['lat']))
        d['density'] = d['pop'] / max(d['area_km2'], 1)
        d['minutes'], d['pct_far'], d['A'], d['rwi'] = float(d_minutes[i]), float(d_far[i]), float(d_A[i]), float(d_rwi[i])
        rf = dhs.get(norm_region(d['region']), {})
        d['hiv'], d['thin'], d['smoke'] = rf.get('hiv'), rf.get('thin'), rf.get('smoke')
    ref_density = sum(d['pop'] for d in dists) / sum(d['area_km2'] for d in dists)

    def m_spatial(density, rwi_v):
        return math.exp(P('beta_density') * math.log2(max(density, 1) / ref_density)) * math.exp(-P('beta_poverty') * rwi_v)

    for d in dists:
        risk = 1 + (d['hiv'] or 0) / 100 * (P('rr_hiv') - 1) + (d['thin'] or 0) / 100 * (P('rr_undernutrition') - 1) + (d['smoke'] or 0) / 100 * (P('rr_smoking') - 1)
        d['m_risk'], d['m_density'], d['m_poverty'] = risk, math.exp(P('beta_density') * math.log2(max(d['density'], 1) / ref_density)), math.exp(-P('beta_poverty') * d['rwi'])
        d['M'] = risk * d['m_density'] * d['m_poverty']
    totpop = sum(d['pop'] for d in dists)
    meanM = sum(d['pop'] * d['M'] for d in dists) / totpop
    for d in dists:
        d['expected'] = nat['inc_num'] * d['pop'] * d['M'] / meanM / totpop
    k = nat['notified'] / sum(d['expected'] * d['A'] for d in dists)
    for d in dists:
        d['cdr'] = min(0.95, k * d['A'])
        d['notified_model'] = d['expected'] * d['cdr']
        d['hidden'] = d['expected'] - d['notified_model']
        d['hidden_100k'] = d['hidden'] / max(d['pop'], 1) * 1e5
        d['prev_adult'] = P('prev_general_ghana') * d['M'] / meanM  # per 100k adults

    fpc = np.array([d['facilities'] / max(d['pop'], 1) * 1e4 for d in dists])
    f90 = np.percentile(fpc, 90) or 1

    def scores(nodata_flags):
        wa, wf, wn = P('w_blind_access'), P('w_blind_facilities'), P('w_blind_nodata')
        blind = [(wa * d['pct_far'] + wf * (1 - min(1, fpc[j] / f90)) + wn * nodata_flags[j]) / (wa + wf + wn) * 100 for j, d in enumerate(dists)]
        hid = np.log1p([max(d['hidden'], 0) for d in dists])
        rate = np.array([max(d['hidden_100k'], 0) for d in dists])
        mm = lambda a: (a - a.min()) / (a.max() - a.min() or 1)
        wh, wr, wb = P('w_priority_hidden'), P('w_priority_rate'), P('w_priority_blind')
        pri = (wh * mm(np.array(hid)) + wr * mm(rate) + wb * np.array(blind) / 100) / (wh + wr + wb) * 100
        return blind, pri

    blind, pri = scores([1] * len(dists))
    order = np.argsort(-pri)
    for rank, j in enumerate(order):
        dists[j]['rank'] = rank + 1
    for j, d in enumerate(dists):
        d['blind'], d['priority'] = blind[j], float(pri[j])

    # modelled mobility (gravity) between district centroids
    for d in dists:
        w = []
        for e in dists:
            if e is d:
                continue
            dist = max(haversine(d['lat'], d['lon'], e['lat'], e['lon']), 5)
            w.append((e['pop'] / dist ** P('gravity_gamma'), e))
        tot = sum(x for x, _ in w) or 1
        d['flows'] = [{'id': e['id'], 'name': e['name'], 'share': r2(x / tot, 3), 'lon': r2(e['lon'], 4), 'lat': r2(e['lat'], 4)} for x, e in sorted(w, key=lambda t: -t[0])[:5]]

    # ---------------- write public district file ----------------
    def light(g):
        # simplify (~200 m) and round to 4 decimals (~11 m) so the map file stays small
        gj = mapping(g.simplify(0.002, preserve_topology=True))
        rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
        return {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}

    feats = []
    for d in dists:
        feats.append({'type': 'Feature', 'geometry': light(d['geom']), 'properties': {
            'id': d['id'], 'name': d['name'], 'region': d['region'], 'pop': round(d['pop']), 'area_km2': r2(d['area_km2'], 0), 'density': r2(d['density'], 0),
            'rwi': r2(d['rwi'], 3), 'minutes': r2(d['minutes'], 0), 'pct_far': r2(d['pct_far'], 3), 'facilities': d['facilities'], 'hospitals': d['hospitals'], 'labs': d['labs'],
            'markets': d['markets'], 'hubs': d['hubs'], 'prisons': d['prisons'], 'mines': d['mines'], 'hiv': r2(d['hiv'], 1), 'thin': r2(d['thin'], 1), 'smoke': r2(d['smoke'], 1),
            'm_risk': r2(d['m_risk'], 3), 'm_density': r2(d['m_density'], 3), 'm_poverty': r2(d['m_poverty'], 3), 'expected': r2(d['expected'], 1), 'cdr': r2(d['cdr'], 3),
            'hidden': r2(d['hidden'], 1), 'hidden_100k': r2(d['hidden_100k'], 1), 'prev_adult': r2(d['prev_adult'], 0), 'blind': r2(d['blind'], 1), 'priority': r2(d['priority'], 1),
            'rank': d['rank'], 'flows': d['flows'], 'lon': r2(d['lon'], 4), 'lat': r2(d['lat'], 4)}})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'districts.geojson'), 'w'), separators=(',', ':'))

    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [r2(f['lon'], 5), r2(f['lat'], 5)]},
               'properties': {'kind': f['kind'], 'name': f['name'], 'lab': f['lab'], 'district': f.get('district')}} for f in facilities]},
              open(os.path.join(OUT, 'facilities.geojson'), 'w'), separators=(',', ':'))
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [r2(s['lon'], 5), r2(s['lat'], 5)]},
               'properties': {'kind': s['kind'], 'name': s['name'], 'district': s.get('district')}} for s in sites]},
              open(os.path.join(OUT, 'sites.geojson'), 'w'), separators=(',', ':'))

    # ---------------- city hexagons ----------------
    hex_feats = []
    site_xy = km_xy([s['lon'] for s in sites], [s['lat'] for s in sites], lat0) if sites else None
    site_tree = cKDTree(site_xy) if sites else None
    fac_tree = cKDTree(fac_xy) if facilities else None
    hosp = [f for f in facilities if f['kind'] == 'hospital']
    hosp_tree = cKDTree(km_xy([f['lon'] for f in hosp], [f['lat'] for f in hosp], lat0)) if hosp else None
    rwi_tree = cKDTree(rwi_xy)
    for city in cities:
        lat_c, lon_c, rad, res = float(city['lat']), float(city['lon']), float(city['radius_km']), int(city['h3_res'])
        dlat, dlon = rad / 110.57, rad / (111.32 * math.cos(math.radians(lat_c)))
        win = from_bounds(lon_c - dlon, lat_c - dlat, lon_c + dlon, lat_c + dlat, transform)
        r0, c0 = max(int(win.row_off), 0), max(int(win.col_off), 0)
        r1, c1 = min(int(win.row_off + win.height) + 1, pop.shape[0]), min(int(win.col_off + win.width) + 1, pop.shape[1])
        sub, sublab = pop[r0:r1, c0:c1], labels[r0:r1, c0:c1]
        rr2, cc2 = np.nonzero(sub > 0)
        x2, y2 = rasterio.transform.xy(transform, rr2 + r0, cc2 + c0)
        x2, y2 = np.array(x2), np.array(y2)
        inside = np.hypot((x2 - lon_c) * 111.32 * math.cos(math.radians(lat_c)), (y2 - lat_c) * 110.57) <= rad
        agg = {}
        for x, y, pv, lb in zip(x2[inside], y2[inside], sub[rr2, cc2][inside], sublab[rr2, cc2][inside]):
            cell = h3.latlng_to_cell(float(y), float(x), res)
            a = agg.setdefault(cell, [0.0, {}])
            a[0] += float(pv)
            a[1][int(lb)] = a[1].get(int(lb), 0) + float(pv)
        cells = list(agg)
        if not cells:
            continue
        centers = np.array([h3.cell_to_latlng(c) for c in cells])  # (lat, lon)
        cxy = km_xy(centers[:, 1], centers[:, 0], lat0)
        hex_area = h3.average_hexagon_area(res, unit='km^2')
        rwi_h = rwi[rwi_tree.query(cxy)[1], 2]
        fac_d = fac_tree.query(cxy)[0] if fac_tree is not None else np.full(len(cells), np.nan)
        hosp_d = hosp_tree.query(cxy)[0] if hosp_tree is not None else np.full(len(cells), np.nan)
        near_sites = [site_tree.query_ball_point(p, 1.0) for p in cxy] if site_tree is not None else [[] for _ in cells]
        if tt is not None:
            rows, cols = rasterio.transform.rowcol(tt.transform, centers[:, 1], centers[:, 0])
            band = tt.read(1)
            mins = band[np.clip(rows, 0, band.shape[0] - 1), np.clip(cols, 0, band.shape[1] - 1)].astype(float)
            mins[mins < 0] = np.nan
        else:
            mins = fac_d / 30 * 60
        rows_out = []
        for j, cell in enumerate(cells):
            pv, labs_ = agg[cell]
            dl = max(labs_, key=labs_.get) - 1
            if dl < 0:
                continue
            d = dists[dl]
            dens = pv / hex_area
            n_sites = min(len(near_sites[j]), 3)
            m_h = m_spatial(dens, rwi_h[j]) * (P('congregate_rr') ** n_sites)
            m_d = d['m_density'] * d['m_poverty']
            exp_h = d['expected'] / max(d['pop'], 1) * pv * (m_h / m_d)
            a_h = 0.5 ** ((mins[j] if np.isfinite(mins[j]) else d['minutes']) / P('access_halflife_min'))
            hid_h = exp_h * (1 - min(0.95, k * a_h))
            kinds = sorted({sites[s]['kind'] for s in near_sites[j]}) if near_sites[j] else []
            rows_out.append([cell, pv, dens, rwi_h[j], fac_d[j], hosp_d[j], mins[j], kinds, exp_h, hid_h, d['name']])
        hid_vals = np.array([r[9] / max(r[1], 1) * 1e5 for r in rows_out])
        ranks = hid_vals.argsort().argsort() / max(len(hid_vals) - 1, 1) * 100
        for r, pct in zip(rows_out, ranks):
            ring = [[r2(lng, 5), r2(lat, 5)] for lat, lng in h3.cell_to_boundary(r[0])]
            ring.append(ring[0])
            hex_feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]}, 'properties': {
                'h3': r[0], 'city': city['id'], 'district': r[10], 'pop': round(r[1]), 'density': r2(r[2], 0), 'rwi': r2(r[3], 3), 'facility_km': r2(r[4], 2),
                'hospital_km': r2(r[5], 2), 'minutes': r2(r[6], 0), 'sites': r[7], 'expected': r2(r[8], 2), 'hidden': r2(r[9], 2),
                'hidden_100k': r2(r[9] / max(r[1], 1) * 1e5, 1), 'score': r2(pct, 1)}})
        log('city', city['id'], len(rows_out), 'hexagons')
    json.dump({'type': 'FeatureCollection', 'features': hex_feats}, open(os.path.join(OUT, 'cities.geojson'), 'w'), separators=(',', ':'))

    json.dump({'years': years, 'latest': nat}, open(os.path.join(OUT, 'national.json'), 'w'), indent=1)

    # ---------------- private estimates (uploaded notifications + campaign results) ----------------
    private_note = ''
    try:
        notif = sb('tb_notifications?select=district_id,period,notified')
        camps = {c['id']: c for c in sb('tb_campaigns?select=id,district_id,setting')}
        res = sb('tb_campaign_results?select=campaign_id,screened,confirmed')
        by_d = {}
        for row in notif:
            m = re.match(r'(\d{4})', str(row['period']))
            if not m or row.get('notified') is None:
                continue
            by_d.setdefault(row['district_id'], {}).setdefault(int(m.group(1)), []).append((row['period'], row['notified']))
        annual = {}
        for did, yrs in by_d.items():
            y = max(yrs)
            vals = yrs[y]
            months = [p for p, _ in vals if re.match(r'^\d{4}-\d{2}$', str(p))]
            quarters = [p for p, _ in vals if re.match(r'^\d{4}-?Q[1-4]$', str(p), re.I)]
            tot = sum(v for _, v in vals)
            annual[did] = tot * 12 / len(months) if months and len(months) == len(vals) else tot * 4 / len(quarters) if quarters and len(quarters) == len(vals) else tot
        camp_sum = {}
        for r in res:
            c = camps.get(r['campaign_id'])
            if not c or not c.get('district_id') or c.get('setting') not in ('community', 'outreach', None):
                continue
            s = camp_sum.setdefault(c['district_id'], [0, 0])
            s[0] += r.get('screened') or 0
            s[1] += r.get('confirmed') or 0
        nodata = [0 if (d['id'] in annual or d['id'] in camp_sum) else 1 for d in dists]
        blind_p, _ = scores(nodata)
        rows = []
        for j, d in enumerate(dists):
            calib = 1.0
            drivers = {'risk_factors': r2(d['m_risk'], 3), 'crowding': r2(d['m_density'], 3), 'poverty': r2(d['m_poverty'], 3), 'access': r2(d['A'] / (sum(x['A'] * x['pop'] for x in dists) / totpop), 3)}
            if d['id'] in camp_sum:
                scr, conf = camp_sum[d['id']]
                pred = scr * d['prev_adult'] / 1e5 * P('cxr_cad_sensitivity')
                calib = (conf + P('calibration_prior_cases')) / (pred + P('calibration_prior_cases'))
                drivers['campaign'] = {'screened': scr, 'confirmed': conf, 'predicted': r2(pred, 1)}
            exp_c = d['expected'] * calib
            obs = annual.get(d['id'])
            notified = obs if obs is not None else d['notified_model']
            hidden = max(exp_c - notified, 0)
            rows.append({'district_id': d['id'], 'district_name': d['name'], 'region': d['region'], 'expected': r2(exp_c, 1), 'notified': r2(notified, 1) if obs is not None else None,
                         'gap': r2(exp_c - obs, 1) if obs is not None else None, 'hidden': r2(hidden, 1), 'calibration': r2(calib, 3), 'blind_spot': r2(blind_p[j], 1),
                         'priority': None, 'rank': None, 'drivers': drivers, 'updated_at': NOW})
        hid = np.log1p([r['hidden'] for r in rows])
        rate = np.array([r['hidden'] / max(dists[j]['pop'], 1) * 1e5 for j, r in enumerate(rows)])
        mm = lambda a: (a - a.min()) / (a.max() - a.min() or 1)
        wh, wr, wb = P('w_priority_hidden'), P('w_priority_rate'), P('w_priority_blind')
        pri_p = (wh * mm(np.array(hid)) + wr * mm(rate) + wb * np.array(blind_p) / 100) / (wh + wr + wb) * 100
        for rank, j in enumerate(np.argsort(-pri_p)):
            rows[j]['priority'], rows[j]['rank'] = r2(pri_p[j], 1), rank + 1
        for i in range(0, len(rows), 100):
            sb('tb_estimates', 'POST', rows[i:i + 100], prefer='resolution=merge-duplicates,return=minimal')
        private_note = f'{len(annual)} districts with uploaded notifications, {len(camp_sum)} with campaign results'
        log('private estimates written', private_note)
    except Exception as e:
        private_note = f'failed: {e}'
        log('private estimates failed', e)

    json.dump({'updated_at': NOW, 'sources': SOURCES, 'access_basis': access_basis, 'private': private_note,
               'national': {'year': nat['year'], 'incidence': nat['inc_num'], 'notified': nat['notified'], 'cdr': r2(nat['cdr'], 3), 'pop': nat['pop']},
               'parameters': params, 'counts': {'districts': len(dists), 'facilities': len(facilities), 'sites': len(sites), 'hexagons': len(hex_feats)}},
              open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
    log('done', len(dists), 'districts', len(hex_feats), 'hexagons')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        json.dump({'updated_at': NOW, 'sources': SOURCES, 'error': traceback.format_exc()[-1500:]}, open(os.path.join(OUT, 'meta-error.json'), 'w'), indent=1)
        sys.exit(1)
