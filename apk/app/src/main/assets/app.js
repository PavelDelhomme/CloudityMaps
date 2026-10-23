/* Hubera Maps — OSM + Photon + OSRM. Trafic voiture : Bison Futé. Chrome type Google Maps + Fuel + Music. */
const LAST_ME_KEY = 'hubera-maps-last-me';
const PLACE_KEY = 'hubera-maps-places';
const CONTACT_GEO_KEY = 'hubera-maps-contact-geo';
const MUSIC_KEY = 'hubera-maps-music-dock';
const MODE_KEY = 'hubera-maps-mode';
const VOICE_KEY = 'hubera-maps-voice';
const NIGHT_KEY = 'hubera-maps-night';
const FUEL_TRIPS_KEY = 'hubera-maps-fuel-trips';
const FUEL_UX_KEY = 'hubera-maps-fuel-ux-dev';
const FUEL_SNAP_KEY = 'hubera-maps-fuel-snap';
const FUEL_LOGO_KEY = 'hubera-maps-fuel-logo';
const FUEL_VEH_KEY = 'hubera-maps-fuel-veh';
const FUEL_VEH_PICK_KEY = 'hubera-maps-fuel-veh-user';
const FUEL_VEH_SEEN_KEY = 'hubera-maps-fuel-veh-seen';
const PLACES_CACHE_KEY = 'hubera-maps-osm-places-v1';
const PLANNED_TRIPS_KEY = 'hubera-maps-planned-trips';
let fuelPageTab = 'home';
function loadFuelVehNumber(key) {
  const n = Number(localStorage.getItem(key) || '0');
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function loadSelectedFuelVehicleId() {
  return loadFuelVehNumber(FUEL_VEH_KEY);
}
function userLockedFuelVehicle() {
  try {
    return localStorage.getItem(FUEL_VEH_PICK_KEY) === '1';
  } catch {
    return false;
  }
}
function rememberSeenFuelActive(id) {
  const n = Number(id) || 0;
  try {
    if (n > 0) localStorage.setItem(FUEL_VEH_SEEN_KEY, String(n));
    else localStorage.removeItem(FUEL_VEH_SEEN_KEY);
  } catch {
    /* quota */
  }
}
function setSelectedFuelVehicle(id, fromUser) {
  const n = Number(id);
  fuelSelectedVehicleId = Number.isFinite(n) && n > 0 ? n : 0;
  try {
    if (fuelSelectedVehicleId) localStorage.setItem(FUEL_VEH_KEY, String(fuelSelectedVehicleId));
    else localStorage.removeItem(FUEL_VEH_KEY);
    if (fromUser && fuelSelectedVehicleId) {
      localStorage.setItem(FUEL_VEH_PICK_KEY, '1');
      fuelUserPickedVehicle = true;
    }
  } catch {
    /* quota */
  }
}
let fuelSelectedVehicleId = loadSelectedFuelVehicleId();
let fuelUserPickedVehicle = userLockedFuelVehicle();
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
function stylePane(name, z, pointer) {
  map.createPane(name);
  const pane = map.getPane(name);
  if (!pane || !pane.style) return;
  pane.style.zIndex = String(z);
  if (pointer) pane.style.pointerEvents = pointer;
}
stylePane('mePane', 900);
stylePane('labelsPane', 450, 'none');
stylePane('poiPane', 620);
map.whenReady(() => {
  map.invalidateSize();
  const boot = document.getElementById('bootFail');
  if (boot) boot.hidden = true;
  setTimeout(() => map.invalidateSize(), 350);
});
map.on('dragstart', () => {
  if (navigating) setFollowNav(false);
});
map.on('zoomend moveend', () => {
  syncPinLabels();
  scheduleMapPlaces();
});
let baseTiles = null;
let nightOn = null;
function nightPref() {
  return localStorage.getItem(NIGHT_KEY) || 'auto';
}
function wantNight() {
  const p = nightPref();
  if (p === 'on') return true;
  if (p === 'off') return false;
  if (window.__huberaSystemNight === true) return true;
  if (window.__huberaSystemNight === false) return false;
  try {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return true;
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return false;
    }
  } catch {
    /* WebView ancien */
  }
  const h = new Date().getHours();
  return h >= 21 || h < 6;
}
const TILE_SOURCES = [
  { url: 'https://tile.openstreetmap.de/{z}/{x}/{y}.png', opts: {} },
  { url: 'https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png', opts: { subdomains: 'abc' } },
  { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', opts: {} },
];
let tileSourceIdx = 0;
let tileErrorBurst = 0;
function makeBaseTiles(idx) {
  const spec = TILE_SOURCES[Math.max(0, Math.min(idx, TILE_SOURCES.length - 1))];
  const opts = Object.assign({
    maxZoom: 19,
    updateWhenIdle: false,
    updateWhenZooming: true,
    keepBuffer: 8,
    detectRetina: false,
    attribution: '&copy; OpenStreetMap',
  }, spec.opts || {});
  const layer = L.tileLayer(spec.url, opts);
  layer.on('tileerror', () => {
    tileErrorBurst += 1;
    const need = navigating || document.body.classList.contains('routing') ? 6 : 28;
    if (tileErrorBurst < need || tileSourceIdx >= TILE_SOURCES.length - 1) return;
    tileErrorBurst = 0;
    tileSourceIdx += 1;
    try {
      map.removeLayer(layer);
    } catch {
      /* déjà retiré */
    }
    baseTiles = makeBaseTiles(tileSourceIdx).addTo(map);
  });
  return layer;
}
function applyTiles() {
  try {
    const night = wantNight();
    document.body.classList.toggle('night', night);
    if (baseTiles && nightOn === night) return;
    nightOn = night;
    if (baseTiles) map.removeLayer(baseTiles);
    // tile.openstreetmap.org est bloqué (418 « Access blocked ») depuis
    // l’app / le VPS. osm.de puis osm.fr. Nuit = filtre CSS, pas CARTO.
    baseTiles = makeBaseTiles(tileSourceIdx).addTo(map);
  } catch (err) {
    console.error('maps tiles', err);
  }
}
applyTiles();
window.setInterval(applyTiles, 10 * 60 * 1000);
try {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTiles);
} catch {
  /* ignore */
}

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
const pageSettings = document.getElementById('pageSettings');
const pageOffline = document.getElementById('pageOffline');
const pageFuelUx = document.getElementById('pageFuelUx');
const savedList = document.getElementById('savedList');
const altsEl = document.getElementById('alts');
const routeCardEl = document.getElementById('routeCard');
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
let pendingResumeId = null;
let paused = false;
let searchTimer = 0;
let searchGen = 0;
let suppressSuggestUntil = 0;
let pendingAssign = null;
let lastDest = null;
let lastOrigin = null;
let pendingEnd = null;
let endEditGen = 0;
let detourPollAt = 0;
let ignoredDetourKey = '';
let offeredDetour = null;
let activeTab = 'maps';
let altLayers = [];
let routeChoices = [];
let selectedRouteId = null;
let navigating = false;
let navWatch = null;
let lastRoadAt = 0;
let lastSpeedKmh = 0;
let movingSince = 0;
let fuelArmed = false;
let tripInfoOpen = false;
let tripInfoUserClosed = false;
let fuelDriveMs = 0;
let fuelDriveLast = 0;
let lastNavAt = 0;
const STILL_KMH = 5;
const ROLL_KMH = 8;
let lastHeadingDeg = 0;
let smoothMe = null;
let lastCamAt = 0;
let lastPuckHdg = null;
let lastWatchAt = 0;
let lastSpoken = '';
let lastSpokenAt = 0;
let followNav = true;
let poiLayer = null;
let contactLayer = null;
let placeFocusMarker = null;
let originMarker = null;
let worksLayer = null;
let mapsStartedFuel = false;
let lastWorksNearAt = 0;
let fuelHudStartedAt = 0;
let fuelLiveKm = 0;
let fuelPollTimer = 0;
let fuelHudTick = 0;
let hudCollapsed = false;
let fuelCardCollapsed = false;
let livePoiLayer = null;
let placeLabelLayer = null;
let mapPlacesTimer = 0;
let lastPlacesKey = '';
let selectedPoi = null;

const FETCH_HDR = { Accept: 'application/json' };
const TRAVEL_MODES = [
  ['car', 'Voiture'],
  ['walk', 'À pied'],
  ['hike', 'Randonnée'],
  ['bike', 'Vélo'],
  ['transit', 'Transports'],
];
let travelMode = localStorage.getItem(MODE_KEY) || 'car';
let routeGen = 0;
let routeAbort = null;
const routeCache = new Map();
const osrmWait = new Map();
let osrmReqId = 0;
let ignoreSearchInput = false;
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

function setTripKeepAlive(on) {
  try {
    if (window.HuberaTrip && typeof window.HuberaTrip.setActive === 'function') {
      window.HuberaTrip.setActive(!!on);
    }
  } catch {
    /* navigateur */
  }
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
    vehicleId: extra.vehicleId ? String(extra.vehicleId) : '',
    preferLegacy: extra.preferLegacy ? '1' : '',
  });
  try {
    if (window.HuberaFuel && typeof window.HuberaFuel.control === 'function') {
      window.HuberaFuel.control(action, payload);
      return true;
    }
  } catch {
    /* WebView hors APK */
  }
  if (action !== 'start' && action !== 'stop' && action !== 'history' && action !== 'snapshot' && action !== 'select' && action !== 'fill') {
    toast('Commande Fuel enregistrée dans Maps.');
  }
  return false;
}

const PENDING_FILL_KEY = 'maps_pending_fuel_fill_v1';
function savePendingFuelFill(extra) {
  try {
    localStorage.setItem(PENDING_FILL_KEY, JSON.stringify({
      liters: extra.liters || '',
      total: extra.total || '',
      station: extra.station || '',
      vehicleId: extra.vehicleId ? String(extra.vehicleId) : '',
      at: Date.now(),
    }));
  } catch {
    /* quota */
  }
}
function loadPendingFuelFill() {
  try {
    const raw = localStorage.getItem(PENDING_FILL_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - Number(o.at || 0) > 14 * 86400000) {
      localStorage.removeItem(PENDING_FILL_KEY);
      return null;
    }
    if (!o.liters && !o.total) return null;
    return o;
  } catch {
    return null;
  }
}
function clearPendingFuelFill() {
  try { localStorage.removeItem(PENDING_FILL_KEY); } catch { /* */ }
}
let pendingFillRetryAt = 0;
function retryPendingFuelFill() {
  const p = loadPendingFuelFill();
  if (!p) return;
  if (Date.now() - pendingFillRetryAt < 4000) return;
  pendingFillRetryAt = Date.now();
  fuelControl('fill', p);
}

function decodeFuelTripPack(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  const out = [];
  for (const row of s.split('|')) {
    if (!row) continue;
    const [idRaw, kmRaw, start, origin, dest, flags] = row.split('~');
    const id = Number(idRaw);
    if (!Number.isFinite(id) || id <= 0) continue;
    const km = Number(kmRaw);
    out.push({
      id,
      km: Number.isFinite(km) ? km : 0,
      start: start || '',
      origin: origin || '',
      dest: dest || '',
      active: String(flags || '').includes('a'),
      paused: String(flags || '').includes('p'),
    });
  }
  return out;
}

function loadCachedFuelTrips() {
  try {
    const rows = JSON.parse(localStorage.getItem(FUEL_TRIPS_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function saveCachedFuelTrips(rows) {
  localStorage.setItem(FUEL_TRIPS_KEY, JSON.stringify((rows || []).slice(0, 20)));
}

function fmtFuelWhen(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fuelNorm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function fuelSamePath(a, b) {
  const oa = fuelNorm(a.origin);
  const ob = fuelNorm(b.origin);
  const da = fuelNorm(a.dest);
  const db = fuelNorm(b.dest);
  const close = (x, y) => {
    if (!x || !y) return false;
    if (x === y || x.includes(y) || y.includes(x)) return true;
    const tx = new Set(x.split(' ').filter((w) => w.length > 3));
    const ty = y.split(' ').filter((w) => w.length > 3);
    if (!tx.size || !ty.length) return false;
    return ty.filter((w) => tx.has(w)).length >= Math.min(2, ty.length);
  };
  const destHit = close(da, db);
  const originHit = close(oa, ob) || (!oa && !ob);
  const reverse = close(oa, db) && close(da, ob);
  if (destHit && (originHit || !oa || !ob)) return true;
  return reverse;
}

function fuelSimilarNote(t, all) {
  const peers = (all || []).filter((o) => o.id !== t.id && !o.active && fuelSamePath(t, o));
  if (!peers.length) return '';
  const kms = peers.map((p) => Number(p.km) || 0).filter((n) => n > 0.2);
  const avg = kms.length ? kms.reduce((s, n) => s + n, 0) / kms.length : 0;
  const cur = Number(t.km) || 0;
  let delta = '';
  if (avg > 0 && cur > 0) {
    const d = cur - avg;
    if (Math.abs(d) >= 0.3) delta = d > 0 ? ` · +${d.toFixed(1)} km vs habitude` : ` · ${d.toFixed(1)} km vs habitude`;
  }
  return `${peers.length} trajet${peers.length > 1 ? 's' : ''} similaire${peers.length > 1 ? 's' : ''}${avg ? ` · moy. ${avg.toFixed(1)} km` : ''}${delta}`;
}

function renderFuelTripList(rows) {
  const els = ['fuelTripList', 'fuelTripListPanel']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  if (!els.length) return;
  let list = (rows || loadCachedFuelTrips()).slice();
  const liveId = Number(fuelTrip);
  if (mapsStartedFuel && Number.isFinite(liveId) && liveId > 0 && !list.some((t) => t.id === liveId && t.active)) {
    list = [
      {
        id: liveId,
        km: liveFuelKm(),
        start: new Date().toISOString(),
        origin: 'Départ',
        dest: 'en cours',
        active: true,
        paused,
      },
      ...list.filter((t) => t.id !== liveId),
    ];
  }
  const html = !list.length
    ? '<p>Aucun trajet pour l’instant — démarre un suivi depuis Maps.</p>'
    : list
        .map((t) => {
          const from = t.origin || 'Départ';
          const to = t.dest || (t.active ? 'en cours' : 'Arrivée');
          const live = t.active ? ' live' : '';
          const km = t.km > 0 ? `${t.km.toFixed(1)} km` : t.active ? 'GPS' : '';
          const pause = t.paused ? ' · pause' : '';
          const similar = fuelSimilarNote(t, list);
          return (
            `<button type="button" class="fuel-trip${live}" data-id="${t.id}" data-dest="${esc(t.dest || '')}" data-origin="${esc(t.origin || '')}" data-active="${t.active ? '1' : '0'}">` +
            `<div class="when">${esc(fmtFuelWhen(t.start))}${t.active ? ' · en cours' : ''}</div>` +
            `<div class="path">${esc(from)} → ${esc(to)}</div>` +
            `<div class="meta">${esc(km)}${pause}${similar ? ` · ${esc(similar)}` : ''}</div></button>`
          );
        })
        .join('');
  els.forEach((el) => {
    el.innerHTML = html;
  });
}

function applyFuelTripPack(raw) {
  const rows = decodeFuelTripPack(raw);
  if (!rows.length) return;
  saveCachedFuelTrips(rows);
  renderFuelTripList(rows);
  const live = rows.find((t) => t.active);
  if (live) {
    if (live.km > 0) fuelLiveKm = live.km;
    if (live.id) fuelTrip = live.id;
    paintFuelStats();
  }
}

function clearTrace() {
  trace = [];
  if (traceLayer) {
    map.removeLayer(traceLayer);
    traceLayer = null;
  }
}

function traceKm() {
  let d = 0;
  for (let i = 1; i < trace.length; i++) {
    d += haversineKm(
      { lat: trace[i - 1][0], lon: trace[i - 1][1] },
      { lat: trace[i][0], lon: trace[i][1] },
    );
  }
  return d;
}

function fmtFuelMins(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

function liveFuelKm() {
  return Math.max(fuelLiveKm || 0, traceKm());
}

function paintFuelStats() {
  const el = document.getElementById('fuelStats');
  if (!el) return;
  if (!mapsStartedFuel && !(Number(fuelTrip) > 0)) {
    el.textContent = '';
    paintFuelPeek();
    document.body.classList.remove('fuel-live');
    return;
  }
  document.body.classList.add('fuel-live');
  tickFuelDriveClock();
  const km = liveFuelKm();
  const dur = fuelDriveMs ? fmtFuelMins(fuelDriveMs) : '';
  const bits = [];
  if (paused) bits.push('pause');
  else if (isStationary()) bits.push('à l\'arrêt');
  bits.push(km > 0.05 ? `${km.toFixed(1)} km` : '0 km');
  if (dur) bits.push(dur);
  const shown = displaySpeedKmh();
  if (shown) bits.push(`${shown} km/h`);
  const rows = loadCachedFuelTrips();
  const live = rows.find((t) => t.active) || rows[0];
  if (live) {
    const sim = fuelSimilarNote(live, rows);
    if (sim) bits.push(sim);
  }
  el.textContent = bits.join(' · ');
  paintFuelPeek();
}

function startFuelHudTick() {
  stopFuelHudTick();
  fuelHudTick = window.setInterval(() => {
    if (!mapsStartedFuel) {
      stopFuelHudTick();
      return;
    }
    paintFuelStats();
    if (navigating && !hudCollapsed) paintHud(currentChoice());
  }, 1000);
}

function stopFuelHudTick() {
  if (fuelHudTick) {
    clearInterval(fuelHudTick);
    fuelHudTick = 0;
  }
}

function startFuelPoll() {
  stopFuelPoll();
  startFuelHudTick();
}

function stopFuelPoll() {
  if (fuelPollTimer) {
    clearInterval(fuelPollTimer);
    fuelPollTimer = 0;
  }
  stopFuelHudTick();
}

let lastFuelHistoryAt = 0;

function requestFuelHistory(force) {
  renderFuelTripList();
  const cached = loadCachedFuelTrips();
  if (!force && cached.length) return;
  if (!force && Date.now() - lastFuelHistoryAt < 8000) return;
  lastFuelHistoryAt = Date.now();
  fuelControl('history');
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
  paintPlacePins();
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
  if (musicPeek) musicPeek.hidden = on;
  syncChromeHeight();
}

function syncChromeHeight() {
  const el = document.getElementById('chrome');
  if (!el) return;
  const h = Math.ceil(el.getBoundingClientRect().height);
  if (h > 40) document.body.style.setProperty('--chrome', `${h}px`);
  placeRoadSign();
}

function placeRoadSign() {
  const sign = document.getElementById('roadSign');
  const top = document.getElementById('topChrome');
  if (!sign || !top) return;
  const bottom = Math.ceil(top.getBoundingClientRect().bottom);
  sign.style.top = `${Math.max(8, bottom + 8)}px`;
  sign.style.right = '14px';
  sign.style.left = 'auto';
}

function syncClear() {
  const q = String(qEl && qEl.value ? qEl.value : '').trim();
  btnClear.hidden = q.length === 0;
}

function suggestSuppressed() {
  return Date.now() < suppressSuggestUntil;
}

function dismissSearchChrome() {
  searchGen += 1;
  clearTimeout(searchTimer);
  suppressSuggestUntil = Date.now() + 400;
  showHits([]);
  if (chipsEl && !document.body.classList.contains('routing')) chipsEl.hidden = false;
  if (qEl) qEl.blur();
  document.body.classList.remove('kb');
  syncClear();
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
  if (navigating && followNav && me) applyNavCamera(me.lat, me.lon, true);
}

function destAlong(lat, lon, bearingDeg, meters) {
  const R = 6371000;
  const br = (bearingDeg * Math.PI) / 180;
  const p1 = (lat * Math.PI) / 180;
  const l1 = (lon * Math.PI) / 180;
  const d = meters / R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(br));
  const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: (p2 * 180) / Math.PI, lon: (l2 * 180) / Math.PI };
}

function navHeading() {
  if (Number.isFinite(lastHeadingDeg) && lastHeadingDeg >= 0) return lastHeadingDeg;
  const choice = currentChoice();
  const step = upcomingManeuver(me, choice?.steps).now;
  const p = stepPoint(step);
  if (me && p) return bearingDeg(me, p);
  return 0;
}

function headingDelta(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function mixHeading(from, to, a) {
  const x = Math.sin((from * Math.PI) / 180) * (1 - a) + Math.sin((to * Math.PI) / 180) * a;
  const y = Math.cos((from * Math.PI) / 180) * (1 - a) + Math.cos((to * Math.PI) / 180) * a;
  return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
}

function smoothNavFix(next, accuracy) {
  const acc = Number(accuracy);
  if (Number.isFinite(acc) && acc > 65) return smoothMe || next;
  if (!smoothMe) {
    smoothMe = { lat: next.lat, lon: next.lon };
    return smoothMe;
  }
  const jump = metersBetween(smoothMe, next);
  if (jump > 95 && (!Number.isFinite(acc) || acc > 18 || jump > 220)) return smoothMe;
  const alpha = jump < 10 ? 0.16 : jump < 35 ? 0.32 : 0.5;
  smoothMe = {
    lat: smoothMe.lat * (1 - alpha) + next.lat * alpha,
    lon: smoothMe.lon * (1 - alpha) + next.lon * alpha,
  };
  return smoothMe;
}

function applyNavCamera(lat, lon, instant) {
  if (!followNav || !navigating) return;
  const now = Date.now();
  const here = L.latLng(lat, lon);
  const z = lastSpeedKmh >= 110 ? 16 : 17;
  let moved = 999;
  try {
    const c = map.getCenter();
    if (c) moved = map.distance(c, here);
  } catch {
    /* */
  }
  const zoom = map.getZoom ? map.getZoom() : z;
  if (!instant && now - lastCamAt < 1100 && moved < 24 && Math.abs(zoom - z) < 0.45) return;
  lastCamAt = now;
  try {
    map.setView(here, z, { animate: false });
  } catch {
    /* carte pas prête */
  }
}

function displaySpeedKmh() {
  return lastSpeedKmh >= STILL_KMH ? lastSpeedKmh : 0;
}

function isStationary() {
  return paused || displaySpeedKmh() < STILL_KMH;
}

function isRolling() {
  return !paused && lastSpeedKmh >= ROLL_KMH && movingSince > 0 && Date.now() - movingSince >= 2500;
}

function tickFuelDriveClock() {
  const now = Date.now();
  if (paused || lastSpeedKmh < STILL_KMH || !mapsStartedFuel) {
    fuelDriveLast = 0;
    return;
  }
  if (fuelDriveLast) fuelDriveMs += now - fuelDriveLast;
  fuelDriveLast = now;
}

function maybeStartFuelOnMove() {
  if (!fuelArmed || mapsStartedFuel || paused || !isCarMode()) return;
  if (!isRolling()) return;
  fuelArmed = false;
  promptFuelGate('nav');
}

function updateSpeed(coords, next) {
  if (paused) {
    lastSpeedKmh = 0;
    movingSince = 0;
    lastNavAt = Date.now();
    return;
  }
  const acc = Number(coords && coords.accuracy);
  const accM = Number.isFinite(acc) && acc > 0 ? acc : 15;
  let mps = Number(coords && coords.speed);
  if (!Number.isFinite(mps) || mps < 0) {
    mps = 0;
    if (me && lastNavAt) {
      const dt = (Date.now() - lastNavAt) / 1000;
      const dist = metersBetween(me, next);
      if (dt >= 1.5 && dist >= Math.max(15, accM * 1.4)) mps = dist / dt;
    }
  }
  lastNavAt = Date.now();
  let kmh = Number.isFinite(mps) && mps >= 0 ? Math.round(mps * 3.6) : 0;
  if (kmh < STILL_KMH || kmh >= 220) kmh = 0;
  lastSpeedKmh = kmh;
  if (kmh >= ROLL_KMH) {
    if (!movingSince) movingSince = Date.now();
  } else {
    movingSince = 0;
  }
  const hd = Number(coords && coords.heading);
  if (Number.isFinite(hd) && hd >= 0 && lastSpeedKmh >= ROLL_KMH) {
    lastHeadingDeg = lastHeadingDeg ? mixHeading(lastHeadingDeg, hd, 0.28) : hd;
  } else if (me && next && metersBetween(me, next) > 12 && lastSpeedKmh >= ROLL_KMH) {
    lastHeadingDeg = mixHeading(lastHeadingDeg || bearingDeg(me, next), bearingDeg(me, next), 0.35);
  }
}

function applyNavFix(pos) {
  const raw = { lat: pos.coords.latitude, lon: pos.coords.longitude };
  const next = smoothNavFix(raw, pos.coords.accuracy) || raw;
  updateSpeed(pos.coords, next);
  tickFuelDriveClock();
  maybeStartFuelOnMove();
  setMe(next.lat, next.lon, false);
  if (followNav && navigating) applyNavCamera(next.lat, next.lon, false);
  appendTrace(next.lat, next.lon);
  paintHud(currentChoice());
  if (navigating && isCarMode()) {
    void refreshWorksNearMe(next);
    void refreshTrafficLive(next);
  }
}

function metersBetween(a, b) {
  if (!a || !b) return 1e9;
  return haversineKm(a, b) * 1000;
}

function mapsShouldFlyToFix(movedMeters, mock, userAsked) {
  if (userAsked) return true;
  if (mock && movedMeters > 25) return true;
  return movedMeters > 80;
}

function mapsShouldDropFix(accuracyM, mock) {
  if (mock) return false;
  return Number.isFinite(accuracyM) && accuracyM > 80;
}

window.__mapsNativeFix = function (lat, lon, acc, mock) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (mapsShouldDropFix(Number(acc), !!mock)) return;
  const next = { lat, lon };
  const moved = metersBetween(me, next);
  const fly = mapsShouldFlyToFix(moved, !!mock, false);
  setMe(lat, lon, fly);
  hideLocBanner();
  if (navigating && followNav) applyNavCamera(lat, lon, false);
};

function geoOpts({ accurate, freshMs, timeout }) {
  return {
    enableHighAccuracy: !!accurate,
    timeout: timeout || 8000,
    maximumAge: freshMs == null ? 15000 : freshMs,
  };
}

let huberaContacts = [];

function loadId() {
  let email = HUBERA_OWNER.email;
  let name = HUBERA_OWNER.name;
  try {
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.email) {
      const e = String(HuberaSuite.email() || '').trim();
      if (e) email = e;
    }
  } catch {
    /* native absent */
  }
  const local = email.split('@')[0] || 'Paul';
  name = local.charAt(0).toUpperCase() + local.slice(1);
  return { email, name };
}

function paintId() {
  const id = loadId();
  const mail = document.getElementById('drawerMail');
  const who = document.querySelector('.drawer .who');
  const avatars = [document.getElementById('btnUser'), document.getElementById('drawerAvatar')];
  if (who) who.textContent = id.name;
  if (mail) mail.textContent = id.email;
  const letter = (id.name || 'P').charAt(0).toUpperCase();
  avatars.forEach((a) => {
    if (a) a.textContent = letter;
  });
}

function applyHuberaIdFromParams() {
  return true;
}

function formatContactAddr(a) {
  if (!a || typeof a !== 'object') return '';
  return [a.street, a.postal_code, a.city, a.region, a.country]
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .join(', ');
}

function contactShortName(c) {
  const p = (c && c.profile) || {};
  const g = String(p.given_name || '').trim();
  const f = String(p.family_name || '').trim();
  if (g || f) return [g, f].filter(Boolean).join(' ');
  return String((c && c.name) || 'Contact').trim();
}

function contactPlaces() {
  const out = [];
  for (const c of huberaContacts) {
    const addrs = (c && c.profile && Array.isArray(c.profile.addresses) && c.profile.addresses) || [];
    if (!addrs.length && Number.isFinite(c.lat) && Number.isFinite(c.lon)) {
      out.push({
        name: c.name || 'Contact',
        shortName: c.short || contactShortName(c),
        email: c.email || '',
        query: c.query || '',
        label: c.label || c.name || 'Contact',
        lat: c.lat,
        lon: c.lon,
        hint: 'Contacts',
      });
      continue;
    }
    for (const a of addrs) {
      const query = formatContactAddr(a);
      if (!query) continue;
      const shortName = contactShortName(c);
      out.push({
        name: c.name || shortName,
        shortName,
        email: c.email || '',
        query,
        label: `${shortName} · ${query}`,
        lat: Number(a.lat),
        lon: Number(a.lon),
        hint: a.label || 'Contacts',
      });
    }
  }
  return out;
}

function loadContactGeo() {
  try {
    const raw = JSON.parse(localStorage.getItem(CONTACT_GEO_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function saveContactGeo(geo) {
  try {
    localStorage.setItem(CONTACT_GEO_KEY, JSON.stringify(geo));
  } catch {
    /* quota */
  }
}

const PLACE_SVGS = {
  home: '<svg viewBox="0 0 24 24" width="24" height="24" fill="#fff" aria-hidden="true"><path d="M12 3.4 3.2 10.8a1 1 0 0 0-.3.7V20a1.3 1.3 0 0 0 1.3 1.3h5.4v-6.4h4.8v6.4h5.4A1.3 1.3 0 0 0 21.1 20v-8.5a1 1 0 0 0-.3-.7L12 3.4z"/></svg>',
  work: '<svg viewBox="0 0 24 24" width="22" height="22" fill="#fff" aria-hidden="true"><path d="M9 7V5.6A2.6 2.6 0 0 1 11.6 3h.8A2.6 2.6 0 0 1 15 5.6V7h3.4A1.6 1.6 0 0 1 20 8.6V12H4V8.6A1.6 1.6 0 0 1 5.6 7H9zm1.5 0h3V5.7c0-.4-.3-.7-.7-.7h-1.6c-.4 0-.7.3-.7.7V7zM4 13.5h16V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19v-5.5z"/></svg>',
  person: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true"><circle cx="12" cy="8" r="3.7"/><path d="M5.1 19.4c.5-3.5 3.3-5.5 6.9-5.5s6.4 2 6.9 5.5c.04.4-.3.8-.8.8H5.9c-.5 0-.84-.4-.8-.8z"/></svg>',
  saved: '<svg viewBox="0 0 24 24" width="18" height="18" fill="#fff" aria-hidden="true"><path d="M12 3.2 14.7 9l6.3.6-4.8 4.1 1.5 6.1L12 16.8 6.3 19.8 7.8 13.7 3 9.6 9.3 9 12 3.2z"/></svg>',
};

function pinNamesVisible() {
  try {
    const b = map.getBounds();
    const midLat = (b.getNorth() + b.getSouth()) / 2;
    const widthKm = haversineKm(
      { lat: midLat, lon: b.getWest() },
      { lat: midLat, lon: b.getEast() },
    );
    return widthKm <= 250 || map.getZoom() >= 14;
  } catch {
    return map.getZoom() >= 9;
  }
}

function syncPinLabels() {
  document.body.classList.toggle('pins-named', pinNamesVisible());
}

function placeNear(lat, lon, place, meters) {
  if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lon)) return false;
  return haversineKm({ lat, lon }, { lat: place.lat, lon: place.lon }) * 1000 < (meters || 80);
}

let lastPlaceHideKey = '';

function hideSavedPlaceBecauseHere(place) {
  if (!me || !place) return false;
  return placeNear(me.lat, me.lon, place, 45);
}

function hideSavedBecauseRoute(place) {
  if (!place) return false;
  if (lastOrigin && placeNear(lastOrigin.lat, lastOrigin.lon, place, 70)) return true;
  if (lastDest && placeNear(lastDest.lat, lastDest.lon, place, 70)) return true;
  return false;
}

function maybeRepaintPlacesForMe() {
  if (!me) return;
  const places = loadPlaces();
  const key = `${hideSavedPlaceBecauseHere(places.home) ? 1 : 0}|${hideSavedPlaceBecauseHere(places.work) ? 1 : 0}`;
  if (key === lastPlaceHideKey) return;
  lastPlaceHideKey = key;
  paintPlacePins();
}

function placePinIcon(kind, name) {
  const size = kind === 'person' ? 22 : 28;
  return L.divIcon({
    className: 'place-pin',
    html: `<div class="place-badge kind-${kind}">${PLACE_SVGS[kind] || PLACE_SVGS.person}</div><div class="place-lab">${esc(name)}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function contactPinIcon(name) {
  return placePinIcon('person', name);
}

function endpointIcon(role, title) {
  return L.divIcon({
    className: 'place-pin ab-pin',
    html: `<div class="ab-dot ${role === 'dest' ? 'dest' : 'origin'}"></div><div class="place-lab">${esc(title || '')}</div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });
}

function abIcon(letter) {
  return endpointIcon(letter === 'A' ? 'origin' : 'dest', letter === 'A' ? 'Départ' : 'Arrivée');
}

function paintPlacePins() {
  if (contactLayer) {
    map.removeLayer(contactLayer);
    contactLayer = null;
  }
  contactLayer = L.layerGroup().addTo(map);
  const places = loadPlaces();
  const geo = loadContactGeo();
  const clustered = new Map();
  for (const c of contactPlaces()) {
    let lat = Number.isFinite(c.lat) ? c.lat : null;
    let lon = Number.isFinite(c.lon) ? c.lon : null;
    if (lat == null || lon == null) {
      const g = geo[c.query];
      if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
        lat = g.lat;
        lon = g.lon;
      }
    }
    if (lat == null || lon == null) continue;
    if (placeNear(lat, lon, places.home) || placeNear(lat, lon, places.work)) continue;
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const prev = clustered.get(key);
    if (prev) {
      if (!prev.names.includes(c.shortName)) prev.names.push(c.shortName);
      continue;
    }
    clustered.set(key, { lat, lon, names: [c.shortName], label: c.label });
  }
  clustered.forEach((item) => {
    const name = item.names.join(' · ');
    L.marker([item.lat, item.lon], { icon: placePinIcon('person', name), zIndexOffset: 350, keyboard: false })
      .addTo(contactLayer)
      .on('click', () => void routeTo(item.lat, item.lon, item.label));
  });
  if (places.home && Number.isFinite(places.home.lat) && Number.isFinite(places.home.lon)
      && !hideSavedPlaceBecauseHere(places.home) && !hideSavedBecauseRoute(places.home)) {
    L.marker([places.home.lat, places.home.lon], {
      icon: placePinIcon('home', 'Maison'),
      zIndexOffset: 420,
      keyboard: false,
    })
      .addTo(contactLayer)
      .on('click', () => openPlaceActions('home', places.home));
  }
  if (places.work && Number.isFinite(places.work.lat) && Number.isFinite(places.work.lon)
      && !hideSavedPlaceBecauseHere(places.work) && !hideSavedBecauseRoute(places.work)) {
    L.marker([places.work.lat, places.work.lon], {
      icon: placePinIcon('work', 'Travail'),
      zIndexOffset: 410,
      keyboard: false,
    })
      .addTo(contactLayer)
      .on('click', () => openPlaceActions('work', places.work));
  }
  (places.saved || []).forEach((rec, i) => {
    if (!rec || !Number.isFinite(Number(rec.lat)) || !Number.isFinite(Number(rec.lon))) return;
    if (hideSavedPlaceBecauseHere(rec) || hideSavedBecauseRoute(rec)) return;
    const name = placeNick(rec, (rec.label || '').split(',')[0] || 'Lieu');
    L.marker([Number(rec.lat), Number(rec.lon)], {
      icon: placePinIcon('saved', name),
      zIndexOffset: 400,
      keyboard: false,
    })
      .addTo(contactLayer)
      .on('click', () => openPlaceActions('saved', { ...rec, _i: i }));
  });
  syncPinLabels();
}

function paintContactPins() {
  paintPlacePins();
}

async function geocodeMissingContacts() {
  const geo = loadContactGeo();
  let changed = false;
  for (const c of contactPlaces()) {
    if (Number.isFinite(c.lat) && Number.isFinite(c.lon)) continue;
    if (!c.query || geo[c.query]) continue;
    try {
      const hits = await searchPhoton(c.query);
      if (hits[0]) {
        geo[c.query] = { lat: hits[0].lat, lon: hits[0].lon };
        changed = true;
      }
    } catch {
      /* ignore */
    }
  }
  if (changed) saveContactGeo(geo);
  paintContactPins();
}

function mergeSeedContacts(seed) {
  if (!Array.isArray(seed) || !seed.length) return;
  const geo = loadContactGeo();
  for (const s of seed) {
    if (!s || !s.query || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) continue;
    geo[s.query] = { lat: s.lat, lon: s.lon };
    const exists = huberaContacts.some(
      (c) => (c.name || '') === (s.name || '') || (c.short || '') === (s.short || ''),
    );
    if (!exists) {
      huberaContacts.push({
        name: s.name,
        short: s.short,
        email: '',
        profile: {
          given_name: (s.short || '').split(' ')[0] || '',
          family_name: (s.short || '').split(' ').slice(1).join(' '),
          addresses: [{ street: s.query, lat: s.lat, lon: s.lon }],
        },
        lat: s.lat,
        lon: s.lon,
        query: s.query,
        label: s.label,
      });
    }
  }
  saveContactGeo(geo);
}

function applyHuberaContacts(list) {
  if (Array.isArray(list) && list.length) huberaContacts = list;
  paintContactPins();
  renderSaved();
  renderChips();
  void geocodeMissingContacts();
}

window.__mapsContactsReady = function () {
  let raw = '[]';
  try {
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.takeContacts) {
      raw = HuberaSuite.takeContacts() || '[]';
    }
  } catch {
    raw = '[]';
  }
  try {
    applyHuberaContacts(JSON.parse(raw));
  } catch {
    applyHuberaContacts([]);
  }
};

window.__mapsApplyAuth = function (q) {
  try {
    const p = new URLSearchParams(q || '');
    const token = p.get('token') || p.get('access') || p.get('access_token') || '';
    const email = p.get('email') || '';
    if (token && typeof HuberaSuite !== 'undefined' && HuberaSuite.setToken) {
      HuberaSuite.setToken(token);
    }
    if (email) {
      try {
        localStorage.setItem('hubera-maps-email', email);
      } catch {
        /* ignore */
      }
    }
    paintId();
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.refreshContacts) {
      HuberaSuite.refreshContacts();
    }
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.refreshFuel) {
      HuberaSuite.refreshFuel();
    }
    toast(email ? `Connecté · ${email}` : 'Compte Hubera ID à jour');
  } catch {
    /* ignore */
  }
};

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

function speakNav(text, distKm, opts) {
  if (!navigating || !text || !voiceEnabled()) return;
  const force = !!(opts && opts.force);
  if (!force && (paused || isStationary())) return;
  if (!force && distKm > 0.16) return;
  const now = Date.now();
  if (!force && text === lastSpoken && now - lastSpokenAt < 22000) return;
  lastSpoken = text;
  lastSpokenAt = now;
  try {
    if (window.HuberaTts && typeof window.HuberaTts.speak === 'function') {
      window.HuberaTts.speak(String(text));
      return;
    }
  } catch {
    /* pont TTS absent */
  }
  if (!('speechSynthesis' in window)) return;
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

function voiceEnabled() {
  return localStorage.getItem(VOICE_KEY) !== '0';
}

function syncVoiceBtn() {
  const b = document.getElementById('btnVoiceNav');
  if (!b) return;
  const on = voiceEnabled();
  b.textContent = on ? '🔊' : '🔇';
  b.title = on ? 'Couper les notifications sonores' : 'Activer les notifications sonores';
  b.setAttribute('aria-label', b.title);
  try {
    if (window.HuberaTts && typeof window.HuberaTts.setMuted === 'function') {
      window.HuberaTts.setMuted(!on);
    }
  } catch {
    /* APK seulement */
  }
}

function setVoiceEnabled(on) {
  localStorage.setItem(VOICE_KEY, on ? '1' : '0');
  if (!on) {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
    try { window.HuberaTts?.stop?.(); } catch { /* ignore */ }
  }
  syncVoiceBtn();
}

function puckIcon(deg) {
  const d = Number.isFinite(deg) ? deg : 0;
  return L.divIcon({
    className: 'me-puck',
    html:
      `<div class="puck-wrap"><div class="puck-halo"></div>` +
      `<div class="puck-inner" style="transform:rotate(${d}deg)">` +
      `<div class="puck-n"></div><div class="puck-c"></div></div></div>`,
    iconSize: [56, 56],
    iconAnchor: [28, 28],
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
      radius: 28, color: '#1a73e8', weight: 0, fillColor: '#1a73e8', fillOpacity: 0.22,
      pane: 'mePane', interactive: false,
    }).addTo(map);
  }
  if (!meMarker) {
    lastPuckHdg = lastHeadingDeg;
    meMarker = L.marker(here, { icon: puckIcon(lastHeadingDeg), pane: 'mePane', keyboard: false, zIndexOffset: 2500 }).addTo(map);
  } else {
    meMarker.setLatLng(here);
    if (lastPuckHdg == null || headingDelta(lastPuckHdg, lastHeadingDeg) >= 10) {
      lastPuckHdg = lastHeadingDeg;
      meMarker.setIcon(puckIcon(lastHeadingDeg));
    }
  }
  maybeRepaintPlacesForMe();
  if (meMarker && moved < 3 && !fly) {
    if (!lastRoadPos || (roadNameEl && roadNameEl.textContent === '—')) void refreshRoad(lat, lon);
    return;
  }
  if (fly) {
    if (navigating && followNav) {
      applyNavCamera(lat, lon, false);
    } else if (document.body.classList.contains('routing') && lastDest) {
      ensureAbMarkers();
      fitRouteBounds();
    } else {
      map.invalidateSize();
      const z = Math.max(16, map.getZoom() || 0);
      map.flyTo(here, z, { duration: 0.35 });
    }
  }
  if (moved >= 40 || !lastRoadPos) void refreshRoad(lat, lon);
}

function goHere() {
  if (me) setMe(me.lat, me.lon, true);
  try {
    const native = locNative();
    native?.startWatch?.();
    const raw = native?.lastFixJson?.();
    if (raw) {
      const p = JSON.parse(raw);
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) {
        setMe(p.lat, p.lon, true);
      }
    }
  } catch {
    /* web */
  }
  if (!navigator.geolocation) {
    if (!me) toast('GPS indisponible.');
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setMe(pos.coords.latitude, pos.coords.longitude, true),
    () => {
      if (me) return;
      const block = typeof locBlock === 'function' ? locBlock() : null;
      if (block === 'perm') toast('Autorise la localisation pour Maps.');
      else if (block === 'gps') toast('Active le GPS pour Maps.');
      else toast('Position pas encore trouvée.');
    },
    geoOpts({ accurate: true, freshMs: 0, timeout: 8000 }),
  );
}

