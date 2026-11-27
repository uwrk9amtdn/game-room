// A private single-player game built from the owner's files (MK4). Its build
// is exported into an ignored directory with a manifest.json; only the files
// the manifest names are served. On the server's own machine (direct loopback
// request, loopback Host) no password is needed; everyone else needs the
// tester password (StandaloneAccess), like Tape-Out.
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { origin } from './proxy.js';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json',
};
// localhost, 127.0.0.1, [::1], with an optional port. Anything else may be a
// DNS-rebinding page or a proxy that did not say it forwarded the request.
const LOOPBACK_HOST = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

export const loopbackHost = (host) => LOOPBACK_HOST.test(String(host ?? ''));

export class LocalGame {
  constructor({ id, dir, proxy, access = null }) {
    this.id = id;
    this.access = access;
    this.base = `/solo/${id}/`;
    this.dir = dir;
    this.proxy = proxy;
    this.manifest = null;
    this.checkedAt = 0;
  }

  // Re-reads manifest.json at most every two seconds, so a fresh export is
  // picked up without a restart.
  async refresh() {
    if (Date.now() - this.checkedAt < 2000) return this.manifest;
    this.checkedAt = Date.now();
    try {
      const manifest = JSON.parse(await readFile(path.join(this.dir, 'manifest.json'), 'utf8'));
      this.manifest = manifest && typeof manifest.files === 'object' && manifest.files['index.html'] ? manifest : null;
    } catch { this.manifest = null; }
    return this.manifest;
  }

  available() { return Boolean(this.manifest); }

  // A request (or WebSocket upgrade) from this machine, not relayed by the proxy.
  isLocal(req) { return origin(req, this.proxy).local && loopbackHost(req.headers.host); }

  allowed(req) { return this.isLocal(req) || Boolean(this.access?.checkRequest(req)); }

  async handle(req, res) {
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    };
    if (!['GET', 'HEAD'].includes(req.method)) return notFound();
    const manifest = await this.refresh();
    let name;
    try { name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname.slice(this.base.length)); }
    catch { return notFound(); }
    if (!manifest) return notFound();
    // Tells the game page whether to ask for the password. Reveals nothing else.
    if (name === 'access') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ local: this.isLocal(req) }));
    }
    if (!this.allowed(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end('Enter the tester password through the game page.');
    }
    if (!Object.hasOwn(manifest.files, name) || name === 'manifest.json') return notFound();
    const file = path.join(this.dir, name);
    let info;
    try { info = await stat(file); }
    catch { return notFound(); }
    const etag = `"${manifest.build ?? 'dev'}-${info.size}-${Math.floor(info.mtimeMs)}"`;
    const headers = {
      'Content-Type': TYPES[path.extname(name)] ?? 'application/octet-stream',
      // Revalidated on every launch; unchanged files answer 304 instead of 40+ MB again.
      'Cache-Control': 'private, no-cache', ETag: etag,
      'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex',
      'Content-Security-Policy': "frame-ancestors 'self'", 'X-Frame-Options': 'SAMEORIGIN',
    };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }
    headers['Content-Length'] = info.size;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }
}
