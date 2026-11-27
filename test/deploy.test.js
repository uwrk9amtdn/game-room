import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { hashPassword } from '../server/auth.js';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));

async function waitFor(check) {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if (await check()) return; } catch { /* The child may be restarting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the supervised server.');
}

test('Linux deployment starts, restarts a crashed child, restarts and stops', {
  skip: process.platform !== 'linux', timeout: 30_000,
}, async (t) => {
  const state = await mkdtemp(path.join(os.tmpdir(), 'game-room-deploy-'));
  const env = { ...process.env, GAME_ROOM_STATE: state };
  const command = async (action) => (await exec(path.join(root, 'deploy/game-room'), [action], {
    cwd: root, env, timeout: 15_000,
  })).stdout;
  t.after(async () => {
    try { await command('stop'); }
    finally { await rm(state, { recursive: true, force: true }); }
  });
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
  await writeFile(path.join(state, 'config'), [
    `port=${port}`, `node=${shellQuote(process.execPath)}`,
    `data_dir=${shellQuote(path.join(state, 'data'))}`, '',
  ].join('\n'));
  await writeFile(path.join(state, 'admin-password'), await hashPassword('test admin password'));
  const base = `http://127.0.0.1:${port}`;
  const ready = async () => (await fetch(base + '/admin/api/session', { signal: AbortSignal.timeout(500) })).ok;
  const supervisorPid = async () => Number((await readFile(path.join(state, 'daemon.pid'), 'utf8')).trim());
  const childPid = async (supervisor) => {
    const { stdout } = await exec('ps', ['--ppid', String(supervisor), '-o', 'pid=,args=']);
    return Number(stdout.split('\n').find((line) => line.includes('server/index.js'))?.trim().split(/\s+/)[0]);
  };

  assert.match(await command('start'), /started \(pid/);
  await waitFor(ready);
  assert.match(await command('status'), /running \(pid/);
  assert.match(await command('start'), /already running/);
  const firstSupervisor = await supervisorPid();
  const firstChild = await childPid(firstSupervisor);
  assert.ok(firstChild > 0);
  // The real server receives the deployment's admin-password environment.
  const login = await fetch(base + '/admin/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test admin password' }),
  });
  assert.equal(login.status, 200);
  process.kill(firstChild, 'SIGKILL');
  await waitFor(async () => {
    const currentChild = await childPid(firstSupervisor);
    return currentChild > 0 && currentChild !== firstChild && await ready();
  });
  assert.equal(await supervisorPid(), firstSupervisor);
  const restartedChild = await childPid(firstSupervisor);
  assert.match(await command('restart'), /stopped\nstarted \(pid/);
  await waitFor(ready);
  assert.notEqual(await supervisorPid(), firstSupervisor);
  assert.throws(() => process.kill(restartedChild, 0), /ESRCH/);
  const finalChild = await childPid(await supervisorPid());
  assert.match(await command('stop'), /stopped/);
  assert.throws(() => process.kill(finalChild, 0), /ESRCH/);
  assert.equal(await command('status'), 'stopped\n');
  await assert.rejects(readFile(path.join(state, 'daemon.pid')), { code: 'ENOENT' });
  await assert.rejects(fetch(base, { signal: AbortSignal.timeout(500) }));
  assert.match(await readFile(path.join(state, 'server.log'), 'utf8'), /Game server running/);
});
