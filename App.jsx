import React, { useEffect, useMemo, useRef, useState } from 'react';
import Detail from './Detail.jsx';
import { fmtPrice, fmtUsd, fmtPct, fmtNum, fmtAge, fin, sign } from './format.js';

const get = (url) => fetch(url).then((r) => r.json());

// key -> accessor used for sorting. Null values always sink to the bottom.
const SORTS = {
  rank: (r) => r.rank,
  symbol: (r) => r.symbol,
  price: (r) => r.price,
  chg24h: (r) => r.chg24h,
  signal: (r) => (fin(r.score) && (r.dir === 'LONG' || r.dir === 'SHORT') ? Math.abs(r.score) : null),
  score: (r) => r.score,
  t1: (r) => r.tiers?.[0],
  t2: (r) => r.tiers?.[1],
  t3: (r) => r.tiers?.[2],
  t4: (r) => r.tiers?.[3],
  rsi: (r) => r.rsi,
  fcvd: (r) => r.fcvd?.slope,
  scvd: (r) => r.scvd?.slope,
  net: (r) => r.net?.ndn,
  oi: (r) => r.oi?.usd,
  oiBar: (r) => r.oi?.dBar,
  oi24: (r) => r.oi?.d24,
  funding: (r) => r.funding,
  liq1: (r) => (r.liq ? r.liq.l1 + r.liq.s1 : null),
  liq24: (r) => (r.liq ? r.liq.l24 + r.liq.s24 : null),
  acct: (r) => r.acct,
  top: (r) => r.topPos,
  cov: (r) => r.coverage,
};

function Tier({ v }) {
  if (!fin(v)) return <td className="tier dim">·</td>;
  const a = Math.min(1, Math.abs(v));
  const bg = v >= 0 ? `rgba(0,210,106,${0.08 + a * 0.5})` : `rgba(255,77,77,${0.08 + a * 0.5})`;
  return (
    <td className="tier" style={{ background: bg }}>
      {v > 0 ? '+' : ''}
      {Math.round(v * 100)}
    </td>
  );
}

function Src({ s }) {
  return s ? <i className={`src ${s}`} title={s === 'cg' ? 'CoinGlass (aggregated)' : 'Binance only'} /> : null;
}

function Slope({ v, src }) {
  if (!fin(v)) return <td className="dim">—</td>;
  return (
    <td className={sign(v)}>
      {v > 0 ? '+' : ''}
      {(v * 100).toFixed(1)}
      <Src s={src} />
    </td>
  );
}

