/* Hubera Maps — OSM + Photon + OSRM. Chrome type Google Maps + Fuel + Music. */
const LAST_ME_KEY = 'hubera-maps-last-me';
function readLastMe() {
  try {
    const p = JSON.parse(localStorage.getItem(LAST_ME_KEY) || 'null');
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
    if (Date.now() - (p.at || 0) > 36e5 * 18) return null;
    return p;
  } catch {
    return null;
  }
}
const bootMe = readLastMe();
const map = L.map('map', {
  zoomControl: false,
  preferCanvas: true,
  fadeAnimation: false,
  markerZoomAnimation: false,
  zoomAnimation: true,
  zoomAnimationThreshold: 4,
}).setView(bootMe ? [bootMe.lat, bootMe.lon] : [46.6, 2.4], bootMe ? 16 : 6);
map.createPane('mePane');
map.getPane('mePane').style.zIndex = 650;
map.whenReady(() => {
  map.invalidateSize();
  setTimeout(() => map.invalidateSize(), 350);
});
map.on('dragstart', () => {
  if (navigating) setFollowNav(false);
});
let baseTiles = null;
let nightOn = null;
function wantNight() {
  const h = new Date().getHours();
  return h >= 21 || h < 6;
}
function applyTiles() {
  const night = wantNight();
  if (baseTiles && nightOn === night) {
    document.body.classList.toggle('night', night);
    return;
  }
  nightOn = night;
  if (baseTiles) map.removeLayer(baseTiles);
  // OSM public, sans clé. CARTO Dark exige désormais une API key : on n’en veut pas.
  // Nuit = mêmes tuiles OSM + filtre CSS (body.night).
  baseTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    subdomains: 'abc',
    updateWhenIdle: true,
    updateWhenZooming: false,
    keepBuffer: 1,
    detectRetina: false,
    attribution: '&copy; OpenStreetMap',
  }).addTo(map);
  document.body.classList.toggle('night', night);
}
applyTiles();
window.setInterval(applyTiles, 10 * 60 * 1000);

const hitsEl = document.getElementById('hits');
const qEl = document.getElementById('q');
const sheetEl = document.getElementById('sheet');
const fuelEl = document.getElementById('fuel');
const fuelTitle = document.getElementById('fuelTitle');
const chipsEl = document.getElementById('chips');
const drawer = document.getElementById('drawer');
const scrim = document.getElementById('scrim');
const panelFuel = document.getElementById('panelFuel');
const pageSaved = document.getElementById('pageSaved');
const savedList = document.getElementById('savedList');
const altsEl = document.getElementById('alts');
const navBar = document.getElementById('navBar');
const searchForm = document.getElementById('searchForm');
const roadNameEl = document.getElementById('roadName');
const roadSignEl = document.getElementById('roadSign');
const btnClear = document.getElementById('btnClear');
const topChrome = document.getElementById('topChrome');
const musicPeek = document.getElementById('musicPeek');
const btnHere = document.getElementById('btnHere');

let me = null;
let meMarker = null;
let meHalo = null;
let destMarker = null;
let routeLayer = null;
let traceLayer = null;
let trace = [];
let fuelTrip = null;
let paused = false;
let searchTimer = 0;
let pendingAssign = null;
let lastDest = null;
let activeTab = 'maps';
let altLayers = [];
let routeChoices = [];
let selectedRouteId = null;
let navigating = false;
let navWatch = null;
let lastRoadAt = 0;
let lastSpeedKmh = 0;
let lastNavAt = 0;
let lastHeadingDeg = 0;
let lastSpoken = '';
let lastSpokenAt = 0;
let followNav = true;
let poiLayer = null;

const PLACE_KEY = 'hubera-maps-places';
const MUSIC_KEY = 'hubera-maps-music-dock';
const MODE_KEY = 'hubera-maps-mode';
const FETCH_HDR = { Accept: 'application/json' };
const TRAVEL_MODES = [
  ['car', 'Voiture'],
  ['walk', 'À pied'],
  ['bike', 'Vélo'],
  ['transit', 'Transports'],
];
let travelMode = localStorage.getItem(MODE_KEY) || 'car';
let routeGen = 0;
let routeAbort = null;
const routeCache = new Map();
const HUBERA_OWNER = { email: 'paul@delhomme.ovh', name: 'Paul' };
let appVisible = !document.hidden;
let idleGeoTimer = 0;
let musicPollTimer = 0;
let lastFixAt = 0;
let lastRoadPos = null;
let navWatchFn = null;

