## 2026-11-27 09:38 +03:00 — Integrate protected Tape-Out beta

### Changes made

- Added a public **Tape-Out · Beta** game card and password form. The game opens
  inside the platform with an **Exit game** button.
- Added **Tape-Out beta access** in `/admin` for setting/changing a separate
  tester password. Testing stays locked until an admin configures it.
- Added server-authoritative single-player presence: the player list shows
  **playing · Tape-Out · Beta**, the card counts active players, and invitations
  in both directions are blocked during play. Launch closes pending invitations.
- Protected both game HTML and audio, including direct URLs. Added streaming
  and byte ranges for audio. ZIP/PDF files are not exposed.
- Preserved the supplied compiled game and audio unchanged. Saves/preferences
  remain in browser storage; iframe teardown invokes its existing save handler.

### How it works

- `games/tape-out/` supplies discovery metadata and the launch form.
  `server/standalone.js` hashes the password with scrypt, persists only the hash
  in `DATA_DIR/tape-out-password.hash` (0600, atomic replacement), rate limits
  password guesses, and issues HttpOnly cookies plus opaque WebSocket launch
  tokens. Remote unlocks require HTTPS using the existing proxy settings.
- `server/panel.js` exposes password updates only through existing authenticated
  admin routes. Password changes invalidate access and end active embeds.
- `server/lobby.js` owns standalone busy state. Exit, disconnect and replacement
  connections clear it. Multiplayer games and restart announcements prevent
  new standalone launches. No fake opponent, spectator session or archived match
  is created. Standalone play does not delay scheduled server restarts.
- `public/js/app.js` embeds the game only after the server confirms launch,
  shows status and exit controls, and tears down the embed on connection loss.
- Setup and lifecycle reference: `doc/standalone-games.md`; completed plan:
  `doc/plans/2026-11-27-tape-out-integration.md`. Updated README, plugin contract
  and AGENT_NOTES to cover the integration.

### Testing

- `npm test`: all 315 tests passed, including the new HTTP/WebSocket integration
  test for admin authorization, password validation/persistence/rotation,
  protected content, byte ranges, path restrictions, throttling, HTTPS checks,
  launch-token validation, presence, invitation cancellation/blocking, exit,
  disconnect, connection replacement, multiplayer conflicts and restart gating.
- Headless Chromium with temporary runtime data: passed actual admin login and
  password form, public card navigation, wrong-password feedback, embedded
  Tape-Out rendering, authenticated audio range delivery, live player status,
  exit cleanup and password rotation. No uncaught browser exceptions. At a
  390-pixel mobile viewport the iframe measured 370 pixels wide and fit the page.
- JavaScript syntax checks and `git diff --check` passed. Local-server tests
  required execution outside the filesystem sandbox because socket listening
  is blocked inside it. No permanent test passwords were configured.

### Outstanding issues

- Saves remain browser/origin-specific and are not synchronized across devices.
  The checks cover integration, not an exhaustive playthrough of Tape-Out.
- Programmatic `startServer()` without `dataDir` retains the tester password only
  in memory; normal startup/deployment persist it, and the admin UI reports this.

## 2026-11-27 09:44 +03:00 — Keep the private Tape-Out build outside Git

### Changes made

- Added repository-root `tape-out-beta-2/` to `.gitignore`, matching the user's
  decision to copy the private build separately to the server. No build files
  were tracked or copied into the integration. Runtime still reads directly
  from `<server-repository-root>/tape-out-beta-2/index.html` and `audio/`.
- Added the programmatic `tapeOutDir` server option and changed the integration
  test to generate temporary synthetic HTML/audio fixtures. Clean checkouts and
  deployment test worktrees no longer depend on the private build being present.
- Documented separate asset deployment and fixture-based testing; updated
  AGENT_NOTES. ZIP/PDF files are not needed on the server.

### Testing

- The standalone HTTP/WebSocket integration test passed using temporary assets,
  including exact HTML content and audio byte-range assertions.
- `git check-ignore` confirmed the real HTML/audio files are ignored;
  `git ls-files tape-out-beta-2` confirmed no files in the folder are tracked.
  `git diff --check` passed.

## 2026-11-27 09:47 +03:00 — Discover Node for deployment commands

### Changes made

