"""
TB surveillance pipeline v3 (Ghana): district-level, real data only. Feeds the drill-down explorer:
Ghana -> district -> town -> screening spots.

Inputs (all open, fetched every run)
  GSS 2021 Census       261 district boundaries; population by district, single age and sex; urban share;
                        household size and sleeping rooms (crowding); multidimensional poverty; health insurance
  WHO Global TB Prog.   national incidence and notifications; incidence by age group and sex; cases attributable
                        to HIV, undernourishment, smoking, alcohol, diabetes
  DHS Program           regional HIV, thinness and tobacco use (the only one that is regional, labelled as such)
  WorldPop 2026         population on a 100 m grid
  Malaria Atlas Project walking and motorised travel time to the nearest health facility
  OpenStreetMap         health facilities, towns and villages, markets, lorry stations, prisons, mines, schools,
                        places of worship, community centres, pharmacies, NGO offices
  DHIMS II extract      monthly reported TB for Ashanti, Eastern and Volta, 2016-2023 (Mendeley Data, CC BY 4.0)

Expected cases in a district
  1. WHO's age- and sex-specific incidence rates (WHO cases / census population for each group) x the district's
     census population in each group  -> differences in age and sex structure.
  2. The share of cases WHO attributes to HIV, undernourishment and smoking is scaled by the region's survey rate
     relative to Ghana's  -> differences in risk.
  3. Grown to 2026 with WorldPop and scaled so all districts add up to WHO's national estimate.
No hand-set weights.
"""
import csv
import io
import json
import math
import os
import re
import sys
import traceback
import zipfile

import numpy as np
import rasterio
import shapefile
import h3
from rasterio.features import rasterize
from scipy.spatial import cKDTree
from shapely.geometry import shape, mapping, Point, Polygon, MultiPoint
from shapely.ops import unary_union, voronoi_diagram
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_tb import (OUT, NOW, SOURCES, S, MIRRORS, get, source, log, r2, km_xy, norm_region, overpass,  # noqa: E402
                      map_travel_time, dhs_regional, who_tb, osm_points, sb)

PX = 'https://statsbank.statsghana.gov.gh/api/v1/en/PHC%202021%20StatsBank/'
FAR_MIN = 60          # minutes on foot that count as "far from care"
CATCH_KM = 1.0        # walking catchment of a screening spot
HEX_RES = 8           # ~0.74 km2 hexagons
MIN_HEX_POP = 30      # skip near-empty hexagons
TOWN_MAX_KM = 5.0     # a hexagon joins its nearest named place if it is within this distance
RF_SURVEY = {'hiv': 'hiv', 'und': 'thin', 'smk': 'smoke'}
WP_URL = 'https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/GHA/v1/100m/constrained/gha_pop_2026_CN_100m_R2025A_v1.tif'
DD = os.path.join(OUT, 'd')
os.makedirs(DD, exist_ok=True)


def dnorm(s):
    s = (s or '').lower().replace('&', 'and')
    s = re.sub(r'\b(municipal|metropolitan|metro|district|assembly|municipality)\b', '', s)
    return re.sub(r'[^a-z]', '', s)


def slug(s):
    return 'gh-' + re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


# ---------------- sources ----------------
def gss_districts():
    url = 'https://statsbank.statsghana.gov.gh/assets/geofiles.zip'
    z = zipfile.ZipFile(io.BytesIO(get(url, timeout=300).content))
    inner = zipfile.ZipFile(io.BytesIO(z.read('Geo FIles/Districts_261.zip')))
    base = [n for n in inner.namelist() if n.endswith('.shp')][0][:-4]
    sf = shapefile.Reader(shp=io.BytesIO(inner.read(base + '.shp')), dbf=io.BytesIO(inner.read(base + '.dbf')), shx=io.BytesIO(inner.read(base + '.shx')))
    out = []
    for i, (rec, shp) in enumerate(zip(sf.records(), sf.shapes())):
        r = rec.as_dict()
        g = shape(shp.__geo_interface__)
        if not g.is_valid:
            g = g.buffer(0)
        c = g.representative_point()
        out.append({'i': i, 'id': slug(r['District']), 'name': r['District'], 'region': r['Region'], 'geom': g, 'lon': c.x, 'lat': c.y})
    source('Ghana Statistical Service: 2021 Census district boundaries', url, True, f'{len(out)} districts')
    return out