function fuelUrl(path) {
  const p = String(path || '').replace(/^\//, '');
  return `gasoiltracking://${p}`;
}

function fuelTripQuery() {
  const n = Number(fuelTrip);
  return Number.isFinite(n) && n > 0 ? `tripId=${n}` : '';
}

function fuelControl(action, extra) {
  extra = extra || {};
  const n = Number(fuelTrip);
  const tripId = Number.isFinite(n) && n > 0 ? String(n) : '';
  const payload = JSON.stringify({
    action,
    tripId,
    dest: extra.dest || '',
    liters: extra.liters || '',
    total: extra.total || '',
    station: extra.station || '',
  });
  try {
    if (window.HuberaFuel && typeof window.HuberaFuel.control === 'function') {
      window.HuberaFuel.control(action, payload);
      return true;
    }
  } catch {
    /* WebView hors APK */
  }
  toast('Commande Fuel enregistrée dans Maps.');
  return false;
}

function loadPlaces() {
  try {
    const raw = JSON.parse(localStorage.getItem(PLACE_KEY) || '{}');
    return {
      home: raw.home || null,
      work: raw.work || null,
      recents: Array.isArray(raw.recents) ? raw.recents.slice(0, 6) : [],
      saved: Array.isArray(raw.saved) ? raw.saved : [],
    };
  } catch {
    return { home: null, work: null, recents: [], saved: [] };
  }
}

function savePlaces(p) {
  localStorage.setItem(PLACE_KEY, JSON.stringify(p));
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function toast(msg) {
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<strong>${esc(msg)}</strong>`;
  window.clearTimeout(toast._t);
  toast._t = window.setTimeout(() => {
    if (!sheetEl.querySelector('.go')) sheetEl.hidden = true;
  }, 2600);
}

function musicDockOn() {
  return localStorage.getItem(MUSIC_KEY) !== '0';
}

function setMusicDock(on) {
  localStorage.setItem(MUSIC_KEY, on ? '1' : '0');
  document.body.classList.toggle('music-off', !on);
  musicPeek.hidden = on;
  syncChromeHeight();
}

function syncChromeHeight() {
  const el = document.getElementById('chrome');
  if (!el) return;
  const h = Math.ceil(el.getBoundingClientRect().height);
  if (h > 40) document.body.style.setProperty('--chrome', `${h + 12}px`);
}

function syncClear() {
  btnClear.hidden = !qEl.value;
}

function clearPoi() {
  if (poiLayer) {
    map.removeLayer(poiLayer);
    poiLayer = null;
  }
}

function clearRoute() {
  for (const layer of altLayers) map.removeLayer(layer);
  altLayers = [];
  routeLayer = null;
  if (destMarker) map.removeLayer(destMarker);
  destMarker = null;
  clearPoi();
}

function setFollowNav(on) {
  followNav = !!on;
  document.body.classList.toggle('freehand', navigating && !followNav);
}

function updateSpeed(coords, next) {
  let mps = Number(coords && coords.speed);
  if (!Number.isFinite(mps) || mps < 0) {
    if (me && lastNavAt) {
      const dt = (Date.now() - lastNavAt) / 1000;
      if (dt > 0.35) mps = metersBetween(me, next) / dt;
    } else {
      mps = 0;
    }
  }
  lastNavAt = Date.now();
  if (Number.isFinite(mps) && mps >= 0) {
    const kmh = Math.round(mps * 3.6);
    if (kmh >= 0 && kmh < 220) lastSpeedKmh = kmh;
  }
  const hd = Number(coords && coords.heading);
  if (Number.isFinite(hd) && hd >= 0) lastHeadingDeg = hd;
  else if (me && next && metersBetween(me, next) > 6) {
    lastHeadingDeg = bearingDeg(me, next);
  }
}

function applyNavFix(pos) {
  const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  updateSpeed(pos.coords, next);
  setMe(next.lat, next.lon, false);
  if (followNav && navigating) {
    try {
      map.panTo([next.lat, next.lon], { animate: true, duration: 0.32 });
    } catch {
      /* carte pas prête */
    }
  }
  appendTrace(next.lat, next.lon);
  paintHud(currentChoice());
}

function metersBetween(a, b) {
  if (!a || !b) return 1e9;
  return haversineKm(a, b) * 1000;
}

function geoOpts({ accurate, freshMs, timeout }) {
  return {
    enableHighAccuracy: !!accurate,
    timeout: timeout || 8000,
    maximumAge: freshMs == null ? 15000 : freshMs,
  };
}

function loadId() {
  return HUBERA_OWNER;
}

function paintId() {
  const id = HUBERA_OWNER;
  const mail = document.getElementById('drawerMail');
  const who = document.querySelector('.drawer .who');
  const avatars = [document.getElementById('btnUser'), document.getElementById('drawerAvatar')];
  if (who) who.textContent = id.name;
  if (mail) mail.textContent = id.email;
  avatars.forEach((a) => {
    if (a) a.textContent = 'P';
  });
}

function applyHuberaIdFromParams() {
  return true;
}

window.__mapsApplyAuth = function () {};

function persistMe(lat, lon) {
  lastFixAt = Date.now();
  try {
    localStorage.setItem(LAST_ME_KEY, JSON.stringify({ lat, lon, at: lastFixAt }));
  } catch {
    /* quota */
  }
}

function restoreMe() {
  const p = readLastMe();
  if (!p) return false;
  lastFixAt = p.at || 0;
  setMe(p.lat, p.lon, false, true);
  return true;
}

function bearingDeg(a, b) {
  if (!a || !b) return 0;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLon);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function remainAlongKm(here, geometry) {
  const coords = geometry?.coordinates;
  if (!here || !Array.isArray(coords) || coords.length < 2) return null;
  const pts = coords.map((c) => ({ lon: c[0], lat: c[1] }));
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = haversineKm(here, pts[i]);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  let sum = 0;
  for (let i = nearest; i < pts.length - 1; i++) sum += haversineKm(pts[i], pts[i + 1]);
  return Math.max(0.04, sum);
}

function speakNav(text, distKm) {
  if (!navigating || !text || !('speechSynthesis' in window)) return;
  if (distKm > 0.16) return;
  const now = Date.now();
  if (text === lastSpoken && now - lastSpokenAt < 22000) return;
  lastSpoken = text;
  lastSpokenAt = now;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.rate = 1.04;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* WebView sans TTS */
  }
}

function puckIcon(deg) {
  const d = Number.isFinite(deg) ? deg : 0;
  return L.divIcon({
    className: 'me-puck',
    html:
      `<div class="puck-inner" style="transform:rotate(${d}deg)">` +
      `<div class="puck-n"></div><div class="puck-c"></div></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function setMe(lat, lon, fly, fromCache) {
  const next = { lat, lon };
  const moved = metersBetween(me, next);
  me = next;
  if (!fromCache) persistMe(lat, lon);
  const here = L.latLng(lat, lon);
  if (meHalo) meHalo.setLatLng(here);
  else {
    meHalo = L.circleMarker(here, {
      radius: 22, color: '#e94560', weight: 2, fillColor: '#e94560', fillOpacity: 0.16,
      pane: 'mePane', interactive: false,
    }).addTo(map);
  }
  if (!meMarker) {
    meMarker = L.marker(here, { icon: puckIcon(lastHeadingDeg), pane: 'mePane', keyboard: false }).addTo(map);
  } else {
    meMarker.setLatLng(here);
    meMarker.setIcon(puckIcon(lastHeadingDeg));
  }
  if (meMarker && moved < 3 && !fly) {
    if (!lastRoadPos || (roadNameEl && roadNameEl.textContent === '—')) void refreshRoad(lat, lon);
    return;
  }
  if (fly) {
    map.invalidateSize();
    const z = Math.max(16, map.getZoom() || 0);
    map.flyTo(here, z, { duration: 0.35 });
  }
  if (moved >= 40 || !lastRoadPos) void refreshRoad(lat, lon);
}

function goHere() {
  if (me) setMe(me.lat, me.lon, true);
  if (!navigator.geolocation) {
    if (!me) toast('GPS indisponible.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setMe(pos.coords.latitude, pos.coords.longitude, true),
    () => {
      if (!me) toast('Position indisponible — autorisez la localisation.');
    },
    geoOpts({ accurate: true, freshMs: 2500, timeout: 8000 }),
  );
}

function appendTrace(lat, lon) {
  if (paused) return;
  if (!navigating && !fuelTrip) return;
  const last = trace[trace.length - 1];
  if (last && Math.abs(last[0] - lat) < 1e-6 && Math.abs(last[1] - lon) < 1e-6) return;
  trace.push([lat, lon]);
  if (traceLayer) map.removeLayer(traceLayer);
  if (trace.length >= 2) {
    traceLayer = L.polyline(trace, { color: '#188038', weight: 4 }).addTo(map);
  }
}

function rememberRecent(place) {
  const p = loadPlaces();
  p.recents = [place, ...p.recents.filter((r) => r.label !== place.label)].slice(0, 6);
  savePlaces(p);
  renderChips();
}

async function searchPhoton(q) {
  const bias = me ? `&lat=${me.lat}&lon=${me.lon}` : '';
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=8${bias}`;
  const res = await fetch(url);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const [lon, lat] = f.geometry.coordinates;
    const props = f.properties || {};
    const label = [props.name, props.street, props.city || props.state, props.country]
      .filter(Boolean)
      .join(', ');
    const item = { label: label || q, lat, lon };
    if (seen.has(item.label)) continue;
    seen.add(item.label);
    out.push(item);
  }
  return out;
}

function ordinalFr(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 1) return '';
  return x === 1 ? '1re' : `${Math.round(x)}e`;
}

function maneuverIcon(type, modifier) {
  const t = (type || '').toLowerCase();
  const m = (modifier || '').toLowerCase();
  if (t === 'arrive') return '🏁';
  if (t.includes('roundabout') || t.includes('rotary')) return '⟳';
  if (m.includes('uturn')) return '↩';
  if (t === 'on ramp' || t === 'merge') return '↗';
  if (t === 'off ramp') return '↘';
  if (m.includes('left')) return '↰';
  if (m.includes('right')) return '↱';
  if (m.includes('straight') || t === 'continue' || t === 'new name' || t === 'depart') return '⬆';
  return '⬆';
}

function fmtDist(km) {
  if (!Number.isFinite(km) || km < 0) return '—';
  if (km < 0.035) return 'Maintenant';
  if (km < 1) {
    const m = Math.round(km * 1000);
    const rounded = m < 80 ? Math.round(m / 10) * 10 : Math.round(m / 50) * 50;
    return `${Math.max(10, rounded)} m`;
  }
  return `${km.toFixed(1)} km`;
}

function fmtDistM(meters) {
  return fmtDist((meters || 0) / 1000);
}

function fmtStep(step) {
  if (!step) return 'Continuez tout droit';
  const t = (step.maneuver?.type || '').toLowerCase();
  const mod = (step.maneuver?.modifier || '').toLowerCase();
  const name = (step.name || '').trim();
  const exit = step.maneuver?.exit;
  const road = name ? ` · ${name}` : '';
  const until = name ? ` jusqu’à ${name}` : '';
  if (t === 'depart') return name ? `Départ sur ${name}` : 'Départ';
  if (t === 'arrive') return name ? `Arrivée · ${name}` : 'Vous êtes arrivé';
  if (t === 'roundabout' || t === 'rotary' || t === 'exit roundabout' || t === 'exit rotary') {
    const ord = ordinalFr(exit);
    return ord
      ? `Au rond-point, prenez la ${ord} sortie${road}`
      : `Au rond-point${road}`;
  }
  if (t === 'turn' && mod.includes('uturn')) return `Faites demi-tour${road}`;
  if (t === 'turn' && mod.includes('left')) return `Tournez à gauche${road}`;
  if (t === 'turn' && mod.includes('right')) return `Tournez à droite${road}`;
  if (t === 'turn' && mod.includes('straight')) return `Continuez tout droit${until}`;
  if (t === 'end of road' && mod.includes('left')) return `En bout de voie, à gauche${road}`;
  if (t === 'end of road' && mod.includes('right')) return `En bout de voie, à droite${road}`;
  if (t === 'fork' && mod.includes('left')) return `Bifurcation à gauche${road}`;
  if (t === 'fork' && mod.includes('right')) return `Bifurcation à droite${road}`;
  if (t === 'on ramp') return `Prenez la bretelle${road}`;
  if (t === 'off ramp') return `Prenez la sortie${road}`;
  if (t === 'merge') return `Fusionnez${road}`;
  if (t === 'continue' || t === 'new name') return `Continuez tout droit${until}`;
  if (name) return `Continuez tout droit jusqu’à ${name}`;
  return 'Continuez tout droit';
}

function destShort() {
  return (lastDest?.label || 'destination').split(',')[0];
}

function stepPoint(step) {
  const loc = step?.maneuver?.location;
  if (Array.isArray(loc) && loc.length >= 2) return { lon: loc[0], lat: loc[1] };
  return null;
}

function upcomingManeuver(here, steps) {
  const list = steps || [];
  if (!list.length) return { now: null, then: null, idx: -1 };
  let nearest = 0;
  let best = Infinity;
  if (here) {
    for (let i = 0; i < list.length; i++) {
      const p = stepPoint(list[i]);
      if (!p) continue;
      const d = haversineKm(here, p);
      if (d < best) {
        best = d;
        nearest = i;
      }
    }
  }
  let i = best < 0.035 ? nearest + 1 : nearest;
  while (i < list.length) {
    const t = (list[i].maneuver?.type || '').toLowerCase();
    if (t && t !== 'depart') break;
    i += 1;
  }
  if (i >= list.length) i = list.length - 1;
  return { now: list[i] || null, then: list[i + 1] || null, idx: i };
}

function haversineKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function midPoint(geometry) {
  const c = geometry?.coordinates || [];
  if (!c.length) return null;
  const p = c[Math.floor(c.length / 2)];
  return { lon: p[0], lat: p[1] };
}

function sameish(a, b) {
  const ma = midPoint(a.geometry);
  const mb = midPoint(b.geometry);
  if (ma && mb && haversineKm(ma, mb) < 0.45) return true;
  return Math.abs(a.km - b.km) < 0.3 && Math.abs(a.min - b.min) < 1;
}

function classifyRoutes(raw) {
  const unique = [];
  for (const r of [...raw].sort((a, b) => a.min - b.min)) {
    if (unique.some((u) => sameish(u, r))) continue;
    unique.push(r);
    if (unique.length >= 5) break;
  }
  if (!unique.length) return [];
  const names =
    travelMode === 'car'
      ? { eco: 'Économique', fast: 'Plus rapide', alt: 'Alternatif' }
      : travelMode === 'walk'
        ? { eco: 'Plus court', fast: 'Plus rapide', alt: 'Autre chemin' }
        : travelMode === 'bike'
          ? { eco: 'Plus court', fast: 'Plus rapide', alt: 'Autre piste' }
          : { eco: 'Direct', fast: 'Plus rapide', alt: 'Autre horaire' };
  const byTime = [...unique].sort((a, b) => a.min - b.min);
  const byDist = [...unique].sort((a, b) => a.km - b.km);
  const fastest = byTime[0];
  const eco = byDist[0];
  const out = [];
  const used = new Set();
  const add = (r, kind, label) => {
    const fp = `${r.km.toFixed(1)}:${r.min}:${kind}`;
    const geoFp = `${r.km.toFixed(1)}:${r.min}`;
    if (used.has(geoFp)) return;
    used.add(geoFp);
    out.push({ ...r, id: fp, kind, label: r.transitLabel || label });
  };
  if (eco) add(eco, 'eco', names.eco);
  if (fastest && (!eco || !sameish(fastest, eco))) add(fastest, 'fastest', names.fast);
  else if (fastest && out.length === 0) add(fastest, 'fastest', names.fast);
  let n = 0;
  for (const r of unique) {
    const geoFp = `${r.km.toFixed(1)}:${r.min}`;
    if (used.has(geoFp)) continue;
    n += 1;
    add(r, 'alternate', n === 1 ? names.alt : `Autre ${n}`);
    if (out.length >= 4) break;
  }
  const rank = { eco: 0, fastest: 1, alternate: 2 };
  return out.sort((a, b) => rank[a.kind] - rank[b.kind]);
}

function parseOsrm(data) {
  if (data.code !== 'Ok' || !data.routes?.length) return [];
  return data.routes
    .filter((r) => r.distance > 0)
    .map((r) => ({
      km: Math.round((r.distance / 1000) * 10) / 10,
      min: Math.round((r.duration || 0) / 60),
      geometry: r.geometry,
      steps: (r.legs || []).flatMap((leg) => leg.steps || []),
    }));
}

function osrmEndpoint() {
  if (travelMode === 'walk') return 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  if (travelMode === 'bike') return 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
  return 'https://router.project-osrm.org/route/v1/driving/';
}

async function osrmPath(points, alternatives, extra = '', signal) {
  const path = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const alt = alternatives <= 0 ? 'false' : String(Math.max(1, Math.min(3, alternatives)));
  const url =
    `${osrmEndpoint()}${path}` +
    `?overview=full&geometries=geojson&alternatives=${alt}&steps=true${extra}`;
  const res = await fetch(url, { headers: FETCH_HDR, signal });
  if (!res.ok) return [];
  return parseOsrm(await res.json());
}

async function settledRoutes(promises) {
  const chunks = await Promise.allSettled(promises);
  const out = [];
  for (const c of chunks) {
    if (c.status === 'fulfilled' && Array.isArray(c.value)) out.push(...c.value);
  }
  return out;
}

function decodePolyline(str, precision) {
  const factor = 10 ** (precision || 5);
  let index = 0;
  let lat = 0;
  let lon = 0;
  const coords = [];
  while (index < str.length) {
    let b;
    let shift = 0;
    let result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;
    shift = 0;
    result = 0;
    do {
      b = str.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;
    coords.push([lon / factor, lat / factor]);
  }
  return coords;
}

async function motisPlan(from, to, signal) {
  const url =
    `https://api.transitous.org/api/v2/plan?fromPlace=${from.lat},${from.lon}` +
    `&toPlace=${to.lat},${to.lon}&numItineraries=4&transitModes=TRANSIT&directModes=WALK`;
  const res = await fetch(url, { headers: FETCH_HDR, signal });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.itineraries || []).map((it) => {
    const coords = [];
    for (const leg of it.legs || []) {
      const g = leg.legGeometry || {};
      for (const p of decodePolyline(g.points || '', g.precision || 6)) coords.push(p);
    }
    const dist = (it.legs || []).reduce((s, l) => s + (Number(l.distance) || 0), 0);
    const modes = [
      ...new Set((it.legs || []).map((l) => l.mode).filter((m) => m && m !== 'WALK')),
    ];
    const corr = it.transfers || 0;
    return {
      km: Math.round((dist / 1000) * 10) / 10,
      min: Math.round((it.duration || 0) / 60),
      geometry: { type: 'LineString', coordinates: coords },
      steps: (it.legs || []).map((l) => ({
        name: (l.to && l.to.name) || l.mode || '',
        maneuver: { type: l.mode === 'WALK' ? 'continue' : 'on ramp' },
      })),
      transitLabel: `${modes.join(' · ') || 'Marche'} · ${corr} corr.`,
    };
  });
}

function corridorVias(from, to) {
  const bird = haversineKm(from, to);
  if (bird < 6) return [];
  const dLat = to.lat - from.lat;
  const dLon = to.lon - from.lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  const pLat = -dLon / len;
  const pLon = dLat / len;
  const offsetDeg = Math.min(0.11, Math.max(0.022, bird * 0.0018));
  return [-1, 1].map((sign) => ({
    lat: from.lat + 0.45 * dLat + sign * pLat * offsetDeg,
    lon: from.lon + 0.45 * dLon + sign * pLon * offsetDeg,
  }));
}

function routeCacheKey(from, to) {
  const r = (n) => Number(n).toFixed(4);
  return `${travelMode}|${r(from.lat)},${r(from.lon)}|${r(to.lat)},${r(to.lon)}`;
}

async function collectRoutes(from, to, signal) {
  const key = routeCacheKey(from, to);
  const hit = routeCache.get(key);
  if (hit && Date.now() - hit.at < 120000) return hit.routes;

  if (travelMode === 'transit') {
    try {
      const routes = classifyRoutes(await motisPlan(from, to, signal));
      routeCache.set(key, { at: Date.now(), routes });
      return routes;
    } catch {
      return [];
    }
  }

  const alts = travelMode === 'car' ? 3 : 2;
  let collected = await settledRoutes([osrmPath([from, to], alts, '', signal)]);
  if (travelMode === 'car' && classifyRoutes(collected).length < 3) {
    const vias = corridorVias(from, to);
    if (vias.length) {
      collected = collected.concat(
        await settledRoutes(vias.map((via) => osrmPath([from, via, to], 0, '', signal))),
      );
    }
  }
  const routes = classifyRoutes(collected);
  if (routes.length) routeCache.set(key, { at: Date.now(), routes });
  return routes;
}

function drawChoices(selectedId) {
  for (const layer of altLayers) map.removeLayer(layer);
  altLayers = [];
  routeLayer = null;
  let bounds = null;
  for (const r of routeChoices) {
    const on = r.id === selectedId;
    const layer = L.geoJSON(r.geometry, {
      style: {
        color: on ? '#e94560' : '#64748b',
        weight: on ? 6 : 4,
        opacity: on ? 1 : 0.5,
      },
    }).addTo(map);
    layer.on('click', () => selectRoute(r.id));
    altLayers.push(layer);
    if (on) routeLayer = layer;
    const b = layer.getBounds();
    bounds = bounds ? bounds.extend(b) : b;
  }
  if (bounds) map.fitBounds(bounds, { padding: [80, 56, 220, 56] });
}

function modeLabel() {
  return { car: 'Voiture', walk: 'À pied', bike: 'Vélo', transit: 'Transports' }[travelMode] || 'Voiture';
}

function isCarMode() {
  return travelMode === 'car';
}

function paintModes() {
  document.querySelectorAll('.mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === travelMode));
}

function modesRowHtml() {
  return (
    `<div class="modes">` +
    TRAVEL_MODES.map(
      ([id, lab]) =>
        `<button type="button" class="mode${travelMode === id ? ' on' : ''}" data-mode="${id}">${lab}</button>`,
    ).join('') +
    `</div>`
  );
}

function bindModeButtons(root) {
  if (!root) return;
  root.querySelectorAll('.mode').forEach((btn) => {
    btn.onclick = () => setTravelMode(btn.dataset.mode);
  });
}

function showAltsShell(label, extraHtml) {
  altsEl.hidden = false;
  altsEl.innerHTML = modesRowHtml() + `<h3>${esc(label)}</h3>` + (extraHtml || '');
  bindModeButtons(altsEl);
}

function setTravelMode(mode) {
  if (!mode || mode === travelMode) return;
  travelMode = mode;
  localStorage.setItem(MODE_KEY, mode);
  paintModes();
  if (navigating) return;
  if (lastDest && me) void routeTo(lastDest.lat, lastDest.lon, lastDest.label);
}

function renderAlts() {
  if (!routeChoices.length) {
    altsEl.hidden = true;
    altsEl.innerHTML = '';
    return;
  }
  const dest = lastDest?.label || 'Destination';
  showAltsShell(
    dest,
    `<div class="picks">` +
      routeChoices
        .map(
          (r) =>
            `<button type="button" class="alt${r.id === selectedRouteId ? ' on' : ''}" data-id="${r.id}">` +
            `<div class="k">${esc(r.label)}</div>` +
            `<div class="t">${r.min} min</div>` +
            `<div class="d">${r.km} km</div></button>`,
        )
        .join('') +
      `</div><button type="button" class="go" id="btnStartNav">Démarrer</button>`,
  );
  altsEl.querySelectorAll('.alt').forEach((btn) => {
    btn.onclick = () => selectRoute(btn.dataset.id);
  });
  const start = document.getElementById('btnStartNav');
  if (start) start.onclick = startNavigation;
}

function selectRoute(id) {
  selectedRouteId = id;
  drawChoices(id);
  renderAlts();
}

function currentChoice() {
  return routeChoices.find((r) => r.id === selectedRouteId) || routeChoices[0];
}

function paintHud(choice) {
  const short = destShort();
  const here = me;
  const found = upcomingManeuver(here, choice?.steps);
  const step = found.now;
  const then = found.then;
  const p = stepPoint(step);
  const toManeuver = here && p ? haversineKm(here, p) : (step?.distance || 0) / 1000;
  const along = remainAlongKm(here, choice?.geometry);
  const remainKm = choice
    ? along != null
      ? along
      : here && lastDest
        ? Math.max(0.1, haversineKm(here, lastDest))
        : choice.km
    : 0;
  const etaMin = choice
    ? Math.max(1, Math.round((choice.min * remainKm) / Math.max(choice.km, 0.1)))
    : 0;
  const titleEl = document.getElementById('hudTitle');
  const distEl = document.getElementById('hudDist');
  const iconEl = document.getElementById('hudIcon');
  const subEl = document.getElementById('hudSub');
  const thenEl = document.getElementById('hudThen');
  const metaEl = document.getElementById('hudMeta');
  if (distEl) distEl.textContent = step ? fmtDist(toManeuver) : '—';
  if (iconEl) iconEl.textContent = maneuverIcon(step?.maneuver?.type, step?.maneuver?.modifier);
  if (titleEl) titleEl.textContent = step ? fmtStep(step) : navigating ? 'Suivi libre' : 'Guidage';
  if (subEl) {
    const road = (step?.name || '').trim();
    subEl.textContent = road && !fmtStep(step).includes(road) ? road : '';
  }
  if (thenEl) {
    if (then && (then.maneuver?.type || '') !== 'arrive') {
      thenEl.hidden = false;
      thenEl.textContent = `Puis : ${fmtStep(then)}`;
    } else {
      thenEl.hidden = true;
      thenEl.textContent = '';
    }
  }
  if (metaEl) {
    const eta = choice ? `${etaMin} min · ${remainKm < 1 ? fmtDist(remainKm) : `${remainKm.toFixed(1)} km`}` : '';
    metaEl.textContent = eta ? `vers ${short} · ${eta}` : `vers ${short}`;
  }
  const speedEl = document.getElementById('hudSpeed');
  const speedVal = document.getElementById('hudSpeedVal');
  if (speedEl) speedEl.hidden = !navigating;
  if (speedVal) speedVal.textContent = String(lastSpeedKmh);
  if (step && navigating) speakNav(fmtStep(step), toManeuver);
  if (navigating && remainKm < 0.05) {
    speakNav('Vous êtes arrivé', 0);
  }
}

function showFuelBar(title) {
  fuelEl.hidden = false;
  if (title) fuelTitle.textContent = title;
  document.getElementById('btnPause').textContent = paused ? 'Reprendre' : 'Pause';
}

function enterNavUi() {
  navigating = true;
  document.body.classList.add('nav');
  searchForm.hidden = true;
  navBar.hidden = false;
  chipsEl.hidden = true;
  altsEl.hidden = true;
  sheetEl.hidden = true;
  paintHud(currentChoice());
  if (isCarMode() || Number(fuelTrip) > 0) {
    showFuelBar(Number(fuelTrip) > 0 ? `Suivi Fuel · trajet ${fuelTrip}` : 'Suivi Fuel · guidage');
  } else {
    fuelEl.hidden = true;
  }
}

function stopNavWatch() {
  if (navWatch != null) {
    navigator.geolocation.clearWatch(navWatch);
    navWatch = null;
  }
}

function startNavWatch(onPos) {
  navWatchFn = onPos;
  stopNavWatch();
  if (!navigator.geolocation || !appVisible) return;
  navWatch = navigator.geolocation.watchPosition(
    (pos) => {
      if (!appVisible || paused) return;
      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const now = Date.now();
      if (now - lastFixAt < 2200 && me && metersBetween(me, next) < 8) {
        updateSpeed(pos.coords, next);
        paintHud(currentChoice());
        return;
      }
      onPos(pos);
    },
    () => {},
    geoOpts({ accurate: true, freshMs: 2500, timeout: 15000 }),
  );
}

function stopIdleGeo() {
  if (idleGeoTimer) {
    clearInterval(idleGeoTimer);
    idleGeoTimer = 0;
  }
}

function pingIdleGeo() {
  if (!appVisible || navigating || document.hidden || activeTab !== 'maps') return;
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => setMe(pos.coords.latitude, pos.coords.longitude, false),
    () => {},
    geoOpts({ accurate: false, freshMs: 30000, timeout: 6000 }),
  );
}

function startIdleGeo() {
  stopIdleGeo();
  idleGeoTimer = window.setInterval(pingIdleGeo, 55000);
}

function bootLocate() {
  const had = restoreMe();
  if (had && me) {
    const z = Math.max(15, map.getZoom() || 0);
    if (z < 14) map.setView([me.lat, me.lon], 16);
  }
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const far = !me || metersBetween(me, next) > 120;
      setMe(next.lat, next.lon, !had || far);
    },
    () => {},
    geoOpts({ accurate: !had, freshMs: had ? 45000 : 8000, timeout: 8000 }),
  );
}

window.__mapsEnergyPause = function () {
  appVisible = false;
  stopNavWatch();
  stopIdleGeo();
};

window.__mapsEnergyResume = function () {
  appVisible = true;
  if (navigating && navWatchFn && !paused) startNavWatch(navWatchFn);
  else if (!navigating) startIdleGeo();
  try {
    map.invalidateSize();
  } catch {
    /* pas encore prêt */
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) window.__mapsEnergyPause();
  else window.__mapsEnergyResume();
});

