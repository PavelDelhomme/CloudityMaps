# Deep links Hubera Maps

Schéma **principal** : `hubera-maps://`  
Alias historique : `cloudity-maps://` (même paths).  
Web : `https://maps.hubera.cloud/…`

Fuel (`gasoiltracking://`) reste le propriétaire des trajets. Maps n’invente pas un second historique.

## Maps — entrée

```
hubera-maps://track?tripId={id}&vehicleId={id}&mode=free
hubera-maps://navigate?tripId={id}&toLat=&toLon=&label=&mode=nav
hubera-maps://show?tripId={id}
hubera-maps://search?q=
hubera-maps://place?lat=&lon=&label=
hubera-maps://route?fromLat=&fromLon=&toLat=&toLon=
```

Web équivalent : `https://maps.hubera.cloud/?lat=&lon=` ou `?q=` / `?track=1&tripId=`.

## Fuel — contrôle depuis Maps

```
gasoiltracking://trip/control?action=pause&tripId=
gasoiltracking://trip/control?action=resume&tripId=
gasoiltracking://trip/control?action=stop&tripId=
gasoiltracking://fillup/add?lat=&lon=
gasoiltracking://trip/{id}
```

## Fallback si Hubera Maps n’est pas installée

Fuel **reste sur son onglet Maps** (suivi GPS déjà démarré).  
Ne plus ouvrir Google Maps / Apple Plans en premier pour un **suivi libre**.  
Navigation A→B : Hubera Maps d’abord, Google / Apple seulement si Maps absente.

Les apps satellites gèrent ces fallbacks **dans leur repo**.