- Fixed `deploy/game-room` assuming `/usr/local/bin/node` exists: it now
  prefers that FreeBSD installation when available and otherwise discovers
  Node from PATH. An explicit `node=` in `~/.game-room/config` still overrides
  discovery. Configure the absolute path printed by `command -v node` on the
  server, especially for nvm installations used by cron, and retry
  `deploy/game-room set-password`.
- Start/password commands validate Node before doing work or asking for a
  password, with an actionable config error if the executable is missing.
- Updated DEPLOY.md troubleshooting and AGENT_NOTES. The user's remote server
  configuration was not modified.

### Testing

- `sh -n deploy/game-room` and `git diff --check` passed.
- An isolated temporary script/state directory verified PATH discovery,
  explicit valid overrides, and an invalid configured path failing before
  the password prompt with setup instructions. No passwords were entered
  or changed during these checks; FreeBSD daemon execution was not tested.

## 2026-11-27 09:51 +03:00 — Support Linux deployment without FreeBSD daemon

### Changes made

- Fixed `deploy/game-room restart` failing on Linux with `daemon: command not
  found`. FreeBSD retains its native `daemon(8)` path; other systems use a
  background shell supervisor under `nohup`, without an additional package.
- The supervisor restarts Node after an exit, records its pid in the existing
  pid file, logs to the existing server log, and stops/reaps its child on
  shutdown. Existing start, stop, restart, status and admin environment settings
  work with both paths. Retry `deploy/game-room restart`, then
  `deploy/game-room status`; the local admin page is normally
  `http://localhost:9494/admin`.
- Added `GAME_ROOM_STATE` as an optional state-directory override for isolated
  instances/tests, keeping the default `~/.game-room`. Updated deployment docs,
  README and AGENT_NOTES for Linux support.

### Testing

- `npm test`: all 316 tests passed. The new Linux deployment test launches the
  real server on a temporary port with isolated state, verifies admin login,
  duplicate-start handling and status, kills Node to verify automatic crash
  recovery, restarts the supervisor, and checks shutdown removes the pid file
  and leaves no Node child or listening server. Test instances were stopped.
- `sh -n deploy/game-room` and `git diff --check` passed. FreeBSD daemon execution
  was not available on this Linux machine; its invocation was preserved.

## 2026-11-27 09:58 +03:00 — Add Tape-Out fullscreen and feedback controls

### Changes made

- Reduced the Tape-Out tester password minimum from 10 to 5 characters in both
  server validation paths, the admin form and the tester launch form. Kept the
  existing 256-character maximum and the separate admin password policy.
- Added Fullscreen and Feedback buttons beside Exit game during Tape-Out play.
  Fullscreen targets the game iframe itself, fills the display, and returns to
  the embedded view with Escape. Unsupported browsers disable the button;
  denied requests show a notice.
- Feedback uses the same shared handler/dialog as the menu action, preserving
  Tape-Out context, admin delivery and submission cooldown. Game-header controls
  wrap on narrow screens. The private game build remains unchanged and ignored.
- Updated the standalone reference and AGENT_NOTES.

### Testing

- Standalone and feedback integration tests: all 5 passed. The password test now
  rejects four characters and sets/unlocks/persists an exact five-character
  password, while retaining access-control and presence lifecycle coverage.
- Headless Chromium verified a five-character password through the admin and
  launch forms, Fullscreen button activation and iframe dimensions matching the
  display, leaving fullscreen, feedback delivery with the correct game/player
  context, shared cooldown, exit and password rotation. Mobile width remained
  within a 390-pixel viewport; no uncaught browser exceptions occurred.
- JavaScript syntax checks and `git diff --check` passed.

## 2026-11-27 11:05 +03:00 — Add MK4 as a local-only standalone game

**Features implemented**
- `games/mk4/`: Mortal Kombat 4 as a single-player standalone game, built from
  the user's own files in the `mk4-port` repository and exported into the
  ignored `mk4-build/`. Play button on the game page; the platform's
  Fullscreen, Feedback and Exit game apply.
- `server/local-game.js` (`LocalGame`): serves `/solo/mk4/<name>` for names in
  `mk4-build/manifest.json` only, only to direct loopback requests with a
  loopback `Host`; the same 404 for everything else. ETag + `private, no-cache`.