function stopNavigation() {
  navigating = false;
  lastSpeedKmh = 0;
  lastSpoken = '';
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  setFollowNav(true);
  document.body.classList.remove('nav');
  searchForm.hidden = false;
  navBar.hidden = true;
  chipsEl.hidden = false;
  const speedEl = document.getElementById('hudSpeed');
  if (speedEl) speedEl.hidden = true;
  stopNavWatch();
  navWatchFn = null;
  startIdleGeo();
  const fromFuel = Number(fuelTrip) > 0;
  if (!fromFuel) {
    fuelEl.hidden = true;
  }
}

function startNavigation() {
  const r = currentChoice();
  if (!r) return;
  paused = false;
  setFollowNav(true);
  stopIdleGeo();
  enterNavUi();
  if (isCarMode()) {
    fuelControl('start', { dest: destShort() });
  }
  startNavWatch(applyNavFix);
}

const FR_SPEED = {
  'FR:urban': 50,
  'FR:rural': 80,
  'FR:zone30': 30,
  'FR:zone20': 20,
  'FR:motorway': 130,
  'FR:trunk': 110,
  'FR:living_street': 20,
};

function parseOsmMaxspeed(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === 'none' || s === 'signals') return null;
  if (FR_SPEED[s]) return FR_SPEED[s];
  const frNum = s.match(/^FR:(\d{1,3})$/i);
  if (frNum) {
    const v = Number(frNum[1]);
    if (v >= 5 && v <= 140) return Math.round(v);
  }
  const fr = s.match(/^FR:(\w+)/i);
  if (fr) {
    const k = `FR:${fr[1].toLowerCase()}`;
    if (FR_SPEED[k]) return FR_SPEED[k];
  }
  const km = s.match(/^(\d+(?:\.\d+)?)\s*(km\/h|kmh)?$/i);
  if (km) {
    const v = Number(km[1]);
    if (v >= 5 && v <= 140) return Math.round(v);
  }
  const mph = s.match(/^(\d+)\s*mph$/i);
  if (mph) return Math.round(Number(mph[1]) * 1.609);
  return null;
}

