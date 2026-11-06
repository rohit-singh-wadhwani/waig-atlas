import { useEffect, useState } from 'react';
import { dataUrl } from './store';
import type { Country } from './types';

export type WorldGeo = { type: 'FeatureCollection'; features: any[] };

const CDN_FALLBACKS = [
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@v5.1.2/geojson/ne_110m_admin_0_countries.geojson',
  'https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_110m_admin_0_countries.geojson',
];

let cache: Promise<{ geo: WorldGeo; countries: Country[] }> | null = null;

function normalise(raw: any): { geo: WorldGeo; countries: Country[] } {
  const features = (raw.features || []).map((f: any) => {
    const p = f.properties || {};
    const iso3 = p.iso3 || (p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3 : p.ADM0_A3 || p.ISO_A3_EH);
    return {
      type: 'Feature',
      geometry: f.geometry,
      properties: {
        iso3,
        name: p.name || p.NAME || p.ADMIN,
        region: p.region || p.CONTINENT || '',
        subregion: p.subregion || p.SUBREGION || '',
        lng: p.lng ?? p.LABEL_X,
        lat: p.lat ?? p.LABEL_Y,
      },
    };
  });
  const countries: Country[] = features
    .map((f: any) => f.properties)
    .filter((p: any) => p.iso3 && p.name)
    .map((p: any) => ({ iso3: p.iso3, name: p.name, region: p.region, subregion: p.subregion, lng: p.lng, lat: p.lat }))
    .sort((a: Country, b: Country) => a.name.localeCompare(b.name));
  return { geo: { type: 'FeatureCollection', features }, countries };
}

export function loadWorld() {
  if (!cache) {
    cache = (async () => {
      for (const url of [dataUrl('world.geojson'), ...CDN_FALLBACKS]) {
        try {
          const r = await fetch(url);
          if (r.ok) return normalise(await r.json());
        } catch {
          /* try next */
        }
      }
      return { geo: { type: 'FeatureCollection', features: [] } as WorldGeo, countries: [] };
    })();
  }
  return cache;
}

export function useWorld() {
  const [w, setW] = useState<{ geo: WorldGeo; countries: Country[] } | null>(null);
  useEffect(() => {
    loadWorld().then(setW);
  }, []);
  return w;
}

export const NO_COUNTRIES: Country[] = [];

export const REGIONS = ['Africa', 'Asia', 'Europe', 'North America', 'South America', 'Oceania'];
