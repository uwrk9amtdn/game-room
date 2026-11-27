// The tester-password form for protected single-player games (Tape-Out, MK4).
// One password unlocks all of them; `start(token)` launches the game.
export function unlockForm(container, { label = 'Tester password ', button = 'Unlock and play', start }) {
  const form = document.createElement('form');
  const field = document.createElement('label');
  field.textContent = label;
  const input = Object.assign(document.createElement('input'), {
    type: 'password', required: true, minLength: 5, maxLength: 256, autocomplete: 'current-password',
  });
  field.append(input);
  const submit = Object.assign(document.createElement('button'), { textContent: button, className: 'primary' });
  const error = document.createElement('p');
  error.setAttribute('role', 'alert');
  form.append(field, submit, error);
  container.append(form);
  let destroyed = false;
  const controller = new AbortController();
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    submit.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch('/solo/unlock', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: input.value }), signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Could not unlock the game.');
      input.value = '';
      if (!destroyed) start(data.token);
    } catch (err) {
      if (!destroyed) error.textContent = err.message;
    } finally { if (!destroyed) submit.disabled = false; }
  });
  return { destroy() { destroyed = true; controller.abort(); } };
}
