# Hubera Maps — cahier fonctionnalités & interface

**Produit** : Hubera Maps (`maps.hubera.cloud`)  
**But** : carte / recherche / itinéraire / navigation **comme Google Maps**, design proche, **mieux sur le carburant et les trajets Hubera Fuel**.  
**Priorité** : **mobile d’abord** (Android + iPhone), web ensuite.  
**Intégration** : Hubera Fuel (ex-Gasoil Tracking) — **une source de vérité pour les trajets**, Maps pour la carte et le guidage.

État actuel (25/09/2026) : landing Leaflet + OSRM public, pas d’app native. Fuel 1.4.145 a déjà un onglet Maps, suivi libre GPS, pause/terminer, OSRM, et ouvre encore Google Maps en secours. On **découpe** : Fuel = conso / pleins / garage ; Maps = Google Maps Hubera.

Ne pas `down -v`. Ne pas fusionner les volumes Fuel. `applicationId` Fuel `com.gasoiltracking.app` **inchangé**. Compte Hubera ID `paul@delhomme.ovh` (opt-in SSO, login local gardé).

---

## 1. Idée produit (ce que tu as demandé)

1. **Démarrer trajet** dans Fuel, mode **suivi libre** :
   - Fuel crée le trajet + démarre le GPS (comme aujourd’hui).
   - Fuel **ouvre Hubera Maps** (pas Google Maps).
   - Maps **trace** le parcours en live.
2. **Dans Hubera Maps** pendant un suivi Fuel :
   - Pause suivi
   - Reprendre
   - Arrêter / Terminer
   - Le résultat (trace, km, pauses, horodatage) **part tout de suite vers Fuel** (sync cloud + local).
3. **Les deux apps se voient** :
   - Fuel affiche le trajet Maps (même id, même polyline).
   - Maps affiche le véhicule, la jauge, le dernier plein Fuel.
4. **Sans Fuel**, Maps reste une app cartes complète (recherche, fiches lieux, itinéraires, navigation).
5. **iPhone** dès le départ (même base Expo que Fuel), pas un Android-only.

---

## 2. Contrat Fuel ↔ Maps (à coder en premier côté mobile)

### 2.1 Qui possède quoi

| Donnée | Propriétaire | Maps | Fuel |
|--------|--------------|------|------|
| Trajet (id, véhicule, km, conso, pleins) | **Fuel API + SQLite Fuel** | écrit GPS / pause / fin | lit / corrige / historise |
| Trace GPS (points) | Fuel (`routePoints`) | capture + affiche | calcule km / conso |
| Itinéraire prévu (OSRM) | Maps | calcule, stocke `routeId` | optionnel overlay |
| Lieux Maison / Travail | Fuel `places` | lit via API / Hubera ID | édite |
| Carte, POI, recherche | Maps | Nominatim / Photon / Overpass | ne duplique pas |

### 2.2 Deep links (schéma unique)

Préférer `hubera-maps://` (garder `cloudity-maps://` en alias). Fuel : `gasoiltracking://` (inchangé).

**Fuel → Maps**

```
hubera-maps://track?tripId={id}&vehicleId={id}&mode=free&huberaUser={sub}
hubera-maps://navigate?tripId={id}&toLat=&toLon=&label=&mode=nav
hubera-maps://show?tripId={id}          # trajet déjà fini
hubera-maps://search?q=
hubera-maps://place?lat=&lon=&label=
```

**Maps → Fuel**

```
gasoiltracking://trip/pause?tripId=
gasoiltracking://trip/resume?tripId=
gasoiltracking://trip/stop?tripId=
gasoiltracking://fillup/new?lat=&lon=   # « J’ai fait le plein » depuis Maps
gasoiltracking://trip/open?tripId=      # fiche Fuel
```

En plus : **API Fuel** authentifiée (même JWT Hubera ID / token Fuel actuel) :

- `POST /api/trips/:id/points`  lots de positions (lat, lon, acc, speed, at)
- `POST /api/trips/:id/control` `{ action: pause|resume|stop }`
- `GET  /api/trips/active`
- `GET  /api/vehicles/active` (jauge, conso)

Maps **n’invente pas** un second historique de trajets. Si l’API est injoignable : file locale puis flush (comme Fuel aujourd’hui).

### 2.3 UX enchaînement « Démarrer trajet / suivi libre »

1. Fuel : FAB / bouton **Démarrer trajet** → choix **Suivi libre** (ou destination).
2. Fuel : `startGpsTrip` (déjà dans `lib/startFreeTrip.ts`) — FGS Android / background iOS.
3. Fuel : `Linking.openURL('hubera-maps://track?...')` si Maps installée, sinon **rester sur l’onglet Maps Fuel** (pas Google) + bandeau « Installer Hubera Maps ».
4. Maps s’ouvre **sur le suivi**, polyline qui grossit, bouton **Pause** / **Terminer** **Fuel**.
5. Terminer : Maps envoie `stop` → Fuel clôture km + conso + sync cloud (trajets 155/156 Guerche **intacts**, pas d’écrasement).