function appendTrace(lat, lon) {
  if (paused) return;
  if (!navigating && !fuelTrip && !mapsStartedFuel) return;
  const last = trace[trace.length - 1];
  if (last) {
    const d = metersBetween({ lat: last[0], lon: last[1] }, { lat, lon });
    if (d < 12) return;
    if (isStationary() && d < 25) return;
  }
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
  try {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=8${bias}`;
    const res = await fetch(url);
    const data = await res.json();
    const out = featuresToHits(data.features || [], q);
    if (out.length) return out;
  } catch {
    /* Nominatim */
  }
  return searchNominatim(q);
}

function featuresToHits(features, q) {
  const seen = new Set();
  const out = [];
  for (const f of features) {
    const [lon, lat] = f.geometry.coordinates;
    const props = f.properties || {};
    const label = [props.name, props.street, props.city || props.state, props.country]
      .filter(Boolean)
      .join(', ');
    const hint = [props.osm_value, props.postcode, props.city || props.state].filter(Boolean).join(' · ');
    const item = {
      label: label || q,
      lat,
      lon,
      hint: hint || '',
      osmId: props.osm_id || '',
      osmType: props.osm_type || '',
      name: props.name || '',
    };
    if (seen.has(item.label)) continue;
    seen.add(item.label);
    out.push(item);
  }
  return out;
}

async function searchNominatim(q) {
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=fr&q=${encodeURIComponent(q)}` +
    (me ? `&lat=${me.lat}&lon=${me.lon}` : '');
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const n of data || []) {
    const lat = Number(n.lat);
    const lon = Number(n.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const label = n.display_name || q;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({
      label,
      lat,
      lon,
      osmId: n.osm_id || '',
      osmType: n.osm_type || '',
      name: n.name || '',
    });
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

function stepStreet(step) {
  return String(step?.name || '').trim();
}

function destShort() {
  return (lastDest?.title || lastDest?.label || 'destination').split(',')[0];
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
  const rank = { eco: 0, fastest: 1, works: 1.5, alternate: 2 };
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
  if (travelMode === 'walk' || travelMode === 'hike') {
    return 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';
  }
  if (travelMode === 'bike') return 'https://routing.openstreetmap.de/routed-bike/route/v1/driving/';
  return 'https://router.project-osrm.org/route/v1/driving/';
}

window.__huberaOsrmReady = function (id, ok) {
  const fn = osrmWait.get(String(id));
  if (!fn) return;
  osrmWait.delete(String(id));
  if (!ok) {
    fn({ ok: false, data: null });
    return;
  }
  try {
    const raw = HuberaRoute.take(String(id));
    fn({ ok: true, data: JSON.parse(raw) });
  } catch {
    fn({ ok: false, data: null });
  }
};

async function osrmPath(points, alternatives, extra = '', signal) {
  const path = points.map((p) => `${p.lon},${p.lat}`).join(';');
  const alt = alternatives <= 0 ? 'false' : String(Math.max(1, Math.min(3, alternatives)));
  const url =
    `${osrmEndpoint()}${path}` +
    `?overview=full&geometries=geojson&alternatives=${alt}&steps=true${extra}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  if (signal) {
    signal.addEventListener('abort', () => ctrl.abort(), { once: true });
  }
  try {
    const res = await fetch(url, { headers: FETCH_HDR, signal: ctrl.signal });
    if (res.ok) return parseOsrm(await res.json());
  } catch (err) {
    if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;
  } finally {
    clearTimeout(timer);
  }
  const from = points[0];
  const to = points[points.length - 1];
  if (typeof HuberaRoute !== 'undefined' && HuberaRoute.osrm && points.length === 2 && !extra) {
    return new Promise((resolve, reject) => {
      const id = String(++osrmReqId);
      const timer = setTimeout(() => {
        if (osrmWait.has(id)) {
          osrmWait.delete(id);
          resolve([]);
        }
      }, 14000);
      osrmWait.set(id, (p) => {
        clearTimeout(timer);
        try {
          resolve(p && p.ok ? parseOsrm(p.data) : []);
        } catch {
          resolve([]);
        }
      });
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          osrmWait.delete(id);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        });
      }
      try {
        HuberaRoute.osrm(String(from.lon), String(from.lat), String(to.lon), String(to.lat), travelMode, id);
      } catch {
        clearTimeout(timer);
        osrmWait.delete(id);
        resolve([]);
      }
    });
  }
  return [];
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

function overpassEndpoints() {
  return [
    'https://overpass-api.de/api/interpreter',
    'https://maps.hubera.cloud/overpass',
    'https://overpass.kumi.systems/api/interpreter',
  ];
}

function overpassLooksJson(raw) {
  const t = String(raw || '')
    .replace(/^\uFEFF/, '')
    .trimStart();
  return t.startsWith('{') || t.startsWith('[');
}

async function overpassPost(endpoint, query, extra) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      Accept: 'application/json',
    },
    body: 'data=' + encodeURIComponent(query),
    ...(extra || {}),
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!overpassLooksJson(text)) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function unionRouteBbox(routes) {
  let s = 90;
  let w = 180;
  let n = -90;
  let e = -180;
  for (const r of routes) {
    for (const c of r.geometry?.coordinates || []) {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
    }
  }
  const pad = 0.012;
  return [s - pad, w - pad, n + pad, e + pad];
}

function geomTouchesWork(geometry, work, maxM) {
  const coords = geometry?.coordinates || [];
  if (!coords.length || !work) return false;
  const step = Math.max(1, Math.floor(coords.length / 90));
  for (let i = 0; i < coords.length; i += step) {
    if (metersBetween({ lat: coords[i][1], lon: coords[i][0] }, work) <= maxM) return true;
  }
  return false;
}

function offsetAroundWork(work, from, to) {
  const dLat = to.lat - from.lat;
  const dLon = to.lon - from.lon;
  const len = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  const off = 0.012;
  return {
    lat: work.lat + (-dLon / len) * off,
    lon: work.lon + (dLat / len) * off,
  };
}

function paintWorks(works) {
  if (worksLayer) {
    map.removeLayer(worksLayer);
    worksLayer = null;
  }
  if (!works || !works.length) return;
  worksLayer = L.layerGroup();
  for (const w of works) {
    L.circleMarker([w.lat, w.lon], {
      radius: 7,
      color: '#fff',
      weight: 2,
      fillColor: '#f59e0b',
      fillOpacity: 0.95,
    })
      .bindTooltip(w.name || 'Travaux', { direction: 'top' })
      .on('click', () => {
        openPoiCard({
          kind: 'works',
          name: w.name || 'Travaux / fermeture',
          lat: w.lat,
          lon: w.lon,
          meta: 'Point orange = travaux OSM autour de toi. Tu peux lancer un itinéraire ou fermer.',
        });
      })
      .addTo(worksLayer);
  }
  worksLayer.addTo(map);
}

async function fetchOsmWorks(bbox, signal) {
  const [s, w, n, e] = bbox;
  const query =
    `[out:json][timeout:12];(` +
    `way["highway"="construction"](${s},${w},${n},${e});` +
    `way["construction"]["highway"](${s},${w},${n},${e});` +
    `way["highway"]["access"~"no|destination"]["construction"](${s},${w},${n},${e});` +
    `node["highway"="construction"](${s},${w},${n},${e});` +
    `way["highway"]["note"~"travaux|déviation|deviation|barrière",i](${s},${w},${n},${e});` +
    `);out center tags 50;`;
  for (const endpoint of overpassEndpoints()) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 13000);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const data = await overpassPost(endpoint, query, { signal: ctrl.signal });
      if (!data) continue;
      const out = [];
      for (const el of data.elements || []) {
        const c = el.center || el;
        const lat = Number(c.lat);
        const lon = Number(c.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const tags = el.tags || {};
        const name =
          tags.name ||
          tags.ref ||
          tags.construction ||
          tags.note ||
          'Travaux / fermeture';
        out.push({ lat, lon, name: String(name).slice(0, 80) });
      }
      return out;
    } catch (err) {
      if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return [];
}

async function enrichRoutesWithWorks(from, to, routes, signal) {
  if (!routes.length) return routes;
  const works = await fetchOsmWorks(unionRouteBbox(routes), signal);
  paintWorks(works);
  if (!works.length) return routes.map((r) => ({ ...r, worksHit: 0 }));
  const onRoute = works.filter((wk) =>
    routes.some((r) => geomTouchesWork(r.geometry, wk, 110)),
  );
  const tagged = routes.map((r) => ({
    ...r,
    worksHit: works.filter((wk) => geomTouchesWork(r.geometry, wk, 110)).length,
  }));
  if (!onRoute.length) return tagged;
  const via = offsetAroundWork(onRoute[0], from, to);
  const detour = await osrmPath([from, via, to], 0, '', signal);
  const d = detour[0];
  if (!d) return tagged;
  if (tagged.some((r) => Math.abs(r.km - d.km) < 0.35 && Math.abs(r.min - d.min) < 2)) {
    return tagged;
  }
  return tagged.concat({
    ...d,
    id: `${d.km.toFixed(1)}:${d.min}:works`,
    kind: 'works',
    label: 'Évite travaux',
    worksHit: 0,
  });
}

async function refreshWorksNearMe(here) {
  const now = Date.now();
  if (now - lastWorksNearAt < 80000) return;
  lastWorksNearAt = now;
  if (!here || !lastDest) return;
  const pad = 0.01;
  let works = [];
  try {
    works = await fetchOsmWorks([here.lat - pad, here.lon - pad, here.lat + pad, here.lon + pad]);
  } catch {
    return;
  }
  paintWorks(works);
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

let trafficCache = null;

function trafficUrlList(kind) {
  const direct =
    kind === 'qtv'
      ? 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/qtvDir.xml'
      : 'https://tipi.bison-fute.gouv.fr/bison-fute-ouvert/publicationsDIR/QTV-DIR/refDir.csv';
  const path = kind === 'qtv' ? '/traffic/qtv' : '/traffic/stations';
  const onFile = typeof location !== 'undefined' && location.protocol === 'file:';
  if (onFile) return [direct, `https://maps.hubera.cloud${path}`];
  return [path, direct];
}

async function fetchTextFirst(urls, signal) {
  for (const url of urls) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });
    try {
      const res = await fetch(url, { headers: { Accept: '*/*' }, signal: ctrl.signal });
      if (!res.ok) continue;
      const text = await res.text();
      if (text && text.length > 80) return text;
    } catch (err) {
      if (err && err.name === 'AbortError' && signal && signal.aborted) throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  return '';
}

async function loadTrafficStations(signal) {
  if (typeof HuberaTraffic === 'undefined') return [];
  const now = Date.now();
  if (trafficCache && now - trafficCache.at < 90000 && trafficCache.stations.length) {
    return trafficCache.stations;
  }
  const [csv, xml] = await Promise.all([
    fetchTextFirst(trafficUrlList('stations'), signal),
    fetchTextFirst(trafficUrlList('qtv'), signal),
  ]);
  if (!csv || !xml) return [];
  const stations = HuberaTraffic.buildTrafficStations(csv, xml);
  if (!stations.length) return [];
  trafficCache = { at: now, stations };
  return stations;
}

async function enrichRoutesWithTraffic(from, to, routes, signal) {
  if (travelMode !== 'car' || !routes || !routes.length) return routes;
  if (typeof HuberaTraffic === 'undefined') return routes;
  let stations = [];
  try {
    stations = await loadTrafficStations(signal);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return routes.map((r) => ({ ...r, trafficStatus: 'unavailable', trafficMeasured: false, trafficDelayMin: 0 }));
  }
  if (!stations.length) {
    return routes.map((r) => ({ ...r, trafficStatus: 'unavailable', trafficMeasured: false, trafficDelayMin: 0 }));
  }
  const tagged = HuberaTraffic.annotateRoutes(routes, stations);
  const base = tagged[0];
  if (!base || !HuberaTraffic.isHeavy(base) || !base.trafficJam) return tagged;
  const via = offsetAroundWork(base.trafficJam, from, to);
  let detour = [];
  try {
    detour = await osrmPath([from, via, to], 0, '', signal);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    return tagged;
  }
  return HuberaTraffic.offerAvoidJam(tagged, detour[0] || null, stations);
}

function trafficNoteHtml() {
  const sel = currentChoice();
  if (!sel || travelMode !== 'car') return '';
  const offered = routeChoices.some((r) => r.kind === 'traffic');
  if (sel.trafficStatus === 'unavailable') {
    return `<p class="works-note">Circulation temps réel indisponible. Le trajet reste celui calculé, sans bouchon inventé.</p>`;
  }
  if (sel.trafficStatus === 'uncovered') {
    return `<p class="works-note">Pas de mesure locale sur ce trajet. Bison Futé couvre le réseau national non concédé, pas les rues ni une zone 30.</p>`;
  }
  if (sel.trafficStatus === 'clear') {
    return `<p class="works-note">Circulation fluide là où Bison Futé mesure le trajet. Les rues n’ont pas de mesure locale.</p>`;
  }
  if ((sel.trafficDelayMin || 0) < 1 && sel.trafficStatus !== 'slow') return '';
  let text = 'Circulation temps réel (Bison Futé, réseau national).';
  if (sel.freeMin != null) {
    text += ` Habituel ${sel.freeMin} min, actuellement ${sel.min} min.`;
  }
  if (offered) {
    text += ' « Évite le bouchon » est proposé : tu le choisis, il n’est pas lancé à ta place.';
  }
  return `<p class="works-note">${text}</p>`;
}

function clearDetourOffer() {
  offeredDetour = null;
  const el = document.getElementById('detourOffer');
  if (el) el.hidden = true;
}

function showDetourOffer(gain) {
  const el = document.getElementById('detourOffer');
  const t = document.getElementById('detourOfferText');
  if (!el) return;
  const mins = Math.max(1, Math.round(Number(gain) || 0));
  if (t) {
    t.textContent = `Circulation Bison Futé : une autre route gagne ${mins} min. Elle n’est pas prise toute seule.`;
  }
  el.hidden = false;
}

function trafficOfferFrom(routes) {
  if (typeof HuberaTraffic === 'undefined' || !routes || !routes.length) return null;
  const alt = routes.find((r) => r && r.kind === 'traffic');
  if (!alt) return null;
  const base =
    routes.find((r) => r && r.id === selectedRouteId && r.kind !== 'traffic') ||
    routes.find((r) => r && r.kind !== 'traffic' && HuberaTraffic.isHeavy(r));
  if (!base || !HuberaTraffic.isHeavy(base)) return null;
  const gain = Math.round((base.min || 0) - (alt.min || 0));
  if (gain < HuberaTraffic.ALT_GAIN_MIN) return null;
  if ((base.trafficDelayMin || 0) < HuberaTraffic.HEAVY_DELAY_MIN) return null;
  return { alt, base, gain };
}

function maybeShowTrafficOffer(routes) {
  const offer = trafficOfferFrom(routes);
  if (!offer) {
    clearDetourOffer();
    return;
  }
  if (ignoredDetourKey === offer.alt.id || selectedRouteId === offer.alt.id) {
    clearDetourOffer();
    return;
  }
  offeredDetour = offer.alt;
  showDetourOffer(offer.gain);
}

function ignoreDetourOffer() {
  if (offeredDetour) ignoredDetourKey = offeredDetour.id;
  clearDetourOffer();
}

function takeDetourOffer() {
  const alt = offeredDetour;
  if (!alt) return;
  const rest = routeChoices.filter((r) => r.id !== alt.id);
  if (!rest.some((r) => r.id === alt.id)) rest.push(alt);
  routeChoices = rest;
  selectedRouteId = alt.id;
  drawChoices(alt.id);
  clearDetourOffer();
  if (navigating) paintHud(currentChoice());
  else renderAlts();
  toast('Nouvelle route prise');
}

async function refreshTrafficLive(here) {
  if (!navigating || travelMode !== 'car' || !here || !placeHasPoint(lastDest)) return;
  if (typeof HuberaTraffic === 'undefined') return;
  const now = Date.now();
  const wait = detourPollAt ? 45000 : 8000;
  if (now - detourPollAt < wait) return;
  detourPollAt = now;
  const choice = currentChoice();
  if (!choice || !choice.geometry) return;
  let stations = [];
  try {
    stations = await loadTrafficStations();
  } catch {
    return;
  }
  if (!stations.length) {
    clearDetourOffer();
    return;
  }
  const tagged = HuberaTraffic.annotateRoutes([choice], stations);
  const base = tagged[0];
  if (!base) return;
  const keptId = choice.id;
  const i = routeChoices.findIndex((r) => r.id === keptId);
  if (i >= 0) {
    routeChoices[i] = {
      ...routeChoices[i],
      ...base,
      id: keptId,
      kind: choice.kind,
      label: choice.label,
    };
  }
  if (!HuberaTraffic.isHeavy(base) || !base.trafficJam) {
    clearDetourOffer();
    paintHud(currentChoice());
    return;
  }
  const via = offsetAroundWork(base.trafficJam, here, lastDest);
  let detour = [];
  try {
    detour = await osrmPath([here, via, lastDest], 0, '');
  } catch {
    return;
  }
  const offered = HuberaTraffic.offerAvoidJam([base], detour[0] || null, stations);
  const alt = offered.find((r) => r && r.kind === 'traffic');
  if (!alt) {
    clearDetourOffer();
    paintHud(currentChoice());
    return;
  }
  const gain = Math.round((base.min || 0) - (alt.min || 0));
  if (gain < HuberaTraffic.ALT_GAIN_MIN || (base.trafficDelayMin || 0) < HuberaTraffic.HEAVY_DELAY_MIN) {
    clearDetourOffer();
    paintHud(currentChoice());
    return;
  }
  if (ignoredDetourKey === alt.id || selectedRouteId === alt.id) {
    clearDetourOffer();
    paintHud(currentChoice());
    return;
  }
  const without = routeChoices.filter((r) => r.kind !== 'traffic' && r.id !== alt.id);
  routeChoices = without.concat(alt);
  if (!routeChoices.some((r) => r.id === keptId)) selectedRouteId = keptId;
  offeredDetour = alt;
  showDetourOffer(gain);
  drawChoices(selectedRouteId);
  paintHud(currentChoice());
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
  const ordered = routeChoices.slice().sort((a, b) => (a.id === selectedId) - (b.id === selectedId));
  for (const r of ordered) {
    const on = r.id === selectedId;
    const ink = HuberaHud.routeLineStyle(on);
    const layer = L.geoJSON(r.geometry, {
      style: {
        color: on ? '#e94560' : '#64748b',
        weight: ink.weight,
        opacity: ink.opacity,
      },
    }).addTo(map);
    layer.on('click', () => selectRoute(r.id));
    altLayers.push(layer);
    if (on) routeLayer = layer;
    for (const span of r.trafficSpans || []) {
      if (!span || span.length < 2) continue;
      const jamInk = HuberaHud.routeJamStyle(on);
      const jam = L.polyline(
        span.map((c) => [c[1], c[0]]),
        { color: '#f59e0b', weight: jamInk.weight, opacity: jamInk.opacity, lineCap: 'round' },
      ).addTo(map);
      jam.on('click', () => selectRoute(r.id));
      altLayers.push(jam);
    }
    const b = layer.getBounds();
    bounds = bounds ? bounds.extend(b) : b;
  }
  if (me) {
    const origin = lastOrigin && Number.isFinite(lastOrigin.lat) ? lastOrigin : me;
    const oTitle = pinTitle(lastOrigin) || pinTitle(origin) || '';
    if (!originMarker) originMarker = L.marker([origin.lat, origin.lon], { icon: endpointIcon('origin', oTitle), zIndexOffset: 700 }).addTo(map);
    else {
      originMarker.setLatLng([origin.lat, origin.lon]);
      originMarker.setIcon(endpointIcon('origin', oTitle));
    }
    if (bounds) bounds.extend([origin.lat, origin.lon]);
  }
  if (lastDest && Number.isFinite(lastDest.lat)) {
    const dTitle = pinTitle(lastDest);
    if (!destMarker) destMarker = L.marker([lastDest.lat, lastDest.lon], { icon: endpointIcon('dest', dTitle), zIndexOffset: 720 }).addTo(map);
    else {
      destMarker.setLatLng([lastDest.lat, lastDest.lon]);
      destMarker.setIcon(endpointIcon('dest', dTitle));
    }
    if (bounds) bounds.extend([lastDest.lat, lastDest.lon]);
    else bounds = L.latLngBounds([lastDest.lat, lastDest.lon], me ? [me.lat, me.lon] : [lastDest.lat, lastDest.lon]);
  }
  ensureAbMarkers();
  fitRouteBounds();
}

function overlayEdgePad(el, side) {
  if (!el || el.hidden) return 0;
  const st = getComputedStyle(el);
  if (st.display === 'none' || st.visibility === 'hidden') return 0;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return 0;
  const vh = window.innerHeight || 1;
  const vw = window.innerWidth || 1;
  if (side === 'top') return Math.max(0, Math.ceil(r.bottom));
  if (side === 'bottom') return Math.max(0, Math.ceil(vh - r.top));
  if (side === 'right') return Math.max(0, Math.ceil(vw - r.left));
  if (side === 'left') return Math.max(0, Math.ceil(r.right));
  return 0;
}

function routeFitPadding() {
  try {
    map.invalidateSize({ animate: false });
  } catch {
    /* */
  }
  const size = map.getSize ? map.getSize() : { x: window.innerWidth || 360, y: window.innerHeight || 640 };
  const mw = Math.max(160, size.x || window.innerWidth || 360);
  const mh = Math.max(240, size.y || window.innerHeight || 640);
  const gap = 22;
  let top =
    Math.max(
      overlayEdgePad(document.getElementById('topChrome'), 'top'),
      overlayEdgePad(document.getElementById('routeCard'), 'top'),
      overlayEdgePad(document.getElementById('alts'), 'top'),
    ) + gap;
  let bottom =
    Math.max(
      overlayEdgePad(document.getElementById('chrome'), 'bottom'),
      overlayEdgePad(document.getElementById('fuelPeek'), 'bottom'),
      overlayEdgePad(document.getElementById('fuel'), 'bottom'),
    ) + gap;
  let right =
    Math.max(
      overlayEdgePad(document.getElementById('btnHere'), 'right'),
      overlayEdgePad(document.querySelector('.road-sign'), 'right'),
      overlayEdgePad(document.getElementById('tripInfoMenu'), 'right'),
    ) + gap;
  let left = 22;
  const minH = 260;
  const minW = 180;
  if (top + bottom > mh - minH) {
    const overflow = top + bottom - (mh - minH);
    const sum = Math.max(1, top + bottom);
    top = Math.max(72, Math.floor(top - (overflow * top) / sum));
    bottom = Math.max(56, Math.floor(bottom - (overflow * bottom) / sum));
  }
  if (left + right > mw - minW) {
    right = Math.max(16, mw - minW - left);
  }
  /* Leaflet Point = (x, y) = (horizontal, vertical), pas [top, left] CSS. */
  return {
    paddingTopLeft: [left, top],
    paddingBottomRight: [right, bottom],
  };
}

function ensureAbMarkers() {
  const origin = lastOrigin && Number.isFinite(lastOrigin.lat) ? lastOrigin : me;
  if (origin && Number.isFinite(origin.lat)) {
    const title = pinTitle(lastOrigin) || pinTitle(origin) || '';
    if (!originMarker) originMarker = L.marker([origin.lat, origin.lon], { icon: endpointIcon('origin', title), zIndexOffset: 700 }).addTo(map);
    else {
      originMarker.setLatLng([origin.lat, origin.lon]);
      originMarker.setIcon(endpointIcon('origin', title));
    }
  }
  if (lastDest && Number.isFinite(lastDest.lat)) {
    const dTitle = pinTitle(lastDest);
    if (!destMarker) destMarker = L.marker([lastDest.lat, lastDest.lon], { icon: endpointIcon('dest', dTitle), zIndexOffset: 720 }).addTo(map);
    else {
      destMarker.setLatLng([lastDest.lat, lastDest.lon]);
      destMarker.setIcon(endpointIcon('dest', dTitle));
    }
  }
}

function abRouteBounds() {
  let bounds = null;
  const add = (lat, lon) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const ll = L.latLng(lat, lon);
    bounds = bounds ? bounds.extend(ll) : L.latLngBounds(ll, ll);
  };
  if (lastOrigin) add(lastOrigin.lat, lastOrigin.lon);
  else if (me) add(me.lat, me.lon);
  if (lastDest) add(lastDest.lat, lastDest.lon);
  try {
    if (originMarker) add(originMarker.getLatLng().lat, originMarker.getLatLng().lng);
  } catch {
    /* */
  }
  try {
    if (destMarker) add(destMarker.getLatLng().lat, destMarker.getLatLng().lng);
  } catch {
    /* */
  }
  return bounds && bounds.isValid && bounds.isValid() ? bounds : null;
}

function fitRouteBounds() {
  const raw = abRouteBounds();
  if (!raw) return;
  const run = () => {
    try {
      map.invalidateSize({ animate: false });
      const pad = routeFitPadding();
      const sw = raw.getSouthWest();
      const ne = raw.getNorthEast();
      const same = Math.abs(sw.lat - ne.lat) < 1e-5 && Math.abs(sw.lng - ne.lng) < 1e-5;
      if (same) {
        map.setView(raw.getCenter(), 13, { animate: false });
        return;
      }
      let b = raw;
      try {
        b = raw.pad(0.18);
      } catch {
        /* leaflet pad */
      }
      map.fitBounds(b, { ...pad, maxZoom: 14, animate: false });
      const vis = map.getBounds();
      const hidden =
        (me && !vis.contains([me.lat, me.lon])) ||
        (lastDest && !vis.contains([lastDest.lat, lastDest.lon]));
      if (hidden) {
        map.fitBounds(b, { padding: [36, 36], maxZoom: 14, animate: false });
      }
    } catch {
      /* ignore */
    }
  };
  run();
  requestAnimationFrame(run);
  window.setTimeout(run, 80);
  window.setTimeout(run, 280);
  window.setTimeout(run, 700);
}

function modeLabel() {
  return {
    car: 'Voiture',
    walk: 'À pied',
    hike: 'Randonnée',
    bike: 'Vélo',
    transit: 'Transports',
  }[travelMode] || 'Voiture';
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

function endEditText(p, fallback) {
  if (!p) return fallback;
  if (p._typed != null && String(p._typed).length) return String(p._typed);
  const label = String(p.label || '').trim();
  if (label) return label;
  const title = String(p.title || '').trim();
  const addr = String(p.address || '').trim();
  if (title && addr && addr !== title) return `${title}, ${addr}`;
  return title || addr || fallback;
}

function endSnap() {
  const el = document.activeElement;
  if (!el || !el.classList || !el.classList.contains('route-end-input')) return null;
  return {
    end: el.dataset.end,
    value: el.value,
    start: el.selectionStart,
    endSel: el.selectionEnd,
  };
}

function restoreEndSnap(snap) {
  if (!snap || !routeCardEl) return;
  const el = routeCardEl.querySelector(`.route-end-input[data-end="${snap.end}"]`);
  if (!el) return;
  el.value = snap.value;
  try {
    el.focus({ preventScroll: true });
  } catch {
    try { el.focus(); } catch { /* */ }
  }
  try {
    const a = Number.isFinite(snap.start) ? snap.start : el.value.length;
    const b = Number.isFinite(snap.endSel) ? snap.endSel : a;
    el.setSelectionRange(a, b);
  } catch {
    /* curseur */
  }
}

function endsRowHtml() {
  const oText = endEditText(lastOrigin, 'Ma position');
  const dText = endEditText(lastDest, 'Arrivée');
  return (
    `<div class="route-io">` +
    `<div class="route-io-fields">` +
    `<label class="route-end">` +
    `<span class="ab-dot origin"></span>` +
    `<input type="text" class="route-end-input" data-end="origin" value="${esc(oText)}" autocomplete="off" enterkeyhint="done" aria-label="Départ" />` +
    `</label>` +
    `<label class="route-end">` +
    `<span class="ab-dot dest"></span>` +
    `<input type="text" class="route-end-input" data-end="dest" value="${esc(dText)}" autocomplete="off" enterkeyhint="done" aria-label="Arrivée" />` +
    `</label>` +
    `</div>` +
    `<div class="route-io-side">` +
    `<button type="button" class="route-close" id="btnDismissRoute" aria-label="Fermer l’itinéraire">✕</button>` +
    `<button type="button" class="route-swap" id="btnSwapEnds" title="Inverser" aria-label="Inverser départ et arrivée">⇅</button>` +
    `</div></div>`
  );
}

function showAltsShell(extraHtml) {
  const snap = endSnap();
  const html = endsRowHtml() + modesRowHtml() + (extraHtml || '');
  if (routeCardEl) {
    routeCardEl.hidden = false;
    routeCardEl.innerHTML = html;
    bindModeButtons(routeCardEl);
    restoreEndSnap(snap);
    const close = routeCardEl.querySelector('#btnDismissRoute');
    if (close) {
      close.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        dismissRoutePreview();
      };
    }
  }
  if (altsEl) {
    altsEl.hidden = true;
    altsEl.innerHTML = '';
  }
  if (chipsEl) chipsEl.hidden = true;
  if (pendingEnd) searchForm.hidden = false;
  else searchForm.hidden = true;
  document.body.classList.add('routing');
  bindRouteCard();
  ensureAbMarkers();
  fitRouteBounds();
  paintPlacePins();
}

function dismissRoutePreview() {
  endEditGen += 1;
  routeGen += 1;
  if (routeAbort) {
    try {
      routeAbort.abort();
    } catch {
      /* ignore */
    }
  }
  routeChoices = [];
  selectedRouteId = null;
  lastDest = null;
  lastOrigin = null;
  pendingEnd = null;
  showHits([]);
  qEl.placeholder = 'Rechercher ici';
  searchForm.hidden = false;
  if (routeCardEl) {
    routeCardEl.hidden = true;
    routeCardEl.innerHTML = '';
  }
  if (altsEl) {
    altsEl.hidden = true;
    altsEl.innerHTML = '';
  }
  clearRoute();
  if (chipsEl) chipsEl.hidden = false;
  document.body.classList.remove('routing');
  clearDetourOffer();
  tripInfoOpen = false;
  tripInfoUserClosed = false;
  paintTripInfoMenu();
  if (originMarker) {
    map.removeLayer(originMarker);
    originMarker = null;
  }
}

function setTravelMode(mode) {
  if (!mode || mode === travelMode) return;
  travelMode = mode;
  localStorage.setItem(MODE_KEY, mode);
  paintModes();
  if (navigating) return;
  if (lastDest && lastOrigin) void routeFromTo(lastOrigin, lastDest);
  else if (lastDest) void routeTo(lastDest.lat, lastDest.lon, lastDest.label);
}

function bindRouteCard() {
  if (!routeCardEl || routeCardEl.dataset.bound === '1') return;
  routeCardEl.dataset.bound = '1';
  const onDismiss = (e) => {
    if (!e.target.closest('.route-close') && !e.target.closest('#btnDismissRoute')) return;
    e.preventDefault();
    e.stopPropagation();
    dismissRoutePreview();
  };
  routeCardEl.addEventListener('click', onDismiss, true);
  routeCardEl.addEventListener('pointerup', onDismiss, true);
  routeCardEl.addEventListener('input', (e) => {
    const input = e.target.closest && e.target.closest('.route-end-input');
    if (!input) return;
    const place = input.dataset.end === 'origin' ? lastOrigin : lastDest;
    if (place) place._typed = input.value;
    scheduleEndEdit(input);
  });
  routeCardEl.addEventListener('keydown', (e) => {
    const input = e.target.closest && e.target.closest('.route-end-input');
    if (!input || e.key !== 'Enter') return;
    e.preventDefault();
    const gen = ++endEditGen;
    void commitEndEdit(input.dataset.end === 'origin' ? 'origin' : 'dest', input.value, gen);
  });
  routeCardEl.addEventListener('click', (e) => {
    if (e.target.closest('.route-end-input')) return;
    if (e.target.closest('.route-close') || e.target.closest('#btnDismissRoute')) {
      e.preventDefault();
      dismissRoutePreview();
      return;
    }
    if (e.target.closest('#btnSwapEnds')) {
      e.preventDefault();
      void swapRouteEnds();
      return;
    }
    const mode = e.target.closest('.mode');
    if (mode) {
      setTravelMode(mode.dataset.mode);
      return;
    }
    const alt = e.target.closest('.alt');
    if (alt && alt.dataset.id) {
      selectRoute(alt.dataset.id);
      return;
    }
    if (e.target.closest('#btnSaveTripDate')) {
      e.preventDefault();
      saveTripAtDate();
      return;
    }
    if (e.target.closest('#btnStartNav') || e.target.closest('.go')) {
      e.preventDefault();
      startNavigation();
    }
  });
}

function placeHasPoint(p) {
  return p && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lon));
}

