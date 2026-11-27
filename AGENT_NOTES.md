# What this is

Game Room is a browser game platform with a Node.js ES-module server, WebSocket
lobby and buildless browser JavaScript. Games provide server/client modules.

# Map

- `server/`: HTTP/static serving, lobby/matches, archive, admin, statistics.
- `public/`: site shell, styles, service worker; `public/js/app.js` drives views.
- `games/`: discoverable game plugins; [contract](games/README.md).
- `tape-out-beta-2/`: Git-ignored private build, copied separately to the server
  repo root; only HTML/audio served. Hosting: `server/standalone.js`.
- `mk4-build/`: Git-ignored MK4 build exported by `mk4-port` (`tools/export-game-room.mjs`
  there); served only locally by `server/local-game.js`.
- `test/`: platform tests and fixtures; game tests live in `games/*/test/`.
- `deploy/`, `DEPLOY.md`: existing deployment tooling and server setup.
- `data/`, `node_modules/`: ignored runtime data and dependencies.

# Commands

- Install: `npm install` (Node >=22). Run: `npm start` (http://localhost:9494).
- Tests: `npm test` (platform and all game tests via Node's test runner).

# Decisions

- Game discovery uses `games/<id>/server/index.js`; no central game registry.
- Tape-Out uses a separate single-player session, with an admin-managed tester
  password; presence blocks invitations. Saves stay in browser storage.
- Tester passwords accept 5–256 characters. Tape-Out's header offers iframe
  fullscreen and the platform's shared Feedback dialog beside Exit game.
- Private Tape-Out assets stay outside Git; integration tests create temporary
  fixtures and do not need the real build.
- Deployment prefers `/usr/local/bin/node`, then discovers Node from PATH;
  set an absolute `node=` in `~/.game-room/config` for nvm/cron.
- Deployment uses FreeBSD `daemon(8)` or a Linux nohup supervisor; the same
  start/stop/restart commands manage both. `GAME_ROOM_STATE` isolates test state.
- Mortal Kombat 4 is developed in its own repository at `/home/hd/Desktop/mk4-port`
  (moved out 2026-11-26). `games/mk4` is a `localOnly` standalone game: listed,
  launched and served only for direct loopback connections with a loopback Host while
  `mk4-build/manifest.json` exists; no password. Plan in that repository.
- Standalone games declare their embedded page in `meta.solo`.

# Docs

- Root references: [README.md](README.md), [DEPLOY.md](DEPLOY.md), [ANDROID.md](ANDROID.md).
- [doc/standalone-games.md](doc/standalone-games.md): Tape-Out setup, protected
  assets, password persistence, presence lifecycle and verification; MK4 local-only hosting.
- [doc/plans/](doc/plans/): implementation checklists, including completed work.

# Current work

- None.

# Ruled out

- Hosting MK4 port development (C engine, recompiler, native host) in this repository:
  moved to its own repository (2026-11-26).
- Representing standalone play as multiplayer matches with fake opponents:
  separate presence avoids spectator/archive behavior that does not apply.
