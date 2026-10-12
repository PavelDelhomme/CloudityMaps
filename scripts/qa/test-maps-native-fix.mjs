import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapsShouldDropFix, mapsShouldFlyToFix } from './maps-native-fix.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('maps native / mock GPS', () => {
  it('recentre sur un saut mock Rennes → St-Jacques', () => {
    assert.equal(mapsShouldFlyToFix(2400, true, false), true);
    assert.equal(mapsShouldFlyToFix(10, true, false), false);
    assert.equal(mapsShouldFlyToFix(5, false, true), true);
    assert.equal(mapsShouldFlyToFix(40, false, false), false);
  });

  it('ne jette pas un fix mock même si accuracy bizarre', () => {
    assert.equal(mapsShouldDropFix(3, true), false);
    assert.equal(mapsShouldDropFix(120, false), true);
    assert.equal(mapsShouldDropFix(20, false), false);
  });

  it('app.js et pont Kotlin exposent le contrat', () => {
    const js = readFileSync(join(ROOT, 'web/app.js'), 'utf8');
    const kt = readFileSync(
      join(ROOT, 'apk/app/src/main/java/ovh/delhomme/maps/LocationBridge.kt'),
      'utf8',
    );
    assert.match(js, /window\.__mapsNativeFix/);
    assert.match(js, /mapsShouldFlyToFix/);
    assert.match(js, /freshMs:\s*0/);
    assert.match(kt, /requestLocationUpdates/);
    assert.match(kt, /isFromMockProvider|isMock/);
    assert.match(kt, /__mapsNativeFix/);
    assert.match(kt, /allProviders/);
    assert.match(kt, /120_000L/);
    assert.match(kt, /60_000L/);
  });
});