function scheduleEndEdit(input) {
  const gen = ++endEditGen;
  const which = input.dataset.end === 'origin' ? 'origin' : 'dest';
  clearTimeout(scheduleEndEdit._t);
  scheduleEndEdit._t = setTimeout(() => {
    void commitEndEdit(which, input.value, gen);
  }, 480);
}

async function commitEndEdit(which, raw, gen) {
  const q = String(raw || '').trim();
  if (q.length < 2 || gen !== endEditGen) return;
  let hits = [];
  try {
    hits = await searchPhoton(q);
  } catch {
    return;
  }
  if (gen !== endEditGen || !hits[0] || !Number.isFinite(Number(hits[0].lat))) return;
  const place = await enrichPlace(asPlace(hits[0].lat, hits[0].lon, hits[0].label || q));
  if (gen !== endEditGen || !placeHasPoint(place)) return;
  place._typed = q;
  if (which === 'origin') lastOrigin = place;
  else lastDest = place;
  if (!placeHasPoint(lastOrigin)) lastOrigin = await hereAsPlace();
  if (!placeHasPoint(lastDest)) return;
  await routeFromTo(lastOrigin, lastDest);
}

function startEditEnd(which) {
  pendingEnd = which === 'origin' ? 'origin' : 'dest';
  const cur = pendingEnd === 'origin' ? lastOrigin : lastDest;
  qEl.value = endEditText(cur, '');
  qEl.placeholder = pendingEnd === 'origin' ? 'Modifier le départ' : 'Modifier l’arrivée';
  searchForm.hidden = false;
  syncClear();
  try {
    qEl.focus({ preventScroll: true });
    const n = qEl.value.length;
    if (n > 0) qEl.setSelectionRange(n, n);
  } catch {
    /* */
  }
}

async function pickRoutePlace(item) {
  const place = await enrichPlace(asPlace(item.lat, item.lon, item.label));
  const end = pendingEnd;
  pendingEnd = null;
  qEl.placeholder = 'Rechercher ici';
  qEl.value = '';
  searchForm.hidden = true;
  syncClear();
  if (end === 'origin') lastOrigin = place;
  else lastDest = place;
  if (!placeHasPoint(lastOrigin)) lastOrigin = await hereAsPlace();
  if (!placeHasPoint(lastDest)) return;
  await routeFromTo(lastOrigin, lastDest);
}

async function swapRouteEnds() {
  pendingEnd = null;
  qEl.placeholder = 'Rechercher ici';
  qEl.value = '';
  searchForm.hidden = true;
  if (!placeHasPoint(lastDest)) return;
  if (!placeHasPoint(lastOrigin)) lastOrigin = await hereAsPlace();
  if (!placeHasPoint(lastOrigin) || !placeHasPoint(lastDest)) return;
  const a = lastOrigin;
  const b = lastDest;
  lastOrigin = b;
  lastDest = a;
  await routeFromTo(lastOrigin, lastDest);
}

function renderAlts() {
  bindRouteCard();
  if (!routeChoices.length) {
    if (altsEl) {
      altsEl.hidden = true;
      altsEl.innerHTML = '';
    }
    if (routeCardEl) {
      routeCardEl.hidden = true;
      routeCardEl.innerHTML = '';
    }
    return;
  }
  const dest = lastDest?.title || lastDest?.label || 'Destination';
  const worksN = routeChoices.reduce((m, r) => Math.max(m, Number(r.worksHit) || 0), 0);
  const worksNote = worksN
    ? `<p class="works-note">Travaux / déviations OSM : ${worksN} sur le trajet. Un itinéraire « Évite travaux » est proposé quand c’est possible.</p>`
    : '';
  showAltsShell(
    `<div class="route-picks-label">Itinéraires</div><div class="picks">` +
      routeChoices
        .map((r) => {
          const delay = (r.trafficDelayMin || 0) >= 1 ? ` · +${r.trafficDelayMin} min` : '';
          return (
            `<button type="button" class="alt${r.id === selectedRouteId ? ' on' : ''}" data-id="${r.id}">` +
            `<div class="k">${esc(r.label)}</div>` +
            `<div class="t">${r.min} min</div>` +
            `<div class="d">${r.km} km${delay}</div></button>`
          );
        })
        .join('') +
      `</div>${worksNote}${trafficNoteHtml()}` +
      `<label class="cal-when">Enregistrer à une date` +
      `<input type="datetime-local" id="tripCalWhen" value="${esc(defaultTripWhen())}" /></label>` +
      `<button type="button" class="go cal" id="btnSaveTripDate">Enregistrer dans Calendar</button>` +
      `<button type="button" class="go" id="btnStartNav">Démarrer</button>`,
  );
}

function defaultTripWhen() {
  const d = new Date(Date.now() + 15 * 60 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function persistPlannedTrip(row) {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem(PLANNED_TRIPS_KEY) || '[]');
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) rows = [];
  rows.unshift(row);
  try {
    localStorage.setItem(PLANNED_TRIPS_KEY, JSON.stringify(rows.slice(0, 24)));
  } catch {
    /* quota */
  }
}

function saveTripAtDate() {
  const whenEl = document.getElementById('tripCalWhen');
  const raw = whenEl && whenEl.value;
  if (!raw) {
    toast('Choisis une date');
    return;
  }
  const start = new Date(raw).getTime();
  if (!Number.isFinite(start)) {
    toast('Date invalide');
    return;
  }
  const choice = currentChoice();
  const mins = Number(choice && choice.min) || 30;
  const end = start + mins * 60 * 1000;
  const origin = (lastOrigin && (lastOrigin.title || lastOrigin.label)) || 'Départ';
  const dest = (lastDest && (lastDest.title || lastDest.label)) || 'Arrivée';
  const title = `${origin} → ${dest}`;
  const loc = (lastDest && lastDest.label) || dest;
  persistPlannedTrip({
    title,
    location: loc,
    start,
    end,
    at: Date.now(),
  });
  try {
    const tripId = `planned-${start}`;
    if (typeof HuberaCalendar !== 'undefined' && HuberaCalendar.saveTripWithId) {
      HuberaCalendar.saveTripWithId(title, loc, String(start), String(end), tripId);
      return;
    }
    if (typeof HuberaCalendar !== 'undefined' && HuberaCalendar.saveTrip) {
      HuberaCalendar.saveTrip(title, loc, String(start), String(end));
      return;
    }
  } catch {
    /* native absent */
  }
  const u = new URL('https://calendar.hubera.cloud/app/');
  u.searchParams.set('from', 'maps');
  u.searchParams.set('trip_id', `planned-${start}`);
  u.searchParams.set('title', title);
  u.searchParams.set('location', loc);
  u.searchParams.set('start', new Date(start).toISOString());
  u.searchParams.set('end', new Date(end).toISOString());
  persistPlannedTrip({ title, location: loc, start, end, url: u.toString(), at: Date.now() });
  window.location.href = u.toString();
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
  const shown = displaySpeedKmh();
  const still = navigating && isStationary();
  const remainTxt = remainKm < 1 ? fmtDist(remainKm) : `${remainKm.toFixed(1)} km`;
  const eta = choice ? `reste ${remainTxt} · ${etaMin} min` : '';
  const freeFuel = navigating && mapsStartedFuel && !choice;
  if (freeFuel) {
    tickFuelDriveClock();
    const km = liveFuelKm();
    const dur = fuelDriveMs ? fmtFuelMins(fuelDriveMs) : '0 min';
    if (distEl) distEl.textContent = km > 0.05 ? `${km.toFixed(1)} km` : '0 km';
    if (iconEl) iconEl.textContent = still ? '⏸' : '⬆';
    if (titleEl) titleEl.textContent = paused ? 'En pause' : still ? 'À l\'arrêt' : 'Tout droit';
    if (subEl) subEl.textContent = '';
    if (thenEl) {
      thenEl.hidden = true;
      thenEl.textContent = '';
    }
    if (metaEl) metaEl.textContent = still ? `${dur} · à l'arrêt` : `${dur} · ${shown} km/h`;
    const speedEl = document.getElementById('hudSpeed');
    const speedVal = document.getElementById('hudSpeedVal');
    if (speedEl) speedEl.hidden = false;
    if (speedVal) speedVal.textContent = String(shown);
    paintFuelStats();
    return;
  }
  if (distEl) distEl.textContent = step ? fmtDist(toManeuver) : '—';
  if (iconEl) iconEl.textContent = still ? '⏸' : maneuverIcon(step?.maneuver?.type, step?.maneuver?.modifier);
  if (titleEl) {
    if (still) {
      titleEl.textContent = paused ? 'En pause' : 'À l\'arrêt';
    } else {
      const street = stepStreet(step);
      titleEl.textContent = street || (step ? fmtStep(step) : 'Guidage');
    }
  }
  if (subEl) subEl.textContent = still && step ? fmtStep(step) : '';
  if (thenEl) {
    if (!still && then && (then.maneuver?.type || '') !== 'arrive') {
      const thenName = stepStreet(then) || fmtStep(then);
      const ic = maneuverIcon(then.maneuver?.type, then.maneuver?.modifier);
      thenEl.hidden = false;
      thenEl.innerHTML = `<span class="then-k">Puis</span>${ic} ${esc(thenName)}`;
    } else {
      thenEl.hidden = true;
      thenEl.textContent = '';
    }
  }
  if (metaEl) {
    let line = eta ? `vers ${short} · ${eta}` : `vers ${short}`;
    if (choice && (choice.trafficDelayMin || 0) >= 1 && choice.freeMin != null) {
      line += ` · habituel ${choice.freeMin} min, trafic ${choice.min} min`;
    } else if (choice && choice.trafficStatus === 'uncovered') {
      line += ' · pas de mesure locale';
    }
    metaEl.textContent = line;
  }
  const speedEl = document.getElementById('hudSpeed');
  const speedVal = document.getElementById('hudSpeedVal');
  if (speedEl) speedEl.hidden = !navigating;
  if (speedVal) speedVal.textContent = String(shown);
  if (step && navigating && !still) speakNav(fmtStep(step), toManeuver);
  if (navigating && remainKm < 0.05 && !still) {
    speakNav('Vous êtes arrivé', 0);
  }
  paintTripInfoMenu();
}