### 2.4 Permissions

- Localisation quand l’app est ouverte **et** arrière-plan (trajet).
- Notification persistante « Suivi Hubera Fuel · Hubera Maps » (une notif, deux apps liées).
- Pas de tracking si l’utilisateur n’a pas démarré un trajet.

---

## 3. Interface — calque Google Maps (mobile)

Écran unique carte plein pot, **pas** un site avec HUD sombre prototype.

### 3.1 Chrome (toujours)

- Barre de **recherche** en haut, coins arrondis, ombre, avatar Hubera ID à droite.
- Pastille **ma position** (bas droite).
- Calques (bas droite, au-dessus) : relief / satellite / trafic (OSM + tuiles traffic plus tard).
- Barre du bas : **Explorer** · **Trajets** (Fuel) · **Enregistrés** · **Contribute** (plus tard).

### 3.2 Recherche (comme la search Google Maps)

- Autocomplétion dès 2 caractères (Photon / Nominatim + récents Fuel).
- Catégories chips : Stations, Parking, Restos, Super, Hôtel, Recharge VE.
- Récents + favoris (Maison, Travail depuis Fuel).
- Fiche lieu : nom, note OSM si dispo, horaires Overpass, itinéraire, appel, partage, « Y aller », « Suivi libre depuis ici ».
- Pas de Google Places payant en v1 ; OSM + Overpass. Stations Fuel **prioritaires** (déjà dans Fuel).

### 3.3 Itinéraires

- Modes : Voiture · Deux-roues · Marche · (Transit plus tard).
- 2–3 alternatives : **Rapide** / **Éco** (aligné Fuel éco/rapide OSRM).
- ETA, km, péage (OSRM annotations / Valhalla plus tard).
- Trafic coloré sur le trait (quand on aura une source ; sinon gris).
- Bouton **Démarrer** → navigation turn-by-turn **dans Maps**.
- Si un véhicule Fuel est actif : toggle **« Tracer pour Fuel »** (crée/attache le trip).

### 3.4 Navigation guidée

- Flèche / caméra 2D puis 3D simple.
- Prochaine instruction + distance.
- Vitesse + limitation OSM (`maxspeed`) — Fuel a déjà le panneau.
- Recalcul si on sort du corridor.
- Audio optionnel (TTS OS).
- Bouton croix = quitter le guidage **sans** forcément arrêter le suivi Fuel (demander).

### 3.5 Suivi Fuel dans Maps (bandeau dédié)

Quand `tripId` est actif :

```
[ ● Suivi Fuel · 12,4 km · 5,8 L/100 ]
[ Pause ]  [ Terminer ]  [ Plein ]
```

- Pause / Terminer = deep link + API §2.
- Jauge miniature si Fuel l’envoie.
- Ne **pas** dupliquer tout le garage Fuel.

### 3.6 Trajets (onglet)

- Liste des trajets Fuel du compte (aller/retour, GPS, `maps_import`).
- Carte de rejeu (polyline réelle, **pas** un OSRM A→B qui efface l’aller-retour).
- Ouverture fiche Fuel.

### 3.7 Design

- Clair jour / sombre nuit (Material 3 / iOS native feel).
- Typo system-ui, bleu position « Google-like », vert Hubera pour Fuel / éco.
- Sheets bas (détail lieu, alternatives) comme Maps, pas des pages plein écran partout.

---

## 4. Inventaire Google Maps → Hubera (backlog)

Légende : **P0** mobile MVP · **P1** navigation + Fuel · **P2** parité confort · **P3** plus tard / jamais Google-propriétaire.

### 4.1 Carte & rendu

| Fonction Google Maps | Hubera | Priorité |
|----------------------|--------|----------|
| Carte vectorielle fluide | Tuiles OSM (MapLibre) | P0 |
| Satellite / relief | Tuiles aériennes OSM / Esri (attrib.) | P2 |
| Trafic temps réel | Couche plus tard (TomTom/HERE ou bouchons OSM) | P2 |
| Vue 3D / tilt | MapLibre pitch | P1 |
| Indoor | Non | P3 |
| Street View | Mapillary optionnel | P3 |
| Globe | Non | P3 |

### 4.2 Position

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| Point bleu + précision | GPS + boussole | P0 |
| Recaler la vue | FAB | P0 |
| Localisation arrière-plan | Lié au trajet Fuel | P0 |
| Partager ma position | Lien temporaire | P2 |
| Localiser un iPhone / famille | Non v1 (privacy) | P3 |

### 4.3 Recherche & lieux

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| Autocomplete | Photon + récents | P0 |
| Fiches POI | OSM tags | P1 |
| Photos / avis Google | Non (pas de scrape) | — |
| Avis Hubera plus tard | Compte ID | P3 |
| Horaires | OSM `opening_hours` | P2 |
| Itinéraire vers un lieu | OSRM | P0 |
| Stations-service | Overpass + **liste Fuel** | P0 |
| Parkings | OSM | P1 |
| Bornes VE | OSM | P2 |

