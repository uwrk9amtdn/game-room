import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { startServer } from '../server/index.js';
import { loopbackHost } from '../server/local-game.js';
import { hashPassword } from '../server/auth.js';
import { connect } from './helpers.js';

// A raw request, so tests can set Host and proxy headers freely.
const get = (port, pathname, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port, path: pathname, headers }, (res) => {
    const chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
  }).on('error', reject);
});

test('loopback Host names', () => {
  for (const host of ['localhost', 'localhost:9494', '127.0.0.1:1', '[::1]:9494', 'LOCALHOST']) assert.ok(loopbackHost(host), host);
  for (const host of ['example.com', 'localhost.evil.example', '127.0.0.2', '', undefined, '10.0.0.1:9494']) {
    assert.equal(loopbackHost(host), false, String(host));
  }
});

test('MK4: listed while built; local play without a password, remote play with the tester password', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'game-room-mk4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gamesDir = path.join(dir, 'games');
  await cp(fileURLToPath(new URL('./fixtures/games', import.meta.url)), gamesDir, { recursive: true });
  await cp(fileURLToPath(new URL('../games/mk4', import.meta.url)), path.join(gamesDir, 'mk4'), { recursive: true });
  const mk4Dir = path.join(dir, 'mk4-build');
  const passwordFile = path.join(dir, 'admin.hash');
  await writeFile(passwordFile, await hashPassword('admin password'));
  const server = await startServer({ port: 0, gamesDir, mk4Dir, passwordFile, tapeOutDir: path.join(dir, 'none') });
  t.after(() => server.close());
  const { port } = server;
  const local = { Host: `localhost:${port}` };
  // A visitor through the HTTPS proxy (which connects from loopback).
  const remote = { Host: 'games.example.org', 'X-Real-IP': '203.0.113.9', 'X-Forwarded-Proto': 'https' };

  // No build: not listed, not served, not launchable.
  const early = connect(port);
  await early.opened;
  early.send({ type: 'join', name: 'early' });
  assert.equal((await early.next('joined')).games.some((g) => g.id === 'mk4'), false);
  early.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await early.next('soloError')).message, /Unknown/);
  assert.equal((await get(port, '/solo/mk4/index.html', local)).status, 404);
  assert.equal((await get(port, '/solo/mk4/access', local)).status, 404);
  early.close();

  await mkdir(path.join(mk4Dir, 'cd'), { recursive: true });
  await writeFile(path.join(mk4Dir, 'index.html'), '<!doctype html><title>fixture</title>');
  await writeFile(path.join(mk4Dir, 'mk4-engine.wasm'), Buffer.from([0, 97, 115, 109]));
  await writeFile(path.join(mk4Dir, 'cd/track02.cdr'), 'pcm');
  await writeFile(path.join(mk4Dir, 'secret.bin'), 'not in the manifest');
  await writeFile(path.join(mk4Dir, 'manifest.json'), JSON.stringify({ build: 'abc', files: {
    'index.html': { size: 37 }, 'mk4-engine.wasm': { size: 4 }, 'cd/track02.cdr': { size: 3 },
  } }));
  // The manifest is re-read every few seconds; wait for the server to notice.
  for (let i = 0; i < 80 && (await get(port, '/solo/mk4/index.html', local)).status !== 200; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // This machine: no password.
  assert.deepEqual(JSON.parse((await get(port, '/solo/mk4/access', local)).body), { local: true });
  const page = await get(port, '/solo/mk4/index.html', local);
  assert.equal(page.status, 200);
  assert.match(page.headers['content-type'], /text\/html/);
  assert.equal(page.headers['cache-control'], 'private, no-cache');
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.equal((await get(port, '/solo/mk4/index.html', { ...local, 'If-None-Match': page.headers.etag })).status, 304);
  assert.equal((await get(port, '/solo/mk4/mk4-engine.wasm', local)).headers['content-type'], 'application/wasm');
  assert.equal((await get(port, '/solo/mk4/cd/track02.cdr', local)).body, 'pcm');
  for (const name of ['secret.bin', 'manifest.json', '..%2Fsecret.bin', '%2e%2e/secret.bin', 'cd/', 'bad%']) {
    assert.equal((await get(port, `/solo/mk4/${name}`, local)).status, 404, name);
  }

  // Anyone else: the tester password.
  assert.deepEqual(JSON.parse((await get(port, '/solo/mk4/access', remote)).body), { local: false });
  for (const headers of [remote, { Host: 'games.example.org' }, { ...local, 'X-Forwarded-For': '203.0.113.9' }]) {
    assert.equal((await get(port, '/solo/mk4/index.html', headers)).status, 401);
  }
  const post = (pathname, body, headers = {}) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({ host: '127.0.0.1', port, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(data);
  });
  assert.equal((await post('/solo/unlock', { password: 'tester pw' }, remote)).status, 409);
  const login = await post('/admin/api/login', { password: 'admin password' }, local);
  const admin = { ...local, Cookie: login.headers['set-cookie'][0].split(';')[0] };
  assert.equal((await post('/admin/api/tape-out/password', { password: 'tester pw' }, admin)).status, 200);
  assert.equal((await post('/solo/unlock', { password: 'wrong' }, remote)).status, 401);
  // Plain HTTP from outside is refused, as for Tape-Out.
  assert.equal((await post('/solo/unlock', { password: 'tester pw' }, { ...remote, 'X-Forwarded-Proto': 'http' })).status, 403);
  const unlocked = await post('/solo/unlock', { password: 'tester pw' }, remote);
  assert.equal(unlocked.status, 200);
  const setCookie = unlocked.headers['set-cookie'][0];
  assert.match(setCookie, /Path=\/solo\/; HttpOnly; SameSite=Strict; Secure/);
  const { token } = JSON.parse(unlocked.body);
  const withCookie = { ...remote, Cookie: setCookie.split(';')[0] };
  assert.equal((await get(port, '/solo/mk4/index.html', withCookie)).status, 200);
  assert.equal((await get(port, '/solo/mk4/cd/track02.cdr', withCookie)).body, 'pcm');
  assert.equal((await get(port, '/solo/mk4/secret.bin', withCookie)).status, 404);

  // Lobby: everyone sees MK4; local launches freely, remote needs the token.
  const alice = connect(port);
  const bob = connect(port, { headers: { 'X-Real-IP': '203.0.113.9' } });
  await Promise.all([alice.opened, bob.opened]);
  alice.send({ type: 'join', name: 'alice' });
  bob.send({ type: 'join', name: 'bob' });
  assert.equal((await alice.next('joined')).games.find((g) => g.id === 'mk4')?.solo, '/solo/mk4/index.html');
  assert.ok((await bob.next('joined')).games.some((g) => g.id === 'mk4'));
  for (const forged of [null, 'forged']) {
    bob.send({ type: 'soloStart', game: 'mk4', token: forged });
    assert.match((await bob.next('soloError')).message, /tester password/);
  }
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  await alice.next('soloStarted', (m) => m.game === 'mk4');
  bob.send({ type: 'soloStart', game: 'mk4', token });
  await bob.next('soloStarted', (m) => m.game === 'mk4');
  await alice.next('users', (m) => m.users.some((u) => u.name === 'bob' && u.game === 'mk4'));
  bob.send({ type: 'invite', to: 'alice', game: 'pick', options: {} });
  assert.match((await bob.next('error')).message, /already in a game/);
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await alice.next('soloError')).message, /already in a game/);

  // A new password ends bob's session and his file access, not alice's local one.
  assert.equal((await post('/admin/api/tape-out/password', { password: 'new tester pw' }, admin)).status, 200);
  await bob.next('soloEnded');
  assert.equal((await get(port, '/solo/mk4/index.html', withCookie)).status, 401);
  await bob.next('users', (m) => m.users.some((u) => u.name === 'bob' && u.status === 'idle')
    && m.users.some((u) => u.name === 'alice' && u.status === 'busy'));
  alice.send({ type: 'soloStop' });
  await alice.next('soloEnded');
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  await alice.next('soloStarted', (m) => m.game === 'mk4');

  // Removing the build hides the game again; its player is shown as just busy.
  await rm(mk4Dir, { recursive: true, force: true });
  for (let i = 0; i < 80 && (await get(port, '/solo/mk4/access', local)).status !== 404; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  const late = connect(port);
  await late.opened;
  late.send({ type: 'join', name: 'late' });
  assert.equal((await late.next('joined')).games.some((g) => g.id === 'mk4'), false);
  alice.close();
  bob.close();
  late.close();
});

