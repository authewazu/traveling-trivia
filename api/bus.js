import { extractArrivals } from './_lib/gtfsrt.js';

// SEPTA's realtime endpoints send no CORS headers, so the browser can't call
// them directly; this function proxies and trims the feed to our one stop.
const FEED_URL = 'https://www3.septa.org/gtfsrt/septa-pa-us/Trip/rtTripUpdates.pb';
const STOP_ID = '6064'; // Chestnut St & 20th St
const ROUTES = new Set(['21', '42']);
const STALE_FEED_SEC = 300;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const upstream = await fetch(FEED_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!upstream.ok) throw new Error(`SEPTA HTTP ${upstream.status}`);

    const buf = new Uint8Array(await upstream.arrayBuffer());
    const { feedTimestamp, arrivals } = extractArrivals(buf, { stopId: STOP_ID, routes: ROUTES });
    const now = Math.floor(Date.now() / 1000);
    if (feedTimestamp && now - feedTimestamp > STALE_FEED_SEC) {
      throw new Error(`SEPTA feed is stale (${now - feedTimestamp}s old)`);
    }

    res.status(200).json({
      ok: true,
      now,
      feedTimestamp,
      stop: STOP_ID,
      arrivals: arrivals.filter((a) => a.arrival > now - 60),
    });
  } catch (err) {
    console.error('[api/bus]', err);
    res.status(502).json({ ok: false, error: String(err?.message ?? err) });
  }
}
