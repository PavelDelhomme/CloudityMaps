# Hubera Maps — versions

## 0.1.81 (8 oct. 2026)
- Fusion cold-start 0.1.79 + chrome natif 0.1.80.
- SSO `adoptHuberaId` **hors UI** ; Overpass skip non-JSON.
- Enregistrer un trajet à une date → Hubera Calendar (API) ou stub `content://` / calendar.hubera.cloud (file durable).
- Pont Fuel `hubera-maps://` : schéma uniquement sur `cloud.hubera.maps` (plus de chooser 2 icônes). Legacy garde `cloudity-maps://`.
- Dual APK vc 82. OTA `forceUpdate: false` / `mandatory: false`. Overlay Samsung `-r` seulement.

## 0.1.80 (8 oct. 2026)
- Chrome natif : hamburger, compte, nav Carte / Trajet / Lieux. Pas de barre search native sur la carte.

## 0.1.79 (8 oct. 2026)
- Cold start : carte d’abord, même hors-ligne / sans token. GPS après le premier paint.

## 0.1.77 (8 oct. 2026)
- Sous la limite de vitesse : petit menu d’infos trajet (jauge Fuel live, km restants **hors suivi libre**, ETA, conso / plein).
- HUD 0.1.75/76 inchangé : `STILL_KMH=5`, `ROLL_KMH=8`, « À l’arrêt », Fuel armé seulement en roulant.

## 0.1.76 (7 oct. 2026)
- P0 Samsung : un Overpass HTML/XML (`<?xml`, 504) ne plante plus l’app à l’ouverture.
- `SpeedLimitBridge` ignore tout body non JSON, `runCatching` sur le pool — le process ne crash plus.
- JS Overpass : même filtre, bascule d’endpoint au lieu de `JSON.parse` sur du HTML.

## 0.1.75 (7 oct. 2026)
- À l’arrêt : compteur **0 km/h** (plus le 1–3 km/h du bruit GPS).
- Voix GPS coupée tant qu’on ne roule pas ; HUD **À l’arrêt** / **En pause**.
- Les **47 km · 57 min** sont le **reste** d’itinéraire, pas un trajet déjà fait.
- Fuel ne démarre plus au tap « Démarrer » : seulement après quelques secondes réellement en mouvement (ou via Fuel toi-même).
- Horloge Fuel figée à l’arrêt / en pause. Tracé GPS : plus de km fantômes.
- MAJ jamais forcée.

## 0.1.69 (5 oct. 2026)
- Fuel idle : bouton sombre, menu **Démarrer / Plein / Garage** (plus « Arrêter » rose sans trajet).
- Garage : retry snapshot + Fuel legacy si le garage reste vide.
- Maison/Travail : enregistrer ferme la recherche ; redéfinir sans lancer d’itinéraire ; petit nom + suppression.
- Points orange = travaux OSM, cliquables.
- Dock Music : play/pause calé sur `isPlaying` réel (plus le rose « pause » à l’ouverture).

## 0.1.68 (1er oct. 2026)
- **Ouvrir Hubera Fuel** : pastille rouge Hubera (plus le bouton ghost gris). Lance `cloud.hubera.fuel` en priorité (plus l’ancien package si les deux sont installés).
- Garage Maps : nom du véhicule du compte, chips sélectionnables, véhicule **actif Fuel** pré-sélectionné. Snapshot forcé à l’ouverture de l’onglet.
- Dock Music : précédent / suivant via la session Media3 Hubera (plus de double skip ni touche média globale si connecté). Boutons next/prev au design Hubera.

## 0.1.67 (1er oct. 2026)
- Overlay production A+B, Fuel, dock Music. Signature debug `3cf6c532`. MAJ jamais forcée.

## 0.1.66 (1er oct. 2026)
- Alignement install / OTA package `cloud.hubera.maps`.

## 0.1.65 (1er oct. 2026)
- Itinéraire : points A/B remplacés par des **points** avec le **nom en dessous** (Domicile, Intermarché, ou n° de rue).
- Carte type Google Maps : champ **départ** (nom + adresse) au-dessus de **arrivée**, bouton **inverser**.
- Départ GPS si non choisi : rue + numéro, ou Domicile si on est à la maison. Zoom entre les deux bouts inchangé.

## 0.1.64 (1er oct. 2026)
- Guidage : vue première personne (inclinaison + cap) dès Démarrer, comme Google Maps.
- HUD : rue en titre, **Puis** compact ; plus la phrase « En bout de voie… ».
- Panneau de vitesse + ZONE en haut à droite. Logo Fuel en bas (Pause / Arrêter / Plein), réglable.
- ✕ arrête le guidage **et** Fuel. Villes / POI selon le zoom. Pins perso plus petits.

## 0.1.63 (1er oct. 2026)
- Dock Music : bouton suivant = vrai titre suivant (plus de restart du titre en cours).

