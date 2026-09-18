# Deep links Cloudity Maps

## Schéma applicatif (cible Android / iOS)

```
cloudity-maps://navigate?lat={lat}&lon={lon}&label={urlencoded}
cloudity-maps://route?fromLat=&fromLon=&toLat=&toLon=
```

## Fallback « Ouvrir dans… » (hors Maps)

| App | Exemple |
|-----|---------|
| Google Maps | `https://www.google.com/maps/dir/?api=1&destination=lat,lon` |
| Waze | `https://waze.com/ul?ll=lat,lon&navigate=yes` |
| OsmAnd | `https://osmand.net/map?pin=lat,lon` |
| Organic Maps | `https://omaps.app/map?v=1&ll=lat%2Clon&n=1` |

Les apps satellites (Gasoil, etc.) gèrent ces fallbacks **dans leur repo** ; Maps n’impose rien.
