# BGMI Tournament Management (local-first)

A web app for running a college BGMI tournament with up to a few dozen teams (built for 20). It runs entirely on your own
computer; no internet, cloud service or account is needed.

- `/admin` - private control panel: teams, players, match scoring, broadcast controls, backups.
- `/display` - public broadcast screen for the TV or projector. Display only, no controls.
- The backend is the single source of truth. It validates every change, saves it to SQLite,
  and then pushes the new state to all open pages through Socket.IO. The browser never
  calculates scores.

## Prerequisites (macOS)

- **Node.js 22.13 or newer** (includes npm). Check with `node -v`. Install from
  <https://nodejs.org> or with Homebrew: `brew install node`.
- A modern browser (Chrome, Safari or Edge).
- Internet access is needed only once, for `npm install`.

## Install

```bash
cd bgmi-tournament
npm install          # installs server and client; creates package-lock.json - commit it
cp .env.example .env # optional for single-computer use, required for LAN use
```

## Run in development

```bash
npm run dev
```

This starts the backend (port 3001) and the Vite dev server (port 5173).

- Admin:   <http://localhost:5173/admin>
- Display: <http://localhost:5173/display>

On the first start the server creates `data/tournament.db`, runs the migrations and, because
`.env.example` sets `SEED_DEMO_DATA=true`, loads 18 clearly fictional placeholder teams
("Placeholder Team 01" ...). Without `.env` the database starts empty with no demo teams.

## Run for the event (single process)

```bash
npm run build   # builds the React app into client/dist
npm start       # backend also serves the built pages
```

Admin: <http://localhost:3001/admin>, Display: <http://localhost:3001/display>.

## Configuration A: one MacBook, two screens

1. Run `npm run build && npm start`.
2. System Settings > Displays: set the external display to **Extended** (not mirrored).
3. Open `http://localhost:3001/admin` on the MacBook screen.
4. Open `http://localhost:3001/display` in a second browser window, drag it onto the external
   display and make it full screen (green window button, or Control+Command+F).
5. The HDMI distribution hardware then mirrors the external display to the TVs and projectors.

## Configuration B: two computers on the same network

1. On the host, edit `.env`:

   ```
   HOST=0.0.0.0
   ADMIN_SECRET=choose-a-long-secret-here
   ```

   The server **refuses to start** with a non-local `HOST` unless `ADMIN_SECRET` is at least
   8 characters. Keep this file private; it is ignored by git.
2. `npm run build && npm start`. The console prints the LAN addresses.
   You can also find the address with `ipconfig getifaddr en0` (Wi-Fi) or `en1`.
3. On the second computer open `http://<host-address>:3001/display` (never `localhost`; that
   would point at the second computer itself).
4. The admin panel (`/admin`) asks for the secret. Open it on the host or on one trusted
   operator device only.
5. macOS firewall: when macOS asks whether `node` may accept incoming connections, choose
   **Allow**. Otherwise add it in System Settings > Network > Firewall. TCP port 3001 must be
   reachable between the two devices, and the Wi-Fi must not have "client isolation" enabled.

Notes: traffic is plain HTTP, so the secret is readable by anyone who can sniff the network.
Use a private network you control, never public or untrusted Wi-Fi. Read-only data (standings,
rosters) is visible without the secret; every change and every backup export needs it.
Use `npm run build && npm start` for LAN use, because the Vite dev server only listens on
localhost on purpose.

## Tests, lint and build

```bash
npm test         # server tests (Node's built-in test runner)
npm run lint     # ESLint
npm run build    # production build of the client
```

`server/src/tests/api.test.js` starts the real HTTP and Socket.IO server, so it needs
`npm install` to have been run. The other test files only need Node.

## Database

- File: `data/tournament.db` (plus `-wal` and `-shm` files while running). Change it with
  `DATABASE_PATH` in `.env`. The folder is created automatically.
- Driver: `node:sqlite`, the SQLite module built into Node 22.13+. Chosen because it needs no
  native compilation on macOS and no extra dependency. It prints an "experimental" notice in
  Node 22, which the npm scripts silence. All database setup is in `server/src/db/database.js`,
  so a swap to `better-sqlite3` later only touches that file and the `db.prepare/exec` calls.
- Create or migrate: the server migrates automatically on every start. To do it manually:
  `npm run db:migrate`. Load placeholder teams into an empty database: `npm run db:seed`.
- Reset a development database: **export a backup first if the data matters**, stop the
  server, then run `npm run db:reset -- --yes`. It deletes the database file; the next start
  creates a fresh one.

## Ambient video

Export the loop from Canva as MP4 and copy it to `public/media/ambient.mp4`. It plays muted
and looped on `/display`, keeps running under the leaderboard and MVP views, and is never
downloaded or generated. If the file is missing the display shows a neutral placeholder.
To use another file name, change `display.ambientVideoFile` in Settings. See
`public/media/README.md`. Team logos uploaded in the Roster tab are stored in
`public/media/logos/`.