def px(table, sel):
    """Query a GSS StatsBank (PxWeb) table. sel: {variable code: [values] | '*'}; unlisted variables take their first value."""
    meta = get(PX + table, timeout=90).json()
    q = []
    for v in meta['variables']:
        vals = sel.get(v['code'])
        vals = v['values'] if vals == '*' else (vals if vals is not None else v['values'][:1])
        q.append({'code': v['code'], 'selection': {'filter': 'item', 'values': vals}})
    r = S.post(PX + table, json={'query': q, 'response': {'format': 'json-stat2'}}, timeout=600)
    r.raise_for_status()
    js = r.json()
    dims, sizes, values = js['id'], js['size'], js['value']
    cats = [[k for k, _ in sorted(js['dimension'][d]['category']['index'].items(), key=lambda x: x[1])] for d in dims]
    out = {}
    for idx, val in enumerate(values):
        if val is None:
            continue
        key = tuple(cats[j][k] for j, k in enumerate(np.unravel_index(idx, sizes)))
        out[key] = val
    return dims, out


def census():
    """Per-district census figures keyed by normalised district name."""
    D = {}
    src = 'https://statsbank.statsghana.gov.gh/pxweb/en/PHC%202021%20StatsBank/'

    def row(name):
        return D.setdefault(dnorm(name), {'label': name})

    # population by single age and sex
    dims, v = px('Population/population_table2_locality2.px', {'Locality': ['All Locality Types'], 'District': '*', 'Sex': ['Male', 'Female'], 'Age': '*'})
    di, si, ai = dims.index('District'), dims.index('Sex'), dims.index('Age')
    for k, val in v.items():
        m = re.fullmatch(r'(\d+)\+?', k[ai])
        if not m:
            continue
        r = row(k[di])
        r.setdefault('ages', {}).setdefault(k[si][0].lower(), {})
        a = int(m.group(1))
        r['ages'][k[si][0].lower()][a] = r['ages'][k[si][0].lower()].get(a, 0) + val
    # urban share
    dims, v = px('Population/population_table2_locality2.px', {'Locality': ['All Locality Types', 'Urban2'], 'District': '*', 'Sex': ['Both sexes'], 'Age': ['All ages']})
    li, di = dims.index('Locality'), dims.index('District')
    tot = {k[di]: val for k, val in v.items() if k[li] == 'All Locality Types'}
    for k, val in v.items():
        if k[li] == 'Urban2' and tot.get(k[di]):
            row(k[di])['urban'] = val / tot[k[di]]
    source('GSS 2021 Census: population by district, single age and sex', src + 'Population/', True, f'{sum(1 for r in D.values() if r.get("ages"))} areas')
    # crowding: household size / mean sleeping rooms
    dims, v = px('Population/avg_hhsize_table.px', {'Locality': ['All Locality Types'], 'Geographic_Area': '*'})
    gi = dims.index('Geographic_Area')
    for k, val in v.items():
        row(k[gi])['hh_size'] = val
    dims, v = px('Housing/sleep_rooms.px', {'Rooms': '*', 'Locality': ['All Locality Types'], 'Geographic_Area': '*'})
    ri, gi = dims.index('Rooms'), dims.index('Geographic_Area')
    words = {'One': 1, 'Two': 2, 'Three': 3, 'Four': 4, 'Five': 5, 'Six': 6, 'Seven': 7, 'Eight': 8, 'Nine': 9}
    agg = {}
    for k, val in v.items():
        if k[ri] == 'Total':
            continue
        n = words.get(k[ri].split()[0])
        if n:
            a = agg.setdefault(k[gi], [0.0, 0.0, 0.0])
            a[0] += val
            a[1] += val * n
            a[2] += val if n == 1 else 0
    for name, (hh, rooms, one) in agg.items():
        r = row(name)
        if hh:
            r['rooms'] = rooms / hh
            r['one_room'] = one / hh
            if r.get('hh_size'):
                r['crowding'] = r['hh_size'] / r['rooms']
    source('GSS 2021 Census: household size and sleeping rooms by district', src + 'Housing/', True)
    # multidimensional poverty
    dims, v = px('Multidimensional%20Poverty/MPI_by_locality.px', {'poverty_measure': ['Incidence of Poverty (H)'], 'locality': ['All locality types'], 'Geographic_Area': '*'})
    gi = dims.index('Geographic_Area')
    for k, val in v.items():
        row(k[gi])['poverty'] = val
    source('GSS 2021 Census: multidimensional poverty by district', src + 'Multidimensional%20Poverty/', True)
    # health insurance coverage
    dims, v = px('Population/health_insurance.px', {'Health_Insurance': ['Total', 'Covered'], 'Education': ['Total'], 'Locality': ['All Locality Types'], 'Geographic_Area': '*', 'Sex': ['Both sexes'], 'Age': ['All ages']})
    hi, gi = dims.index('Health_Insurance'), dims.index('Geographic_Area')
    tot = {k[gi]: val for k, val in v.items() if k[hi] == 'Total'}
    for k, val in v.items():
        if k[hi] == 'Covered' and tot.get(k[gi]):
            row(k[gi])['insured'] = val / tot[k[gi]]
    source('GSS 2021 Census: health insurance coverage by district', src + 'Population/', True)
    return D


