import { getJson } from './http.js';
import { Spacer } from './limiter.js';

export class PlanError extends Error {}

// Thin CoinGlass v4 client: header auth, evenly paced, 429 backoff,
// and automatic disabling of endpoints the current plan cannot use.
export class CoinGlass {
  constructor(cfg) {
    this.cfg = cfg;
    this.spacer = new Spacer(cfg.cgRateLimit * cfg.cgBudget);
    this.planHits = new Map();
    this.disabled = new Set();
    this.stats = { calls: 0, errors: 0, rateLimited: 0, lastError: null, usage: null, max: null };
  }

  get enabled() {
    return Boolean(this.cfg.cgKey);
  }

  fail(e) {
    this.stats.errors++;
    this.stats.lastError = `${new Date().toISOString()} ${e.message}`;
  }

  async get(path, params = {}) {
    if (!this.enabled) throw new Error('CG_API_KEY not set');
    if (this.disabled.has(path)) throw new PlanError(`${path} is not available on the ${this.cfg.plan} plan`);
    await this.spacer.wait();

    const url = new URL(path, this.cfg.cgBase);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));

    let r;
    try {
      r = await getJson(url.toString(), { headers: { 'CG-API-KEY': this.cfg.cgKey, accept: 'application/json' } });
    } catch (e) {
      this.fail(e);
      throw e;
    }
    this.stats.calls++;
    this.stats.usage = r.headers.get('api-key-use-limit');
    this.stats.max = r.headers.get('api-key-max-limit');

    if (r.status === 429) {
      this.stats.rateLimited++;
      this.spacer.pause(15_000);
      const e = new Error('rate limited (429)');
      this.fail(e);
      throw e;
    }
    const b = r.body;
    if (!b) {
      const e = new Error(`HTTP ${r.status}`);
      this.fail(e);
      throw e;
    }
    if (String(b.code) !== '0') {
      const msg = String(b.msg || `code ${b.code}`);
      if (/upgrade|plan|permission|level|not available/i.test(msg)) {
        const n = (this.planHits.get(path) || 0) + 1;
        this.planHits.set(path, n);
        if (n >= 2) this.disabled.add(path); // two plan errors in a row => stop calling it
        const e = new PlanError(msg);
        this.fail(e);
        throw e;
      }
      const e = new Error(msg);
      this.fail(e);
      throw e;
    }
    this.planHits.delete(path);
    return b.data ?? [];
  }
}
