import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, cp, writeFile, readFile, stat } from 'node:fs/promises';
import { startServer } from '../server/index.js';
import { hashPassword } from '../server/auth.js';
import { connect } from './helpers.js';

test('Tape-Out admin password, protected assets, presence and invitation lifecycle', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'game-room-solo-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const gamesDir = path.join(dir, 'games');
  await cp(fileURLToPath(new URL('./fixtures/games', import.meta.url)), gamesDir, { recursive: true });
  await cp(fileURLToPath(new URL('../games/tape-out', import.meta.url)), path.join(gamesDir, 'tape-out'), { recursive: true });
  const passwordFile = path.join(dir, 'admin.hash');
  await writeFile(passwordFile, await hashPassword('admin password'));
  // Private game builds are deployed separately and are absent in clean checkouts.
  const tapeOutDir = path.join(dir, 'tape-out-assets');
  await mkdir(path.join(tapeOutDir, 'audio'), { recursive: true });
  const fixtureHtml = '<!doctype html><title>Tape-Out fixture</title>';
  const fixtureAudio = Buffer.from('test audio payload for range requests');
  await writeFile(path.join(tapeOutDir, 'index.html'), fixtureHtml);
  await writeFile(path.join(tapeOutDir, 'audio/title.mp3'), fixtureAudio);
  const options = { port: 0, gamesDir, tapeOutDir, dataDir: path.join(dir, 'data'), passwordFile, adminToken: 'test-restart-token' };
  let server = await startServer(options);
  t.after(() => server.close());
  let base = `http://localhost:${server.port}`;
  const request = (url, body, headers = {}) => fetch(base + url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const unlock = (password, headers) => request('/solo/tape-out/unlock', { password }, headers);
  assert.equal((await request('/solo/tape-out/index.html')).status, 401);
  assert.equal((await request('/solo/tape-out/audio/title.mp3')).status, 401);
  assert.equal((await request('/tape-out-beta-2/index.html')).status, 404);
  assert.equal((await request('/solo/tape-out/tape-out-beta-2-testers_m.zip')).status, 404);
  assert.equal((await unlock('anything')).status, 409);
  assert.equal((await request('/admin/api/tape-out/password', { password: '12345' })).status, 401);
  let login = await request('/admin/api/login', { password: 'admin password' });
  let admin = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  assert.equal((await request('/admin/api/tape-out/password', { password: 'four' }, admin)).status, 400);
  assert.equal((await request('/admin/api/tape-out/password', { password: '12345' },
    { ...admin, Origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/admin/api/tape-out/password', { password: '12345' }, admin)).status, 200);
  const stored = await readFile(path.join(options.dataDir, 'tape-out-password.hash'), 'utf8');
  assert.match(stored, /^scrypt\$/);
  assert.equal(stored.includes('12345'), false);
  assert.equal((await stat(path.join(options.dataDir, 'tape-out-password.hash'))).mode & 0o777, 0o600);
  const overview = await (await request('/admin/api/overview', undefined, admin)).json();
  assert.deepEqual(overview.tapeOut, { passwordSet: true, persistent: true });
  assert.equal(JSON.stringify(overview).includes(stored.trim()), false);
  assert.equal((await unlock('wrong')).status, 401);
  assert.equal((await unlock('12345', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await unlock('12345', { 'X-Forwarded-For': '203.0.113.8', 'X-Forwarded-Proto': 'http' })).status, 403);
  let access = await unlock('12345');
  assert.equal(access.status, 200);
  const token = (await access.json()).token;
  const cookie = access.headers.get('set-cookie').split(';')[0];
  assert.match(access.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  const html = await request('/solo/tape-out/index.html', undefined, { Cookie: cookie });
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'no-store');
  assert.equal(await html.text(), fixtureHtml);
  const audio = await request('/solo/tape-out/audio/title.mp3', undefined, { Cookie: cookie, Range: 'bytes=0-9' });
  assert.equal(audio.status, 206);
  assert.equal(audio.headers.get('content-type'), 'audio/mpeg');
  assert.match(audio.headers.get('content-range'), /^bytes 0-9\//);
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), fixtureAudio.subarray(0, 10));
  assert.equal((await request('/solo/tape-out/audio/title.mp3', undefined, { Cookie: cookie, Range: 'bytes=999999999-' })).status, 416);
  for (const suffix of ['audio/%2e%2e%2findex.html', 'audio/%2e%2e%2f%2e%2e%2fpackage.json', 'Tape-Out-beta-2-release-notes.pdf']) {
    assert.equal((await request('/solo/tape-out/' + suffix, undefined, { Cookie: cookie })).status, 404);
  }

  const alice = connect(server.port), bob = connect(server.port);
  t.after(() => { alice.close(); bob.close(); });
  await Promise.all([alice.opened, bob.opened]);
  alice.send({ type: 'join', name: 'alice' });
  const joined = await alice.next('joined');
  assert.equal(joined.games.find((g) => g.id === 'tape-out').players, 1);
  bob.send({ type: 'join', name: 'bob' });
  await bob.next('joined');
  alice.send({ type: 'soloStart', game: 'tape-out', token: 'forged' });
  await alice.next('soloError');
  // Launch cancels pending invitations, including stale accepts.
  bob.send({ type: 'invite', game: 'pick', to: 'alice' });
  const invite = await alice.next('invite');
  alice.send({ type: 'soloStart', game: 'tape-out', token });
  await alice.next('soloStarted');
  await bob.next('inviteClosed', (m) => m.id === invite.id);
  let presence = await bob.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.game === 'tape-out'));
  assert.equal(presence.users.find((u) => u.name === 'alice').status, 'busy');
  alice.send({ type: 'bot', game: 'pick', bot: { mood: 'calm' } });
  assert.match((await alice.next('error')).message, /already in a game/);
  alice.send({ type: 'watch', id: 'anything' });
  assert.match((await alice.next('error')).message, /in a game yourself/);
  alice.send({ type: 'accept', id: invite.id });
  bob.send({ type: 'invite', game: 'pick', to: 'alice' });
  assert.match((await bob.next('error')).message, /busy/);
  alice.send({ type: 'invite', game: 'pick', to: 'bob' });
  assert.match((await alice.next('error')).message, /already in a game/);
  bob.send({ type: 'invite', game: 'tape-out', to: 'alice' });
  assert.match((await bob.next('error')).message, /single-player/);
  const during = await (await request('/admin/api/overview', undefined, admin)).json();
  assert.equal(during.players.find((u) => u.name === 'alice').game, 'tape-out');
  assert.equal(during.matches.length, 0);
  alice.send({ type: 'soloStop' });
  await alice.next('soloEnded');
  await bob.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.status === 'idle'));
  bob.send({ type: 'invite', game: 'pick', to: 'alice' });
  await alice.next('invite');
  alice.send({ type: 'soloStart', game: 'tape-out', token });
  await alice.next('soloStarted');
  // Rotation ends current sessions and invalidates asset cookies and tokens.
  assert.equal((await request('/admin/api/tape-out/password', { password: 'new tester password' }, admin)).status, 200);
  assert.match((await alice.next('soloEnded')).message, /password changed/);
  assert.equal((await request('/solo/tape-out/audio/title.mp3', undefined, { Cookie: cookie })).status, 401);
  alice.send({ type: 'soloStart', game: 'tape-out', token });
  await alice.next('soloError');
  access = await unlock('new tester password');
  const newToken = (await access.json()).token;
  alice.send({ type: 'soloStart', game: 'tape-out', token: newToken });
  await alice.next('soloStarted');
  // Replacing a connection must not strand the player as busy.
  const replacement = connect(server.port);
  t.after(() => replacement.close());
  await replacement.opened;
  replacement.send({ type: 'join', name: 'alice', token: joined.token });
  await replacement.next('joined');
  await bob.next('users', (m) => m.users.some((u) => u.name === 'alice' && u.status === 'idle'));
  replacement.send({ type: 'soloStart', game: 'tape-out', token: newToken });
  await replacement.next('soloStarted');
  replacement.close();
  await bob.next('users', (m) => !m.users.some((u) => u.name === 'alice'));
  // Normal multiplayer sessions cannot be replaced by a standalone launch.
  bob.send({ type: 'bot', game: 'pick', bot: { mood: 'calm' } });
  await bob.next('match');
  bob.send({ type: 'soloStart', game: 'tape-out', token: newToken });
  assert.match((await bob.next('soloError')).message, /already in a game/);
  bob.send({ type: 'action', action: 'resign' });
  await bob.next('match', (m) => Boolean(m.snapshot.over));
  // Restart announcements also prevent standalone launches.
  assert.equal((await request('/admin/restart?in=0', {}, { Authorization: 'Bearer test-restart-token' })).status, 200);
  bob.send({ type: 'soloStart', game: 'tape-out', token: newToken });
  assert.match((await bob.next('soloError')).message, /restarts/);

  // Password settings survive a process restart; tester sessions do not.
  await server.saved();
  server.close();
  server = await startServer(options);
  base = `http://localhost:${server.port}`;
  assert.equal((await unlock('12345')).status, 401);
  assert.equal((await unlock('new tester password')).status, 200);
  assert.equal((await request('/solo/tape-out/index.html', undefined, { Cookie: cookie })).status, 401);
  // Repeated wrong guesses are throttled, including requests via HTTPS proxies.
  const proxy = { 'X-Forwarded-For': '203.0.113.90', 'X-Forwarded-Proto': 'https', Origin: base.replace('http:', 'https:') };
  for (let i = 0; i < 4; i++) assert.equal((await unlock('wrong', proxy)).status, 401);
  const held = await unlock('new tester password', proxy);
  assert.equal(held.status, 429);
  assert.ok(Number(held.headers.get('retry-after')) > 0);
});
