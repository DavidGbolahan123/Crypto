import { sleep } from './limiter.js';
import { PlanError } from './coinglass.js';

// "Most overdue first" task runner. Every task has a TTL; the one furthest past its
// TTL (relative to that TTL) runs next. Hot coins have short TTLs so they refresh
// more often; if the API budget is too small everything degrades proportionally
// instead of starving. The API client itself paces requests.
export class Runner {
  constructor(name, { concurrency = 1 } = {}) {
    this.name = name;
    this.concurrency = concurrency;
    this.tasks = [];
    this.running = false;
    this.stats = { done: 0, failed: 0 };
  }

  setTasks(tasks) {
    const old = new Map(this.tasks.map((t) => [t.id, t]));
    this.tasks = tasks.map((t) => {
      const prev = old.get(t.id);
      return prev ? Object.assign(t, { lastRun: prev.lastRun, fails: prev.fails, disabled: prev.disabled }) : t;
    });
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (let i = 0; i < this.concurrency; i++) this.loop();
  }

  stop() {
    this.running = false;
  }

  pick() {
    const now = Date.now();
    let best = null;
    let bestScore = 1;
    for (const t of this.tasks) {
      if (t.busy || t.disabled) continue;
      const backoff = 1 + Math.min(t.fails || 0, 5);
      const score = (now - t.lastRun) / (t.ttlMs * backoff) - t.prio * 1e-6;
      if (score >= bestScore) {
        best = t;
        bestScore = score;
      }
    }
    return best;
  }

  async loop() {
    while (this.running) {
      const t = this.pick();
      if (!t) {
        await sleep(400);
        continue;
      }
      t.busy = true;
      try {
        await t.run();
        t.fails = 0;
        t.lastErr = null;
        this.stats.done++;
      } catch (e) {
        t.fails = (t.fails || 0) + 1;
        t.lastErr = e.message;
        if (e instanceof PlanError && t.planLocked) t.disabled = true;
        this.stats.failed++;
      } finally {
        t.lastRun = Date.now();
        t.busy = false;
      }
    }
  }

  status(budgetPerMin) {
    const now = Date.now();
    const active = this.tasks.filter((t) => !t.disabled);
    const demand = active.reduce((s, t) => s + ((t.calls || 1) * 60_000) / t.ttlMs, 0);
    return {
      tasks: this.tasks.length,
      disabled: this.tasks.length - active.length,
      due: active.filter((t) => now - t.lastRun >= t.ttlMs).length,
      failing: active.filter((t) => t.fails > 0).length,
      demandPerMin: Math.round(demand),
      budgetPerMin: budgetPerMin ?? null,
      ...this.stats,
    };
  }
}