## Backups

- Admin > Backup > **Export backup** downloads a JSON file with all tournament data.
- **Restore from backup file** validates the file on the server first (format, version, types,
  references, duplicate keys, configuration). An invalid file changes nothing. A valid file
  **replaces everything** after you confirm, inside one database transaction.
- Backup format version 3 adds elimination events and the scheduled-leaderboard counter (older files without them still restore). Version 2 stores team finish totals. Version 1 files (made before the Player
  Finish Audit existed) are still accepted: team totals are rebuilt from the finish ledger,
  so standings are unchanged.
- Make an export before the event, after each match, and keep a copy on another device.

## What the organizer must configure

Search the code for `TODO: CONFIGURE HERE`. The main items:

| Value | Where |
| --- | --- |
| Placement-point table (**placeholder**, not the official one), finish points, WWCD placement, tie-breakers, duplicate-placement rule, whether player finishes must reconcile before finalizing (`requirePlayerReconciliationToFinalize`) | `server/src/services/defaultTournamentConfig.js`, or Admin > Settings after the first start |
| Event name, club name | Admin > Settings (default in `server/src/db/migrate.js`) |
| Ambient video path/name, `teamsPerPage` (default 10), `rotatePagesWhileVisible`, default page-flip interval | Settings (`display.*`) and `public/media/` |
| Players per team (warning only), tagline | Settings (`roster`, `branding`) |
| Browser tab title | `client/index.html` |
| Colours and sizes (final black/orange/green identity) | `client/src/styles/variables.css` |
| Port, host, admin secret, database and media paths | `.env` |
| Backend address used by the dev server | `client/vite.config.js` |

Changing the scoring configuration does not alter matches that are already finalized; their
scores are frozen. To re-score one, reopen it (with a reason) and finalize it again.

## How scoring works

- **Team finishes** (Scoring tab) are one stored number per team and match
  (`team_match_results.finish_count`), changed with `-` / `+` (`POST /matches/:id/teams/:teamId/finishes`).
  This is the **only** number that produces finish points and feeds the standings. The backend
  rejects a change below zero (409) and above `maxFinishesPerMatch`.
- **Player finishes** (Player Finish Audit tab) are entered afterwards from the official
  results and live in the `finish_events` ledger (one row per finish; `-` marks the latest row
  reversed, nothing is deleted). They never create team points; they are only compared with the
  team total, so a finish cannot be counted twice.
- Every `-` / `+` request carries a fresh `requestId`. Repeating the *same* id (network retry)
  changes nothing and returns the first answer with `"duplicate": true`; a deliberate second
  click has a new id and counts. A request that fails is rolled back and its id is not used up.
- Reconciliation per team is calculated from saved data only: `MATCH` (totals equal),
  `MISMATCH` (they differ; the difference is shown) or `INCOMPLETE` (no registered players).
  Nothing is ever corrected automatically.
- Placement points come from the configured table. WWCD means the configured winning
  placement. Total = placement points + finish points.
- Standings sort by total points, then the configured tie-breakers in order, then team id.
  **The team-id fallback is only a technical rule that makes the order repeatable; it is not
  an official tie-breaker.** Decide real ties by the official rules.
- Standings include finalized matches and, by default, the match in progress (live standings;
  switch off with `countInProgressMatchInStandings`). Inactive teams are left out.
- A match goes planned > in progress > finalized. Only one match can be in progress.
  Finalizing checks placements (all teams, no duplicates unless allowed), finish limits and, when
  `requirePlayerReconciliationToFinalize` is on (default), that every team's player total equals
  its team finishes (a team with finishes but no registered players also blocks). It then freezes
  the scores. The reasons are listed by team name; nothing is finalized silently. A finalized match cannot be finalized
  again. Corrections go through **Reopen** (reason required, previous scores kept in the audit log).
- The MVP is chosen manually. The finish ranking is shown only as a supporting statistic.

## Upgrading an existing database

Starting the server applies migration 2 automatically. It adds `finish_count` / `finish_entered`
to `team_match_results` and copies each team's existing finish count into it (unreversed ledger
rows, including finalized matches), so standings and finalized scores stay the same. No rows are
deleted. The old attributed finishes remain as player finishes, so existing matches already
reconcile. Saved configurations get the new `requirePlayerReconciliationToFinalize` default
(`true`); the removed `allowUnattributedFinishes` setting is ignored. **Export a backup before
upgrading a database that holds real data.**

## Player Finish Audit workflow

1. Scoring tab: enter team finishes (`-` / `+`) and placements during or after the match.
2. Player Finish Audit tab: pick the match, expand a team, enter each player's finishes.
3. Check the header per team (`Team finishes`, `Player total`, status) and the
   "Teams reconciled" summary. Fix whichever side is wrong; the audit never edits team scores.
