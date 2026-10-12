/** Contrat JS : quand recentrer la carte sur un fix natif / mock. */
export function mapsShouldFlyToFix(movedMeters, mock, userAsked) {
  if (userAsked) return true;
  if (mock && movedMeters > 25) return true;
  return movedMeters > 80;
}

export function mapsShouldDropFix(accuracyM, mock) {
  if (mock) return false;
  return Number.isFinite(accuracyM) && accuracyM > 80;
}
