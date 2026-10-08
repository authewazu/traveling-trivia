import { LEADERBOARD } from './config.js';

// Local calendar date as YYYY-MM-DD (en-CA formats that way).
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA');

function daysAgo(n) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // noon avoids DST edge cases when stepping back
  d.setDate(d.getDate() - n);
  return d;
}

// localStorage can throw (private mode, quota); the game must keep working.
function load() {
  try { return JSON.parse(localStorage.getItem(LEADERBOARD.storageKey)) ?? {}; } catch { return {}; }
}
function save(data) {
  try { localStorage.setItem(LEADERBOARD.storageKey, JSON.stringify(data)); } catch {}
}

// Placeholder total for a past day with no real points (testing/demo).
// Derived from the date, so a given day always shows the same number, and
// never stored, so real totals always win. Range LEADERBOARD.mockRange, in
// half points (the scoring unit).
function mockTotal(key) {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const [lo, hi] = LEADERBOARD.mockRange;
  return lo + ((h >>> 0) % ((hi - lo) * 2 + 1)) / 2;
}

export function addPoints(points) {
  const data = load();
  const key = dayKey();
  data[key] = (data[key] ?? 0) + points;
  // Keep a month of history; the board only shows the last 5 days.
  const cutoff = dayKey(daysAgo(30));
  for (const k of Object.keys(data)) if (k < cutoff) delete data[k];
  save(data);
  return data[key];
}

export function todayTotal() {
  return load()[dayKey()] ?? 0;
}

export function recentDays() {
  const data = load();
  // Always an explicit date, e.g. "Wed, Sep 23"; today is flagged by a badge instead.
  const fmt = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const days = Array.from({ length: LEADERBOARD.days }, (_, i) => {
    const d = daysAgo(i);
    const key = dayKey(d);
    // Today is always real; earlier days without real points get a mock total.
    const real = data[key];
    const useMock = i > 0 && real == null && LEADERBOARD.mockPastDays;
    return {
      key,
      label: fmt.format(d),
      total: useMock ? mockTotal(key) : real ?? 0,
      isToday: i === 0,
    };
  });
  return days.sort((a, b) => b.total - a.total || (a.isToday ? -1 : 1));
}
