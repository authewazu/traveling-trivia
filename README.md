# Traveling Trivia

A trivia kiosk for the Chestnut St & 20th St bus stop (SEPTA Routes 21 and 42). Plain HTML, CSS and JS with no build step, plus two Vercel serverless functions.

## Run locally

This needs only Python, not Node:

```
python dev/server.py
```

Open http://localhost:8000. The dev server serves the site, returns real SEPTA data from `/api/bus`, and returns mock text from `/api/explain`.

| URL flag | Effect |
|---|---|
| `?debug` | Adds a test panel: fake buses, earlier/later ETAs, API outage, jump to the cap |
| `?speed=6` | Divides every timer by 6 (15s answer → 2.5s, 6-min cap → 1 min) |

## Deploy (Vercel)

1. **Put the folder on GitHub.** In GitHub Desktop: File → Add local repository → pick this `Bus stop interface` folder → "create a repository" → commit → Publish repository (private is fine).
2. **Import it into Vercel.** Sign in at vercel.com with GitHub → Add New → Project → Import the repo. Framework preset: **Other**. Leave the build command and output directory empty. Deploy.
3. **Add the API key.** Get a key at console.anthropic.com (set a monthly spend limit there too). In Vercel: Project → Settings → Environment Variables, add:
   - `ANTHROPIC_API_KEY` (required for AI explanations)
   - `CLAUDE_MODEL` (optional; defaults to `claude-haiku-4-5-20251001`)
4. **Redeploy** (Deployments → ⋯ → Redeploy). Environment variables only apply to new deployments.
5. **Updates:** commit and push in GitHub Desktop; Vercel redeploys automatically.

Vercel installs `@anthropic-ai/sdk` for `api/explain.js` from `package.json`; nothing else is built.

If the API key is missing or a call is slow, the game still runs and shows the fallback line ("Here's a fact worth looking into!").

To check the AI call after deploying, open `https://<your-site>/api/explain?id=<a question id from data/questions.json>` in a browser. It should return `{"correct": "..."}`. Errors show up under the project's Logs in Vercel.

## iPad kiosk setup

Target device: **12.9" iPad Pro, portrait** (1024×1366 CSS px).

- In Safari, use Share → Add to Home Screen, then launch the app from the icon. It runs full screen with no browser chrome.
- Turn on Settings → Accessibility → Guided Access, then triple-click to lock the iPad to the app.
- Set Settings → Display → Auto-Lock to Never.
- Sound starts after the first tap, because iOS blocks audio until a user gesture.

## Files

```
index.html            all screens (idle, game, end) and overlays
css/styles.css        design tokens in :root; container-query sizing (portrait 3:4)
js/config.js          every timing/scoring constant
js/main.js            state machine: session, rounds, bus alert, idle reset
js/difficulty.js      even-odds picker, max 3 in a row
js/scoring.js         base points × streak multiplier
js/questions.js       question bank: loads data/questions.json, deals without repeats, fallback bank
data/questions.json   curated OpenTDB snapshot (built by dev/fetch_questions.py)
js/explain.js         client for /api/explain: device cache, 5s deadline, fallback line
js/bus.js             polls /api/bus, converts to local-clock arrival times
js/leaderboard.js     daily totals in localStorage, seeded placeholders
js/sound.js           synthesized Web Audio cues
js/debug.js           ?debug panel
api/bus.js            proxies SEPTA GTFS-realtime, filtered to stop 6064
api/_lib/gtfsrt.js    tiny protobuf reader (no dependency)
api/explain.js        Claude Haiku call (JSON output), keyed by question id; key stays server-side
dev/server.py         local stand-in for Vercel
dev/fetch_questions.py  rebuilds data/questions.json from OpenTDB
```

## Behavior decisions (spec → code)

