# Status: done — 2026-11-27

## Goal
Launch the supplied Tape-Out beta inside Game Room behind a tester password
managed in the admin panel. Everyone sees the card and players' activity;
invitations are blocked during play.

## Context
The existing plugin contract assumes multiplayer matches. The supplied
`tape-out-beta-2/index.html` is a compiled standalone game with relative audio
URLs and browser-local saves. Preserve these assets unchanged.

## Approach
Add a separate single-player session lifecycle, without fake opponents,
spectators or archived matches. Serve only HTML/audio through authenticated
routes; persist a scrypt password hash in the runtime data directory. Reuse
the platform's admin authentication and password rate limiter. Embed the game
in an iframe and retain its own browser-local saves.

## Steps
- [x] Add protected content serving, tester authentication, and admin settings.
- [x] Add server-authoritative single-player presence and invitation blocking.
- [x] Add the game card, embedded launch/exit flow, and admin form.
- [x] Test access, presence, invitations, password rotation and regressions.
- [x] Update documentation, notes and development log.

## Open questions
None. User chose an admin-managed password, public card, blocked invitations,
and embedded play. Access stays locked until a password is configured.