def who_age_sex():
    txt = get('https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', timeout=300).text
    rows = [r for r in csv.DictReader(io.StringIO(txt)) if r.get('iso3') == 'GHA' and r.get('measure') == 'inc' and r.get('unit') == 'num' and r.get('risk_factor') == 'all' and r.get('sex') in ('m', 'f')]
    yr = max(int(r['year']) for r in rows)
    ints = {}
    for r in rows:
        if int(r['year']) != yr or r.get('best') in (None, '', 'NA'):
            continue
        m = re.fullmatch(r'(\d+)-(\d+)', r['age_group']) or re.fullmatch(r'(\d+)plus', r['age_group'])
        if not m:
            continue
        lo = int(m.group(1))
        hi = int(m.group(2)) if m.lastindex == 2 else 200
        ints.setdefault((lo, hi), {})[r['sex']] = float(r['best'])
    # finest non-overlapping partition starting at age 0
    groups, age = [], 0
    while age <= 120:
        cand = sorted([k for k in ints if k[0] == age and 'm' in ints[k] and 'f' in ints[k]], key=lambda k: k[1] - k[0])
        if not cand:
            break
        groups.append(cand[0])
        age = cand[0][1] + 1
    source(f'WHO: Ghana TB incidence by age group and sex ({yr})', 'https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex', bool(groups), ', '.join(f'{lo}-{hi if hi < 200 else "+"}' for lo, hi in groups))
    return yr, [(lo, hi, ints[(lo, hi)]) for lo, hi in groups]


def worldpop_2026():
    path = '/tmp/gha_pop_2026.tif'
    if not os.path.exists(path):
        with S.get(WP_URL, stream=True, timeout=900) as r:
            r.raise_for_status()
            with open(path, 'wb') as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    source('WorldPop 2026 population (100 m, R2025A)', WP_URL, True)
    return path


def osm_extra():
    area = 'area["ISO3166-1"="GH"][admin_level=2]->.a;'
    places = overpass(f'[out:json][timeout:300];{area}node["place"~"^(city|town|suburb|village|hamlet)$"](area.a);out;', 'towns and villages') or []
    comm = overpass(f'[out:json][timeout:300];{area}(nwr["amenity"~"^(school|place_of_worship|community_centre|pharmacy)$"](area.a);nwr["office"="ngo"](area.a););out center tags;', 'schools, places of worship, community centres, pharmacies, NGOs') or []

    def pt(e):
        if 'lat' in e:
            return e['lon'], e['lat']
        c = e.get('center')
        return (c['lon'], c['lat']) if c else None
    towns = []
    for e in places:
        p, t = pt(e), e.get('tags', {})
        if p and t.get('name'):
            towns.append({'lon': p[0], 'lat': p[1], 'name': t['name'], 'place': t['place']})
    kinds = {'school': 'school', 'place_of_worship': 'place of worship', 'community_centre': 'community centre', 'pharmacy': 'pharmacy'}
    venues = []
    for e in comm:
        p, t = pt(e), e.get('tags', {})
        if not p:
            continue
        kind = 'NGO office' if t.get('office') == 'ngo' else kinds.get(t.get('amenity'))
        if kind:
            venues.append({'lon': p[0], 'lat': p[1], 'name': t.get('name') or '', 'kind': kind})
    return towns, venues


