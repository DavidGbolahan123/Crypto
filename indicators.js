// Wilder RSI on an array of closes.
export function rsi(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let ag = gain / period;
  let al = loss / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

const tailSum = (a, n) => {
  let s = 0;
  for (let i = Math.max(0, a.length - n); i < a.length; i++) s += a[i];
  return s;
};

// Net delta = taker buy - taker sell, per 1h candle: 2 * takerBuyQuote - quoteVolume.
// Returns normalised flow strength (ndn, -1..1), a CVD slope and the cumulative series.
export function flowMetrics(k) {
  if (!k || k.length < 5) return null;
  const d = k.map((x) => 2 * x.tbq - x.q);
  const q = k.map((x) => x.q);
  const b = k.map((x) => x.tbq);
  const cvd = [];
  let c = 0;
  for (const v of d) {
    c += v;
    cvd.push(c);
  }
  const q4 = tailSum(q, 4) || 1;
  const buy4 = tailSum(b, 4);
  const sell4 = q4 - buy4;
  return {
    cvd: c,
    slope: tailSum(d, 12) / (tailSum(q, 12) || 1),
    taker: sell4 > 0 ? buy4 / sell4 : null,
    nd1h: d[d.length - 1],
    nd4h: tailSum(d, 4),
    nd24h: tailSum(d, 24),
    ndn: tailSum(d, 4) / q4,
    series: cvd,
  };
}
