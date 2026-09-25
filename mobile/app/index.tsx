import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, UrlTile, type Region } from 'react-native-maps';
import * as Location from 'expo-location';
import { useURL } from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  commandFuel,
  fetchOsrmRoute,
  openFuelFillUp,
  parseMapsLink,
  searchPlaces,
  type FuelSession,
  type OsrmRoute,
  type PhotonHit,
} from '@/lib/mapsCore';

const FRANCE: Region = {
  latitude: 46.6,
  longitude: 2.4,
  latitudeDelta: 8,
  longitudeDelta: 8,
};

const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const incoming = useURL();
  const mapRef = useRef<MapView>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PhotonHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [me, setMe] = useState<{ latitude: number; longitude: number } | null>(null);
  const [trace, setTrace] = useState<{ latitude: number; longitude: number }[]>([]);
  const [fuel, setFuel] = useState<FuelSession | null>(null);
  const [paused, setPaused] = useState(false);
  const [route, setRoute] = useState<OsrmRoute | null>(null);
  const [dest, setDest] = useState<PhotonHit | null>(null);
  const [busyFuel, setBusyFuel] = useState(false);

  useEffect(() => {
    const parsed = parseMapsLink(incoming);
    if (!parsed) return;
    setFuel(parsed);
    if (parsed.label) setQuery(parsed.label);
    if (parsed.toLat != null && parsed.toLon != null) {
      setDest({
        label: parsed.label || 'Destination',
        latitude: parsed.toLat,
        longitude: parsed.toLon,
      });
    }
  }, [incoming]);

  useEffect(() => {
    let sub: Location.LocationSubscription | undefined;
    void (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const here = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
      setMe(here);
      mapRef.current?.animateToRegion({
        ...here,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      });
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 8,
          timeInterval: 1200,
        },
        (p) => {
          const next = { latitude: p.coords.latitude, longitude: p.coords.longitude };
          setMe(next);
          if (fuel?.tripId && !paused) {
            setTrace((prev) => {
              const last = prev[prev.length - 1];
              if (
                last &&
                Math.abs(last.latitude - next.latitude) < 1e-6 &&
                Math.abs(last.longitude - next.longitude) < 1e-6
              ) {
                return prev;
              }
              return [...prev.slice(-4000), next];
            });
          }
        }
      );
    })();
    return () => {
      sub?.remove();
    };
  }, [fuel?.tripId, paused]);

  useEffect(() => {
    if (!dest || !me) return;
    let cancelled = false;
    void fetchOsrmRoute(me, dest).then((r) => {
      if (!cancelled) setRoute(r);
    });
    return () => {
      cancelled = true;
    };
  }, [dest?.latitude, dest?.longitude, me?.latitude, me?.longitude]);

  const onSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.trim().length < 2) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      setHits(await searchPlaces(text));
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const pickHit = (hit: PhotonHit) => {
    Keyboard.dismiss();
    setHits([]);
    setQuery(hit.label);
    setDest(hit);
    mapRef.current?.animateToRegion({
      latitude: hit.latitude,
      longitude: hit.longitude,
      latitudeDelta: 0.03,
      longitudeDelta: 0.03,
    });
  };

  const goMe = () => {
    if (!me) return;
    mapRef.current?.animateToRegion({
      ...me,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  };

  const runFuel = async (action: 'pause' | 'resume' | 'stop') => {
    setBusyFuel(true);
    try {
      const ok = await commandFuel(action, fuel?.tripId ?? null);
      if (action === 'pause') setPaused(true);
      if (action === 'resume') setPaused(false);
      if (action === 'stop') {
        setPaused(true);
        setFuel(null);
      }
      if (!ok) {
        /* Fuel pas installé : le tracé local continue / s’arrête quand même visuellement */
      }
    } finally {
      setBusyFuel(false);
    }
  };

  const fuelKm = useMemo(() => {
    if (trace.length < 2) return 0;
    let m = 0;
    for (let i = 1; i < trace.length; i++) {
      const a = trace[i - 1];
      const b = trace[i];
      const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
      const dLon = ((b.longitude - a.longitude) * Math.PI) / 180;
      const lat1 = (a.latitude * Math.PI) / 180;
      const lat2 = (b.latitude * Math.PI) / 180;
      const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
      m += 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }
    return m / 1000;
  }, [trace]);

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={FRANCE}
        showsUserLocation
        showsMyLocationButton={false}
        toolbarEnabled={false}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
      >
        {Platform.OS === 'android' ? (
          <UrlTile urlTemplate={OSM} maximumZ={19} zIndex={-1} />
        ) : null}
        {dest ? (
          <Marker
            coordinate={{ latitude: dest.latitude, longitude: dest.longitude }}
            title={dest.label}
            pinColor="#ea4335"
          />
        ) : null}
        {route ? (
          <Polyline coordinates={route.coordinates} strokeColor="#1a73e8" strokeWidth={5} />
        ) : null}
        {trace.length >= 2 ? (
          <Polyline coordinates={trace} strokeColor="#188038" strokeWidth={4} />
        ) : null}
      </MapView>

      <View style={[styles.searchWrap, { paddingTop: insets.top + 8 }]}>
        <View style={styles.searchBar}>
          <Ionicons name="search" size={20} color="#5f6368" />
          <TextInput
            value={query}
            onChangeText={(t) => void onSearch(t)}
            placeholder="Rechercher ici"
            placeholderTextColor="#80868b"
            style={styles.searchInput}
            returnKeyType="search"
            onSubmitEditing={() => hits[0] && pickHit(hits[0])}
          />
          {searching ? <ActivityIndicator size="small" color="#1a73e8" /> : null}
        </View>
        {hits.length > 0 ? (
          <ScrollView style={styles.hits} keyboardShouldPersistTaps="handled">
            {hits.map((h) => (
              <Pressable key={`${h.latitude},${h.longitude},${h.label}`} onPress={() => pickHit(h)} style={styles.hit}>
                <Ionicons name="location-outline" size={18} color="#1a73e8" />
                <Text style={styles.hitText}>{h.label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
      </View>

      <Pressable style={[styles.fab, { bottom: (fuel?.tripId ? 168 : 96) + insets.bottom }]} onPress={goMe}>
        <Ionicons name="navigate" size={22} color="#1a73e8" />
      </Pressable>

      {route && dest ? (
        <View style={[styles.sheet, { bottom: (fuel?.tripId ? 88 : 16) + insets.bottom }]}>
          <Text style={styles.sheetTitle}>{dest.label}</Text>
          <Text style={styles.sheetMeta}>
            {route.km.toFixed(1)} km · {route.minutes} min · OSRM
          </Text>
        </View>
      ) : null}

      {fuel?.tripId ? (
        <View style={[styles.fuelBar, { paddingBottom: 12 + insets.bottom }]}>
          <Text style={styles.fuelTitle}>
            {paused ? 'Pause Fuel' : 'Suivi Fuel'} · {fuelKm.toFixed(1)} km
            {fuel.mode === 'free' ? ' · libre' : ''}
          </Text>
          <View style={styles.fuelRow}>
            <Pressable
              style={[styles.fuelBtn, styles.fuelGhost]}
              disabled={busyFuel}
              onPress={() => void runFuel(paused ? 'resume' : 'pause')}
            >
              <Text style={styles.fuelGhostText}>{paused ? 'Reprendre' : 'Pause'}</Text>
            </Pressable>
            <Pressable
              style={[styles.fuelBtn, styles.fuelStop]}
              disabled={busyFuel}
              onPress={() => void runFuel('stop')}
            >
              <Text style={styles.fuelStopText}>Arrêter</Text>
            </Pressable>
            <Pressable
              style={[styles.fuelBtn, styles.fuelFill]}
              disabled={busyFuel}
              onPress={() => void openFuelFillUp(me?.latitude, me?.longitude)}
            >
              <Text style={styles.fuelFillText}>Plein</Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={[styles.tabs, { paddingBottom: 10 + insets.bottom }]}>
          <Text style={styles.tabActive}>Explorer</Text>
          <Text style={styles.tab}>Trajets Fuel</Text>
          <Text style={styles.tab}>Enregistrés</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e8eaed' },
  searchWrap: { position: 'absolute', left: 12, right: 12, zIndex: 10 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 28,
    paddingHorizontal: 16,
    height: 48,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 16, color: '#202124', paddingVertical: 0 },
  hits: {
    marginTop: 8,
    maxHeight: 240,
    backgroundColor: '#fff',
    borderRadius: 12,
    elevation: 3,
  },
  hit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e8eaed',
  },
  hitText: { flex: 1, color: '#202124', fontSize: 15 },
  fab: {
    position: 'absolute',
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
  },
  sheet: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    elevation: 4,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: '#202124' },
  sheetMeta: { marginTop: 4, color: '#5f6368', fontSize: 13 },
  fuelBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 12,
    elevation: 12,
  },
  fuelTitle: { fontWeight: '700', color: '#188038', marginBottom: 10 },
  fuelRow: { flexDirection: 'row', gap: 8 },
  fuelBtn: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: 'center' },
  fuelGhost: { backgroundColor: '#e8f0fe' },
  fuelGhostText: { color: '#1a73e8', fontWeight: '700' },
  fuelStop: { backgroundColor: '#fce8e6' },
  fuelStopText: { color: '#c5221f', fontWeight: '700' },
  fuelFill: { backgroundColor: '#e6f4ea' },
  fuelFillText: { color: '#137333', fontWeight: '700' },
  tabs: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#dadce0',
  },
  tabActive: { color: '#1a73e8', fontWeight: '700' },
  tab: { color: '#5f6368' },
});
