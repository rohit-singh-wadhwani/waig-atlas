export const DAY = 86400000;

export function fmtDate(d?: string | null, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!d) return '—';
  const t = new Date(d);
  if (isNaN(+t)) return d;
  return t.toLocaleDateString('en-GB', opts);
}

export function fmtTime(d?: string | null) {
  if (!d) return 'never';
  const t = new Date(d);
  if (isNaN(+t)) return d;
  return t.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function daysUntil(d?: string | null): number | null {
  if (!d) return null;
  const t = new Date(d);
  if (isNaN(+t)) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((+t - +today) / DAY);
}

export function relDays(d?: string | null) {
  const n = daysUntil(d);
  if (n === null) return 'no deadline';
  if (n < 0) return `closed ${-n}d ago`;
  if (n === 0) return 'today';
  return `in ${n}d`;
}

export function fmtUsd(n?: number | null) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}

export function fmtNum(n?: number | null, digits = 0) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-GB', { maximumFractionDigits: digits });
}

export function timeAgo(d?: string | null) {
  if (!d) return 'never';
  const s = (Date.now() - +new Date(d)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function initials(name: string) {
  return (name || '?')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

export function scoreTone(score?: number | null): { label: string; cls: string } {
  if (score === null || score === undefined) return { label: 'Unscored', cls: 'bg-gray-100 text-gray-600' };
  if (score >= 70) return { label: 'Strong fit', cls: 'bg-green-50 text-green-700' };
  if (score >= 45) return { label: 'Possible fit', cls: 'bg-amber-50 text-amber-700' };
  return { label: 'Weak fit', cls: 'bg-gray-100 text-gray-600' };
}
