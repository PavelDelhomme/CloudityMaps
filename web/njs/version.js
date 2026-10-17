function readText(path) {
  var fs = require('fs');
  var raw = fs.readFileSync(path);
  return typeof raw === 'string' ? raw : raw.toString();
}

function cmpVer(a, b) {
  var pa = String(a || '0').split('.');
  var pb = String(b || '0').split('.');
  var n = Math.max(pa.length, pb.length);
  var i;
  for (i = 0; i < n; i += 1) {
    var x = parseInt(pa[i], 10) || 0;
    var y = parseInt(pb[i], 10) || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function offerApk(version, versionCode, clientVer, clientVc) {
  var latestVc = Number(versionCode) || 0;
  var latest = String(version || '');
  var ver = String(clientVer || '').replace(/^[pbd]\+/, '').trim();
  var vc = Number(clientVc) || 0;
  if (!ver && !(vc > 0)) return true;
  if (vc > 0 && latestVc > 0 && vc >= latestVc) return false;
  if (ver && cmpVer(latest, ver) <= 0) return false;
  return true;
}

function version(r) {
  var feed;
  try {
    feed = JSON.parse(readText('/usr/share/nginx/html/updates.json'));
  } catch (e) {
    r.return(500, '{"error":"feed"}');
    return;
  }
  var q = r.args || {};
  var clientVer = q.clientVersion || (r.variables && r.variables.arg_clientVersion) || '';
  var clientVc = parseInt(q.clientVersionCode || (r.variables && r.variables.arg_clientVersionCode) || '', 10) || 0;
  var available = offerApk(feed.version, feed.versionCode, clientVer, clientVc);
  feed.apkAvailable = available;
  feed.forceUpdate = false;
  feed.mandatory = false;
  if (feed.canonical) {
    feed.canonical.apkAvailable = offerApk(feed.canonical.version, feed.canonical.versionCode, clientVer, clientVc);
    feed.canonical.forceUpdate = false;
    feed.canonical.mandatory = false;
  }
  if (feed.legacy) {
    feed.legacy.apkAvailable = offerApk(feed.legacy.version, feed.legacy.versionCode, clientVer, clientVc);
    feed.legacy.forceUpdate = false;
    feed.legacy.mandatory = false;
  }
  r.headersOut['Content-Type'] = 'application/json; charset=utf-8';
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Access-Control-Allow-Origin'] = '*';
  r.return(200, JSON.stringify(feed));
}

export default { version, offerApk };
