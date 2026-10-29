// Pure scoring functions. No database access, so they are easy to test and reason about.
// Every score in the application is derived from these functions plus the stored configuration.

export function placementPointsFor(scoringRules, placement) {
  if (placement === null || placement === undefined) return 0;
  return Number(scoringRules.placementPoints[placement] ?? 0);
}

export function finishPointsFor(scoringRules, finishCount) {
  return finishCount * scoringRules.finishPointsPerElimination;
}

export function isWwcd(scoringRules, placement) {
  return placement !== null && placement !== undefined && placement === scoringRules.winnerPlacement;
}

// Score of one team in one match. Total = placement points + finish points.
export function scoreTeamMatch(scoringRules, { placement, finishCount }) {
  const placementPoints = placementPointsFor(scoringRules, placement);
  const finishPoints = finishPointsFor(scoringRules, finishCount);
  return {
    placementPoints,
    finishPoints,
    isWwcd: isWwcd(scoringRules, placement),
    totalPoints: placementPoints + finishPoints,
  };
}
