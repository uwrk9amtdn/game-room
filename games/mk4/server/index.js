import meta from '../meta.js';
import { Mk4Match } from './match.js';

// Netcode per match: rollback (run ahead on predicted input, correct by
// re-simulating; small delay) or lockstep (wait for both inputs; the delay
// must cover the round trip). See mk4-port's doc/rollback.md.
export const MODES = {
  rollback: { delays: [1, 2, 3, 4, 6, 8], delay: 2 },
  lockstep: { delays: [2, 3, 4, 5, 6, 8, 10, 12], delay: 4 },
};

// Online 1v1 is an ordinary match (input relay); single player is the
// standalone session in server/local-game.js.
export default {
  meta,
  validateOptions(options) {
    const mode = options.mode ?? 'rollback';
    if (!Object.hasOwn(MODES, mode)) return { error: 'Choose rollback or lockstep.' };
    const { delays, delay: fallback } = MODES[mode];
    const delay = options.delay ?? fallback;
    if (!delays.includes(delay)) return { error: `Choose an input delay of ${delays.join(', ')} frames.` };
    return { options: { mode, delay } };
  },
  createMatch: (args) => new Mk4Match(args),
};