**Changes made**
- Lobby: `localGames` option, `canSee(conn, id)`; local-only games are left
  out of the `joined` game list for other connections, `soloStart` accepts them
  without a token for local connections, and the user list shows their players
  as busy with `game: null` to anyone who cannot see the game.
- `startServer({ mk4Dir })`, manifest re-read every 5 s (export/removal without
  restart); WebSocket connections carry a `local` flag.
- Standalone metadata: `meta.solo` names the embedded page (Tape-Out and MK4);
  the iframe takes title from `meta.name` and allows `gamepad`.
- Fullscreen button returns keyboard focus to the iframe.
- `test/helpers.js` `connect(port, options)` passes WebSocket options (headers).

**How it works**
- Local check: `origin(req, proxy).local` (direct loopback, no trusted proxy
  headers) plus `Host` matching localhost/127.0.0.1/[::1]. The Host rule blocks
  DNS rebinding and a proxy that forwards without `X-Forwarded-For`.
- Rejected: a Tape-Out-style password (would still send files derived from the
  game to remote players; no redistribution); serving directly from
  `mk4-port/private/` (couples repositories, serves whatever is there).

**Testing**
- `npm test`: 318/318, including new `test/local-game.test.js` (Host names;
  hidden without build; listing/launch/serving only locally; 304; unlisted,
  manifest, traversal and bad-escape paths 404; proxied and foreign-Host 404;
  remote player sees "busy" with no game id; invitation blocked; re-launch).
- Chromium against the real export (`tools/check-game-room.py` in mk4-port):
  listed, loads in 0.3 s from cache, runs, pauses on outside click, mute via
  the Sound key suspends engine audio, fullscreen focus, exit, fresh relaunch,
  proxied request 404, no page errors.
- Not tested: real gamepad, Firefox, the public deployment itself (the rule is
  covered by the proxy-header tests).

**Next steps**
- User acceptance of MK4 single-player inside Game Room.

## 2026-11-27 12:00 +03:00 — MK4 for remote players behind the tester password