function impliedSpeedFromHighway(hw) {
  if (!hw) return null;
  if (hw === 'living_street') return 20;
  if (hw === 'motorway' || hw === 'motorway_link') return 130;
  if (hw === 'trunk' || hw === 'trunk_link') return 110;
  if (
    hw === 'residential' ||
    hw === 'unclassified' ||
    hw === 'tertiary' ||
    hw === 'tertiary_link' ||
    hw === 'secondary' ||
    hw === 'secondary_link' ||
    hw === 'primary' ||
    hw === 'primary_link'
  ) {
    return 50;
  }
  return null;
}

function skipPedestrianHighway(hw) {
  return !hw || /^(footway|cycleway|path|steps|pedestrian|bridleway|construction|proposed|elevator|corridor|platform|track)$/.test(hw);
}

function taggedSpeed(tags) {
  if (!tags) return null;
  for (const k of ['maxspeed', 'maxspeed:forward', 'maxspeed:backward', 'source:maxspeed', 'maxspeed:type', 'zone:maxspeed']) {
    const v = parseOsmMaxspeed(tags[k]);
    if (v != null) return v;
  }
  return null;
}

function paintSpeedLimit(kmh) {
  if (!roadNameEl) return;
  if (roadSignEl) roadSignEl.hidden = false;
  if (kmh == null) return;
  roadNameEl.textContent = String(kmh);
}

