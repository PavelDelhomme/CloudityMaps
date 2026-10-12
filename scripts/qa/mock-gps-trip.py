#!/usr/bin/env python3
"""Harnais Samsung mock GPS — suivi libre + destination.

Usage :
  python3 mock-gps-trip.py --serial R5CT7263YJL --mode free
  python3 mock-gps-trip.py --serial R5CT7263YJL --mode dest

L’opérateur regarde l’écran. Chaque écart (tuiles, jauge, trace) est loggé.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

SAMSUNG = "R5CT7263YJL"
# Rennes → Saint-Jacques, points ~toutes les 2 s
PATH = [
    (48.1173, -1.6778),
    (48.1140, -1.6805),
    (48.1102, -1.6840),
    (48.1065, -1.6888),
    (48.1030, -1.6935),
]


def adb(serial: str, *args: str) -> subprocess.CompletedProcess:
    cmd = ["adb", "-s", serial, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, capture_output=True, text=True)


def report(ok: bool, expected: str, got: str) -> None:
    tag = "OK" if ok else "ECART"
    line = f"[{tag}] attendu={expected} | obtenu={got}"
    print(line, flush=True)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--serial", default=SAMSUNG)
    p.add_argument("--mode", choices=("free", "dest"), default="free")
    args = p.parse_args()
    serial = args.serial
    devices = adb(serial, "get-state")
    if devices.returncode != 0 or "device" not in (devices.stdout + devices.stderr):
        report(False, "Samsung en device", devices.stderr.strip() or devices.stdout.strip())
        return 2
    report(True, "appareil joignable", "device")
    adb(serial, "shell", "settings", "put", "secure", "location_mode", "3")
    adb(serial, "shell", "appops", "set", "cloud.hubera.maps", "MOCK_LOCATION", "allow")
    adb(serial, "shell", "am", "start", "-n", "cloud.hubera.maps/.MainActivity")
    time.sleep(3)
    print(f"# mode={args.mode} — regarde l’écran : jauge, tuiles, trace", flush=True)
    for i, (lat, lon) in enumerate(PATH):
        geo = adb(serial, "emu", "geo", "fix", str(lon), str(lat))
        if geo.returncode != 0:
            adb(serial, "shell", "am", "broadcast", "-a", "android.intent.action.SET_MOCK_LOCATION")
        print(f"  point {i + 1}/{len(PATH)} {lat},{lon}", flush=True)
        time.sleep(2.2)
    report(True, "parcours injecté", f"{len(PATH)} points")
    print("Vérifie à l’œil : tuiles visibles, pas de trajet zombie sans GPS, sheet jauge à l’arrêt.", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
