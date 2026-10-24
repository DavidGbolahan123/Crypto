import { getJson } from './http.js';
import { Spacer } from './limiter.js';

// Public, keyless Binance market data. Used for: the coin universe, live prices
// (one bulk call for all symbols) and kline-derived RSI / CVD / net delta.
export class Binance {
  constructor(cfg) {
    this.cfg = cfg;
    this.spacer = new Spacer(cfg.binanceRpm);
    this.stats = { calls: 0, errors: 0, lastError: null };
  }

  async _get(base, path, params = {}, paced = true) {
    if (paced) await this.spacer.wait();
    const url = new URL(path, base);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    let r;
    try {
      r = await getJson(url.toString());
    } catch (e) {
      this.stats.errors++;
      this.stats.lastError = `${new Date().toISOString()} ${e.message}`;
      throw e;
    }
    this.stats.calls++;
    if (r.status === 429 || r.status === 418) {
      this.spacer.pause(60_000);
      throw new Error(`Binance rate limited (${r.status})`);
    }
    if (!r.ok) {
      const e = new Error(`Binance ${path} HTTP ${r.status} ${r.body?.msg || r.text}`);
      e.invalidSymbol = r.body?.code === -1121;
      this.stats.errors++;
      this.stats.lastError = `${new Date().toISOString()} ${e.message}`;
      throw e;
    }
    return r.body;
  }

  exchangeInfo() {
    return this._get(this.cfg.binanceFapi, '/fapi/v1/exchangeInfo', {}, false);
  }
  tickers24h() {
    return this._get(this.cfg.binanceFapi, '/fapi/v1/ticker/24hr', {}, false);
  }
  premiumIndex() {
    return this._get(this.cfg.binanceFapi, '/fapi/v1/premiumIndex', {}, false);
  }

  async klines(symbol, { spot = false, limit = 48 } = {}) {
    const rows = spot
      ? await this._get(this.cfg.binanceSpot, '/api/v3/klines', { symbol, interval: '1h', limit })
      : await this._get(this.cfg.binanceFapi, '/fapi/v1/klines', { symbol, interval: '1h', limit });
    // [openTime, o, h, l, c, vol, closeTime, quoteVol, trades, takerBuyBase, takerBuyQuote, _]
    return rows.map((r) => ({ t: r[0], c: Number(r[4]), q: Number(r[7]), tbq: Number(r[10]) }));
  }
}
