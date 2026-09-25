/* Hubera Maps — web (OSM + Photon + OSRM). Handshake Fuel via deep links. */
const map = L.map('map').setView([46.6, 2.4], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

const hitsEl = document.getElementById('hits');
const qEl = document.getElementById('q');
const sheetEl = document.getElementById('sheet');
const fuelEl = document.getElementById('fuel');
const fuelTitle = document.getElementById('fuelTitle');
const tabsEl = document.getElementById('tabs');

let me = null;
let meMarker = null;
let destMarker = null;
let routeLayer = null;
let traceLayer = null;
let trace = [];
let fuelTrip = null;
let paused = false;
let searchTimer = 0;

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function clearRoute() {
  if (routeLayer) map.removeLayer(routeLayer);
  routeLayer = null;
  if (destMarker) map.removeLayer(destMarker);
  destMarker = null;
}

function setMe(lat, lon, fly) {
  me = { lat, lon };
  if (!meMarker) meMarker = L.circleMarker([lat, lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map);
  else meMarker.setLatLng([lat, lon]);
  if (fly) map.setView([lat, lon], 14);
}

function appendTrace(lat, lon) {
  if (!fuelTrip || paused) return;
  const last = trace[trace.length - 1];
  if (last && Math.abs(last[0] - lat) < 1e-6 && Math.abs(last[1] - lon) < 1e-6) return;
  trace.push([lat, lon]);
  if (traceLayer) map.removeLayer(traceLayer);
  if (trace.length >= 2) {
    traceLayer = L.polyline(trace, { color: '#188038', weight: 4 }).addTo(map);
  }
}

async function searchPhoton(q) {
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=fr&limit=8`;
  const res = await fetch(url);
  const data = await res.json();
  return (data.features || []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    const label = [p.name, p.street, p.city || p.state, p.country].filter(Boolean).join(', ');
    return { label: label || q, lat, lon };
  });
}

async function routeTo(lat, lon, label) {
  if (!me) {
    sheetEl.hidden = false;
    sheetEl.innerHTML = `<strong>${label}</strong><span>Activez « ma position » pour l’itinéraire.</span>`;
    destMarker = L.marker([lat, lon]).addTo(map).bindPopup(label);
    map.setView([lat, lon], 14);
    return;
  }
  clearRoute();
  destMarker = L.marker([lat, lon]).addTo(map).bindPopup(label);
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${me.lon},${me.lat};${lon},${lat}?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = await res.json();
  const route = data.routes && data.routes[0];
  if (!route) {
    sheetEl.hidden = false;
    sheetEl.innerHTML = `<strong>${label}</strong><span>Aucun itinéraire OSRM.</span>`;
    return;
  }
  routeLayer = L.geoJSON(route.geometry, { style: { color: '#1a73e8', weight: 5 } }).addTo(map);
  map.fitBounds(routeLayer.getBounds(), { padding: [48, 48] });
  const km = (route.distance / 1000).toFixed(1);
  const min = Math.round(route.duration / 60);
  sheetEl.hidden = false;
  sheetEl.innerHTML = `<strong>${label}</strong><span>${km} km · ${min} min · OSRM</span>`;
}

function showHits(items) {
  if (!items.length) {
    hitsEl.hidden = true;
    hitsEl.innerHTML = '';
    return;
  }
  hitsEl.hidden = false;
  hitsEl.innerHTML = items
    .map(
      (h) =>
        `<button type="button" class="hit" data-lat="${h.lat}" data-lon="${h.lon}" data-label="${esc(h.label)}">${esc(h.label)}</button>`
    )
    .join('');
}

qEl.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = qEl.value.trim();
  if (q.length < 2) {
    showHits([]);
    return;
  }
  searchTimer = setTimeout(() => {
    searchPhoton(q).then(showHits).catch(() => showHits([]));
  }, 220);
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
  qEl.value = btn.dataset.label;
  void routeTo(Number(btn.dataset.lat), Number(btn.dataset.lon), btn.dataset.label);
});

document.getElementById('btnHere').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => setMe(pos.coords.latitude, pos.coords.longitude, true),
    () => {},
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

function applyFuelFromQuery() {
  const p = new URLSearchParams(location.search);
  const tripId = p.get('tripId');
  const q = p.get('q') || p.get('label');
  const lat = parseFloat(p.get('lat') || p.get('toLat'));
  const lon = parseFloat(p.get('lon') || p.get('toLon'));
  if (q) qEl.value = q;
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    void routeTo(lat, lon, q || 'Destination');
  }
  if (tripId) {
    fuelTrip = tripId;
    fuelEl.hidden = false;
    tabsEl.hidden = true;
    fuelTitle.textContent = `Suivi Fuel · trajet ${tripId}`;
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (pos) => {
          setMe(pos.coords.latitude, pos.coords.longitude, false);
          appendTrace(pos.coords.latitude, pos.coords.longitude);
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }
  }
}

function openFuel(action) {
  const tripQ = fuelTrip ? `tripId=${encodeURIComponent(fuelTrip)}` : '';
  if (action === 'fill') {
    location.href = fuelUrl('fillup/add');
    return;
  }
  location.href = fuelUrl(`trip/control?action=${action}&${tripQ}`);
}

document.getElementById('btnPause').addEventListener('click', () => {
  paused = !paused;
  document.getElementById('btnPause').textContent = paused ? 'Reprendre' : 'Pause';
  openFuel(paused ? 'pause' : 'resume');
});
document.getElementById('btnStop').addEventListener('click', () => openFuel('stop'));
document.getElementById('btnFill').addEventListener('click', () => openFuel('fill'));

if (navigator.geolocation) {
  navigator.geolocation.getCurrentPosition(
    (pos) => setMe(pos.coords.latitude, pos.coords.longitude, true),
    () => {},
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

applyFuelFromQuery();
