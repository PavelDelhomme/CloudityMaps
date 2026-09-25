/* Hubera Maps — OSM + Photon + OSRM. Chrome type Google Maps + Fuel + Music. */
const map = L.map('map', {
  zoomControl: false,
  preferCanvas: true,
  fadeAnimation: false,
  markerZoomAnimation: false,
  zoomAnimation: true,
  zoomAnimationThreshold: 4,
}).setView([46.6, 2.4], 6);
map.createPane('mePane');
map.getPane('mePane').style.zIndex = 650;
map.whenReady(() => {
  map.invalidateSize();
  setTimeout(() => map.invalidateSize(), 350);
});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  updateWhenIdle: true,
  updateWhenZooming: false,
  keepBuffer: 1,
  detectRetina: false,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

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
const LAST_ME_KEY = 'hubera-maps-last-me';
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

function clearRoute() {
  for (const layer of altLayers) map.removeLayer(layer);
  altLayers = [];
  routeLayer = null;
  if (destMarker) map.removeLayer(destMarker);
  destMarker = null;
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
  try {
    const p = JSON.parse(localStorage.getItem(LAST_ME_KEY) || 'null');
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return false;
    if (Date.now() - (p.at || 0) > 36e5 * 18) return false;
    lastFixAt = p.at || 0;
    setMe(p.lat, p.lon, false, true);
    return true;
  } catch {
    return false;
  }
}

function setMe(lat, lon, fly, fromCache) {
  const next = { lat, lon };
  const moved = metersBetween(me, next);
  me = next;
  if (!fromCache) persistMe(lat, lon);
  const here = L.latLng(lat, lon);
  if (meMarker && moved < 3 && !fly) {
    if (moved >= 40) void refreshRoad(lat, lon);
    return;
  }
  if (!meHalo) {
    meHalo = L.circleMarker(here, {
      radius: 22, color: '#e94560', weight: 2, fillColor: '#e94560', fillOpacity: 0.16,
      pane: 'mePane', interactive: false,
    }).addTo(map);
  } else meHalo.setLatLng(here);
  if (!meMarker) {
    meMarker = L.circleMarker(here, {
      radius: 10, color: '#fff', weight: 3, fillColor: '#e94560', fillOpacity: 1,
      pane: 'mePane',
    }).addTo(map);
  } else meMarker.setLatLng(here);
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
  const remainKm = choice
    ? here && lastDest
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
      if (now - lastFixAt < 2200 && me && metersBetween(me, next) < 8) return;
      onPos(next);
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
  document.body.classList.remove('nav');
  searchForm.hidden = false;
  navBar.hidden = true;
  chipsEl.hidden = false;
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
  stopIdleGeo();
  enterNavUi();
  if (isCarMode()) {
    fuelControl('start', { dest: destShort() });
  }
  startNavWatch((next) => {
    setMe(next.lat, next.lon, false);
    appendTrace(next.lat, next.lon);
    paintHud(currentChoice());
  });
}

async function refreshRoad(lat, lon) {
  const now = Date.now();
  const here = { lat, lon };
  if (lastRoadPos && metersBetween(lastRoadPos, here) < 45 && now - lastRoadAt < 25000) return;
  if (now - lastRoadAt < 16000) return;
  lastRoadAt = now;
  lastRoadPos = here;
  try {
    const url = `https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&lang=fr`;
    const res = await fetch(url);
    const data = await res.json();
    const p = data.features?.[0]?.properties || {};
    const name = p.name || p.street || p.osm_value || p.city || '';
    roadNameEl.textContent = name || '—';
    const kindEl = document.querySelector('#roadSign .kind');
    if (kindEl) {
      const n = String(name);
      kindEl.textContent = /^d\s?\d/i.test(n) ? 'DÉPARTEMENTALE' : n.startsWith('N') ? 'NATIONALE' : 'VOIE';
    }
  } catch {
    /* hors ligne */
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

function renderChips() {
  const p = loadPlaces();
  const bits = [
    `<button type="button" class="chip" data-chip="home">${p.home ? `Maison` : `+ Maison`}${p.home ? ` <span class="sub">· ${esc(p.home.label.split(',')[0])}</span>` : ''}</button>`,
    `<button type="button" class="chip" data-chip="work">${p.work ? `Travail` : `+ Travail`}${p.work ? ` <span class="sub">· ${esc(p.work.label.split(',')[0])}</span>` : ''}</button>`,
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
  const p = loadPlaces();
  const place = p[kind];
  if (place) {
    void routeTo(place.lat, place.lon, place.label);
    return;
  }
  startAssign(kind);
});

document.getElementById('btnHere').addEventListener('click', goHere);

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
    stopIdleGeo();
    startNavWatch((next) => {
      setMe(next.lat, next.lon, false);
      appendTrace(next.lat, next.lon);
    });
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
        startNavWatch((next) => {
          setMe(next.lat, next.lon, false);
          appendTrace(next.lat, next.lon);
          paintHud(currentChoice());
        });
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
  if (title) title.textContent = s.title || 'Hubera Music';
  if (artist) artist.textContent = s.artist || (s.playing ? 'En cours' : 'Lecture depuis Maps');
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
  }, 8000);
}
