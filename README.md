# Perp Signal Scanner

Scores ~200 Binance USDT perps with a four-tier signal hierarchy, using CoinGlass aggregated derivatives data plus free Binance public data. Node backend (polls, paces and caches) + React dashboard.

## Run it

```bash
npm install
cp .env.example .env        # add CG_API_KEY, set CG_PLAN
npm run build               # builds the dashboard into web/dist
npm start                   # http://localhost:8787
```

Dev mode: `npm run dev:server` and `npm run dev:web` (UI on :5173, proxies /api).
Offline demo with fake upstreams: `npm run mock` (set `CG_PLAN=hobbyist|startup|standard`).

Check `http://localhost:8787/api/status` after boot: warm-up progress, CoinGlass load vs budget, endpoints your plan locked out.

## Data map

| Metric | Source | Plan |
|---|---|---|
| Live price, 24h %, volume, live funding | Binance (2 bulk calls / 4s) | free |
| Aggregated OI, OI delta (bar, 24h) | CoinGlass `open-interest/aggregated-history`, per coin | Hobbyist+ |
| Funding (OI-weighted) | CoinGlass `funding-rate/oi-weight-history`, per coin | Hobbyist+ |
| Liquidations 1h/4h/12h/24h, long vs short | CoinGlass `liquidation/coin-list`, one call per exchange for all coins, summed | Hobbyist+ |
| L/S account ratio, L/S top-position ratio | CoinGlass `global-long-short-account-ratio`, `top-long-short-position-ratio` (Binance pair) | Hobbyist+ |
| Aggregated futures CVD, spot CVD | CoinGlass `aggregated-cvd/history` | Startup+ |
| Net delta (taker buy - sell) | CoinGlass `netflow-list` (bulk) | Startup+ |
| RSI | CoinGlass `rsi/list` (bulk) | Standard+ |
| Fear & Greed | CoinGlass `fear-greed-history` | Hobbyist+ |
| RSI, futures CVD, spot CVD, net delta fallback | Binance 1h klines (taker buy volume), Binance-only | free |

A small dot beside each value shows its source: amber = CoinGlass aggregated, blue = Binance only. When your plan locks an endpoint, the app stops calling it after two refusals and uses the Binance fallback.

## How the rate limit is handled

CoinGlass limits are per minute (Hobbyist 30, Startup 80, Standard 300). The app spends at most `CG_BUDGET` (default 80%) of that, evenly spaced. Tasks are ordered "most overdue first": the top 30 coins by volume refresh at the base TTL, ranks 31-100 at 2x, the rest at 4x. If demand exceeds the budget, every coin just refreshes proportionally slower. The cache is saved to `data/cache.json` every minute so a restart doesn't repeat a slow sweep.

## Scoring

Each tier scores -1..+1; tiers combine with weights 4/3/2/1 into a -100..+100 score. LONG >= +25, SHORT <= -25. Grade A = 3+ tiers agree, B = 2, C = 1. No direction is called until 80% of inputs have fresh data (shows WARM).

1. **T1** futures CVD slope + taker buy/sell ratio
2. **T2** net delta (4h) + OI-vs-price regime (price up/OI up = trend confirmation; price up/OI down = weak, short covering)
3. **T3** top-trader position ratio (follow) + funding (fade the crowd; +/-0.05% is extreme)
4. **T4** spot CVD + Fear & Greed extremes (contrarian below 25 / above 75)

Flags: CRWD-L/S (account ratio >= 2 or <= 0.7), FND+/FND- (funding beyond +/-0.05%), LIQ! (1h liquidations >= 0.2% of OI).

All thresholds and weights live in `server/signals.js`. They are starting points, not tuned values. Backtest before trusting them.

## Known limits

- CoinGlass does not aggregate long/short ratios across exchanges; those come from the Binance pair.
- On Hobbyist, history endpoints only allow 4h+ bars, so OI/funding/ratios move every 4h by design. Live price, liquidations and Binance-derived flow are fresher.
- Built and tested against a mock upstream that mirrors the documented response shapes. First run against the real API: watch `/api/status` for errors.
