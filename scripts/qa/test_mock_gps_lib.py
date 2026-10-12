#!/usr/bin/env python3
import unittest

from mock_gps_lib import (
    RENNES_ST_JACQUES,
    location_cmd_supported,
    set_test_provider_location_args,
    setup_test_provider_cmds,
)


class MockGpsLibTest(unittest.TestCase):
    def test_path_rennes(self):
        self.assertGreaterEqual(len(RENNES_ST_JACQUES), 4)
        lat0, lon0 = RENNES_ST_JACQUES[0]
        self.assertAlmostEqual(lat0, 48.1173, places=3)
        self.assertLess(lon0, 0)

    def test_sdk_gate(self):
        self.assertFalse(location_cmd_supported(28))  # Blackview 9
        self.assertFalse(location_cmd_supported(29))
        self.assertTrue(location_cmd_supported(30))
        self.assertTrue(location_cmd_supported(36))  # Samsung 16

    def test_inject_args(self):
        args = set_test_provider_location_args(48.11, -1.68)
        self.assertEqual(args[:5], ["cmd", "location", "providers", "set-test-provider-location", "gps"])
        self.assertIn("--location", args)
        self.assertEqual(args[args.index("--location") + 1], "48.11,-1.68")
        self.assertNotIn("emu", args)

    def test_setup_allows_maps_and_fuel(self):
        joined = " ".join(" ".join(c) for c in setup_test_provider_cmds())
        self.assertIn("cloud.hubera.maps", joined)
        self.assertIn("cloud.hubera.fuel", joined)
        self.assertIn("add-test-provider gps", joined)


if __name__ == "__main__":
    unittest.main()
