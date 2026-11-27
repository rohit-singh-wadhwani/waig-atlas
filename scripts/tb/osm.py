"""OpenStreetMap for Ghana from one Geofabrik snapshot (updated daily), parsed with pyosmium.

One file means every OpenStreetMap layer in a run comes from the same moment, instead of separate Overpass
queries whose answers depended on which server replied. Returns:
  facilities  clinics, hospitals, health posts, labs (with ownership where tagged)
  sites       congregate and occupational exposure: markets, lorry stations, prisons, mines and quarries,
              ports, industrial zones
  places      named cities, towns, suburbs, villages, hamlets, plus neighbourhoods, quarters and localities
              (these last three only name places, e.g. for outreach returns; they do not become town areas)
  venues      community gathering places: schools, places of worship, community centres, pharmacies, NGO offices
  roads       points along motorable roads and tracks (for snapping suggested screening points to a road)
"""
import os
import re
import time
from array import array

import numpy as np
import osmium

from tblib import S, log, source

PBF_URL = 'https://download.geofabrik.de/africa/ghana-latest.osm.pbf'
PBF_PAGE = 'https://download.geofabrik.de/africa/ghana.html'
PBF_PATH = '/tmp/ghana-latest.osm.pbf'

HEALTH_AMENITY = {'hospital', 'clinic', 'doctors', 'health_post'}
HEALTH_CARE = {'hospital', 'clinic', 'centre', 'laboratory', 'doctor'}
COMMUNITY = {'school': 'school', 'place_of_worship': 'place of worship', 'community_centre': 'community centre', 'pharmacy': 'pharmacy'}
PLACES = {'city', 'town', 'suburb', 'village', 'hamlet'}  # become town areas
LOCALITIES = {'neighbourhood', 'quarter', 'locality'}
# roads a screening team can reach by vehicle or motorbike
ROADS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track',
         'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
OWNER = {'public': 'public', 'government': 'public', 'private': 'private', 'religious': 'faith-based', 'community': 'community', 'ngo': 'NGO'}


def _site_kind(t):
    if t.get('amenity') == 'marketplace':
        return 'market'
    if t.get('amenity') == 'bus_station' or t.get('highway') == 'bus_station':
        return 'transport hub'
    if t.get('amenity') == 'prison':
        return 'prison'
    if t.get('landuse') == 'quarry' or t.get('industrial') == 'mine' or t.get('man_made') == 'mineshaft':
        return 'mine / quarry'
    if t.get('landuse') == 'port' or t.get('industrial') == 'port' or t.get('harbour') == 'yes':
        return 'port'
    if t.get('landuse') == 'industrial':
        return 'industrial zone'
    return None


class _Handler(osmium.SimpleHandler):
    def __init__(self):
        super().__init__()
        self.facilities, self.sites, self.places, self.venues = [], [], [], []
        self.road_lon, self.road_lat = array('d'), array('d')  # compact: millions of points

    def _take(self, t, lon, lat):
        name = t.get('name') or ''
        amen, care = t.get('amenity'), t.get('healthcare')
        if amen in HEALTH_AMENITY or care in HEALTH_CARE:
            kind = amen if amen in HEALTH_AMENITY else ('clinic' if care == 'centre' else care)
            self.facilities.append({'lon': lon, 'lat': lat, 'kind': kind, 'name': name,
                                    'lab': care == 'laboratory' or 'laboratory' in (t.get('healthcare:speciality') or ''),
                                    'own': OWNER.get((t.get('operator:type') or '').lower())})
            return
        site = _site_kind(t)
        if site:
            self.sites.append({'lon': lon, 'lat': lat, 'kind': site, 'name': name})
            return
        if amen in COMMUNITY or t.get('office') == 'ngo':
            self.venues.append({'lon': lon, 'lat': lat, 'kind': 'NGO office' if t.get('office') == 'ngo' else COMMUNITY[amen], 'name': name})

    def node(self, n):
        t = n.tags
        if not len(t):
            return
        if (t.get('place') in PLACES or t.get('place') in LOCALITIES) and t.get('name'):
            self.places.append({'lon': n.location.lon, 'lat': n.location.lat, 'name': t['name'], 'place': t['place']})
            return
        self._take(dict(t), n.location.lon, n.location.lat)

    def way(self, w):
        t = w.tags
        if not len(t):
            return
        try:
            locs = [(nd.location.lon, nd.location.lat) for nd in w.nodes if nd.location.valid()]
        except osmium.InvalidLocationError:
            return
        if not locs:
            return
        if t.get('highway') in ROADS:
            for lon, lat in locs:
                self.road_lon.append(lon)
                self.road_lat.append(lat)
            return
        xs, ys = zip(*locs)
        self._take(dict(t), sum(xs) / len(xs), sum(ys) / len(ys))


