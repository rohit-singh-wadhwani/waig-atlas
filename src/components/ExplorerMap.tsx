import React, { useEffect, useRef, useState } from 'react';

export const VENUE_COLORS: Record<string, string> = {
  market: '#7c3aed', 'transport hub': '#0891b2', prison: '#111827', 'mine / quarry': '#a16207',
  school: '#16a34a', 'place of worship': '#db2777', 'community centre': '#ea580c', pharmacy: '#0d9488', 'NGO office': '#4f46e5',
};
/** Sequential orange ramp for TB burden (light -> dark). */
export const TB_RAMP = ['#fef0d9', '#fdd49e', '#fdbb84', '#fc8d59', '#e34a33', '#b30000'];

/** Quantile class breaks for a choropleth. */
export function breaksFor(values: number[], classes = 6) {
  const v = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [] as number[];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) out.push(v[Math.floor((i / classes) * (v.length - 1))]);
  return Array.from(new Set(out));
}
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
// Esri World Imagery: free satellite tiles, no key; credited in the map's attribution.
const SATELLITE = { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' };
const EMPTY = { type: 'FeatureCollection', features: [] };

function step(prop: string, breaks: number[]) {
  if (!breaks.length) return TB_RAMP[2];
  const e: any[] = ['step', ['coalesce', ['get', prop], -1], TB_RAMP[0]];
  breaks.forEach((b, i) => e.push(b, TB_RAMP[Math.min(i + 1, TB_RAMP.length - 1)]));
  return e;
}

export type ExplorerMapProps = {
  districts: any | null;
  districtMetric: string;
  districtBreaks: number[];
  focusId?: string | null;            // opened district: others are dimmed
  hexes?: any | null;
  hexBreaks?: number[];
  towns?: any | null;                 // town areas (polygons)
  townBreaks?: number[];
  venues?: any | null;
  facilities?: any | null;
  picked?: string[];                  // venue keys chosen for a campaign
  focusTown?: string | null;
  selectedHexes?: string[];           // hexagons chosen for a campaign
  pins?: any | null;                  // screening points dropped by the user
  pinMode?: boolean;                  // next click inside a selected hexagon drops a pin
  onHex?: (p: any) => void;
  onPin?: (lngLat: [number, number], hex: string) => void;
  fit?: [number, number, number, number] | null;
  onDistrict?: (p: any) => void;
  onTown?: (p: any) => void;
  onVenue?: (p: any) => void;
  tooltip?: (p: any, layer: string) => string;
  satellite?: boolean;
  height?: number | string;
};

/** Map for the TB explorer: Ghana choropleth, then a district's hexagons, towns, screening spots and facilities. */
export default function ExplorerMap(p: ExplorerMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const props = useRef(p);
  props.current = p;

  useEffect(() => {
    const ml = window.maplibregl;
    if (!ml || !ref.current) return;
    const m = new ml.Map({ container: ref.current, style: BASEMAP_STYLE, bounds: [[-3.3, 4.6], [1.3, 11.2]], fitBoundsOptions: { padding: 20 }, attributionControl: { compact: true } });
    m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', className: 'tb-tip' });
    // if the basemap cannot be reached, fall back to a plain background so the data still shows
    const fallback = setTimeout(() => { if (!m.isStyleLoaded()) m.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }] }); }, 8000);
    m.on('load', () => {
      clearTimeout(fallback);
      const below = (m.getStyle().layers || []).find((l: any) => l.type === 'symbol')?.id;
      m.addSource('satellite', SATELLITE);
      m.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }, below);
      for (const id of ['districts', 'towns', 'hexes', 'townlabels', 'venues', 'facilities', 'pins']) m.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'districts' ? { promoteId: 'id' } : {}) });
      m.addLayer({ id: 'd-fill', type: 'fill', source: 'districts', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'd-line', type: 'line', source: 'districts', paint: { 'line-color': '#ffffff', 'line-width': 0.7 } }, below);
      m.addLayer({ id: 'd-focus', type: 'line', source: 'districts', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['==', ['get', 'id'], ''] }, below);
      m.addLayer({ id: 'town-fill', type: 'fill', source: 'towns', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'h-fill', type: 'fill', source: 'hexes', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'h-sel', type: 'line', source: 'hexes', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['in', ['get', 'h'], ['literal', []]] }, below);
      m.addLayer({ id: 'town-line', type: 'line', source: 'towns', paint: { 'line-color': ['case', ['get', 'focus'], '#0f172a', '#ffffff'], 'line-width': ['case', ['get', 'focus'], 3, 1.2] } }, below);
      m.addLayer({ id: 'facilities', type: 'circle', source: 'facilities', paint: { 'circle-radius': ['match', ['get', 'kind'], 'hospital', 6, 4], 'circle-color': '#1d4ed8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'town-labels', type: 'symbol', source: 'townlabels', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-anchor': 'center', 'text-optional': true }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      m.addLayer({ id: 'venues', type: 'circle', source: 'venues', paint: {
        'circle-radius': ['case', ['get', 'picked'], 9, 6],
        'circle-color': ['match', ['get', 'kind'], ...Object.entries(VENUE_COLORS).flat(), '#64748b'],
        'circle-stroke-color': ['case', ['get', 'picked'], '#0f172a', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'picked'], 3, 1.5],
      } });
      m.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 8, 'circle-color': '#dc2626', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 3 } });
      setReady(true);
    });
    const layers = ['pins', 'venues', 'facilities', 'h-fill', 'town-fill', 'd-fill'];
    m.on('mousemove', (e: any) => {
      const f = m.queryRenderedFeatures(e.point, { layers: layers.filter((l) => m.getLayer(l)) })[0];
      m.getCanvas().style.cursor = props.current.pinMode ? 'crosshair' : f ? 'pointer' : '';
      const tip = props.current.tooltip;
      if (!f || !tip) return popup.remove();
      const html = tip(f.properties, f.layer.id);
      if (!html) return popup.remove();
      popup.setLngLat(e.lngLat).setHTML(html).addTo(m);
    });
    m.on('mouseout', () => popup.remove());
    m.on('click', (e: any) => {
      const cur = props.current;
      const f = m.queryRenderedFeatures(e.point, { layers: ['venues', 'h-fill', 'town-fill', 'd-fill'].filter((l) => m.getLayer(l)) })[0];
      if (!f) return;
      if (cur.pinMode && f.layer.id === 'h-fill') {
        if ((cur.selectedHexes || []).includes(f.properties.h)) cur.onPin?.([e.lngLat.lng, e.lngLat.lat], f.properties.h);
        return;
      }
      if (f.layer.id === 'h-fill') cur.onHex?.(f.properties);
      else if (f.layer.id === 'venues') props.current.onVenue?.(f.properties);
      else if (f.layer.id === 'town-fill') props.current.onTown?.(f.properties);
      else props.current.onDistrict?.(f.properties);
    });
    map.current = m;
    return () => {
      clearTimeout(fallback);
      popup.remove();
      m.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.getSource('districts').setData(p.districts || EMPTY);
    m.getSource('hexes').setData(p.hexes || EMPTY);
    m.getSource('facilities').setData(p.facilities || EMPTY);
  }, [ready, p.districts, p.hexes, p.facilities]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const t = p.towns ? { ...p.towns, features: p.towns.features.map((f: any) => ({ ...f, properties: { ...f.properties, focus: f.properties.key === p.focusTown } })) } : EMPTY;
    m.getSource('towns').setData(t);
    m.getSource('townlabels').setData(p.towns ? { type: 'FeatureCollection', features: t.features.map((f: any) => ({ type: 'Feature', properties: { name: f.properties.name }, geometry: { type: 'Point', coordinates: [f.properties.lon, f.properties.lat] } })) } : EMPTY);
    const picked = new Set(p.picked || []);
    const v = p.venues ? { ...p.venues, features: p.venues.features.map((f: any) => ({ ...f, properties: { ...f.properties, picked: picked.has(f.properties.key) } })) } : EMPTY;
    m.getSource('venues').setData(v);
    m.getSource('pins').setData(p.pins || EMPTY);
    m.setFilter('h-sel', ['in', ['get', 'h'], ['literal', p.selectedHexes || []]]);
    m.setPaintProperty('h-fill', 'fill-opacity', (p.selectedHexes || []).length ? ['case', ['in', ['get', 'h'], ['literal', p.selectedHexes]], 0.9, 0.45] : 0.75);
  }, [ready, p.towns, p.venues, p.picked, p.focusTown, p.pins, p.selectedHexes]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setPaintProperty('d-fill', 'fill-color', step(p.districtMetric, p.districtBreaks));
    m.setPaintProperty('d-fill', 'fill-opacity', p.focusId ? ['case', ['==', ['get', 'id'], p.focusId], 0.08, 0.35] : 0.75);
    m.setFilter('d-focus', ['==', ['get', 'id'], p.focusId || '']);
    m.setPaintProperty('h-fill', 'fill-color', step('k', p.hexBreaks || []));
    m.setPaintProperty('town-fill', 'fill-color', ['case', ['==', ['get', 'nodata'], true], '#d1d5db', step('expected_km2', p.townBreaks || [])]);
    // an opened town shows its hexagons; neighbouring towns stay visible but faded
    m.setPaintProperty('town-fill', 'fill-opacity', p.focusTown ? ['case', ['==', ['get', 'key'], p.focusTown], 0, 0.28] : 0.75);
  }, [ready, p.districtMetric, p.districtBreaks, p.focusId, p.hexBreaks, p.townBreaks, p.focusTown]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    m.setLayoutProperty('satellite', 'visibility', p.satellite ? 'visible' : 'none');
  }, [ready, p.satellite]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.fit) return;
    m.fitBounds([[p.fit[0], p.fit[1]], [p.fit[2], p.fit[3]]], { padding: 30, duration: 700, maxZoom: 14 });
  }, [ready, p.fit]);

  return <div ref={ref} className="w-full h-full rounded-xl overflow-hidden border border-gray-100" style={{ height: p.height || '100%' }} />;
}

/** Bounding box of a GeoJSON geometry. */
export function bboxOf(geom: any): [number, number, number, number] | null {
  if (!geom) return null;
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c: any) => {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  walk(geom.coordinates);
  return w <= e ? [w, s, e, n] : null;
}
