import React, { useEffect, useState } from 'react';
import Spark from './Spark.jsx';
import { fmtPrice, fmtUsd, fmtPct, fmtNum, fmtAge, fin, sign } from './format.js';

const TIERS = [
  { name: 'T1 · Taker ratio / Futures CVD', w: 4 },
  { name: 'T2 · Net delta / OI trend', w: 3 },
  { name: 'T3 · Top positions / Funding', w: 2 },
  { name: 'T4 · Spot CVD / Fear & Greed', w: 1 },
];

export default function Detail({ id, row, onClose }) {
  const [d, setD] = useState(null);

  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/coin/${id}`)
        .then((r) => r.json())
        .then((j) => live && setD(j))
        .catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [id]);

  const s = d?.series || {};
  const r = d?.row || row;

  return (
    <aside className="detail">
      <header>
        <div>
          <h2>
            {r.symbol}
            <span className="dim"> /USDT perp</span>
          </h2>
          <div className="big">
            {fmtPrice(r.price)} <span className={sign(r.chg24h)}>{fmtPct(r.chg24h)}</span>
          </div>
        </div>
        <button onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <section>
        <div className="scoreline">
          <span className={`dir ${r.dir}`}>{r.dir === 'WARM' ? 'WARMING UP' : r.dir || '—'}</span>
          <span className="scorebig">{r.score ?? '—'}</span>
          <span className="dim">grade {r.grade} · {r.aligned} tiers aligned · {r.coverage}% data coverage</span>
        </div>
        {TIERS.map((t, i) => {
          const v = r.tiers?.[i];
          return (
            <div className="tierrow" key={t.name}>
              <span>{t.name}</span>
              <span className="dim">×{t.w}</span>
              <div className="tierbar">
                <i style={{ left: fin(v) ? (v < 0 ? `${50 + v * 50}%` : '50%') : '50%', width: fin(v) ? `${Math.abs(v) * 50}%` : 0 }} className={v < 0 ? 'neg-bg' : 'pos-bg'} />
              </div>
              <b className={sign(v)}>{fin(v) ? (v > 0 ? '+' : '') + Math.round(v * 100) : '—'}</b>
            </div>
          );
        })}
        {r.flags?.length > 0 && (
          <div className="flags">
            {r.flags.map((f) => (
              <span key={f} className={`flag ${f}`}>
                {f.replace('_', ' ')}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="facts">
        <div><span>RSI 1h</span><b>{fmtNum(r.rsi, 1)}</b></div>
        <div><span>Open interest</span><b>{fmtUsd(r.oi?.usd)}</b></div>
        <div><span>Funding</span><b className={sign(r.funding)}>{fmtPct(r.funding, 4)}</b></div>
        <div><span>Net delta 4h</span><b className={sign(r.net?.nd)}>{fmtUsd(r.net?.nd, true)}</b></div>
        <div><span>L/S accounts</span><b>{fmtNum(r.acct)}</b></div>
        <div><span>L/S top positions</span><b>{fmtNum(r.topPos)}</b></div>
        <div><span>Liq 24h long</span><b className="neg">{fmtUsd(r.liq?.l24)}</b></div>
        <div><span>Liq 24h short</span><b className="pos">{fmtUsd(r.liq?.s24)}</b></div>
        <div><span>Data age</span><b>{fmtAge(r.ageSec)}</b></div>
        <div><span>Rank (24h vol)</span><b>#{r.rank}</b></div>
      </section>

      <section className="sparks">
        <Spark label="Price (1h)" data={s.price} fmt={fmtPrice} />
        <Spark label="Open interest" data={s.oi} fmt={(v) => fmtUsd(v)} />
        <Spark label="Funding %" data={s.fund} fmt={(v) => v.toFixed(4)} />
        <Spark label={`Futures CVD (${r.fcvd?.src === 'cg' ? 'aggregated' : 'Binance'})`} data={s.fcvd || s.kcvd} fmt={(v) => fmtUsd(v, true)} />
        <Spark label={`Spot CVD (${r.scvd?.src === 'cg' ? 'aggregated' : 'Binance'})`} data={s.scvd || s.bscvd} fmt={(v) => fmtUsd(v, true)} />
        <Spark label="L/S top positions" data={s.topPos} />
        <Spark label="L/S accounts" data={s.acct} />
      </section>
      <p className="note">
        Sources: <b>cg</b> = CoinGlass aggregated across exchanges; <b>bn</b> = Binance futures/spot only. Long/short ratios are Binance pair data (CoinGlass does not aggregate them across exchanges).
      </p>
    </aside>
  );
}
