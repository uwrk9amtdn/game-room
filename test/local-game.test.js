import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, cp, writeFile } from 'node:fs/promises';
import { startServer } from '../server/index.js';
import { loopbackHost } from '../server/local-game.js';
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

test('MK4 is listed, launched and served only locally while its build is exported', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'game-room-mk4-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gamesDir = path.join(dir, 'games');
  await cp(fileURLToPath(new URL('./fixtures/games', import.meta.url)), gamesDir, { recursive: true });
  await cp(fileURLToPath(new URL('../games/mk4', import.meta.url)), path.join(gamesDir, 'mk4'), { recursive: true });
  const mk4Dir = path.join(dir, 'mk4-build');
  const server = await startServer({ port: 0, gamesDir, mk4Dir, tapeOutDir: path.join(dir, 'none') });
  t.after(() => server.close());
  const { port } = server;
  const local = { Host: `localhost:${port}` };

  // No build: not listed, not served, not launchable.
  const early = connect(port);
  await early.opened;
  early.send({ type: 'join', name: 'early' });
  assert.equal((await early.next('joined')).games.some((g) => g.id === 'mk4'), false);
  early.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await early.next('soloError')).message, /Unknown/);
  assert.equal((await get(port, '/solo/mk4/index.html', local)).status, 404);
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
  // Relayed by the proxy, or reached under another name: the game is not there.
  assert.equal((await get(port, '/solo/mk4/index.html', { ...local, 'X-Real-IP': '127.0.0.1' })).status, 404);
  assert.equal((await get(port, '/solo/mk4/index.html', { ...local, 'X-Forwarded-For': '203.0.113.9' })).status, 404);
  assert.equal((await get(port, '/solo/mk4/index.html', { Host: 'games.example.org' })).status, 404);
  assert.equal((await get(port, '/solo/mk4/index.html', { Host: `rebind.example:${port}` })).status, 404);

  // Only a local connection sees and launches it; others see the player as busy.
  const alice = connect(port);
  const remote = connect(port, { headers: { 'X-Real-IP': '203.0.113.9' } });
  await Promise.all([alice.opened, remote.opened]);
  alice.send({ type: 'join', name: 'alice' });
  remote.send({ type: 'join', name: 'remote' });
  assert.equal((await alice.next('joined')).games.find((g) => g.id === 'mk4')?.solo, '/solo/mk4/index.html');
  assert.equal((await remote.next('joined')).games.some((g) => g.id === 'mk4'), false);
  remote.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await remote.next('soloError')).message, /Unknown/);
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  await alice.next('soloStarted', (m) => m.game === 'mk4');
  await alice.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.game === 'mk4'));
  const seen = await remote.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.status === 'busy'));
  assert.equal(seen.users.find((u) => u.name === 'alice').game, null);
  assert.equal(JSON.stringify(seen).includes('mk4'), false);
  remote.send({ type: 'invite', to: 'alice', game: 'pick', options: {} });
  assert.match((await remote.next('error')).message, /busy/);
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  assert.match((await alice.next('soloError')).message, /already in a game/);
  alice.send({ type: 'soloStop' });
  await alice.next('soloEnded');
  await remote.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.status === 'idle'));
  alice.send({ type: 'soloStart', game: 'mk4', token: null });
  await alice.next('soloStarted', (m) => m.game === 'mk4');
  alice.close();
  remote.close();
});
