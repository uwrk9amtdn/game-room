// An online MK4 match as the server sees it: no simulation, only an ordered
// input relay between the two browsers (delay-based lockstep; see
// mk4-port's doc/plans/2026-11-27-online-lockstep.md).
import { randomUUID, randomInt } from 'node:crypto';

export const MAX_BATCH = 64; // ticks per input message
export const MAX_WORD = 0xffffff; // player mask | system mask << 16
export const MAX_REPORTED_LEAD = 255; // rollback time sync: ticks ahead of the known remote input
const HASHES_KEPT = 64;

export class Mk4Match {
  constructor({ players, options, onChange }) {
    this.id = randomUUID();
    this.players = players;
    this.options = options;
    this.onChange = onChange;
    this.seed = randomInt(0, 2 ** 32);
    this.over = null;
    this.ready = [false, false];
    this.connected = [true, true];
    this.spectators = 0;
    this.inputs = [[], []]; // per seat: words from tick base[seat] on, not yet acknowledged
    this.base = [0, 0];
    this.lead = [0, 0]; // rollback: each seat's last reported lead, passed to the other
    this.next = [0, 0]; // per seat: the next tick it must send
    this.hashes = new Map(); // tick -> [seat 0 hash, seat 1 hash]
    this.lastHash = 0;
  }

  get started() { return this.ready[0] && this.ready[1]; }

  // A seat may run ahead of the other by its input delay; batching and frame
  // timing add a little. Anything beyond is a broken or hostile client.
  get maxLead() { return this.options.delay * 2 + MAX_BATCH; }

  end(over) {
    if (this.over) return;
    this.over = over;
    this.onChange(this);
  }

  handle(seat, action) {
    if (this.over) return 'The match is over.';
    switch (action.action) {
      case 'ready':
        if (this.ready[seat]) return null;
        this.ready[seat] = true;
        this.onChange(this);
        return null;
      case 'input': return this.input(seat, action);
      case 'hash': return this.hash(seat, action);
      case 'leave':
        this.end({ reason: 'left', seat });
        return null;
      default: return 'Unknown action.';
    }
  }

  input(seat, { from, masks, ack, lead = 0 }) {
    if (!this.started) return 'The match has not started.';
    if (from !== this.next[seat] || !Array.isArray(masks) || masks.length < 1 || masks.length > MAX_BATCH ||
        !masks.every((w) => Number.isInteger(w) && w >= 0 && w <= MAX_WORD)) {
      return 'Bad input.';
    }
    const other = 1 - seat;
    if (this.next[seat] + masks.length > this.next[other] + this.maxLead) return 'Input too far ahead.';
    if (!Number.isInteger(ack) || ack < this.base[other] || ack > this.next[other]) return 'Bad input.';
    if (!Number.isInteger(lead) || Math.abs(lead) > MAX_REPORTED_LEAD) return 'Bad input.';
    this.lead[seat] = lead;
    this.inputs[seat].push(...masks);
    this.next[seat] += masks.length;
    // The sender has the other seat's inputs up to `ack`: never resend those.
    this.inputs[other].splice(0, ack - this.base[other]);
    this.base[other] = ack;
    this.onChange(this);
    return null;
  }

  hash(seat, { tick, hi, lo }) {
    const word = (n) => Number.isInteger(n) && n >= 0 && n < 2 ** 32;
    if (!this.started || !Number.isInteger(tick) || tick <= 0 || tick > this.next[seat] || !word(hi) || !word(lo)) {
      return 'Bad hash.';
    }
    const value = `${hi}:${lo}`;
    const pair = this.hashes.get(tick) ?? [null, null];
    if (pair[seat] !== null) return null;
    pair[seat] = value;
    if (pair[0] !== null && pair[1] !== null) {
      this.hashes.delete(tick);
      if (pair[0] !== pair[1]) {
        this.end({ reason: 'desync', tick });
        return null;
      }
      this.lastHash = Math.max(this.lastHash, tick);
    } else this.hashes.set(tick, pair);
    // A client that never sends its hashes cannot make this grow.
    while (this.hashes.size > HASHES_KEPT) this.hashes.delete(this.hashes.keys().next().value);
    return null;
  }

  setConnected(seat, connected) {
    this.connected[seat] = connected;
    this.onChange(this);
  }

  abandon(seat) { this.end({ reason: 'abandoned', seat }); }

  setSpectators(count) { this.spectators = count; }

  snapshot(seat) {
    const other = seat === null ? null : 1 - seat;
    return {
      id: this.id,
      players: this.players,
      you: seat,
      options: this.options,
      over: this.over,
      seed: seat === null ? null : this.seed,
      started: this.started,
      ready: this.ready,
      connected: this.connected,
      // Where this seat's own sequence stands: a fresh page after a reload
      // sees that it cannot rejoin a match already under way.
      sent: seat === null ? null : this.next[seat],
      // `acked`: how many of this seat's ticks the other browser has received
      // (it measures the round trip).
      // `lead`: the other seat's reported lead (rollback time sync; 0 in lockstep).
      remote: seat === null ? null : {
        from: this.base[other], masks: this.inputs[other], acked: this.base[seat], lead: this.lead[other],
      },
      verified: this.lastHash,
      // Never archived: a replay would need every input, which is not kept.
      moves: [],
    };
  }
}