def dhims_regions():
    url = 'https://data.mendeley.com/public-files/datasets/r3c3cr7x6g/files/d8fc241d-9834-467f-8d82-56241fab6ee9/file_downloaded'
    try:
        txt = get(url, timeout=120).text
        months = {m: i + 1 for i, m in enumerate(['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'])}
        out = {}
        for r in csv.DictReader(io.StringIO(txt)):
            r = {k.strip(): v for k, v in r.items()}
            m = re.fullmatch(r'([A-Za-z]{3})-(\d{2})', (r.get('Period') or '').strip())
            if not m or not r.get('TB'):
                continue
            out.setdefault(r['Region'].strip(), []).append({'period': f'20{m.group(2)}-{months[m.group(1).lower()]:02d}', 'tb': int(float(r['TB']))})
        for k in out:
            out[k].sort(key=lambda x: x['period'])
        source('DHIMS II extract: monthly reported TB, Ashanti, Eastern and Volta, 2016-2023 (Mendeley Data)', 'https://data.mendeley.com/datasets/r3c3cr7x6g/1', bool(out), ', '.join(f'{k} {len(v)} months' for k, v in out.items()))
        return out
    except Exception as e:
        source('DHIMS II extract (Mendeley Data)', 'https://data.mendeley.com/datasets/r3c3cr7x6g/1', False, str(e)[:160])
        return {}


