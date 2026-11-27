import meta from '../meta.js';
import { Mk4Match } from './match.js';

export const DELAYS = [2, 3, 4, 5, 6, 8, 10, 12];

// Online 1v1 is an ordinary match (input relay); single player is the
// standalone session in server/local-game.js.
export default {
  meta,
  validateOptions(options) {
    const delay = options.delay ?? 4;
    if (!DELAYS.includes(delay)) return { error: `Choose an input delay of ${DELAYS.join(', ')} frames.` };
    return { options: { delay } };
  },
  createMatch: (args) => new Mk4Match(args),
};
