const env = process.env;
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

// CoinGlass published per-minute limits by plan.
const PLAN_RATE = { hobbyist: 30, startup: 80, standard: 300, professional: 1200, enterprise: 1200 };

export const intervalMinutes = (iv) => {
  const m = /^(\d+)([mhdw])$/.exec(iv);
  if (!m) throw new Error(`Bad interval: ${iv}`);
  return Number(m[1]) * { m: 1, h: 60, d: 1440, w: 10080 }[m[2]];
};

const plan = (env.CG_PLAN || 'hobbyist').toLowerCase();
const higher = ['standard', 'professional', 'enterprise'].includes(plan);

// Hobbyist history endpoints only allow intervals >= 4h; Startup >= 30m.
const interval = env.CG_INTERVAL || (plan === 'hobbyist' ? '4h' : '1h');

export const config = {
  port: num(env.PORT, 8787),
  plan,
  cgKey: env.CG_API_KEY || '',
  cgBase: env.CG_BASE || 'https://open-api-v4.coinglass.com',
  binanceFapi: env.BINANCE_FAPI_BASE || 'https://fapi.binance.com',
  binanceSpot: env.BINANCE_SPOT_BASE || 'https://api.binance.com',
  universeSize: num(env.UNIVERSE_SIZE, 200),
  cgRateLimit: num(env.CG_RATE_LIMIT, PLAN_RATE[plan] ?? 30),
  cgBudget: num(env.CG_BUDGET, 0.8), // fraction of the plan limit we allow ourselves to use
  binanceRpm: num(env.BINANCE_RPM, 300),
  interval,
  intervalMin: intervalMinutes(interval),
  exchanges: (env.CG_EXCHANGES || 'Binance,OKX,Bybit').split(',').map((s) => s.trim()).filter(Boolean),
  priceRefreshMs: num(env.PRICE_REFRESH_MS, 4000),
  dataDir: env.DATA_DIR || './data',
  features: {
    aggCvd: plan !== 'hobbyist', // aggregated CVD endpoints: Startup+
    netflow: plan !== 'hobbyist', // Coin NetFlow List: Startup+
    rsiList: higher, // Coin RSI List: Standard+
  },
};

// How often the hottest coins get refreshed. Colder coins are multiples of this.
config.ttlBaseMs = num(env.CG_TTL_MS, Math.max(60_000, (config.intervalMin * 60_000) / 12));
config.staleMs = Math.max(config.ttlBaseMs * 12, 30 * 60_000);
