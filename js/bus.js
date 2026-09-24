import { BUS } from './config.js';

const STALE_AFTER_MS = 90_000;
const FETCH_TIMEOUT_MS = 8_000;

// Polls /api/bus (our serverless proxy; SEPTA sends no CORS headers) and keeps
// a list of predicted arrivals at the stop, in the kiosk's own clock.
export class BusFeed {
  constructor(onChange) {
    this.onChange = onChange;
    this.status = 'loading'; // 'loading' | 'live' | 'down'
    this.arrivals = []; // [{ route, trip, at }] where `at` is a Date.now()-based ms time
    this.lastOkAt = 0;
    this.sim = null; // debug override: null | { down: true } | { arrivals: [...] }
    this.timer = null;
  }

  setPollInterval(ms) {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh(), ms);
  }

  async refresh() {
    if (this.sim) {
      this.status = this.sim.down ? 'down' : 'live';
      this.arrivals = this.sim.down ? [] : this.sim.arrivals.slice();
      this.onChange();
      return;
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(BUS.endpoint, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(t);
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Convert server-clock epoch seconds into local-clock ms so a kiosk
      // with a drifting clock still counts down correctly.
      const received = Date.now();
      this.arrivals = json.arrivals.map((a) => ({
        route: a.route,
        trip: a.trip,
        at: received + (a.arrival - json.now) * 1000,
      }));
      this.status = 'live';
      this.lastOkAt = received;
    } catch (err) {
      console.warn('[bus] feed unavailable', err);
      if (Date.now() - this.lastOkAt > STALE_AFTER_MS) {
        this.status = 'down';
        this.arrivals = [];
      }
    }
    this.onChange();
  }

  // Arrivals still ahead of us, soonest first, skipping trips the rider dismissed.
  upcoming(now = Date.now(), exclude = new Set()) {
    return this.arrivals
      .filter((a) => a.at > now && !exclude.has(a.trip))
      .sort((a, b) => a.at - b.at);
  }

  nextByRoute(now = Date.now()) {
    const out = {};
    for (const a of this.upcoming(now)) out[a.route] ??= a;
    return out;
  }
}