window.__huberaSpeedLimit = function (kmh) {
  const n = Number(kmh);
  if (!Number.isFinite(n) || n < 5) return;
  lastRoadPos = me || lastRoadPos;
  paintSpeedLimit(Math.round(n));
};

async function refreshRoad(lat, lon) {
  const now = Date.now();
  const here = { lat, lon };
  const haveLimit = roadNameEl && roadNameEl.textContent && roadNameEl.textContent !== '—';
  if (lastRoadPos && metersBetween(lastRoadPos, here) < 35 && now - lastRoadAt < 20000 && haveLimit) return;
  if (now - lastRoadAt < 8000) return;
  lastRoadAt = now;
  if (typeof HuberaSpeed !== 'undefined' && HuberaSpeed.lookup) {
    try {
      HuberaSpeed.lookup(lat, lon);
      return;
    } catch {
      /* fallback Overpass JS (web) */
    }
  }
  const query = `[out:json][timeout:10];way(around:80,${lat.toFixed(5)},${lon.toFixed(5)})[highway];out center tags 24;`;
  const urls = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];
  for (const endpoint of urls) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) continue;
      const data = await res.json();
      let best = null;
      for (const el of data.elements || []) {
        const tags = el.tags || {};
        if (skipPedestrianHighway(tags.highway)) continue;
        const c = el.center;
        const dist = c && Number.isFinite(c.lat) ? metersBetween(here, { lat: c.lat, lon: c.lon }) : 999;
        const tagged = taggedSpeed(tags);
        const speed = tagged != null ? tagged : impliedSpeedFromHighway(tags.highway);
        if (speed == null) continue;
        if (
          !best ||
          dist < best.dist - 10 ||
          (Math.abs(dist - best.dist) < 10 && tagged != null && !best.tagged)
        ) {
          best = { dist, speed, tagged: tagged != null };
        }
      }
      if (best) {
        lastRoadPos = here;
        paintSpeedLimit(best.speed);
        return;
      }
    } catch {
      /* Overpass suivant */
    }
  }
}

