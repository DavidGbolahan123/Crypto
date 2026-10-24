export const fin = (x) => typeof x === 'number' && Number.isFinite(x);

export function fmtPrice(p) {
  if (!fin(p)) return '—';
  const a = Math.abs(p);
  const d = a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 3 : a >= 0.1 ? 4 : a >= 0.01 ? 5 : 7;
  return p.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtUsd(v, signed = false) {
  if (!fin(v)) return '—';
  const a = Math.abs(v);
  const s = v < 0 ? '-' : signed && v > 0 ? '+' : '';
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(1)}K`;
  return `${s}${a.toFixed(0)}`;
}

export const fmtPct = (v, d = 2, signed = true) => (fin(v) ? `${signed && v > 0 ? '+' : ''}${v.toFixed(d)}%` : '—');
export const fmtNum = (v, d = 2) => (fin(v) ? v.toFixed(d) : '—');
export const sign = (v) => (!fin(v) || v === 0 ? '' : v > 0 ? 'pos' : 'neg');

export function fmtAge(sec) {
  if (!fin(sec)) return '—';
  if (sec < 90) return `${sec}s`;
  if (sec < 5400) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}
