import React, { useEffect, useRef, useState } from 'react';
import { MAP_ICONS, iconUrl } from './mapIcons';

export const VENUE_COLORS: Record<string, string> = {
  market: '#7c3aed', 'transport hub': '#0891b2', prison: '#111827', 'mine / quarry': '#a16207', port: '#1e3a8a', 'industrial zone': '#57534e',
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
/** Optional layers a user can switch off in the layer control. */
export const LAYER_GROUPS = { campaigns: ['campaigns'], facilities: ['facilities'], venues: ['venues', 'venue-icons'], suggested: ['suggested'] } as const;
/** Gathering places drawn as icons rather than dots. */
const ICON_KINDS = ['prison', 'mine / quarry'];
export type LayerGroup = keyof typeof LAYER_GROUPS;

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
  suggested?: any | null;             // high density point of each hexagon
  campaigns?: any | null;             // a flag per campaign spot; `progress` picks green or red
  onCampaign?: (p: any) => void;
  scopeIds?: string[] | null;         // districts a previewed role covers: the rest are faded
  hidden?: LayerGroup[];
  onSuggested?: (p: any) => void;
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
    const fallback = setTimeout(() => { if (!m.isStyleLoaded()) m.setStyle({ version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf', sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#eef0f2' } }] }); }, 8000);
    // icons must be in the map's sprite before the layers that use them draw. They are named tb-… because the
    // basemap's own sprite already has icons called building, hospital and so on, which would be shown instead.
    const loadIcon = (id: string, src: string) => new Promise<void>((done) => {
      const img = new Image();
      img.onload = () => { if (!m.hasImage(id)) m.addImage(id, img, { pixelRatio: 2 }); done(); };
      img.onerror = () => done();
      img.src = src;
    });
    m.on('load', async () => {
      clearTimeout(fallback);
      await Promise.all(MAP_ICONS.map((k) => loadIcon(`tb-${k}`, iconUrl(k, 2))));
      const below = (m.getStyle().layers || []).find((l: any) => l.type === 'symbol')?.id;
      m.addSource('satellite', SATELLITE);
      m.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } }, below);
      for (const id of ['districts', 'towns', 'hexes', 'townlabels', 'venues', 'facilities', 'suggested', 'pins', 'campaigns']) m.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'districts' ? { promoteId: 'id' } : {}) });
      m.addLayer({ id: 'd-fill', type: 'fill', source: 'districts', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'd-line', type: 'line', source: 'districts', paint: { 'line-color': '#ffffff', 'line-width': 0.7 } }, below);
      m.addLayer({ id: 'd-focus', type: 'line', source: 'districts', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['==', ['get', 'id'], ''] }, below);
      m.addLayer({ id: 'town-fill', type: 'fill', source: 'towns', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'h-fill', type: 'fill', source: 'hexes', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.75 } }, below);
      m.addLayer({ id: 'h-sel', type: 'line', source: 'hexes', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['in', ['get', 'h'], ['literal', []]] }, below);
      m.addLayer({ id: 'town-line', type: 'line', source: 'towns', paint: { 'line-color': ['case', ['get', 'focus'], '#0f172a', '#ffffff'], 'line-width': ['case', ['get', 'focus'], 3, 1.2] } }, below);
      m.addLayer({ id: 'facilities', type: 'symbol', source: 'facilities', layout: {
        'icon-image': ['match', ['get', 'kind'], 'hospital', 'tb-hospital', 'tb-clinic'], 'icon-size': ['match', ['get', 'kind'], 'hospital', 0.8, 0.6], 'icon-allow-overlap': true,
      } });
      m.addLayer({ id: 'town-labels', type: 'symbol', source: 'townlabels', layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-anchor': 'center', 'text-optional': true }, paint: { 'text-color': '#0f172a', 'text-halo-color': '#fff', 'text-halo-width': 1.5 } });
      m.addLayer({ id: 'venues', type: 'circle', source: 'venues', filter: ['!', ['in', ['get', 'kind'], ['literal', ICON_KINDS]]], paint: {
        'circle-radius': ['case', ['get', 'picked'], 9, 6],
        'circle-color': ['match', ['get', 'kind'], ...Object.entries(VENUE_COLORS).flat(), '#64748b'],
        'circle-stroke-color': ['case', ['get', 'picked'], '#0f172a', '#ffffff'], 'circle-stroke-width': ['case', ['get', 'picked'], 3, 1.5],
      } });
      m.addLayer({ id: 'venue-icons', type: 'symbol', source: 'venues', filter: ['in', ['get', 'kind'], ['literal', ICON_KINDS]], layout: {
        'icon-image': ['match', ['get', 'kind'], 'prison', 'tb-prison', 'tb-mine'], 'icon-size': ['case', ['get', 'picked'], 1.15, 0.85], 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
      m.addLayer({ id: 'suggested', type: 'symbol', source: 'suggested', layout: {
        'icon-image': ['case', ['get', 'used'], 'tb-building-used', 'tb-building'], 'icon-anchor': 'bottom', 'icon-size': ['case', ['get', 'sel'], 1.1, 0.85],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
      m.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 8, 'circle-color': '#dc2626', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 3 } });
      // campaign flags stand just right of their spot, clear of a high density pin or placed pin on the same spot
      m.addLayer({ id: 'campaigns', type: 'symbol', source: 'campaigns', layout: {
        'icon-image': ['case', ['get', 'progress'], 'tb-flag-green', 'tb-flag-red'], 'icon-anchor': 'bottom-left', 'icon-offset': [17, 1],
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      } });
      setReady(true);
    });
    const layers = ['campaigns', 'pins', 'suggested', 'venue-icons', 'venues', 'facilities', 'h-fill', 'town-fill', 'd-fill'];
    m.on('mousemove', (e: any) => {
      const f = m.queryRenderedFeatures(e.point, { layers: layers.filter((l) => m.getLayer(l)) })[0];
      m.getCanvas().style.cursor = props.current.pinMode ? 'crosshair' : f ? 'pointer' : '';
      const tip = props.current.tooltip;
      if (!f || !tip) return popup.remove();
      const html = tip(f.properties, f.layer.id === 'venue-icons' ? 'venues' : f.layer.id);
      if (!html) return popup.remove();
      popup.setLngLat(e.lngLat).setHTML(html).addTo(m);
    });
    m.on('mouseout', () => popup.remove());
    m.on('click', (e: any) => {
      const cur = props.current;
      const f = m.queryRenderedFeatures(e.point, { layers: ['campaigns', 'suggested', 'venue-icons', 'venues', 'h-fill', 'town-fill', 'd-fill'].filter((l) => m.getLayer(l) && m.getLayoutProperty(l, 'visibility') !== 'none') })[0];
      if (!f) return;
      if (f.layer.id === 'campaigns') return cur.onCampaign?.(f.properties);
      if (f.layer.id === 'suggested') return cur.onSuggested?.(f.properties);
      if (cur.pinMode && f.layer.id === 'h-fill') {
        if ((cur.selectedHexes || []).includes(f.properties.h)) cur.onPin?.([e.lngLat.lng, e.lngLat.lat], f.properties.h);
        return;
      }
      if (f.layer.id === 'h-fill') cur.onHex?.(f.properties);
      else if (f.layer.id === 'venues' || f.layer.id === 'venue-icons') props.current.onVenue?.(f.properties);
      else if (f.layer.id === 'town-fill') props.current.onTown?.(f.properties);
      else props.current.onDistrict?.(f.properties);
    });
    map.current = m;
    const fit = new ResizeObserver(() => m.resize()); // the map's box changes with the layout, not only with the window
    fit.observe(ref.current);
    return () => {
      fit.disconnect();
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
    m.getSource('suggested').setData(p.suggested || EMPTY);
    m.getSource('campaigns').setData(p.campaigns || EMPTY);
  }, [ready, p.districts, p.hexes, p.facilities, p.suggested, p.campaigns]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    for (const [g, ids] of Object.entries(LAYER_GROUPS)) for (const id of ids) m.setLayoutProperty(id, 'visibility', (p.hidden || []).includes(g as LayerGroup) ? 'none' : 'visible');
  }, [ready, p.hidden]);

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
    m.setPaintProperty('d-fill', 'fill-opacity', p.focusId ? ['case', ['==', ['get', 'id'], p.focusId], 0.08, 0.35] : p.scopeIds ? ['case', ['in', ['get', 'id'], ['literal', p.scopeIds]], 0.8, 0.12] : 0.75);
    m.setFilter('d-focus', ['==', ['get', 'id'], p.focusId || '']);
    m.setPaintProperty('h-fill', 'fill-color', step('k', p.hexBreaks || []));
    m.setPaintProperty('town-fill', 'fill-color', ['case', ['==', ['get', 'nodata'], true], '#d1d5db', step('expected_km2', p.townBreaks || [])]);
    // an opened town shows its hexagons; neighbouring towns stay visible but faded
    m.setPaintProperty('town-fill', 'fill-opacity', p.focusTown ? ['case', ['==', ['get', 'key'], p.focusTown], 0, 0.28] : 0.75);
  }, [ready, p.districtMetric, p.districtBreaks, p.focusId, p.scopeIds, p.hexBreaks, p.townBreaks, p.focusTown]);

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