4. Finalize in the Scoring tab. A finalized match is locked for both tabs; use **Reopen** (reason
   required) to correct it. Player finishes are admin-only and are not part of `/display`.

## Leaderboard pages

- **Full** layout lists every registered (active) team on one screen.
- **Compact** layout shows `display.teamsPerPage` teams per page (default 10): with 20 teams page 1
  is ranks 1-10 and page 2 is ranks 11-20. The number of pages is calculated from the real team
  count (21 teams = 3 pages, the last with one team; 8 teams = 1 page). Pages are consecutive and
  never repeat a team.
- **One page per appearance.** Each time the display switches *to* the leaderboard from another
  mode (ambient, MVP) the compact leaderboard shows the next page, wrapping around after the last
  one. The first appearance shows page 1. The server keeps this counter (`leaderboard_appearance`),
  so every display and every browser reload shows the same page. Changing the layout or the
  headline while the leaderboard is already visible is not a new appearance. Admin >
  Broadcast has **Next leaderboard page** to move on by hand.
- Set `display.rotatePagesWhileVisible` to `true` in Settings if you also want the pages to flip by
  themselves while visible (every *Page flip interval* seconds, starting from the page chosen for
  this appearance). The default is `false`.
- The setting `scrollPageSize` from earlier versions is no longer used.

## Elimination events

"Team A was eliminated by Team B" (optionally credited to one player of Team B). They are a
**broadcast and audit record only**: they never change team finishes, player finishes, kills or
points. If the operator also records the finish, that is a separate action and is counted once, in
the normal scoring.

- Allowed only while the match is **in progress**. Both teams must be active teams of the event
  and differ; a player must be an active player of the *credited* team. A team can be eliminated
  once per match (void the earlier event to record it again).
- `requestId` makes retries safe: the same id returns the first event (`duplicate: true`) and
  nothing is created or broadcast again; the same id for a different event is a 409.
- Events are never deleted. Voiding marks `status: "voided"`; the history keeps both. Teams and
  players that appear in an event cannot be deleted (deactivate them).
- After the database commit the server emits `elimination:new` (below). Error codes: 400
  malformed/unknown team or player, 404 unknown match, 409 match not in progress / already
  eliminated / `requestId` reused.

## Scheduled leaderboard (ambient mode)

While the display is in **ambient** mode the server shows the leaderboard every
`scheduledLeaderboard.leaderboardIntervalMs` (default 300000 = 5 min) for
`leaderboardDisplayDurationMs` (default 15000), `teamsPerPage` teams at a time (default 9; 18
teams = ranks 1-9, then 10-18), alternating pages on successive appearances. Settings are in
Admin > Settings (`scheduledLeaderboard`: `enabled`, `leaderboardIntervalMs`,
`leaderboardDisplayDurationMs`, `teamsPerPage`). The display duration must be shorter than the
interval. This is separate from `display.teamsPerPage`, which belongs to the manual compact layout.

- It is a **temporary overlay**: the saved broadcast mode stays `ambient`. The state snapshot has
  `broadcast.presentation` (null or the presentation below) and `broadcast.schedule`
  (settings and `nextRunAt`). A display that refreshes or reconnects reads `presentation` from the
  snapshot and shows it until `endsAt` (compare with `generatedAt`, not the browser clock).
- One scheduler runs in the server (started once in `index.js`); sockets never start timers, so
  reconnecting clients cannot duplicate it. At most an interval timer and a presentation timer
  exist, and both are cleared on shutdown.
- **The operator wins.** Selecting any mode (full leaderboard, MVP, or ambient again) cancels a
  running presentation immediately (`broadcast:state` phase `cancelled`). While the mode is not
  ambient nothing is scheduled; returning to ambient starts a fresh countdown. A backup restore
  also cancels it.
- It runs while the event status is not `completed` (setup and live both count).
- Standings are read from the normal scoring code at each appearance (latest data, official
  tie-breakers). After a restart the countdown starts fresh: appearances missed while the server
  was down are never replayed, and the page alternation continues (counter is saved).

## Real-time protocol

Socket.IO, same origin as the page. The server emits `state:update` with the full state
snapshot (the same JSON as `GET /api/state`) after every committed change and immediately
when a client connects or reconnects. A client can also emit `state:request` with an
acknowledgement callback to receive the snapshot. The server publishes only after the database
transaction succeeded; a failed request publishes nothing. The browser sockets are read-only:
all changes go through the REST API, which is protected by the admin secret.

Events (server to clients), names in `server/src/socketEvents.js`:

