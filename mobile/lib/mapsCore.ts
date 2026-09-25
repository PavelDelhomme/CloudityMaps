import { Linking, Platform } from 'react-native';

const FUEL_SCHEME = 'gasoiltracking';

export type FuelSession = {
  tripId: number | null;
  vehicleId: number | null;
  mode: 'free' | 'nav';
  label: string | null;
  toLat: number | null;
  toLon: number | null;
  fromLat: number | null;
  fromLon: number | null;
};

function num(v: string | null): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseMapsLink(url: string | null): FuelSession | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(
      url
        .replace(/^(hubera-maps|cloudity-maps):\/\//i, 'https://maps.hubera.cloud/')
        .replace(/^hubera-maps:/i, 'https://maps.hubera.cloud')
        .replace(/^cloudity-maps:/i, 'https://maps.hubera.cloud')
    );
  } catch {
    return null;
  }
  const q = parsed.searchParams;
  const path = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  const meaningful =
    /track|navigate|show|search|place|route/.test(path) ||
    q.get('tripId') ||
    q.get('q') ||
    q.get('lat') ||
    q.get('toLat');
  if (!meaningful) return null;
  return {
    tripId: num(q.get('tripId')),
    vehicleId: num(q.get('vehicleId')),
    mode: q.get('mode') === 'nav' || path.includes('navigate') ? 'nav' : 'free',
    label: q.get('label') || q.get('q'),
    toLat: num(q.get('toLat') || q.get('lat')),
    toLon: num(q.get('toLon') || q.get('lon')),
    fromLat: num(q.get('fromLat')),
    fromLon: num(q.get('fromLon')),
  };
}

async function tryOpen(url: string): Promise<boolean> {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

export async function commandFuel(
  action: 'pause' | 'resume' | 'stop',
  tripId: number | null
): Promise<boolean> {
  const q = tripId ? `?action=${action}&tripId=${tripId}` : `?action=${action}`;
  if (await tryOpen(`${FUEL_SCHEME}://trip/control${q}`)) return true;
  return tryOpen(`https://fuel.hubera.cloud/`);
}

export async function openFuelFillUp(lat?: number | null, lon?: number | null): Promise<boolean> {
  const q =
    lat != null && lon != null
      ? `?lat=${lat}&lon=${lon}`
      : '';
  if (await tryOpen(`${FUEL_SCHEME}://fillup/add${q}`)) return true;
  return tryOpen('https://fuel.hubera.cloud/');
}

export type PhotonHit = {
  label: string;
  latitude: number;
  longitude: number;
};

export async function searchPlaces(q: string): Promise<PhotonHit[]> {
  const query = q.trim();
  if (query.length < 2) return [];
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lang=fr&limit=8`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    features?: { geometry: { coordinates: number[] }; properties: Record<string, string> }[];
  };
  return (data.features || []).map((f) => {
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties || {};
    const label = [p.name, p.street, p.city || p.state, p.country].filter(Boolean).join(', ');
    return { label: label || query, latitude: lat, longitude: lon };
  });
}

export type OsrmRoute = {
  coordinates: { latitude: number; longitude: number }[];
  km: number;
  minutes: number;
};

export async function fetchOsrmRoute(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number }
): Promise<OsrmRoute | null> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.longitude},${from.latitude};${to.longitude},${to.latitude}` +
    `?overview=full&geometries=geojson`;
  const res = await fetch(url);
  const data = (await res.json()) as {
    routes?: { distance: number; duration: number; geometry: { coordinates: number[][] } }[];
  };
  const route = data.routes?.[0];
  if (!route) return null;
  return {
    km: route.distance / 1000,
    minutes: Math.round(route.duration / 60),
    coordinates: route.geometry.coordinates.map(([lon, lat]) => ({
      latitude: lat,
      longitude: lon,
    })),
  };
}

export { Platform };