## 0.1.62 (1er oct. 2026)
- A (Départ) et B (Arrivée) cadrés **dans le trou de carte** sous la barre transport, au-dessus du dock.
- Padding Leaflet en (x, y) : plus le milieu du tracé tout seul. Arrêter Fuel = broadcast, Maps ne bouge pas.

## 0.1.61 (1er oct. 2026)
- Itinéraire : cadrage **uniquement A (départ) et B (arrivée)** — plus le barycentre du tracé « au milieu de nulle part ».
- Dézoom + centrage entre les deux points, en tenant compte de la carte transport / recherche / FAB.
- Arrêter Fuel depuis Maps : **broadcast / headless**, plus d’ouverture-fermeture de l’app Fuel.

## 0.1.56 (30 sept. 2026)
- Onglet Fuel : jauge, véhicule, démarrer, plein — plus d’historique ni d’écran « 2e app ».
- Plus de flash splash / dialogue MAJ quand Maps parle à Fuel en silencieux.

## 0.1.55 (30 sept. 2026)
- Ouvrir Hubera Fuel : lance l’app Accueil (plus d’écran blanc laissé par le GPS silencieux).

## 0.1.54 (30 sept. 2026)
- Maps = démarrer / suivre un trajet. Hubera Fuel (l’app) = garage, pleins, budget, conso.
- Menu « Hubera Fuel » ouvre l’app dédiée, plus un clone Fuel dans Maps.

## 0.1.53 (30 sept. 2026)
- Plein : plus de « 30 » (limite de vitesse) dans le champ station. Formulaire sous la barre d’état.

## 0.1.52 (30 sept. 2026)
- Onglet Fuel dédié dans Maps (jauge, véhicule, plein, garage, budget) — plus d’ouverture d’une 2e app.
- Le 62 % à côté de la recherche n’était pas la batterie : faux badge. Avatar = initiale. La jauge réelle est dans Fuel.
- Démarrer un trajet = choix du véhicule, plus de « suivi libre ». Plein possible pendant le trajet.

## 0.1.51 (30 sept. 2026)
- Dock Music : reconnecte la session si Music a redémarré (plus de « Rien en cours » alors que ça joue).

## 0.1.50 (29 sept. 2026)
- Bouton ♪ Music à gauche du recentrer Fuel (plus par-dessus).

## 0.1.49 (29 sept. 2026)
- Dock Music : réaffichage auto dès qu’un titre joue ; bouton ♪ à droite (plus caché par Fuel).
- Précédent = vrai titre précédent (plus de restart de la piste en cours).

## 0.1.48 (29 sept. 2026)
- Disque limite : proxy `maps.hubera.cloud/overpass`, lookup natif en parallèle (plus de file d’attente 36 s), arguments String (WebView).
- Repli JS vers le même proxy (CORS *) si le pont natif rate.

## 0.1.47 (29 sept. 2026)
- À la maison / au travail : le pin enregistré se cache (plus de superposition avec le point bleu).
- Limitation de vitesse : 3e Overpass, retry plus rapide si le disque reste « — ».

## 0.1.46 (29 sept. 2026)
- Fuel dans Maps en prod : mix feuille + HUD + GPS Fuel invisible (`com.gasoiltracking.app` inchangé).
- Pause / Arrêter / Plein lisibles (plus masqués par Music).
- Liste des trajets Fuel dans la feuille (y compris le trajet en cours).
- Point bleu + halo ; noms maison/travail complets au zoom.
- Comparer Fuel : Paramètres, plus de barre jaune permanente.

## 0.1.39 (29 sept. 2026)
- MAJ in-app même si la 0.1.37 a tout figé : « Plus tard » ne bloque plus la version suivante.
- Tuiles : fetch natif OSM.de (file:// Nothing) + repli ArcGIS.
- Bandeau si le JS ne démarre pas.

## 0.1.38 (29 sept. 2026)
- Carte : plus de crash JS au démarrage (`NIGHT_KEY` lu trop tôt → écran vide, pas de Music).
- Tuiles **OSM.de / OSM.fr** : `tile.openstreetmap.org` répond 418 « Access blocked ».
- Hors ligne : cache uniquement, plus de fetch Java qui enregistrait les tuiles 418.

## 0.1.37 (29 sept. 2026)
- Dock Music : **suivant / précédent** passent par `seekToNext` (commande toujours exposée), plus un no-op `seekToNextMediaItem` quand la file n’a qu’un titre.

## 0.1.36 (29 sept. 2026)
- Croix **✕** sur la carte d’itinéraire (Maison / Travail / recherche) : masque le trajet sans démarrer.
- **Paramètres** : voix, nuit auto/on/off, mode, dock Music, vérif MAJ in-app.
- **Cartes hors ligne** : cache tuiles OSM autour de moi / Maison / Travail (zooms 12–16).

## 0.1.31 (27 sept. 2026)
- Clic sur le titre Music : **lecteur dans Maps** (titre + prev/play/next), trajet ou non. Plus d’ouverture forcée de l’app.
- Dock : « Rien en cours » au lieu de « Aucun titre — ouvre Music ».

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