function isFreeFollow() {
  return navigating && !currentChoice();
}

function liveFuelHud() {
  const veh = activeFuelVehicle();
  if (!veh) return null;
  const tank = Number(veh.tank) || 0;
  const l100base = Number(veh.l100) > 0 ? Number(veh.l100) : 0;
  const l100 = l100base > 0 ? l100base * comfortFactor(dashPrefs()) : 0;
  let liters =
    veh.liters != null && Number(veh.liters) >= 0
      ? Number(veh.liters)
      : tank > 0 && veh.pct >= 0
        ? (veh.pct / 100) * tank
        : null;
  if (liters != null && mapsStartedFuel && l100 > 0) {
    const km = liveFuelKm();
    if (km > 0.05) liters = Math.max(0, liters - (km * l100) / 100);
  }
  const pct =
    liters != null && tank > 0
      ? Math.max(0, Math.min(100, Math.round((liters / tank) * 100)))
      : veh.pct >= 0
        ? veh.pct
        : null;
  const rangeKm = liters != null && l100 > 0 ? (liters / l100) * 100 : null;
  return { veh, tank, l100, liters, pct, rangeKm };
}

function tripPlanning() {
  return !!(lastDest && (routeChoices.length || lastOrigin));
}

function paintTripInfoMenu() {
  const wrap = document.getElementById('tripInfoMenu');
  const panel = document.getElementById('tripInfoPanel');
  const tog = document.getElementById('tripInfoToggle');
  if (!wrap || !panel) return;
  const planning = tripPlanning();
  const show = navigating || planning;
  wrap.hidden = !show;
  if (!show) {
    tripInfoOpen = false;
    panel.hidden = true;
    if (tog) tog.setAttribute('aria-expanded', 'false');
    return;
  }
  if (navigating) tripInfoOpen = !fuelCardCollapsed;
  else tripInfoOpen = !tripInfoUserClosed;
  if (tog) {
    tog.textContent = tripInfoOpen ? '▴' : '▾';
    tog.setAttribute('aria-expanded', tripInfoOpen ? 'true' : 'false');
    if (navigating) {
      const lab = tripInfoOpen ? 'Replier la carte Fuel' : 'Déplier la carte Fuel';
      tog.title = lab;
      tog.setAttribute('aria-label', lab);
    }
  }
  panel.hidden = !tripInfoOpen;
  if (!tripInfoOpen) return;
  const fuel = liveFuelHud();
  const choice = currentChoice();
  const free = isFreeFollow();
  const here = me;
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
  const pctLab = fuel && fuel.pct != null ? `${fuel.pct} %` : '—';
  const Llab =
    fuel && fuel.liters != null ? `${fuel.liters.toFixed(1)} L` : '';
  const rangeLab =
    fuel && fuel.rangeKm != null && fuel.rangeKm > 0 ? `~${Math.round(fuel.rangeKm)} km` : '';
  const fillW = fuel && fuel.pct != null ? fuel.pct : 0;
  let rows = '';
  if (lastOrigin || lastDest) {
    const from = pinTitle(lastOrigin) || (lastOrigin && lastOrigin.fromHere ? 'Ma position' : 'Départ');
    const to = pinTitle(lastDest) || 'Destination';
    rows +=
      `<div class="ti-k">Itinéraire</div>` +
      `<div class="ti-v">${esc(from)} → ${esc(to)}</div>`;
    if (choice && Number.isFinite(choice.km)) {
      rows +=
        `<div class="ti-k">Trajet</div>` +
        `<div class="ti-v">${choice.km.toFixed(1)} km · ${Math.round(choice.min || 0)} min</div>`;
    }
  }
  rows +=
    `<div class="ti-k">Jauge Fuel</div>` +
    `<div class="ti-v">${esc(fuel ? fuel.veh.name : '—')} · ${esc(pctLab)}${Llab ? ` · ${esc(Llab)}` : ''}</div>` +
    `<div class="ti-bar"><i style="width:${fillW}%"></i></div>`;
  if (!free && choice) {
    const remainTxt = remainKm < 1 ? fmtDist(remainKm) : `${remainKm.toFixed(1)} km`;
    rows +=
      `<div class="ti-k">Reste trajet</div>` +
      `<div class="ti-v">${esc(remainTxt)} · ${etaMin} min</div>`;
    if (fuel && fuel.l100 > 0) {
      const need = (remainKm * fuel.l100) / 100;
      rows +=
        `<div class="ti-k">Plein / conso</div>` +
        `<div class="ti-v">~${need.toFixed(1)} L · ${fuel.l100.toFixed(1)} L/100` +
        (rangeLab ? ` · ${esc(rangeLab)} d’auto` : '') +
        `</div>`;
    }
  } else if (fuel && (fuel.l100 > 0 || rangeLab)) {
    rows +=
      `<div class="ti-k">Conso / autonomie</div>` +
      `<div class="ti-v">${fuel.l100 > 0 ? `${fuel.l100.toFixed(1)} L/100` : ''}` +
      (rangeLab ? `${fuel.l100 > 0 ? ' · ' : ''}${esc(rangeLab)}` : '') +
      `</div>`;
  }
  panel.innerHTML =
    rows +
    `<div class="ti-k">Habitacle</div>` +
    dashControlsHtml();
  bindDashControls(panel);
}

function toggleFuelCard() {
  const next = HuberaHud.foldFuelCard({
    fuelCardCollapsed,
    navigating,
    mapsStartedFuel,
    fuelTrip,
  });
  fuelCardCollapsed = next.fuelCardCollapsed;
  if (navigating) tripInfoOpen = !fuelCardCollapsed;
  syncFuelChrome();
  paintTripInfoMenu();
}

function toggleTripInfo() {
  if (!navigating && !tripPlanning()) return;
  if (navigating) {
    toggleFuelCard();
    return;
  }
  tripInfoOpen = !tripInfoOpen;
  tripInfoUserClosed = !tripInfoOpen;
  if (tripInfoOpen) requestFuelSnapshot(false);
  paintTripInfoMenu();
}

function fuelLogoOn() {
  return localStorage.getItem(FUEL_LOGO_KEY) !== '0';
}

function setFuelLogo(on) {
  localStorage.setItem(FUEL_LOGO_KEY, on ? '1' : '0');
  syncFuelChrome();
}

function syncFuelChrome() {
  const live = !!(mapsStartedFuel || Number(fuelTrip) > 0);
  const logo = fuelLogoOn();
  document.body.classList.toggle('fuel-logo', logo);
  document.body.classList.toggle('fuel-live', live);
  document.body.classList.toggle('fuel-card-collapsed', fuelCardCollapsed);
  const fab = document.getElementById('fuelFab');
  const radial = document.getElementById('fuelRadial');
  const handle = document.getElementById('fuelCardHandle');
  const foldBtns = ['fuelCardFold', 'fuelPageFold'].map((id) => document.getElementById(id));
  if (logo) {
    fuelEl.hidden = true;
    if (fab) {
      fab.hidden = false;
      fab.classList.toggle('live', live);
      fab.classList.toggle('idle', !live);
      fab.setAttribute('aria-label', live ? 'Fuel — trajet en cours' : 'Fuel');
      fab.title = live ? 'Pause, arrêter, plein' : 'Démarrer, plein, garage';
    }
  } else if (live && (navigating || hudCollapsed) && !fuelCardCollapsed) {
    fuelEl.hidden = false;
    if (fab) fab.hidden = true;
    if (radial) {
      radial.hidden = true;
      radial.classList.remove('open');
    }
  } else {
    if (!live || fuelCardCollapsed) fuelEl.hidden = true;
    if (fab) fab.hidden = true;
  }
  if (handle) handle.hidden = !(fuelCardCollapsed && !logo && (navigating || live));
  for (const foldBtn of foldBtns) {
    if (!foldBtn) continue;
    foldBtn.textContent = fuelCardCollapsed ? '▴' : '▾';
    foldBtn.setAttribute('aria-label', fuelCardCollapsed ? 'Déplier la carte Fuel' : 'Replier la carte Fuel');
    foldBtn.title = foldBtn.getAttribute('aria-label');
  }
  const pageFuel = document.getElementById('pageFuel');
  if (pageFuel && fuelCardCollapsed) pageFuel.hidden = true;
  paintFuelRadial();
  paintFuelStats();
}

function paintFuelRadial() {
  const radial = document.getElementById('fuelRadial');
  if (!radial) return;
  const live = !!(mapsStartedFuel || Number(fuelTrip) > 0);
  if (live) {
    radial.innerHTML =
      `<button type="button" data-rad="pause">${paused ? 'Reprendre' : 'Pause'}</button>` +
      `<button type="button" data-rad="stop" class="stop">Arrêter</button>` +
      `<button type="button" data-rad="fill">Plein</button>`;
  } else {
    radial.innerHTML =
      `<button type="button" data-rad="start" class="go-start">Démarrer</button>` +
      `<button type="button" data-rad="fill">Plein</button>` +
      `<button type="button" data-rad="sheet">Garage</button>`;
  }
}

function showFuelBar(title) {
  if (title) fuelTitle.textContent = title;
  const pauseBtn = document.getElementById('btnPause');
  if (pauseBtn) pauseBtn.textContent = paused ? 'Reprendre' : 'Pause';
  syncFuelChrome();
}

function enterFreeHud(tripId) {
  paused = false;
  hudCollapsed = false;
  mapsStartedFuel = true;
  if (!fuelHudStartedAt) fuelHudStartedAt = Date.now();
  if (tripId) fuelTrip = tripId;
  if (!lastDest) {
    lastDest = { lat: me?.lat || 0, lon: me?.lon || 0, label: 'Trajet Fuel' };
  }
  setFollowNav(true);
  stopIdleGeo();
  navigating = true;
  document.body.classList.add('nav');
  searchForm.hidden = true;
  navBar.hidden = false;
  chipsEl.hidden = true;
  if (altsEl) altsEl.hidden = true;
  if (routeCardEl) routeCardEl.hidden = true;
  showFuelBar(tripId ? `Trajet Fuel · ${tripId}` : 'Trajet Fuel');
  paintHud(currentChoice());
  const speedEl = document.getElementById('hudSpeed');
  if (speedEl) speedEl.hidden = false;
  startNavWatch(applyNavFix);
  startFuelPoll();
  setTripKeepAlive(true);
  try { map.invalidateSize(); } catch { /* */ }
  if (me) applyNavCamera(me.lat, me.lon, true);
}

function startFuelTrip() {
  promptFuelGate('start');
}

function gateDefaultVehicleId(list) {
  const snap = loadFuelSnap();
  const ids = (list || []).map((v) => Number(v.id || v.vehicleId)).filter((id) => id > 0);
  const lastTrip = Number(snap.lastTripVehicleId) || 0;
  if (lastTrip > 0 && ids.includes(lastTrip)) return lastTrip;
  const chosen = fuelChoiceId(snap);
  if (chosen > 0 && ids.includes(chosen)) return chosen;
  return ids.length === 1 ? ids[0] : 0;
}

function paintGateArc(pct, tank, l100) {
  const svg = document.getElementById('fuelGateArc');
  const label = document.getElementById('fuelGateGaugeVal');
  const hidden = document.getElementById('fuelGateGauge');
  const known = Number.isFinite(Number(pct));
  const p = known ? Math.max(0, Math.min(100, Number(pct))) : 0;
  if (hidden) hidden.value = known ? String(Math.round(p)) : '';
  const liters = known && tank > 0 ? Math.round((tank * p) / 10) / 10 : null;
  const range = liters != null && l100 > 0 ? Math.round((liters / l100) * 100) : 0;
  if (label) {
    label.textContent = liters != null
      ? `${Math.round(p)} % · ${liters.toFixed(1)} L${range > 0 ? ` · ~${range} km` : ''}`
      : 'Niveau inconnu';
  }
  if (!svg) return;
  const cx = 130;
  const cy = 118;
  const r = 96;
  const ang = Math.PI * (1 - (known ? p : 0) / 100);
  const x = cx + r * Math.cos(ang);
  const y = cy - r * Math.sin(ang);
  const color = !known ? '#64748b' : p < 12 ? '#e94560' : p < 28 ? '#f59e0b' : '#22c55e';
  const needle = known
    ? `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x} ${y}" fill="none" stroke="${color}" stroke-width="16"/>` +
      `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`
    : '';
  svg.innerHTML =
    `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#2d2d44" stroke-width="16"/>` +
    needle +
    `<circle cx="${cx}" cy="${cy}" r="7" fill="${color}"/>` +
    `<text x="${cx}" y="${cy - 28}" text-anchor="middle" fill="#f1f5f9" font-size="28" font-weight="800">${known ? Math.round(p) + '%' : '—'}</text>`;
}

function promptFuelGate(kind) {
  const sheet = document.getElementById('fuelGate');
  if (!sheet) {
    toast('Confirme la jauge avant de démarrer le trajet.');
    return;
  }
  const list = loadFuelSnap().vehicles || [];
  const row = document.getElementById('fuelGateVeh');
  const title = document.getElementById('fuelGateTitle');
  const hint = document.getElementById('fuelGateHint');
  const before = kind === 'start' || kind === 'nav' || kind === 'resume';
  if (title) {
    title.textContent = kind === 'nav' || kind === 'resume'
      ? 'Jauge avant le trajet'
      : kind === 'start'
        ? 'Démarrer le trajet'
        : 'Confirmer la jauge';
  }
  if (hint) {
    hint.textContent = before
      ? 'Voiture + jauge. Le trajet ne démarre que si tu valides.'
      : 'Ajuste la jauge. Je confirme nourrit l’IA conso ; Je ne confirme pas enregistre sans apprendre.';
  }
  let picked = gateDefaultVehicleId(list);
  const paintVeh = () => {
    if (!row) return;
    row.innerHTML = list.length
      ? list
          .map((v) => {
            const id = Number(v.id || v.vehicleId);
            const name = v.name || v.label || ('Véhicule ' + id);
            const on = id === picked ? ' on' : '';
            return `<button type="button" class="fuel-veh${on}" data-vid="${id}">${esc(name)} · n°${id}</button>`;
          })
          .join('')
      : '<span class="m">Aucun véhicule Fuel</span>';
    row.querySelectorAll('[data-vid]').forEach((btn) => {
      btn.onclick = () => {
        picked = Number(btn.dataset.vid);
        const veh = list.find((v) => Number(v.id || v.vehicleId) === picked);
        paintVeh();
        paintGateArc(veh && veh.pct >= 0 ? veh.pct : NaN, veh && veh.tank, veh && veh.l100);
      };
    });
  };
  const veh0 = list.find((v) => Number(v.id || v.vehicleId) === picked);
  paintVeh();
  paintGateArc(veh0 && veh0.pct >= 0 ? veh0.pct : NaN, veh0 && veh0.tank, veh0 && veh0.l100);
  const arc = document.getElementById('fuelGateArc');
  if (arc) {
    const setFromEvent = (ev) => {
      const point = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
      const rect = arc.getBoundingClientRect();
      const x = point.clientX - rect.left;
      const y = point.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height * (118 / 140);
      let frac = Math.atan2(cy - y, x - cx) / Math.PI;
      if (frac < 0) frac = 0;
      if (frac > 1) frac = 1;
      const veh = list.find((v) => Number(v.id || v.vehicleId) === picked);
      paintGateArc(Math.round((1 - frac) * 100), veh && veh.tank, veh && veh.l100);
    };
    arc.onpointerdown = (ev) => {
      if (arc.setPointerCapture) arc.setPointerCapture(ev.pointerId);
      setFromEvent(ev);
    };
    arc.onpointermove = (ev) => {
      if (ev.buttons) setFromEvent(ev);
    };
  }
  sheet.hidden = false;
  const go = async (skip) => {
    sheet.hidden = true;
    if (kind === 'resume') {
      const id = pendingResumeId;
      pendingResumeId = null;
      if (id) fuelTrip = id;
      enterFreeHud(fuelTrip);
      return;
    }
    if (kind === 'nav') {
      if (picked) setSelectedFuelVehicle(picked, true);
      const hiddenNav = document.getElementById('fuelGateGauge');
      const vehNav = list.find((v) => Number(v.id || v.vehicleId) === picked);
      const pctNav = Number(hiddenNav && hiddenNav.value);
      const litersNav =
        !skip && vehNav && vehNav.tank > 0 && Number.isFinite(pctNav)
          ? Math.round((vehNav.tank * pctNav) / 10) / 10
          : '';
      const extra = {};
      if (picked) extra.vehicleId = picked;
      if (litersNav !== '' && Number.isFinite(Number(litersNav))) extra.liters = Number(litersNav);
      mapsStartedFuel = true;
      await beginGuidedNav({ quietFuel: true });
      fuelControl('start', extra);
      startFuelPoll();
      startFuelHudTick();
      if (!skip) toast('Jauge enregistrée · guidage et Fuel démarrés');
      return;
    }
    if (kind !== 'start') {
      toast(skip ? 'Trajet enregistré sans apprentissage IA' : 'Conso confirmée pour l’IA');
      return;
    }
    const okLoc = await requestPreciseLoc();
    if (!okLoc && !me) {
      explainLocMiss();
      return;
    }
    if (picked) setSelectedFuelVehicle(picked, true);
    const hidden = document.getElementById('fuelGateGauge');
    const veh = list.find((v) => Number(v.id || v.vehicleId) === picked);
    const pct = Number(hidden && hidden.value);
    const liters =
      !skip && veh && veh.tank > 0 && Number.isFinite(pct)
        ? Math.round((veh.tank * pct) / 10) / 10
        : '';
    startFreeTracking(picked, liters);
    if (!skip) toast('Jauge enregistrée pour ce départ');
  };
  const btnGo = document.getElementById('fuelGateGo');
  const btnSkip = document.getElementById('fuelGateSkip');
  const btnCancel = document.getElementById('fuelGateCancel');
  if (btnGo) btnGo.onclick = () => go(false);
  if (btnSkip) {
    btnSkip.textContent = kind === 'start' || kind === 'nav' || kind === 'resume' ? 'Démarrer quand même' : 'Je ne confirme pas';
    btnSkip.onclick = () => go(true);
  }
  if (btnCancel) btnCancel.onclick = () => {
    sheet.hidden = true;
    pendingResumeId = null;
  };
}

function startFreeTracking(vehicleId, liters) {
  if (navigating && mapsStartedFuel) {
    toast('Trajet déjà en cours');
    return;
  }
  clearTrace();
  fuelLiveKm = 0;
  fuelArmed = false;
  fuelDriveMs = 0;
  fuelDriveLast = 0;
  fuelHudStartedAt = Date.now();
  enterFreeHud(fuelTrip);
  const extra = {};
  const vid = vehicleId || fuelSelectedVehicleId || (activeFuelVehicle() && activeFuelVehicle().id);
  if (vid) extra.vehicleId = vid;
  if (liters !== '' && liters != null && Number.isFinite(Number(liters))) extra.liters = Number(liters);
  const ok = fuelControl('start', extra);
  if (!ok) toast('Fuel non joignable depuis ce navigateur');
  speakNav('Trajet Fuel démarré', 0);
}

function enterNavUi() {
  navigating = true;
  document.body.classList.add('nav');
  searchForm.hidden = true;
  navBar.hidden = false;
  chipsEl.hidden = true;
  altsEl.hidden = true;
  sheetEl.hidden = true;
  if (routeCardEl) {
    routeCardEl.hidden = true;
  }
  paintHud(currentChoice());
  if (isCarMode() || Number(fuelTrip) > 0) {
    showFuelBar(Number(fuelTrip) > 0 ? `Trajet Fuel · ${fuelTrip}` : 'Trajet Fuel');
  } else {
    fuelEl.hidden = true;
    syncFuelChrome();
  }
  if (originMarker) {
    try { map.removeLayer(originMarker); } catch { /* ignore */ }
    originMarker = null;
  }
  setTripKeepAlive(true);
  try { map.invalidateSize(); } catch { /* */ }
  if (me) {
    applyNavCamera(me.lat, me.lon, true);
    lastRoadAt = 0;
    lastRoadPos = null;
    if (roadSignEl) roadSignEl.hidden = false;
    const signs = document.getElementById('navSigns');
    if (signs) signs.hidden = false;
    requestAnimationFrame(placeRoadSign);
    void refreshRoad(me.lat, me.lon);
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
      const acc = Number(pos.coords.accuracy);
      if (Number.isFinite(acc) && acc > 70) return;
      const next = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      const now = Date.now();
      if (now - lastWatchAt < 1600 && me && metersBetween(me, next) < 14) {
        updateSpeed(pos.coords, next);
        tickFuelDriveClock();
        maybeStartFuelOnMove();
        paintHud(currentChoice());
        return;
      }
      lastWatchAt = now;
      onPos(pos);
    },
    () => {},
    geoOpts({ accurate: true, freshMs: 0, timeout: 15000 }),
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
    geoOpts({ accurate: false, freshMs: 0, timeout: 6000 }),
  );
}

function startIdleGeo() {
  stopIdleGeo();
  idleGeoTimer = window.setInterval(pingIdleGeo, 120000);
}

function locNative() {
  try {
    return typeof HuberaLocation !== 'undefined' ? HuberaLocation : null;
  } catch {
    return null;
  }
}

function showLocBanner(text, action) {
  const el = document.getElementById('locBanner');
  const t = document.getElementById('locBannerText');
  const btn = document.getElementById('locEnable');
  if (!el) return;
  if (t) t.textContent = text || 'Position pas encore trouvée';
  if (btn) btn.textContent = action || 'Réessayer';
  el.hidden = false;
}

function hideLocBanner() {
  const el = document.getElementById('locBanner');
  if (el) el.hidden = true;
}

function nativeLocSnapshot() {
  const native = locNative();
  const snap = { native, perm: null, gps: null, fix: null };
  if (!native) return snap;
  try { snap.perm = !!native.hasPermission(); } catch { snap.perm = null; }
  try { snap.gps = !!native.gpsEnabled(); } catch { snap.gps = null; }
  try {
    const raw = native.lastFixJson?.();
    if (raw) {
      const p = JSON.parse(raw);
      if (Number.isFinite(p.lat) && Number.isFinite(p.lon)) snap.fix = p;
    }
  } catch {
    /* webview */
  }
  return snap;
}

function applyNativeFix(fix, fly) {
  if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon)) return false;
  setMe(fix.lat, fix.lon, !!fly);
  hideLocBanner();
  return true;
}

/** 'perm' | 'gps' | null. null = réglage actif (ou inconnu) : un fix peut encore manquer. */
function locBlock() {
  const snap = nativeLocSnapshot();
  if (snap.perm === false) return 'perm';
  if (snap.gps === false) return 'gps';
  return null;
}

function locMissToast(waiting) {
  const block = locBlock();
  if (block === 'perm') toast('Autorise la localisation pour Maps.');
  else if (block === 'gps') toast('Active le GPS pour Maps.');
  else toast(waiting || 'Position pas encore trouvée.');
}

function showLocFailure(err) {
  if (me) {
    hideLocBanner();
    return;
  }
  const snap = nativeLocSnapshot();
  const code = err && typeof err.code === 'number' ? err.code : 0;
  if (snap.perm === false || (code === 1 && !snap.native)) {
    showLocBanner('Autorise la localisation pour Maps', 'Autoriser');
    return;
  }
  if (snap.gps === false) {
    showLocBanner('Active le GPS pour Maps et Fuel', 'Activer');
    return;
  }
  showLocBanner('Position pas encore trouvée — Maps reste consultable', 'Réessayer');
}

function openLocRemedy() {
  const block = locBlock();
  const native = locNative();
  try {
    if (block === 'perm') native?.requestPermission?.();
    else if (block === 'gps') native?.openSettings?.();
    else native?.startWatch?.();
  } catch {
    /* webview */
  }
}

function explainLocMiss() {
  const block = locBlock();
  if (block === 'gps') {
    toast('Active la localisation pour démarrer un trajet.');
    try { locNative()?.openSettings?.(); } catch { /* */ }
  } else if (block === 'perm') {
    toast('Autorise la localisation pour démarrer un trajet.');
    try { locNative()?.requestPermission?.(); } catch { /* */ }
  } else {
    toast('Position pas encore trouvée. Réessaie dans un instant.');
  }
}

function requestPreciseLoc() {
  return new Promise((resolve) => {
    const snap = nativeLocSnapshot();
    if (snap.native) {
      try {
        if (snap.perm === false) snap.native.requestPermission();
        else snap.native.startWatch?.();
      } catch {
        /* webview */
      }
    }
    const haveFix = !!(
      (snap.gps !== false && snap.fix && applyNativeFix(snap.fix, true)) ||
      me
    );
    if (snap.gps === false) {
      showLocBanner('Active le GPS pour Maps et Fuel', 'Activer');
    } else if (snap.perm === false) {
      showLocBanner('Autorise la localisation pour Maps', 'Autoriser');
    } else if (haveFix) {
      hideLocBanner();
    }
    const succeed = () => {
      hideLocBanner();
      resolve(true);
    };
    if (!navigator.geolocation) {
      if (haveFix) succeed();
      else {
        showLocFailure(null);
        resolve(false);
      }
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe(pos.coords.latitude, pos.coords.longitude, true);
        succeed();
      },
      (err) => {
        const again = nativeLocSnapshot();
        if (again.gps !== false && (me || applyNativeFix(again.fix, false))) {
          succeed();
          return;
        }
        showLocFailure(err);
        resolve(false);
      },
      geoOpts({ accurate: true, freshMs: 0, timeout: 10000 }),
    );
  });
}

