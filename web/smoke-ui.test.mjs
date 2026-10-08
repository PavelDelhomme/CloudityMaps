import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'apk/app/src/main/assets/index.html'), 'utf8');
const activity = readFileSync(
  join(root, 'apk/app/src/main/java/ovh/delhomme/maps/MainActivity.kt'),
  'utf8',
);
const speed = readFileSync(
  join(root, 'apk/app/src/main/java/ovh/delhomme/maps/SpeedLimitBridge.kt'),
  'utf8',
);
const gradle = readFileSync(join(root, 'apk/app/build.gradle'), 'utf8');
const version = readFileSync(join(root, 'VERSION'), 'utf8').trim();

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(version === '0.1.82', `VERSION must be 0.1.82, got ${version}`);
assert(/versionName '0.1.82'/.test(gradle), 'build.gradle versionName 0.1.82');
assert(/versionCode 83/.test(gradle), 'build.gradle versionCode 83');

for (const id of ['tabs', 'btnMenu', 'btnUser', 'searchForm', 'navBar', 'q', 'chrome']) {
  assert(html.includes(`id="${id}"`), `index.html missing #${id}`);
}
assert(html.includes('id="musicPeek"') || html.includes('class="music-peek"'), 'music dock missing');
assert(html.includes('id="fuel') || html.includes('class="fuel"'), 'fuel dock missing');

assert(!activity.includes('activity_chrome'), 'MainActivity must not use native chrome layout');
assert(!activity.includes('injectNativeChromeJs'), 'MainActivity must not hide HTML chrome');
assert(!activity.includes('HuberaAppLauncher'), 'MainActivity must not depend on chrome launcher');
assert(activity.includes('adoptHuberaId()'), 'cold-start adoptHuberaId kept');
assert(activity.includes('askLocationIfNeeded'), 'GPS after first paint kept');
assert(activity.includes('CalendarBridge'), 'Calendar bridge kept');
assert(activity.includes('hubera-maps'), 'hubera-maps:// kept');
assert(speed.includes('overpass skip non-json') || speed.includes('looksLikeJson'), 'Overpass skip kept');

const jsCheck = spawnSync('node', ['--check', join(root, 'apk/app/src/main/assets/app.js')], {
  encoding: 'utf8',
});
assert(jsCheck.status === 0, `app.js syntax: ${jsCheck.stderr || jsCheck.stdout}`);

const webJs = spawnSync('node', ['--check', join(root, 'web/app.js')], { encoding: 'utf8' });
assert(webJs.status === 0, `web/app.js syntax: ${webJs.stderr || webJs.stdout}`);

console.log('OK maps 0.1.82 smoke-ui: HTML chrome + cold start + JS syntax');
