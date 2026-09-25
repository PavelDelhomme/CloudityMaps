# Hubera Maps

Produit **cartes / navigation** Hubera (OSM, design proche de Google Maps).  
Repo GitHub historique : `PavelDelhomme/CloudityMaps` (pas de rename GitHub).

- **Cahier** (à lire avant de coder) : [`docs/HUBERA-MAPS-CAHIER.md`](docs/HUBERA-MAPS-CAHIER.md)
- **Mobile d’abord** (Android + iPhone, Expo dans `mobile/`) — web ensuite
- Handshake **Hubera Fuel** : suivi libre Fuel → ouvre Maps ; Pause / Terminer / Plein dans Maps → Fuel
- Stack / volume **séparés** de Fuel, Music, Jobs. Ne pas `down -v`.
- Lien Hubera : `products/maps`.

## Mobile (Android + iPhone)

```bash
cd mobile
npm install
npx expo start
```

Package : `ovh.delhomme.maps` · schémas `hubera-maps://` et `cloudity-maps://`.  
Fuel : `gasoiltracking://trip/control?action=pause|resume|stop`.

## MVP web

```bash
python3 -m http.server 8765 --directory web
# → http://127.0.0.1:8765
```

Portainer (plus tard) : `docker-compose.portainer.yml` → conteneur `hubera-maps` sur `shared-network-copy`.

## Deep links

Schéma cible : `hubera-maps://navigate?lat=&lon=&label=` (historique `cloudity-maps://` encore documenté).  
Voir [`docs/deep-links.md`](docs/deep-links.md).

## Portainer

- Stack Git : `hubera-maps`
- Compose : `docker-compose.portainer.yml`
- Réseau : `shared-network-copy` (env `NPM_NETWORK`)
- Env : `.env` local (gitignoré), pas dans Git
- Updates : `https://hubera.cloud/updates/maps.json`

Ne pas `down -v`. Ne pas fusionner avec Cloudity / PLM / Gasoil / JT.
