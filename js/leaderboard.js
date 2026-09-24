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

export function seedIfNeeded() {
  try {
    if (localStorage.getItem(LEADERBOARD.seededKey)) return;
    const data = load();
    LEADERBOARD.seed.forEach((total, i) => {
      const key = dayKey(daysAgo(i + 1));
      if (data[key] == null) data[key] = total;
    });
    save(data);
    localStorage.setItem(LEADERBOARD.seededKey, '1');
  } catch {}
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
    return {
      key: dayKey(d),
      label: fmt.format(d),
      total: data[dayKey(d)] ?? 0,
      isToday: i === 0,
    };
  });
  return days.sort((a, b) => b.total - a.total || (a.isToday ? -1 : 1));
}