def _download():
    """Fetch the latest snapshot, retrying when Geofabrik is briefly unreachable. If every try fails, the previous
    snapshot restored from the CI cache is used and the source log says so. Returns a note for that log."""
    err = None
    for wait in (0, 30, 90, 180):
        time.sleep(wait)
        try:
            with S.get(PBF_URL, stream=True, timeout=900) as r:
                r.raise_for_status()
                with open(PBF_PATH + '.part', 'wb') as f:
                    for chunk in r.iter_content(1 << 20):
                        f.write(chunk)
            os.replace(PBF_PATH + '.part', PBF_PATH)  # a broken download never replaces the cached copy
            return ''
        except Exception as e:
            err = e
            log('Geofabrik download failed, retrying', str(e)[:160])
    if os.path.exists(PBF_PATH):
        day = time.strftime('%Y-%m-%d', time.gmtime(os.path.getmtime(PBF_PATH)))
        return f'Geofabrik unreachable this run; used the cached snapshot from {day}. '
    raise err


SAME_KM = 0.3  # one named place mapped twice (a point and a building outline, or two mappers) lies within this distance


def dedup(rows):
    """One row per feature: drops exact repeats (same kind, ~10 m) and named repeats (same kind and name within SAME_KM)."""
    seen, kept, out = set(), {}, []
    for r in rows:
        k = (r.get('kind'), round(r['lon'], 4), round(r['lat'], 4))
        if k in seen:
            continue
        seen.add(k)
        name = re.sub(r'[^a-z0-9]+', ' ', (r.get('name') or '').lower()).strip()
        if name:
            near = kept.setdefault((r.get('kind'), name), [])
            c = np.cos(np.radians(r['lat']))
            if any(((r['lon'] - x) * c) ** 2 + (r['lat'] - y) ** 2 < (SAME_KM / 111.32) ** 2 for x, y in near):
                continue
            near.append((r['lon'], r['lat']))
        out.append(r)
    return out


def load():
    note = _download()
    h = _Handler()
    h.apply_file(PBF_PATH, locations=True, idx='flex_mem')
    facilities, sites, places, venues = dedup(h.facilities), dedup(h.sites), dedup(h.places), dedup(h.venues)
    roads = np.c_[np.frombuffer(h.road_lon, dtype='float64'), np.frombuffer(h.road_lat, dtype='float64')] if len(h.road_lon) else np.zeros((0, 2))
    size = os.path.getsize(PBF_PATH) // (1 << 20)
    source('OpenStreetMap (Geofabrik Ghana snapshot)', PBF_URL, True,
           f'{note}{size} MB: {len(facilities)} health facilities, {len(sites)} congregate and occupational sites, {len(places)} named places, '
           f'{len(venues)} community venues, {len(roads):,} road points', page=PBF_PAGE, group='Places and access',
           gives='Health facilities, towns and villages, markets, lorry stations, ports, industrial zones, prisons, mines, schools, places of worship, roads',
           use='Town areas, gathering places, key populations, road snapping', aurum='used')
    log('osm', {k: sum(1 for s in sites if s['kind'] == k) for k in {s['kind'] for s in sites}})
    return facilities, sites, places, venues, roads
