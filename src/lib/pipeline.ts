import type { Country } from './types';

/** Team rating → numeric score used for colours and sorting. */
export const FIT_SCORE: Record<string, number> = { high: 80, medium: 55, 'medium - low': 40, 'medium-low': 40, low: 25, 'not eligible': 5 };
export const FIT_OPTIONS = ['High', 'Medium', 'Medium - Low', 'Low', 'Not eligible'];
export const fitScore = (fit?: string | null) => (fit ? FIT_SCORE[fit.trim().toLowerCase()] ?? null : null);

const MON: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Opens 17 Nov 2026; Deadline 18 Mar 2027" → 2027-03-18; "Rolling" → null. */
export function parseDeadline(text?: string | null): string | null {
  if (!text) return null;
  const t = text.match(/deadline\s+(?:of\s+)?(.*)/i)?.[1] || text;
  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const m = t.match(/(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*(?:[\s-,]+(\d{4}))?/);
  if (!m) return null;
  const mo = MON[m[2].toLowerCase()];
  if (!mo) return null;
  const y = m[3] ? Number(m[3]) : new Date().getFullYear();
  return `${y}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

const ALIAS: Record<string, string> = {
  DRC: 'COD', 'Democratic Republic of the Congo': 'COD', Tanzania: 'TZA', Vietnam: 'VNM', 'South Sudan': 'SSD', 'Guinea Bissau': 'GNB', 'Guinea-Bissau': 'GNB',
  UK: 'GBR', 'United Kingdom': 'GBR', USA: 'USA', 'United States': 'USA', "Côte d'Ivoire": 'CIV', 'Ivory Coast': 'CIV', Netherlands: 'NLD',
};

/** Find countries named in free text; "Global", "LMICs" etc. add GLOBAL. */
export function parseCountries(text: string | null | undefined, countries: Country[]): string[] {
  const t = text || '';
  const found: string[] = [];
  const names: [string, string][] = [...countries.map((c) => [c.name, c.iso3] as [string, string]), ...Object.entries(ALIAS)];
  names.sort((a, b) => b[0].length - a[0].length);
  let rest = t;
  for (const [name, iso] of names) {
    if (name.length < 4 && name !== 'UK' && name !== 'USA' && name !== 'DRC') continue;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    if (re.test(rest) && !found.includes(iso)) {
      found.push(iso);
      rest = rest.replace(re, ' '); // so "Sudan" doesn't also match inside "South Sudan"
    }
  }
  if (/\bUS\b/.test(t) && !found.includes('USA')) found.push('USA');
  if (/global|LMIC|worldwide|cities|international/i.test(t)) found.unshift('GLOBAL');
  return found.length ? found : ['GLOBAL'];
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16).padStart(8, '0');
}
export const pipelineId = (funder: string, title: string) => `pl_${hash((funder + '|' + title).toLowerCase())}`;
