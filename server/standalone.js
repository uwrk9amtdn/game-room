// Password-protected standalone game assets. The game itself stays unchanged.
// One tester password covers every protected game: Tape-Out here, and MK4 for
// visitors who are not on the server's machine (server/local-game.js).
import path from 'node:path';
import { mkdir, rename, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashPassword, readPasswordHash, verifyPassword, LoginGuard, Sessions } from './auth.js';
import { origin } from './proxy.js';

const BASE = '/solo/tape-out/';
// Shared by all protected games; scoped to their common prefix.
const COOKIE_PATH = '/solo/';
const COOKIE = 'game_room_tape_out';
// Unlock is accepted at the shared address and at Tape-Out's original one.
export const UNLOCK = ['/solo/unlock', BASE + 'unlock'];

export class StandaloneAccess {
  constructor({ dataDir, assetDir, proxy }) {
    this.file = dataDir ? path.join(dataDir, 'tape-out-password.hash') : null;
    this.assetDir = assetDir;
    this.proxy = proxy;
    this.hash = null;
    this.sessions = new Sessions();
    this.guard = new LoginGuard();
  }

  async load() { this.hash = await readPasswordHash(this.file); }

  settings() {
    return { passwordSet: Boolean(this.hash), persistent: Boolean(this.file) };
  }

  async setPassword(password) {
    if (typeof password !== 'string' || password.length < 5 || password.length > 256) {
      throw new Error('Use a tester password of 5 to 256 characters.');
    }
    const hash = await hashPassword(password);
    if (this.file) {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      await writeFile(temporary, hash + '\n', { mode: 0o600 });
      await rename(temporary, this.file);
    }
    this.hash = hash;
    this.sessions.byId.clear();
  }

  check(token) { return Boolean(this.hash && this.sessions.check(token, this.hash)); }

  // The session cookie a request carries, if any.
  cookie(req) {
    return (req.headers.cookie ?? '').split(';').map((s) => s.trim())
      .find((s) => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  }

  // Whether a request carries a valid tester session.
  checkRequest(req) { return this.check(this.cookie(req)); }

  send(res, status, body, headers = {}) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', ...headers });
    res.end(JSON.stringify(body));
  }

  async handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (UNLOCK.includes(url.pathname) && req.method === 'POST') {
      const from = origin(req, this.proxy);
      if (!from.https && !from.local) return this.send(res, 403, { error: 'Open the platform over HTTPS.' });
      if (!String(req.headers['content-type'] ?? '').startsWith('application/json') ||
          (req.headers.origin && req.headers.origin !== `${from.https ? 'https' : 'http'}://${req.headers.host}`)) {
        return this.send(res, 403, { error: 'Bad request.' });
      }
      if (!this.hash) return this.send(res, 409, { error: 'Playing is locked until an admin sets the tester password.' });
      const wait = this.guard.waitFor(from.address);
      if (wait) return this.send(res, 429, { error: `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.` },
        { 'Retry-After': String(Math.ceil(wait / 1000)) });
      let password;
      try {
        let size = 0;
        const chunks = [];
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 2048) return this.send(res, 413, { error: 'Request too large.' });
          chunks.push(chunk);
        }
        ({ password } = JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch { return this.send(res, 400, { error: 'Bad request.' }); }
      // A rotation while scrypt is running must not authorize the old password.
      const hash = this.hash;
      if (typeof password !== 'string' || password.length > 256 || !(await verifyPassword(password, hash)) || hash !== this.hash) {
        this.guard.failed(from.address);
        return this.send(res, 401, { error: 'Wrong tester password.' });
      }
      this.guard.succeeded(from.address);
      const token = this.sessions.create(hash);
      return this.send(res, 200, { token }, {
        'Set-Cookie': `${COOKIE}=${token}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict;${from.local ? '' : ' Secure;'} Max-Age=43200`,
      });
    }

    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return this.send(res, 400, { error: 'Bad path.' }); }
    const relative = pathname.slice(BASE.length);
    // Never expose the source zip, release notes, or arbitrary files.
    if (!['GET', 'HEAD'].includes(req.method) ||
        !(relative === 'index.html' || /^audio\/[a-zA-Z0-9_-]+\.mp3$/.test(relative))) {
      return this.send(res, 404, { error: 'Not found.' });
    }
    if (!this.checkRequest(req)) return this.send(res, 401, { error: 'Enter the tester password through the game page.' });
    const file = path.join(this.assetDir, relative);
    let size;
    try { size = (await stat(file)).size; }
    catch { return this.send(res, 404, { error: 'Not found.' }); }
    const headers = {
      'Content-Type': relative.endsWith('.mp3') ? 'audio/mpeg' : 'text/html; charset=utf-8',
      'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN',
    };
    let start = 0, end = size - 1, status = 200;
    if (req.headers.range) {
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
      if (!range || (!range[1] && !range[2])) return this.send(res, 416, { error: 'Invalid range.' }, { 'Content-Range': `bytes */${size}` });
      start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || end >= size) {
        return this.send(res, 416, { error: 'Invalid range.' }, { 'Content-Range': `bytes */${size}` });
      }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file, { start, end });
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
