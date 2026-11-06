import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldGeo } from '../lib/world';

declare global {
  interface Window {
    maplibregl?: any;
  }
}

export type MapPoint = { id: string; lng: number; lat: number; size?: number; color?: string; label: string; sub?: string };

// Sequential teal ramp (light -> dark) for magnitude.
export const RAMP = ['#d8eeef', '#a9d6d7', '#74b7b8', '#3e8a8b', '#285a5b', '#173536'];
const NO_DATA = '#f6f7f8';

export function quantileBreaks(values: number[], classes = 6): number[] {
  const v = values.filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < classes; i++) out.push(v[Math.floor((i / classes) * (v.length - 1))]);
  return Array.from(new Set(out));
}

export function colorFor(value: number | undefined, breaks: number[]) {
  if (value === undefined || value === null || !isFinite(value)) return NO_DATA;
  let i = 0;
  while (i < breaks.length && value > breaks[i]) i++;
  return RAMP[Math.min(i, RAMP.length - 1)];
}

export default function WorldMap({
  geo, values, valueLabel = (v: number) => v.toLocaleString('en-GB'), points = [], selected, onCountryClick, onPointClick, height = 460, legendTitle, globe = true,
}: {
  geo: WorldGeo | null;
  values?: Record<string, number>;
  valueLabel?: (v: number) => string;
  points?: MapPoint[];
  selected?: string | null;
  onCountryClick?: (iso3: string) => void;
  onPointClick?: (id: string) => void;
  height?: number;
  legendTitle?: string;
  globe?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const popup = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef({ onCountryClick, onPointClick, valueLabel, values });
  cb.current = { onCountryClick, onPointClick, valueLabel, values };

  const breaks = useMemo(() => quantileBreaks(Object.values(values || {})), [values]);

  const coloured = useMemo(() => {
    if (!geo) return null;
    return {
      type: 'FeatureCollection',
      features: geo.features.map((f: any) => ({
        ...f,
        properties: { ...f.properties, fill: values ? colorFor(values[f.properties.iso3], breaks) : '#d5dade', sel: f.properties.iso3 === selected ? 1 : 0 },
      })),
    };
  }, [geo, values, breaks, selected]);

  const pointGeo = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: points
        .filter((p) => isFinite(p.lng) && isFinite(p.lat))
        .map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lng, p.lat] }, properties: { id: p.id, size: p.size ?? 8, color: p.color ?? '#eb6834', label: p.label, sub: p.sub ?? '' } })),
    }),
    [points]
  );

  useEffect(() => {
    const ml = window.maplibregl;
    if (!ml || !el.current) {
      setFailed(true);
      return;
    }
    const m = new ml.Map({
      container: el.current,
      style: {
        version: 8,
        projection: globe ? { type: 'globe' } : undefined,
        sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#e7eff1' } }],
      },
      center: [20, 12],
      zoom: globe ? 1.25 : 0.9,
      attributionControl: false,
      renderWorldCopies: false,
    });
    m.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
    m.addControl(new ml.AttributionControl({ compact: true, customAttribution: 'Boundaries: Natural Earth' }));
    popup.current = new ml.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'atlas-popup' });
    m.on('load', () => {
      try {
        if (globe && m.setProjection) m.setProjection({ type: 'globe' });
      } catch {}
      m.addSource('countries', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addSource('points', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      m.addLayer({ id: 'country-fill', type: 'fill', source: 'countries', paint: { 'fill-color': ['get', 'fill'], 'fill-opacity': 1 } });
      m.addLayer({ id: 'country-line', type: 'line', source: 'countries', paint: { 'line-color': '#ffffff', 'line-width': 0.7 } });
      m.addLayer({ id: 'country-sel', type: 'line', source: 'countries', filter: ['==', ['get', 'sel'], 1], paint: { 'line-color': '#111827', 'line-width': 1.8 } });
      m.addLayer({
        id: 'pts', type: 'circle', source: 'points',
        paint: { 'circle-radius': ['get', 'size'], 'circle-color': ['get', 'color'], 'circle-opacity': 0.85, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
      });
      m.on('mousemove', 'country-fill', (e: any) => {
        const p = e.features?.[0]?.properties;
        if (!p) return;
        m.getCanvas().style.cursor = cb.current.onCountryClick ? 'pointer' : '';
        const v = cb.current.values?.[p.iso3];
        popup.current
          .setLngLat(e.lngLat)
          .setHTML(`<div style="font:500 13px Inter,sans-serif">${p.name}</div>${cb.current.values ? `<div style="font:13px Inter,sans-serif;color:#4b5563">${v !== undefined ? cb.current.valueLabel(v) : 'No data'}</div>` : ''}`)
          .addTo(m);
      });
      m.on('mouseleave', 'country-fill', () => {
        m.getCanvas().style.cursor = '';
        popup.current.remove();
      });
      m.on('click', 'country-fill', (e: any) => {
        const iso = e.features?.[0]?.properties?.iso3;
        if (iso && cb.current.onCountryClick) cb.current.onCountryClick(iso);
      });
      m.on('mouseenter', 'pts', (e: any) => {
        const p = e.features?.[0]?.properties;
        m.getCanvas().style.cursor = 'pointer';
        if (p) popup.current.setLngLat(e.lngLat).setHTML(`<div style="font:500 13px Inter,sans-serif;max-width:240px">${escapeHtml(p.label)}</div><div style="font:12px Inter,sans-serif;color:#6b7280">${escapeHtml(p.sub)}</div>`).addTo(m);
      });
      m.on('mouseleave', 'pts', () => {
        m.getCanvas().style.cursor = '';
        popup.current.remove();
      });
      m.on('click', 'pts', (e: any) => {
        const id = e.features?.[0]?.properties?.id;
        if (id && cb.current.onPointClick) cb.current.onPointClick(id);
      });
      setReady(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      setReady(false);
    };
  }, [globe]);

  useEffect(() => {
    if (ready && coloured) map.current?.getSource('countries')?.setData(coloured);
  }, [ready, coloured]);
  useEffect(() => {
    if (ready) map.current?.getSource('points')?.setData(pointGeo);
  }, [ready, pointGeo]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      {(failed || (geo && !geo.features.length)) && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 p-6 text-center">
          The map couldn't load (map library or country boundaries unavailable on this network).
        </div>
      )}
      {values && breaks.length > 0 && (
        <div className="absolute left-3 bottom-3 bg-white/95 border border-gray-200 rounded-xl px-3 py-2 shadow-card text-xs text-gray-600">
          {legendTitle && <div className="font-medium text-gray-800 mb-1">{legendTitle}</div>}
          <div className="flex items-center gap-0.5">
            {RAMP.slice(0, breaks.length + 1).map((c) => (
              <span key={c} className="w-7 h-2.5 rounded-sm" style={{ background: c }} />
            ))}
          </div>
          <div className="flex justify-between mt-1 tabular-nums gap-3">
            <span>{short(Math.min(...Object.values(values)))}</span>
            <span>{short(Math.max(...Object.values(values)))}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="w-3 h-2.5 rounded-sm" style={{ background: NO_DATA }} /> No data
          </div>
        </div>
      )}
    </div>
  );
}

function short(v: number) {
  return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}K` : v.toLocaleString('en-GB', { maximumFractionDigits: v < 10 ? 1 : 0 });
}

function escapeHtml(s: string) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
