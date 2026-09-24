import { TIMING } from './config.js';

// Test harness, only loaded with ?debug in the URL. Lets you fake the bus
// feed so the arrival banner, earlier-ETA pop-up, and 6-minute cap can be
// exercised without waiting for a real bus. Combine with ?speed=6 to shrink
// every timer.
export function mountDebug({ bus, getSession, getBank }) {
  window.__trivia = { bus, getSession, getBank }; // for console poking
  let n = 0;
  const sim = () => (bus.sim && !bus.sim.down ? bus.sim : (bus.sim = { arrivals: [] }));
  // The bus the session is actually counting down to (skips dismissed/passed ones).
  const nextSim = () => {
    const skip = getSession()?.dismissed ?? new Set();
    return sim().arrivals.filter((a) => a.at > Date.now() && !skip.has(a.trip)).sort((x, y) => x.at - y.at)[0];
  };

  const actions = {
    'Sim: bus 21 due soon': () => {
      sim().arrivals = [
        { route: '21', trip: `sim-${++n}`, at: Date.now() + TIMING.busWarningMs * 1.25 }, // banner ~15s later
        { route: '42', trip: `sim-${++n}`, at: Date.now() + TIMING.sessionCapMs * 0.75 },
      ];
    },
    'Sim: next bus 60s earlier': () => {
      const a = nextSim();
      if (a) a.at -= TIMING.busWarningMs;
    },
    'Sim: next bus 90s later': () => {
      const a = nextSim();
      if (a) a.at += TIMING.busWarningMs * 1.5;
    },
    'Sim: no buses before cap': () => { sim().arrivals = []; },
    'Sim: bus API down': () => { bus.sim = { down: true }; },
    'Use live bus API': () => { bus.sim = null; },
    'Jump to 6-min cap (3s)': () => {
      const s = getSession();
      if (s) Object.assign(s, { capAt: Date.now() + 3000, deadline: Date.now() + 3000, source: 'cap', tracked: null });
    },
  };

  const panel = document.createElement('div');
  panel.className = 'debug';
  for (const [label, fn] of Object.entries(actions)) {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { fn(); bus.refresh(); });
    panel.append(b);
  }
  const out = document.createElement('output');
  panel.append(out);
  document.body.append(panel);

  setInterval(() => {
    const s = getSession();
    const bank = getBank();
    const lines = [
      `bus: ${bus.status}${bus.sim ? ' (sim)' : ''}, ${bus.arrivals.length} arrivals`,
      ...bus.upcoming().slice(0, 3).map((a) => `  ${a.route} in ${Math.round((a.at - Date.now()) / 1000)}s`),
      `questions: ${bank.status}, unseen e${bank.remaining('easy')} m${bank.remaining('medium')} h${bank.remaining('hard')}`,
    ];
    if (s) {
      lines.push(`source: ${s.source}`, `deadline in ${Math.round((s.deadline - Date.now()) / 1000)}s`,
        `diffs: ${s.history.map((d) => d[0]).join('')}`);
    }
    out.textContent = lines.join('\n');
  }, 500);
}
