This document covers Tape-Out's protected single-player hosting and presence lifecycle.

## Using the beta

1. Open `/admin`, log in, and use **Tape-Out beta access** to set a tester
   password (5–256 characters). It is separate from the admin password.
2. Share that password with testers. Everyone sees **Tape-Out · Beta** in the
   game grid; its page is `/#/tape-out`.
3. A tester enters the password and plays inside the platform. The player list
   shows **playing · Tape-Out · Beta**, and the card counts them as playing.
   Multiplayer invitations are blocked until they use **Exit game**.
4. **Fullscreen** expands the game iframe to fill the screen; press Escape to
   return. **Feedback** opens the platform's existing feedback dialog, including
   the Tape-Out context, submission limits and delivery to the admin panel.

No default tester password is provided: play stays locked until an admin sets
one. Changing the password ends active embedded sessions and invalidates every
old tester cookie and launch token. Testers must enter the new password.

## Files and access

- `games/tape-out/`: public metadata and launch form, plus the discovery module.
- `tape-out-beta-2/index.html` and `audio/*.mp3`: original compiled assets,
  served unchanged from protected `/solo/tape-out/` routes. Deployment needs
  these files at the same relative paths. This directory is ignored by Git:
  copy it separately to `<server-repository-root>/tape-out-beta-2/`, keeping
  `index.html` and the `audio/` subdirectory. Only the integration code is
  committed. The supplied ZIP and PDF are not served and need not be copied.
- `server/standalone.js`: password hashing, persistence, rate limiting, sessions,
  and streamed content delivery with audio byte-range support.
- `server/panel.js` and `public/admin/`: authenticated password setting and status.
- `server/lobby.js` and `public/js/app.js`: launch authorization and presence.

The server keeps only a scrypt hash at `DATA_DIR/tape-out-password.hash`, written
atomically with mode 0600. Normal `npm start` and `deploy/game-room` provide a
persistent data directory. A programmatic `startServer()` without `dataDir`
keeps this setting in memory; the admin panel reports that limitation.

Unlocking requires HTTPS, except on localhost, using the same trusted proxy
configuration as the admin panel. Wrong guesses are rate limited. The unlock
response sets an HttpOnly, SameSite=Strict cookie scoped to the protected game
path, with Secure on remote connections. A separate opaque token in that response
authorizes `soloStart` over the player's existing WebSocket. Both HTML and audio
require the cookie; their responses use `Cache-Control: no-store`.

Tester access expires after two idle hours or twelve total hours and is lost
when the server restarts. Password settings persist across restarts. Already
delivered game content cannot be taken back; password changes block further
requests and close the platform's active embeds.

## Lifecycle and saves

The `singlePlayer: true` metadata distinguishes Tape-Out from multiplayer
plugins. Its server module exports metadata only; its launch form uses
`ctx.startSolo(token)`. The protected asset handler currently supports Tape-Out
specifically; metadata alone does not add hosting for other standalone games.

The lobby verifies the token before acknowledging `soloStarted`. Launch cancels
pending invitations and spectator subscriptions. A standalone session occupies
the player, blocks incoming/outgoing invitations and other games, and appears in
the admin player overview. It creates no opponent, match record, spectator view
or multiplayer statistics. It does not hold up a scheduled server restart.

Exit, password rotation, and connection loss tear down the iframe. Disconnect
removes the player immediately rather than retaining a multiplayer seat. A
replacement connection clears standalone presence; it does not resume the
iframe. A restart announcement blocks new launches.

Tape-Out keeps saves and preferences in its original browser-local storage.
Before tearing down the frame, the host dispatches its `beforeunload` handler
to flush the existing save. Saves are browser/origin-specific and are not synced
to the platform or another device. Keep the original asset storage keys when
updating the build.

## Verification

Run `npm test` for the platform and all game tests. `test/standalone.test.js`
creates temporary synthetic HTML/audio assets through the programmatic
`startServer({ tapeOutDir })` option; tests need no private game files.
The default runtime directory remains the repository-root `tape-out-beta-2/`.
The integration test
covers admin authorization, password persistence/rotation, protected HTML/audio,
path restrictions, audio ranges, HTTPS enforcement, throttling, launch-token
validation, invitation blocking, exit, disconnect and connection replacement,
multiplayer conflicts, and restart restrictions.

For browser checks, verify the actual admin form, wrong-password feedback,
embedded rendering/audio, mobile width, player status, exit, and password rotation.
