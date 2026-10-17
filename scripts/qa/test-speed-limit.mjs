/**
 * La limite affichée suit le tag OSM. Une rue sans tag ne devient pas 50.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const speed = require('../../web/speed-core.js');

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('ECHEC', msg);
  } else {
    console.log('ok', msg);
  }
}

function way(tags, geometry) {
  return { type: 'way', tags, geometry };
}

const line = (lat, lon) => [
  { lat: lat - 0.0002, lon: lon - 0.0002 },
  { lat, lon },
  { lat: lat + 0.0002, lon: lon + 0.0002 },
];

const zone30 = way(
  { highway: 'residential', 'source:maxspeed': 'FR:urban', 'zone:maxspeed': 'FR:30', name: 'Rue zone' },
  line(48.85, 2.35),
);
const hitZone = speed.resolveSpeed(48.85, 2.35, [zone30]);
assert(hitZone && hitZone.known && hitZone.kmh === 30 && hitZone.zone, `zone:maxspeed=FR:30 → ${hitZone && hitZone.kmh}`);

const bare = way({ highway: 'residential', name: 'Sans tag' }, line(48.85, 2.35));
const hitBare = speed.resolveSpeed(48.85, 2.35, [bare]);
assert(hitBare && hitBare.known === false && hitBare.kmh == null, 'rue sans tag : pas de 50 inventé');

const onlySource = way({ highway: 'residential', 'source:maxspeed': 'FR:urban' }, line(48.85, 2.35));
const hitSrc = speed.resolveSpeed(48.85, 2.35, [onlySource]);
assert(hitSrc && hitSrc.known === false, 'source:maxspeed=FR:urban n’est pas une limite');

const onlyType = way({ highway: 'residential', 'maxspeed:type': 'FR:urban' }, line(48.85, 2.35));
const hitType = speed.resolveSpeed(48.85, 2.35, [onlyType]);
assert(hitType && hitType.known === false, 'maxspeed:type=FR:urban n’invente pas 50');

const ms30 = way({ highway: 'residential', maxspeed: '30' }, line(48.85, 2.35));
assert(speed.resolveSpeed(48.85, 2.35, [ms30]).kmh === 30, 'maxspeed=30');

const ms50 = way({ highway: 'primary', maxspeed: '50', name: 'Avenue' }, line(48.86, 2.36));
assert(speed.resolveSpeed(48.86, 2.36, [ms50]).kmh === 50 && speed.resolveSpeed(48.86, 2.36, [ms50]).zone === false, 'maxspeed=50');

const ms80 = way({ highway: 'secondary', maxspeed: '80' }, line(45.7, 4.8));
assert(speed.resolveSpeed(45.7, 4.8, [ms80]).kmh === 80, 'maxspeed=80');

const ms90 = way({ highway: 'primary', maxspeed: '90' }, line(45.71, 4.81));
assert(speed.resolveSpeed(45.71, 4.81, [ms90]).kmh === 90, 'maxspeed=90');

const live = way({ highway: 'living_street' }, line(48.85, 2.35));
const hitLive = speed.resolveSpeed(48.85, 2.35, [live]);
assert(hitLive && hitLive.kmh === 20 && hitLive.zone, 'living_street → 20');

const typed = way({ highway: 'residential', 'maxspeed:type': 'FR:zone30' }, line(48.85, 2.35));
assert(speed.resolveSpeed(48.85, 2.35, [typed]).kmh === 30, 'maxspeed:type=FR:zone30');

const urbanExplicit = way({ highway: 'residential', maxspeed: 'FR:urban' }, line(48.85, 2.35));
assert(speed.resolveSpeed(48.85, 2.35, [urbanExplicit]).kmh === 50, 'maxspeed=FR:urban reste 50, le tag le dit');

const fiftyNearZone = [
  way({ highway: 'primary', maxspeed: '50' }, line(48.85, 2.35)),
  way({ highway: 'residential', 'zone:maxspeed': 'FR:30' }, line(48.851, 2.351)),
];
const onFifty = speed.resolveSpeed(48.85, 2.35, fiftyNearZone);
assert(onFifty && onFifty.kmh === 50, `sur la voie à 50, pas la zone voisine → ${onFifty && onFifty.kmh}`);

const square = [
  { lat: 48.849, lon: 2.349 },
  { lat: 48.849, lon: 2.351 },
  { lat: 48.851, lon: 2.351 },
  { lat: 48.851, lon: 2.349 },
  { lat: 48.849, lon: 2.349 },
];
const area = [
  way({ highway: 'residential' }, line(48.85, 2.35)),
  { type: 'way', tags: { 'zone:maxspeed': 'FR:30' }, geometry: square },
];
const inZone = speed.resolveSpeed(48.85, 2.35, area);
assert(inZone && inZone.known && inZone.kmh === 30 && inZone.zone, `rue sans tag dans un polygone zone 30 → ${inZone && inZone.kmh}`);

assert(speed.resolveSpeed(0, 0, []) == null, 'aucune voie : pas de limite inventée');

const areas = speed.zonesFromArea([
  { tags: { 'zone:maxspeed': 'FR:30' } },
  { tags: { enforcement: 'maxspeed', maxspeed: '30', type: 'enforcement' } },
]);
assert(areas.length === 2 && areas[0].kmh === 30, 'relation zone / enforcement');

async function overpass(q) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'HuberaMaps/0.1.107 (https://maps.hubera.cloud)',
      Accept: 'application/json',
    },
    body: 'data=' + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const samples = [
  ['maxspeed=30', '[out:json][timeout:20];way(53613250);out tags geom;'],
  ['maxspeed=50', '[out:json][timeout:25];way["maxspeed"="50"]["highway"~"primary|secondary|tertiary"](48.84,2.34,48.87,2.38);out tags geom 1;'],
  ['maxspeed=90', '[out:json][timeout:25];way["maxspeed"="90"]["highway"~"primary|secondary|tertiary"](45.7,4.7,45.9,5.0);out tags geom 1;'],
  ['maxspeed=80', '[out:json][timeout:25];way["maxspeed"="80"]["highway"~"primary|secondary|tertiary"](45.7,4.7,45.9,5.0);out tags geom 1;'],
];

for (const [label, q] of samples) {
  try {
    const data = await overpass(q);
    const el = (data.elements || [])[0];
    if (!el || !el.geometry || !el.geometry.length) {
      assert(false, `${label} : Overpass vide`);
      continue;
    }
    const mid = el.geometry[Math.floor(el.geometry.length / 2)];
    const hit = speed.resolveSpeed(mid.lat, mid.lon, data.elements);
    const tag = el.tags.maxspeed || el.tags['zone:maxspeed'] || '';
    const want = speed.parseSpeedToken(tag);
    console.log(`live ${label}`, el.tags.name || el.id, 'tag', tag, 'lu', hit && hit.kmh, 'known', hit && hit.known);
    assert(hit && hit.known && hit.kmh === want, `${label} lu ${hit && hit.kmh} attendu ${want}`);
  } catch (err) {
    assert(false, `${label} ${err.message || err}`);
  }
}

if (failed) {
  console.error(failed, 'échec(s)');
  process.exit(1);
}
console.log('limites ok');
