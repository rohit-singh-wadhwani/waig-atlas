import React, { useEffect, useRef, useState } from 'react';

/** Sequential orange ramp for TB burden (light -> dark). */
export const TB_RAMP = ['#fef0d9', '#fdd49e', '#fdbb84', '#fc8d59', '#e34a33', '#b30000'];
export const SITE_COLORS: Record<string, string> = { market: '#7c3aed', 'transport hub': '#0891b2', prison: '#111827', 'mine / quarry': '#a16207' };
const BASEMAP = 'https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png';

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

export type TbMapProps = {
  districts?: any | null; // FeatureCollection
  hexes?: any | null;
  facilities?: any | null;
  sites?: any | null;
  metric: string;
  breaks: number[];
  selectedId?: string | null;
  highlight?: [number, number] | null; // ring around a chosen venue
  onSelect?: (props: any) => void;
  onSelectHex?: (props: any) => void;
  selectedHexes?: string[];
  tooltip?: (props: any, layer: 'district' | 'hex' | 'facility' | 'site') => string;
  fit?: [number, number, number, number] | null; // [w, s, e, n]
  height?: number;
};

/** MapLibre map for the TB pages: district choropleth, city hexagons, health facilities and screening venues. */
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
      style: {
        version: 8,
        sources: { base: { type: 'raster', tiles: [BASEMAP], tileSize: 256, attribution: '© OpenStreetMap contributors © CARTO' } },
        layers: [{ id: 'base', type: 'raster', source: 'base' }],
      },
      bounds: [[-3.3, 4.6], [1.3, 11.2]],
      fitBoundsOptions: { padding: 20 },
      attributionControl: { compact: true },
      cooperativeGestures: false,
    });
    m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    const popup = new ml.Popup({ closeButton: false, closeOnClick: false, maxWidth: '300px', className: 'tb-tip' });
    m.on('load', () => {
      const empty = { type: 'FeatureCollection', features: [] };
      for (const id of ['districts', 'hexes', 'facilities', 'sites', 'highlight']) m.addSource(id, { type: 'geojson', data: empty, ...(id === 'districts' || id === 'hexes' ? { promoteId: id === 'districts' ? 'id' : 'h3' } : {}) });
      m.addLayer({ id: 'd-fill', type: 'fill', source: 'districts', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.72 } });
      m.addLayer({ id: 'd-line', type: 'line', source: 'districts', paint: { 'line-color': '#ffffff', 'line-width': 0.6 } });
      m.addLayer({ id: 'd-sel', type: 'line', source: 'districts', paint: { 'line-color': '#0f172a', 'line-width': 2.5 }, filter: ['==', ['get', 'id'], ''] });
      m.addLayer({ id: 'h-fill', type: 'fill', source: 'hexes', paint: { 'fill-color': TB_RAMP[1], 'fill-opacity': 0.78 } });
      m.addLayer({ id: 'h-line', type: 'line', source: 'hexes', paint: { 'line-color': '#ffffff', 'line-width': 0.4 } });
      m.addLayer({ id: 'h-sel', type: 'line', source: 'hexes', paint: { 'line-color': '#0f172a', 'line-width': 2 }, filter: ['in', ['get', 'h3'], ['literal', []]] });
      m.addLayer({ id: 'facilities', type: 'circle', source: 'facilities', paint: { 'circle-radius': ['match', ['get', 'kind'], 'hospital', 4.5, 3], 'circle-color': ['match', ['get', 'kind'], 'hospital', '#1d4ed8', '#60a5fa'], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1 } });
      m.addLayer({ id: 'sites', type: 'circle', source: 'sites', paint: { 'circle-radius': ['interpolate', ['linear'], ['coalesce', ['get', 'pop_1km'], 0], 0, 4, 20000, 6, 80000, 10], 'circle-color': ['match', ['get', 'kind'], 'market', SITE_COLORS.market, 'transport hub', SITE_COLORS['transport hub'], 'prison', SITE_COLORS.prison, SITE_COLORS['mine / quarry']], 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
      m.addLayer({ id: 'highlight', type: 'circle', source: 'highlight', paint: { 'circle-radius': 16, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#0f172a', 'circle-stroke-width': 3 } });
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
    m.setFilter('d-sel', ['==', ['get', 'id'], p.selectedId || '']);
    m.setFilter('h-sel', ['in', ['get', 'h3'], ['literal', p.selectedHexes || []]]);
    m.getSource('highlight').setData({ type: 'FeatureCollection', features: p.highlight ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p.highlight } }] : [] });
  }, [ready, p.metric, p.breaks, p.selectedId, p.selectedHexes, p.highlight, p.hexes]);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m || !p.fit) return;
    m.fitBounds([[p.fit[0], p.fit[1]], [p.fit[2], p.fit[3]]], { padding: 24, duration: 600 });
  }, [ready, p.fit]);

  return <div ref={ref} className="w-full rounded-xl overflow-hidden border border-gray-100" style={{ height: p.height || 520 }} />;
}

export function TbLegend({ title, breaks, fmt, sites }: { title: string; breaks: number[]; fmt: (v: number) => string; sites?: boolean }) {
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
      {sites && Object.entries(SITE_COLORS).map(([k, c]) => (
        <span key={k} className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full border-2 border-white shadow" style={{ background: c }} />{k}</span>
      ))}
    </div>
  );
}