async function reverseLabel(lat, lon) {
  try {
    const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&lang=fr`;
    const res = await fetch(url);
    const data = await res.json();
    const p = data.features?.[0]?.properties || {};
    return (
      [p.name || p.street, p.city || p.state].filter(Boolean).join(', ') ||
      `${lat.toFixed(5)}, ${lon.toFixed(5)}`
    );
  } catch {
    return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}

function getHere() {
  return new Promise((resolve, reject) => {
    if (me) {
      resolve(me);
      return;
    }
    if (!navigator.geolocation) {
      reject(new Error('gps'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setMe(here.lat, here.lon, true);
        resolve(here);
      },
      () => reject(new Error('gps')),
      geoOpts({ accurate: true, freshMs: 8000, timeout: 12000 }),
    );
  });
}

function startAssign(kind) {
  pendingAssign = kind;
  const title = kind === 'home' ? 'Maison' : 'Travail';
  qEl.value = '';
  qEl.placeholder = `${title} : nom ou adresse`;
  syncClear();
  setTab('maps');
  qEl.focus();
  void showSuggestHits('');
}

async function showSuggestHits(q) {
  const items = [];
  const title = pendingAssign === 'home' ? 'Maison' : pendingAssign === 'work' ? 'Travail' : '';
  items.push({
    lat: me ? me.lat : 0,
    lon: me ? me.lon : 0,
    label: 'Ma position actuelle',
    hint: title ? `Enregistrer ici comme ${title}` : 'Utiliser ma position',
    here: true,
  });
  const query = String(q || '').trim();
  if (query.length >= 2) {
    try {
      const found = await searchPhoton(query);
      for (const h of found) items.push(h);
    } catch {
      /* hors ligne */
    }
  } else {
    const p = loadPlaces();
    for (const r of p.recents.slice(0, 4)) {
      items.push({ ...r, hint: 'Récent' });
    }
  }
  showHits(items);
}

async function definePlace(kind) {
  startAssign(kind);
}

async function routeTo(lat, lon, label) {
  lastDest = { lat, lon, label };
  rememberRecent({ lat, lon, label });
  stopNavigation();
  const gen = ++routeGen;
  if (routeAbort) routeAbort.abort();
  routeAbort = new AbortController();
  const signal = routeAbort.signal;
  if (pendingAssign) {
    const p = loadPlaces();
    p[pendingAssign] = { lat, lon, label };
    savePlaces(p);
    const kind = pendingAssign;
    pendingAssign = null;
    renderChips();
    renderSaved();
    toast(`${kind === 'home' ? 'Maison' : 'Travail'} enregistré : ${label}`);
    qEl.placeholder = 'Rechercher ici';
  }
  if (!me) {
    sheetEl.hidden = false;
    destMarker = L.marker([lat, lon]).addTo(map).bindPopup(label);
    map.setView([lat, lon], 14);
    sheetEl.innerHTML =
      `<strong>${esc(label)}</strong><span>Activez « ma position » puis relancez.</span>` +
      `<button type="button" class="go" id="btnGo">Ma position</button>`;
    document.getElementById('btnGo').onclick = () => {
      document.getElementById('btnHere').click();
      setTimeout(() => void routeTo(lat, lon, label), 700);
    };
    return;
  }
  clearRoute();
  destMarker = L.marker([lat, lon]).addTo(map).bindPopup(label);
  sheetEl.hidden = true;
  showAltsShell(label, `<p style="color:#94a3b8;margin:0">Calcul…</p>`);
  let choices = [];
  try {
    choices = await collectRoutes(me, { lat, lon }, signal);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    choices = [];
  }
  if (gen !== routeGen) return;
  routeChoices = choices;
  if (!routeChoices.length) {
    const none =
      travelMode === 'transit'
        ? 'Pas de transport en commun trouvé sur ce trajet.'
        : `Aucun itinéraire ${modeLabel().toLowerCase()}.`;
    showAltsShell(label, `<p style="color:#94a3b8">${esc(none)}</p>`);
    return;
  }
  selectedRouteId = routeChoices[0].id;
  drawChoices(selectedRouteId);
  renderAlts();
}

function showHits(items) {
  if (!items.length) {
    hitsEl.hidden = true;
    hitsEl.innerHTML = '';
    return;
  }
  hitsEl.hidden = false;
  hitsEl.innerHTML = items
    .map((h) => {
      const hint = h.hint ? `<div class="hit-h">${esc(h.hint)}</div>` : '';
      return (
        `<button type="button" class="hit${h.here ? ' here' : ''}" data-here="${h.here ? '1' : ''}" ` +
        `data-lat="${h.lat}" data-lon="${h.lon}" data-label="${esc(h.label)}">` +
        `<div class="hit-t">${esc(h.label)}</div>${hint}</button>`
      );
    })
    .join('');
}

async function showNearby(kind) {
  if (!me) {
    toast('Position indisponible — autorisez le GPS.');
    return;
  }
  const amenity = kind === 'parking' ? 'parking' : 'fuel';
  const title = amenity === 'fuel' ? 'Stations' : 'Parkings';
  toast(`Recherche ${title.toLowerCase()} autour de vous…`);
  const around = amenity === 'fuel' ? 6000 : 2500;
  const query = `[out:json][timeout:15];node["amenity"="${amenity}"](around:${around},${me.lat},${me.lon});out 40;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error('overpass');
    const data = await res.json();
    const items = (data.elements || [])
      .filter((n) => Number.isFinite(n.lat) && Number.isFinite(n.lon))
      .map((n) => {
        const tags = n.tags || {};
        const name = tags.name || tags.brand || tags.operator || title;
        const extra = tags.brand && tags.brand !== name ? tags.brand : tags.operator || '';
        const km = haversineKm(me, { lat: n.lat, lon: n.lon });
        return {
          lat: n.lat,
          lon: n.lon,
          label: name,
          hint: `${km < 1 ? fmtDist(km) : `${km.toFixed(1)} km`}${extra && extra !== name ? ` · ${extra}` : ''}`,
          km,
        };
      })
      .sort((a, b) => a.km - b.km)
      .slice(0, 20);
    if (!items.length) {
      toast(`Aucune ${title.toLowerCase()} à proximité.`);
      return;
    }
    clearPoi();
    poiLayer = L.layerGroup();
    for (const it of items) {
      L.circleMarker([it.lat, it.lon], {
        radius: 7,
        color: '#fff',
        weight: 2,
        fillColor: amenity === 'fuel' ? '#34d399' : '#60a5fa',
        fillOpacity: 0.95,
      }).addTo(poiLayer);
    }
    poiLayer.addTo(map);
    const bounds = L.latLngBounds(items.map((it) => [it.lat, it.lon]));
    bounds.extend([me.lat, me.lon]);
    map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
    showHits(items.map((it) => ({ lat: it.lat, lon: it.lon, label: it.label, hint: it.hint })));
  } catch {
    toast('Recherche POI indisponible pour le moment.');
  }
}

