export default {
  describeOptions: () => 'Single player',
  home(container, ctx) {
    const form = document.createElement('form');
    const label = document.createElement('label');
    label.textContent = 'Tester password ';
    const input = Object.assign(document.createElement('input'), {
      type: 'password', required: true, minLength: 5, maxLength: 256, autocomplete: 'current-password',
    });
    label.append(input);
    const button = Object.assign(document.createElement('button'), { textContent: 'Unlock and play', className: 'primary' });
    const error = document.createElement('p');
    error.setAttribute('role', 'alert');
    form.append(label, button, error);
    container.append(form);
    let destroyed = false;
    const controller = new AbortController();
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      button.disabled = true;
      error.textContent = '';
      try {
        const response = await fetch('/solo/tape-out/unlock', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: input.value }), signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not unlock the game.');
        input.value = '';
        if (!destroyed) ctx.startSolo(data.token);
      } catch (err) {
        if (!destroyed) error.textContent = err.message;
      } finally { if (!destroyed) button.disabled = false; }
    });
    return { destroy() { destroyed = true; controller.abort(); } };
  },
};
