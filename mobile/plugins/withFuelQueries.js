/**
 * Android 11+ : ouvrir Hubera Fuel depuis Maps.
 */
const { withAndroidManifest } = require('@expo/config-plugins');

function withFuelQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    if (!manifest.queries) manifest.queries = [];
    const schemes = ['gasoiltracking', 'gasoiltracking-preprod'];
    let block = manifest.queries.find((q) => q.intent);
    if (!block) {
      block = { intent: [] };
      manifest.queries.push(block);
    }
    if (!Array.isArray(block.intent)) block.intent = [block.intent].filter(Boolean);
    for (const scheme of schemes) {
      block.intent.push({
        action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
        data: [{ $: { 'android:scheme': scheme } }],
      });
    }
    return cfg;
  });
}

module.exports = withFuelQueries;
