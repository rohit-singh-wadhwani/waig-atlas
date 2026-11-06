import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorldGeo } from '../lib/world';

declare global {
  interface Window {
    maplibregl?: any;
  }
}

export type MapLink = { label: string; href?: string; meta?: string };
export type MapPoint = {
  id: string; lng: number; lat: number; size?: number; color?: string;
  label: string; sub?: string;
  /** shown in the click popup */
  items?: MapLink[]; href?: string; cta?: string; kind?: string;
};

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
  fills, fillLabels, legend, focus, overlay,
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
  /** categorical fill per country (ISO3 -> colour), drawn instead of the grey land */
  fills?: Record<string, string>;
  /** hover text per country when using fills */
  fillLabels?: Record<string, string>;
  /** categorical legend entries */
  legend?: { color: string; label: string }[];
  /** [lng, lat] to turn the globe towards when data arrives */
  focus?: [number, number] | null;
  /** extra content pinned to the top-left of the map */
  overlay?: React.ReactNode;
  globe?: boolean;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const popup = useRef<any>(null);
  const pinned = useRef<any>(null);
  const byId = useRef<Map<string, MapPoint>>(new Map());
  byId.current = new Map(points.map((p) => [p.id, p]));
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const cb = useRef({ onCountryClick, onPointClick, valueLabel, values, fillLabels });
  cb.current = { onCountryClick, onPointClick, valueLabel, values, fillLabels };

  const breaks = useMemo(() => quantileBreaks(Object.values(values || {})), [values]);

  const coloured = useMemo(() => {
    if (!geo) return null;
    return {
      type: 'FeatureCollection',
      features: geo.features.map((f: any) => ({
        ...f,
        properties: { ...f.properties, fill: values ? colorFor(values[f.properties.iso3], breaks) : fills?.[f.properties.iso3] || '#d5dade', sel: f.properties.iso3 === selected ? 1 : 0 },
      })),
    };
  }, [geo, values, breaks, selected, fills]);

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
      const pick = (e: any) => {
        const pad = 6;
        const box = [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]];
        const pts = m.queryRenderedFeatures(box, { layers: ['pts'] }) || [];
        const ids = Array.from(new Set(pts.map((f: any) => f.properties.id))) as string[];
        const country = (m.queryRenderedFeatures(e.point, { layers: ['country-fill'] }) || [])[0]?.properties;
        return { ids, country };
      };
      const countryHtml = (c: any) => {
        const v = cb.current.values?.[c.iso3];
        const extra = cb.current.fillLabels?.[c.iso3];
        return `<div class="atlas-pop-title">${escapeHtml(c.name)}</div>${cb.current.values ? `<div class="atlas-pop-sub">${v !== undefined ? escapeHtml(cb.current.valueLabel(v)) : 'No data'}</div>` : ''}${cb.current.fillLabels ? `<div class="atlas-pop-sub">${escapeHtml(extra || 'No open calls')}</div>` : ''}`;
      };
      m.on('mousemove', (e: any) => {
        if (pinned.current?.isOpen?.()) return;
        const { ids, country } = pick(e);
        if (ids.length) {
          const first = byId.current.get(ids[0]);
          m.getCanvas().style.cursor = 'pointer';
          popup.current
            .setLngLat(e.lngLat)
            .setHTML(`<div class="atlas-pop-title">${escapeHtml(first?.label || '')}</div><div class="atlas-pop-sub">${ids.length > 1 ? `${ids.length} items here · ` : ''}click for details</div>`)
            .addTo(m);
        } else if (country) {
          m.getCanvas().style.cursor = cb.current.onCountryClick ? 'pointer' : '';
          popup.current.setLngLat(e.lngLat).setHTML(countryHtml(country)).addTo(m);
        } else {
          m.getCanvas().style.cursor = '';
          popup.current.remove();
        }
      });
      m.getCanvas().addEventListener('mouseleave', () => popup.current?.remove());
      m.on('click', (e: any) => {
        const { ids, country } = pick(e);
        popup.current.remove();
        if (ids.length) {
          const list = ids.map((id) => byId.current.get(id)).filter(Boolean) as MapPoint[];
          pinned.current?.remove();
          pinned.current = new ml.Popup({ closeButton: true, closeOnClick: true, offset: 12, maxWidth: '340px', className: 'atlas-popup atlas-pinned' })
            .setLngLat(e.lngLat)
            .setHTML(detailHtml(list))
            .addTo(m);
          if (cb.current.onPointClick) cb.current.onPointClick(list[0].id);
          return;
        }
        if (country) {
          if (cb.current.onCountryClick) cb.current.onCountryClick(country.iso3);
          else {
            pinned.current?.remove();
            pinned.current = new ml.Popup({ closeButton: true, closeOnClick: true, offset: 8, className: 'atlas-popup atlas-pinned' }).setLngLat(e.lngLat).setHTML(countryHtml(country)).addTo(m);
          }
        }
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
  const focusKey = focus ? focus.join(',') : '';
  useEffect(() => {
    if (ready && focus) map.current?.easeTo({ center: focus, duration: 900 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, focusKey]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-gray-100 bg-gray-50" style={{ height }}>
      <div ref={el} className="absolute inset-0" />
      {(failed || (geo && !geo.features.length)) && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 p-6 text-center">
          The map couldn't load (map library or country boundaries unavailable on this network).
        </div>
      )}
      {overlay && <div className="absolute left-3 top-3 z-10 flex flex-wrap gap-2 pr-16">{overlay}</div>}
      {!values && legend && legend.length > 0 && (
        <div className="absolute left-3 bottom-3 bg-white/95 border border-gray-200 rounded-xl px-3 py-2 shadow-card text-xs text-gray-600 space-y-1">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-2"><span className="w-3 h-3 rounded-sm" style={{ background: l.color }} />{l.label}</div>
          ))}
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

function linkHtml(href: string | undefined, text: string) {
  if (!href) return escapeHtml(text);
  const internal = href.startsWith('#');
  return `<a href="${escapeHtml(href)}"${internal ? '' : ' target="_blank" rel="noreferrer"'}>${escapeHtml(text)}</a>`;
}

function detailHtml(list: MapPoint[]) {
  return list
    .slice(0, 6)
    .map((p) => {
      const items = (p.items || []).slice(0, 5).map((it) => `<li>${linkHtml(it.href, it.label)}${it.meta ? `<span class="atlas-pop-meta">${escapeHtml(it.meta)}</span>` : ''}</li>`).join('');
      const more = (p.items || []).length > 5 ? `<li class="atlas-pop-meta">+${(p.items || []).length - 5} more</li>` : '';
      return `<div class="atlas-pop-block">
        <div class="atlas-pop-kind" style="color:${p.color || '#316d6e'}">${escapeHtml(p.kind || '')}</div>
        <div class="atlas-pop-title">${linkHtml(p.href, p.label)}</div>
        ${p.sub ? `<div class="atlas-pop-sub">${escapeHtml(p.sub)}</div>` : ''}
        ${items ? `<ul class="atlas-pop-list">${items}${more}</ul>` : ''}
        ${p.href && p.cta ? `<div class="atlas-pop-cta">${linkHtml(p.href, p.cta + ' →')}</div>` : ''}
      </div>`;
    })
    .join('');
}

function escapeHtml(s: string) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
