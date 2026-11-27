export default {
  describeOptions: () => 'Single player',
  home(container, ctx) {
    const text = document.createElement('p');
    text.textContent = 'Fights against the computer. Keyboard or gamepad; open Controls in the game for the keys. ' +
      'Fullscreen is beside Exit game; Escape leaves it. The game pauses when you click outside it.';
    const button = Object.assign(document.createElement('button'), { textContent: 'Play', className: 'primary' });
    button.addEventListener('click', () => ctx.startSolo(null));
    container.append(text, button);
    return { destroy() {} };
  },
};
