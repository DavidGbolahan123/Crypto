export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Evenly spaces requests so we never burst past the per-minute budget.
export class Spacer {
  constructor(perMin) {
    this.gap = 60_000 / Math.max(perMin, 0.1);
    this.next = 0;
    this.pausedUntil = 0;
  }

  async wait() {
    const now = Date.now();
    const at = Math.max(now, this.next, this.pausedUntil);
    this.next = at + this.gap;
    if (at > now) await sleep(at - now);
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms);
  }
}
