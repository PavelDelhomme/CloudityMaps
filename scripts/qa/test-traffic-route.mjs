/**
 * Durée avec / sans trafic Bison Futé, et alternative non imposée.
 * Appelle OSRM + le flux TIPI réel, puis un bouchon fictif pour le seuil.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const traffic = require('../../web/traffic-core.js');

const UA = 'HuberaMaps/0.1.104 (https://maps.hubera.cloud)';
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('ECHEC', msg);
  } else {
    console.log('ok', msg);
  }
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

async function osrm(from, to) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}` +
    '?overview=full&geometries=geojson&alternatives=true&steps=false';
  const data = JSON.parse(await getText(url));
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('OSRM vide');
  return data.routes.map((r) => ({
    id: `${(r.distance / 1000).toFixed(1)}:${Math.round(r.duration / 60)}:osrm`,
    kind: 'fastest',
    label: 'Plus rapide',
    km: Math.round((r.distance / 1000) * 10) / 10,
    min: Math.round(r.duration / 60),
    geometry: r.geometry,
  }));
}

const paris = traffic.lambert93ToWgs84(652381, 6862036);
assert(paris && Math.abs(paris.lat - 48.8566) < 0.01 && Math.abs(paris.lon - 2.351) < 0.01, 'Lambert93 Paris');

const csv = await getText('https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/refDir.csv');
const xml = await getText('https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/qtvDir.xml');
const stations = traffic.buildTrafficStations(csv, xml);
assert(stations.length > 10, `flux Bison Futé parsé (${stations.length} stations lentes)`);

const untouched = traffic.annotateRoutes(
  [{ id: 'keep', kind: 'fastest', label: 'Plus rapide', km: 5, min: 12, geometry: { coordinates: [[2.3, 48.8], [2.4, 48.9]] } }],
  [],
);
assert(untouched[0].min === 12 && untouched[0].trafficDelayMin == null, 'sans stations, durée inchangée');

const pairs = [
  ['Marseille', { lat: 43.2, lon: 5.37 }, { lat: 43.45, lon: 5.4 }],
  ['Toulouse', { lat: 43.6, lon: 1.35 }, { lat: 43.65, lon: 1.45 }],
  ['Rouen', { lat: 49.42, lon: 1.02 }, { lat: 49.5, lon: 1.1 }],
];

let best = null;
for (const [name, a, b] of pairs) {
  const routes = await osrm(a, b);
  const tagged = traffic.annotateRoutes(routes, stations);
  for (const r of tagged) {
    const row = { name, free: r.freeMin, withTraffic: r.min, delay: r.trafficDelayMin || 0, km: r.km };
    console.log(`live ${name}: ${row.free} min sans trafic, ${row.withTraffic} min avec, +${row.delay} min, ${row.km} km`);
    assert(row.withTraffic >= row.free, `${name} durée trafic >= durée libre`);
    if (!best || row.delay > best.delay) best = row;
  }
  const selected = routes[0].id;
  const offered = traffic.offerAvoidJam(tagged, null, stations);
  assert(offered[0].id === selected, `${name} le trajet proposé reste le premier`);
  assert(!offered.some((r) => r.kind === 'traffic' && (tagged[0].trafficDelayMin || 0) < traffic.HEAVY_DELAY_MIN), `${name} pas d’alternative si le bouchon est léger`);
}

console.log('pire écart live', best);

const jammed = [
  {
    id: 'JAM',
    axe: 'A50',
    speed: 12,
    free: 110,
    lenM: 9000,
    delayMin: 30,
    lat: 43.3,
    lon: 5.4,
    lat2: 43.305,
    lon2: 5.405,
  },
];
const baseRoute = {
  id: '16.0:25:fastest',
  kind: 'fastest',
  label: 'Plus rapide',
  km: 16,
  min: 25,
  geometry: {
    type: 'LineString',
    coordinates: [
      [5.4, 43.3],
      [5.402, 43.302],
      [5.405, 43.305],
    ],
  },
};
const taggedJam = traffic.annotateRoutes([baseRoute], jammed);
assert(taggedJam[0].id === '16.0:25:fastest', 'l’identifiant du trajet ne change pas');
assert(taggedJam[0].freeMin === 25 && taggedJam[0].min > 25, `bouchon fictif: ${taggedJam[0].freeMin} min -> ${taggedJam[0].min} min`);
assert(traffic.isHeavy(taggedJam[0]), 'bouchon au-dessus du seuil');

const detour = {
  km: 19,
  min: 28,
  geometry: { type: 'LineString', coordinates: [[5.3, 43.2], [5.5, 43.4]] },
};
const selectedId = taggedJam[0].id;
const withAlt = traffic.offerAvoidJam(taggedJam, detour, jammed);
const chosen = withAlt.find((r) => r.id === selectedId);
const alt = withAlt.find((r) => r.kind === 'traffic');
assert(withAlt[0].id === selectedId, 'le trajet d’origine reste en tête');
assert(!!chosen && chosen.kind !== 'traffic', 'le trajet choisi n’est pas remplacé');
assert(!!alt && alt.id !== selectedId && alt.label === 'Évite le bouchon', 'alternative proposée à part');
assert(alt.min + traffic.ALT_GAIN_MIN <= chosen.min, 'l’alternative est plus courte avec le trafic');

const slower = { km: 40, min: 80, geometry: { coordinates: [[4.9, 43.0], [5.0, 43.05]] } };
const noForce = traffic.offerAvoidJam(taggedJam, slower, jammed);
assert(!noForce.some((r) => r.kind === 'traffic'), 'détour plus long : pas proposé');
assert(noForce[0].id === selectedId, 'sans alternative, le trajet reste celui d’OSRM');

console.log(
  JSON.stringify(
    {
      source: 'bison-fute-tipi',
      liveBest: best,
      fixture: {
        freeMin: chosen.freeMin,
        withMin: chosen.min,
        delayMin: chosen.trafficDelayMin,
        selectedId,
        alternativeId: alt.id,
        alternativeMin: alt.min,
        imposed: withAlt[0].id === alt.id,
      },
    },
    null,
    2,
  ),
);

if (failed) {
  console.error(`${failed} échec(s)`);
  process.exit(1);
}
console.log('tous les contrôles sont passés');
