# One-off probe of new data sources (run in GitHub Actions; prints what is available).
import io, json, zipfile, requests
H = {'User-Agent': 'waig-atlas-probe/1.0'}
def get(u, **k):
    r = requests.get(u, headers=H, timeout=120, **k); print('GET', r.status_code, u[:140], len(r.content)); return r

print('== GSS geofiles')
try:
    r = get('https://statsbank.statsghana.gov.gh/assets/geofiles.zip')
    z = zipfile.ZipFile(io.BytesIO(r.content))
    for i in z.infolist()[:80]: print('  ', i.filename, i.file_size)
except Exception as e: print('ERR', e)

print('== GSS PxWeb')
base = 'https://statsbank.statsghana.gov.gh/api/v1/en/'
def walk(path, depth=0):
    try:
        items = get(base + path).json()
    except Exception as e:
        print('ERR', path, e); return
    for it in items:
        print('  ' * (depth + 1), it.get('type'), it.get('id'), '|', it.get('text'))
        if it.get('type') == 'l' and depth < 2 and any(k in (path + it['id']).lower() for k in ['phc', 'housing', 'poverty', 'multidimensional', 'water']):
            walk(path + it['id'] + '/', depth + 1)
walk('')

print('== WorldPop REST')
for u in ['https://hub.worldpop.org/rest/data', 'https://hub.worldpop.org/rest/data/pop', 'https://hub.worldpop.org/rest/data/age_structures']:
    try:
        j = get(u).json(); print(json.dumps(j)[:1500])
    except Exception as e: print('ERR', e)
for id_ in ['73552', '104559']:
    try:
        r = get(f'https://hub.worldpop.org/geodata/summary?id={id_}')
        import re
        print(sorted(set(re.findall(r'https://data\.worldpop\.org/[^"\']+\.tif', r.text)))[:60])
    except Exception as e: print('ERR', e)

print('== GRID3 pop tif HEAD')
try:
    r = requests.head('https://data.worldpop.org/repo/wopr/_MULT/population/GRID3_SSA2025/GRID3_SSA_pop_estimates_V1_0/gha_SSApopulation_%202025_v1_0_gridded.tif', headers=H, timeout=60, allow_redirects=True); print(r.status_code, r.headers.get('content-length'))
except Exception as e: print('ERR', e)

print('== Mendeley DHIMS extract')
try:
    files = get('https://data.mendeley.com/public-api/datasets/r3c3cr7x6g/files?folder_id=root&version=1').json()
    print(json.dumps(files)[:800])
    f = files[0]; url = f.get('content_details', {}).get('download_url')
    if url:
        t = get(url).text; print(t[:3000])
except Exception as e: print('ERR', e)

print('== WHO age sex Ghana')
try:
    import csv
    t = get('https://extranet.who.int/tme/generateCSV.asp?ds=estimates_age_sex').text
    rows = [r for r in csv.DictReader(io.StringIO(t)) if r.get('iso3') == 'GHA']
    yr = max(int(r['year']) for r in rows)
    for r in rows:
        if int(r['year']) == yr and r.get('risk_factor') == 'all': print({k: r[k] for k in ('year', 'measure', 'unit', 'age_group', 'sex', 'risk_factor', 'best')})
except Exception as e: print('ERR', e)