test('MK4 online: invite, accept, ready, relay inputs, leave; not offered without a build', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'game-room-mk4-net-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gamesDir = path.join(dir, 'games');
  await cp(fileURLToPath(new URL('./fixtures/games', import.meta.url)), gamesDir, { recursive: true });
  await cp(fileURLToPath(new URL('../games/mk4', import.meta.url)), path.join(gamesDir, 'mk4'), { recursive: true });
  const mk4Dir = path.join(dir, 'mk4-build');
  const server = await startServer({ port: 0, gamesDir, mk4Dir, tapeOutDir: path.join(dir, 'none') });
  t.after(() => server.close());
  const ann = connect(server.port), bob = connect(server.port);
  await Promise.all([ann.opened, bob.opened]);
  ann.send({ type: 'join', name: 'ann' });
  bob.send({ type: 'join', name: 'bob' });
  await Promise.all([ann.next('joined'), bob.next('joined')]);
  ann.send({ type: 'invite', to: 'bob', game: 'mk4', options: { delay: 3 } });
  assert.match((await ann.next('error')).message, /Unknown game/); // no build yet

  await mkdir(mk4Dir, { recursive: true });
  await writeFile(path.join(mk4Dir, 'index.html'), 'x');
  await writeFile(path.join(mk4Dir, 'manifest.json'), JSON.stringify({ build: 'b', files: { 'index.html': { size: 1 } } }));
  for (let i = 0; i < 80 && (await get(server.port, '/solo/mk4/access', { Host: `localhost:${server.port}` })).status !== 200; i++) {
    await new Promise((r) => setTimeout(r, 100));
  }
  ann.send({ type: 'invite', to: 'bob', game: 'mk4', options: { delay: 3 } });
  const invite = await bob.next('invite');
  assert.deepEqual(invite.options, { delay: 3 });
  bob.send({ type: 'accept', id: invite.id });
  const first = await ann.next('match');
  assert.equal(first.snapshot.started, false);
  const annSeat = first.snapshot.you;
  const bobSeat = 1 - annSeat;
  ann.send({ type: 'action', action: 'ready' });
  bob.send({ type: 'action', action: 'ready' });
  const started = await ann.next('match', (m) => m.snapshot.started);
  assert.equal(started.snapshot.options.delay, 3);
  ann.send({ type: 'action', action: 'input', from: 0, masks: [0, 0, 0, 5], ack: 0 });
  const relayed = await bob.next('match', (m) => m.snapshot.remote.masks.length === 4);
  assert.deepEqual(relayed.snapshot.remote, { from: 0, masks: [0, 0, 0, 5], acked: 0 });
  assert.equal(relayed.snapshot.you, bobSeat);
  // In a match: no solo launch, no other invitations.
  ann.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await ann.next('soloError')).message, /already in a game/);
  bob.send({ type: 'action', action: 'leave' });
  const over = await ann.next('match', (m) => m.snapshot.over);
  assert.deepEqual(over.snapshot.over, { reason: 'left', seat: bobSeat });
  await ann.next('users', (m) => m.users.every((u) => u.status === 'idle'));
  ann.close();
  bob.close();
});
