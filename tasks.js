import { PlanError } from './coinglass.js';
import { rsi, flowMetrics } from './indicators.js';

const TAIL = 48;
const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const tms = (t) => (Number(t) < 1e12 ? Number(t) * 1000 : Number(t));
const sortRows = (rows) => [...rows].sort((a, b) => tms(a.time) - tms(b.time));
const pct = (now, then) => (Number.isFinite(now) && Number.isFinite(then) && then !== 0 ? ((now - then) / Math.abs(then)) * 100 : null);
const tail = (a) => a.slice(-TAIL);
const sum = (a) => a.reduce((s, x) => s + x, 0);

// Hot coins refresh at the base TTL, warm at 2x, cold at 4x.
const tierMult = (rank) => (rank <= 30 ? 1 : rank <= 100 ? 2 : 4);

export function buildTasks({ cfg, store, cg, bn }) {
  const now = Date.now();
  const ivMin = cfg.intervalMin;
  const barsPerDay = Math.max(1, Math.round(1440 / ivMin));
  const cgTasks = [];
  const bnTasks = [];

  // Bulk tasks (prio 0) run first on boot; per-coin tasks start "exactly due" and are ordered by rank.
  const task = (list, t) => list.push({ lastRun: t.prio === 0 ? 0 : now - t.ttlMs, fails: 0, planLocked: false, ...t });

  // CoinGlass sometimes lists 1000x contracts under the plain symbol (PEPE) and
  // sometimes under the base asset (1000PEPE). Try one, fall back to the other once.
  async function coinRows(coin, path, params) {
    const sym = () => (coin.useBase ? coin.base : coin.cg);
    let rows = await cg.get(path, { ...params, symbol: sym() });
    if (!rows.length && !coin.symTried && coin.base !== coin.cg) {
      coin.symTried = true;
      coin.useBase = !coin.useBase;
      rows = await cg.get(path, { ...params, symbol: sym() });
    }
    if (!rows.length) throw new Error(`no data for ${coin.cg}`);
    return sortRows(rows);
  }

  // ---------- CoinGlass: bulk tasks (one set of calls covers every coin) ----------

  task(cgTasks, {
    id: 'bulk:liquidations',
    prio: 0,
    ttlMs: 60_000,
    calls: cfg.exchanges.length,
    async run() {
      const agg = new Map();
      let ok = 0;
      let lastErr;
      for (const exchange of cfg.exchanges) {
        try {
          const rows = await cg.get('/api/futures/liquidation/coin-list', { exchange });
          ok++;
          for (const r of rows) {
            const coin = store.bySymbol.get(r.symbol);
            if (!coin) continue;
            const a = agg.get(coin) || { l1: 0, s1: 0, l4: 0, s4: 0, l12: 0, s12: 0, l24: 0, s24: 0 };
            for (const w of ['1', '4', '12', '24']) {
              a[`l${w}`] += num(r[`long_liquidation_usd_${w}h`]) || 0;
              a[`s${w}`] += num(r[`short_liquidation_usd_${w}h`]) || 0;
            }
            agg.set(coin, a);
          }
        } catch (e) {
          lastErr = e;
        }
      }
      if (!ok) throw lastErr;
      for (const [coin, a] of agg) store.set(coin, 'liq', a);
    },
  });

  if (cfg.features.netflow) {
    task(cgTasks, {
      id: 'bulk:netflow',
      prio: 0,
      ttlMs: 60_000,
      calls: 3,
      planLocked: true,
      async run() {
        const per = 100;
        for (let page = 1; page <= 4; page++) {
          const rows = await cg.get('/api/futures/netflow-list', { per_page: per, page });
          for (const r of rows) {
            const coin = store.bySymbol.get(r.symbol);
            if (!coin) continue;
            const buy4 = num(r.taker_buy_volume_usd_4h);
            const sell4 = num(r.taker_sell_volume_usd_4h);
            store.set(coin, 'net', {
              nf1h: num(r.net_flow_usd_1h),
              nf4h: num(r.net_flow_usd_4h),
              nf24h: num(r.net_flow_usd_24h),
              ndn: buy4 + sell4 > 0 ? num(r.net_flow_usd_4h) / (buy4 + sell4) : null,
            });
          }
          if (rows.length < per) break;
        }
      },
    });
  }

  if (cfg.features.rsiList) {
    task(cgTasks, {
      id: 'bulk:rsi',
      prio: 0,
      ttlMs: 60_000,
      calls: 1,
      planLocked: true,
      async run() {
        const rows = await cg.get('/api/futures/rsi/list');
        for (const r of rows) {
          const coin = store.bySymbol.get(r.symbol);
          if (coin) store.set(coin, 'rsiCg', { rsi1h: num(r.rsi_1h), rsi4h: num(r.rsi_4h), rsi24h: num(r.rsi_24h) });
        }
      },
    });
  }

  task(cgTasks, {
    id: 'bulk:fng',
    prio: 0,
    ttlMs: 3_600_000,
    calls: 1,
    async run() {
      const data = await cg.get('/api/index/fear-greed-history');
      const first = Array.isArray(data) ? data[0] : data;
      const list = first?.data_list || [];
      const v = num(list[list.length - 1]);
      if (Number.isFinite(v)) store.global.fng = { value: v, ts: Date.now() };
      else throw new Error('unexpected fear & greed payload');
    },
  });

  // ---------- CoinGlass: per-coin tasks ----------

  for (const coin of store.coins.values()) {
    const ttl = cfg.ttlBaseMs * tierMult(coin.rank);
    const mk = (kind, calls, run, extra = {}) =>
      task(cgTasks, { id: `${kind}:${coin.pair}`, prio: coin.rank, ttlMs: ttl, calls, run: () => run(coin), ...extra });

    // Aggregated open interest (all exchanges) + OI delta
    mk('oi', 1, async (c) => {
      const rows = await coinRows(c, '/api/futures/open-interest/aggregated-history', { interval: cfg.interval, limit: 60 });
      const v = rows.map((r) => num(r.close)).filter(Number.isFinite);
      if (v.length < 2) throw new Error('short OI series');
      const last = v[v.length - 1];
      store.set(
        c,
        'oi',
        { usd: last, dBar: pct(last, v[v.length - 2]), d24: pct(last, v[Math.max(0, v.length - 1 - barsPerDay)]) },
        { oi: tail(v) },
      );
    });

    // OI-weighted funding rate (percent per funding interval)
    mk('fund', 1, async (c) => {
      const rows = await coinRows(c, '/api/futures/funding-rate/oi-weight-history', { interval: cfg.interval, limit: 30 });
      const v = rows.map((r) => num(r.close)).filter(Number.isFinite);
      if (!v.length) throw new Error('empty funding series');
      store.set(c, 'fund', { pct: v[v.length - 1], avg3: sum(v.slice(-3)) / Math.min(3, v.length) }, { fund: tail(v) });
    });

    // Top-trader long/short POSITION ratio and global long/short ACCOUNT ratio (Binance pair)
    mk('topPos', 1, async (c) => {
      const rows = sortRows(
        await cg.get('/api/futures/top-long-short-position-ratio/history', { exchange: 'Binance', symbol: c.pair, interval: cfg.interval, limit: 30 }),
      );
      const last = rows[rows.length - 1];
      if (!last) throw new Error('empty top position ratio');
      store.set(c, 'topPos', { ratio: num(last.top_position_long_short_ratio), longPct: num(last.top_position_long_percent) }, {
        topPos: tail(rows.map((r) => num(r.top_position_long_short_ratio))),
      });
    });

    mk('acct', 1, async (c) => {
      const rows = sortRows(
        await cg.get('/api/futures/global-long-short-account-ratio/history', { exchange: 'Binance', symbol: c.pair, interval: cfg.interval, limit: 30 }),
      );
      const last = rows[rows.length - 1];
      if (!last) throw new Error('empty account ratio');
      store.set(c, 'acct', { ratio: num(last.global_account_long_short_ratio), longPct: num(last.global_account_long_percent) }, {
        acct: tail(rows.map((r) => num(r.global_account_long_short_ratio))),
      });
    });

    // Aggregated futures / spot CVD (Startup+)
    if (cfg.features.aggCvd) {
      const cvdTask = (kind, path, group, seriesKey) =>
        mk(
          kind,
          1,
          async (c) => {
            const rows = await coinRows(c, path, { exchange_list: cfg.exchanges.join(','), interval: cfg.interval, limit: 60 });
            const buy = rows.map((r) => num(r.agg_taker_buy_vol));
            const sell = rows.map((r) => num(r.agg_taker_sell_vol));
            const cum = rows.map((r) => num(r.cum_vol_delta));
            const n = rows.length;
            const w = Math.min(12, n);
            const sb = sum(buy.slice(-w));
            const ss = sum(sell.slice(-w));
            const w4 = Math.min(4, n);
            const b4 = sum(buy.slice(-w4));
            const s4 = sum(sell.slice(-w4));
            store.set(c, group, { cvd: cum[n - 1], slope: sb + ss > 0 ? (sb - ss) / (sb + ss) : 0, taker: s4 > 0 ? b4 / s4 : null }, {
              [seriesKey]: tail(cum),
            });
          },
          { planLocked: true },
        );
      cvdTask('fcvd', '/api/futures/aggregated-cvd/history', 'fcvd', 'fcvd');
      cvdTask('scvd', '/api/spot/aggregated-cvd/history', 'scvd', 'scvd');
    }
  }

  // ---------- Binance: kline-derived RSI / CVD / net delta (free, keyless) ----------

  for (const coin of store.coins.values()) {
    const ttl = 5 * 60_000 * tierMult(coin.rank);
    task(bnTasks, {
      id: `kline:${coin.pair}`,
      prio: coin.rank,
      ttlMs: ttl,
      calls: 1,
      async run() {
        const k = await bn.klines(coin.pair, { limit: 100 });
        const f = flowMetrics(k);
        if (!f) throw new Error('short klines');
        const closes = k.map((x) => x.c);
        const { series, ...rest } = f;
        store.set(coin, 'kline', { ...rest, rsi: rsi(closes, 14) }, { kcvd: tail(series), price: tail(closes) });
      },
    });
    task(bnTasks, {
      id: `skline:${coin.pair}`,
      prio: coin.rank,
      ttlMs: ttl * 2,
      calls: 1,
      async run() {
        if (coin.noSpot) return;
        let k;
        try {
          k = await bn.klines(`${coin.cg}USDT`, { spot: true, limit: 48 });
        } catch (e) {
          if (e.invalidSymbol) {
            coin.noSpot = true;
            return;
          }
          throw e;
        }
        const f = flowMetrics(k);
        if (!f) throw new Error('short spot klines');
        const { series, ...rest } = f;
        store.set(coin, 'bscvd', rest, { bscvd: tail(series) });
      },
    });
  }

  return { cgTasks, bnTasks };
}

export { PlanError };
