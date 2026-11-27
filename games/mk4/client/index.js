import { el } from '/js/kit/dom.js';
import { unlockForm } from '/js/kit/unlock.js';

const HELP = 'Fights against the computer. Keyboard or gamepad; open Controls in the game for the keys. ' +
  'Fullscreen is beside Exit game; Escape leaves it. The game pauses when you click outside it.';
// Mirrors MODES in ../server/index.js.
const MODES = {
  rollback: { label: 'Rollback (recommended)', delays: [1, 2, 3, 4, 6, 8], delay: 2,
    hint: 'Both games run at full speed and correct themselves when the other player\'s input arrives. ' +
      'Raise the delay only if the network line says so.' },
  lockstep: { label: 'Lockstep', delays: [2, 3, 4, 5, 6, 8, 10, 12], delay: 4,
    hint: 'Both games wait for both players\' input. Simple, but the delay must cover the round trip, ' +
      'or the game slows down.' },
};
const frameUrl = (mode) => `/solo/mk4/index.html?net=1${mode === 'rollback' ? '&rollback=1' : ''}`;
const ms = (frames) => Math.round(frames * 1000 / 60);

// Whether this browser may load the game files: on the server's machine, or
// after the tester password. Resolves true when the files are reachable.
async function hasAccess(signal) {
  const access = await fetch('/solo/mk4/access', { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (access?.local) return true;
  const page = await fetch('/solo/mk4/index.html', { method: 'HEAD', signal }).catch(() => null);
  return Boolean(page?.ok);
}

function inviteForm(container, submit) {
  const mode = el('select', { name: 'mode' }, ...Object.entries(MODES).map(([value, m]) =>
    el('option', { value, textContent: m.label })));
  const delay = el('select', { name: 'delay' });
  const hint = el('p', { className: 'hint' });
  function fill() {
    const m = MODES[mode.value];
    delay.replaceChildren(...m.delays.map((d) => el('option', {
      value: String(d), textContent: `${d} frames (${ms(d)} ms)`, selected: d === m.delay,
    })));
    hint.textContent = m.hint;
  }
  mode.addEventListener('change', fill);
  fill();
  const button = el('button', { className: 'primary', textContent: 'Invite' });
  button.addEventListener('click', () => submit({ mode: mode.value, delay: Number(delay.value) }));
  container.append(el('label', {}, 'Netcode ', mode), el('label', {}, 'Input delay ', delay), hint, button);
}

// The smallest offered delay whose round-trip budget (two delays, less a frame
// of scheduling) covers the measured round trip.
// Lockstep: the round trip must fit in two delays less a frame. Rollback: one
// way must fit in the delay plus the rollback window (8 ticks).
const WINDOW = 8;
function suggestDelay(mode, rtt) {
  const { delays } = MODES[mode];
  const fits = mode === 'rollback'
    ? (d) => ms(d + WINDOW) - 17 >= rtt * 0.6
    : (d) => ms(2 * d) - 17 >= rtt * 1.2;
  return delays.find(fits) ?? delays[delays.length - 1];
}

const modeOf = (options) => options.mode ?? 'lockstep'; // matches from before the choice
function describeOptions(options) { return `Online · ${modeOf(options)} · delay ${options.delay}`; }

function describeResult({ players, over }) {
  const who = players[over.seat];
  return {
    left: `${who} left`,
    abandoned: `${who} did not come back`,
    desync: 'Stopped: the games went out of step',
  }[over.reason] ?? 'Ended';
}

// The match screen: the game frame in net mode, relaying inputs between the
// frame and the server.
function mount(container, ctx) {
  const status = el('p', { className: 'mk4Status', role: 'status' });
  const guide = el('p', { className: 'hint mk4Guide', hidden: true });
  const network = el('p', { className: 'hint mk4Network', hidden: true });
  const host = el('div', { className: 'mk4Host' });
  container.append(status, guide, network, host);
  const leave = el('button', { textContent: 'Leave match' });
  const fullscreen = el('button', { textContent: 'Fullscreen', hidden: !document.fullscreenEnabled });
  ctx.toolbar.append(fullscreen, leave);
  const controller = new AbortController();
  let frame = null;
  let loaded = false;
  let started = false;
  let failed = false;
  let stalled = false;
  let snapshot = null;
  let readySent = false;
  let stats = null;

  const post = (msg) => frame?.contentWindow?.postMessage(msg, location.origin);
  const say = (text) => { status.textContent = text; };

  function render() {
    if (!snapshot) return;
    const { over, you, players, connected, ready } = snapshot;
    // The last tick whose state hashes both browsers sent and the server found equal.
    container.dataset.verified = String(snapshot.verified);
    leave.hidden = Boolean(over) || you === null;
    if (over) { guide.hidden = true; return say(`Match over: ${describeResult({ players, over })}.`); }
    if (you === null) return say('Watching is not available for online MK4 matches.');
    if (failed) return say('The game stopped on this side. Leave the match to free both players.');
    const rival = players[1 - you];
    if (!connected[1 - you]) return say(`${rival} lost the connection. Waiting for them to come back…`);
    if (!started) return say(ready[1 - you] ? 'Loading the game…' : `Waiting for ${rival} to load the game…`);
    say(stalled ? `Waiting for ${rival}…`
      : `Online match against ${rival}: ${modeOf(snapshot.options)}, input delay ${snapshot.options.delay} frames.`);
    // Your keys always drive your own fighter; the game only needs Player 2 to join in.
    guide.hidden = false;
    guide.textContent = you === 0
      ? `You are Player 1 (left side). Choose a mode, then wait on the "1 on 1 / 2 on 2" screen until it shows ` +
        `PLAYER 2 READY before you pick, or ${rival} will not get a fighter.`
      : `You are Player 2 (right side). Your keys move the right-hand fighter. When the "1 on 1 / 2 on 2" screen ` +
        'shows PLAYER 2 JOIN IN, press a punch or kick key to join.';
    renderNetwork();
  }

  function renderNetwork() {
    if (!stats || stats.rtt === null || !snapshot) return;
    const mode = modeOf(snapshot.options);
    const waited = Math.round(stats.waited * 100);
    const better = suggestDelay(mode, stats.rtt);
    const advice = waited > 5 && better > stats.delay
      ? ` The game is waiting: invite again with ${better} frames of delay.` : '';
    const detail = mode === 'rollback'
      ? `${stats.rollbacks ?? 0} corrections in the last second (longest ${stats.maxRollback ?? 0} frames)`
      : `fits up to about ${ms(2 * stats.delay) - 17} ms`;
    network.hidden = false;
    network.textContent = `Network: round trip ${stats.rtt} ms, ${detail}, waited ${waited}%.${advice}`;
  }

  function openFrame() {
    frame = el('iframe', { src: frameUrl(modeOf(snapshot.options)), title: 'Mortal Kombat 4', className: 'standaloneGame' });
    frame.setAttribute('allow', 'autoplay; fullscreen; gamepad');
    host.replaceChildren(frame);
  }

  window.addEventListener('message', (event) => {
    if (!frame || event.source !== frame.contentWindow || event.origin !== location.origin || !event.data?.mk4) return;
    const msg = event.data;
    if (msg.type === 'loaded') {
      loaded = true;
      sync();
    } else if (msg.type === 'inputs') {
      ctx.send({ action: 'input', from: msg.from, masks: msg.masks, ack: msg.ack,
        ...(Number.isInteger(msg.lead) ? { lead: msg.lead } : {}) });
    } else if (msg.type === 'hash') {
      ctx.send({ action: 'hash', tick: msg.tick, hi: msg.hi, lo: msg.lo });
    } else if (msg.type === 'stall') {
      stalled = msg.stalled;
      render();
    } else if (msg.type === 'stats') {
      stats = msg;
      renderNetwork();
    } else if (msg.type === 'error') {
      failed = true;
      render();
    }
  }, { signal: controller.signal });

  // Pass what the server says on to the frame.
  function sync() {
    if (!snapshot || snapshot.you === null || failed) return;
    if (snapshot.over) { post({ type: 'stop' }); return; }
    if (loaded && !readySent) {
      readySent = true;
      ctx.send({ action: 'ready' });
    }
    if (loaded && snapshot.started && !started) {
      started = true;
      post({ type: 'start', seat: snapshot.you, seed: snapshot.seed, delay: snapshot.options.delay });
    }
    if (started) post({ type: 'remote', ...snapshot.remote });
  }

  let first = true;
  async function prepare() {
    // A reloaded page cannot rejoin a match under way: its engine starts from zero.
    if (snapshot.started && snapshot.sent > 0) {
      failed = true;
      say('This match cannot continue after reloading the page. Leave the match to free both players.');
      return;
    }
    if (await hasAccess(controller.signal)) return openFrame();
    if (controller.signal.aborted) return;
    say('Enter the tester password to load the game.');
    const form = unlockForm(host, { start: () => { form.destroy(); openFrame(); } });
    controller.signal.addEventListener('abort', () => form.destroy());
  }

  leave.addEventListener('click', () => ctx.send({ action: 'leave' }));
  fullscreen.addEventListener('click', async () => {
    try { await frame?.requestFullscreen(); } catch { ctx.toast('The browser could not open fullscreen.'); }
    frame?.focus();
  });

  return {
    update(next) {
      snapshot = next;
      if (first && next.you !== null && !next.over) {
        first = false;
        prepare().then(render).catch((error) => { if (!controller.signal.aborted) say(error.message); });
      }
      sync();
      render();
    },
    destroy() {
      controller.abort();
      post({ type: 'stop' });
      try { frame?.contentWindow?.dispatchEvent(new Event('beforeunload')); } catch { /* frame gone */ }
      leave.remove();
      fullscreen.remove();
      container.replaceChildren();
    },
  };
}

export default {
  describeOptions,
  describeResult,
  inviteForm,
  mount,
  // On the server's own machine Play needs no password; elsewhere the tester
  // password (the same as Tape-Out's) unlocks it.
  home(container, ctx) {
    const text = document.createElement('p');
    text.textContent = HELP + ' For an online match, invite a player from the player list.';
    container.append(text);
    let form = null;
    let destroyed = false;
    const controller = new AbortController();
    fetch('/solo/mk4/access', { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { local: false }))
      .catch(() => ({ local: false }))
      .then(({ local }) => {
        if (destroyed) return;
        if (!local) {
          form = unlockForm(container, { start: (token) => ctx.startSolo(token) });
          return;
        }
        const button = Object.assign(document.createElement('button'), { textContent: 'Play the computer', className: 'primary' });
        button.addEventListener('click', () => ctx.startSolo(null));
        container.append(button);
      });
    return { destroy() { destroyed = true; controller.abort(); form?.destroy(); } };
  },
};
