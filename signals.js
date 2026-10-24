// Four-tier signal engine, ordered the way David trades perps:
//   T1 Taker ratio / futures CVD        weight 4
//   T2 Net delta / OI-vs-price trend    weight 3
//   T3 Top-trader positions / funding   weight 2
//   T4 Spot CVD / Fear & Greed          weight 1
// Each tier scores -1..+1 (short..long). Tiers with no fresh data are skipped and the
// weights renormalised; `coverage` says how much of the weight actually had data.

const W = [4, 3, 2, 1];
const clamp = (x, a = -1, b = 1) => Math.max(a, Math.min(b, x));
const fin = (x) => typeof x === 'number' && Number.isFinite(x);
const avg = (a) => {
  const v = a.filter(fin);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function analyze(coin, global, cfg) {
  const now = Date.now();
  const fresh = (g) => (g && now - g.ts <= cfg.staleMs ? g : null);
  const m = {};
  for (const [k, v] of Object.entries(coin.m)) m[k] = fresh(v);
  const L = coin.live || {};

  const fut = m.fcvd || m.kline;
  const futSrc = m.fcvd ? 'cg' : m.kline ? 'bn' : null;
  const spot = m.scvd || m.bscvd;
  const spotSrc = m.scvd ? 'cg' : m.bscvd ? 'bn' : null;
  const net = m.net && fin(m.net.ndn) ? { ndn: m.net.ndn, nd: m.net.nf4h, src: 'cg' } : m.kline ? { ndn: m.kline.ndn, nd: m.kline.nd4h, src: 'bn' } : null;
  const fundPct = fin(m.fund?.pct) ? m.fund.pct : fin(L.funding) ? L.funding : null;
  const rsiVal = fin(m.rsiCg?.rsi1h) ? m.rsiCg.rsi1h : fin(m.kline?.rsi) ? m.kline.rsi : null;
  const fng = global.fng?.value;

  // T1
  const p1 = [fut ? clamp(fut.slope * 3) : null, fut && fin(fut.taker) && fut.taker > 0 ? clamp(Math.log(fut.taker) * 6) : null];
  const t1 = avg(p1);

  // T2: net delta + OI/price regime (24h)
  let oiRegime = null;
  if (m.oi && fin(m.oi.d24) && fin(L.chg24h)) {
    const mag = clamp(Math.abs(m.oi.d24) / 5, 0, 1);
    const up = L.chg24h > 0;
    const oiUp = m.oi.d24 > 0;
    oiRegime = up && oiUp ? mag : !up && oiUp ? -mag : up && !oiUp ? -0.4 * mag : 0.3 * mag;
  }
  const p2 = [net ? clamp(net.ndn * 5) : null, oiRegime];
  const t2 = avg(p2);

  // T3: top trader positioning (follow) + funding (fade the crowd)
  const p3 = [
    fin(m.topPos?.ratio) && m.topPos.ratio > 0 ? clamp(Math.log(m.topPos.ratio) * 2.5) : null,
    fin(fundPct) ? clamp(-fundPct / 0.05) : null,
  ];
  const t3 = avg(p3);

  // T4: spot CVD confirmation + Fear & Greed extremes (contrarian)
  const fngTilt = fin(fng) ? (fng >= 75 ? -(fng - 75) / 25 : fng <= 25 ? (25 - fng) / 25 : 0) : null;
  const p4 = [spot ? clamp(spot.slope * 3) : null, fngTilt];
  const t4 = avg(p4);

  const tiers = [t1, t2, t3, t4];
  let num = 0;
  let den = 0;
  tiers.forEach((s, i) => {
    if (fin(s)) {
      num += W[i] * s;
      den += W[i];
    }
  });
  const score = den ? Math.round((num / den) * 100) : null;
  // Coverage counts individual inputs (2 per tier), so a tier with half its data only earns half its weight.
  const coverage = Math.round(([p1, p2, p3, p4].reduce((s, p, i) => s + (W[i] * p.filter(fin).length) / p.length, 0) / 10) * 100);
  // Not enough of the picture loaded yet (typical during warm-up): show the score but call no direction.
  const dir = score === null ? null : coverage < 80 ? 'WARM' : score >= 25 ? 'LONG' : score <= -25 ? 'SHORT' : 'FLAT';
  const sign = dir === 'LONG' ? 1 : -1;
  const aligned = dir === 'LONG' || dir === 'SHORT' ? tiers.filter((s) => fin(s) && Math.abs(s) > 0.1 && Math.sign(s) === sign).length : 0;
  const grade = dir !== 'LONG' && dir !== 'SHORT' ? '-' : aligned >= 3 && den >= 6 ? 'A' : aligned >= 2 ? 'B' : 'C';

  const flags = [];
  if (fin(m.acct?.ratio)) {
    if (m.acct.ratio >= 2) flags.push('CROWD_L');
    if (m.acct.ratio <= 0.7) flags.push('CROWD_S');
  }
  if (fin(fundPct)) {
    if (fundPct >= 0.05) flags.push('FUND_HOT');
    if (fundPct <= -0.05) flags.push('FUND_NEG');
  }
  if (m.liq && m.oi && m.oi.usd > 0 && (m.liq.l1 + m.liq.s1) / m.oi.usd >= 0.002) flags.push('LIQ_SPIKE');

  const ages = ['oi', 'fund', 'topPos', 'acct'].map((g) => coin.m[g]?.ts).filter(Boolean);
  return {
    rank: coin.rank,
    id: coin.pair,
    symbol: coin.symbol,
    price: L.price ?? null,
    chg24h: L.chg24h ?? null,
    vol24h: L.vol24h ?? null,
    funding: fundPct,
    oi: m.oi ? { usd: m.oi.usd, dBar: m.oi.dBar, d24: m.oi.d24 } : null,
    liq: m.liq || null,
    rsi: rsiVal,
    fcvd: fut ? { slope: fut.slope, taker: fut.taker, src: futSrc } : null,
    scvd: spot ? { slope: spot.slope, src: spotSrc } : null,
    net: net ? { ndn: net.ndn, nd: net.nd, src: net.src } : null,
    acct: m.acct ? m.acct.ratio : null,
    topPos: m.topPos ? m.topPos.ratio : null,
    score,
    dir,
    grade,
    aligned,
    tiers: tiers.map((s) => (fin(s) ? Math.round(s * 100) / 100 : null)),
    coverage,
    flags,
    ageSec: ages.length ? Math.round((now - Math.min(...ages)) / 1000) : null,
  };
}
