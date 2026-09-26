# Hubera Maps — versions

## 0.1.28 (26 sept. 2026)
- Nuit : **carte sombre** comme avant, sans clé CARTO (OSM inversé, pas de watermark).

## 0.1.27 (26 sept. 2026)
- Itinéraires : calcul **dans le WebView** (TLS Chromium). Le natif SSL échouait sur le Blackview.

## 0.1.26 (26 sept. 2026)
- OSRM : repli `routing.openstreetmap.de` + UA Chrome (le demo OSRM renvoyait vide sur le téléphone).
- Un seul panneau d’itinéraire sous la recherche.

## 0.1.25 (26 sept. 2026)
- Itinéraires : le panneau `#sheet` avait disparu du HTML, le calcul plantait (promesse null).

## 0.1.24 (26 sept. 2026)
- Panneau d’itinéraire **sous la recherche** (plus caché par Music).
- Plus d’attente infinie sur des variantes OSRM.

## 0.1.23 (26 sept. 2026)
- Itinéraires : pont OSRM avec coordonnées en texte (le WebView cassait les Double).

## 0.1.22 (26 sept. 2026)
- Carte **OSM lisible** (CARTO affiche « API KEY REQUIRED », on n’y touche plus).
- Itinéraires **OSRM natif** : le trait et les durées s’affichent vraiment.
- Zone 30 + recherche Entrée = le lieu (0.1.21).

## 0.1.21 (26 sept. 2026)
- Recherche : Entrée lance le **lieu tapé**, plus « Ma position ».
- Nuit : **CARTO Dark** comme avant (OSM en secours, pas de filtre gris).
- Zone **30** détectée si les rues autour sont à 30, même sans tag sur ta rue.

## 0.1.20 (26 sept. 2026)
- Limite de vitesse **native** (Overpass hors WebView) : le disque affiche 50 / 30 / 80 même sans tag, et même depuis l’APK `file://`.

## 0.1.19 (26 sept. 2026)
- Limite de vitesse même sans tag OSM `maxspeed` (50 en agglomération, 20 aire piétonne, etc.).
- Dock Music : bouton pause si le titre est lancé (y compris pendant le buffer).

## 0.1.18 (26 sept. 2026)
- Tuiles **OSM public**, plus de CARTO (clé API inutile). Nuit = filtre CSS.
- Panneau **limite de vitesse** OSM (à la place du nom de rue).
- Dock Music : titre en temps réel (poll 1 s + reconnexion session).

## 0.1.17 (25 sept. 2026)
- Après « sources inconnues », Maps **relance l’install toute seule** (APK déjà téléchargée).
- Toujours FileProvider, jamais Chrome `/install`.

## 0.1.16 (25 sept. 2026)
- MAJ **uniquement in-app** : WebView ne peut plus ouvrir Chrome `/install`.
- FileProvider + `ACTION_INSTALL_PACKAGE`. Overlay Nothing + BV + Samsung.

## 0.1.15 (25 sept. 2026)
- Mise à jour **in-app** (téléchargement + FileProvider). Plus de redirect `/install` dans Chrome.
- Dock Music : titre / artiste réels, ou « Aucun titre — ouvre Music ».
- Carte centrée sur la dernière position GPS (< 18 h) dès l’ouverture.

## 0.1.14 (25 sept. 2026)
- Distance restante **le long de l’itinéraire** (plus le vol d’oiseau).
- Flèche de cap sur le point GPS.
- Tuiles nuit (CARTO Dark) entre 21 h et 6 h.
- Annonce vocale FR de la manœuvre à l’approche + « Vous êtes arrivé ».

## 0.1.13
- Vitesse HUD, recentrage, Stations / Parkings OSM.

## 0.1.12
- Guidage type Google Maps, Fuel Pause / Arrêter / Plein sans quitter Maps.
