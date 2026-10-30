// Default event configuration, stored in the database on first run and editable afterwards
// through PUT /api/event/config (or the Settings tab in /admin).
//
// Every value here is a PLACEHOLDER until the organizer confirms the official rules.

export const TIE_BREAKER_KEYS = ['wwcd', 'placementPoints', 'finishPoints', 'bestPlacement'];

export const defaultTournamentConfig = {
  scoring: {
    // TODO: CONFIGURE HERE - points awarded per elimination.
    finishPointsPerElimination: 1,

    // TODO: CONFIGURE HERE - placeholder table, NOT the confirmed official table.
    // Keys are final placements; any placement missing from the table scores 0.
    placementPoints: { 1: 15, 2: 12, 3: 10, 4: 8, 5: 6, 6: 4, 7: 2, 8: 1 },

    // Placement that counts as a WWCD (winner winner chicken dinner).
    winnerPlacement: 1,

    // TODO: CONFIGURE HERE - order applied after total points. Higher is better for every
    // key except bestPlacement, where a lower placement number is better.
    // Allowed keys: wwcd, placementPoints, finishPoints, bestPlacement.
    tieBreakers: ['wwcd', 'placementPoints', 'finishPoints', 'bestPlacement'],

    // Two teams may not share a placement unless the organizer explicitly allows it.
    allowDuplicatePlacements: false,

    // Sanity limit for the finishes of one match (team totals and player totals).
    maxFinishesPerMatch: 99,

    // When true, a match cannot be finalized until every team's recorded finish total equals
    // the sum of its players' finishes (Player Finish Audit tab).
    requirePlayerReconciliationToFinalize: true,

    // When true, every active team needs a placement before a match can be finalized.
    requireAllTeamsPlaced: true,

    // When true, standings also include the match currently in progress (live standings).
    countInProgressMatchInStandings: true,
  },

  roster: {
    // TODO: CONFIGURE HERE - used for roster warnings only; smaller rosters are still allowed.
    playersPerTeam: 4,
  },

  branding: {
    // TODO: CONFIGURE HERE - shown under the event name on the public display.
    tagline: '',
  },

  display: {
    // TODO: CONFIGURE HERE - file name inside the media folder (see public/media/README.md).
    ambientVideoFile: 'ambient.mp4',
    // Teams shown per page of the compact leaderboard (the full leaderboard always shows all teams).
    teamsPerPage: 10,
    // false: the compact leaderboard shows ONE page per appearance and the next appearance shows the
    // next page. true: it also flips pages by itself while visible (every scrollIntervalSeconds).
    rotatePagesWhileVisible: false,
    defaultScrollIntervalSeconds: 8,
    topFraggersCount: 5,
  },

  // Automatic leaderboard while the display is in ambient mode. The server decides when it
  // appears; it is a temporary overlay, so the persisted broadcast mode stays "ambient".
  scheduledLeaderboard: {
    enabled: true,
    // How often the leaderboard appears (start to start), in milliseconds. Default: 5 minutes.
    leaderboardIntervalMs: 300000,
    // How long each appearance lasts before the display returns to ambient. Default: 15 seconds.
    leaderboardDisplayDurationMs: 15000,
    // Teams per page of the scheduled leaderboard (18 teams = pages 1-9 and 10-18).
    teamsPerPage: 9,
  },
};