function renderChips() {
  const p = loadPlaces();
  const bits = [
    `<button type="button" class="chip" data-chip="home">${p.home ? `Maison` : `+ Maison`}${p.home ? ` <span class="sub">· ${esc(p.home.label.split(',')[0])}</span>` : ''}</button>`,
    `<button type="button" class="chip" data-chip="work">${p.work ? `Travail` : `+ Travail`}${p.work ? ` <span class="sub">· ${esc(p.work.label.split(',')[0])}</span>` : ''}</button>`,
    `<button type="button" class="chip" data-chip="fuel">Stations</button>`,
    `<button type="button" class="chip" data-chip="parking">Parkings</button>`,
  ];
  for (const r of p.recents.slice(0, 3)) {
    bits.push(
      `<button type="button" class="chip" data-chip="recent" data-lat="${r.lat}" data-lon="${r.lon}" data-label="${esc(r.label)}">${esc(r.label.split(',')[0])}</button>`,
    );
  }
  chipsEl.innerHTML = bits.join('');
}

function renderSaved() {
  const p = loadPlaces();
  const rows = [];
  const add = (key, title, place) => {
    if (!place) {
      rows.push(
        `<button type="button" class="place-row" data-assign="${key}">Ajouter ${esc(title)} — chercher un lieu</button>`,
      );
      return;
    }
    rows.push(
      `<button type="button" class="place-row" data-lat="${place.lat}" data-lon="${place.lon}" data-label="${esc(place.label)}"><strong>${esc(title)}</strong> · ${esc(place.label)}</button>`,
    );
    rows.push(
      `<button type="button" class="place-row" data-assign="${key}">Changer ${esc(title)} (recherche)</button>`,
    );
  };
  add('home', 'Maison', p.home);
  add('work', 'Travail', p.work);
  const rest = p.saved.concat(p.recents);
  const seen = new Set([p.home?.label, p.work?.label].filter(Boolean));
  for (const r of rest) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    rows.push(
      `<button type="button" class="place-row" data-lat="${r.lat}" data-lon="${r.lon}" data-label="${esc(r.label)}">${esc(r.label)}</button>`,
    );
  }
  savedList.innerHTML = rows.join('') || '<p>Aucun lieu pour l’instant.</p>';
}

function openDrawer() {
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  scrim.hidden = false;
}

function closeDrawer() {
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  scrim.hidden = true;
}

function setTab(id) {
  activeTab = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  panelFuel.hidden = id !== 'trips';
  pageSaved.hidden = id !== 'saved';
  topChrome.style.visibility = id === 'saved' ? 'hidden' : '';
  roadSignEl.hidden = id === 'saved';
  btnHere.hidden = id !== 'maps';
  if (id !== 'maps') {
    sheetEl.hidden = true;
    if (altsEl) altsEl.hidden = true;
  } else if (navigating) {
    enterNavUi();
  } else if (routeChoices.length) {
    renderAlts();
  }
  if (id === 'saved') renderSaved();
  closeDrawer();
}

window.__mapsBack = function () {
  if (drawer.classList.contains('open')) {
    closeDrawer();
    return true;
  }
  const fillSheet = document.getElementById('fillSheet');
  if (fillSheet && !fillSheet.hidden) {
    fillSheet.hidden = true;
    return true;
  }
  if (!hitsEl.hidden) {
    showHits([]);
    pendingAssign = null;
    qEl.placeholder = 'Rechercher ici';
    return true;
  }
  if (activeTab === 'saved') {
    setTab('maps');
    return true;
  }
  if (navigating) {
    stopNavigation();
    renderAlts();
    return true;
  }
  if (altsEl && !altsEl.hidden) {
    altsEl.hidden = true;
    clearRoute();
    return true;
  }
  if (activeTab !== 'maps') {
    setTab('maps');
    return true;
  }
  if (!sheetEl.hidden) {
    sheetEl.hidden = true;
    return true;
  }
  return false;
};

qEl.addEventListener('input', () => {
  syncClear();
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  searchTimer = setTimeout(() => {
    showSuggestHits(q).catch(() => showHits([]));
  }, q.length < 2 ? 0 : 220);
});

qEl.addEventListener('focus', () => {
  document.body.classList.add('kb');
  if (!qEl.value.trim()) void showSuggestHits('');
});
qEl.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (document.activeElement !== qEl) document.body.classList.remove('kb');
  }, 180);
});

if (window.visualViewport) {
  const vv = window.visualViewport;
  const applyKb = () => {
    const kb = window.innerHeight - vv.height > 90;
    document.body.classList.toggle('kb', kb || document.activeElement === qEl);
  };
  vv.addEventListener('resize', applyKb);
}

btnClear.addEventListener('click', () => {
  qEl.value = '';
  syncClear();
  qEl.focus();
  void showSuggestHits('');
});

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const first = hitsEl.querySelector('.hit');
  if (first) first.click();
});

hitsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.hit');
  if (!btn) return;
  showHits([]);
  if (btn.dataset.here === '1') {
    void (async () => {
      try {
        const here = await getHere();
        const label = await reverseLabel(here.lat, here.lon);
        qEl.value = pendingAssign ? label : '';
        syncClear();
        setTab('maps');
        void routeTo(here.lat, here.lon, label);
      } catch {
        toast('Position indisponible — autorisez le GPS.');
      }
    })();
    return;
  }
  qEl.value = btn.dataset.label;
  syncClear();
  setTab('maps');
  void routeTo(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.label);
});

chipsEl.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const kind = chip.dataset.chip;
  if (kind === 'recent') {
    void routeTo(Number(chip.dataset.lat), Number(chip.dataset.lon), chip.dataset.label);
    return;
  }
  if (kind === 'fuel' || kind === 'parking') {
    void showNearby(kind);
    return;
  }
  const p = loadPlaces();
  const place = p[kind];
  if (place) {
    void routeTo(place.lat, place.lon, place.label);
    return;
  }
  startAssign(kind);
});

document.getElementById('btnHere').addEventListener('click', () => {
  setFollowNav(true);
  goHere();
});

document.getElementById('btnMenu').addEventListener('click', openDrawer);
document.getElementById('btnMenuNav').addEventListener('click', openDrawer);
document.getElementById('btnStopNav').addEventListener('click', () => {
  stopNavigation();
  renderAlts();
});
document.getElementById('btnUser').addEventListener('click', openDrawer);
document.getElementById('drawerAvatar').addEventListener('click', openDrawer);
document.getElementById('btnSavedBack').addEventListener('click', () => setTab('maps'));
document.getElementById('btnDefineHome').addEventListener('click', () => startAssign('home'));
document.getElementById('btnDefineWork').addEventListener('click', () => startAssign('work'));
scrim.addEventListener('click', closeDrawer);

drawer.addEventListener('click', (e) => {
  const item = e.target.closest('.d-item');
  if (!item) return;
  const go = item.dataset.go;
  if (go === 'maps' || go === 'trips' || go === 'saved') setTab(go);
  else if (go === 'fuel') location.href = fuelUrl('maps');
  else if (go === 'music') musicCall('openApp');
  else if (go === 'account') {
    closeDrawer();
    toast('Hubera ID · paul@delhomme.ovh');
  }
  else if (go === 'settings' || go === 'offline') {
    closeDrawer();
    sheetEl.hidden = false;
    sheetEl.innerHTML =
      `<strong>${go === 'settings' ? 'Paramètres' : 'Cartes hors ligne'}</strong>` +
      `<span>À brancher ensuite (compte, cache tuiles).</span>`;
    setTab('maps');
  }
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  setTab(tab.dataset.tab);
});

