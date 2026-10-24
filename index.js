import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config as cfg } from './config.js';
import { Store } from './store.js';
import { CoinGlass } from './coinglass.js';
import { Binance } from './binance.js';
import { Runner } from './scheduler.js';
import { buildTasks } from './tasks.js';
import { analyze } from './signals.js';
import { sleep } from './limiter.js';

const store = new Store(cfg.dataDir);
const cg = new CoinGlass(cfg);
const bn = new Binance(cfg);
const cgRunner = new Runner('coinglass', { concurrency: 1 });
const bnRunner = new Runner('binance', { concurrency: 4 });

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const lastLog = new Map();
const logOnce = (key, msg, everyMs = 60_000) => {
  if (Date.now() - (lastLog.get(key) || 0) > everyMs) {
    lastLog.set(key, Date.now());
    log(msg);
  }
};

// ---------- universe: top N Binance USDT perps by 24h quote volume ----------

async function loadUniverse() {
  const [info, tick] = await Promise.all([bn.exchangeInfo(), bn.tickers24h()]);
  const vol = new Map(tick.map((t) => [t.symbol, Number(t.quoteVolume)]));
  const list = info.symbols
    .filter((s) => s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT' && s.status === 'TRADING' && !s.symbol.includes('_'))
    .sort((a, b) => (vol.get(b.symbol) || 0) - (vol.get(a.symbol) || 0))
    .slice(0, cfg.universeSize)
    .map((s, i) => ({
      pair: s.symbol,
      base: s.baseAsset,
      cg: s.baseAsset.replace(/^(1000000|1000|1M)(?=[A-Z])/, ''),
      rank: i + 1,
    }));
  store.setUniverse(list);
  return list.length;
}

function rebuildTasks() {
  const { cgTasks, bnTasks } = buildTasks({ cfg, store, cg, bn });
  cgRunner.setTasks(cgTasks);
  bnRunner.setTasks(bnTasks);
}

// ---------- live prices + funding: two bulk calls cover every symbol ----------

async function refreshLive() {
  try {
    const [tick, prem] = await Promise.all([bn.tickers24h(), bn.premiumIndex()]);
    const p = new Map(prem.map((x) => [x.symbol, x]));
    for (const t of tick) {
      const pi = p.get(t.symbol);
      store.setLive(t.symbol, {
        price: Number(t.lastPrice),
        chg24h: Number(t.priceChangePercent),
        vol24h: Number(t.quoteVolume),
        funding: pi ? Number(pi.lastFundingRate) * 100 : null, // percent per 8h
        mark: pi ? Number(pi.markPrice) : null,
        nextFunding: pi ? Number(pi.nextFundingTime) : null,
      });
    }
  } catch (e) {
    logOnce('live', `live price refresh failed: ${e.message}`);
  }
}

// ---------- HTTP API ----------

const app = express();
app.disable('x-powered-by');

const rows = () => [...store.coins.values()].map((c) => analyze(c, store.global, cfg));

app.get('/api/signals', (_req, res) => {
  res.json({ ts: Date.now(), interval: cfg.interval, plan: cfg.plan, fng: store.global.fng?.value ?? null, coins: rows() });
});

app.get('/api/coin/:id', (req, res) => {
  const coin = store.coins.get(req.params.id.toUpperCase());
  if (!coin) return res.status(404).json({ error: 'unknown symbol' });
  res.json({ row: analyze(coin, store.global, cfg), series: coin.s, groups: coin.m, live: coin.live });
});

app.get('/api/status', (_req, res) => {
  const coins = [...store.coins.values()];
  const loaded = (g) => coins.filter((c) => c.m[g]).length;
  res.json({
    plan: cfg.plan,
    interval: cfg.interval,
    universe: coins.length,
    coinglass: {
      keyPresent: cg.enabled,
      ...cg.stats,
      disabledEndpoints: [...cg.disabled],
      queue: cgRunner.status(Math.round(cfg.cgRateLimit * cfg.cgBudget)),
    },
    binance: { ...bn.stats, queue: bnRunner.status(cfg.binanceRpm) },
    loaded: Object.fromEntries(['oi', 'fund', 'topPos', 'acct', 'liq', 'net', 'fcvd', 'scvd', 'kline', 'bscvd'].map((g) => [g, loaded(g)])),
    features: cfg.features,
    fng: store.global.fng?.value ?? null,
    uptimeSec: Math.round(process.uptime()),
  });
});

const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
} else {
  app.get('/', (_req, res) => res.type('text').send('API is running. Build the dashboard with `npm run build`, or run `npm run dev:web`.'));
}

// ---------- boot ----------

async function main() {
  app.listen(cfg.port, () => log(`API on http://localhost:${cfg.port}  plan=${cfg.plan} interval=${cfg.interval}`));
  if (!cg.enabled) log('WARNING: CG_API_KEY not set. Running on Binance public data only (prices, RSI, kline CVD/net delta).');

  for (;;) {
    try {
      const n = await loadUniverse();
      const cached = store.load();
      log(`universe: ${n} perps (restored cache for ${cached})`);
      break;
    } catch (e) {
      log(`universe load failed (${e.message}); retrying in 10s`);
      await sleep(10_000);
    }
  }

  await refreshLive();
  setInterval(refreshLive, cfg.priceRefreshMs);

  rebuildTasks();
  if (cg.enabled) cgRunner.start();
  bnRunner.start();

  setInterval(() => store.save(), 60_000);
  setInterval(async () => {
    try {
      await loadUniverse();
      rebuildTasks();
    } catch (e) {
      logOnce('uni', `universe refresh failed: ${e.message}`);
    }
  }, 6 * 3_600_000);

  const q = cgRunner.status(Math.round(cfg.cgRateLimit * cfg.cgBudget));
  log(`CoinGlass demand ~${q.demandPerMin} calls/min vs budget ${q.budgetPerMin}/min`);
  if (q.demandPerMin > q.budgetPerMin) log('Demand exceeds budget: all coins will refresh proportionally slower (hot coins stay freshest).');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    store.save();
    process.exit(0);
  });
}

main();
