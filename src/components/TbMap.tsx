import React, { useEffect, useRef, useState } from 'react';

/** Sequential orange ramp for TB burden (light -> dark). Blind spots use a red hatch on top. */
export const TB_RAMP = ['#fef0d9', '#fdd49e', '#fdbb84', '#fc8d59', '#e34a33', '#b30000'];
export const BLIND_RED = '#c81e1e';
// OpenFreeMap: free OpenStreetMap vector basemap, no API key or usage limits. Place names are drawn above our data.
const BASEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

export function breaksFor(values: number[], classes = 6) {
  const v = values.filter((x) => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [] as number[];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) out.push(v[Math.floor((i / classes) * (v.length - 1))]);
  return Array.from(new Set(out));
}

function stepExpr(prop: string, breaks: number[]) {
  if (!breaks.length) return TB_RAMP[2];
  const e: any[] = ['step', ['coalesce', ['get', prop], -1], TB_RAMP[0]];
  breaks.forEach((b, i) => e.push(b, TB_RAMP[Math.min(i + 1, TB_RAMP.length - 1)]));
  return e;
}

function hatchImage() {
  const size = 10;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = BLIND_RED;
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(0, size);
  g.lineTo(size, 0);
  g.moveTo(-size / 2, size / 2);
  g.lineTo(size / 2, -size / 2);
  g.moveTo(size / 2, size * 1.5);
  g.lineTo(size * 1.5, size / 2);
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

export type TbMapProps = {
  districts?: any | null; // FeatureCollection
  hexes?: any | null;
  facilities?: any | null;
  sites?: any | null;
  metric: string;
  breaks: number[];
  blindThreshold?: number | null; // hatch districts with blind >= this
  selectedId?: string | null;
  flows?: { lon: number; lat: number; share: number; name: string }[];
  flowFrom?: [number, number] | null;
  onSelect?: (props: any) => void;
  onSelectHex?: (props: any) => void;
  selectedHexes?: string[];
  tooltip?: (props: any, layer: 'district' | 'hex' | 'facility' | 'site') => string;
  fit?: [number, number, number, number] | null; // [w, s, e, n]
  height?: number;
};

/** MapLibre map for the TB pages: district choropleth, city hexagons, facilities, congregate sites, blind-spot hatching and travel links. */
export default function TbMap(p: TbMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const props = useRef(p);
  props.current = p;

  useEffect(() => {
    const ml = window.maplibregl;
    if (!ml || !ref.current) return;
    const m = new ml.Map({
      container: ref.current,
      style: BASEMAP_STYLE,
      bounds: [[-3.3, 4.6], [1.3, 11.2]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', className: 'tb-tip' });
    m.on('load', () => {
      m.addImage('hatch', hatchImage(), { pixelRatio: 2 });
      const empty = { type: 'FeatureCollection', features: [] };
      const below = (m.getStyle().layers || []).find((l: any) => l.type === 'symbol')?.id;
      for (const id of ['districts', 'hexes', 'facilities', 'sites', 'flows']) m.addSource(id, { type: 'geojson', data: empty, ...(id === 'districts' || id === 'hexes' ? { promoteId: id === 'districts' ? 'id' : 'h3' } : {}) });
      m.addLayer({ id: 'd-fill', type: 'fill', source: 'districts', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.72 } }, below);
      m.addLayer({ id: 'd-hatch', type: 'fill', source: 'districts', paint: { 'fill-pattern': 'hatch', 'fill-opacity': 0.9 }, filter: ['==', ['get', 'id'], '__none__'] }, below);
      m.addLayer({ id: 'd-line', type: 'line', source: 'districts', paint: { 'line-color': '#ffffff', 'line-width': 0.6 } }, below);
      m.addLayer({ id: 'd-sel', type: 'line', source: 'districts', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['==', ['get', 'id'], ''] }, below);
      m.addLayer({ id: 'h-fill', type: 'fill', source: 'hexes', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.78 } }, below);
      m.addLayer({ id: 'h-line', type: 'line', source: 'hexes', paint: { 'line-color': '#ffffff', 'line-width': 0.4 } }, below);
      m.addLayer({ id: 'h-sel', type: 'line', source: 'hexes', paint: { 'line-color': '#0f172a', 'line-width': 2 }, filter: ['in', ['get', 'h3'], ['literal', []]] }, below);
      m.addLayer({ id: 'flows', type: 'line', source: 'flows', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#1e3a8a', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['get', 'share'], 0, 1.5, 0.3, 6], 'line-dasharray': [2, 1.5] } });
      m.addLayer({ id: 'sites', type: 'circle', source: 'sites', paint: { 'circle-radius': 4, 'circle-color': ['match', ['get', 'kind'], 'market', '#7c3aed', 'transport hub', '#0891b2', 'prison', '#111827', '#a16207'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5 } });
      m.addLayer({ id: 'facilities', type: 'circle', source: 'facilities', paint: { 'circle-radius': ['match', ['get', 'kind'], 'hospital', 5, 3.5], 'circle-color': ['match', ['get', 'kind'], 'hospital', '#1d4ed8', '#60a5fa'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2 } });
      setReady(true);
    });
    const layerOf: Record<string, 'district' | 'hex' | 'facility' | 'site'> = { facilities: 'facility', sites: 'site', 'h-fill': 'hex', 'd-fill': 'district' };
    m.on('mousemove', (e: any) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['facilities', 'sites', 'h-fill', 'd-fill'].filter((l) => m.getLayer(l)) })[0];
      m.getCanvas().style.cursor = f ? 'pointer' : '';
      const tip = props.current.tooltip;
      if (!f || !tip) return popup.remove();
      popup.setLngLat(e.lngLat).setHTML(tip(f.properties, layerOf[f.layer.id])).addTo(m);
    });
    m.on('mouseout', () => popup.remove());
    m.on('click', (e: any) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ['h-fill', 'd-fill'].filter((l) => m.getLayer(l)) })[0];
      if (!f) return;
      if (f.layer.id === 'h-fill') props.current.onSelectHex?.(f.properties);
      else props.current.onSelect?.(f.properties);
    });
    map.current = m;
    return () => {
      popup.remove();
      m.remove();
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const empty = { type: 'FeatureCollection', features: [] };
    m.getSource('districts').setData(p.districts || empty);
    m.getSource('hexes').setData(p.hexes || empty);
    m.getSource('facilities').setData(p.facilities || empty);
    m.getSource('sites').setData(p.sites || empty);
  }, [ready, p.districts, p.hexes, p.facilities, p.sites]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    const target = p.hexes?.features?.length ? 'h-fill' : 'd-fill';
    m.setPaintProperty(target, 'fill-color', stepExpr(p.metric, p.breaks));
    m.setPaintProperty('d-fill', 'fill-opacity', p.hexes?.features?.length ? 0.15 : 0.72);
    m.setFilter('d-hatch', p.blindThreshold != null ? ['>=', ['coalesce', ['get', 'blind'], 0], p.blindThreshold] : ['==', ['get', 'id'], '__none__']);
    m.setFilter('d-sel', ['==', ['get', 'id'], p.selectedId || '']);
    m.setFilter('h-sel', ['in', ['get', 'h3'], ['literal', p.selectedHexes || []]]);
    const flows = p.flowFrom && p.flows?.length
      ? { type: 'FeatureCollection', features: p.flows.map((f) => ({ type: 'Feature', properties: { share: f.share, name: f.name }, geometry: { type: 'LineString', coordinates: [p.flowFrom, [f.lon, f.lat]] } })) }
      : { type: 'FeatureCollection', features: [] };
    m.getSource('flows').setData(flows);
  }, [ready, p.metric, p.breaks, p.blindThreshold, p.selectedId, p.selectedHexes, p.flows, p.flowFrom, p.hexes]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.fit) return;
    m.fitBounds([[p.fit[0], p.fit[1]], [p.fit[2], p.fit[3]]], { padding: 24, duration: 600 });
  }, [ready, p.fit]);

  return <div ref={ref} className="w-full rounded-xl overflow-hidden border border-gray-100" style={{ height: p.height || 520 }} />;
}

export function TbLegend({ title, breaks, fmt, blind }: { title: string; breaks: number[]; fmt: (v: number) => string; blind?: boolean }) {
  const labels = breaks.length ? [`< ${fmt(breaks[0])}`, ...breaks.slice(0, -1).map((b, i) => `${fmt(b)}–${fmt(breaks[i + 1])}`), `> ${fmt(breaks[breaks.length - 1])}`] : [];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600 mt-3">
      <span className="font-medium text-gray-700">{title}</span>
      {labels.map((l, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-sm" style={{ background: TB_RAMP[Math.min(i, TB_RAMP.length - 1)] }} />
          {l}
        </span>
      ))}
      {blind && (
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3.5 h-3.5 rounded-sm border" style={{ borderColor: BLIND_RED, background: `repeating-linear-gradient(135deg, ${BLIND_RED} 0 2px, transparent 2px 5px)` }} />
          Blind spot: little or no visibility
        </span>
      )}
    </div>
  );
}
