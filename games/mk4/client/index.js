import { unlockForm } from '/js/kit/unlock.js';

const HELP = 'Fights against the computer. Keyboard or gamepad; open Controls in the game for the keys. ' +
  'Fullscreen is beside Exit game; Escape leaves it. The game pauses when you click outside it.';

export default {
  describeOptions: () => 'Single player',
  // On the server's own machine Play needs no password; elsewhere the tester
  // password (the same as Tape-Out's) unlocks it.
  home(container, ctx) {
    const text = document.createElement('p');
    text.textContent = HELP;
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
        const button = Object.assign(document.createElement('button'), { textContent: 'Play', className: 'primary' });
        button.addEventListener('click', () => ctx.startSolo(null));
        container.append(button);
      });
    return { destroy() { destroyed = true; controller.abort(); form?.destroy(); } };
  },
};
