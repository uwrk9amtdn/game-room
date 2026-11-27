import { unlockForm } from '/js/kit/unlock.js';

export default {
  describeOptions: () => 'Single player',
  home(container, ctx) {
    return unlockForm(container, { start: (token) => ctx.startSolo(token) });
  },
};