function Row({ r, active, onSelect }) {
  const prev = useRef(r.price);
  const [flash, setFlash] = useState('');
  useEffect(() => {
    if (fin(r.price) && fin(prev.current) && r.price !== prev.current) {
      setFlash(r.price > prev.current ? 'up' : 'down');
      const t = setTimeout(() => setFlash(''), 700);
      prev.current = r.price;
      return () => clearTimeout(t);
    }
    prev.current = r.price;
  }, [r.price]);

  const dirCls = r.dir || '';
  return (
    <tr className={active ? 'active' : ''} onClick={() => onSelect(r.id)}>
      <td className="dim">{r.rank}</td>
      <td className="sym">{r.symbol}</td>
      <td className={`num flash-${flash}`}>{fmtPrice(r.price)}</td>
      <td className={sign(r.chg24h)}>{fmtPct(r.chg24h, 2)}</td>
      <td className="scorecell">
        <span className={`score ${sign(r.score)}`}>{r.score ?? '—'}</span>
        <span className="scorebar">
          {fin(r.score) && <i className={r.score < 0 ? 'neg-bg' : 'pos-bg'} style={{ width: `${Math.min(100, Math.abs(r.score)) / 2}%`, [r.score < 0 ? 'right' : 'left']: '50%' }} />}
        </span>
      </td>
      <td>
        <span className={`dir ${dirCls}`}>{r.dir || '—'}</span>
        {r.grade && r.grade !== '-' && <span className={`grade g${r.grade}`}>{r.grade}</span>}
      </td>
      <Tier v={r.tiers?.[0]} />
      <Tier v={r.tiers?.[1]} />
      <Tier v={r.tiers?.[2]} />
      <Tier v={r.tiers?.[3]} />
      <td className={r.rsi >= 70 ? 'neg' : r.rsi <= 30 ? 'pos' : ''}>{fmtNum(r.rsi, 1)}</td>
      <Slope v={r.fcvd?.slope} src={r.fcvd?.src} />
      <Slope v={r.scvd?.slope} src={r.scvd?.src} />
      <td className={sign(r.net?.nd)}>
        {fmtUsd(r.net?.nd, true)}
        <Src s={r.net?.src} />
      </td>
      <td>{fmtUsd(r.oi?.usd)}</td>
      <td className={sign(r.oi?.dBar)}>{fmtPct(r.oi?.dBar, 2)}</td>
      <td className={sign(r.oi?.d24)}>{fmtPct(r.oi?.d24, 2)}</td>
      <td className={r.funding >= 0.05 ? 'neg' : r.funding <= -0.05 ? 'pos' : sign(r.funding) === 'pos' ? 'dimpos' : ''}>{fmtPct(r.funding, 4)}</td>
      <td>
        {r.liq ? (
          <>
            <span className="neg">{fmtUsd(r.liq.l1)}</span> <span className="dim">/</span> <span className="pos">{fmtUsd(r.liq.s1)}</span>
          </>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td>
        {r.liq ? (
          <>
            <span className="neg">{fmtUsd(r.liq.l24)}</span> <span className="dim">/</span> <span className="pos">{fmtUsd(r.liq.s24)}</span>
          </>
        ) : (
          <span className="dim">—</span>
        )}
      </td>
      <td className={r.acct >= 2 ? 'neg' : r.acct <= 0.7 ? 'pos' : ''}>{fmtNum(r.acct)}</td>
      <td className={r.topPos > 1.15 ? 'pos' : r.topPos < 0.87 ? 'neg' : ''}>{fmtNum(r.topPos)}</td>
      <td className="flags">
        {(r.flags || []).map((f) => (
          <span key={f} className={`flag ${f}`}>
            {f === 'CROWD_L' ? 'CRWD-L' : f === 'CROWD_S' ? 'CRWD-S' : f === 'FUND_HOT' ? 'FND+' : f === 'FUND_NEG' ? 'FND−' : 'LIQ!'}
          </span>
        ))}
      </td>
      <td className={r.coverage < 80 ? 'warn' : 'dim'}>{r.coverage}%</td>
    </tr>
  );
}

const COLS = [
  ['rank', '#', 'Rank by 24h futures volume'],
  ['symbol', 'SYMBOL'],
  ['price', 'PRICE', 'Live (Binance, ~4s)'],
  ['chg24h', '24H'],
  ['score', 'SCORE', 'Weighted tier score, -100 (short) to +100 (long)'],
  ['signal', 'SIGNAL', 'Direction and grade. Click to sort by absolute score'],
  ['t1', 'T1', 'Taker ratio / futures CVD (weight 4)'],
  ['t2', 'T2', 'Net delta / OI-vs-price trend (weight 3)'],
  ['t3', 'T3', 'Top-trader positions / funding (weight 2)'],
  ['t4', 'T4', 'Spot CVD / Fear & Greed (weight 1)'],
  ['rsi', 'RSI1H'],
  ['fcvd', 'F-CVD', 'Futures CVD slope over last 12 bars, % of volume'],
  ['scvd', 'S-CVD', 'Spot CVD slope over last 12 bars, % of volume'],
  ['net', 'NETΔ4H', 'Taker buy minus sell, last 4h (USD)'],
  ['oi', 'OI'],
  ['oiBar', 'OIΔ', 'OI change over the last history bar'],
  ['oi24', 'OIΔ24H'],
  ['funding', 'FUND', 'OI-weighted funding, % per interval'],
  ['liq1', 'LIQ 1H L/S', 'Long / short liquidations, USD'],
  ['liq24', 'LIQ 24H L/S'],
  ['acct', 'L/S ACCT', 'Long/short ratio of accounts (Binance)'],
  ['top', 'L/S TOP', 'Long/short ratio of top-trader positions (Binance)'],
  [null, 'FLAGS'],
  ['cov', 'COV', 'Share of tier weight that has fresh data'],
];

export default function App() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState(null);
  const [q, setQ] = useState('');
  const [dir, setDir] = useState('ALL');
  const [grade, setGrade] = useState('ANY');
  const [limit, setLimit] = useState(200);
  const [sort, setSort] = useState({ key: 'signal', desc: true });
  const [sel, setSel] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      get('/api/signals')
        .then((j) => alive && (setData(j), setErr(null)))
        .catch((e) => alive && setErr(e.message));
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const tick = () => get('/api/status').then((j) => alive && setStatus(j)).catch(() => {});
    tick();
    const t = setInterval(tick, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const acc = SORTS[sort.key] || SORTS.rank;
    let list = data.coins.filter((r) => {
      if (q && !r.symbol.toLowerCase().includes(q.toLowerCase())) return false;
      if (dir !== 'ALL' && r.dir !== dir) return false;
      if (grade === 'A' && r.grade !== 'A') return false;
      if (grade === 'AB' && !['A', 'B'].includes(r.grade)) return false;
      return true;
    });
    list = list.slice().sort((a, b) => {
      const x = acc(a);
      const y = acc(b);
      const xn = x === null || x === undefined || Number.isNaN(x);
      const yn = y === null || y === undefined || Number.isNaN(y);
      if (xn && yn) return 0;
      if (xn) return 1;
      if (yn) return -1;
      const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return sort.desc ? -c : c;
    });
    return list.slice(0, limit);
  }, [data, q, dir, grade, sort, limit]);

  const counts = useMemo(() => {
    const c = { LONG: 0, SHORT: 0, FLAT: 0 };
    (data?.coins || []).forEach((r) => c[r.dir] !== undefined && c[r.dir]++);
    return c;
  }, [data]);

  const cgq = status?.coinglass?.queue;
  const warm = status ? Math.round((status.loaded.oi / Math.max(1, status.universe)) * 100) : null;
  const selRow = data?.coins.find((r) => r.id === sel);

  return (
    <div className={`app ${sel ? 'with-detail' : ''}`}>
      <div className="topbar">
        <div className="brand">
          PERP<span>SIGNAL</span> SCANNER
        </div>
        <div className="stat">LONG <b className="pos">{counts.LONG}</b></div>
        <div className="stat">SHORT <b className="neg">{counts.SHORT}</b></div>
        <div className="stat">FLAT <b>{counts.FLAT}</b></div>
        <div className="stat" title="Crypto Fear & Greed (CoinGlass)">F&G <b>{data?.fng ?? '—'}</b></div>
        <div className="stat">PLAN <b>{status?.plan ?? data?.plan ?? '—'}</b> · {data?.interval ?? '—'} bars</div>
        {status && (
          <div className="stat" title="Share of coins with CoinGlass OI data loaded">
            WARM-UP <b className={warm < 100 ? 'warn' : 'pos'}>{warm}%</b>
          </div>
        )}
        {cgq && (
          <div className="stat" title="Estimated CoinGlass calls/min needed vs the budget this app allows itself">
            CG LOAD <b className={cgq.demandPerMin > cgq.budgetPerMin ? 'warn' : ''}>{cgq.demandPerMin}</b>/{cgq.budgetPerMin} per min
          </div>
        )}
        {status && !status.coinglass.keyPresent && <div className="stat warn">NO CG KEY · Binance-only mode</div>}
        {err && <div className="stat neg">API offline: {err}</div>}
      </div>

      <div className="controls">
        <input placeholder="Search symbol…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {['ALL', 'LONG', 'SHORT', 'FLAT'].map((d) => (
            <button key={d} className={dir === d ? 'on' : ''} onClick={() => setDir(d)}>
              {d}
            </button>
          ))}
        </div>
        <div className="seg">
          {[['ANY', 'ANY GRADE'], ['AB', 'A+B'], ['A', 'A ONLY']].map(([k, l]) => (
            <button key={k} className={grade === k ? 'on' : ''} onClick={() => setGrade(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="seg">
          {[25, 50, 100, 200].map((n) => (
            <button key={n} className={limit === n ? 'on' : ''} onClick={() => setLimit(n)}>
              TOP {n}
            </button>
          ))}
        </div>
        <div className="legend">
          <i className="src cg" /> CoinGlass aggregated <i className="src bn" /> Binance only
        </div>
      </div>

      <div className="main">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                {COLS.map(([key, label, tip]) => (
                  <th key={label} title={tip} className={key ? 'sortable' : ''} onClick={() => key && setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'rank' && key !== 'symbol' }))}>
                    {label}
                    {sort.key === key ? (sort.desc ? ' ▾' : ' ▴') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.id} r={r} active={r.id === sel} onSelect={(id) => setSel(id === sel ? null : id)} />
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={COLS.length} className="empty">
                    {data ? 'No coins match the filters.' : 'Loading…'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {sel && selRow && <Detail id={sel} row={selRow} onClose={() => setSel(null)} />}
      </div>
      <footer>
        Not financial advice. Scores are a rules-based read of positioning and flow, not a forecast. Data age on the selected coin: {fmtAge(selRow?.ageSec)}.
      </footer>
    </div>
  );
}
