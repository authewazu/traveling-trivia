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
5. **Updates:** commit and push in GitHub Desktop; Vercel redeploys automatically. If uploading through github.com instead, upload **all** of `index.html`, `vercel.json`, `README.md` and the `api`, `css`, `js`, `data` folders every time — same-named files are simply replaced. A partial upload (new JavaScript with an old `index.html`) makes the site show a red "Site files out of sync" banner naming what's missing.

Vercel installs `@anthropic-ai/sdk` for `api/explain.js` from `package.json`; nothing else is built.

If the API key is missing or a call is slow, the game still runs and shows the fallback line ("Here's a fact worth looking into!").

To check the AI call after deploying, open `https://<your-site>/api/explain?id=6` (the "closest planet to the sun" question; any `id` from `data/easy_trivia_pool_vetted.json` works) in a browser. It should return `{"correct": "..."}`. If it fails, the reply includes a short `reason`:

| `reason` | Meaning / fix |
|---|---|
| `missing_api_key` | `ANTHROPIC_API_KEY` isn't set for this deployment. Add it (Production environment) and redeploy. |
| `anthropic_401_authentication_error` | The key is wrong or was revoked. Re-copy it from console.anthropic.com (no quotes or spaces). |
| `anthropic_400_invalid_request_error` | Usually no billing credit on the Anthropic account; `detail` says which. |
| `anthropic_404_not_found_error` | The model id isn't available to this key; check `CLAUDE_MODEL`. |
| `timeout` | Claude took longer than 4.5s. Retrying later usually works. |

Full error details are under the project's Logs in Vercel.

## iPad kiosk setup

Target device: **12.9" iPad Pro, portrait** (1024×1366 CSS px).