function bootLocate() {
  const had = restoreMe();
  if (had && me) {
    const z = Math.max(15, map.getZoom() || 0);
    map.setView([me.lat, me.lon], Math.max(16, z));
  }
  requestPreciseLoc().then((ok) => {
    if (!ok && !me) map.setView([46.6, 2.4], 6);
  });
  startIdleGeo();
}

window.__mapsEnergyPause = function () {
  if (navigating && !paused) return;
  appVisible = false;
  stopNavWatch();
  stopIdleGeo();
};

window.__mapsEnergyResume = function () {
  appVisible = true;
  lastSpoken = '';
  lastSpokenAt = 0;
  if (navigating && navWatchFn && !paused) startNavWatch(navWatchFn);
  else if (!navigating) startIdleGeo();
  try {
    map.invalidateSize();
  } catch {
    /* pas encore prêt */
  }
  try { applyTiles(); } catch { /* ignore */ }
  if (navigating && !paused && voiceEnabled()) {
    const sub = (document.getElementById('hudSub')?.textContent || '').trim();
    const title = (document.getElementById('hudTitle')?.textContent || '').trim();
    const skip = !title || title === 'À l\'arrêt' || title === 'En pause' || title === 'Guidage';
    const phrase = sub || (skip ? '' : title);
    if (phrase) speakNav(phrase, 0, { force: true });
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) window.__mapsEnergyPause();
  else window.__mapsEnergyResume();
});

function collapseNavHud() {
  if (mapsStartedFuel) {
    fuelStopTracking();
    return;
  }
  stopNavigation({ stopFuel: false });
}

function stopNavigation(opts) {
  const stopFuel = !!(opts && opts.stopFuel);
  navigating = false;
  hudCollapsed = false;
  fuelCardCollapsed = false;
  smoothMe = null;
  lastCamAt = 0;
  lastWatchAt = 0;
  lastSpeedKmh = 0;
  movingSince = 0;
  fuelArmed = false;
  lastSpoken = '';
  document.body.style.removeProperty('--nav-rot');
  try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  try { window.HuberaTts?.stop?.(); } catch { /* ignore */ }
  setFollowNav(true);
  setTripKeepAlive(false);
  document.body.classList.remove('nav');
  searchForm.hidden = false;
  navBar.hidden = true;
  chipsEl.hidden = false;
  const speedEl = document.getElementById('hudSpeed');
  if (speedEl) speedEl.hidden = true;
  stopNavWatch();
  navWatchFn = null;
  startIdleGeo();
  if (stopFuel && mapsStartedFuel) {
    fuelControl('stop');
    mapsStartedFuel = false;
    stopFuelPoll();
    fuelDriveMs = 0;
    fuelDriveLast = 0;
  }
  const fromFuel = Number(fuelTrip) > 0 || mapsStartedFuel;
  if (!fromFuel) {
    fuelEl.hidden = true;
  }
  const radial = document.getElementById('fuelRadial');
  if (radial) {
    radial.hidden = true;
    radial.classList.remove('open');
  }
  syncFuelChrome();
}

async function beginGuidedNav(opts) {
  const quietFuel = !!(opts && opts.quietFuel);
  paused = false;
  lastSpeedKmh = 0;
  movingSince = 0;
  setFollowNav(true);
  stopIdleGeo();
  enterNavUi();
  fuelArmed = false;
  if (isCarMode()) {
    if (quietFuel || mapsStartedFuel) {
      startFuelPoll();
      startFuelHudTick();
      if (!quietFuel) toast('Guidage — Fuel déjà en cours');
    }
  } else {
    toast('Guidage démarré');
  }
  startNavWatch(applyNavFix);
  if (me) applyNavCamera(me.lat, me.lon, true);
}

async function startNavigation() {
  const okLoc = await requestPreciseLoc();
  if (!okLoc && !me) {
    explainLocMiss();
    return;
  }
  const r = currentChoice();
  if (!r) {
    toast('Choisis un itinéraire avant de démarrer.');
    return;
  }
  if (isCarMode() && !mapsStartedFuel) {
    promptFuelGate('nav');
    return;
  }
  await beginGuidedNav();
}

let lastPaintedLimit = null;

function paintSpeedLimit(kmh, zone, known) {
  if (!roadNameEl) return;
  if (roadSignEl) roadSignEl.hidden = false;
  const signs = document.getElementById('navSigns');
  if (signs) signs.hidden = false;
  const zoneEl = document.getElementById('roadZone');
  const isKnown = known !== false && kmh != null && Number.isFinite(Number(kmh));
  if (!isKnown) {
    lastPaintedLimit = null;
    roadNameEl.textContent = '—';
    if (roadSignEl) {
      roadSignEl.classList.remove('is-zone');
      roadSignEl.classList.add('is-unknown');
      roadSignEl.title = 'Aucune limite taguée sur cette voie OpenStreetMap';
    }
    if (zoneEl) {
      zoneEl.hidden = false;
      zoneEl.textContent = 'SANS TAG';
    }
    placeRoadSign();
    return;
  }
  const speed = Math.round(Number(kmh));
  lastPaintedLimit = speed;
  roadNameEl.textContent = String(speed);
  const isZone = !!zone;
  if (roadSignEl) {
    roadSignEl.classList.toggle('is-zone', isZone);
    roadSignEl.classList.remove('is-unknown');
    roadSignEl.title = 'Limitation lue sur la voie OpenStreetMap';
  }
  if (zoneEl) {
    zoneEl.hidden = !isZone;
    zoneEl.textContent = speed <= 20 ? 'ZONE 20' : speed <= 30 ? 'ZONE 30' : 'ZONE';
  }
  placeRoadSign();
}

window.__huberaSpeedLimit = function (kmh, zone, known) {
  if (known === false || known === 0 || known === '0') {
    lastRoadPos = me || lastRoadPos;
    paintSpeedLimit(null, false, false);
    return;
  }
  const n = Number(kmh);
  if (!Number.isFinite(n) || n < 5) return;
  lastRoadPos = me || lastRoadPos;
  paintSpeedLimit(Math.round(n), !!zone, true);
};

async function refreshRoad(lat, lon) {
  const now = Date.now();
  const here = { lat, lon };
  const haveLimit = roadNameEl && roadNameEl.textContent && roadNameEl.textContent !== '—';
  const minMove = navigating ? 22 : 50;
  const stickMs = navigating ? 14000 : 24000;
  const gapMs = navigating ? 5500 : 12000;
  if (lastRoadPos && metersBetween(lastRoadPos, here) < minMove && now - lastRoadAt < stickMs && haveLimit) return;
  if (now - lastRoadAt < gapMs) return;
  lastRoadAt = now;
  if (typeof HuberaSpeed !== 'undefined' && HuberaSpeed.lookup) {
    try {
      HuberaSpeed.lookup(String(lat), String(lon));
    } catch {
      /* le JS ci-dessous sert le site et le repli */
    }
  }
  if (typeof HuberaSpeedCore === 'undefined') return;
  const query = HuberaSpeedCore.waysQuery(lat, lon);
  const heading = Number.isFinite(lastHeadingDeg) ? lastHeadingDeg : null;
  for (const endpoint of overpassEndpoints()) {
    try {
      const data = await overpassPost(endpoint, query);
      if (!data || !Array.isArray(data.elements)) continue;
      if (!data.elements.length) continue;
      const hit = HuberaSpeedCore.resolveSpeed(lat, lon, data.elements, heading);
      if (!hit) continue;
      if (hit.known && hit.kmh != null) {
        lastRoadPos = here;
        paintSpeedLimit(hit.kmh, !!hit.zone, true);
        return;
      }
      let area = null;
      try {
        area = await overpassPost(endpoint, HuberaSpeedCore.areaQuery(lat, lon));
      } catch {
        area = null;
      }
      const zones = HuberaSpeedCore.zonesFromArea(area && area.elements);
      if (zones.length) {
        lastRoadPos = here;
        paintSpeedLimit(zones[0].kmh, true, true);
        return;
      }
      lastRoadPos = here;
      paintSpeedLimit(null, false, false);
      return;
    } catch {
      /* Overpass suivant */
    }
  }
}

async function reverseLabel(lat, lon) {
  const p = await reversePlace(lat, lon);
  return p.full;
}

async function reversePlace(lat, lon) {
  let street = '';
  let city = '';
  let full = '';
  try {
    const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&lang=fr`;
    const res = await fetch(url);
    const data = await res.json();
    const p = data.features?.[0]?.properties || {};
    street = [p.housenumber, p.street || p.name].filter(Boolean).join(' ').trim();
    city = p.city || p.town || p.village || p.state || '';
    full = [street, city].filter(Boolean).join(', ');
  } catch {
    /* photon */
  }
  return { street: street || '', city, full: full || `${lat.toFixed(5)}, ${lon.toFixed(5)}` };
}

function shortNameFromLabel(label) {
  const first = String(label || '').split(',')[0].trim();
  return first || 'Lieu';
}

function matchSavedPlace(lat, lon) {
  const p = loadPlaces();
  if (p.home && placeNear(lat, lon, p.home, 90)) {
    return {
      kind: 'home',
      title: 'Domicile',
      address: p.home.label || '',
      label: p.home.label || 'Domicile',
      lat: p.home.lat,
      lon: p.home.lon,
    };
  }
  if (p.work && placeNear(lat, lon, p.work, 90)) {
    return {
      kind: 'work',
      title: 'Travail',
      address: p.work.label || '',
      label: p.work.label || 'Travail',
      lat: p.work.lat,
      lon: p.work.lon,
    };
  }
  return null;
}

function asPlace(lat, lon, label, extra) {
  const saved = matchSavedPlace(lat, lon);
  if (saved) return Object.assign({ lat, lon }, saved, extra || {});
  const raw = String(label || '').trim();
  const title = shortNameFromLabel(raw);
  const comma = raw.indexOf(',');
  const address = comma > 0 ? raw.slice(comma + 1).trim() : raw;
  return Object.assign({
    kind: 'place',
    title: title || 'Lieu',
    address: address && address !== title ? address : '',
    label: raw || title || 'Lieu',
    lat,
    lon,
  }, extra || {});
}

async function enrichPlace(place) {
  if (!placeHasPoint(place)) return place;
  const saved = matchSavedPlace(place.lat, place.lon);
  if (saved) return Object.assign({}, place, saved, { lat: place.lat, lon: place.lon });
  if (place.kind === 'home' || place.kind === 'work' || place.kind === 'here') return place;
  const hasAddr = (place.address || '').trim() && place.address !== place.title;
  const generic = /^(Lieu|Destination|Arrivée)$/i.test(place.title || '');
  if (hasAddr && !generic) return place;
  const rev = await reversePlace(place.lat, place.lon);
  const poi = !generic && place.title && !/^\d/.test(place.title) ? place.title : '';
  const title = poi || rev.street || shortNameFromLabel(rev.full) || place.title || 'Lieu';
  const address = poi
    ? [rev.street, rev.city].filter(Boolean).join(', ') || rev.full
    : (rev.city && rev.city !== title ? rev.city : (rev.full !== title ? rev.full : ''));
  return Object.assign({}, place, {
    title,
    address: address === title ? (rev.city && rev.city !== title ? rev.city : '') : address,
    label: place.label && String(place.label).length > String(rev.full || '').length ? place.label : (rev.full || place.label || title),
  });
}

async function hereAsPlace() {
  let here = me;
  if (!here) {
    try {
      here = await getHere();
    } catch {
      here = null;
    }
  }
  if (!here) {
    return { kind: 'here', title: 'Ma position', address: '', label: 'Ma position', lat: NaN, lon: NaN, fromHere: true };
  }
  const saved = matchSavedPlace(here.lat, here.lon);
  if (saved) return Object.assign({}, saved, { lat: here.lat, lon: here.lon, fromHere: true });
  const rev = await reversePlace(here.lat, here.lon);
  const title = rev.street || shortNameFromLabel(rev.full) || 'Ma position';
  return {
    kind: 'here',
    title,
    address: rev.city || (rev.full !== title ? rev.full : ''),
    label: rev.full || title,
    lat: here.lat,
    lon: here.lon,
    fromHere: true,
  };
}

function pinTitle(place) {
  if (!place) return '';
  if (place.kind === 'home') return 'Domicile';
  if (place.kind === 'work') return 'Travail';
  return place.title || shortNameFromLabel(place.label);
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
      geoOpts({ accurate: true, freshMs: 0, timeout: 12000 }),
    );
  });
}

function placeNick(place, fallback) {
  if (place && place.nick) return String(place.nick);
  return fallback || (place && place.label ? String(place.label).split(',')[0] : '');
}

function finishAssignPlace(kind, lat, lon, label) {
  const p = loadPlaces();
  const prev = kind === 'home' || kind === 'work' ? p[kind] : null;
  const nick =
    (prev && prev.nick) ||
    (kind === 'home' ? 'Maison' : kind === 'work' ? 'Travail' : '');
  const rec = { lat, lon, label, nick };
  if (kind === 'home' || kind === 'work') p[kind] = rec;
  else {
    const rest = Array.isArray(p.saved) ? p.saved.slice() : [];
    const i = rest.findIndex((x) => x && Math.abs(x.lat - lat) < 1e-5 && Math.abs(x.lon - lon) < 1e-5);
    if (i >= 0) rest[i] = { ...rest[i], ...rec };
    else rest.unshift(rec);
    p.saved = rest.slice(0, 24);
  }
  savePlaces(p);
  pendingAssign = null;
  showHits([]);
  qEl.value = '';
  qEl.placeholder = 'Rechercher ici';
  syncClear();
  chipsEl.hidden = false;
  renderChips();
  renderSaved();
  closePoiCard();
  const shown = nick || label;
  toast(`${shown} enregistré`);
}

function startAssign(kind) {
  pendingAssign = kind;
  const p = loadPlaces();
  const cur = kind === 'home' || kind === 'work' ? p[kind] : null;
  const title = kind === 'home' ? 'Maison' : kind === 'work' ? 'Travail' : 'Lieu';
  qEl.value = cur && cur.label ? cur.label : '';
  qEl.placeholder = cur
    ? `${title} actuel — cherche une nouvelle adresse`
    : `${title} : adresse ou ma position`;
  syncClear();
  setTab('maps');
  qEl.focus();
  try {
    const n = qEl.value.length;
    if (n > 0) qEl.setSelectionRange(n, n);
  } catch {
    /* le texte du raccourci reste en place */
  }
  void showSuggestHits(qEl.value);
}

function clearPlaceFocus() {
  if (!placeFocusMarker) return;
  try { map.removeLayer(placeFocusMarker); } catch { /* */ }
  placeFocusMarker = null;
}

function closePlaceSheet() {
  clearPlaceFocus();
  if (!sheetEl) return;
  sheetEl.hidden = true;
  sheetEl.classList.remove('place-sheet');
}

function placeDistanceLine(place) {
  if (!me || !place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lon))) {
    return 'Montrée sur la carte';
  }
  const km = haversineKm(me, { lat: Number(place.lat), lon: Number(place.lon) });
  if (!Number.isFinite(km)) return 'Montrée sur la carte';
  if (km < 1) return `À ${Math.max(1, Math.round(km * 1000))} m · montrée sur la carte`;
  return `À ${km.toFixed(1)} km · montrée sur la carte`;
}

function focusPlaceOnMap(place, label, kind) {
  const lat = Number(place && place.lat);
  const lon = Number(place && place.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  setTab('maps');
  clearPlaceFocus();
  const pinKind = kind === 'work' ? 'work' : kind === 'saved' ? 'saved' : 'home';
  placeFocusMarker = L.marker([lat, lon], {
    icon: placePinIcon(pinKind, label || 'Lieu'),
    zIndexOffset: 900,
    keyboard: false,
  }).addTo(map);
  try {
    map.setView([lat, lon], 16, { animate: false });
    map.panBy([0, -160], { animate: false });
  } catch {
    /* carte pas prête */
  }
}

function openPlaceActions(kind, place) {
  if (!place) {
    startAssign(kind);
    return;
  }
  const title = placeNick(place, kind === 'home' ? 'Maison' : kind === 'work' ? 'Travail' : 'Lieu');
  focusPlaceOnMap(place, title, kind);
  sheetEl.classList.add('place-sheet');
  sheetEl.hidden = false;
  sheetEl.innerHTML =
    `<div class="route-head"><strong>${esc(title)}</strong>` +
    `<button type="button" class="panel-close" id="paClose" aria-label="Fermer">✕</button></div>` +
    `<span>${esc(place.label || '')}</span>` +
    `<span>${esc(placeDistanceLine(place))}</span>` +
    `<button type="button" class="go" id="paGo">Itinéraire</button>` +
    `<button type="button" class="go" id="paEdit" style="margin-top:8px;background:#16213e">Modifier l’adresse</button>` +
    `<button type="button" class="go" id="paNick" style="margin-top:8px;background:#16213e">Petit nom</button>` +
    `<button type="button" class="go" id="paDel" style="margin-top:8px;background:#3f1d2e;color:#e94560">Supprimer</button>`;
  const closer = document.getElementById('paClose');
  if (closer) closer.onclick = () => closePlaceSheet();
  const go = document.getElementById('paGo');
  const edit = document.getElementById('paEdit');
  const nickBtn = document.getElementById('paNick');
  const del = document.getElementById('paDel');
  if (go) {
    go.onclick = () => {
      closePlaceSheet();
      void routeTo(place.lat, place.lon, place.label || title);
    };
  }
  if (edit) {
    edit.onclick = () => {
      closePlaceSheet();
      startAssign(kind);
    };
  }
  if (nickBtn) {
    nickBtn.onclick = () => {
      const next = window.prompt('Petit nom (Maison, Travail, Maman…)', title);
      if (next == null) return;
      const p = loadPlaces();
      if (kind === 'home' || kind === 'work') {
        if (p[kind]) p[kind] = { ...p[kind], nick: next.trim() || title };
      } else if (kind === 'saved') {
        const i = Number(place._i);
        if (Array.isArray(p.saved) && p.saved[i]) p.saved[i] = { ...p.saved[i], nick: next.trim() };
      }
      savePlaces(p);
      renderChips();
      renderSaved();
      closePlaceSheet();
      toast('Petit nom enregistré');
    };
  }
  if (del) {
    del.onclick = () => {
      const p = loadPlaces();
      if (kind === 'home') p.home = null;
      else if (kind === 'work') p.work = null;
      else if (kind === 'saved' && Array.isArray(p.saved)) {
        p.saved = p.saved.filter((_, i) => i !== Number(place._i));
      }
      savePlaces(p);
      renderChips();
      renderSaved();
      closePlaceSheet();
      toast('Adresse supprimée');
    };
  }
}

async function showSuggestHits(q) {
  const gen = searchGen;
  const items = [];
  const query = String(q || '').trim();
  if (query.length >= 2) {
    chipsEl.hidden = true;
    try {
      const found = await searchPhoton(query);
      if (gen !== searchGen) return;
      for (const h of found) items.push(h);
    } catch {
      /* hors ligne */
    }
    if (gen !== searchGen) return;
    if (!items.length) {
      items.push({
        lat: me ? me.lat : 0,
        lon: me ? me.lon : 0,
        label: 'Aucun lieu trouvé',
        hint: 'Réessayez avec une adresse plus précise',
        here: true,
      });
    }
  } else {
    chipsEl.hidden = false;
    const title = pendingAssign === 'home' ? 'Maison' : pendingAssign === 'work' ? 'Travail' : '';
    items.push({
      lat: me ? me.lat : 0,
      lon: me ? me.lon : 0,
      label: 'Ma position actuelle',
      hint: title ? `Enregistrer ici comme ${title}` : 'Utiliser ma position',
      here: true,
    });
    const p = loadPlaces();
    if (pendingAssign && p[pendingAssign] && p[pendingAssign].label) {
      items.push({
        lat: p[pendingAssign].lat,
        lon: p[pendingAssign].lon,
        label: p[pendingAssign].label,
        hint: `${title} actuel — garder ou cherche plus bas`,
      });
    }
    for (const r of p.recents.slice(0, 4)) {
      items.push({ ...r, hint: 'Récent' });
    }
    for (const c of contactPlaces().slice(0, 6)) {
      items.push({
        lat: 0,
        lon: 0,
        label: c.label,
        hint: 'Contacts',
        query: c.query,
      });
    }
  }
  if (gen !== searchGen || suggestSuppressed()) return;
  showHits(items);
}

async function definePlace(kind) {
  startAssign(kind);
}

async function routeTo(lat, lon, label) {
  if (pendingAssign) {
    finishAssignPlace(pendingAssign, lat, lon, label);
    return;
  }
  if (pendingEnd) {
    await pickRoutePlace({ lat, lon, label });
    return;
  }
  lastDest = await enrichPlace(asPlace(lat, lon, label));
  rememberRecent({ lat, lon, label: lastDest.label || label });
  lastOrigin = await hereAsPlace();
  await routeFromTo(lastOrigin, lastDest);
}

async function routeFromTo(origin, dest) {
  if (!placeHasPoint(dest)) return;
  lastDest = dest;
  lastOrigin = origin && origin.kind ? origin : origin && placeHasPoint(origin) ? asPlace(origin.lat, origin.lon, origin.label || origin.title) : origin;
  if (navigating) stopNavigation();
  const gen = ++routeGen;
  if (routeAbort) routeAbort.abort();
  routeAbort = new AbortController();
  const signal = routeAbort.signal;
  sheetEl.hidden = true;
  qEl.value = '';
  syncClear();
  const originOk = placeHasPoint(lastOrigin);
  if (!originOk) {
    clearRoute();
    ensureAbMarkers();
    showAltsShell(
      `<p style="color:#94a3b8;margin:0 0 8px">Activez « ma position » pour calculer le trajet.</p>` +
        `<button type="button" id="btnGo" style="margin-top:8px;width:100%;border:0;border-radius:999px;padding:10px;background:#e94560;color:#fff;font-weight:700;cursor:pointer;font-size:15px">Ma position</button>`,
    );
    const go = document.getElementById('btnGo');
    if (go) {
      go.onclick = () => {
        document.getElementById('btnHere').click();
        setTimeout(() => void (async () => {
          lastOrigin = await hereAsPlace();
          await routeFromTo(lastOrigin, lastDest);
        })(), 700);
      };
    }
    if (placeHasPoint(lastDest)) map.setView([lastDest.lat, lastDest.lon], 14);
    return;
  }
  if (haversineKm(lastOrigin, lastDest) < 0.12) {
    clearRoute();
    ensureAbMarkers();
    map.setView([lastDest.lat, lastDest.lon], 16);
    showAltsShell(`<p style="color:#94a3b8;margin:0 0 10px">Tu es déjà ici — pas besoin de guidage.</p>`);
    return;
  }
  clearRoute();
  ensureAbMarkers();
  toast(`Itinéraire vers ${pinTitle(lastDest) || 'destination'}…`);
  showAltsShell(`<p style="color:#94a3b8;margin:0">Calcul…</p>`);
  fitRouteBounds();
  let choices = [];
  try {
    choices = await collectRoutes(lastOrigin, lastDest, signal);
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
    showAltsShell(`<p style="color:#94a3b8">${esc(none)}</p>`);
    return;
  }
  selectedRouteId = routeChoices[0].id;
  clearDetourOffer();
  drawChoices(selectedRouteId);
  renderAlts();
  paintTripInfoMenu();
  if (travelMode === 'car' && routeChoices.length) {
    void (async () => {
      let next = routeChoices;
      try {
        next = await enrichRoutesWithTraffic(lastOrigin, lastDest, next, signal);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
      if (gen !== routeGen) return;
      try {
        next = await enrichRoutesWithWorks(lastOrigin, lastDest, next, signal);
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
      if (gen !== routeGen) return;
      if (trafficCache && trafficCache.stations.length && typeof HuberaTraffic !== 'undefined') {
        next = HuberaTraffic.annotateRoutes(next, trafficCache.stations);
      }
      if (!next || !next.length) return;
      const keep = selectedRouteId;
      routeChoices = next;
      if (!routeChoices.some((r) => r.id === keep)) selectedRouteId = routeChoices[0].id;
      drawChoices(selectedRouteId);
      maybeShowTrafficOffer(routeChoices);
      if (!navigating) renderAlts();
      else paintHud(currentChoice());
    })();
  }
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
        `data-lat="${h.lat}" data-lon="${h.lon}" data-label="${esc(h.label)}" data-osm-id="${esc(h.osmId || '')}" ` +
        `data-osm-type="${esc(h.osmType || '')}" data-name="${esc(h.name || '')}"${h.query ? ` data-query="${esc(h.query)}"` : ''}>` +
        `<div class="hit-t">${esc(h.label)}</div>${hint}</button>`
      );
    })
    .join('');
}

async function showNearby(kind) {
  if (!me) {
    locMissToast();
    return;
  }
  const amenity = kind === 'parking' ? 'parking' : 'fuel';
  const title = amenity === 'fuel' ? 'Stations' : 'Parkings';
  toast(`Recherche ${title.toLowerCase()} autour de vous…`);
  const around = amenity === 'fuel' ? 6000 : 2500;
  const query = `[out:json][timeout:15];node["amenity"="${amenity}"](around:${around},${me.lat},${me.lon});out 40;`;
  try {
    const data = await overpassJson(query);
    if (!data) throw new Error('overpass');
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

function scheduleMapPlaces() {
  if (navigating && followNav) {
    if (mapPlacesTimer) return;
    mapPlacesTimer = window.setTimeout(() => {
      mapPlacesTimer = 0;
      lastPlacesKey = '';
      void refreshMapPlaces();
    }, 45000);
    return;
  }
  if (mapPlacesTimer) clearTimeout(mapPlacesTimer);
  mapPlacesTimer = window.setTimeout(() => {
    mapPlacesTimer = 0;
    void refreshMapPlaces();
  }, 700);
}

function placesCacheRead() {
  try {
    return JSON.parse(localStorage.getItem(PLACES_CACHE_KEY) || '{}');
  } catch {
    return {};
  }
}

function placesCacheWrite(store) {
  try {
    const keys = Object.keys(store);
    if (keys.length > 48) {
      keys
        .sort((a, b) => (store[a].at || 0) - (store[b].at || 0))
        .slice(0, keys.length - 48)
        .forEach((k) => delete store[k]);
    }
    localStorage.setItem(PLACES_CACHE_KEY, JSON.stringify(store));
  } catch {
    /* quota */
  }
}

async function overpassJson(query) {
  for (const endpoint of overpassEndpoints()) {
    try {
      const data = await overpassPost(endpoint, query);
      if (data) return data;
    } catch {
      /* suivant */
    }
  }
  return null;
}

function poiKindOf(tags) {
  if (!tags) return null;
  if (tags.amenity === 'fuel' || tags.highway === 'services') return 'fuel';
  if (tags.amenity === 'pharmacy') return 'pharm';
  if (tags.amenity === 'atm' || tags.amenity === 'bank') return 'atm';
  if (tags.shop === 'supermarket' || tags.shop === 'convenience' || tags.shop === 'mall') return 'shop';
  return null;
}

function poiLabelOf(kind) {
  if (kind === 'fuel') return 'Station';
  if (kind === 'pharm') return 'Pharmacie';
  if (kind === 'atm') return 'Distributeur';
  if (kind === 'shop') return 'Supermarché';
  if (kind === 'works') return 'Travaux';
  return 'Lieu';
}

function poiIconOf(kind) {
  if (kind === 'fuel') return '⛽';
  if (kind === 'pharm') return '✚';
  if (kind === 'atm') return '€';
  return '🛒';
}

function poiMeta(tags, kind) {
  const bits = [];
  if (tags.brand && tags.brand !== tags.name) bits.push(tags.brand);
  if (tags.opening_hours) bits.push(tags.opening_hours);
  if (kind === 'fuel') {
    const diesel = tags['fuel:diesel'] || tags.diesel;
    const sp95 = tags['fuel:octane_95'] || tags['fuel:e10'];
    if (diesel && diesel !== 'yes') bits.push(`Diesel ${diesel}`);
    if (sp95 && sp95 !== 'yes') bits.push(`SP95 ${sp95}`);
    if (!diesel && !sp95 && tags.amenity === 'fuel') bits.push('Carburant OSM');
  }
  if (tags['addr:street']) bits.push(tags['addr:street']);
  return bits.join(' · ') || 'Horaires et tarifs OSM, cache local 18 min.';
}

function nameScore(a, b) {
  const na = String(a || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nb = String(b || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (!na || !nb) return 0;
  if (na === nb) return 100;
  if (na.includes(nb) || nb.includes(na)) return 70;
  const wa = na.split(/\W+/).filter(Boolean);
  let hit = 0;
  for (const w of wa) if (w.length > 2 && nb.includes(w)) hit += 1;
  return hit * 12;
}

function osmTypeToken(t) {
  const s = String(t || '').toLowerCase();
  if (s === 'w' || s === 'way') return 'way';
  if (s === 'r' || s === 'relation') return 'relation';
  return 'node';
}

function poiFromOsmEl(el, fallbackName, lat, lon) {
  const tags = (el && el.tags) || {};
  const kind = poiKindOf(tags) || (tags.shop ? 'shop' : tags.amenity ? tags.amenity : 'place');
  const name = tags.name || tags.brand || fallbackName || 'Lieu';
  const lat0 = Number.isFinite(el.lat) ? el.lat : (el.center && el.center.lat) || lat;
  const lon0 = Number.isFinite(el.lon) ? el.lon : (el.center && el.center.lon) || lon;
  const addr = [
    tags['addr:housenumber'],
    tags['addr:street'],
    tags['addr:postcode'],
    tags['addr:city'] || tags['addr:town'] || tags['addr:village'],
  ]
    .filter(Boolean)
    .join(' ');
  const hours = tags.opening_hours || '';
  const phone = tags.phone || tags['contact:phone'] || tags['contact:mobile'] || '';
  const web = tags.website || tags['contact:website'] || tags['contact:facebook'] || '';
  const bits = [];
  if (tags.brand && tags.brand !== name) bits.push(tags.brand);
  if (tags.operator && tags.operator !== name && tags.operator !== tags.brand) bits.push(tags.operator);
  if (tags.shop) bits.push(tags.shop.replace(/_/g, ' '));
  if (tags.amenity && tags.amenity !== 'yes') bits.push(tags.amenity.replace(/_/g, ' '));
  if (addr) bits.push(addr);
  if (hours) bits.push(hours);
  if (phone) bits.push(phone);
  if (web) bits.push(web.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  if (tags.wheelchair === 'yes') bits.push('Accessible PMR');
  return {
    name,
    lat: lat0,
    lon: lon0,
    kind,
    hours,
    opening_hours: hours,
    phone,
    website: web,
    address: addr,
    meta: bits.join(' · ') || poiMeta(tags, kind),
    tags,
  };
}

async function lookupOsmDetails(lat, lon, label, osm) {
  const fallbackName = shortNameFromLabel(label) || label;
  let data = null;
  const osmId = osm && (osm.osmId || osm.id);
  if (osmId) {
    const t = osmTypeToken(osm.osmType || osm.type);
    data = await overpassJson(`[out:json][timeout:10];${t}(${osmId});out tags center 1;`);
  }
  if (!data || !(data.elements || []).length) {
    data = await overpassJson(
      `[out:json][timeout:12];(` +
        `nwr(around:140,${lat},${lon})[name];` +
        `nwr(around:90,${lat},${lon})[shop];` +
        `nwr(around:90,${lat},${lon})[amenity];` +
        `);out tags center 28;`,
    );
  }
  const els = (data && data.elements) || [];
  if (!els.length) {
    return {
      name: fallbackName,
      lat,
      lon,
      kind: 'shop',
      meta: label,
      address: label,
    };
  }
  let best = els[0];
  let score = -1;
  for (const el of els) {
    const tags = el.tags || {};
    const n = tags.name || tags.brand || '';
    const s = nameScore(n, fallbackName) + (tags.shop || tags.amenity ? 8 : 0);
    if (s > score) {
      score = s;
      best = el;
    }
  }
  return poiFromOsmEl(best, fallbackName, lat, lon);
}

async function openSearchPlace(lat, lon, label, osm) {
  if (pendingAssign || pendingEnd) {
    await routeTo(lat, lon, label);
    return;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  toast('Fiche du lieu…');
  map.setView([lat, lon], 16);
  try {
    const details = await lookupOsmDetails(lat, lon, label, osm);
    openPoiCard(details);
  } catch {
    openPoiCard({ name: shortNameFromLabel(label) || label, lat, lon, kind: 'shop', meta: label });
  }
}

function openPoiCard(item) {
  selectedPoi = item;
  const card = document.getElementById('poiCard');
  if (!card) return;
  document.getElementById('poiCardKind').textContent = poiLabelOf(item.kind) || 'Lieu';
  document.getElementById('poiCardTitle').textContent = item.name;
  const extra = [];
  if (item.address) extra.push(item.address);
  if (item.hours || item.opening_hours) extra.push(item.hours || item.opening_hours);
  if (item.phone) extra.push(item.phone);
  if (item.website) extra.push(String(item.website).replace(/^https?:\/\//, ''));
  if (me && Number.isFinite(item.lat)) {
    const km = haversineKm(me, { lat: item.lat, lon: item.lon });
    extra.push(`≈ ${km.toFixed(1)} km depuis toi`);
  }
  extra.push('Données OpenStreetMap.');
  document.getElementById('poiCardMeta').textContent = item.meta || extra[0] || '';
  const extraEl = document.getElementById('poiCardExtra');
  if (extraEl) extraEl.textContent = extra.filter((x) => x && x !== item.meta).join(' · ');
  const call = document.getElementById('poiCardCall');
  if (call) {
    call.hidden = !item.phone;
    call.onclick = () => {
      if (item.phone) window.location.href = `tel:${String(item.phone).replace(/\s/g, '')}`;
    };
  }
  const share = document.getElementById('poiCardShare');
  if (share) {
    share.onclick = () => {
      const text = `${item.name} — https://www.openstreetmap.org/?mlat=${item.lat}&mlon=${item.lon}`;
      if (navigator.share) navigator.share({ title: item.name, text }).catch(() => {});
      else toast(text);
    };
  }
  card.hidden = false;
}

