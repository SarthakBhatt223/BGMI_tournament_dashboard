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

    // When true, finishes can be recorded for a team without naming a player.
    allowUnattributedFinishes: false,

    // Sanity limit used when finalizing: total finishes in one match.
    maxFinishesPerMatch: 99,

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
    scrollPageSize: 9,
    defaultScrollIntervalSeconds: 8,
    topFraggersCount: 5,
  },
};