- **Loading screen**: "Tap to play" and "Play again" show a 4s screen with the message "Don't let the tech do all your thinking for you." (BBH Hegarty, caps, 16pt) and the course disclaimer. Meanwhile the first 3 rounds are dealt and their explanations start generating; during play, 3 rounds always stay queued ahead. Queued rounds that never get played go back into the deck. The 6-minute cap starts after the loading screen.
- **Round timing**: 15s to answer, then the answer + explanation shows for 7s. Both countdowns drain as continuous CSS animations and freeze while the game is paused.
- **Session length**: min(next bus ETA, 6:00). The ETA comes from the soonest predicted arrival of either route at stop 6064.
- **ETA updates**: A later ETA is ignored. An ETA at least 5s earlier shortens the countdown and shows a pop-up. The same rule applies when the API was down at start and comes back.
- **API down**: Runs a 6:00 countdown with a dashed border, a "~" prefix, "No live bus data" and an "Estimate" tag. No bus banner in this mode.
- **Bus banner**: Appears when the bus the session is counting down to is ≤30s away, and pauses the round. Buses arriving within 30s of each other share one banner.
- **"That's not my bus"**: Dismisses the bus(es) in the banner, re-targets to the next bus (still capped at session start + 6:00), then runs 3-2-1. A resumed question gets at least 5s on the clock.
- **Banner reaches 0**: The session ends ("Your bus is here!") and the kiosk returns to idle after 15s.
- **Cap reached**: "Time's up!" with Play again.
- **Round cut off mid-question**: Points are only awarded at answer time, so the round never counts. Rounds already in the explanation phase have counted.
- **No answer in 15s**: Scores as wrong (0 points, multiplier reset).
- **Idle 40s**: Returns to the idle screen, measured from the last touch. Paused while the bus banner or 3-2-1 is up.
- **Questions**: Served from `data/questions.json`, a snapshot of every multiple-choice OpenTDB question in the sanctioned categories (9 General Knowledge, 17 Science & Nature, 18 Computers, 19 Mathematics, 22 Geography, 23 History, 24 Politics, 27 Animals, 30 Gadgets). Each difficulty works like a shuffled deck: the iPad remembers which questions it has shown and doesn't repeat one until that difficulty's deck is used up. If the file can't load, a small built-in bank (same categories) covers it.
- **AI explanations**: There is exactly one explanation per question (why the correct answer is right), shown whether the rider picked right or wrong. When a question is dealt (up to 3 rounds ahead), the kiosk requests `GET /api/explain?id=<question id>`. The function looks the question up in `data/questions.json` (so it can only explain bank questions) and asks Claude Haiku 4.5 for `{"correct": "<one sentence, under 20 words>"}` using structured JSON output and `max_tokens: 100`. Answers are cached by question in three places: the iPad's localStorage, Vercel's CDN (30 days, cleared on redeploy), and a warm function's memory. Anything that fails, times out (5s), or comes back empty shows the fallback line and is never cached.
- **Leaderboard**: Every answered round adds to today's total immediately. It shows the last 5 calendar days ranked by total, each labelled with its date ("Wed, Sep 23"); today also gets a TODAY badge. The 4 days before first launch get placeholder values (`LEADERBOARD.seed` in config).

## Refreshing or curating the questions

```
python dev/fetch_questions.py
```

This rebuilds `data/questions.json` from OpenTDB (about 5 minutes, because OpenTDB allows one request every 5 seconds). To change categories, edit `CATEGORIES` at the top of the script. To curate, open the JSON and delete or fix entries in `questions`; each entry is plain text (entities already decoded). OpenTDB content is licensed CC BY-SA 4.0, which requires crediting "Open Trivia Database" where the questions are shown.

## Sound ↔ visual pairs (accessibility)

| Sound | Visual |
|---|---|
| Correct chime | Green bubble + ✓ in the letter slot + "Correct answer" tag + "Correct!" verdict |
| Wrong buzz (also plays on timeout) | Red bubble + ✗ + "Your answer" tag + "Incorrect" verdict (or "Time's up · Incorrect"); correct answer also marked |
| Last-5-second ticks | Ring turns red, number pulses and turns red |
| Bus chime | Full-screen banner with hazard stripe, flashing ring, route badge, seconds count |
| ETA update | Toast with info icon and text |
| 3-2-1 beeps | Giant numerals |

Difficulty is shown as a text label plus 1/2/3 filled dots, not just color. The Live and Estimate states differ in border style, text and "~", not only color. Screen-reader announcements go through an `aria-live` region, and `prefers-reduced-motion` is respected.
