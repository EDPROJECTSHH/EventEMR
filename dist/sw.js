/* Mini EC Event EMR service worker.

   The venue wifi will drop. The app shell and the clinical reference are
   cached on first load so a post that opened the app once keeps working all
   day with no signal. /api/* is never cached — sync and Drive must always hit
   the network and fail honestly when they cannot. */
var CACHE = 'mini-ec-emr-v1';
var SHELL = ['./', './index.html', './app.js', './manifest.webmanifest', './data/ref-topics.json'];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* addAll is all-or-nothing; cache what we can so one 404 does not leave
         the post with no offline copy at all. */
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/.netlify/') === 0) return;

  /* Network first so a redeploy reaches the field without a hard refresh;
     cache is the fallback, which is the case that actually matters. */
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (hit) {
        return hit || caches.match('./index.html');
      });
    })
  );
});
