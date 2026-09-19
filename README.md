# Hubera Maps

Produit **cartes / navigation** Hubera (OSM, offline-friendly).  
Repo GitHub historique : `PavelDelhomme/CloudityMaps` (pas de rename GitHub).

- Stack / volume **séparés** de GasoilTracking, Music, Jobs.
- Développé ici ; lien Hubera : `products/maps`.

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
