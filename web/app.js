/* Cloudity Maps — MVP Leaflet + OSRM (démo publique). */
const statusEl = document.getElementById('status');
const map = L.map('map').setView([46.6, 2.4], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap',
}).addTo(map);

let origin = null;
let routeLayer = null;
let markers = [];

function setStatus(msg) {
  statusEl.textContent = msg;
}

function clearRoute() {
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

document.getElementById('btnHere').addEventListener('click', () => {
  if (!navigator.geolocation) {
    setStatus('Géolocalisation indisponible.');
    return;
  }
  setStatus('Localisation…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      origin = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      map.setView([origin.lat, origin.lon], 13);
      clearRoute();
      markers.push(L.marker([origin.lat, origin.lon]).addTo(map).bindPopup('Départ'));
      setStatus(`Départ : ${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`);
    },
    () => setStatus('Permission géoloc refusée.'),
    { enableHighAccuracy: true, timeout: 12000 }
  );
});

document.getElementById('btnGo').addEventListener('click', async () => {
  const toLat = parseFloat(document.getElementById('toLat').value);
  const toLon = parseFloat(document.getElementById('toLon').value);
  if (!Number.isFinite(toLat) || !Number.isFinite(toLon)) {
    setStatus('Destination invalide.');
    return;
  }
  if (!origin) {
    setStatus('Définissez d’abord « Ma position ».');
    return;
  }
  clearRoute();
  markers.push(L.marker([origin.lat, origin.lon]).addTo(map).bindPopup('Départ'));
  markers.push(L.marker([toLat, toLon]).addTo(map).bindPopup('Arrivée'));
  setStatus('Calcul OSRM…');
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${origin.lon},${origin.lat};${toLon},${toLat}?overview=full&geometries=geojson`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.routes || !data.routes[0]) {
      setStatus('Aucun itinéraire.');
      return;
    }
    const route = data.routes[0];
    routeLayer = L.geoJSON(route.geometry, {
      style: { color: '#3d9a6a', weight: 5, opacity: 0.9 },
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] });
    const km = (route.distance / 1000).toFixed(1);
    const min = Math.round(route.duration / 60);
    setStatus(`Itinéraire : ${km} km · ~${min} min (OSRM public démo).`);
  } catch (e) {
    setStatus('Échec OSRM : ' + (e && e.message ? e.message : String(e)));
  }
});

// Deep link query ?lat=&lon= (web)
const params = new URLSearchParams(location.search);
if (params.has('lat') && params.has('lon')) {
  document.getElementById('toLat').value = params.get('lat');
  document.getElementById('toLon').value = params.get('lon');
}
