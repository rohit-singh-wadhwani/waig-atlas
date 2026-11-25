// Icons drawn on the TB map, kept in one place so the map and its legend show the same pictures.
// Each is an SVG on a 24 x 24 grid (pins 30 x 38, flags 22 x 28); the map loads them at twice the size for sharp edges.

const svg = (w: number, h: number, body: string, scale: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w * scale}" height="${h * scale}" viewBox="0 0 ${w} ${h}">${body}</svg>`;

// a map pin with a building inside: big and dark enough to read on satellite imagery; its tip marks the spot
const PIN = (fill: string) =>
  `<path d="M15 37C15 37 3 23.6 3 14.5A12 12 0 0 1 27 14.5C27 23.6 15 37 15 37Z" fill="${fill}" stroke="#ffffff" stroke-width="2"/>` +
  `<rect x="10" y="7.5" width="10" height="13" rx="0.8" fill="#ffffff"/>` +
  `<rect x="11.8" y="9.5" width="2.4" height="2.4" fill="${fill}"/><rect x="15.8" y="9.5" width="2.4" height="2.4" fill="${fill}"/>` +
  `<rect x="11.8" y="13.4" width="2.4" height="2.4" fill="${fill}"/><rect x="15.8" y="13.4" width="2.4" height="2.4" fill="${fill}"/>` +
  `<rect x="13.8" y="17" width="2.4" height="3.5" fill="${fill}"/>`;

const FLAG = (fill: string) =>
  `<line x1="2.5" y1="2" x2="2.5" y2="27" stroke="#0f172a" stroke-width="2" stroke-linecap="round"/>` +
  `<path d="M3.5 3H19.5L15.8 8L19.5 13H3.5Z" fill="${fill}" stroke="#ffffff" stroke-width="1" stroke-linejoin="round"/>`;

const BODIES = {
  /** a hexagon's high density point */
  building: [30, 38, PIN('#0f172a')],
  /** a high density point already chosen for a campaign */
  'building-used': [30, 38, PIN('#dc2626')],
  /** a hospital */
  hospital: [24, 24, `<rect x="2" y="2" width="20" height="20" rx="4" fill="#1d4ed8" stroke="#ffffff" stroke-width="1.5"/><path d="M12 6.5V17.5M6.5 12H17.5" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>`],
  /** a clinic, CHPS compound or other facility */
  clinic: [24, 24, `<circle cx="12" cy="12" r="9" fill="#1d4ed8" stroke="#ffffff" stroke-width="1.5"/><path d="M12 8V16M8 12H16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/>`],
  prison: [24, 24, `<circle cx="12" cy="12" r="10.5" fill="#111827" stroke="#ffffff" stroke-width="1.5"/><path d="M7.5 7H16.5M7.5 17H16.5M9 7V17M12 7V17M15 7V17" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>`],
  mine: [24, 24, `<circle cx="12" cy="12" r="10.5" fill="#a16207" stroke="#ffffff" stroke-width="1.5"/><path d="M8 17.5L15 10" stroke="#ffffff" stroke-width="1.9" stroke-linecap="round"/><path d="M10.5 6.8Q15.8 6.6 17.6 12.4" stroke="#ffffff" stroke-width="2.2" fill="none" stroke-linecap="round"/>`],
  /** a campaign with no task moved and no results yet */
  'flag-red': [22, 28, FLAG('#dc2626')],
  /** a campaign with work under way or results in */
  'flag-green': [22, 28, FLAG('#16a34a')],
} as const;

export type MapIcon = keyof typeof BODIES;
export const MAP_ICONS = Object.keys(BODIES) as MapIcon[];

/** The icon as an image URL; `scale` 2 for the map (sharp on high-density screens), 1 for the legend. */
export function iconUrl(k: MapIcon, scale = 1) {
  const [w, h, body] = BODIES[k];
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(w, h, body, scale))}`;
}