### 4.4 Itinéraires & navigation

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| A → B voiture | OSRM / Valhalla self-host | P0 |
| Alternatives | Fuel a déjà éco/rapide | P0 |
| Marche / vélo | OSRM profiles | P1 |
| Transports en commun | GTFS plus tard | P3 |
| Guidage vocal | TTS | P1 |
| Voies / péages | Annotations | P2 |
| Hors ligne (pack région) | MapLibre offline | P2 |
| Mode éco Fuel | Coût € / L estimé | P1 |
| Éviter péages / autoroutes | Options OSRM | P1 |

### 4.5 Enregistrement & timeline

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| Lieux enregistrés | Fuel places + Maps | P1 |
| Listes | Plus tard | P2 |
| Timeline Google | **Trajets Fuel** | P0 |
| Import Google Timeline | Fuel a déjà un import | P1 (Maps relais) |

### 4.6 Contribuer

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| Signaler un bouchon | Plus tard | P2 |
| Notes OSM | Lien éditeur | P3 |
| Photos | Non v1 | P3 |

### 4.7 Compte & plateforme

| Fonction | Hubera | Priorité |
|----------|--------|----------|
| Compte | Hubera ID opt-in | P0 |
| Sync | Fuel cloud existant | P0 |
| Android | Expo `applicationId` **nouveau** Maps | P0 |
| iPhone | même Expo, bundle `ovh.delhomme.maps` (à figer) | P0 |
| Web | MapLibre, même API | P2 (après mobile) |
| Wear / Auto | Plus tard | P3 |

---

## 5. Stack technique proposée

- **App** : Expo / React Native (comme Fuel) → un code Android + iOS, Hubera ID, deep links.
- **Carte** : MapLibre GL (vecteur, pitch, offline) plutôt que Google SDK (coût + lock).
- **Géo** : Nominatim / Photon (recherche), OSRM ou Valhalla **self-host VPS** (plus le `router.project-osrm.org` démo).
- **POI** : Overpass pour stations / maxspeed (Fuel le fait déjà).
- **API Maps** : légère (tiles proxy, rate-limit, deep link tokens) — **trajets = API Fuel**.
- **Background GPS** : continuer d’utiliser le module Fuel **ou** un module Maps qui **pousse** vers Fuel ; un seul FGS à la fois.

Self-host tuiles + OSRM sur le VPS Hubera : obligatoire avant une app publique (OSM public ToS). Volume **neuf** `hubera-maps-data`, ne pas toucher `gasoil_api_data`.

---

## 6. Ordre de build (mobile avant web)

### P0 — « Fuel ouvre Maps et on trace »

1. App Expo Hubera Maps : carte MapLibre, search, ma position, A→B OSRM.
2. Deep links `hubera-maps://track` + `gasoiltracking://trip/{pause,resume,stop}`.
3. Fuel : au **suivi libre**, `openURL` Maps au lieu de Google ; fallback onglet Maps Fuel.
4. Bandeau Pause / Terminer dans Maps → API Fuel.
5. iOS : mêmes screens, permissions Info.plist (copie Fuel, marque Hubera Maps).
6. Overlay Android `-r` **uniquement** le **nouveau** package Maps (ne pas toucher Fuel 1.4.145 data).

### P1 — Google Maps « utile au quotidien »

Navigation turn-by-turn, alternatives éco, fiches lieux, stations Fuel sur la carte, rejeu trajet, jauge.

### P2 — Web + confort

`maps.hubera.cloud` = vraie app (plus la landing Leaflet). Hors-ligne, trafic, import Timeline via Fuel.

### P3 — Nice-to-have

Transit, Mapillary, listes, famille.

---

## 7. Tests (Samsung + Blackview, iPhone dès qu’on a un device)

- Fuel **suivi libre** → Maps s’ouvre, polyline bouge, Pause / Terminer, trajet **visible dans Fuel** avec les mêmes km.
- Trajet La Guerche / historiques **non écrasés**.
- Sans Maps installée : Fuel reste utilisable (onglet actuel).
- Recherche « Intermarché » → fiche → Y aller.
- Navigation 2 km, recalcul si on dévie.
- Mute / pas de clavier Samsung hog ; Nothing seulement si demandé.
- iPhone : TestFlight interne, background location.

---

## 8. Hors scope volontaire

- Cloner Street View, avis Google, pubs, bus Google.
- Forcer SSO Hubera ID.
- Fusionner les bases Fuel et Maps.
- `forceUpdate` Fuel ou Music.

---

## 9. Fichiers / repos

| Repo | Rôle |
|------|------|
| `Perso/Maps` (GitHub `CloudityMaps` pour l’instant) | App Maps + ce cahier |
| `Perso/GasoilTracking` | Fuel : deep link sortie + API points |
| `HuberaCloud/products/maps` | symlink |

README Maps : pointer ici. Deep links historiques `cloudity-maps://` : alias.

---

*Cahier écrit le 25 septembre 2026. Implémentation : P0 mobile après validation de ce fichier.*
