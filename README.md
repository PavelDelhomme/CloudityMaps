# Cloudity Maps

Produit **cartes / navigation** de la suite Cloudity (OSM, offline-friendly).

- **Pas** de moteur Waze embarqué — deep links optionnels uniquement.
- Stack / volume **séparés** de GasoilTracking, YTMusic, JobbingTrack.
- Développé dans ce repo ; intégré à Cloudity via submodule `products/maps`.

## MVP web

```bash
# Servir le prototype Leaflet + OSRM public
python3 -m http.server 8765 --directory web
# → http://127.0.0.1:8765
```

## Deep links

Schéma cible : `cloudity-maps://navigate?lat=&lon=&label=`  
Voir [`docs/deep-links.md`](docs/deep-links.md).

## Suite Cloudity

Parent : `PavelDelhomme/Cloudity` → `products/maps` (submodule).  
Ne pas fusionner les bases / volumes avec Gasoil.
