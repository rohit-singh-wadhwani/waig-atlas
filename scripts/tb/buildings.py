"""Building footprints for Ghana: Google and Microsoft Open Buildings, combined and de-duplicated by VIDA
(GeoParquet partitioned by country on Source Cooperative). We keep only each building's centre point.

Used for: building density per hexagon (a crowding proxy, strongest in informal settlements), people per building,
and finding where homes actually cluster inside a hexagon when choosing a screening point.
"""
import re

import numpy as np
import pyarrow.parquet as pq
import shapely

from tblib import S, log, source

# path-style S3 address: the bucket name contains dots, which breaks the virtual-hosted (bucket.s3...) form's TLS
BUCKET = 'https://s3.us-west-2.amazonaws.com/us-west-2.opendata.source.coop'
MIRROR = 'https://data.source.coop'
PREFIX = 'vida/google-microsoft-open-buildings/geoparquet/by_country/country_iso=GHA/'
PAGE = 'https://source.coop/vida/google-microsoft-open-buildings'
PATH = '/tmp/gha_buildings.parquet'


def _ghana_files():
    """Download addresses of the Ghana partition: listed from the bucket, else the documented file name on the mirror."""
    try:
        xml = S.get(f'{BUCKET}?list-type=2&prefix={PREFIX}', timeout=60).text
        keys = re.findall(r'<Key>([^<]+\.parquet)</Key>', xml)
        if keys:
            return [f'{BUCKET}/{k}' for k in keys]
    except Exception as e:
        log('building list failed, using mirror', e)
    return [f'{MIRROR}/{PREFIX}GHA.parquet']


def load():
    """Centre points of every building in Ghana as two float arrays (lon, lat), or (None, None) if unavailable."""
    try:
        lons, lats, size = [], [], 0
        for url in _ghana_files():
            with S.get(url, stream=True, timeout=1800) as r:
                r.raise_for_status()
                with open(PATH, 'wb') as f:
                    for chunk in r.iter_content(1 << 22):
                        f.write(chunk)
                        size += len(chunk)
            pf = pq.ParquetFile(PATH)
            for batch in pf.iter_batches(columns=['geometry'], batch_size=500_000):
                geoms = shapely.from_wkb(batch.column(0).to_numpy(zero_copy_only=False))
                xy = shapely.get_coordinates(shapely.centroid(geoms))
                lons.append(xy[:, 0].astype('float32'))
                lats.append(xy[:, 1].astype('float32'))
        lon, lat = np.concatenate(lons), np.concatenate(lats)
        source('Google-Microsoft Open Buildings (combined by VIDA)', f'{BUCKET}/{PREFIX}', True, f'{len(lon):,} buildings in Ghana ({size >> 20} MB)', page=PAGE, group='Who lives where', gives='Every building footprint in Ghana (Google + Microsoft, combined by VIDA)', use='Buildings per hexagon, people per building, high density points', aurum='used')
        log('buildings', len(lon))
        return lon, lat
    except Exception as e:
        source('Google-Microsoft Open Buildings (combined by VIDA)', f'{BUCKET}/{PREFIX}', False, str(e)[:200], page=PAGE, group='Who lives where', gives='Every building footprint in Ghana', use='Buildings per hexagon, people per building, high density points', aurum='used')
        return None, None
