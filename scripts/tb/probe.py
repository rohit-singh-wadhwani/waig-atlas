# One-off probe v3: PxWeb table metadata + GSS district shapefile fields.
import io, json, zipfile, requests
from urllib.parse import quote
H = {'User-Agent': 'waig-atlas-probe/1.0'}
B = 'https://statsbank.statsghana.gov.gh/api/v1/en/PHC%202021%20StatsBank/'
T = {'pop': 'Population/population_table2_locality2.px', 'hh': 'Population/avg_hhsize_table.px', 'sleep': 'Housing/sleep_rooms.px', 'mpi': 'Multidimensional%20Poverty/MPI_by_locality.px', 'ins': 'Population/health_insurance.px'}
for k, t in T.items():
    print('==', k)
    try:
        m = requests.get(B + t, headers=H, timeout=60).json()
        print(m.get('title'))
        for v in m['variables']:
            vals = list(zip(v['values'], v['valueTexts']))
            print('  VAR', v['code'], '|', v['text'], '| n=', len(vals), '|', vals[:6], '...', vals[-3:])
    except Exception as e: print('ERR', e)
# test query: MPI, all districts, total locality
try:
    m = requests.get(B + T['mpi'], headers=H, timeout=60).json()
    q = {'query': [], 'response': {'format': 'json-stat2'}}
    for v in m['variables']:
        if len(v['values']) > 300: continue
        sel = v['values'] if v['code'].lower().startswith(('dist', 'geo', 'reg')) or len(v['values']) <= 8 else v['values'][:1]
        q['query'].append({'code': v['code'], 'selection': {'filter': 'item', 'values': sel}})
    r = requests.post(B + T['mpi'], json=q, headers=H, timeout=120); print('MPI POST', r.status_code, r.text[:1500])
except Exception as e: print('ERR', e)
print('== shapefile')
r = requests.get('https://statsbank.statsghana.gov.gh/assets/geofiles.zip', headers=H, timeout=180)
z = zipfile.ZipFile(io.BytesIO(r.content)); inner = zipfile.ZipFile(io.BytesIO(z.read('Geo FIles/Districts_261.zip')))
print([i.filename for i in inner.infolist()])
import shapefile
shp = [n for n in inner.namelist() if n.endswith('.shp')][0]; base = shp[:-4]
sf = shapefile.Reader(shp=io.BytesIO(inner.read(base + '.shp')), dbf=io.BytesIO(inner.read(base + '.dbf')), shx=io.BytesIO(inner.read(base + '.shx')))
print('fields', sf.fields); print('n', len(sf)); print(sf.records()[:3]); print('bbox', sf.bbox)
prj = [n for n in inner.namelist() if n.endswith('.prj')]
if prj: print(inner.read(prj[0])[:400])
