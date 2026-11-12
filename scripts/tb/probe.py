# One-off probe of new data sources (run in GitHub Actions; prints what is available). v2
import json, re, requests
from urllib.parse import quote
H = {'User-Agent': 'waig-atlas-probe/1.0'}
def get(u, **k):
    r = requests.get(u, headers=H, timeout=120, **k); print('GET', r.status_code, u[:160], len(r.content)); return r

print('== PxWeb raw root'); root = get('https://statsbank.statsghana.gov.gh/api/v1/en/').json(); print(json.dumps(root)[:600])
db = next((d for d in root if 'PHC 2021' in json.dumps(d)), None); print('db', db)
dbid = db.get('dbid') or db.get('id') or db.get('text')
base = 'https://statsbank.statsghana.gov.gh/api/v1/en/' + quote(dbid) + '/'
def walk(path, depth=0):
    try: items = get(base + path).json()
    except Exception as e: print('ERR', e); return
    for it in items:
        print('  ' * (depth + 1), it.get('type'), '|', it.get('id'), '|', it.get('text'))
        if it.get('type') == 'l' and depth < 2 and re.search(r'hous|poverty|multidim|water|sanit|age|population', it.get('text', ''), re.I):
            walk(path + quote(it['id']) + '/', depth + 1)
walk('')

print('== WorldPop age structures')
for a in ['asic', 'aswpgp']:
    try:
        j = get(f'https://hub.worldpop.org/rest/data/age_structures/{a}?iso3=GHA').json()
        for d in j.get('data', [])[-6:]: print(json.dumps({k: d.get(k) for k in ('id', 'title', 'popyear', 'doi', 'files')})[:600])
    except Exception as e: print('ERR', e)
j = get('https://hub.worldpop.org/rest/data/age_structures').json(); print(json.dumps(j)[:1800])
try:
    r = get('https://hub.worldpop.org/geodata/summary?id=104559'); print(sorted(set(re.findall(r'https?://[^"\'\s<>]+', r.text)))[:80])
except Exception as e: print('ERR', e)
