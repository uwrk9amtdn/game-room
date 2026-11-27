import { el } from '/js/kit/dom.js';
import { unlockForm } from '/js/kit/unlock.js';

const HELP = 'Fights against the computer. Keyboard or gamepad; open Controls in the game for the keys. ' +
  'Fullscreen is beside Exit game; Escape leaves it. The game pauses when you click outside it.';
const DELAYS = [2, 3, 4, 5, 6, 8];
const FRAME = '/solo/mk4/index.html?net=1';

// Whether this browser may load the game files: on the server's machine, or
// after the tester password. Resolves true when the files are reachable.
async function hasAccess(signal) {
  const access = await fetch('/solo/mk4/access', { signal }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (access?.local) return true;
  const page = await fetch('/solo/mk4/index.html', { method: 'HEAD', signal }).catch(() => null);
  return Boolean(page?.ok);
}

function inviteForm(container, submit) {
  const select = el('select', {}, ...DELAYS.map((d) => el('option', {
    value: String(d), textContent: `${d} frames (${Math.round(d * 1000 / 60)} ms)`, selected: d === 4,
  })));
  const label = el('label', {}, 'Input delay ', select);
  const hint = el('p', { className: 'hint', textContent:
    'Both players see their own moves this much later. Raise it if the game stalls on a slow connection.' });
  const button = el('button', { className: 'primary', textContent: 'Invite' });
  button.addEventListener('click', () => submit({ delay: Number(select.value) }));
  container.append(label, hint, button);
}

function describeOptions(options) { return `Online · delay ${options.delay}`; }

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
  const host = el('div', { className: 'mk4Host' });
  container.append(status, host);
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

  const post = (msg) => frame?.contentWindow?.postMessage(msg, location.origin);
  const say = (text) => { status.textContent = text; };

  function render() {
    if (!snapshot) return;
    const { over, you, players, connected, ready } = snapshot;
    // The last tick whose state hashes both browsers sent and the server found equal.
    container.dataset.verified = String(snapshot.verified);
    leave.hidden = Boolean(over) || you === null;
    if (over) return say(`Match over: ${describeResult({ players, over })}.`);
    if (you === null) return say('Watching is not available for online MK4 matches.');
    if (failed) return say('The game stopped on this side. Leave the match to free both players.');
    const rival = players[1 - you];
    if (!connected[1 - you]) return say(`${rival} lost the connection. Waiting for them to come back…`);
    if (!started) return say(ready[1 - you] ? 'Loading the game…' : `Waiting for ${rival} to load the game…`);
    say(stalled ? `Waiting for ${rival}…` : `Online match against ${rival}. Input delay ${snapshot.options.delay} frames.`);
  }

  function openFrame() {
    frame = el('iframe', { src: FRAME, title: 'Mortal Kombat 4', className: 'standaloneGame' });
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
      ctx.send({ action: 'input', from: msg.from, masks: msg.masks, ack: msg.ack });
    } else if (msg.type === 'hash') {
      ctx.send({ action: 'hash', tick: msg.tick, hi: msg.hi, lo: msg.lo });
    } else if (msg.type === 'stall') {
      stalled = msg.stalled;
      render();
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
    if (started && snapshot.remote.masks.length) post({ type: 'remote', ...snapshot.remote });
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
