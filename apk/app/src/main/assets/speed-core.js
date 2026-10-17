/* Limite lue sur la voie OSM. Pas de 50 inventé pour une rue sans tag.
   HuberaSpeed (natif Android) est un autre objet : ce module s’appelle HuberaSpeedCore. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HuberaSpeedCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const FR = {
    'FR:urban': 50,
    'FR:rural': 80,
    'FR:zone30': 30,
    'FR:zone20': 20,
    'FR:motorway': 130,
    'FR:trunk': 110,
    'FR:living_street': 20,
  };
  const SKIP = /^(footway|cycleway|path|steps|pedestrian|bridleway|construction|proposed|elevator|corridor|platform|track)$/;

  function parseSpeedToken(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s || s === 'none' || s === 'signals' || s === 'walk' || s === 'variable') return null;
    if (FR[s]) return FR[s];
    const zone = s.match(/^FR:zone:?(\d{1,3})$/i);
    if (zone) {
      const v = Number(zone[1]);
      if (v >= 5 && v <= 140) return Math.round(v);
    }
    const frNum = s.match(/^FR:(\d{1,3})$/i);
    if (frNum) {
      const v = Number(frNum[1]);
      if (v >= 5 && v <= 140) return Math.round(v);
    }
    const fr = s.match(/^FR:(\w+)/i);
    if (fr) {
      const k = `FR:${fr[1].toLowerCase()}`;
      if (FR[k]) return FR[k];
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

  function zoneFromTags(tags) {
    if (!tags) return false;
    if (tags['zone:maxspeed']) return true;
    if (String(tags['maxspeed:type'] || '').toLowerCase().includes('zone')) return true;
    if (String(tags['source:maxspeed'] || '').toLowerCase().includes('zone')) return true;
    return tags.highway === 'living_street';
  }

  function angleDiff(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
  }

  function bearingDeg(a, b) {
    const p1 = (a.lat * Math.PI) / 180;
    const p2 = (b.lat * Math.PI) / 180;
    const dl = ((b.lon - a.lon) * Math.PI) / 180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return (Math.atan2(y, x) * 180) / Math.PI + 360;
  }

  function havM(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  function distPointSeg(lat, lon, a, b) {
    const cos = Math.cos((lat * Math.PI) / 180);
    const px = lon * 111320 * cos;
    const py = lat * 110540;
    const ax = a.lon * 111320 * cos;
    const ay = a.lat * 110540;
    const bx = b.lon * 111320 * cos;
    const by = b.lat * 110540;
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = 0;
    if (l2 > 1) t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
    return { dist: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), bearing: bearingDeg(a, b) % 360 };
  }

  function geomOf(el) {
    if (Array.isArray(el.geometry) && el.geometry.length) return el.geometry;
    if (el.center && Number.isFinite(el.center.lat)) return [el.center];
    return [];
  }

  function wayDistance(lat, lon, el) {
    const geom = geomOf(el);
    if (!geom.length) return { dist: 9999, bearing: null };
    if (geom.length === 1) return { dist: havM(lat, lon, geom[0].lat, geom[0].lon), bearing: null };
    let best = 1e12;
    let bearing = null;
    for (let i = 1; i < geom.length; i += 1) {
      const hit = distPointSeg(lat, lon, geom[i - 1], geom[i]);
      if (hit.dist < best) {
        best = hit.dist;
        bearing = hit.bearing;
      }
    }
    return { dist: best, bearing };
  }

  function directedKmh(tags, heading, bearing) {
    const base = parseSpeedToken(tags.maxspeed);
    const fwd = parseSpeedToken(tags['maxspeed:forward']);
    const back = parseSpeedToken(tags['maxspeed:backward']);
    if (fwd == null && back == null) return base;
    const head = Number(heading);
    if (!Number.isFinite(head) || bearing == null) {
      if (base != null) return base;
      if (fwd != null && back != null) return Math.min(fwd, back);
      return fwd != null ? fwd : back;
    }
    const align = angleDiff(head, bearing) <= 90;
    if (align) return fwd != null ? fwd : base;
    return back != null ? back : base;
  }

  /** Vitesse écrite sur la voie. source:maxspeed n’est pas une limite. */
  function explicitSpeed(tags, heading, bearing) {
    if (!tags) return null;
    const directed = directedKmh(tags, heading, bearing);
    if (directed != null) {
      return { kmh: directed, zone: zoneFromTags(tags), source: 'maxspeed' };
    }
    const zone = parseSpeedToken(tags['zone:maxspeed']);
    if (zone != null) return { kmh: zone, zone: true, source: 'zone:maxspeed' };
    const type = String(tags['maxspeed:type'] || '').trim();
    if (/zone/i.test(type)) {
      const v = parseSpeedToken(type);
      if (v != null) return { kmh: v, zone: true, source: 'maxspeed:type' };
    }
    if (/^FR:\d{1,3}$/i.test(type)) {
      const v = parseSpeedToken(type);
      if (v != null) return { kmh: v, zone: false, source: 'maxspeed:type' };
    }
    return null;
  }

  function zoneSpeed(tags) {
    if (!tags) return null;
    if (tags['zone:maxspeed']) {
      const v = parseSpeedToken(tags['zone:maxspeed']);
      if (v != null) return { kmh: v, zone: true, source: 'zone:maxspeed' };
    }
    const type = String(tags['maxspeed:type'] || '');
    if (/zone/i.test(type)) {
      const v = parseSpeedToken(type) || parseSpeedToken(tags.maxspeed);
      if (v != null) return { kmh: v, zone: true, source: 'maxspeed:type' };
    }
    if (String(tags.enforcement || '') === 'maxspeed' || String(tags.type || '') === 'enforcement') {
      const v = parseSpeedToken(tags.maxspeed);
      if (v != null) return { kmh: v, zone: true, source: 'enforcement' };
    }
    return null;
  }

  function ringClosed(geom) {
    if (!geom || geom.length < 4) return false;
    const a = geom[0];
    const b = geom[geom.length - 1];
    return Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
  }

  function pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const yi = ring[i].lat;
      const xi = ring[i].lon;
      const yj = ring[j].lat;
      const xj = ring[j].lon;
      const intersect = yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / ((yj - yi) || 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function elementContains(lat, lon, el) {
    if (el && el._contains) return true;
    const rings = [];
    if (el.type === 'relation' && Array.isArray(el.members)) {
      for (const m of el.members) {
        const role = String(m.role || '');
        if (role && role !== 'outer') continue;
        if (ringClosed(m.geometry)) rings.push(m.geometry);
      }
    }
    const geom = geomOf(el);
    if (ringClosed(geom)) rings.push(geom);
    return rings.some((ring) => pointInRing(lat, lon, ring));
  }

  function skipHighway(hw) {
    return !hw || SKIP.test(hw);
  }

  /**
   * null = pas de voie (essayer un autre serveur).
   * known false = voie trouvée, aucun tag de limite.
   */
  function resolveSpeed(lat, lon, elements, heading) {
    const rows = [];
    const zones = [];
    for (const el of elements || []) {
      const tags = el.tags || {};
      const z = zoneSpeed(tags);
      if (z && elementContains(lat, lon, el)) zones.push(z);
      if (!tags.highway || skipHighway(tags.highway)) continue;
      const d = wayDistance(lat, lon, el);
      rows.push({ tags, dist: d.dist, bearing: d.bearing });
    }
    rows.sort((a, b) => a.dist - b.dist);
    const near = rows.find((r) => r.dist <= 48);
    if (near) {
      const ex = explicitSpeed(near.tags, heading, near.bearing);
      if (ex) return { kmh: ex.kmh, zone: !!ex.zone, known: true, source: ex.source };
      if (near.tags.highway === 'living_street') {
        return { kmh: 20, zone: true, known: true, source: 'living_street' };
      }
    }
    if (zones.length) {
      zones.sort((a, b) => a.kmh - b.kmh);
      return { kmh: zones[0].kmh, zone: true, known: true, source: zones[0].source };
    }
    if (near) return { kmh: null, zone: false, known: false, source: 'untagged' };
    return null;
  }

  function zonesFromArea(elements) {
    const out = [];
    for (const el of elements || []) {
      const z = zoneSpeed(el.tags || {});
      if (z) out.push(z);
    }
    out.sort((a, b) => a.kmh - b.kmh);
    return out;
  }

  function waysQuery(lat, lon) {
    const la = Number(lat).toFixed(5);
    const lo = Number(lon).toFixed(5);
    return (
      `[out:json][timeout:12];(` +
      `way(around:42,${la},${lo})["highway"];` +
      `way(around:55,${la},${lo})["zone:maxspeed"];` +
      `);out tags geom;`
    );
  }

  function areaQuery(lat, lon) {
    const la = Number(lat).toFixed(5);
    const lo = Number(lon).toFixed(5);
    return (
      `[out:json][timeout:8];` +
      `is_in(${la},${lo})->.a;` +
      `(` +
      `relation(pivot.a)["zone:maxspeed"];` +
      `way(pivot.a)["zone:maxspeed"];` +
      `relation(pivot.a)["enforcement"="maxspeed"];` +
      `);out tags;`
    );
  }

  return {
    parseSpeedToken,
    explicitSpeed,
    zoneSpeed,
    resolveSpeed,
    zonesFromArea,
    waysQuery,
    areaQuery,
    zoneFromTags,
  };
});