| Event | When | Payload |
| --- | --- | --- |
| `state:update` | connect, `state:request`, after every change and when a presentation starts or ends | full snapshot |
| `elimination:new` | after an elimination event is committed | `{ id, matchId, matchNumber, status, eliminatedTeamId, creditedTeamId, creditedPlayerId, eliminatedTeam: {id,name,shortName,logoPath}, creditedTeam: {...}, creditedPlayer: {id,name,inGameName} or null, recordedBy, metadata, createdAt, timestamp }` |
| `broadcast:leaderboard` | a scheduled leaderboard starts | `{ type: "scheduled_leaderboard", reason: "scheduled_interval", presentationId, page, totalPages, teamsPerPage, displayDurationMs, returnToMode: "ambient", standings: [{ rank, teamId, name, shortName, logoPath, wwcd, finishCount, finishPoints, placementPoints, totalPoints }], startedAt, endsAt, timestamp }` |
| `broadcast:state` | presentation lifecycle | `{ phase: "leaderboard_started" or "returned_to_ambient" or "cancelled", reason, presentationId, mode, presentation, timestamp }` (`cancelled` reasons: `manual_mode_change`, `disabled`, `mode_changed`, `backup_restored`) |

## API reference

All routes are under `/api`. Errors return `{ "error": { "code", "message", "details" } }`.
Reads are public; all other methods and `GET /backups/*`, `GET /audit-log`,
`GET /matches/:id/player-audit` and `GET /matches/:id/finish-events` need the
`x-admin-secret` header when `ADMIN_SECRET` is set.

| Method and path | Purpose |
| --- | --- |
| `GET /health` | Server status |
| `GET /state` | Full state snapshot |
| `POST /auth/verify` | Check the admin secret |
| `GET /audit-log?limit=` | Recent administrative actions |
| `GET, PATCH /event` | Event name, club, status |
| `GET, PUT /event/config` | Scoring, roster, branding, display configuration |
| `GET, POST /teams`; `GET, PATCH, DELETE /teams/:id` | Teams (delete refused if they have history) |
| `PUT /teams/:id/logo` | Raw image upload (png, jpeg, webp; max 2 MB) |
| `GET, POST /players`; `GET, PATCH, DELETE /players/:id` | Players |
| `GET, POST /matches`; `GET /matches/:id` | Matches and the scoreboard of one match |
| `POST /matches/:id/start`, `/finalize`, `/reopen` | Match lifecycle (`reopen` needs `{ "reason" }`) |
| `PUT, DELETE /matches/:id/results/:teamId` | Set `{ "placement" }` / clear it |
| `POST /matches/:id/teams/:teamId/finishes` | Team finish total `{ delta: 1 or -1, requestId }` |
| `GET /matches/:id/player-audit` | Per-team reconciliation and player finishes (admin secret) |
| `POST /matches/:id/players/:playerId/finishes` | Player finish `{ delta, requestId, teamId? }`; returns the refreshed audit |
| `GET /matches/:id/finish-events` | Player finish ledger including undone rows (admin secret) |
| `GET /matches/:id/eliminations` | Elimination history of a match (oldest first, voided events included) |
| `POST /matches/:id/eliminations` | Record `{ eliminatedTeamId, creditedTeamId, creditedPlayerId?, requestId, metadata? }` (integer ids); 201 new, 200 repeat of a `requestId`; optional header `x-operator` |
| `POST /matches/:id/eliminations/:eventId/void` | Void a mistaken event `{ reason? }` (kept in the history) |
| `GET /standings`; `GET /player-stats?search=` | Standings and their pages (`display.teamsPerPage` per page); player statistics |
| `GET, PUT /broadcast` | Mode (`ambient`, `standings`, `mvp`), layout, interval, text, current match, `advanceLeaderboardPage: true` |
| `GET, PUT /mvp` | `{ "playerId": id or null }` |
| `GET /backups/export`; `POST /backups/import` | Backup; restore `{ "confirm": true, "backup": {...} }` |

## Project layout

```
server/src/   index.js app.js config.js errors.js validation.js
  db/         database.js migrate.js seed.js reset.js
  services/   scoringRules (pure) scoringService standingsService playerStatsService
              broadcastService rosterService eventService backupService stateService auditService
  routes/     one thin router per resource
  tests/      *.test.js
client/src/   routes/ components/ hooks/ services/ (api.js, socket.js) styles/ utils/
```

## Venue test checklist

1. `npm run build && npm start`, open `/admin` and `/display` on the real hardware.
2. Add a test match, record finishes and placements, check the display updates within a second.
3. Switch every display mode; check that the compact leaderboard alternates pages on each appearance and that the full layout shows every team.
4. Pull the network cable or Wi-Fi on the display computer: the "Connection lost" badge must
   appear and the data must refresh by itself when the network returns.
5. Restart the server: data must still be there.
6. Export a backup, restore it, confirm the standings are unchanged.
7. Delete the test match data (restore a pre-event backup), then start the event.
