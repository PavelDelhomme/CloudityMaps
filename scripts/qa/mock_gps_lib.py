"""Commandes mock GPS physiques (pas `adb emu geo`, réservé émulateur)."""
from __future__ import annotations

# Rennes centre → Saint-Jacques, ~2 s / point
RENNES_ST_JACQUES = [
    (48.1173, -1.6778),
    (48.1140, -1.6805),
    (48.1102, -1.6840),
    (48.1065, -1.6888),
    (48.1030, -1.6935),
]

MAPS_ACTIVITY = "cloud.hubera.maps/ovh.delhomme.maps.MainActivity"
MAPS_PKG = "cloud.hubera.maps"
FUEL_PKG = "cloud.hubera.fuel"


def location_cmd_supported(sdk: int) -> bool:
    """`cmd location providers` existe à partir d'Android 11 (API 30)."""
    return int(sdk) >= 30


def set_test_provider_location_args(lat: float, lon: float, accuracy: float = 3.0) -> list[str]:
    return [
        "cmd",
        "location",
        "providers",
        "set-test-provider-location",
        "gps",
        "--location",
        f"{lat},{lon}",
        "--accuracy",
        str(accuracy),
    ]


def setup_test_provider_cmds() -> list[list[str]]:
    return [
        ["cmd", "location", "set-location-enabled", "true"],
        ["appops", "set", "com.android.shell", "android:mock_location", "allow"],
        ["appops", "set", MAPS_PKG, "android:mock_location", "allow"],
        ["appops", "set", FUEL_PKG, "android:mock_location", "allow"],
        ["cmd", "location", "providers", "add-test-provider", "gps"],
        ["cmd", "location", "providers", "set-test-provider-enabled", "gps", "true"],
    ]
