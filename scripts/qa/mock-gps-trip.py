#!/usr/bin/env python3
"""Harnais mock GPS physique — Samsung Android 12+ via `cmd location`.

Usage :
  python3 mock-gps-trip.py --serial R5CT7263YJL --mode free
  python3 mock-gps-trip.py --serial EEA9700PRO0014587 --mode free

`adb emu geo` ne bouge pas un téléphone réel. Ici : test provider GPS.
L’opérateur regarde l’écran. Chaque écart (tuiles, jauge, trace) est loggé.
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time

from mock_gps_lib import (
    FUEL_PKG,
    MAPS_ACTIVITY,
    MAPS_PKG,
    RENNES_ST_JACQUES as PATH,
    location_cmd_supported,
    set_test_provider_location_args,
    setup_test_provider_cmds,
)

SAMSUNG = "R5CT7263YJL"


def adb(serial: str, *args: str) -> subprocess.CompletedProcess:
    cmd = ["adb", "-s", serial, *args]
    print("+", " ".join(cmd), flush=True)
    return subprocess.run(cmd, capture_output=True, text=True)


def report(ok: bool, expected: str, got: str) -> None:
    tag = "OK" if ok else "ECART"
    print(f"[{tag}] attendu={expected} | obtenu={got}", flush=True)


def sdk_int(serial: str) -> int:
    r = adb(serial, "shell", "getprop", "ro.build.version.sdk")
    try:
        return int((r.stdout or "0").strip())
    except ValueError:
        return 0


def dumpsys_last_fix(serial: str) -> str:
    r = adb(serial, "shell", "dumpsys", "location")
    text = r.stdout or ""
    for line in text.splitlines():
        low = line.lower()
        if "last location" in low or "lastlocation" in low.replace(" ", "") or "gps:" in low:
            return line.strip()[:200]
    return text.strip().splitlines()[0][:200] if text.strip() else "(dumpsys vide)"


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--serial", default=SAMSUNG)
    p.add_argument("--mode", choices=("free", "dest"), default="free")
    args = p.parse_args()
    serial = args.serial
    devices = adb(serial, "get-state")
    if devices.returncode != 0 or "device" not in (devices.stdout + devices.stderr):
        report(False, "appareil en device", (devices.stderr or devices.stdout).strip())
        return 2
    report(True, "appareil joignable", "device")

    sdk = sdk_int(serial)
    rel = (adb(serial, "shell", "getprop", "ro.build.version.release").stdout or "").strip()
    print(f"# sdk={sdk} android={rel} mode={args.mode}", flush=True)

    adb(serial, "shell", "settings", "put", "secure", "location_mode", "3")
    adb(serial, "shell", "appops", "set", MAPS_PKG, "MOCK_LOCATION", "allow")
    adb(serial, "shell", "appops", "set", FUEL_PKG, "MOCK_LOCATION", "allow")

    if not location_cmd_supported(sdk):
        report(
            False,
            "cmd location providers (API ≥ 30)",
            f"API {sdk} — mock physique indisponible, smoke Maps réel seulement",
        )
        start = adb(serial, "shell", "am", "start", "-n", MAPS_ACTIVITY)
        report(start.returncode == 0, "Maps lancé", (start.stderr or start.stdout or "")[-120:])
        time.sleep(3)
        print(f"# last fix: {dumpsys_last_fix(serial)}", flush=True)
        return 3

    for cmd in setup_test_provider_cmds():
        adb(serial, "shell", *cmd)

    start = adb(serial, "shell", "am", "start", "-n", MAPS_ACTIVITY)
    report(start.returncode == 0, "Maps activity", MAPS_ACTIVITY)
    time.sleep(3)

    print("# injection cmd location — regarde tuiles / pastille / Fuel", flush=True)
    ok_points = 0
    for i, (lat, lon) in enumerate(PATH):
        geo = adb(serial, "shell", *set_test_provider_location_args(lat, lon))
        if geo.returncode != 0:
            report(False, f"point {i + 1} injecté", (geo.stderr or geo.stdout).strip()[:180])
        else:
            ok_points += 1
            print(f"  point {i + 1}/{len(PATH)} {lat},{lon}", flush=True)
        time.sleep(2.2)

    report(ok_points == len(PATH), f"{len(PATH)} points", f"{ok_points} injectés")
    print(f"# dumpsys: {dumpsys_last_fix(serial)}", flush=True)
    print(
        "Vérifie à l’œil : tuiles visibles, pastille qui suit Rennes→St-Jacques, pas de trajet zombie, sheet jauge Fuel à l’arrêt.",
        flush=True,
    )
    return 0 if ok_points == len(PATH) else 1


if __name__ == "__main__":
    sys.exit(main())
