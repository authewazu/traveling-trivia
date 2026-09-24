import { EXPLAIN_ENDPOINT, TIMING } from './config.js';

// Shown whenever the AI explanation is missing, slow, or malformed, so the
// explanation slot is never blank.
export const FALLBACK_TEXT = "Here's a fact worth looking into!";

// Device-side cache (id -> sentence). The kiosk is one shared iPad, so this
// persists explanations across riders and days; the server's CDN cache
// covers everything else.
const CACHE_KEY = 'tbs.explain.v1';
let cache = {};
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY)) ?? {}; } catch {}

function remember(id, text) {
  cache[id] = text;
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch {}
}

const fallback = () => ({ text: FALLBACK_TEXT, source: 'fallback' });

// Called the moment a question appears. Always resolves (never rejects)
// within the deadline: the cached or freshly generated sentence, or the
// fallback line.
export function requestExplanation(q) {
  if (!q.id) return Promise.resolve(fallback()); // built-in backup questions have no id
  if (cache[q.id]) return Promise.resolve({ text: cache[q.id], source: 'cache' });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMING.explainDeadlineMs);
  return fetch(`${EXPLAIN_ENDPOINT}?id=${encodeURIComponent(q.id)}`, { signal: ctrl.signal })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
    .then((json) => {
      const text = typeof json.correct === 'string' ? json.correct.trim() : '';
      if (!text) return fallback();
      remember(q.id, text);
      return { text, source: 'ai' };
    })
    .catch(() => fallback())
    .finally(() => clearTimeout(timer));
}