# ---------------- build ----------------
def main():
    dists = gss_districts()
    years, nat = who_tb()
    who_year, age_groups = who_age_sex()
    dhs = dhs_regional()
    cen = census()
    facilities, sites = osm_points()
    towns, comm = osm_extra()
    reported = dhims_regions()
    tt = map_travel_time('Motorized')
    walk = map_travel_time('Walking')

    def band(ds):
        b = ds.read(1).astype('float32')
        b[(b < 0) | ~np.isfinite(b)] = np.nan
        return b
    tt_b, walk_b = band(tt), band(walk)

    def sample(ds, b, lons, lats):
        rows, cols = rasterio.transform.rowcol(ds.transform, lons, lats)
        rows, cols = np.clip(rows, 0, b.shape[0] - 1), np.clip(cols, 0, b.shape[1] - 1)
        return b[rows, cols]

    # ---- census join ----
    missing = []
    for d in dists:
        c = cen.get(dnorm(d['name']))
        if c is None:  # try loose match (e.g. spelling variants)
            cand = [k for k in cen if k.startswith(dnorm(d['name'])[:8])]
            c = cen.get(cand[0]) if len(cand) == 1 else None
        if c is None:
            missing.append(d['name'])
        d['cen'] = c or {}
    log('census join: missing', len(missing), missing[:20])

    # ---- population grid 2026 ----
    with rasterio.open(worldpop_2026()) as src:
        pop = src.read(1, masked=True).filled(0).astype('float32')
        pop[pop < 0] = 0
        transform = src.transform
    labels = rasterize([(d['geom'], d['i'] + 1) for d in dists], out_shape=pop.shape, transform=transform, dtype='int16')
    wp = np.bincount(labels.ravel(), weights=pop.ravel(), minlength=len(dists) + 1)
    for d in dists:
        d['pop'] = float(wp[d['i'] + 1])

    # ---- expected cases ----
    gh_age = {'m': {}, 'f': {}}
    for d in dists:
        for s in ('m', 'f'):
            for a, n in (d['cen'].get('ages', {}).get(s, {}) or {}).items():
                gh_age[s][a] = gh_age[s].get(a, 0) + n
    def group_pop(ages, lo, hi):
        return sum(n for a, n in ages.items() if lo <= a <= hi)
    rates = [(lo, hi, {s: inc[s] / max(group_pop(gh_age[s], lo, hi), 1) for s in ('m', 'f')}) for lo, hi, inc in age_groups]
    inc = nat['inc_num']
    attr = {k: v for k, v in (nat.get('attributable') or {}).items()}
    nat_prev = {}
    for rf, key in RF_SURVEY.items():
        w = [(d['pop'], dhs.get(norm_region(d['region']), {}).get(key)) for d in dists]
        w = [(p, v) for p, v in w if v is not None]
        nat_prev[rf] = sum(p * v for p, v in w) / sum(p for p, _ in w) if w else None
    for d in dists:
        ages = d['cen'].get('ages')
        census_pop = sum(sum(x.values()) for x in ages.values()) if ages else 0
        d['census_pop'] = census_pop
        if ages:
            d['exp_age'] = sum(r[s] * group_pop(ages.get(s, {}), lo, hi) for lo, hi, r in rates for s in ('m', 'f'))
            adults = sum(group_pop(ages.get(s, {}), 15, 200) for s in ('m', 'f'))
            d['adults'] = adults / census_pop if census_pop else None
            d['male'] = sum(ages.get('m', {}).values()) / census_pop if census_pop else None
        else:  # no census row: national average rate
            d['exp_age'] = None
            d['adults'] = d['male'] = None
        rf = dhs.get(norm_region(d['region']), {})
        d['hiv'], d['thin'], d['smoke'] = rf.get('hiv'), rf.get('thin'), rf.get('smoke')
        factor = 1 - sum(attr.get(k, 0) for k in RF_SURVEY) / inc
        for k, key in RF_SURVEY.items():
            if attr.get(k) and nat_prev.get(k) and rf.get(key) is not None:
                factor += attr[k] / inc * rf[key] / nat_prev[k]
            elif attr.get(k):
                factor += attr[k] / inc
        d['risk_factor'] = factor
    nat_rate_age = sum(d['exp_age'] for d in dists if d['exp_age']) / max(sum(d['census_pop'] for d in dists if d['exp_age']), 1)
    for d in dists:
        base = d['exp_age'] if d['exp_age'] is not None else nat_rate_age * d['pop']
        growth = d['pop'] / d['census_pop'] if d['census_pop'] else 1
        d['raw'] = base * d['risk_factor'] * growth
    tot_raw = sum(d['raw'] for d in dists)
    for d in dists:
        d['expected'] = inc * d['raw'] / tot_raw
        d['rate'] = d['expected'] / max(d['pop'], 1)
        d['age_effect'] = (d['exp_age'] / d['census_pop'] / nat_rate_age) if d['exp_age'] and d['census_pop'] else None
    nat_rate = inc / sum(d['pop'] for d in dists)

    # ---- access ----
    H, W = (pop.shape[0] // 10) * 10, (pop.shape[1] // 10) * 10
    p1 = pop[:H, :W].reshape(H // 10, 10, W // 10, 10).sum(axis=(1, 3))
    lab1 = labels[5:H:10, 5:W:10][: p1.shape[0], : p1.shape[1]]
    rr, cc = np.nonzero(p1 > 0)
    xs, ys = rasterio.transform.xy(transform, rr * 10 + 5, cc * 10 + 5)
    clon, clat, cpop, clab = np.array(xs), np.array(ys), p1[rr, cc], lab1[rr, cc]
    mins = sample(tt, tt_b, clon, clat)
    wmins = sample(walk, walk_b, clon, clat)
    n = len(dists) + 1
    ok_m, ok_w = np.isfinite(mins), np.isfinite(wmins)
    cp_m = np.bincount(clab, weights=cpop * ok_m, minlength=n)
    cp_w = np.bincount(clab, weights=cpop * ok_w, minlength=n)
    d_min = np.bincount(clab, weights=cpop * np.where(ok_m, mins, 0), minlength=n) / np.where(cp_m > 0, cp_m, 1)
    d_wmin = np.bincount(clab, weights=cpop * np.where(ok_w, wmins, 0), minlength=n) / np.where(cp_w > 0, cp_w, 1)
    d_wfar = np.bincount(clab, weights=cpop * (ok_w & (wmins > FAR_MIN)), minlength=n) / np.where(cp_w > 0, cp_w, 1)

    # ---- assign points to districts ----
    tree = STRtree([d['geom'] for d in dists])

    def which(lon, lat):
        p = Point(lon, lat)
        for k in tree.query(p):
            if dists[k]['geom'].contains(p):
                return k
        return None
    lat0 = 7.9
    fac_tree = cKDTree(km_xy([f['lon'] for f in facilities], [f['lat'] for f in facilities], lat0))
    hosp = [f for f in facilities if f['kind'] == 'hospital']
    hosp_tree = cKDTree(km_xy([f['lon'] for f in hosp], [f['lat'] for f in hosp], lat0)) if hosp else None
    for d in dists:
        d.update(facilities=[], venues=[], towns=[], hospitals=0, labs=0, markets=0, hubs=0, prisons=0, mines=0)
    for f in facilities:
        k = which(f['lon'], f['lat'])
        if k is not None:
            dists[k]['facilities'].append(f)
            dists[k]['hospitals'] += f['kind'] == 'hospital'
            dists[k]['labs'] += bool(f['lab'])
    kindkey = {'market': 'markets', 'transport hub': 'hubs', 'prison': 'prisons', 'mine / quarry': 'mines'}
    allv = [dict(s, cong=True) for s in sites] + [dict(c, cong=False) for c in comm]
    for v in allv:
        k = which(v['lon'], v['lat'])
        if k is not None:
            dists[k]['venues'].append(v)
            if v['kind'] in kindkey:
                dists[k][kindkey[v['kind']]] += 1
    for t in towns:
        k = which(t['lon'], t['lat'])
        if k is not None:
            dists[k]['towns'].append(t)

    # ---- people within a radius (100 m grid) ----
    cell_h = abs(transform.e) * 110.57
    cell_w = transform.a * 111.32 * math.cos(math.radians(lat0))
    disks = {}

    def people_within(lon, lat, km):
        if km not in disks:
            ry, rx = int(math.ceil(km / cell_h)), int(math.ceil(km / cell_w))
            yy, xx = np.mgrid[-ry:ry + 1, -rx:rx + 1]
            disks[km] = (ry, rx, (yy * cell_h) ** 2 + (xx * cell_w) ** 2 <= km ** 2)
        ry, rx, disk = disks[km]
        r, c = rasterio.transform.rowcol(transform, lon, lat)
        r0, c0 = r - ry, c - rx
        win = pop[max(r0, 0):r + ry + 1, max(c0, 0):c + rx + 1]
        if not win.size:
            return 0.0
        m = disk[max(0, -r0):max(0, -r0) + win.shape[0], max(0, -c0):max(0, -c0) + win.shape[1]]
        return float((win * m).sum())

    def near(points, lons, lats):
        if not len(lons):
            return np.array([]), np.array([]), np.array([]), np.array([])
        xy = km_xy(lons, lats, lat0)
        fk = fac_tree.query(xy)[0]
        hk = hosp_tree.query(xy)[0] if hosp_tree is not None else np.full(len(lons), np.nan)
        return fk, hk, sample(tt, tt_b, lons, lats), sample(walk, walk_b, lons, lats)

    # ---- hexagons per district ----
    rr2, cc2 = np.nonzero(pop > 0)
    hx, hy = rasterio.transform.xy(transform, rr2, cc2)
    hv, hl = pop[rr2, cc2], labels[rr2, cc2]
    cells = {}
    for x, y, pv, lb in zip(hx, hy, hv, hl):
        if lb == 0:
            continue
        cid = h3.latlng_to_cell(y, x, HEX_RES)
        a = cells.get(cid)
        if a is None:
            cells[cid] = [float(pv), {int(lb): float(pv)}]
        else:
            a[0] += float(pv)
            a[1][int(lb)] = a[1].get(int(lb), 0) + float(pv)
    log('hexagons', len(cells))
    by_d = {}
    for cid, (pv, labs) in cells.items():
        if pv < MIN_HEX_POP:
            continue
        by_d.setdefault(max(labs, key=labs.get) - 1, []).append((cid, pv))
    hex_area = h3.average_hexagon_area(HEX_RES, unit='km^2')

    # ---- write per-district files ----
    feats, keysites = [], []
    for d in dists:
        i = d['i'] + 1
        hexes = by_d.get(d['i'], [])
        if hexes:
            cen_ll = np.array([h3.cell_to_latlng(c) for c, _ in hexes])
            hf, _, hm, hw = near(None, cen_ll[:, 1], cen_ll[:, 0])
        hex_out = []
        for j, (cid, pv) in enumerate(hexes):
            ring = [[round(lng, 4), round(lat, 4)] for lat, lng in h3.cell_to_boundary(cid)]
            hex_out.append({'h': cid, 'p': round(pv), 'e': r2(pv * d['rate'], 2), 'k': r2(pv * d['rate'] / hex_area, 2), 'f': r2(hf[j], 2), 'w': r2(hw[j], 0), 'r': ring})
        rnd = lambda co: [rnd(x) for x in co] if isinstance(co[0], (list, tuple)) else [round(co[0], 4), round(co[1], 4)]
        for h in hex_out:
            h['t'] = -1
        # town areas: the district is split between its named towns, villages and suburbs (OpenStreetMap) so that every
        # place belongs to its nearest one (Voronoi, clipped to the district). Population and expected cases are the
        # hexagons inside each area. Towns whose area has no mapped population are kept and flagged, not hidden.
        seen, tw = set(), []
        for t in d['towns']:
            k = (round(t['lon'], 5), round(t['lat'], 5))
            if k not in seen:
                seen.add(k)
                tw.append(t)
        town_out = []
        if tw:
            if len(tw) >= 2:
                cells = voronoi_diagram(MultiPoint([(t['lon'], t['lat']) for t in tw]), envelope=d['geom'].envelope.buffer(0.2))
                areas = [None] * len(tw)
                ctree = STRtree(list(cells.geoms))
                for k, t in enumerate(tw):
                    p_ = Point(t['lon'], t['lat'])
                    for ci in ctree.query(p_):
                        if cells.geoms[ci].contains(p_) or cells.geoms[ci].touches(p_):
                            areas[k] = cells.geoms[ci].intersection(d['geom'])
                            break
            else:
                areas = [d['geom']]
            members = {}
            if hex_out:
                txy = km_xy([t['lon'] for t in tw], [t['lat'] for t in tw], lat0)
                hxy = km_xy(cen_ll[:, 1], cen_ll[:, 0], lat0)
                _, idx = cKDTree(txy).query(hxy)
                for j, k in enumerate(idx):
                    members.setdefault(int(k), []).append(j)
            tf, th, tm, twk = near(None, np.array([t['lon'] for t in tw]), np.array([t['lat'] for t in tw]))
            order = sorted(range(len(tw)), key=lambda k: -sum(hex_out[j]['p'] for j in members.get(k, [])))
            for k in order:
                g = areas[k]
                if g is not None and g.geom_type == 'GeometryCollection':
                    g = unary_union([x for x in g.geoms if x.geom_type in ('Polygon', 'MultiPolygon')])
                if g is None or g.is_empty or g.geom_type not in ('Polygon', 'MultiPolygon'):
                    continue
                js = members.get(k, [])
                ti = len(town_out)
                for j in js:
                    hex_out[j]['t'] = ti
                pp = sum(hex_out[j]['p'] for j in js)
                ee = sum(hex_out[j]['e'] or 0 for j in js)
                area = g.area * 111.32 * 110.57 * math.cos(math.radians(d['lat']))
                gj = mapping(g.simplify(0.0008, preserve_topology=True))
                t = tw[k]
                town_out.append({'id': ti, 'name': t['name'], 'place': t['place'], 'lon': round(t['lon'], 5), 'lat': round(t['lat'], 5), 'pop': round(pp), 'nodata': pp < 1,
                                 'area_km2': r2(area, 1), 'radius_km': r2(math.sqrt(max(area, 0.1) / math.pi), 2), 'expected': r2(ee, 1), 'expected_km2': r2(ee / area, 2) if area else None,
                                 'facility_km': r2(tf[k], 2), 'hospital_km': r2(th[k], 2), 'drive_min': r2(tm[k], 0), 'walk_min': r2(twk[k], 0),
                                 'geom': {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}})
        cell_town = {h['h']: h['t'] for h in hex_out}
        # venues: all congregate sites; community venues limited to the 12 busiest per kind in each town
        vs = d['venues']
        vf, vh, vm, vw = near(None, np.array([v['lon'] for v in vs]), np.array([v['lat'] for v in vs]))
        ven = []
        for j, v in enumerate(vs):
            pp = people_within(v['lon'], v['lat'], CATCH_KM)
            ven.append({'name': v['name'], 'kind': v['kind'], 'cong': v['cong'], 'lon': round(v['lon'], 5), 'lat': round(v['lat'], 5), 'pop_1km': round(pp),
                        't': cell_town.get(h3.latlng_to_cell(v['lat'], v['lon'], HEX_RES), -1),
                        'expected_1km': r2(pp * d['rate'], 1), 'facility_km': r2(vf[j], 2), 'hospital_km': r2(vh[j], 2), 'walk_min': r2(vw[j], 0)})
        keep, per_kind = [], {}
        for v in sorted(ven, key=lambda x: -x['pop_1km']):
            if v['cong']:
                keep.append(v)
            elif per_kind.get((v['t'], v['kind']), 0) < 12:
                per_kind[(v['t'], v['kind'])] = per_kind.get((v['t'], v['kind']), 0) + 1
                keep.append(v)
        for v in keep:
            if v['kind'] in ('prison', 'mine / quarry'):
                keysites.append({**v, 'district': d['name'], 'district_id': d['id']})
        fac_out = [{'name': f['name'], 'kind': f['kind'], 'lab': f['lab'], 'lon': round(f['lon'], 5), 'lat': round(f['lat'], 5)} for f in d['facilities']]
        json.dump({'id': d['id'], 'hexes': hex_out, 'towns': town_out, 'venues': keep, 'facilities': fac_out}, open(os.path.join(DD, f'{d["id"]}.json'), 'w'), separators=(',', ':'), allow_nan=False)

        c = d['cen']
        gj = mapping(d['geom'].simplify(0.003, preserve_topology=True))
        rnd = lambda co: [rnd(x) for x in co] if isinstance(co[0], (list, tuple)) else [round(co[0], 4), round(co[1], 4)]
        feats.append({'type': 'Feature', 'geometry': {'type': gj['type'], 'coordinates': rnd(gj['coordinates'])}, 'properties': {
            'id': d['id'], 'name': d['name'], 'region': d['region'], 'pop': round(d['pop']), 'census_pop': round(d['census_pop']) if d['census_pop'] else None,
            'area_km2': r2(d['geom'].area * 111.32 * 110.57 * math.cos(math.radians(d['lat'])), 0),
            'expected': r2(d['expected'], 1), 'expected_100k': r2(d['rate'] * 1e5, 1), 'vs_ghana': r2(d['rate'] / nat_rate, 3), 'share': r2(d['expected'] / inc, 4),
            'age_effect': r2(d['age_effect'], 3), 'risk_effect': r2(d['risk_factor'], 3),
            'adults': r2(d['adults'], 3), 'male': r2(d['male'], 3), 'urban': r2(c.get('urban'), 3),
            'poverty': r2(c.get('poverty'), 1), 'crowding': r2(c.get('crowding'), 2), 'one_room': r2(c.get('one_room'), 3), 'hh_size': r2(c.get('hh_size'), 2), 'insured': r2(c.get('insured'), 3),
            'hiv': r2(d['hiv'], 1), 'thin': r2(d['thin'], 1), 'smoke': r2(d['smoke'], 1),
            'drive_min': r2(d_min[i], 0), 'walk_min': r2(d_wmin[i], 0), 'walk_far': r2(d_wfar[i], 3),
            'facilities': len(d['facilities']), 'hospitals': d['hospitals'], 'labs': d['labs'], 'fac_100k': r2(len(d['facilities']) / max(d['pop'], 1) * 1e5, 2),
            'markets': d['markets'], 'hubs': d['hubs'], 'prisons': d['prisons'], 'mines': d['mines'], 'towns': len(town_out),
            'lon': r2(d['lon'], 4), 'lat': r2(d['lat'], 4)}})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'districts.geojson'), 'w'), separators=(',', ':'), allow_nan=False)
    json.dump(keysites, open(os.path.join(OUT, 'keysites.json'), 'w'), separators=(',', ':'))
    json.dump(reported, open(os.path.join(OUT, 'reported_regions.json'), 'w'), separators=(',', ':'))
    json.dump({'years': years, 'latest': nat}, open(os.path.join(OUT, 'national.json'), 'w'), indent=1)
    for old in ('cities.geojson', 'sites.geojson', 'facilities.geojson'):
        p = os.path.join(OUT, old)
        if os.path.exists(p):
            os.remove(p)
    json.dump({'updated_at': NOW, 'sources': SOURCES,
               'method': {'far_minutes': FAR_MIN, 'catchment_km': CATCH_KM, 'who_age_year': who_year, 'age_groups': [f'{lo}-{hi if hi < 200 else "+"}' for lo, hi, _ in age_groups],
                          'attributable': {k: r2(v, 0) for k, v in attr.items()}, 'attributable_year': nat.get('attributable_year'), 'census_missing': missing},
               'national': {'year': nat['year'], 'incidence': nat['inc_num'], 'incidence_lo': (nat.get('inc_100k_lo') or 0) * nat['pop'] / 1e5 if nat.get('inc_100k_lo') else None,
                            'incidence_hi': (nat.get('inc_100k_hi') or 0) * nat['pop'] / 1e5 if nat.get('inc_100k_hi') else None, 'notified': nat['notified'], 'cdr': r2(nat['cdr'], 3),
                            'pop': nat['pop'], 'rate_100k': r2(nat_rate * 1e5, 1), 'tbhiv_pct': nat.get('tbhiv_pct')},
               'counts': {'districts': len(dists), 'facilities': len(facilities), 'towns': sum(len(d['towns']) for d in dists), 'venues': len(allv), 'hexagons': sum(len(v) for v in by_d.values())}},
              open(os.path.join(OUT, 'meta.json'), 'w'), indent=1)
    log('done')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
        json.dump({'updated_at': NOW, 'sources': SOURCES, 'error': traceback.format_exc()[-1500:]}, open(os.path.join(OUT, 'meta-error.json'), 'w'), indent=1)
        sys.exit(1)
