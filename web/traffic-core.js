/* Circulation temps réel : vitesses Bison Futé / TIPI (data.gouv, sans clé).
   Le tracé reste celui d’OSRM. On allonge la durée, et on peut ajouter
   « Évite le bouchon » sans changer le trajet déjà choisi. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HuberaTraffic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const HEAVY_DELAY_MIN = 5;
  const ALT_GAIN_MIN = 3;
  const MATCH_M = 450;

  function lambert93ToWgs84(x, y) {
    const f = 1 / 298.257222101;
    const e = Math.sqrt(f * (2 - f));
    const n = 0.725607765053267;
    const c = 11754255.426096;
    const xs = 700000;
    const ys = 12655612.049876;
    const dx = x - xs;
    const dy = ys - y;
    const R = Math.hypot(dx, dy);
    if (!(R > 0)) return null;
    const gamma = Math.atan2(dx, dy);
    const lon = (3 * Math.PI) / 180 + gamma / n;
    const latIso = -Math.log(R / c) / n;
    let phi = 2 * Math.atan(Math.exp(latIso)) - Math.PI / 2;
    for (let i = 0; i < 8; i += 1) {
      const es = e * Math.sin(phi);
      phi = 2 * Math.atan(((1 + es) / (1 - es)) ** (e / 2) * Math.exp(latIso)) - Math.PI / 2;
    }
    return { lat: (phi * 180) / Math.PI, lon: (lon * 180) / Math.PI };
  }

  function referenceKmh(axe) {
    const a = String(axe || '').toUpperCase();
    if (a.startsWith('A')) return 110;
    if (a.startsWith('N')) return 80;
    return 50;
  }

  function isSlow(speed, free) {
    if (!(speed >= 5) || !(free > 0)) return false;
    return speed < free * (free >= 100 ? 0.75 : 0.65);
  }

  function parseSpeedXml(xml) {
    const speeds = {};
    const text = String(xml || '');
    const parts = text.split(/<measurementSiteReference[^>]*\bid="([^"]+)"/);
    for (let i = 1; i < parts.length; i += 2) {
      const id = parts[i];
      const chunk = parts[i + 1] || '';
      const m = chunk.match(/<speed>([0-9.]+)<\/speed>/);
      if (!m) continue;
      const speed = Number(m[1]);
      if (Number.isFinite(speed)) speeds[id] = speed;
    }
    return speeds;
  }

  function axeOf(cols) {
    for (const c of cols) {
      const v = String(c || '').trim().toUpperCase();
      if (/^[AND]\d/.test(v) && !v.includes('PR')) return v;
    }
    return '';
  }

  function lambertPair(cols) {
    for (let i = 0; i < cols.length - 3; i += 1) {
      const x1 = Number(cols[i]);
      const y1 = Number(cols[i + 1]);
      const x2 = Number(cols[i + 2]);
      const y2 = Number(cols[i + 3]);
      if (
        x1 > 1e5 && x1 < 1.3e6 && y1 > 6e6 && y1 < 7.3e6 &&
        x2 > 1e5 && x2 < 1.3e6 && y2 > 6e6 && y2 < 7.3e6
      ) {
        return { i, x1, y1, x2, y2 };
      }
    }
    return null;
  }

  function parseStationCsv(csv) {
    const out = [];
    const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    for (let li = 1; li < lines.length; li += 1) {
      const line = lines[li];
      if (!line || !line.includes(';')) continue;
      const cols = line.split(';');
      const id = cols[0];
      if (!id) continue;
      const pair = lambertPair(cols);
      if (!pair || pair.i < 2) continue;
      const lenM = Number(cols[pair.i - 2]);
      if (!(lenM >= 80)) continue;
      const a = lambert93ToWgs84(pair.x1, pair.y1);
      const b = lambert93ToWgs84(pair.x2, pair.y2);
      if (!a || !b) continue;
      out.push({
        id,
        axe: axeOf(cols),
        lenM,
        lat: a.lat,
        lon: a.lon,
        lat2: b.lat,
        lon2: b.lon,
      });
    }
    return out;
  }

  function buildTrafficStations(csv, xml) {
    const speeds = parseSpeedXml(xml);
    const stations = [];
    for (const st of parseStationCsv(csv)) {
      const speed = speeds[st.id];
      if (speed == null) continue;
      const free = referenceKmh(st.axe);
      const lenKm = st.lenM / 1000;
      const rawDelay = speed > 0 ? (lenKm / speed) * 60 - (lenKm / free) * 60 : 0;
      const slow = isSlow(speed, free) && rawDelay >= 0.15;
      stations.push({ ...st, speed, free, delayMin: slow ? rawDelay : 0, slow });
    }
    return stations;
  }

  function havKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function distPointSegM(lat, lon, st) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const px = lon * 111320 * cos;
    const py = lat * 110540;
    const ax = st.lon * 111320 * cos;
    const ay = st.lat * 110540;
    const bx = st.lon2 * 111320 * cos;
    const by = st.lat2 * 110540;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = 0;
    if (l2 > 1) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function delayOnRoute(coords, stations) {
    const empty = { delayMin: 0, jam: null, measured: false, spans: [] };
    if (!coords || coords.length < 2 || !stations || !stations.length) return empty;
    let minLon = 180;
    let maxLon = -180;
    let minLat = 90;
    let maxLat = -90;
    const step = Math.max(1, Math.floor(coords.length / 100));
    const samples = [];
    for (let i = 0; i < coords.length; i += step) {
      const c = coords[i];
      samples.push(c);
      if (c[0] < minLon) minLon = c[0];
      if (c[0] > maxLon) maxLon = c[0];
      if (c[1] < minLat) minLat = c[1];
      if (c[1] > maxLat) maxLat = c[1];
    }
    samples.push(coords[coords.length - 1]);
    const pad = 0.03;
    const hits = [];
    const slowAt = new Set();
    let measured = false;
    for (const st of stations) {
      const outside = (lat, lon) =>
        lon < minLon - pad || lon > maxLon + pad || lat < minLat - pad || lat > maxLat + pad;
      if (outside(st.lat, st.lon) && outside(st.lat2, st.lon2)) continue;
      let best = 1e9;
      let at = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const d = distPointSegM(samples[i][1], samples[i][0], st);
        if (d < best) {
          best = d;
          at = i;
        }
      }
      if (best > MATCH_M) continue;
      measured = true;
      const jammed = st.slow !== false && (st.delayMin || 0) >= 0.15;
      if (!jammed) continue;
      hits.push({ st, at });
      slowAt.add(at);
    }
    hits.sort((a, b) => a.at - b.at);
    const kept = [];
    for (const h of hits) {
      const prev = kept.find(
        (k) => k.st.axe === h.st.axe && havKm(k.st.lat, k.st.lon, h.st.lat, h.st.lon) < 0.4,
      );
      if (prev) {
        if (h.st.delayMin > prev.st.delayMin) prev.st = h.st;
        continue;
      }
      kept.push({ st: h.st });
    }
    let raw = 0;
    let jam = null;
    let worst = 0;
    for (const k of kept) {
      const d = Math.min(12, k.st.delayMin);
      raw += d;
      if (d > worst) {
        worst = d;
        jam = { lat: (k.st.lat + k.st.lat2) / 2, lon: (k.st.lon + k.st.lon2) / 2 };
      }
    }
    const delayMin = Math.min(45, Math.round(raw));
    const spans = [];
    let cur = null;
    for (let i = 0; i < samples.length; i += 1) {
      if (!slowAt.has(i)) {
        if (cur && cur.length >= 2) spans.push(cur);
        cur = null;
        continue;
      }
      if (!cur) cur = [];
      cur.push(samples[i]);
      if (samples[i + 1]) cur.push(samples[i + 1]);
    }
    if (cur && cur.length >= 2) spans.push(cur);
    return { delayMin, jam: delayMin > 0 ? jam : null, measured, spans };
  }

  function annotateRoutes(routes, stations) {
    if (!routes || !routes.length) return routes || [];
    if (!stations || !stations.length) return routes;
    return routes.map((r) => {
      const coords = r.geometry && r.geometry.coordinates;
      if (!coords || !coords.length) return r;
      const free = r.freeMin != null ? r.freeMin : r.min;
      const hit = delayOnRoute(coords, stations);
      const delay = hit.delayMin || 0;
      const status = !hit.measured ? 'uncovered' : delay >= 1 ? 'slow' : 'clear';
      return {
        ...r,
        freeMin: free,
        trafficDelayMin: delay,
        min: free + delay,
        trafficJam: hit.jam,
        trafficSpans: hit.spans || [],
        trafficMeasured: !!hit.measured,
        trafficStatus: status,
        trafficSource: hit.measured ? 'bison-fute' : '',
      };
    });
  }

  function isHeavy(route) {
    return !!route && (route.trafficDelayMin || 0) >= HEAVY_DELAY_MIN;
  }

  function offerAvoidJam(routes, detour, stations) {
    if (!routes || !routes.length) return routes || [];
    const base = routes[0];
    if (!isHeavy(base) || !detour || !detour.geometry) return routes;
    const alt = annotateRoutes([detour], stations)[0];
    if (!alt) return routes;
    if (base.min - alt.min < ALT_GAIN_MIN) return routes;
    const freeAlt = alt.freeMin != null ? alt.freeMin : alt.min;
    const dup = routes.some((r) => {
      const free = r.freeMin != null ? r.freeMin : r.min;
      return Math.abs(r.km - alt.km) < 0.4 && Math.abs(free - freeAlt) < 2;
    });
    if (dup) return routes;
    const id = `${Number(alt.km).toFixed(1)}:${freeAlt}:traffic`;
    if (routes.some((r) => r.id === id)) return routes;
    return routes.concat({
      ...alt,
      id,
      kind: 'traffic',
      label: 'Évite le bouchon',
    });
  }

  return {
    HEAVY_DELAY_MIN,
    ALT_GAIN_MIN,
    lambert93ToWgs84,
    parseSpeedXml,
    parseStationCsv,
    buildTrafficStations,
    delayOnRoute,
    annotateRoutes,
    isHeavy,
    offerAvoidJam,
  };
});