savedList.addEventListener('click', (e) => {
  const row = e.target.closest('.place-row');
  if (!row) return;
  if (row.dataset.assign) {
    startAssign(row.dataset.assign);
    return;
  }
  setTab('maps');
  void routeTo(Number(row.dataset.lat), Number(row.dataset.lon), row.dataset.label);
});

document.getElementById('btnFuelOpen').addEventListener('click', () => {
  location.href = fuelUrl('maps');
});
document.getElementById('btnFuelTrack').addEventListener('click', () => {
  location.href = fuelUrl('trip?autoStart=1&mode=free');
});

function applyFuelFromQuery() {
  const p = new URLSearchParams(location.search);
  const tripId = p.get('tripId');
  const q = p.get('q') || p.get('label');
  const lat = parseFloat(p.get('lat') || p.get('toLat'));
  const lon = parseFloat(p.get('lon') || p.get('toLon'));
  const runDest = () => {
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      void routeTo(lat, lon, q || 'Destination');
    } else if (q) {
      searchPhoton(q).then((hits) => {
        if (hits[0]) void routeTo(hits[0].lat, hits[0].lon, hits[0].label);
        else {
          qEl.value = q;
          syncClear();
          showHits([]);
        }
      });
    }
  };
  if (me && (Number.isFinite(lat) || q)) {
    runDest();
  } else if (navigator.geolocation && (Number.isFinite(lat) || q)) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe(pos.coords.latitude, pos.coords.longitude, false);
        runDest();
      },
      runDest,
      geoOpts({ accurate: true, freshMs: 20000, timeout: 8000 }),
    );
  } else {
    runDest();
  }
  if (tripId) {
    fuelTrip = tripId;
    paused = false;
    showFuelBar(`Suivi Fuel · trajet ${tripId}`);
    lastDest = { lat: me?.lat || 0, lon: me?.lon || 0, label: `Suivi Fuel ${tripId}` };
    searchForm.hidden = true;
    navBar.hidden = false;
    chipsEl.hidden = true;
    document.body.classList.add('nav');
    const titleEl = document.getElementById('hudTitle');
    const metaEl = document.getElementById('hudMeta');
    const distEl = document.getElementById('hudDist');
    if (titleEl) titleEl.textContent = 'Suivi libre';
    if (metaEl) metaEl.textContent = `trajet Fuel ${tripId}`;
    if (distEl) distEl.textContent = 'GPS';
    navigating = true;
    setFollowNav(true);
    stopIdleGeo();
    startNavWatch(applyNavFix);
  }
}

function openFillSheet() {
  const sheet = document.getElementById('fillSheet');
  if (!sheet) return;
  sheet.hidden = false;
  const st = document.getElementById('fillStation');
  if (st && !st.value) {
    const name = document.getElementById('roadName')?.textContent;
    if (name && name !== '…' && name !== '—') st.value = name;
  }
  document.getElementById('fillLiters')?.focus();
}

function closeFillSheet() {
  const sheet = document.getElementById('fillSheet');
  if (sheet) sheet.hidden = true;
}

function saveFillFromSheet() {
  const liters = document.getElementById('fillLiters')?.value?.trim() || '';
  const total = document.getElementById('fillTotal')?.value?.trim() || '';
  const station = document.getElementById('fillStation')?.value?.trim() || '';
  if (!liters && !total) {
    toast('Indique les litres ou le montant.');
    return;
  }
  paused = true;
  document.getElementById('btnPause').textContent = 'Reprendre';
  stopNavWatch();
  fuelControl('fill', { liters, total, station });
  closeFillSheet();
  toast('Plein envoyé à Fuel — tu restes dans Maps.');
}

window.__mapsFuelEvent = function (raw) {
  try {
    const q = new URLSearchParams(String(raw || '').replace(/^\?/, ''));
    const id = q.get('tripId');
    if (id && Number(id) > 0) {
      fuelTrip = id;
      showFuelBar(`Suivi Fuel · trajet ${id}`);
      if (!navigating) {
        document.body.classList.add('nav');
        searchForm.hidden = true;
        navBar.hidden = false;
        chipsEl.hidden = true;
        navigating = true;
        const titleEl = document.getElementById('hudTitle');
        const metaEl = document.getElementById('hudMeta');
        const distEl = document.getElementById('hudDist');
        if (titleEl) titleEl.textContent = 'Suivi Fuel';
        if (metaEl) metaEl.textContent = `trajet ${id}`;
        if (distEl) distEl.textContent = 'GPS';
        stopIdleGeo();
        setFollowNav(true);
        startNavWatch(applyNavFix);
      }
    }
    const msg = q.get('msg');
    if (msg) toast(msg);
  } catch {
    /* ignore */
  }
};

function fuelStopTracking() {
  fuelControl('stop');
  fuelTrip = null;
  paused = false;
  stopNavigation();
  renderAlts();
  toast('Trajet Fuel arrêté — tu restes dans Maps.');
}

document.getElementById('btnPause').addEventListener('click', () => {
  paused = !paused;
  document.getElementById('btnPause').textContent = paused ? 'Reprendre' : 'Pause';
  if (paused) stopNavWatch();
  else if (navigating && navWatchFn) startNavWatch(navWatchFn);
  fuelControl(paused ? 'pause' : 'resume');
  toast(paused ? 'Pause — guidage et Fuel.' : 'Reprise.');
});
document.getElementById('btnStop').addEventListener('click', fuelStopTracking);
document.getElementById('btnFill').addEventListener('click', openFillSheet);
document.getElementById('fillCancel').addEventListener('click', closeFillSheet);
document.getElementById('fillSave').addEventListener('click', saveFillFromSheet);

bootLocate();
startIdleGeo();

setMusicDock(musicDockOn());
syncChromeHeight();
if (window.ResizeObserver) {
  const chromeEl = document.getElementById('chrome');
  if (chromeEl) new ResizeObserver(syncChromeHeight).observe(chromeEl);
}
window.addEventListener('resize', syncChromeHeight);
paintModes();
applyFuelFromQuery();
paintId();
renderChips();
renderSaved();
syncClear();

const nativeMusic = typeof HuberaMusic !== 'undefined';

function applyMusicState(s) {
  if (!s || typeof s !== 'object') return;
  const title = document.getElementById('musicTitle');
  const artist = document.getElementById('musicArtist');
  const play = document.getElementById('musicPlay');
  if (title) title.textContent = s.title || 'Aucun titre — ouvre Music';
  if (artist) artist.textContent = s.artist || '';
  if (play) play.textContent = s.playing ? '❚❚' : '▶';
}

window.__huberaMusicState = function (payload) {
  try {
    applyMusicState(typeof payload === 'string' ? JSON.parse(payload) : payload);
  } catch {
    /* ignore */
  }
};

function musicCall(fn) {
  if (!nativeMusic) return;
  try {
    HuberaMusic[fn]();
  } catch {
    /* ignore */
  }
}

document.getElementById('musicPlay').addEventListener('click', () => musicCall('playPause'));
document.getElementById('musicNext').addEventListener('click', () => musicCall('next'));
document.getElementById('musicPrev').addEventListener('click', () => musicCall('prev'));
document.getElementById('musicOpenMeta').addEventListener('click', () => musicCall('openApp'));
document.getElementById('musicHide').addEventListener('click', () => setMusicDock(false));
musicPeek.addEventListener('click', () => setMusicDock(true));

if (nativeMusic) {
  try {
    applyMusicState(JSON.parse(HuberaMusic.stateJson()));
  } catch {
    /* encore en connexion */
  }
  musicPollTimer = window.setInterval(() => {
    if (document.hidden || document.body.classList.contains('music-off')) return;
    try {
      applyMusicState(JSON.parse(HuberaMusic.stateJson()));
    } catch {
      /* ignore */
    }
  }, 800);
}
