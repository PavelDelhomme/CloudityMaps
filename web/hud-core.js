/* Carte Fuel et tracés : repli sans couper le guidage, choix d’itinéraire lisible. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HuberaHud = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  /* Intensité qu’avait le tracé sélectionné : les autres la reprennent. */
  const ALT_WEIGHT = 6;
  const ALT_OPACITY = 1;
  const SELECTED_WEIGHT = 12;
  const SELECTED_OPACITY = 1;
  const ALT_JAM_WEIGHT = 9;
  const ALT_JAM_OPACITY = 0.95;
  const SELECTED_JAM_WEIGHT = 14;
  const SELECTED_JAM_OPACITY = 1;

  function routeLineStyle(selected) {
    return selected
      ? { weight: SELECTED_WEIGHT, opacity: SELECTED_OPACITY }
      : { weight: ALT_WEIGHT, opacity: ALT_OPACITY };
  }

  function routeJamStyle(selected) {
    return selected
      ? { weight: SELECTED_JAM_WEIGHT, opacity: SELECTED_JAM_OPACITY }
      : { weight: ALT_JAM_WEIGHT, opacity: ALT_JAM_OPACITY };
  }

  /* Replie ou déplie seulement la petite carte Fuel. Le guidage et le trajet restent. */
  function foldFuelCard(state) {
    const s = state || {};
    return {
      fuelCardCollapsed: !s.fuelCardCollapsed,
      navigating: s.navigating === true,
      mapsStartedFuel: s.mapsStartedFuel === true,
      fuelTrip: s.fuelTrip,
      fuelStopped: false,
    };
  }

  return {
    routeLineStyle,
    routeJamStyle,
    foldFuelCard,
    ALT_WEIGHT,
    ALT_OPACITY,
    SELECTED_WEIGHT,
    SELECTED_OPACITY,
  };
});
