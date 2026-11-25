"""Shared helpers for the TB pipeline (build.py): HTTP, the source log shown on the Data sources tab, Malaria Atlas
travel speed and travel times, DHS regional indicators and WHO national TB figures."""
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
WHO_PAGE = 'https://www.who.int/teams/global-programme-on-tuberculosis-and-lung-health/data'


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def _year(name):
    """The first year (20xx) in a dataset name, e.g. a friction surface id."""
    m = re.search(r'(20\d\d)', name)
    return m.group(1) if m else 'latest'


RISK_NAMES = {'hiv': 'HIV', 'und': 'undernourishment', 'smk': 'smoking', 'alc': 'alcohol', 'dia': 'diabetes'}
GROUPS = ('TB numbers', 'Who lives where', 'Who is at risk', 'Places and access', 'Boundaries', 'Not used yet')


def source(name, url, ok, note='', page=None, group='Other', gives='', use='', aurum=None):
    """Log a dataset for the Data sources page. `ok` True = pulled, False = failed this run, None = not used (the note
    says why). `page` is the dataset's landing page (shown to users), `url` what the pipeline fetched; `gives` and
    `use` say what it holds and what Atlas does with it; `aurum` is its row number in Aurum's data list, if it has one."""
    SOURCES.append({'name': name, 'url': url, 'page': page or url, 'ok': ok, 'note': note, 'at': NOW, 'group': group, 'gives': gives, 'use': use, 'aurum': aurum})
    log('SOURCE', name, {True: 'OK', False: 'FAILED', None: 'NOT USED'}[ok], note)


def not_used():
    """Datasets considered (most from Aurum's list) but not pulled, with the reason, so the Data sources page shows them."""
    NU = 'Not used yet'
    source('VIIRS night-time lights', 'https://eogdata.mines.edu/products/vnl/', None, 'Downloads need a registered account, so the automatic weekly refresh cannot fetch them. Poverty comes from Census 2021; urbanicity from population and building density.', group=NU, gives='Night-time light intensity, ~500 m', use='Poverty and urbanicity proxy', aurum=12)
    source('ESA WorldCover land use', 'https://esa-worldcover.org/', None, 'Not needed for current outputs; blank areas are already explained by WorldPop (no people mapped). Can be added to name what blank areas are.', group=NU, gives='Land cover classes, 10 m', use='Urbanicity; what blank areas are', aurum=12)
    source('HRSL and GHSL gridded population', 'https://human-settlement.emergency.copernicus.eu/', None, 'WorldPop 2026 is used instead: a second population layer would give two totals for the same place. GHSL density thresholds are applied to WorldPop.', group=NU, gives='Population on 30-100 m grids', use='Population denominators', aurum=10)
    source('DHS 2022 cluster data (GPS)', 'https://dhsprogram.com/data/Access-Instructions.cfm', None, 'Cluster files need an approved DHS data request. Regional DHS 2022 indicators are used meanwhile.', group=NU, gives='Survey clusters with nutrition and wealth, GPS displaced', use='Covariates and validation', aurum=15)
    source('District Assembly lists of markets, stations, ports, prisons, mines', 'https://www.ghanadistricts.gov.gh/', None, 'No public machine-readable lists found; OpenStreetMap is used. AIG to supply or verify.', group=NU, gives='Official points of interest', use='Congregate and occupational exposure', aurum=14)
    source('Ghana Health Service facility list (2012)', 'https://data.gov.gh/dataset/health-facilities-ghana', None, 'data.gov.gh is not reachable from the automatic refresh. The WHO/KEMRI list covers public facilities including CHPS.', group=NU, gives='Public, CHAG and private facilities', use='Facility list')
    source('DHIMS2, TB e-Tracker, GxAlert', 'https://dhims.chimgh.org/', None, 'Need data-sharing agreements with NTP / GHS. The DHIMS2 connector is built and waiting for a read-only account.', group=NU, gives='District TB notifications, case records, GeneXpert results', use='Measured district gaps and outcomes')


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
def map_friction(mode='Walking'):
    """Malaria Atlas Project 2020 friction surface for Ghana (minutes needed to cross one metre of each ~1 km cell,
    walking only or motorised). Travel times are computed from it to OUR facility list, so distance and time
    always refer to the same facility."""
    caps = get('https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCapabilities').text
    ids = re.findall(r'<wcs:CoverageId>([^<]+)</wcs:CoverageId>', caps)
    pick = [i for i in ids if 'friction' in i.lower() and mode.lower() in i.lower()]
    if not pick:
        raise RuntimeError(f'no {mode} friction surface found')
    cov = sorted(pick)[-1]
    url = (f'https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCoverage&coverageId={cov}'
           f'&subset=Lat(4.4,11.3)&subset=Long(-3.4,1.3)&format=image/tiff')
    path = f'/tmp/gha_friction_{mode.lower()}.tif'
    for attempt in range(3):
        with S.get(url, stream=True, timeout=300) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        try:
            ds = rasterio.open(path)
            ds.read(1)  # make sure the whole file is readable
            source(f'Malaria Atlas Project: {"walking" if mode == "Walking" else "motorised"} friction surface (travel speed)', url.split('&subset')[0], True, f'{_year(cov)} surface, clipped to Ghana', group='Places and access', gives=f'{"Walking" if mode == "Walking" else "Driving"} speed for every ~1 km of Ghana (2020)', use='Minutes to the nearest clinic (walk) or hospital (drive)', aurum=7, page='https://malariaatlas.org/project-resources/accessibility-to-healthcare/')
            return ds
        except Exception as e:
            log('friction raster unreadable, retrying', e)
            time.sleep(10)
    raise RuntimeError('friction raster download was incomplete three times')