**Covered bottom of the screen:** on the kiosk only the top of the screen is visible (down to about the 3rd leaderboard row, 1,102px of Safari's 1,292). Every page therefore lives in the top part: the game frame is pinned to the top and scaled down as a whole (same proportions, centered side to side) so nothing sits under the cover. The hidden strip is one value, `--covered-bottom` (200px) at the top of `css/styles.css`; change it if the enclosure changes, or set it to `0px` for full-screen use.

**Input:** tapping only by default. Hand tracking is on hold (`?input=hand` turns it on for testing).

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
js/scoring.js         1 point × streak multiplier
js/questions.js       question bank: loads the vetted pool, deals without repeats, fallback bank
js/pointer.js         hand-pose hover-to-select: cursor, 2s dwell, 2·1 countdown
js/hand.js            camera wrapper: front camera → ml5 handPose → fingertip → One Euro filter
data/easy_trivia_pool_vetted.json  the question database (hand-vetted Easy OpenTDB questions)
data/questions.json   older full OpenTDB snapshot (no longer used by the site)
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
- **Scoring**: Every correct answer is worth 1 point × the streak multiplier: 1st correct in a row ×1.0 (1.0 pt), 2nd ×1.5 (1.5 pts), 3rd ×2.0 (2.0 pts), and so on, uncapped. A wrong answer or timeout scores 0 and resets the multiplier to ×1.0. Scores show to one decimal place.
- **Game screen layout**: top bar = bus countdown · 10-second answer ring · score/streak; directly below it the question card, then the 2×2 answers (tall targets for hand hovering). There is no separate category or round row.
- **Categories**: The question card's background is its category's ombré, with the category name in small text at the top of the card (so color is never the only cue): General Knowledge (Figma EASY: yellow→orange), Geography (Figma MEDIUM: aqua→blue), History (Figma HARD: lavender→violet), Science & Nature (lime→green), Animals (mint→teal), Computers (orchid→plum), Mathematics (pink→coral). Colors live in `css/styles.css` (`[data-cat]` rules); labels in `CATEGORIES` (`js/config.js`).
- **Round timing**: 10s to answer, then the answer + explanation shows for 7s. Both countdowns drain as continuous CSS animations and freeze while the game is paused.
- **Session length**: min(next bus ETA, 6:00). The ETA comes from the soonest predicted arrival of either route at stop 6064.
- **ETA updates**: A later ETA is ignored. An ETA at least 5s earlier shortens the countdown and shows a pop-up. The same rule applies when the API was down at start and comes back.
- **API down**: Runs a 6:00 countdown with a dashed border, a "~" prefix, "No live bus data" and an "Estimate" tag. No bus banner in this mode.
- **Bus banner**: Appears when the bus the session is counting down to is ≤30s away, and pauses the round. Buses arriving within 30s of each other share one banner.
- **"That's not my bus"**: Dismisses the bus(es) in the banner, re-targets to the next bus (still capped at session start + 6:00), then runs 3-2-1. A resumed question gets at least 5s on the clock.
- **Banner reaches 0**: The session ends ("Your bus is here!") and the kiosk returns to idle after 15s.
- **Cap reached**: "Time's up!" with Play again.
- **Round cut off mid-question**: Points are only awarded at answer time, so the round never counts. Rounds already in the explanation phase have counted.
- **No answer in 10s**: Scores as wrong (0 points, multiplier reset).
- **Idle**: 3 rounds in a row that time out with no answer (10+7+10+7+10 = 44s) end the session with an "Idle session detected. Returning to title screen. Earned points have been saved." screen (BBH Hegarty, Figma MEDIUM/1). It returns to the title after 5s, or immediately on a tap. Answering any question resets the count. An untouched end screen returns to the title after 40s.
- **Attribution**: The game screen shows "Trivia questions from Open Trivia Database (opentdb.com), licensed under CC BY-SA 4.0." in small light text above the bus countdown, as the OpenTDB license requires.
- **Questions**: Served from `data/easy_trivia_pool_vetted.json`: 426 hand-vetted Easy, multiple-choice OpenTDB questions (General Knowledge, Science & Nature, Computers, Mathematics, Geography, History, Animals). Rounds are only dealt from difficulties the pool contains, so every round is currently Easy (1 point, Easy ombré); adding vetted Medium/Hard questions to the file brings the random mix back automatically. Each difficulty works like a shuffled deck: the iPad remembers which questions it has shown and doesn't repeat one until the deck is used up. If the file can't load, a small built-in bank covers it.
- **AI explanations**: There is exactly one explanation per question (why the correct answer is right), shown whether the rider picked right or wrong. When a question is dealt (up to 3 rounds ahead), the kiosk requests `GET /api/explain?id=<question id>`. The function looks the question up in `data/easy_trivia_pool_vetted.json` (so it can only explain bank questions) and asks Claude Haiku 4.5 for `{"correct": "<one sentence, under 20 words>"}` using structured JSON output and `max_tokens: 100`. Answers are cached in three places: the iPad's localStorage (keyed by question text), Vercel's CDN (30 days, cleared on redeploy), and a warm function's memory. Anything that fails, times out (5s), or comes back empty shows the fallback line and is never cached. If you switch question files, update `QUESTIONS_URL` (js/config.js), `QUESTIONS_FILE` (api/explain.js) and `includeFiles` (vercel.json) together.
- **Hand-pose answers**: See "Hand-pose input" below. Hovering the cursor on an answer, "That's not my bus", or "Play again" for 2s selects it; tapping still works as a backup.
- **Leaderboard**: Every answered round adds to today's total immediately. It shows the last 5 calendar days ranked by total, each labelled with its date ("Wed, Sep 23"); today also gets a TODAY badge. Earlier days with no real points show a mock total (15–70, stable per date, never stored); real totals always replace them. Turn off with `LEADERBOARD.mockPastDays` in config.

## Hand-pose input (ml5 handPose)

Two modules, no p5.js:

- **`js/hand.js` (the camera wrapper)** opens the iPad's front camera into an invisible `<video>` (the feed is never shown), loads ml5 1.4.0 from unpkg, and runs `handPose` (`maxHands: 1`, `modelType: 'full'`, `flipped: true`). handPose only finds hands (a palm detector + hand landmarks), never faces or bodies, and detections under 75% confidence are ignored. Each frame, the **index fingertip** is mapped from the camera frame onto the screen and smoothed with a One Euro filter, then handed to the hover engine.
- **`js/pointer.js` (the hover engine)** draws the cursor (shown whenever a hand is tracked), finds the target under it, and selects after a 2s hover with a 2·1 count beside the cursor.

Settings are in `HAND` (js/config.js):

| Setting | What it does |
|---|---|
| `region` | Which part of the camera frame maps onto the whole screen. Default `x 0.2–0.8, y 0.25–0.75`, estimated for an iPad ~2 ft+ up, tilted ~10° upward, rider ~2 ft away. Calibrate on the kiosk (below). |
| `filter` | Jitter control (One Euro). Lower `minCutoff` = steadier when still, more lag; higher `beta` = less lag when moving. Tested: holding still, cursor tremor is cut ~70%; a deliberate move arrives in ~0.1s. |
| `minConfidence` | Ignore detections below this (0.75). |
| `lostAfterMs` | Keep the cursor through detection dropouts shorter than this (400ms), so a flicker doesn't cancel a hover. |
| `jumpReset` | A jump this far in one frame (another person's hand) snaps the cursor instead of gliding. |
| `model.modelType` | `'full'` (steadier) or `'lite'` (faster). |

**Mirroring happens once, in ml5** (`flipped: true`). `videoToScreen` assumes that and doesn't flip again; flipping in both places would make the cursor move opposite to the hand.

**On the iPad:** the camera needs HTTPS (the Vercel URL; not `localhost` from another device) and permission. Safari asks the first time: tap **Allow**. If you denied it, re-enable under Settings → Apps → Safari → Camera, or the "aA" menu → Website Settings → Camera. If the camera is unavailable or denied, the game stays fully playable by tapping.

**Calibrating `region` on the kiosk:** open `https://<your-site>/?debug`. The panel's `hand:` lines show status, camera size, frames per second, confidence, and the fingertip's raw position (`tip`, 0–1 in the camera frame). Tap **Hand: reset range**, then stand where a rider would and point comfortably at the top-left and bottom-right answers. The `range` line now shows the area your hand covered; copy it into `HAND.region` (with a little margin) so that comfortable reach covers the screen.

Other input sources can drive the cursor through the same interface:

```js
TravelingTrivia.pointer.update(x, y);  // screen-normalized: 0..1 left→right, 0..1 top→bottom, selfie-mirrored
TravelingTrivia.pointer.lost();        // no hand in view: hides the cursor, cancels any countdown
```

Behavior details (tunable in `POINTER`, js/config.js):

- **Targets**: during a question, the four answer bubbles (the 2×2 grid); `?zones=screen` uses the four quadrants of the whole screen instead (A top-left … D bottom-right). On the bus banner, "That's not my bus". On the end screen (6-minute cap), "Play again". A completed hover presses the button exactly like a tap.
- **Dwell**: 2s continuous hover selects. Slipping off for under 250ms doesn't restart it; moving onto another answer restarts it there.
- **Resting hand**: when a new question appears, the answer the hand is already on doesn't count until the hand leaves it, so a hand left on B doesn't auto-pick B again.
- **Resting hand, everywhere**: the same rule applies whenever targets change, so a hand that happens to be where "That's not my bus" pops up doesn't dismiss the banner by accident.
- **Nothing else**: hovering does nothing during the reveal, loading, or 3·2·1 resume. "Tap to play" and "Done" are tap-only for now.
- **Input modes**: tapping only by default (no camera prompt, no cursor). `?input=hand` turns on camera hand tracking (on hold: it didn't pick up hands on the kiosk iPad yet); `?input=mouse` makes the mouse stand in for the hand.

## Refreshing or curating the questions

The site uses `data/easy_trivia_pool_vetted.json`, which you curate by hand. The older script below builds a different, unvetted snapshot (`data/questions.json`) of all difficulties:

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

A question's category is always written out on its chip, so the category colors are never the only cue. The Live and Estimate states differ in border style, text and "~", not only color. Screen-reader announcements go through an `aria-live` region, and `prefers-reduced-motion` is respected.
