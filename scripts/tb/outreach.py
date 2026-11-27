"""Places partner outreach returns on the map.

Outreach reports (shared by partners, stored members-only in Supabase) name the communities visited, not
coordinates. Each run looks every community up in the same OpenStreetMap snapshot as the rest of the pipeline,
inside the reporting directorate's own district first, then within a margin around it (a metro directorate's
report can reach communities just over a 2019 district line), and writes the location back with how it was found:
  exact    an OpenStreetMap place (town, suburb, neighbourhood, quarter, locality) with the same name
  close    a place whose name differs by a letter or two (a spelling variant)
  feature  no place, but a mapped feature named after the community (e.g. "Ketan Cluster of Schools");
           the community is near it, its exact centre is not mapped
Nothing is guessed beyond that: communities not found keep no coordinates and the app lists them as unmapped.
"""
import difflib
import re

import h3
from shapely.geometry import Point

from tblib import NOW, SB_KEY, SB_URL, S, log, r2, source

MARGIN_DEG = 0.045   # ~5 km around the directorate's district
CLOSE = 0.85         # similarity for a spelling variant


def _key(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def _rest(path, method='get', **kw):
    r = S.request(method, f'{SB_URL}/rest/v1/{path}', timeout=60,
                  headers={'apikey': SB_KEY, 'authorization': f'Bearer {SB_KEY}', 'content-type': 'application/json', **kw.pop('headers', {})}, **kw)
    r.raise_for_status()
    return r.json() if r.text else None


def _find(name, places, features):
    """Best OpenStreetMap match for a community name: (row, how) or (None, None)."""
    k = _key(name)
    names = lambda p: [p['name'], *p.get('alt', [])]
    exact = [p for p in places if any(_key(n) == k for n in names(p))]
    if exact:
        return exact[0], 'exact'
    close = sorted(((max(difflib.SequenceMatcher(None, k, _key(n)).ratio() for n in names(p)), p) for p in places), key=lambda x: -x[0])
    if close and close[0][0] >= CLOSE:
        return close[0][1], 'close'
    named = [f for f in features if re.match(rf'{re.escape(name)}\b', f.get('name') or '', re.I)]
    if named:
        return named[0], 'feature'
    return None, None


NAME = 'Partner community outreach returns'


def locate(*a):
    """Look up every outreach community in OpenStreetMap and save its location to Supabase. A failure here is logged
    on the Data sources page and never stops the rest of the run."""
    try:
        _locate(*a)
    except Exception as e:  # noqa: BLE001
        log('outreach failed', e)
        source(NAME, f'{SB_URL}/rest/v1/tb_outreach', False, f'Could not place the outreach communities this run: {str(e)[:160]}', group='TB numbers', aurum='shared')


def _locate(places, features, dists, which, near, people_within, hex_res, catch_km):
    if not SB_KEY:
        log('outreach: no Supabase key, skipped')
        return
    sites = _rest('tb_outreach_sites?select=id,directorate_id,community')
    if not sites:
        return
    by_id = {d['id']: d for d in dists}
    out, found = [], 0
    for s in sites:
        d = by_id.get(s['directorate_id'])
        p, how = None, None
        # the directorate's own district first: a namesake just over the line (e.g. a village in the next district)
        # only counts when nothing in the district carries the name
        for area in ([d['geom'], d['geom'].buffer(MARGIN_DEG)] if d else []):
            w, so, e, n = area.bounds
            inside = lambda r, a=area: w <= r['lon'] <= e and so <= r['lat'] <= n and a.contains(Point(r['lon'], r['lat']))
            p, how = _find(s['community'], [x for x in places if inside(x)], [x for x in features if inside(x)])
            if p:
                break
        row = {'id': s['id'], 'directorate_id': s['directorate_id'], 'community': s['community'], 'located_at': NOW, 'lon': None, 'lat': None, 'osm_name': None, 'osm_place': None, 'match': None, 'district_id': None,
               'district_name': None, 'hex': None, 'pop_1km': None, 'facility': None, 'facility_km': None, 'walk_min': None,
               'note': None if p else 'Not found in OpenStreetMap near this directorate'}
        if p:
            found += 1
            k = which(p['lon'], p['lat'])
            nr = near([p['lon']], [p['lat']])
            row.update(lon=round(p['lon'], 5), lat=round(p['lat'], 5), osm_name=p['name'], osm_place=p.get('place') or p.get('kind'), match=how,
                       district_id=dists[k]['id'] if k is not None else None, district_name=dists[k]['name'] if k is not None else None,
                       hex=h3.latlng_to_cell(p['lat'], p['lon'], hex_res), pop_1km=round(people_within(p['lon'], p['lat'], catch_km)),
                       facility=nr['fname'][0], facility_km=r2(nr['fkm'][0], 2), walk_min=r2(nr['fmin'][0], 0))
        out.append(row)
        if p:
            log('outreach', s['community'], how, p['name'])
        else:  # the nearest names, to check by hand whether OpenStreetMap knows it under another spelling
            margin = d['geom'].buffer(MARGIN_DEG) if d else None
            near_names = sorted({x['name'] for x in places if margin is not None and margin.contains(Point(x['lon'], x['lat']))},
                                key=lambda n: -difflib.SequenceMatcher(None, _key(s['community']), _key(n)).ratio())[:5]
            log('outreach', s['community'], 'not found; nearest names:', near_names)
    _rest('tb_outreach_sites', 'post', json=out, headers={'prefer': 'resolution=merge-duplicates'})
    source(NAME, f'{SB_URL}/rest/v1/tb_outreach', True,
           f'{len(sites)} communities named in the returns; {found} located in OpenStreetMap', page='https://www.auruminstitute.org/', group='TB numbers',
           gives='Monthly people screened, presumed, tested, positive and started on treatment, by community (members only)',
           use='The Sekondi-Takoradi campaigns, their spots on the map and their daily reports', aurum='shared')
