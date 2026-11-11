"""
TB surveillance data pipeline (Ghana). Real data only: nothing here is guessed or weighted by hand.

Inputs (all open, fetched every run):
  WHO Global TB Programme   national incidence, notifications, and cases attributable to HIV, undernourishment,
                            smoking, alcohol and diabetes (estimates_age_sex)
  DHS Program API           regional HIV, thinness (BMI < 18.5) and tobacco use
  WorldPop 2020 (100 m)     population, scaled to WHO's latest national population
  Malaria Atlas Project     motorised travel time to the nearest health facility
  OpenStreetMap             health facilities, markets, transport hubs, prisons, mines and quarries
  Meta Relative Wealth Index
  geoBoundaries             region and district boundaries

Expected cases in a district = each WHO risk-factor share of national incidence, split across districts by
population x the regional prevalence of that risk factor (DHS); the rest of incidence split by population.
Alcohol and diabetes have no regional survey data, so they are split by population.

Outputs (public, open data only): districts.geojson, cities.geojson, facilities.geojson, sites.geojson,
national.json, meta.json under public/data/tb. District notifications (DHIMS2 or uploads) and campaign
results stay in Supabase and are joined in the app for signed-in members.
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
    s = s.replace('region', '')
    return re.sub(r'[^a-z]', '', s)  # "North East", "Northeast" and "North-East" all match


def km_xy(lon, lat, lat0):
    return np.c_[np.asarray(lon) * 111.32 * math.cos(math.radians(lat0)), np.asarray(lat) * 110.57]



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


def map_travel_time(mode='Motorized'):
    caps = get('https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCapabilities').text
    ids = re.findall(r'<wcs:CoverageId>([^<]+)</wcs:CoverageId>', caps)
    pick = [i for i in ids if mode.lower() in i.lower() and 'healthcare' in i.lower() and 'travel_time' in i.lower()]
    if not pick:
        raise RuntimeError(f'no {mode} healthcare travel-time coverage found')
    cov = sorted(pick)[-1]
    url = (f'https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId={cov}'
           f'&subset=Lat(4.4,11.3)&subset=Long(-3.4,1.3)&format=image/tiff')
    path = f'/tmp/gha_travel_{mode.lower()}.tif'
    for attempt in range(3):
        with S.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        try:
            ds = rasterio.open(path)
            ds.read(1)  # make sure the whole file is readable
            source(f'Malaria Atlas Project: {"walking" if mode == "Walking" else "motorised"} travel time to healthcare', url.split('&subset')[0], True, f'coverage {cov}')
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
    source('DHS Program API: Ghana DHS 2022 (thinness, tobacco use) and 2014 (HIV), by region', 'https://api.dhsprogram.com', True, f'{len(out)} regions')
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
    # cases attributable to risk factors (all ages, both sexes), latest year available
    attr, attr_year = {}, None
    try:
        rows = table('estimates_age_sex')
        rf_rows = [r for r in rows if r.get('measure') == 'inc' and r.get('unit') == 'num' and r.get('sex') in ('a', 'all') and r.get('risk_factor') not in (None, '', 'all')]
        if rf_rows:
            attr_year = max(int(r['year']) for r in rf_rows)
            for rf in ('hiv', 'und', 'smk', 'alc', 'dia'):
                cand = [r for r in rf_rows if int(r['year']) == attr_year and r['risk_factor'] == rf]
                pick = next((r for ag in ('all', 'a', '15plus') for r in cand if r.get('age_group') == ag), None)
                if pick and pick.get('best') not in (None, '', 'NA'):
                    attr[rf] = float(pick['best'])
        source(f'WHO: Ghana TB cases attributable to risk factors ({attr_year})', 'https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', bool(attr), ', '.join(f'{k} {round(v):,}' for k, v in attr.items()))
    except Exception as e:
        source('WHO: Ghana TB cases attributable to risk factors', 'https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', False, str(e)[:160])
    latest['attributable'], latest['attributable_year'] = attr, attr_year
    source(f'WHO Global TB Programme: Ghana estimates and notifications (latest {latest["year"]})', 'https://www.who.int/teams/global-programme-on-tuberculosis-and-lung-health/data', True)
    return years, latest


# ---------------- main build ----------------
FAR_MIN = 60         # "far from care": more than 1 hour to the nearest facility by motor vehicle
CATCHMENT_KM = 1.0   # people living within walking distance of a screening venue
RF_SURVEY = {'hiv': 'hiv', 'und': 'thin', 'smk': 'smoke'}  # WHO risk factor -> DHS regional indicator


def main():
    cities = sb('tb_cities?select=*&enabled=eq.true')
    log('cities', [c['id'] for c in cities])

    adm1, adm2 = boundaries()
    years, nat = who_tb()
    dhs = dhs_regional()
    facilities, sites = osm_points()
    rwi = rwi_points()
    try:
        tt = map_travel_time()
    except Exception as e:
        tt = None
        source('Malaria Atlas Project: travel time to healthcare', 'https://data.malariaatlas.org', False, f'{e}; using straight-line distance to the nearest mapped facility at 30 km/h')
    try:
        walk = map_travel_time('Walking')
        walk_band = walk.read(1).astype('float32')
        walk_band[(walk_band < 0) | ~np.isfinite(walk_band)] = np.nan
    except Exception as e:
        walk, walk_band = None, None
        source('Malaria Atlas Project: walking travel time to healthcare', 'https://data.malariaatlas.org', False, str(e)[:160])
    tt_band = None
    if tt is not None:
        tt_band = tt.read(1).astype('float32')
        tt_band[(tt_band < 0) | ~np.isfinite(tt_band)] = np.nan
        if not np.isfinite(tt_band).any():
            raise RuntimeError('travel-time raster empty')

    def minutes_at(lons, lats, ds=None, band=None):
        ds, band = (ds, band) if ds is not None else (tt, tt_band)
        rows, cols = rasterio.transform.rowcol(ds.transform, lons, lats)
        rows, cols = np.clip(rows, 0, band.shape[0] - 1), np.clip(cols, 0, band.shape[1] - 1)
        return band[rows, cols]

    # districts and their regions
    regions = [(shape(f['geometry']), f['properties']['shapeName']) for f in adm1['features']]
    dists = []
    for i, f in enumerate(adm2['features']):
        g = shape(f['geometry'])
        c = g.representative_point()
        reg = next((n for rg, n in regions if rg.contains(c)), None)
        if reg is None:
            reg = min(regions, key=lambda x: x[0].distance(c))[1]
        dists.append({'i': i, 'id': f['properties']['shapeID'], 'name': f['properties']['shapeName'], 'region': reg, 'geom': g, 'lon': c.x, 'lat': c.y})

    # population on the 100 m grid, scaled to WHO's latest national population
    with rasterio.open(worldpop()) as src:
        pop = src.read(1, masked=True).filled(0).astype('float32')
        pop[pop < 0] = 0
        transform = src.transform
    labels = rasterize([(d['geom'], d['i'] + 1) for d in dists], out_shape=pop.shape, transform=transform, dtype='int16')
    scale = (nat['pop'] or pop.sum()) / pop.sum()
    pop *= scale
    dsum = np.bincount(labels.ravel(), weights=pop.ravel(), minlength=len(dists) + 1)
    log('population total', int(pop.sum()), 'scale', round(scale, 3))

    # 1 km cells for travel time and wealth
    H, W = (pop.shape[0] // 10) * 10, (pop.shape[1] // 10) * 10
    p1 = pop[:H, :W].reshape(H // 10, 10, W // 10, 10).sum(axis=(1, 3))
    lab1 = labels[5:H:10, 5:W:10][: p1.shape[0], : p1.shape[1]]
    rr, cc = np.nonzero(p1 > 0)
    xs, ys = rasterio.transform.xy(transform, rr * 10 + 5, cc * 10 + 5)
    clon, clat, cpop, clab = np.array(xs), np.array(ys), p1[rr, cc], lab1[rr, cc]
    lat0 = 7.9
    fac_xy = km_xy([f['lon'] for f in facilities], [f['lat'] for f in facilities], lat0) if facilities else None
    fac_tree = cKDTree(fac_xy) if facilities else None
    hosp = [f for f in facilities if f['kind'] == 'hospital']
    hosp_tree = cKDTree(km_xy([f['lon'] for f in hosp], [f['lat'] for f in hosp], lat0)) if hosp else None
    cell_xy = km_xy(clon, clat, lat0)
    if tt_band is not None:
        minutes = minutes_at(clon, clat)
        access_basis = 'Malaria Atlas Project motorised travel time to healthcare'
    else:
        minutes = fac_tree.query(cell_xy)[0] / 30 * 60
        access_basis = 'straight-line distance to the nearest mapped facility at 30 km/h'
    minutes = np.where(np.isnan(minutes), np.nanmedian(minutes), minutes)
    walk_min = minutes_at(clon, clat, walk, walk_band) if walk_band is not None else np.full(len(clon), np.nan)
    rwi_xy = km_xy(rwi[:, 0], rwi[:, 1], lat0)
    rwi_tree = cKDTree(rwi_xy)
    rwi_cell = rwi[rwi_tree.query(cell_xy)[1], 2]

    n = len(dists) + 1
    wsum = lambda v: np.bincount(clab, weights=cpop * v, minlength=n)
    cp = np.bincount(clab, weights=cpop, minlength=n)
    safe = np.where(cp > 0, cp, 1)
    d_minutes, d_far, d_rwi = wsum(minutes) / safe, wsum((minutes > FAR_MIN).astype(float)) / safe, wsum(rwi_cell) / safe
    has_walk = np.isfinite(walk_min)
    wcp = np.bincount(clab, weights=cpop * has_walk, minlength=n)
    d_walk_far = np.bincount(clab, weights=cpop * ((walk_min > FAR_MIN) & has_walk), minlength=n) / np.where(wcp > 0, wcp, 1)
    d_walk_min = np.bincount(clab, weights=cpop * np.where(has_walk, walk_min, 0), minlength=n) / np.where(wcp > 0, wcp, 1)

    # facilities and sites per district
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
    for s_ in sites:
        k = which(s_['lon'], s_['lat'])
        s_['k'] = k
        if k is not None:
            dists[k][kindkey[s_['kind']]] += 1

    for d in dists:
        i = d['i'] + 1
        d['pop'] = float(dsum[i])
        d['area_km2'] = d['geom'].area * 111.32 * 110.57 * math.cos(math.radians(d['lat']))
        d['density'] = d['pop'] / max(d['area_km2'], 1)
        d['minutes'], d['pct_far'], d['rwi'] = float(d_minutes[i]), float(d_far[i]), float(d_rwi[i])
        d['walk_min'], d['walk_far'] = (float(d_walk_min[i]), float(d_walk_far[i])) if walk_band is not None and wcp[i] > 0 else (None, None)
        rf = dhs.get(norm_region(d['region']), {})
        d['hiv'], d['thin'], d['smoke'] = rf.get('hiv'), rf.get('thin'), rf.get('smoke')

    # ---------- expected cases: WHO national incidence split by real risk-factor data ----------
    totpop = sum(d['pop'] for d in dists)
    inc = nat['inc_num']
    attr = dict(nat.get('attributable') or {})
    tot_attr = sum(attr.values())
    if tot_attr > inc:  # attributable fractions overlap; never attribute more than all incidence
        attr = {k: v * inc / tot_attr for k, v in attr.items()}
        tot_attr = inc
    for d in dists:
        d['parts'] = {}
    for rf, num in attr.items():
        key = RF_SURVEY.get(rf)
        vals = [d[key] for d in dists if key and d.get(key) is not None]
        mean_prev = (sum(d['pop'] * d[key] for d in dists if key and d.get(key) is not None) / sum(d['pop'] for d in dists if key and d.get(key) is not None)) if vals else None
        w = [d['pop'] * ((d[key] if d.get(key) is not None else mean_prev) if key and mean_prev else 1.0) for d in dists]
        tw = sum(w) or 1
        for d, wi in zip(dists, w):
            d['parts'][rf] = num * wi / tw
    rest = inc - tot_attr
    for d in dists:
        d['parts']['other'] = rest * d['pop'] / totpop
        d['expected'] = sum(d['parts'].values())
        d['rate'] = d['expected'] / max(d['pop'], 1)

    # ---------- sites: people within 1 km, expected cases among them, nearest care ----------
    cell_h = abs(transform.e) * 110.57
    cell_w = transform.a * 111.32 * math.cos(math.radians(lat0))
    ry, rx = int(math.ceil(CATCHMENT_KM / cell_h)), int(math.ceil(CATCHMENT_KM / cell_w))
    yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
    disk = (yy * cell_h) ** 2 + (xx * cell_w) ** 2 <= CATCHMENT_KM ** 2
    site_xy = km_xy([s_['lon'] for s_ in sites], [s_['lat'] for s_ in sites], lat0) if sites else np.zeros((0, 2))
    site_fac = fac_tree.query(site_xy)[0] if fac_tree is not None and len(sites) else np.full(len(sites), np.nan)
    site_hosp = hosp_tree.query(site_xy)[0] if hosp_tree is not None and len(sites) else np.full(len(sites), np.nan)
    site_min = minutes_at([s_['lon'] for s_ in sites], [s_['lat'] for s_ in sites]) if tt_band is not None and sites else site_fac / 30 * 60
    site_walk = minutes_at([s_['lon'] for s_ in sites], [s_['lat'] for s_ in sites], walk, walk_band) if walk_band is not None and sites else np.full(len(sites), np.nan)
    for j, s_ in enumerate(sites):
        s_['walk_min'] = float(site_walk[j]) if np.isfinite(site_walk[j]) else None
        r, c = rasterio.transform.rowcol(transform, s_['lon'], s_['lat'])
        r0, c0 = r - ry, c - rx
        win = pop[max(r0, 0):r + ry + 1, max(c0, 0):c + rx + 1]
        m = disk[max(0, -r0):max(0, -r0) + win.shape[0], max(0, -c0):max(0, -c0) + win.shape[1]]
        s_['pop_1km'] = float((win * m).sum()) if win.size else 0.0
        d = dists[s_['k']] if s_['k'] is not None else None
        s_['district'], s_['district_id'] = (d['name'], d['id']) if d else (None, None)
        s_['expected_1km'] = s_['pop_1km'] * d['rate'] if d else None
        s_['facility_km'], s_['hospital_km'] = float(site_fac[j]), float(site_hosp[j])
        s_['minutes'] = float(site_min[j]) if np.isfinite(site_min[j]) else None

    # ---------------- write public files ----------------
    def light(g):
        gj = mapping(g.simplify(0.002, preserve_topology=True))
        rnd = lambda c: [rnd(x) for x in c] if isinstance(c[0], (list, tuple)) else [round(c[0], 4), round(c[1], 4)]
        return {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}

    feats = []
    for d in dists:
        feats.append({'type': 'Feature', 'geometry': light(d['geom']), 'properties': {
            'id': d['id'], 'name': d['name'], 'region': d['region'], 'pop': round(d['pop']), 'area_km2': r2(d['area_km2'], 0), 'density': r2(d['density'], 0),
            'rwi': r2(d['rwi'], 3), 'minutes': r2(d['minutes'], 0), 'pct_far': r2(d['pct_far'], 3),
            'walk_min': r2(d['walk_min'], 0), 'walk_far': r2(d['walk_far'], 3), 'walk_far_pop': round(d['walk_far'] * d['pop']) if d['walk_far'] is not None else None,
            'facilities': d['facilities'], 'hospitals': d['hospitals'], 'labs': d['labs'], 'fac_100k': r2(d['facilities'] / max(d['pop'], 1) * 1e5, 2),
            'markets': d['markets'], 'hubs': d['hubs'], 'prisons': d['prisons'], 'mines': d['mines'],
            'hiv': r2(d['hiv'], 1), 'thin': r2(d['thin'], 1), 'smoke': r2(d['smoke'], 1),
            'expected': r2(d['expected'], 1), 'expected_100k': r2(d['rate'] * 1e5, 1), 'parts': {k: r2(v, 1) for k, v in d['parts'].items()},
            'lon': r2(d['lon'], 4), 'lat': r2(d['lat'], 4)}})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'districts.geojson'), 'w'), separators=(',', ':'))

    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [r2(f['lon'], 5), r2(f['lat'], 5)]},
               'properties': {'kind': f['kind'], 'name': f['name'], 'lab': f['lab'], 'district': f.get('district')}} for f in facilities]},
              open(os.path.join(OUT, 'facilities.geojson'), 'w'), separators=(',', ':'))
    json.dump({'type': 'FeatureCollection', 'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [r2(s_['lon'], 5), r2(s_['lat'], 5)]},
               'properties': {'kind': s_['kind'], 'name': s_['name'], 'district': s_['district'], 'district_id': s_['district_id'], 'pop_1km': round(s_['pop_1km']),
                              'expected_1km': r2(s_['expected_1km'], 1), 'facility_km': r2(s_['facility_km'], 2), 'hospital_km': r2(s_['hospital_km'], 2),
                              'minutes': r2(s_['minutes'], 0), 'walk_min': r2(s_['walk_min'], 0)}} for s_ in sites]},
              open(os.path.join(OUT, 'sites.geojson'), 'w'), separators=(',', ':'))

    # ---------------- city hexagons: people and expected cases ----------------
    hex_feats = []
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
        centers = np.array([h3.cell_to_latlng(c) for c in cells])
        cxy = km_xy(centers[:, 1], centers[:, 0], lat0)
        hex_area = h3.average_hexagon_area(res, unit='km^2')
        rwi_h = rwi[rwi_tree.query(cxy)[1], 2]
        fac_d = fac_tree.query(cxy)[0] if fac_tree is not None else np.full(len(cells), np.nan)
        mins = minutes_at(centers[:, 1], centers[:, 0]) if tt_band is not None else fac_d / 30 * 60
        wmins = minutes_at(centers[:, 1], centers[:, 0], walk, walk_band) if walk_band is not None else np.full(len(cells), np.nan)
        kept = 0
        for j, cell in enumerate(cells):
            pv, labs_ = agg[cell]
            dl = max(labs_, key=labs_.get) - 1
            if dl < 0:
                continue
            d = dists[dl]
            ring = [[r2(lng, 5), r2(lat, 5)] for lat, lng in h3.cell_to_boundary(cell)]
            ring.append(ring[0])
            hex_feats.append({'type': 'Feature', 'geometry': {'type': 'Polygon', 'coordinates': [ring]}, 'properties': {
                'h3': cell, 'city': city['id'], 'district': d['name'], 'district_id': d['id'], 'pop': round(pv), 'density': r2(pv / hex_area, 0), 'rwi': r2(rwi_h[j], 3),
                'facility_km': r2(fac_d[j], 2), 'minutes': r2(mins[j], 0) if np.isfinite(mins[j]) else None,
                'walk_min': r2(wmins[j], 0) if np.isfinite(wmins[j]) else None,
                'expected': r2(pv * d['rate'], 2), 'expected_km2': r2(pv * d['rate'] / hex_area, 2)}})
            kept += 1
        log('city', city['id'], kept, 'hexagons')
    json.dump({'type': 'FeatureCollection', 'features': hex_feats}, open(os.path.join(OUT, 'cities.geojson'), 'w'), separators=(',', ':'))

    json.dump({'years': years, 'latest': nat}, open(os.path.join(OUT, 'national.json'), 'w'), indent=1)
    json.dump({'updated_at': NOW, 'sources': SOURCES, 'access_basis': access_basis,
               'method': {'far_minutes': FAR_MIN, 'catchment_km': CATCHMENT_KM, 'attributable_year': nat.get('attributable_year'),
                          'attributable': {k: r2(v, 0) for k, v in attr.items()}, 'unattributed': r2(rest, 0), 'population_scale': r2(scale, 3)},
               'national': {'year': nat['year'], 'incidence': nat['inc_num'], 'incidence_lo': (nat.get('inc_100k_lo') or 0) * nat['pop'] / 1e5 if nat.get('inc_100k_lo') else None,
                            'incidence_hi': (nat.get('inc_100k_hi') or 0) * nat['pop'] / 1e5 if nat.get('inc_100k_hi') else None,
                            'notified': nat['notified'], 'cdr': r2(nat['cdr'], 3), 'pop': nat['pop'], 'tbhiv_pct': nat.get('tbhiv_pct')},
               'counts': {'districts': len(dists), 'facilities': len(facilities), 'sites': len(sites), 'hexagons': len(hex_feats)}},
              open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
    log('done', len(dists), 'districts', len(hex_feats), 'hexagons')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        json.dump({'updated_at': NOW, 'sources': SOURCES, 'error': traceback.format_exc()[-1500:]}, open(os.path.join(OUT, 'meta-error.json'), 'w'), indent=1)
        sys.exit(1)
