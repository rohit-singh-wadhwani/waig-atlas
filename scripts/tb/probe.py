import json, re, requests
S = requests.Session(); S.headers['user-agent'] = 'atlas-data-pipeline/1.0'
def show(name, fn):
    print(f"\n===== {name}")
    try: fn()
    except Exception as e: print("ERROR", type(e).__name__, str(e)[:300])
def gb():
    for lvl in ['ADM1','ADM2']:
        j = S.get(f'https://www.geoboundaries.org/api/current/gbOpen/GHA/{lvl}/', timeout=60).json()
        print(lvl, {k: j.get(k) for k in ['boundaryYearRepresented','admUnitCount','boundarySource','gjDownloadURL','simplifiedGeometryGeoJSON']})
def wp():
    for ds in ['wpgp1km', 'cic2020_UNadj_100m', 'wpgpunadj', 'cic2020_100m']:
        r = S.get(f'https://www.worldpop.org/rest/data/pop/{ds}?iso3=GHA', timeout=60)
        j = r.json(); d = j.get('data') or []
        print(ds, r.status_code, len(d), [ (x.get('popyear'), (x.get('files') or [None])[0]) for x in d[-3:]])
def rwi():
    j = S.get('https://data.humdata.org/api/3/action/package_show?id=relative-wealth-index', timeout=60).json()
    res = j['result']['resources']; print(len(res), [ (r['name'], r['url']) for r in res if 'gha' in (r['name']+r['url']).lower()][:5])
def dhs():
    j = S.get('https://api.dhsprogram.com/rest/dhs/surveys?countryIds=GH&f=json', timeout=60).json()
    print([ (s['SurveyId'], s['SurveyYear']) for s in j['Data']])
    for sid in ['GH2022DHS','GH2014DHS']:
        k = S.get(f'https://api.dhsprogram.com/rest/dhs/indicators?countryIds=GH&surveyIds={sid}&f=json&perpage=5000', timeout=120).json()
        rows = k['Data']; print(sid, len(rows))
        for r in rows:
            if re.search(r'HIV prevalence among women and men|thin|BMI.*18|smok|tobacco|diabet|alcohol|clean fuel|solid fuel|persons per sleeping|crowd', r['Label'], re.I): print('  ', r['IndicatorId'], '|', r['Label'][:110])
    d = S.get('https://api.dhsprogram.com/rest/dhs/data?countryIds=GH&surveyIds=GH2022DHS&indicatorIds=AN_NUTS_W_THN&breakdown=subnational&f=json', timeout=60).json()
    print('sample', [(x['CharacteristicLabel'], x['Value'], x.get('RegionId')) for x in d['Data']][:20])
def who():
    for ds in ['estimates','notifications']:
        r = S.get(f'https://extranet.who.int/tme/generateCSV.asp?ds={ds}', timeout=120)
        lines = r.text.splitlines(); print(ds, r.status_code, len(lines), lines[0][:400])
        g = [l for l in lines if ',GHA,' in l]; print(' GHA rows', len(g), g[-1][:300] if g else '')
def osm():
    q = '[out:json][timeout:120];area["ISO3166-1"="GH"][admin_level=2]->.a;(nwr["amenity"~"^(hospital|clinic|doctors|health_post)$"](area.a);nwr["healthcare"~"^(hospital|clinic|centre|laboratory|doctor)$"](area.a););out count;'
    for url in ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']:
        r = S.post(url, data={'data': q}, timeout=180); print(url, r.status_code, r.text[:300])
def mapacc():
    for u in ['https://data.malariaatlas.org/geoserver/Accessibility/ows?service=WCS&version=2.0.1&request=GetCapabilities',
              'https://data.malariaatlas.org/geoserver/ows?service=WCS&version=2.0.1&request=GetCapabilities']:
        r = S.get(u, timeout=60)
        print(u, r.status_code, len(r.text), re.findall(r'<wcs:CoverageId>([^<]*ccess[^<]*)</wcs:CoverageId>', r.text)[:20])
def hdxpop():
    j = S.get('https://data.humdata.org/api/3/action/package_show?id=cod-ps-gha', timeout=60).json()
    print([ (r['name'], r['url']) for r in j['result']['resources']][:6])
for n, f in [('geoBoundaries', gb), ('WorldPop', wp), ('RWI', rwi), ('DHS', dhs), ('WHO TB', who), ('OSM', osm), ('MAP accessibility', mapacc), ('HDX COD-PS', hdxpop)]: show(n, f)
