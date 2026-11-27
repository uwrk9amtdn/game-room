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