function closePoiCard() {
  selectedPoi = null;
  const card = document.getElementById('poiCard');
  if (card) card.hidden = true;
}

function paintLivePois(items) {
  if (livePoiLayer) {
    map.removeLayer(livePoiLayer);
    livePoiLayer = null;
  }
  if (!items.length) return;
  livePoiLayer = L.layerGroup();
  for (const it of items) {
    const mark = L.marker([it.lat, it.lon], {
      pane: 'poiPane',
      keyboard: false,
      icon: L.divIcon({
        className: 'poi-pin',
        html: `<div class="poi-dot ${it.kind}">${poiIconOf(it.kind)}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    });
    mark.on('click', () => openPoiCard(it));
    mark.addTo(livePoiLayer);
  }
  livePoiLayer.addTo(map);
}

function paintPlaceLabels(items) {
  if (placeLabelLayer) {
    map.removeLayer(placeLabelLayer);
    placeLabelLayer = null;
  }
  const z = map.getZoom() || 0;
  if (z >= 16) return;
  const vis = items.filter((p) => {
    if (p.rank === 'city') return z >= 6;
    if (p.rank === 'town') return z >= 9;
    return z >= 12;
  });
  if (!vis.length) return;
  placeLabelLayer = L.layerGroup();
  for (const p of vis) {
    L.marker([p.lat, p.lon], {
      pane: 'labelsPane',
      interactive: false,
      keyboard: false,
      icon: L.divIcon({
        className: 'city-lab',
        html: `<div class="city-lab rank-${p.rank}">${esc(p.name)}</div>`,
        iconSize: [8, 8],
        iconAnchor: [4, 4],
      }),
    }).addTo(placeLabelLayer);
  }
  placeLabelLayer.addTo(map);
}

async function refreshMapPlaces() {
  if (activeTab !== 'maps' && activeTab !== 'trips') return;
  let b;
  try {
    b = map.getBounds();
  } catch {
    return;
  }
  const z = map.getZoom() || 0;
  if (z < 6) {
    paintPlaceLabels([]);
    paintLivePois([]);
    return;
  }
  const key = [
    z >= 14 ? Math.round(z) : z >= 9 ? 9 : 6,
    b.getSouth().toFixed(2),
    b.getWest().toFixed(2),
    b.getNorth().toFixed(2),
    b.getEast().toFixed(2),
  ].join('|');
  if (key === lastPlacesKey) return;
  const store = placesCacheRead();
  const hit = store[key];
  if (hit && Date.now() - hit.at < 18 * 60 * 1000) {
    lastPlacesKey = key;
    paintPlaceLabels(hit.cities || []);
    paintLivePois(hit.pois || []);
    return;
  }
  const s = b.getSouth().toFixed(4);
  const w = b.getWest().toFixed(4);
  const n = b.getNorth().toFixed(4);
  const e = b.getEast().toFixed(4);
  const wantPoi = z >= 14;
  const q =
    `[out:json][timeout:8];(` +
    `node(${s},${w},${n},${e})[place~"^(city|town|village)$"];` +
    (wantPoi
      ? `node(${s},${w},${n},${e})[amenity=fuel];` +
        `node(${s},${w},${n},${e})[amenity=pharmacy];` +
        (z >= 15 ? `node(${s},${w},${n},${e})[shop=supermarket];` : '') +
        (z >= 16 ? `node(${s},${w},${n},${e})[amenity=atm];` : '')
      : '') +
    `);out body 80;`;
  const data = await overpassJson(q);
  if (!data) return;
  const cities = [];
  const pois = [];
  for (const el of data.elements || []) {
    if (!Number.isFinite(el.lat) || !Number.isFinite(el.lon)) continue;
    const tags = el.tags || {};
    const name = tags.name || tags.brand;
    if (!name) continue;
    if (tags.place === 'city' || tags.place === 'town' || tags.place === 'village') {
      cities.push({ name, lat: el.lat, lon: el.lon, rank: tags.place });
      continue;
    }
    const kind = poiKindOf(tags);
    if (!kind) continue;
    pois.push({
      name,
      lat: el.lat,
      lon: el.lon,
      kind,
      meta: poiMeta(tags, kind),
    });
  }
  cities.sort((a, b) => {
    const r = { city: 0, town: 1, village: 2 };
    return (r[a.rank] || 9) - (r[b.rank] || 9);
  });
  const slimCities = cities.slice(0, 40);
  const slimPois = pois.slice(0, 60);
  store[key] = { at: Date.now(), cities: slimCities, pois: slimPois };
  placesCacheWrite(store);
  lastPlacesKey = key;
  paintPlaceLabels(slimCities);
  paintLivePois(slimPois);
}

function renderChips() {
  const p = loadPlaces();
  const homeName = p.home ? placeNick(p.home, 'Maison') : '';
  const workName = p.work ? placeNick(p.work, 'Travail') : '';
  const bits = [
    `<button type="button" class="chip" data-chip="home">${p.home ? esc(homeName) : `+ Maison`}${p.home ? ` <span class="sub">· ${esc((p.home.label || '').split(',')[0])}</span>` : ''}</button>`,
    `<button type="button" class="chip" data-chip="work">${p.work ? esc(workName) : `+ Travail`}${p.work ? ` <span class="sub">· ${esc((p.work.label || '').split(',')[0])}</span>` : ''}</button>`,
    `<button type="button" class="chip" data-chip="fuel">Stations</button>`,
    `<button type="button" class="chip" data-chip="parking">Parkings</button>`,
  ];
  for (const r of p.recents.slice(0, 3)) {
    bits.push(
      `<button type="button" class="chip" data-chip="recent" data-lat="${r.lat}" data-lon="${r.lon}" data-label="${esc(r.label)}">${esc(r.label.split(',')[0])}</button>`,
    );
  }
  chipsEl.innerHTML = bits.join('');
  placeRoadSign();
}

function renderSaved() {
  const p = loadPlaces();
  const rows = [];
  const add = (key, title, place) => {
    if (!place) {
      rows.push(
        `<div class="place-line"><button type="button" class="place-edit" data-assign="${key}" aria-label="Ajouter ${esc(title)}">✎</button>` +
          `<button type="button" class="place-row" data-assign="${key}">Ajouter ${esc(title)}</button></div>`,
      );
      return;
    }
    const shown = placeNick(place, title);
    rows.push(
      `<div class="place-line"><button type="button" class="place-edit" data-assign="${key}" aria-label="Modifier ${esc(shown)}">✎</button>` +
        `<button type="button" class="place-del" data-del="${key}" aria-label="Supprimer ${esc(shown)}">✕</button>` +
        `<button type="button" class="place-row" data-place="${key}"><strong>${esc(shown)}</strong> · ${esc(place.label)}</button></div>`,
    );
  };
  add('home', 'Maison', p.home);
  add('work', 'Travail', p.work);
  (p.saved || []).forEach((r, i) => {
    if (!r) return;
    const shown = placeNick(r, (r.label || '').split(',')[0] || 'Lieu');
    rows.push(
      `<div class="place-line"><button type="button" class="place-edit" data-saved-edit="${i}" aria-label="Modifier ${esc(shown)}">✎</button>` +
        `<button type="button" class="place-del" data-saved-del="${i}" aria-label="Supprimer ${esc(shown)}">✕</button>` +
        `<button type="button" class="place-row" data-saved="${i}"><strong>${esc(shown)}</strong> · ${esc(r.label || '')}</button></div>`,
    );
  });
  const rest = p.recents;
  const seen = new Set(
    [p.home?.label, p.work?.label]
      .concat((p.saved || []).map((s) => s && s.label))
      .filter(Boolean),
  );
  for (const r of rest) {
    if (seen.has(r.label)) continue;
    seen.add(r.label);
    rows.push(
      `<button type="button" class="place-row" data-lat="${r.lat}" data-lon="${r.lon}" data-label="${esc(r.label)}">${esc(r.label)}</button>`,
    );
  }
  savedList.innerHTML = rows.join('') || '<p>Aucun lieu pour l’instant.</p>';
}

function fmtBytes(n) {
  const x = Number(n) || 0;
  if (x < 1024) return `${x} o`;
  if (x < 1048576) return `${(x / 1024).toFixed(0)} Ko`;
  return `${(x / 1048576).toFixed(1)} Mo`;
}

function appVersionLabel() {
  try {
    if (typeof HuberaUpdate !== 'undefined' && HuberaUpdate.version) {
      const v = HuberaUpdate.version();
      const c = HuberaUpdate.versionCode ? HuberaUpdate.versionCode() : '';
      return c ? `${v} (${c})` : v;
    }
  } catch {
    /* web */
  }
  return '0.1.77';
}

const FUEL_UX_OPTS = [
  { id: 'mix', title: 'Mix 2+7+10 (recommandé)', hint: 'Feuille + HUD conduite + Fuel silencieux' },
  { id: 'actuel', title: 'Actuel', hint: 'Onglet Trajets Fuel comme aujourd’hui' },
  { id: '1', title: '1 — 4 onglets', hint: 'Maps · Fuel · Enregistrés · Moi' },
  { id: '2', title: '2 — Feuille sous la carte', hint: 'Carnet dans une feuille, pas d’onglet Fuel' },
  { id: '3', title: '3 — Cinq onglets métier', hint: 'Maps Trajets Pleins Garage Budget' },
  { id: '4', title: '4 — Conduite / Carnet', hint: 'Deux modes' },
  { id: '5', title: '5 — Calques carte', hint: 'Trajets et pleins comme objets carte' },
  { id: '6', title: '6 — FAB pompe', hint: 'Carte propre, bouton pompe' },
  { id: '7', title: '7 — HUD conduite', hint: 'Jauge tiny, gros HUD en roulant' },
  { id: '8', title: '8 — Écran partagé', hint: 'Carte + tableau en même temps' },
  { id: '9', title: '9 — Fuel tel quel', hint: 'Onglet = accueil Fuel' },
  { id: '10', title: '10 — Moteur invisible', hint: 'Même UI que le mix, sans ouvrir Fuel' },
];

function fuelUxId() {
  const v = localStorage.getItem(FUEL_UX_KEY);
  return v || 'mix';
}

function setFuelUx(id) {
  localStorage.setItem(FUEL_UX_KEY, id);
  applyFuelUx();
}

function usesFuelSheet() {
  const id = fuelUxId();
  return id === '2';
}

function applyFuelUx() {
  const id = fuelUxId();
  document.body.className = document.body.className
    .split(/\s+/)
    .filter((c) => c && !c.startsWith('fux-'))
    .join(' ');
  document.body.classList.add(`fux-${id}`);
  const lab = document.getElementById('devFuelLabel');
  const opt = FUEL_UX_OPTS.find((o) => o.id === id);
  if (lab) lab.textContent = `DEV · ${opt ? opt.title : id}`;
  const tabs = document.getElementById('tabs');
  if (tabs) {
    if (id === '3') {
      tabs.innerHTML =
        `<button type="button" class="tab on" data-tab="maps"><span class="ic">🗺️</span>Maps</button>` +
        `<button type="button" class="tab" data-tab="trips"><span class="ic">⛽</span>Fuel</button>` +
        `<button type="button" class="tab" data-tab="fills"><span class="ic">P</span>Pleins</button>` +
        `<button type="button" class="tab" data-tab="saved"><span class="ic">★</span>Garage</button>` +
        `<button type="button" class="tab" data-tab="budget"><span class="ic">€</span>Budget</button>`;
    } else if (id === '1' || id === '9' || id === 'actuel' || id === '4' || id === '5') {
      tabs.innerHTML =
        `<button type="button" class="tab on" data-tab="maps"><span class="ic">🗺️</span>Maps</button>` +
        `<button type="button" class="tab" data-tab="trips"><span class="ic">⛽</span>Fuel</button>` +
        `<button type="button" class="tab" data-tab="saved"><span class="ic">★</span>Enreg.</button>`;
    } else {
      tabs.innerHTML =
        `<button type="button" class="tab on" data-tab="maps"><span class="ic">🗺️</span>Maps</button>` +
        `<button type="button" class="tab" data-tab="trips"><span class="ic">⛽</span>Fuel</button>` +
        `<button type="button" class="tab" data-tab="saved"><span class="ic">★</span>Enreg.</button>`;
    }
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === 'maps'));
  }
  const av = document.getElementById('btnUser');
  if (av) {
    av.classList.remove('gauge');
    paintId();
  }
  closeFuelSheet();
  paintFuelPeek();
  paintFuelSheetBody();
  const split = document.getElementById('fuelSplitBody');
  if (split) {
    const rows = loadCachedFuelTrips();
    const km = rows.reduce((s, t) => s + (t.km || 0), 0);
    split.innerHTML = `<div class="item">${km.toFixed(1)} km cumulés · ${rows.length} trajets</div>`;
  }
  syncChromeHeight();
}

function loadFuelSnap() {
  try {
    const s = JSON.parse(localStorage.getItem(FUEL_SNAP_KEY) || 'null');
    return s && typeof s === 'object' ? s : { vehicles: [], fills: [], budget: null };
  } catch {
    return { vehicles: [], fills: [], budget: null };
  }
}

function saveFuelSnap(s) {
  localStorage.setItem(FUEL_SNAP_KEY, JSON.stringify(s));
}

function parseFuelSnapPack(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const parts = s.split('||');
  const out = { vehicles: [], fills: [], budget: null };
  for (let i = 0; i < parts.length; i += 2) {
    const kind = parts[i];
    const body = parts[i + 1] || '';
    if (kind === 'V') {
      out.vehicles = body.split('|').map((row) => {
        const [idRaw, name, pctRaw, act, tankRaw, litersRaw, l100Raw] = row.split('~');
        const id = Number(idRaw);
        const pct = Number(pctRaw);
        const tank = Number(tankRaw);
        const liters = Number(litersRaw);
        const l100 = Number(l100Raw);
        return {
          id,
          name: name || `Véhicule ${id}`,
          pct: Number.isFinite(pct) ? pct : -1,
          active: act === '1',
          tank: Number.isFinite(tank) && tank > 0 ? tank : 0,
          liters: Number.isFinite(liters) && liters >= 0 ? liters : -1,
          l100: Number.isFinite(l100) && l100 > 0 ? l100 : 0,
        };
      }).filter((v) => Number.isFinite(v.id) && v.id > 0);
    } else if (kind === 'F') {
      out.fills = body.split('|').filter(Boolean).map((row) => {
        const [date, L, cost, station, vid] = row.split('~');
        return {
          date: date || '',
          liters: Number(L) || 0,
          cost: Number(cost) || 0,
          station: station || '',
          vehicleId: Number(vid) || 0,
        };
      });
    } else if (kind === 'B' && body) {
      const [amount, spent, name] = body.split('~');
      out.budget = { amount: Number(amount) || 0, spent: Number(spent) || 0, name: name || 'Budget' };
    } else if (kind === 'L') {
      out.lastVehicleId = Number(body) || 0;
    } else if (kind === 'T') {
      out.lastTripVehicleId = Number(body) || 0;
    }
  }
  return out;
}

function activeFuelVehicle() {
  const snap = loadFuelSnap();
  const list = snap.vehicles || [];
  if (fuelSelectedVehicleId) {
    const hit = list.find((v) => Number(v.id) === Number(fuelSelectedVehicleId));
    if (hit) return hit;
  }
  const chosen = fuelChoiceId({ vehicles: list });
  if (chosen) {
    const hit = list.find((v) => Number(v.id) === chosen);
    if (hit) return hit;
  }
  return list.length === 1 ? list[0] : null;
}

function fuelChoiceId(parsed) {
  const list = (parsed && parsed.vehicles) || [];
  const last = Number(parsed && parsed.lastVehicleId) || 0;
  if (last > 0 && list.some((v) => Number(v.id) === last)) return last;
  const ids = [
    ...new Set(
      list
        .filter((v) => v && v.active)
        .map((v) => Number(v.id))
        .filter((id) => id > 0),
    ),
  ];
  return ids.length === 1 ? ids[0] : 0;
}

let lastFuelSnapAt = 0;
let fuelSnapTries = 0;

function requestFuelSnapshot(force) {
  const cached = loadFuelSnap();
  const hasVeh = (cached.vehicles || []).length > 0;
  if (!force && hasVeh && Date.now() - lastFuelSnapAt < 45000) return;
  lastFuelSnapAt = Date.now();
  const ok = fuelControl('snapshot');
  void fetchFuelViaHuberaId();
  window.setTimeout(() => {
    const list = (loadFuelSnap().vehicles || []).length;
    if (list > 0) {
      fuelSnapTries = 0;
      return;
    }
    void fetchFuelViaHuberaId();
    if (ok && fuelSnapTries < 3) {
      fuelSnapTries += 1;
      const extra = fuelSnapTries >= 2 ? { preferLegacy: '1' } : {};
      fuelControl('snapshot', extra);
      renderFuelHome();
    }
  }, 1600);
}

function suiteToken() {
  try {
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.token) {
      return String(HuberaSuite.token() || '').trim();
    }
  } catch {
    /* native absent */
  }
  return '';
}

function mergeFuelPlaces(places) {
  if (!Array.isArray(places) || !places.length) return;
  const p = loadPlaces();
  let changed = false;
  for (const pl of places) {
    const lat = Number(pl.latitude != null ? pl.latitude : pl.lat);
    const lon = Number(pl.longitude != null ? pl.longitude : pl.lon);
    const addr = String(pl.address || pl.name || '').trim();
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !addr) continue;
    const kind = String(pl.type || pl.kind || '').toLowerCase();
    const row = { label: addr, lat, lon };
    if ((kind === 'home' || kind === 'maison') && !p.home) {
      p.home = { ...row, nick: pl.name || 'Maison' };
      changed = true;
      continue;
    }
    if ((kind === 'work' || kind === 'travail') && !p.work) {
      p.work = { ...row, nick: pl.name || 'Travail' };
      changed = true;
      continue;
    }
    const exists = (p.saved || []).some(
      (s) => s && Math.abs(s.lat - lat) < 1e-4 && Math.abs(s.lon - lon) < 1e-4,
    );
    if (!exists) {
      p.saved = p.saved || [];
      p.saved.push({
        label: pl.name && pl.name !== addr ? `${pl.name} · ${addr}` : addr,
        lat,
        lon,
      });
      changed = true;
    }
  }
  if (changed) {
    savePlaces(p);
    renderSaved();
  }
}

function applyFuelHttpSnap(data) {
  if (!data || !Array.isArray(data.vehicles) || !data.vehicles.length) return false;
  const snap = {
    vehicles: data.vehicles
      .map((v) => ({
        id: Number(v.id),
        name: v.name || `Véhicule ${v.id}`,
        pct: Number.isFinite(Number(v.pct)) ? Number(v.pct) : -1,
        active: Boolean(v.isActive || v.isDefault),
        tank: Number(v.tankCapacity || v.tank) || 0,
        liters: Number.isFinite(Number(v.liters)) ? Number(v.liters) : -1,
        l100: Number(v.l100 || v.avgConsumption || v.consumptionPer100) || 0,
      }))
      .filter((v) => Number.isFinite(v.id) && v.id > 0),
    fills: Array.isArray(data.fills)
      ? data.fills.map((f) => ({
          date: f.date || '',
          liters: Number(f.liters) || 0,
          cost: Number(f.cost) || 0,
          station: f.station || '',
          vehicleId: Number(f.vehicleId) || 0,
        }))
      : loadFuelSnap().fills || [],
    budget: data.budget && typeof data.budget === 'object' ? data.budget : loadFuelSnap().budget,
  };
  if (!snap.vehicles.length) return false;
  const flagged = snap.vehicles.filter((v) => v.active).map((v) => Number(v.id));
  if (flagged.length === 1) snap.lastVehicleId = flagged[0];
  else snap.vehicles.forEach((v) => { v.active = false; });
  saveFuelSnap(snap);
  applyFuelSnapDefaultVehicle(snap, 'http');
  mergeFuelPlaces(data.places);
  fuelSnapTries = 0;
  lastFuelSnapAt = Date.now();
  renderFuelHome();
  try {
    paintFuelSheetBody();
    paintFuelPeek();
  } catch {
    /* panneaux absents */
  }
  return true;
}

async function fetchFuelViaHuberaId() {
  try {
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.refreshFuel) {
      HuberaSuite.refreshFuel();
    }
  } catch {
    /* native */
  }
  const token = suiteToken();
  if (!token) return false;
  const urls = [
    'https://fuel.hubera.cloud/api/maps/vehicles',
    'https://gasoil-tracking.hubera.cloud/api/maps/vehicles',
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (applyFuelHttpSnap(j)) return true;
    } catch {
      /* hôte suivant */
    }
  }
  return false;
}

window.__mapsFuelReady = function () {
  try {
    if (typeof HuberaSuite === 'undefined' || !HuberaSuite.takeFuelSnap) return;
    const raw = HuberaSuite.takeFuelSnap() || '';
    if (!raw) return;
    applyFuelHttpSnap(JSON.parse(raw));
  } catch {
    /* ignore */
  }
};

function fuelAppInstalled() {
  try {
    if (window.HuberaFuel && typeof window.HuberaFuel.isInstalled === 'function') {
      return !!window.HuberaFuel.isInstalled();
    }
  } catch {
    /* hors APK */
  }
  return true;
}

function openFuelApp() {
  try {
    if (window.HuberaFuel && typeof window.HuberaFuel.openApp === 'function') {
      window.HuberaFuel.openApp();
      return true;
    }
  } catch {
    /* WebView hors APK */
  }
  if (!fuelAppInstalled()) {
    location.href = 'https://fuel.hubera.cloud/install';
    return false;
  }
  location.href = 'https://fuel.hubera.cloud';
  return false;
}

function applyFuelSnapDefaultVehicle(parsed, source) {
  const list = (parsed && parsed.vehicles) || [];
  const fuelActive = fuelChoiceId(parsed);
  const saved = loadSelectedFuelVehicleId();
  const seen = loadFuelVehNumber(FUEL_VEH_SEEN_KEY);
  const locked = fuelUserPickedVehicle || userLockedFuelVehicle();
  const inList = (id) => id > 0 && list.some((v) => Number(v.id) === Number(id));
  if (source === 'http' && (locked || seen)) {
    if (locked && inList(saved)) setSelectedFuelVehicle(saved, false);
    return;
  }
  if (locked && inList(saved)) {
    const fuelChanged =
      source !== 'http' &&
      fuelActive &&
      seen &&
      fuelActive !== seen &&
      fuelActive !== Number(saved) &&
      inList(fuelActive);
    if (fuelChanged) {
      setSelectedFuelVehicle(fuelActive, true);
      rememberSeenFuelActive(fuelActive);
      return;
    }
    if (fuelActive) rememberSeenFuelActive(fuelActive);
    setSelectedFuelVehicle(saved, false);
    return;
  }
  if (fuelActive && inList(fuelActive)) {
    setSelectedFuelVehicle(fuelActive, false);
    rememberSeenFuelActive(fuelActive);
    return;
  }
  if (list.length === 1 && Number(list[0].id) > 0) {
    setSelectedFuelVehicle(list[0].id, false);
    return;
  }
  if (!locked) setSelectedFuelVehicle(0, false);
}

function vehicleChipsHtml() {
  const snap = loadFuelSnap();
  const veh = activeFuelVehicle();
  const list = snap.vehicles || [];
  if (!list.length) return '';
  return (
    `<div class="fuel-veh-row">` +
    list
      .map(
        (v) =>
          `<button type="button" class="fuel-veh${veh && v.id === veh.id ? ' on' : ''}" data-vid="${v.id}">${esc(v.name)}</button>`,
      )
      .join('') +
    `</div>`
  );
}

function bindFuelVehicleChips(root) {
  if (!root) return;
  root.querySelectorAll('[data-vid]').forEach((b) => {
    b.onclick = () => {
      const id = Number(b.dataset.vid);
      if (!Number.isFinite(id) || id <= 0) return;
      setSelectedFuelVehicle(id, true);
      fuelUserPickedVehicle = true;
      fuelControl('select', { vehicleId: id });
      renderFuelHome();
      paintFuelSheetBody();
      paintFuelPeek();
    };
  });
}

function dashPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('hubera_maps_dash') || '{}');
    return { open: !!p.open, ac: !!p.ac, heat: !!p.heat, deg: Number.isFinite(Number(p.deg)) ? Number(p.deg) : 20 };
  } catch (_) {
    return { open: false, ac: false, heat: false, deg: 20 };
  }
}

function saveDash(p) {
  localStorage.setItem('hubera_maps_dash', JSON.stringify(p));
}

function comfortFactor(p) {
  let f = 1;
  if (p.ac) f += 0.08;
  if (p.heat) f += 0.06;
  if (p.deg < 5) f += 0.05;
  if (p.deg > 28) f += 0.04;
  return f;
}

function dashControlsHtml() {
  const p = dashPrefs();
  const factor = comfortFactor(p);
  return (
    `<div class="comfort-row">` +
    `<button type="button" id="dashAc" class="${p.ac ? 'on' : ''}" role="switch" aria-checked="${p.ac ? 'true' : 'false'}">Clim ${p.ac ? 'on' : 'off'}</button>` +
    `<button type="button" id="dashHeat" class="${p.heat ? 'on' : ''}" role="switch" aria-checked="${p.heat ? 'true' : 'false'}">Chauffage ${p.heat ? 'on' : 'off'}</button>` +
    `<button type="button" id="dashDegOpen">${p.deg}°</button>` +
    `</div>` +
    `<div class="dash-note">Estimation locale de conso × ${factor.toFixed(2)} (clim ou chauffage, température).</div>`
  );
}

function openComfortGauge() {
  let sheet = document.getElementById('comfortSheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = 'comfortSheet';
    sheet.className = 'sheet';
    document.body.appendChild(sheet);
  }
  const p = dashPrefs();
  const ticks = [-5, 0, 10, 18, 21, 24, 28, 35];
  sheet.hidden = false;
  sheet.innerHTML =
    `<div class="route-head"><strong>Température habitacle</strong>` +
    `<button type="button" class="panel-close" id="comfortClose" aria-label="Fermer">✕</button></div>` +
    `<div style="font-size:36px;font-weight:800;text-align:center;margin:8px 0">${p.deg}°</div>` +
    `<div class="comfort-row">` +
    ticks.map((n) => `<button type="button" data-deg="${n}" class="${n === p.deg ? 'on' : ''}">${n}</button>`).join('') +
    `</div>`;
  const close = sheet.querySelector('#comfortClose');
  if (close) close.onclick = () => { sheet.hidden = true; };
  sheet.querySelectorAll('[data-deg]').forEach((b) => {
    b.onclick = () => {
      const d = dashPrefs();
      d.deg = Number(b.dataset.deg);
      d.open = true;
      saveDash(d);
      sheet.hidden = true;
      renderFuelHome();
      paintTripInfoMenu();
    };
  });
}

function bindDashControls(root) {
  if (!root) return;
  const ac = root.querySelector('#dashAc');
  const heat = root.querySelector('#dashHeat');
  const deg = root.querySelector('#dashDegOpen');
  const refresh = () => {
    renderFuelHome();
    paintTripInfoMenu();
  };
  if (ac) ac.onclick = (e) => {
    e.stopPropagation();
    const p = dashPrefs();
    p.ac = !p.ac;
    if (p.ac) p.heat = false;
    p.open = true;
    saveDash(p);
    refresh();
  };
  if (heat) heat.onclick = (e) => {
    e.stopPropagation();
    const p = dashPrefs();
    p.heat = !p.heat;
    if (p.heat) p.ac = false;
    p.open = true;
    saveDash(p);
    refresh();
  };
  if (deg) deg.onclick = (e) => {
    e.stopPropagation();
    openComfortGauge();
  };
}

function renderFuelHome() {
  const home = document.getElementById('fuelHome');
  if (!home) return;
  const veh = activeFuelVehicle();
  const live = mapsStartedFuel || Number(fuelTrip) > 0;
  const pct = veh && veh.pct >= 0 ? veh.pct : null;
  const chips = vehicleChipsHtml();
  const emptyGarage =
    `<p class="page-hint">${fuelSnapTries ? 'Garage encore vide — Fuel n’a pas renvoyé de véhicule.' : 'Chargement du garage Fuel…'}</p>` +
    `<div class="fuel-actions">` +
    `<button type="button" class="primary" id="fuelHomeRetry">Réessayer</button>` +
    `<button type="button" class="ghost" id="fuelHomeOpenEmpty">Ouvrir Hubera Fuel</button>` +
    `</div>`;
  const gaugeLabel = pct != null ? `${pct} %` : '—';
  const gaugeSub = veh
    ? pct != null
      ? `Réservoir ${pct} % · ${veh.name}`
      : `${veh.name} — jauge dès le snapshot Fuel`
    : fuelAppInstalled()
      ? 'Chargement du véhicule de ce compte…'
      : 'Installe Hubera Fuel (app indépendante) pour le garage';
  if (!fuelAppInstalled()) {
    home.innerHTML =
      `<div class="fuel-panel">` +
      `<div class="fuel-gauge-card">` +
      `<div class="lab">Hubera Fuel</div>` +
      `<div class="pct">App</div>` +
      `<div class="lab" style="margin-top:8px">${esc(gaugeSub)}</div>` +
      `</div>` +
      `<div class="fuel-actions">` +
      `<button type="button" class="primary" id="fuelHomeInstall">Installer Hubera Fuel</button>` +
      `</div></div>`;
    const inst = document.getElementById('fuelHomeInstall');
    if (inst) inst.onclick = () => openFuelApp();
    return;
  }
  const dash = dashPrefs();
  const gaugeBlock = dash.open
    ? `<div class="fuel-gauge-card">` +
      `<div class="lab">${esc(veh ? veh.name : 'Véhicule')}</div>` +
      `<div class="pct">${esc(gaugeLabel)}</div>` +
      `<div class="lab" style="margin-top:8px">${esc(gaugeSub)}</div>` +
      `<button type="button" class="hubera-open" id="fuelHomeOpenApp">Ouvrir Hubera Fuel</button>` +
      `</div>`
    : '';
  home.innerHTML =
    `<div class="fuel-panel">` +
    (chips || emptyGarage) +
    dashControlsHtml() +
    gaugeBlock +
    `<div class="fuel-actions${live ? ' live' : ''}">` +
    (live
      ? `<button type="button" class="ghost" id="fuelHomePause">Pause</button>` +
        `<button type="button" class="ghost" id="fuelHomeStop">Arrêter</button>` +
        `<button type="button" class="primary" id="fuelHomeFill">Ajouter un plein</button>`
      : `<button type="button" class="primary" id="fuelHomeStart">Démarrer un trajet</button>` +
        `<button type="button" class="ghost" id="fuelHomeFill">Ajouter un plein</button>`) +
    `</div></div>`;
  const start = document.getElementById('fuelHomeStart');
  const pause = document.getElementById('fuelHomePause');
  const stop = document.getElementById('fuelHomeStop');
  const fill = document.getElementById('fuelHomeFill');
  const openApp = document.getElementById('fuelHomeOpenApp');
  const retry = document.getElementById('fuelHomeRetry');
  const openEmpty = document.getElementById('fuelHomeOpenEmpty');
  if (start) start.onclick = () => startFuelTrip();
  if (pause) pause.onclick = () => document.getElementById('btnPause')?.click();
  if (stop) stop.onclick = () => fuelStopTracking();
  if (fill) fill.onclick = () => openFillSheet();
  if (openApp) openApp.onclick = () => openFuelApp();
  if (retry) retry.onclick = () => requestFuelSnapshot(true);
  if (openEmpty) openEmpty.onclick = () => openFuelApp();
  bindFuelVehicleChips(home);
  bindDashControls(home);
}

function paintFuelPeek() {
  const kmEl = document.getElementById('fuelPeekKm');
  const sub = document.getElementById('fuelPeekSub');
  const title = document.getElementById('fuelPeekTitle');
  const fill = document.getElementById('fuelGaugeFill');
  const rows = loadCachedFuelTrips();
  const todayKm = rows.filter((t) => (t.start || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).reduce((s, t) => s + (t.km || 0), 0);
  const veh = activeFuelVehicle();
  const pct = veh && veh.pct >= 0 ? veh.pct : null;
  if (fill) fill.style.width = pct == null ? '0%' : `${pct}%`;
  if (kmEl) kmEl.textContent = pct != null ? `${pct} %` : todayKm > 0 ? `${todayKm.toFixed(1)} km` : '';
  if (title) title.textContent = mapsStartedFuel ? 'Trajet en cours' : veh ? veh.name : 'Fuel';
  if (sub) {
    sub.textContent = mapsStartedFuel
      ? `${liveFuelKm().toFixed(1)} km · pause / plein / arrêter`
      : pct != null
        ? `Jauge réservoir ${pct} % · tap pour Fuel`
        : 'Tap : véhicules, plein, budget';
  }
  paintTripInfoMenu();
}

function paintFuelSheetBody() {
  const body = document.getElementById('fuelSheetBody');
  if (!body) return;
  const sub = document.querySelector('#fuelSub button.on');
  const which = (sub && sub.dataset.fsub) || 'trips';
  if (which === 'trips') {
    body.innerHTML =
      `<div class="row" style="margin-bottom:10px">` +
      `<button type="button" class="act primary" id="sheetTrack">Démarrer un trajet</button>` +
      `<button type="button" class="act ghost" id="sheetRefresh">Actualiser</button></div>` +
      `<div id="fuelTripList"></div>`;
    const st = document.getElementById('sheetTrack');
    const rf = document.getElementById('sheetRefresh');
    if (st) st.onclick = () => { closeFuelSheet(); startFuelTrip(); };
    if (rf) rf.onclick = () => requestFuelHistory(true);
    renderFuelTripList();
    return;
  }
  if (which === 'fills') {
    requestFuelSnapshot(true);
    const veh = activeFuelVehicle();
    const rows = (loadFuelSnap().fills || []).filter(
      (f) => !veh || !f.vehicleId || f.vehicleId === veh.id,
    );
    const list = rows.length
      ? rows
          .map(
            (f) =>
              `<div class="item">${esc(String(f.date || '').slice(0, 16))} · ${Number(f.liters) || 0} L · ${Number(f.cost) || 0} €${f.station ? ` · ${esc(f.station)}` : ''}</div>`,
          )
          .join('')
      : `<div class="item">${veh ? `Aucun plein reçu pour ${esc(veh.name)}.` : 'Aucun plein reçu de Fuel.'} Actualise après un plein dans Hubera Fuel.</div>`;
    body.innerHTML =
      `<p class="page-hint">Pleins du véhicule sélectionné, lus dans Fuel.</p>` +
      list +
      `<button type="button" class="primary" id="sheetFill" style="width:100%;margin-top:10px">Nouveau plein</button>`;
    const b = document.getElementById('sheetFill');
    if (b) b.onclick = () => {
      closeFuelSheet();
      const fillSheet = document.getElementById('fillSheet');
      if (fillSheet) fillSheet.hidden = false;
    };
    return;
  }
  if (which === 'garage') {
    const veh = activeFuelVehicle();
    const chips = vehicleChipsHtml();
    requestFuelSnapshot();
    body.innerHTML =
      `<p class="page-hint">Le véhicule actif de ton compte Fuel est pré-sélectionné. Tape un autre chip pour changer.</p>` +
      (chips || `<div class="item">${veh ? esc(veh.name) : 'Garage Fuel — snapshot en cours'}</div>`) +
      (veh
        ? `<div class="fuel-gauge-card" style="margin-top:12px"><div class="lab">Véhicule sélectionné</div><div class="pct" style="font-size:20px">${esc(veh.name)}</div><div class="lab">${veh.pct >= 0 ? `Réservoir ${veh.pct} %` : 'Jauge dès le snapshot'}</div></div>`
        : '') +
      `<button type="button" class="hubera-open" id="sheetOpenFuel">Ouvrir Hubera Fuel</button>`;
    const b = document.getElementById('sheetOpenFuel');
    if (b) b.onclick = () => openFuelApp();
    bindFuelVehicleChips(body);
    return;
  }
  body.innerHTML =
    `<p class="page-hint">Budget et trajets réguliers : même base Fuel, écran Maps.</p>` +
    `<div class="item">Septembre — enveloppe (aperçu)</div>`;
}

function openFuelSheet() {
  const el = document.getElementById('fuelSheet');
  if (!el) return;
  el.classList.add('open');
  document.body.classList.add('fuel-sheet-open');
  paintFuelSheetBody();
  requestFuelHistory(true);
}

function closeFuelSheet() {
  const el = document.getElementById('fuelSheet');
  if (el) el.classList.remove('open');
  document.body.classList.remove('fuel-sheet-open');
}

function renderFuelUxPage() {
  const body = document.getElementById('fuelUxBody');
  if (!body) return;
  const cur = fuelUxId();
  body.innerHTML =
    `<p class="page-hint">Choisis une piste Fuel dans Maps. Mix 2+7+10 = feuille + HUD + GPS Fuel silencieux. Ce que tu gardes devient l’écran du quotidien.</p>` +
    FUEL_UX_OPTS.map(
      (o) =>
        `<button type="button" class="ux-card${cur === o.id ? ' on' : ''}" data-ux="${o.id}"><b>${esc(o.title)}</b><span>${esc(o.hint)}</span></button>`,
    ).join('');
}

function showFuelRecap() {
  const km = liveFuelKm();
  const rows = loadCachedFuelTrips();
  const similar = rows[0] ? fuelSimilarNote({ origin: rows[0].origin, dest: rows[0].dest, id: -1, km }, rows) : '';
  toast(`Trajet terminé · ${km.toFixed(1)} km${similar ? ' · ' + similar : ''}`);
}

function renderSettings() {
  const body = document.getElementById('settingsBody');
  if (!body) return;
  const night = nightPref();
  const voice = voiceEnabled();
  const dock = musicDockOn();
  const mode = travelMode;
  const id = loadId();
  body.innerHTML =
    `<p class="page-hint">Compte ${esc(id.email)} · Maps ${esc(appVersionLabel())}</p>` +
    `<div class="set-row"><div><div class="lab">Notifications sonores</div><div class="hint">Annonces de guidage</div></div>` +
    `<div class="seg"><button type="button" class="choice${voice ? ' on' : ''}" data-set="voice" data-val="1">On</button>` +
    `<button type="button" class="choice${voice ? '' : ' on'}" data-set="voice" data-val="0">Off</button></div></div>` +
    `<div class="set-row"><div><div class="lab">Carte nuit</div><div class="hint">Auto = 21h–6h</div></div>` +
    `<div class="seg">` +
    ['auto', 'on', 'off']
      .map(
        (v) =>
          `<button type="button" class="choice${night === v ? ' on' : ''}" data-set="night" data-val="${v}">${
            v === 'auto' ? 'Auto' : v === 'on' ? 'Nuit' : 'Jour'
          }</button>`,
      )
      .join('') +
    `</div></div>` +
    `<div class="set-row"><div><div class="lab">Mode de déplacement</div><div class="hint">Par défaut pour les itinéraires</div></div>` +
    `<div class="seg">` +
    TRAVEL_MODES.map(
      ([idm, lab]) =>
        `<button type="button" class="choice${mode === idm ? ' on' : ''}" data-set="mode" data-val="${idm}">${lab}</button>`,
    ).join('') +
    `</div></div>` +
    `<div class="set-row"><div><div class="lab">Barre Music</div><div class="hint">Dock en bas de l’écran</div></div>` +
    `<div class="seg"><button type="button" class="choice${dock ? ' on' : ''}" data-set="dock" data-val="1">On</button>` +
    `<button type="button" class="choice${dock ? '' : ' on'}" data-set="dock" data-val="0">Off</button></div></div>` +
    `<div class="set-row"><div><div class="lab">Logo Fuel</div><div class="hint">En bas de la carte : Pause, Arrêter, Plein</div></div>` +
    `<div class="seg"><button type="button" class="choice${fuelLogoOn() ? ' on' : ''}" data-set="fuellogo" data-val="1">On</button>` +
    `<button type="button" class="choice${fuelLogoOn() ? '' : ' on'}" data-set="fuellogo" data-val="0">Off</button></div></div>` +
    `<div class="set-row"><div><div class="lab">Mise à jour</div><div class="hint">Installer depuis Maps, sans Chrome</div></div>` +
    `<div class="seg"><button type="button" class="choice" data-set="update">Vérifier</button></div></div>` +
    `<div class="set-row"><div><div class="lab">Comparer Fuel</div><div class="hint">Pistes UX (onglet Fuel intégré par défaut)</div></div>` +
    `<div class="seg"><button type="button" class="choice" data-set="fuelux">Ouvrir</button></div></div>` +
    `<div class="set-row"><div><div class="lab">Cartes hors ligne</div><div class="hint">Télécharger une zone (Maison, ici…)</div></div>` +
    `<div class="seg"><button type="button" class="choice" data-set="goto-offline">Ouvrir</button></div></div>`;
}

function applySetting(set, val) {
  if (set === 'voice') {
    setVoiceEnabled(val === '1');
    toast(val === '1' ? 'Notifications sonores activées' : 'Notifications sonores coupées');
  } else if (set === 'night') {
    localStorage.setItem(NIGHT_KEY, val);
    nightOn = null;
    applyTiles();
  } else if (set === 'mode') {
    setTravelMode(val);
  } else if (set === 'dock') {
    setMusicDock(val === '1');
  } else if (set === 'fuellogo') {
    setFuelLogo(val === '1');
    toast(val === '1' ? 'Logo Fuel en bas de carte' : 'Barre Fuel classique');
  } else if (set === 'update') {
    try {
      if (typeof HuberaUpdate !== 'undefined' && HuberaUpdate.check) HuberaUpdate.check();
      else toast('MAJ disponible dans l’app Android');
    } catch {
      toast('MAJ indisponible');
    }
  } else if (set === 'goto-offline') {
    setTab('offline');
    return;
  } else if (set === 'fuelux') {
    setTab('fuelux');
    return;
  }
  renderSettings();
}

function offlineStatus() {
  try {
    if (typeof HuberaOffline !== 'undefined' && HuberaOffline.status) {
      return JSON.parse(HuberaOffline.status() || '{}');
    }
  } catch {
    /* web */
  }
  return { tiles: 0, bytes: 0, packs: [], downloading: false };
}

function renderOffline() {
  const body = document.getElementById('offlineBody');
  if (!body) return;
  const native = typeof HuberaOffline !== 'undefined' && HuberaOffline.download;
  const st = offlineStatus();
  const packs = Array.isArray(st.packs) ? st.packs : [];
  const p = loadPlaces();
  const pct = st.total ? Math.round((100 * (st.done || 0)) / st.total) : 0;
  const progress = st.downloading
    ? `<div class="bar"><i style="width:${pct}%"></i></div><p class="page-hint">${esc(st.name || 'Téléchargement')} · ${st.done || 0}/${st.total || 0} tuiles</p>`
    : '';
  const packHtml = packs.length
    ? packs
        .map(
          (x) =>
            `<div class="pack"><strong>${esc(x.name || 'Zone')}</strong><div class="meta">${x.tiles || 0} tuiles</div></div>`,
        )
        .join('')
    : '<p class="page-hint">Aucune zone enregistrée pour l’instant.</p>';
  const actions = native
    ? `<div class="page-actions" style="padding:0 0 8px">` +
      (me
        ? `<button type="button" class="primary" data-off="here">Autour de moi</button>`
        : '') +
      (p.home
        ? `<button type="button" class="ghost" data-off="home">Maison</button>`
        : '') +
      (p.work
        ? `<button type="button" class="ghost" data-off="work">Travail</button>`
        : '') +
      (st.downloading
        ? `<button type="button" class="ghost" data-off="cancel">Annuler</button>`
        : '') +
      (st.tiles
        ? `<button type="button" class="ghost" data-off="clear">Tout effacer</button>`
        : '') +
      `</div>`
    : `<p class="page-hint">Le téléchargement hors ligne fonctionne dans l’app Android Hubera Maps (pas dans le navigateur).</p>`;
  body.innerHTML =
    `<p class="page-hint">Cache ${fmtBytes(st.bytes)} · ${st.tiles || 0} tuiles (zooms 12–16, ~5 km). OSM public, usage raisonnable.</p>` +
    progress +
    actions +
    packHtml;
}

function startOfflinePack(kind) {
  if (typeof HuberaOffline === 'undefined' || !HuberaOffline.download) {
    toast('Hors ligne : installe l’app Maps');
    return;
  }
  const p = loadPlaces();
  let lat = me?.lat;
  let lon = me?.lon;
  let name = 'Autour de moi';
  if (kind === 'home' && p.home) {
    lat = p.home.lat;
    lon = p.home.lon;
    name = 'Maison';
  } else if (kind === 'work' && p.work) {
    lat = p.work.lat;
    lon = p.work.lon;
    name = 'Travail';
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    toast(kind === 'home' ? 'Enregistre d’abord Maison.' : kind === 'work' ? 'Enregistre d’abord Travail.' : 'Position pas encore trouvée.');
    return;
  }
  toast(`Téléchargement « ${name} »…`);
  HuberaOffline.download(String(lat), String(lon), name);
  renderOffline();
}

window.__mapsOfflineEvent = function () {
  if (activeTab === 'offline') renderOffline();
};

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
  if ((id === 'trips' || id === 'fills' || id === 'budget') && usesFuelSheet()) {
    setTab('maps');
    if (id === 'fills') {
      document.querySelectorAll('#fuelSub button').forEach((b) => b.classList.toggle('on', b.dataset.fsub === 'fills'));
    }
    if (id === 'budget') {
      document.querySelectorAll('#fuelSub button').forEach((b) => b.classList.toggle('on', b.dataset.fsub === 'budget'));
    }
    openFuelSheet();
    return;
  }
  if (id === 'trips') {
    fuelCardCollapsed = false;
    document.body.classList.remove('fuel-card-collapsed');
  }
  activeTab = id;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  const pageFuel = document.getElementById('pageFuel');
  if (pageFuel) pageFuel.hidden = id !== 'trips';
  panelFuel.hidden = true;
  pageSaved.hidden = id !== 'saved';
  if (pageSettings) pageSettings.hidden = id !== 'settings';
  if (pageOffline) pageOffline.hidden = id !== 'offline';
  if (pageFuelUx) pageFuelUx.hidden = id !== 'fuelux';
  const overlay = id === 'saved' || id === 'settings' || id === 'offline' || id === 'fuelux';
  if (topChrome && topChrome.style) topChrome.style.visibility = overlay ? 'hidden' : '';
  if (roadSignEl) roadSignEl.hidden = overlay;
  const signs = document.getElementById('navSigns');
  if (signs) signs.hidden = overlay;
  if (btnHere) btnHere.hidden = id !== 'maps' && id !== 'trips';
  if (id !== 'maps' && id !== 'trips') {
    sheetEl.hidden = true;
    if (altsEl) altsEl.hidden = true;
  } else if (navigating) {
    enterNavUi();
  } else if (routeChoices.length) {
    renderAlts();
  }
  if (id === 'saved') renderSaved();
  if (id === 'trips') {
    syncChromeHeight();
    renderFuelHome();
    requestFuelSnapshot(true);
  }
  if (id === 'settings') renderSettings();
  if (id === 'offline') renderOffline();
  if (id === 'fuelux') renderFuelUxPage();
  placeRoadSign();
  closeDrawer();
}

window.__mapsDismissSearch = function () {
  const open =
    (hitsEl && !hitsEl.hidden) ||
    document.body.classList.contains('kb') ||
    (qEl && document.activeElement === qEl);
  if (!open) return false;
  dismissSearchChrome();
  return true;
};

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
  const fuelSheet = document.getElementById('fuelSheet');
  if (fuelSheet && fuelSheet.classList.contains('open')) {
    closeFuelSheet();
    return true;
  }
  const detour = document.getElementById('detourOffer');
  if (detour && !detour.hidden) {
    ignoreDetourOffer();
    return true;
  }
  if (sheetEl && !sheetEl.hidden && sheetEl.querySelector('#paClose')) {
    closePlaceSheet();
    return true;
  }
  if (!navigating && routeCardEl && !routeCardEl.hidden) {
    dismissRoutePreview();
    return true;
  }
  if (window.__mapsDismissSearch()) return true;
  if (activeTab === 'trips' || activeTab === 'saved' || activeTab === 'settings' || activeTab === 'offline' || activeTab === 'fuelux') {
    setTab('maps');
    return true;
  }
  if (navigating) {
    collapseNavHud();
    renderAlts();
    return true;
  }
  if (altsEl && !altsEl.hidden) {
    altsEl.hidden = true;
    if (routeCardEl) routeCardEl.hidden = true;
    clearRoute();
    return true;
  }
  if (routeCardEl && !routeCardEl.hidden) {
    dismissRoutePreview();
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
  if (ignoreSearchInput || suggestSuppressed()) return;
  syncClear();
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  const gen = searchGen;
  searchTimer = setTimeout(() => {
    if (gen !== searchGen || suggestSuppressed()) return;
    showSuggestHits(q).catch(() => {
      if (gen === searchGen) showHits([]);
    });
  }, q.length < 2 ? 0 : 220);
});

qEl.addEventListener('focus', () => {
  document.body.classList.add('kb');
  syncClear();
  if (suggestSuppressed()) return;
  if (!qEl.value.trim()) void showSuggestHits('');
});
qEl.addEventListener('blur', () => {
  window.setTimeout(() => {
    if (document.activeElement === qEl) {
      syncClear();
      return;
    }
    document.body.classList.remove('kb');
    const ae = document.activeElement;
    const onHit = ae && ae.closest && ae.closest('#hits');
    if (!onHit) dismissSearchChrome();
    syncClear();
  }, 180);
});

if (window.visualViewport) {
  const vv = window.visualViewport;
  let kbWasOpen = false;
  const applyKb = () => {
    const kb = window.innerHeight - vv.height > 90;
    const focused = document.activeElement === qEl;
    document.body.classList.toggle('kb', kb || focused);
    if (kb) kbWasOpen = true;
    else if (kbWasOpen && focused && hitsEl && !hitsEl.hidden) {
      kbWasOpen = false;
      dismissSearchChrome();
    } else if (!kb) kbWasOpen = false;
  };
  vv.addEventListener('resize', applyKb);
}

btnClear.addEventListener('click', () => {
  qEl.value = '';
  dismissSearchChrome();
});

document.getElementById('searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  qEl.blur();
  const first = hitsEl.querySelector('.hit:not(.here)') || hitsEl.querySelector('.hit');
  if (first) first.click();
});

hitsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('.hit');
  if (!btn) return;
  showHits([]);
  qEl.blur();
  ignoreSearchInput = true;
  window.setTimeout(() => {
    ignoreSearchInput = false;
  }, 800);
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
        locMissToast();
      }
    })();
    return;
  }
  qEl.value = btn.dataset.label;
  syncClear();
  setTab('maps');
  if (btn.dataset.query) {
    searchPhoton(btn.dataset.query).then((hits) => {
      if (hits[0]) void openSearchPlace(hits[0].lat, hits[0].lon, btn.dataset.label, hits[0]);
      else toast('Adresse Contacts introuvable');
    });
    return;
  }
  void openSearchPlace(
    Number(btn.dataset.lat),
    Number(btn.dataset.lon),
    btn.dataset.label,
    {
      osmId: btn.dataset.osmId,
      osmType: btn.dataset.osmType,
      name: btn.dataset.name,
    },
  );
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
    openPlaceActions(kind, place);
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
  collapseNavHud();
  renderAlts();
});
const tripInfoToggle = document.getElementById('tripInfoToggle');
if (tripInfoToggle) tripInfoToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleTripInfo();
});
const tripInfoPanel = document.getElementById('tripInfoPanel');
if (tripInfoPanel) tripInfoPanel.addEventListener('click', (e) => {
  e.stopPropagation();
  e.preventDefault();
});
for (const id of ['fuelCardFold', 'fuelPageFold', 'fuelCardHandle']) {
  const el = document.getElementById(id);
  if (!el) continue;
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleFuelCard();
  });
}
  if (roadSignEl) {
  roadSignEl.addEventListener('click', () => {
    if (navigating || tripPlanning()) toggleTripInfo();
  });
  roadSignEl.addEventListener('keydown', (e) => {
    if (!navigating && !tripPlanning()) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleTripInfo();
    }
  });
}
document.getElementById('btnVoiceNav').addEventListener('click', () => {
  const on = !voiceEnabled();
  setVoiceEnabled(on);
  toast(on ? 'Notifications sonores activées' : 'Notifications sonores coupées');
  if (on && navigating) speakNav('Guidage vocal activé', 0);
});
document.getElementById('btnUser').addEventListener('click', () => {
  if (typeof HuberaSuite !== 'undefined' && HuberaSuite.openAccountChooser) {
    HuberaSuite.openAccountChooser();
    return;
  }
  openDrawer();
});
const btnSettingsGear = document.getElementById('btnSettingsGear');
if (btnSettingsGear) btnSettingsGear.addEventListener('click', () => setTab('settings'));
document.getElementById('drawerAvatar').addEventListener('click', openDrawer);
document.getElementById('btnSavedBack').addEventListener('click', () => setTab('maps'));
const btnSettingsBack = document.getElementById('btnSettingsBack');
if (btnSettingsBack) btnSettingsBack.addEventListener('click', () => setTab('maps'));
const btnOfflineBack = document.getElementById('btnOfflineBack');
if (btnOfflineBack) btnOfflineBack.addEventListener('click', () => setTab('maps'));
const settingsBody = document.getElementById('settingsBody');
if (settingsBody) {
  settingsBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-set]');
    if (!btn) return;
    applySetting(btn.dataset.set, btn.dataset.val);
  });
}
const offlineBody = document.getElementById('offlineBody');
if (offlineBody) {
  offlineBody.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-off]');
    if (!btn) return;
    const kind = btn.dataset.off;
    if (kind === 'cancel') {
      try {
        HuberaOffline.cancel();
      } catch {
        /* ignore */
      }
      renderOffline();
      return;
    }
    if (kind === 'clear') {
      try {
        HuberaOffline.clear();
      } catch {
        /* ignore */
      }
      toast('Cache hors ligne effacé');
      renderOffline();
      return;
    }
    startOfflinePack(kind);
  });
}
document.getElementById('btnDefineHome').addEventListener('click', () => startAssign('home'));
document.getElementById('btnDefineWork').addEventListener('click', () => startAssign('work'));
scrim.addEventListener('click', closeDrawer);
document.getElementById('btnCloseDrawer')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  closeDrawer();
});
(() => {
  let drag = null;
  const track = (x, y, id) => {
    drag = { x, y, id };
  };
  const move = (x, y, id, ev) => {
    if (!drag || id !== drag.id || !drawer.classList.contains('open')) return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) ev.preventDefault();
    if (dx < -28 && Math.abs(dx) > Math.abs(dy)) {
      drag = null;
      closeDrawer();
    }
  };
  const end = (x, y, id) => {
    if (!drag || id !== drag.id) return;
    const dx = x - drag.x;
    const dy = y - drag.y;
    drag = null;
    if (drawer.classList.contains('open') && dx < -28 && Math.abs(dx) > Math.abs(dy)) closeDrawer();
  };
  const onDrawer = (el) => el && (el === drawer || el === scrim || drawer.contains(el));
  window.addEventListener('touchstart', (e) => {
    if (!drawer.classList.contains('open') || !onDrawer(e.target)) return;
    const t = e.changedTouches[0];
    track(t.clientX, t.clientY, t.identifier);
  }, true);
  window.addEventListener('touchmove', (e) => {
    if (!drag) return;
    const t = [...e.changedTouches].find((x) => x.identifier === drag.id);
    if (!t) return;
    move(t.clientX, t.clientY, t.identifier, e);
  }, { capture: true, passive: false });
  window.addEventListener('touchend', (e) => {
    const t = [...e.changedTouches].find((x) => drag && x.identifier === drag.id);
    if (!t) return;
    end(t.clientX, t.clientY, t.identifier);
  }, true);
  window.addEventListener('touchcancel', () => { drag = null; }, true);
})();

document.addEventListener('pointerdown', (e) => {
  const t = e.target;
  if (!t || !t.closest) return;
  if (sheetEl && !sheetEl.hidden && sheetEl.querySelector('#paClose') && !sheetEl.contains(t)) {
    closePlaceSheet();
  }
  if (navigating) return;
  if (!routeCardEl || routeCardEl.hidden) return;
  if (routeCardEl.contains(t)) return;
  const offer = document.getElementById('detourOffer');
  if (offer && !offer.hidden && offer.contains(t)) return;
  const top = document.getElementById('topChrome');
  if (top && top.contains(t)) return;
  /* Le menu Fuel à droite (jauge, estimation, repli) ne ferme pas l’itinéraire et ne le démarre pas. */
  if (t.closest('#navSigns')) return;
  dismissRoutePreview();
}, true);

document.getElementById('detourIgnore')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  ignoreDetourOffer();
});
document.getElementById('detourTake')?.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  takeDetourOffer();
});

drawer.addEventListener('click', (e) => {
  const item = e.target.closest('.d-item');
  if (!item) return;
  const go = item.dataset.go;
  if (go === 'maps' || go === 'trips' || go === 'saved') setTab(go);
  else if (go === 'fuel') setTab('trips');
  else if (go === 'fuelapp') {
    closeDrawer();
    openFuelApp();
  }
  else if (go === 'music') {
    closeDrawer();
    openMusicSheet();
  }
  else if (go === 'account') {
    closeDrawer();
    const id = loadId();
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.openAccountChooser) {
      HuberaSuite.openAccountChooser();
    } else {
      toast(`Hubera ID · ${id.email}`);
    }
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.refreshContacts) {
      HuberaSuite.refreshContacts();
    }
  }
  else if (go === 'contacts') {
    closeDrawer();
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.openContacts) HuberaSuite.openContacts();
    else location.href = 'https://contacts.hubera.cloud';
  }
  else if (go === 'settings') setTab('settings');
  else if (go === 'offline') setTab('offline');
});

document.getElementById('tabs').addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  setTab(tab.dataset.tab);
});
const fuelPageSub = document.getElementById('fuelPageSub');
if (fuelPageSub) {
  fuelPageSub.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fpage]');
    if (!b) return;
    fuelPageTab = b.dataset.fpage || 'home';
    fuelPageSub.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    renderFuelHome();
  });
}
const btnFuelPageBack = document.getElementById('btnFuelPageBack');
if (btnFuelPageBack) btnFuelPageBack.addEventListener('click', () => setTab('maps'));

savedList.addEventListener('click', (e) => {
  const edit = e.target.closest('.place-edit');
  if (edit && edit.dataset.assign) {
    startAssign(edit.dataset.assign);
    return;
  }
  if (edit && edit.dataset.savedEdit != null) {
    const p = loadPlaces();
    const rec = (p.saved || [])[Number(edit.dataset.savedEdit)];
    if (rec) openPlaceActions('saved', { ...rec, _i: Number(edit.dataset.savedEdit) });
    return;
  }
  const del = e.target.closest('.place-del');
  if (del && del.dataset.del) {
    const p = loadPlaces();
    p[del.dataset.del] = null;
    savePlaces(p);
    renderChips();
    renderSaved();
    toast('Adresse supprimée');
    return;
  }
  if (del && del.dataset.savedDel != null) {
    const p = loadPlaces();
    p.saved = (p.saved || []).filter((_, i) => i !== Number(del.dataset.savedDel));
    savePlaces(p);
    renderSaved();
    toast('Adresse supprimée');
    return;
  }
  const row = e.target.closest('.place-row');
  if (!row) return;
  if (row.dataset.openContacts === '1') {
    if (typeof HuberaSuite !== 'undefined' && HuberaSuite.openContacts) HuberaSuite.openContacts();
    else location.href = 'https://contacts.hubera.cloud';
    return;
  }
  if (row.dataset.assign) {
    startAssign(row.dataset.assign);
    return;
  }
  if (row.dataset.place) {
    const p = loadPlaces();
    openPlaceActions(row.dataset.place, p[row.dataset.place]);
    return;
  }
  if (row.dataset.saved != null) {
    const p = loadPlaces();
    const rec = (p.saved || [])[Number(row.dataset.saved)];
    if (rec) openPlaceActions('saved', { ...rec, _i: Number(row.dataset.saved) });
    return;
  }
  if (row.dataset.query) {
    const q = row.dataset.query;
    const label = row.dataset.label || q;
    setTab('maps');
    searchPhoton(q).then((hits) => {
      if (hits[0]) void routeTo(hits[0].lat, hits[0].lon, label);
      else toast('Adresse Contacts introuvable sur la carte');
    });
    return;
  }
  setTab('maps');
  void routeTo(Number(row.dataset.lat), Number(row.dataset.lon), row.dataset.label);
});

document.getElementById('btnFuelClose').addEventListener('click', () => {
  setTab('maps');
});
document.getElementById('btnFuelOpen').addEventListener('click', () => {
  openFuelApp();
});
document.getElementById('btnFuelRefresh').addEventListener('click', () => {
  requestFuelHistory(true);
  requestFuelSnapshot();
});
document.getElementById('btnFuelTrack').addEventListener('click', () => {
  startFuelTrip();
});
const btnFuelUx = document.getElementById('btnFuelUx');
if (btnFuelUx) btnFuelUx.addEventListener('click', () => setTab('fuelux'));
const btnFuelUxBack = document.getElementById('btnFuelUxBack');
if (btnFuelUxBack) btnFuelUxBack.addEventListener('click', () => setTab('maps'));
const fuelUxBody = document.getElementById('fuelUxBody');
if (fuelUxBody) {
  fuelUxBody.addEventListener('click', (e) => {
    const card = e.target.closest('[data-ux]');
    if (!card) return;
    setFuelUx(card.dataset.ux);
    setTab('maps');
    toast(`Fuel UI · ${card.querySelector('b') ? card.querySelector('b').textContent : card.dataset.ux}`);
  });
}
const fuelPeek = document.getElementById('fuelPeek');
if (fuelPeek) fuelPeek.addEventListener('click', () => setTab('trips'));
const btnFuelSheetClose = document.getElementById('btnFuelSheetClose');
if (btnFuelSheetClose) btnFuelSheetClose.addEventListener('click', () => closeFuelSheet());
const fuelSub = document.getElementById('fuelSub');
if (fuelSub) {
  fuelSub.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-fsub]');
    if (!b) return;
    fuelSub.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    paintFuelSheetBody();
  });
}
const fuelFab = document.getElementById('fuelFab');
const fuelRadial = document.getElementById('fuelRadial');
if (fuelFab && fuelRadial) {
  fuelFab.addEventListener('click', () => {
    fuelRadial.hidden = !fuelRadial.hidden;
    fuelRadial.classList.toggle('open', !fuelRadial.hidden);
  });
  fuelRadial.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-rad]');
    if (!b) return;
    fuelRadial.hidden = true;
    fuelRadial.classList.remove('open');
    const a = b.dataset.rad;
    if (a === 'start') startFuelTrip();
    else if (a === 'pause') {
      if (mapsStartedFuel) document.getElementById('btnPause')?.click();
      else startFuelTrip();
    }
    else if (a === 'stop') fuelStopTracking();
    else if (a === 'fill') {
      const fillSheet = document.getElementById('fillSheet');
      if (fillSheet) fillSheet.hidden = false;
    } else if (a === 'history' || a === 'sheet') openFuelSheet();
  });
}
document.getElementById('locEnable')?.addEventListener('click', () => {
  openLocRemedy();
  requestPreciseLoc();
});
const poiCardClose = document.getElementById('poiCardClose');
if (poiCardClose) poiCardClose.addEventListener('click', closePoiCard);
const poiCardGo = document.getElementById('poiCardGo');
if (poiCardGo) {
  poiCardGo.addEventListener('click', () => {
    const it = selectedPoi;
    closePoiCard();
    if (it) void routeTo(it.lat, it.lon, it.name);
  });
}
const poiCardSave = document.getElementById('poiCardSave');
if (poiCardSave) {
  poiCardSave.addEventListener('click', () => {
    const it = selectedPoi;
    if (!it || !Number.isFinite(it.lat) || !Number.isFinite(it.lon)) return;
    const nick = window.prompt('Petit nom pour ce lieu', it.name || 'Lieu');
    if (nick == null) return;
    finishAssignPlace('saved', it.lat, it.lon, it.name || nick);
    const p = loadPlaces();
    if (p.saved && p.saved[0]) p.saved[0] = { ...p.saved[0], nick: nick.trim() || it.name };
    savePlaces(p);
    renderSaved();
    closePoiCard();
  });
}
document.addEventListener('click', (e) => {
  const row = e.target.closest && e.target.closest('.fuel-trip');
  if (!row) return;
  const wrap = row.closest('#fuelTripList, #fuelTripListPanel, #fuelSheet');
  if (!wrap) return;
  const active = row.dataset.active === '1';
  const dest = row.dataset.dest || '';
  const origin = row.dataset.origin || '';
  if (active) {
    pendingResumeId = row.dataset.id;
    setTab('maps');
    promptFuelGate('resume');
    return;
  }
  const q = dest || origin;
  setTab('maps');
  if (!q) {
    toast('Pas d’adresse sur ce trajet');
    return;
  }
  searchPhoton(q).then((hits) => {
    if (hits[0]) void routeTo(hits[0].lat, hits[0].lon, hits[0].label);
    else toast('Adresse introuvable');
  });
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
  if (tripId && (navigating || mapsStartedFuel)) {
    fuelTrip = tripId;
    showFuelBar(`Trajet Fuel · ${tripId}`);
  }
}

function openFillSheet() {
  const sheet = document.getElementById('fillSheet');
  if (!sheet) return;
  sheet.hidden = false;
  const hint = document.getElementById('fillSheetHint');
  const veh = activeFuelVehicle();
  if (hint) {
    hint.textContent = veh
      ? `${veh.name}${mapsStartedFuel ? ' · lié au trajet en cours' : ''} — litres ou montant suffisent.`
      : 'Litres ou montant. Le plein va sur le véhicule Fuel actif.';
  }
  const st = document.getElementById('fillStation');
  if (st) {
    const cur = (st.value || '').trim();
    if (!cur || /^\d+$/.test(cur)) st.value = '';
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
  const extra = { liters, total, station };
  const veh = activeFuelVehicle();
  if (veh) extra.vehicleId = veh.id;
  if (mapsStartedFuel) {
    paused = true;
    lastSpeedKmh = 0;
    movingSince = 0;
    fuelDriveLast = 0;
    const pauseBtn = document.getElementById('btnPause');
    if (pauseBtn) pauseBtn.textContent = 'Reprendre';
    stopNavWatch();
    try { window.HuberaTts?.stop?.(); } catch { /* ignore */ }
  }
  savePendingFuelFill(extra);
  const ok = fuelControl('fill', extra);
  closeFillSheet();
  toast(ok ? 'Plein mémorisé — tu restes dans Maps.' : 'Plein mémorisé. Ouvre Hubera Fuel connecté pour le cloud.');
}

window.__mapsFuelEvent = function (raw) {
  try {
    const q = new URLSearchParams(String(raw || '').replace(/^\?/, ''));
    const pack = q.get('trips');
    if (pack) applyFuelTripPack(pack);
    const snapPack = q.get('snap');
    if (snapPack) {
      const parsed = parseFuelSnapPack(snapPack);
      if (parsed) {
        saveFuelSnap(parsed);
        applyFuelSnapDefaultVehicle(parsed, 'native');
        lastFuelSnapAt = Date.now();
        paintFuelPeek();
        renderFuelHome();
        paintFuelSheetBody();
        const pending = loadPendingFuelFill();
        if (pending) {
          const wantL = Number(String(pending.liters || '').replace(',', '.'));
          const wantE = Number(String(pending.total || '').replace(',', '.'));
          const match = (parsed.fills || []).some((f) => {
            const fL = Number(f.liters || 0);
            const fE = Number(f.cost || 0);
            return (wantL > 0 && Math.abs(fL - wantL) < 0.2) || (wantE > 0 && Math.abs(fE - wantE) < 0.08);
          });
          if (match) clearPendingFuelFill();
          else setTimeout(retryPendingFuelFill, 1800);
        }
      }
    }
    const ok = q.get('ok') !== '0';
    const started = q.get('started');
    const id = q.get('tripId');
    const kmQ = Number(q.get('km'));
    if (Number.isFinite(kmQ) && kmQ > 0) fuelLiveKm = kmQ;
    if (id && Number(id) > 0 && (navigating || mapsStartedFuel)) {
      fuelTrip = id;
      showFuelBar(`Trajet Fuel · ${id}`);
      paintFuelStats();
      if (navigating) paintHud(currentChoice());
    }
    const msg = q.get('msg');
    if (msg && msg !== 'Historique Fuel' && msg !== 'Fuel') toast(msg);
    if (!ok) {
      mapsStartedFuel = false;
      stopFuelPoll();
    } else if (started === '0') {
      toast('Fuel n’a pas pu démarrer le GPS — vérifie la localisation.');
    }
    if (!ok && !id) mapsStartedFuel = false;
  } catch {
    /* ignore */
  }
};

function fuelStopTracking() {
  const km = liveFuelKm();
  tickFuelDriveClock();
  const dur = fuelDriveMs ? fmtFuelMins(fuelDriveMs) : '';
  fuelControl('stop');
  mapsStartedFuel = false;
  fuelArmed = false;
  fuelDriveMs = 0;
  fuelDriveLast = 0;
  stopFuelPoll();
  fuelTrip = null;
  paused = false;
  stopNavigation({ stopFuel: false });
  renderAlts();
  const recap = km > 0.05 ? `${km.toFixed(1)} km` : 'trajet';
  toast(`Fuel arrêté · ${recap}${dur ? ' · ' + dur : ''} — tu restes dans Maps.`);
  showFuelRecap();
  document.body.classList.remove('fuel-live');
  paintFuelPeek();
  clearTrace();
  fuelHudStartedAt = 0;
  fuelLiveKm = 0;
  paintFuelStats();
  fuelEl.hidden = true;
  syncFuelChrome();
}

document.getElementById('btnPause').addEventListener('click', () => {
  paused = !paused;
  document.getElementById('btnPause').textContent = paused ? 'Reprendre' : 'Pause';
  if (paused) {
    lastSpeedKmh = 0;
    movingSince = 0;
    fuelDriveLast = 0;
    stopNavWatch();
    try { window.HuberaTts?.stop?.(); } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  } else if (navigating && navWatchFn) {
    startNavWatch(navWatchFn);
  }
  fuelControl(paused ? 'pause' : 'resume');
  paintHud(currentChoice());
  paintFuelStats();
  toast(paused ? 'Pause — guidage et Fuel.' : 'Reprise.');
});
document.getElementById('btnStop').addEventListener('click', fuelStopTracking);
document.getElementById('btnFill').addEventListener('click', openFillSheet);
document.getElementById('fillCancel').addEventListener('click', closeFillSheet);
document.getElementById('fillSave').addEventListener('click', saveFillFromSheet);

bootLocate();
startIdleGeo();

setMusicDock(musicDockOn());
syncVoiceBtn();
syncChromeHeight();
bindRouteCard();
[80, 400, 1200].forEach((ms) => window.setTimeout(syncChromeHeight, ms));
if (window.ResizeObserver) {
  const chromeEl = document.getElementById('chrome');
  if (chromeEl) new ResizeObserver(syncChromeHeight).observe(chromeEl);
}
window.addEventListener('resize', syncChromeHeight);
paintModes();
applyFuelFromQuery();
paintId();
try {
  if (typeof HuberaSuite !== 'undefined' && HuberaSuite.refreshContacts) HuberaSuite.refreshContacts();
} catch {
  /* web */
}
function loadContactsSeed() {
  const apply = (seed) => {
    try {
      mergeSeedContacts(Array.isArray(seed) ? seed : []);
    } catch {
      /* seed illisible */
    }
    paintContactPins();
    renderSaved();
  };
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'contacts-seed.json', true);
    xhr.onload = () => {
      const ok = xhr.status === 200 || (xhr.status === 0 && xhr.responseText);
      if (!ok) {
        apply([]);
        return;
      }
      try {
        apply(JSON.parse(xhr.responseText));
      } catch {
        apply([]);
      }
    };
    xhr.onerror = () => apply([]);
    xhr.send();
  } catch {
    apply([]);
  }
}
loadContactsSeed();
renderChips();
renderSaved();
applyFuelUx();
syncFuelChrome();
scheduleMapPlaces();
syncClear();

const nativeMusic = typeof HuberaMusic !== 'undefined';
const musicSheetEl = document.getElementById('musicSheet');
let lastMusicState = { title: '', artist: '', playing: false };

function musicEmptyTitle(s) {
  return (s && s.title) ? s.title : 'Rien en cours';
}
function musicEmptyArtist(s) {
  if (s && s.title) return s.artist || '';
  return 'Lance un titre dans Music';
}

function applyMusicState(s) {
  if (!s || typeof s !== 'object') return;
  lastMusicState = s;
  const reallyPlaying = !!(s.playing && s.title);
  if (reallyPlaying && document.body.classList.contains('music-off')) {
    setMusicDock(true);
  }
  const glyph = s.playing ? '❚❚' : '▶';
  const label = s.playing ? 'Pause' : 'Lecture';
  const title = document.getElementById('musicTitle');
  const artist = document.getElementById('musicArtist');
  const play = document.getElementById('musicPlay');
  if (title) title.textContent = musicEmptyTitle(s);
  if (artist) artist.textContent = s.title ? (s.artist || '') : '';
  if (play) {
    play.textContent = glyph;
    play.classList.toggle('is-playing', !!s.playing);
    play.classList.toggle('is-paused', !s.playing);
    play.setAttribute('aria-label', label);
    play.title = label;
  }
  const st = document.getElementById('musicSheetTitle');
  const sa = document.getElementById('musicSheetArtist');
  const sp = document.getElementById('musicSheetPlay');
  if (st) st.textContent = musicEmptyTitle(s);
  if (sa) sa.textContent = musicEmptyArtist(s);
  const lp = document.getElementById('lyricPrev');
  const lc = document.getElementById('lyricCur');
  const ln = document.getElementById('lyricNext');
  if (lp) lp.textContent = s.lyricPrev || '';
  if (lc) lc.textContent = s.lyricCur || (s.title ? 'Paroles…' : '');
  if (ln) ln.textContent = s.lyricNext || '';
  if (sp) {
    sp.textContent = glyph;
    sp.classList.toggle('is-playing', !!s.playing);
    sp.classList.toggle('is-paused', !s.playing);
    sp.setAttribute('aria-label', label);
    sp.title = label;
  }
}

function openMusicSheet() {
  if (!musicSheetEl) return;
  setMusicDock(true);
  musicSheetEl.hidden = false;
  applyMusicState(lastMusicState);
}

function closeMusicSheet() {
  if (musicSheetEl) musicSheetEl.hidden = true;
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

function onTap(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}
onTap('musicPlay', () => musicCall('playPause'));
onTap('musicNext', () => musicCall('next'));
onTap('musicPrev', () => musicCall('prev'));
onTap('musicOpenMeta', openMusicSheet);
onTap('musicHide', () => {
  closeMusicSheet();
  setMusicDock(false);
});
if (musicPeek) musicPeek.addEventListener('click', () => setMusicDock(true));
onTap('musicSheetClose', closeMusicSheet);
onTap('musicSheetPlay', () => musicCall('playPause'));
onTap('musicSheetNext', () => musicCall('next'));
onTap('musicSheetPrev', () => musicCall('prev'));
onTap('musicSheetOpenApp', () => musicCall('openApp'));

if (nativeMusic) {
  try {
    applyMusicState(JSON.parse(HuberaMusic.stateJson()));
  } catch {
    /* encore en connexion */
  }
  musicPollTimer = window.setInterval(() => {
    if (document.hidden) return;
    const sheetOpen = musicSheetEl && !musicSheetEl.hidden;
    if (document.body.classList.contains('music-off') && !sheetOpen) return;
    try {
      applyMusicState(JSON.parse(HuberaMusic.stateJson()));
    } catch {
      /* ignore */
    }
  }, 1500);
}

(function hideBootFail() {
  const el = document.getElementById('bootFail');
  if (el) el.hidden = true;
  const btn = document.getElementById('bootFailUpdate');
  if (btn) {
    btn.addEventListener('click', () => {
      try {
        if (window.HuberaUpdate) HuberaUpdate.check();
      } catch {
        /* ignore */
      }
    });
  }
  window.setTimeout(() => requestFuelSnapshot(), 1800);
})();
