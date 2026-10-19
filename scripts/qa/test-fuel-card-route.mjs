/**
 * Repli de la carte Fuel pendant le guidage, et surbrillance de l’itinéraire choisi.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const hud = require(join(root, 'web/hud-core.js'));

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('ECHEC', msg);
  } else {
    console.log('ok', msg);
  }
}

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) return '';
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return '';
}

const driving = {
  fuelCardCollapsed: false,
  navigating: true,
  mapsStartedFuel: true,
  fuelTrip: 42,
};

const folded = hud.foldFuelCard(driving);
assert(folded.fuelCardCollapsed === true, 'la carte Fuel se replie');
assert(folded.navigating === true, 'navigating reste true');
assert(folded.mapsStartedFuel === true, 'Fuel reste démarré');
assert(folded.fuelStopped === false, 'le repli ne stoppe pas Fuel');
assert(folded.fuelTrip === driving.fuelTrip, 'le trajet Fuel est conservé');

const painted = {
  navigating: folded.navigating,
  mapsStartedFuel: folded.mapsStartedFuel,
  fuelStopped: folded.fuelStopped,
  tripInfoOpen: folded.navigating ? !folded.fuelCardCollapsed : true,
};
assert(painted.navigating === true && painted.tripInfoOpen === false, 'un repaint pendant le guidage laisse la carte repliée');
assert(painted.mapsStartedFuel === true && painted.fuelStopped === false, 'un repaint ne stoppe pas Fuel');

const opened = hud.foldFuelCard(folded);
assert(opened.fuelCardCollapsed === false, 'la carte Fuel se déplie');
assert(opened.navigating === true && opened.mapsStartedFuel === true && opened.fuelStopped === false, 'le dépli laisse le guidage et Fuel');

const selected = hud.routeLineStyle(true);
const alt = hud.routeLineStyle(false);
assert(alt.weight === 6 && alt.opacity === 1, 'les autres tracés reprennent l’intensité qu’avait le tracé choisi');
assert(selected.weight > alt.weight, 'le tracé choisi est plus épais');
assert(selected.opacity >= alt.opacity, 'le tracé choisi n’est pas plus transparent');
assert(selected.weight * selected.opacity >= alt.weight * alt.opacity * 1.5, 'l’écart d’intensité est net');

const jamOn = hud.routeJamStyle(true);
const jamOff = hud.routeJamStyle(false);
assert(jamOff.weight === 9 && jamOff.opacity === 0.95, 'le bouchon des alternatives reprend l’ancienne intensité');
assert(jamOn.weight > jamOff.weight && jamOn.opacity >= jamOff.opacity, 'le bouchon du tracé choisi est plus fort');

const webJs = readFileSync(join(root, 'web/app.js'), 'utf8');
const apkJs = readFileSync(join(root, 'apk/app/src/main/assets/app.js'), 'utf8');
const webHtml = readFileSync(join(root, 'web/index.html'), 'utf8');
const apkHtml = readFileSync(join(root, 'apk/app/src/main/assets/index.html'), 'utf8');
const webHud = readFileSync(join(root, 'web/hud-core.js'), 'utf8');
const apkHud = readFileSync(join(root, 'apk/app/src/main/assets/hud-core.js'), 'utf8');

assert(webJs === apkJs, 'apk/app.js est la même copie servie que web/app.js');
assert(webHtml === apkHtml && webHud === apkHud, 'html et hud-core restent la même copie');
assert(webJs.includes('HuberaHud.routeLineStyle') && webJs.includes('HuberaHud.routeJamStyle'), 'le dessin utilise ces intensités');
assert(webJs.includes('if (navigating) tripInfoOpen = !fuelCardCollapsed'), 'le repaint ne rouvre pas la carte pendant le guidage');
assert(webHtml.includes('src="hud-core.js"'), 'la page charge hud-core');

const foldFn = extractFn(webJs, 'toggleFuelCard');
assert(foldFn.includes('HuberaHud.foldFuelCard'), 'le geste de repli passe par foldFuelCard');
assert(!/navigating\s*=\s*false/.test(foldFn), 'toggleFuelCard ne met pas navigating à false');
assert(!foldFn.includes('collapseNavHud'), 'le repli n’appelle pas collapseNavHud');
assert(!foldFn.includes('fuelStopTracking') && !foldFn.includes('stopNavigation'), 'le repli n’arrête pas Fuel ni le guidage');
assert(webJs.includes("getElementById('btnStopNav')") && /btnStopNav'\)\.addEventListener\('click', \(\) => \{\s*collapseNavHud\(\)/.test(webJs), 'la croix du guidage reste l’arrêt, pas le repli');

if (failed) {
  console.error(`ECHEC ${failed}`);
  process.exit(1);
}
console.log('OK carte Fuel repliable + tracé choisi plus fort');