**Changes made**
- MK4 is listed to everyone while `mk4-build/` exists; remote visitors unlock it
  with the tester password (the same as Tape-Out's). The server's own machine
  still plays without a password. Replaces the localhost-only rule.
- `server/standalone.js`: session cookie scoped to `/solo/` (was
  `/solo/tape-out/`), shared unlock address `/solo/unlock` (old address kept),
  `cookie(req)`/`checkRequest(req)`.
- `server/local-game.js`: `allowed(req)` = local or valid tester session; 401
  without access; `/solo/mk4/access` answers `{ local }` for the game page.
- Lobby: `canSee` = game present and its build (if any) available; `soloStart`
  for MK4 needs the token unless the connection is local;
  `endPasswordSessions` (used by the admin password change) leaves local MK4
  play running.
- `public/js/kit/unlock.js`: shared password form; Tape-Out and MK4 clients use
  it. MK4 shows Play locally, the form elsewhere. `meta.localOnly` removed.
- Admin: section renamed "Tester access (Tape-Out, MK4)".
- `mk4-build/` now holds real copies (no symlinks), so it can be copied to the
  server; still Git-ignored.

**How it works**
- The user chose the shared tester password over separate MK4 access.
- Rejected: serving MK4 to every visitor without a password (public
  distribution of the game's files).

**Testing**
- `npm test`: 318/318. `test/local-game.test.js` rewritten: hidden without a
  build; local access and Play without password; remote 401, 409 before a
  password is set, wrong password 401, plain HTTP 403, unlock sets
  `Path=/solo/; Secure`, then files served; lobby refuses null/forged tokens and
  accepts the real one; password rotation ends the remote session and its file
  access but not local play; removing the build hides the game. The Tape-Out
  test passes unchanged.
- Chromium against the real build (`tools/check-game-room.py` in mk4-port),
  20/20: local flow as before, plus a remote visitor (non-loopback host name)
  sees the password form, gets 401 before unlocking, wrong password refused,
  plays after unlocking.
- Not tested: on the deployed server behind the real proxy.

**Next steps**
- Copy `mk4-build/` to the server and check a remote launch there.

## 2026-11-27 13:10 +03:00 — MK4 online 1v1 matches

**Features implemented**
- MK4 is a two-player game with invitations (`players: 2`) and keeps its
  single-player launch. The inviter picks the input delay (2-8 frames, default 4).
- `games/mk4/server/match.js` (`Mk4Match`): ready handshake with a shared
  server seed; ordered input relay (`from` must continue the sequence, words
  ≤ 24 bits, batches ≤ 64, lead ≤ 2 × delay + 64, `ack` trims resends); state
  hashes every 60 ticks, mismatch → `desync`; `leave`, `abandoned`; snapshots
  with `moves: []` (never archived); no inputs or seed for spectators.
- `games/mk4/client/index.js`: invite form, results, match view (frame with
  `?net=1`, postMessage relay, password form when needed, Leave match,
  Fullscreen, status line; refuses to rejoin after a reload).

**Changes made**
- Lobby: solo launch requires `meta.solo` (not `singlePlayer`); invitations
  and play-the-computer refuse games whose build is missing; user list entries
  carry `solo: true` so solo players show as "playing".

**Testing**
- `npm test` 324/324: new `games/mk4/test/match.test.js` (options, start,
  seeds, input validation and trimming, lead limit, hashes and desync, leave,
  abandon) and an online lobby test (no invite without a build; invite, accept,
  ready, relay, no solo launch mid-match, leave frees both).
- mk4-port `tools/check-game-room-online.py`: two Chromium players, 3,049
  ticks, hashes verified to 3,000, leave and close. Single-player check 20/20.
- Not tested: real network, second machine, gamepads.

**Next steps**
- Test with a second machine over the deployed server.

## 2026-11-27 13:20 +03:00 — MK4 online: side/join guide and network readout

**Changes made**
- After the first user test (Player 2 had no fighter; the game slowed down): the MK4 match
  view tells each player their side and that Player 2 must join in on the game's
  "1 on 1 / 2 on 2" screen; a network readout shows the round trip, the share of frames
  spent waiting and a suggested delay. Input delays 10 and 12 frames added.
- `Mk4Match.snapshot(seat).remote.acked`: how many of this seat's ticks the other browser
  has received (the frame measures the round trip from it).

**How it works**
- Key routing was already correct (each player's keys drive their own fighter); MK4 itself
  needs Player 2 to join in. Lockstep slows both games whenever the round trip exceeds about
  2 × delay frames less one frame; details and remedies (rollback) in mk4-port's
  `doc/multiplayer-design.md`.

**Testing**
- `npm test` 324/324 (match and lobby tests expect `acked`). mk4-port's online check: Player 2
  joins through their own keys (PLAYER 2 READY on screen), readout shown, hashes verified.
- Not tested over a real network.

**Next steps**
- Second user test with the readout; then decide on rollback.

## 2026-11-27 18:30 +03:00 — MK4 online: rollback netcode by default

**Changes made**
- Invite form: netcode choice, rollback (recommended; delay 1-8 frames, default 2) or
  lockstep (2-12, default 4). Options `{mode, delay}`; `MODES` in `games/mk4/server/index.js`;
  an invite without `mode` is rollback.
- `Mk4Match`: inputs may carry `lead` (integer, |lead| ≤ 255), passed to the other seat as
  `remote.lead` (rollback time sync).
- View: loads the frame with `&rollback=1` for rollback, relays `lead`, status names the
  netcode, readout shows corrections per second and the longest correction; delay advice per
  netcode.

**How it works**
- Rollback itself lives in mk4-port (`port/rollback.mjs`, `port/rollback-session.mjs`,
  `doc/rollback.md`). The server stays an ordered input relay with hash comparison; the
  existing lead limit (2 × delay + 64 ticks) already covers the 8-tick rollback window.
- Lockstep is kept as an option in case rollback misbehaves on a real link.

**Testing**
- `npm test` 324/324 (options, `lead` validation and relay).
- mk4-port's `check-game-room-online.py` through this server: rollback and lockstep both ok
  locally; with ~220 ms round trip (added WebSocket delay) rollback 59.4 ticks/s with no
  waiting, lockstep 34.4 ticks/s waiting 60%; no server errors, hashes verified.
- Found and fixed in mk4-port on the way: a rollback time-sync deadlock and a tick-0 hash
  this server refused.
- Not tested: a real network.

**Next steps**
- Deploy (this repo plus a fresh `mk4-build/`), then a real two-machine match.
