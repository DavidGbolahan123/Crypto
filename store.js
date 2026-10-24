import fs from 'node:fs';
import path from 'node:path';

const newCoin = () => ({ live: null, m: {}, s: {}, useBase: false, symTried: false, noSpot: false });

// In-memory cache of everything we know per coin. m = metric groups (each with a
// timestamp), s = short series used for sparklines. Snapshotted to disk so a
// restart does not throw away a slow Hobbyist-tier sweep.
export class Store {
  constructor(dataDir) {
    this.dir = dataDir;
    this.file = path.join(dataDir, 'cache.json');
    this.coins = new Map(); // key: Binance pair, e.g. 1000PEPEUSDT
    this.bySymbol = new Map(); // CoinGlass symbol / base asset -> coin
    this.global = { fng: null };
  }

  setUniverse(list) {
    const next = new Map();
    for (const u of list) {
      const c = this.coins.get(u.pair) || newCoin();
      Object.assign(c, { pair: u.pair, base: u.base, cg: u.cg, rank: u.rank, symbol: u.cg });
      next.set(u.pair, c);
    }
    this.coins = next;
    this.bySymbol = new Map();
    for (const c of [...next.values()].sort((a, b) => a.rank - b.rank)) {
      if (!this.bySymbol.has(c.cg)) this.bySymbol.set(c.cg, c);
      if (!this.bySymbol.has(c.base)) this.bySymbol.set(c.base, c);
    }
  }

  set(coin, group, data, series) {
    coin.m[group] = { ...data, ts: Date.now() };
    if (series) Object.assign(coin.s, series);
  }

  setLive(pair, live) {
    const c = this.coins.get(pair);
    if (c) c.live = { ...live, ts: Date.now() };
  }

  load() {
    try {
      const snap = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      let n = 0;
      for (const [pair, v] of Object.entries(snap.coins || {})) {
        const c = this.coins.get(pair);
        if (c) {
          c.m = v.m || {};
          c.s = v.s || {};
          n++;
        }
      }
      this.global = { ...this.global, ...(snap.global || {}) };
      return n;
    } catch {
      return 0;
    }
  }

  save() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const coins = {};
      for (const [pair, c] of this.coins) coins[pair] = { m: c.m, s: c.s };
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ savedAt: Date.now(), coins, global: this.global }));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn('cache save failed:', e.message);
    }
  }
}
