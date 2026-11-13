"""Shared helpers for the TB pipeline (build_tb3.py): HTTP, source log, Overpass, Malaria Atlas travel time,
DHS regional indicators, WHO national TB figures and OpenStreetMap points."""
import csv, io, json, math, os, re, time
from datetime import datetime, timezone

import numpy as np
import requests
import rasterio

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
    if x is None:
        return None
    try:
        x = float(x)  # also numpy floats
    except (TypeError, ValueError):
        return None
    return round(x, n) if math.isfinite(x) else None


# ---------------- sources ----------------
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
