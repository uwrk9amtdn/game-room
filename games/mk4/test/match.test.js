import test from 'node:test';
import assert from 'node:assert/strict';
import game from '../server/index.js';
import { MAX_BATCH } from '../server/match.js';

const create = (delay = 4) => {
  let changes = 0;
  const match = game.createMatch({ players: ['ann', 'bob'], options: { delay }, bots: [null, null], onChange: () => { changes++; } });
  return { match, changes: () => changes };
};
const zeros = (n) => Array(n).fill(0);

test('options: input delay from the allowed list, default 4', () => {
  assert.deepEqual(game.validateOptions({}), { options: { delay: 4 } });
  assert.deepEqual(game.validateOptions({ delay: 2, extra: 1 }), { options: { delay: 2 } });
  for (const delay of [1, 7, '4', 4.5, 0]) assert.ok(game.validateOptions({ delay }).error, String(delay));
});

test('start needs both players ready; seed is shared, hidden from spectators', () => {
  const { match } = create();
  assert.equal(match.handle(0, { action: 'input', from: 0, masks: [0], ack: 0 }), 'The match has not started.');
  match.handle(0, { action: 'ready' });
  assert.equal(match.snapshot(0).started, false);
  match.handle(1, { action: 'ready' });
  const [a, b, spectator] = [match.snapshot(0), match.snapshot(1), match.snapshot(null)];
  assert.equal(a.started, true);
  assert.equal(a.seed, b.seed);
  assert.ok(Number.isInteger(a.seed) && a.seed >= 0 && a.seed < 2 ** 32);
  assert.equal(spectator.seed, null);
  assert.equal(spectator.remote, null);
  assert.deepEqual(a.moves, []); // never archived
  assert.equal(match.handle(0, { action: 'dance' }), 'Unknown action.');
});

test('inputs: ordered, bounded, relayed until acknowledged', () => {
  const { match } = create(4);
  match.handle(0, { action: 'ready' });
  match.handle(1, { action: 'ready' });
  assert.equal(match.handle(0, { action: 'input', from: 0, masks: [1, 2, 3], ack: 0 }), null);
  assert.deepEqual(match.snapshot(1).remote, { from: 0, masks: [1, 2, 3], acked: 0 });
  assert.equal(match.snapshot(0).sent, 3);
  // Out of order, malformed, oversized, or a bad acknowledgement.
  for (const bad of [
    { from: 0, masks: [1], ack: 0 }, { from: 4, masks: [1], ack: 0 }, { from: 3, masks: [], ack: 0 },
    { from: 3, masks: [0x1000000], ack: 0 }, { from: 3, masks: [-1], ack: 0 }, { from: 3, masks: ['1'], ack: 0 },
    { from: 3, masks: zeros(MAX_BATCH + 1), ack: 0 }, { from: 3, masks: [1], ack: 1 }, { from: 3, masks: [1], ack: -1 },
  ]) assert.equal(match.handle(0, { action: 'input', ...bad }), 'Bad input.', JSON.stringify(bad));
  // Bob acknowledges two of ann's ticks: only the rest is resent to him.
  assert.equal(match.handle(1, { action: 'input', from: 0, masks: [9, 9], ack: 2 }), null);
  assert.deepEqual(match.snapshot(1).remote, { from: 2, masks: [3], acked: 0 });
  assert.deepEqual(match.snapshot(0).remote, { from: 0, masks: [9, 9], acked: 2 });
  // Nobody runs further ahead than the lead allows.
  let from = 3;
  while (match.handle(0, { action: 'input', from, masks: zeros(MAX_BATCH), ack: 0 }) === null) from += MAX_BATCH;
  assert.equal(match.handle(0, { action: 'input', from, masks: zeros(MAX_BATCH), ack: 0 }), 'Input too far ahead.');
  assert.ok(from - 2 <= match.maxLead);
});

test('hashes: equal ones verify, a mismatch ends the match', () => {
  const { match } = create();
  match.handle(0, { action: 'ready' });
  match.handle(1, { action: 'ready' });
  match.handle(0, { action: 'input', from: 0, masks: zeros(64), ack: 0 });
  match.handle(1, { action: 'input', from: 0, masks: zeros(64), ack: 64 });
  assert.equal(match.handle(0, { action: 'hash', tick: 120, hi: 1, lo: 2 }), 'Bad hash.'); // not reached yet
  assert.equal(match.handle(0, { action: 'hash', tick: 60, hi: 2 ** 32, lo: 2 }), 'Bad hash.');
  assert.equal(match.handle(0, { action: 'hash', tick: 60, hi: 1, lo: 2 }), null);
  assert.equal(match.handle(1, { action: 'hash', tick: 60, hi: 1, lo: 2 }), null);
  assert.equal(match.snapshot(0).verified, 60);
  assert.equal(match.over, null);
  match.handle(0, { action: 'hash', tick: 30, hi: 1, lo: 2 });
  match.handle(1, { action: 'hash', tick: 30, hi: 1, lo: 3 });
  assert.deepEqual(match.over, { reason: 'desync', tick: 30 });
  assert.equal(match.handle(0, { action: 'leave' }), 'The match is over.');
});

test('leaving, disconnecting and abandoning', () => {
  const { match, changes } = create();
  match.setConnected(1, false);
  assert.deepEqual(match.snapshot(0).connected, [true, false]);
  assert.ok(changes() > 0);
  match.handle(1, { action: 'leave' });
  assert.deepEqual(match.over, { reason: 'left', seat: 1 });
  const other = create().match;
  other.abandon(0);
  assert.deepEqual(other.over, { reason: 'abandoned', seat: 0 });
});