def travel_field(ds, lons, lats):
    """Minutes from every cell of the friction surface to the nearest of the given points, and which point that is.
    Multi-source Dijkstra over the 8-neighbour cell graph; an edge costs the mean friction of its two cells x its length."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import dijkstra
    f = ds.read(1).astype('float64')
    f[(f <= 0) | ~np.isfinite(f)] = np.nan
    H, W = f.shape
    T = ds.transform
    lat_rows = T.f + (np.arange(H) + 0.5) * T.e
    dx = abs(T.a) * 111320 * np.cos(np.radians(lat_rows))  # metres per cell, by row
    dy = abs(T.e) * 110574
    idx = np.arange(H * W).reshape(H, W)
    rows, cols, cost = [], [], []
    for di, dj in ((0, 1), (1, 0), (1, 1), (1, -1)):
        c0, c1 = max(0, -dj), W - max(0, dj)
        A, B = f[0:H - di, c0:c1], f[di:H, c0 + dj:c1 + dj]
        length = np.sqrt((dj * dx[0:H - di, None]) ** 2 + (di * dy) ** 2)
        w = (A + B) / 2 * length
        ok = np.isfinite(w)
        rows.append(idx[0:H - di, c0:c1][ok]); cols.append(idx[di:H, c0 + dj:c1 + dj][ok]); cost.append(np.maximum(w[ok], 1e-6))
    G = coo_matrix((np.concatenate(cost), (np.concatenate(rows), np.concatenate(cols))), shape=(H * W, H * W)).tocsr()
    r, c = rasterio.transform.rowcol(T, np.asarray(lons), np.asarray(lats))
    r, c = np.asarray(r), np.asarray(c)
    inside = (r >= 0) & (r < H) & (c >= 0) & (c < W)
    node_point = {}
    for k in np.nonzero(inside)[0]:
        if np.isfinite(f[r[k], c[k]]):
            node_point.setdefault(int(idx[r[k], c[k]]), int(k))
    starts = np.array(sorted(node_point))
    dist, _, src = dijkstra(G, directed=False, indices=starts, min_only=True, return_predecessors=True)
    point = np.full(H * W, -1, dtype=np.int64)
    ok = src >= 0
    point[ok] = np.vectorize(node_point.get)(src[ok])
    dist[~np.isfinite(dist)] = np.nan
    return dist.reshape(H, W), point.reshape(H, W)


def haversine_km(lon1, lat1, lon2, lat2):
    lon1, lat1, lon2, lat2 = map(np.radians, (lon1, lat1, lon2, lat2))
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    return 6371.0 * 2 * np.arcsin(np.sqrt(a))


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
    source('DHS Program API: Ghana DHS 2022 (thinness, tobacco use) and 2014 (HIV), by region', 'https://api.dhsprogram.com', True, f'{len(out)} regions', group='Who is at risk', gives='HIV, thinness and tobacco use by region', use='Regional risk adjustment of expected cases', page='https://www.statcompiler.com/en/')
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
        source(f'WHO: Ghana TB cases attributable to risk factors ({attr_year})', 'https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', bool(attr), ' · '.join(f'{RISK_NAMES.get(k, k)} {round(v):,}' for k, v in attr.items()), page=WHO_PAGE, group='TB numbers', gives='TB cases linked to HIV, undernourishment, smoking, alcohol', use='Weights for the regional risk adjustment')
    except Exception as e:
        source('WHO: Ghana TB cases attributable to risk factors', 'https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', False, str(e)[:160], page=WHO_PAGE, group='TB numbers', gives='TB cases linked to HIV, undernourishment, smoking, alcohol', use='Weights for the regional risk adjustment')
    latest['attributable'], latest['attributable_year'] = attr, attr_year
    source(f'WHO Global TB Programme: Ghana estimates and notifications (latest {latest["year"]})', 'https://www.who.int/teams/global-programme-on-tuberculosis-and-lung-health/data', True,
           f'{round(latest["inc_num"]):,} estimated, {round(latest["notified"]):,} notified in {latest["year"]}', group='TB numbers',
           gives="Ghana's estimated and notified TB cases, by year", use='National totals: expected, found, missed')
    return years, latest


# ---------------- main build ----------------
FAR_MIN = 60         # "far from care": more than 1 hour to the nearest facility by motor vehicle
CATCHMENT_KM = 1.0   # people living within walking distance of a screening venue
RF_SURVEY = {'hiv': 'hiv', 'und': 'thin', 'smk': 'smoke'}  # WHO risk factor -> DHS regional indicator
