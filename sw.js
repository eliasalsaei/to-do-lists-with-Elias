// Offline support: cache the app shell and the Firebase library, serve them when there is no network.
const CACHE = 'todo-elias-v1';
const ASSETS = ['./', 'index.html', 'styles.css', 'app.js', 'sync.js', 'firebase-config.js', 'manifest.json', 'icon.svg'];
const FIREBASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const LIBS = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => FIREBASE + f);
const NETWORK_TIMEOUT = 3500; // on a weak connection, fall back to the cached copy after this long

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE)
    .then((c) => c.addAll(ASSETS).then(() => Promise.allSettled(LIBS.map((u) => c.add(u)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Versioned libraries and fonts never change: cache first.
function cacheFirst(req) {
  return caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
    return res;
  }));
}

// The app's own files: network first so updates show up right away; cache when offline or slow.
function networkFirst(req) {
  const fallback = () => caches.match(req).then((r) => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined));
  return new Promise((resolve) => {
    let done = false;
    const finish = (res) => { if (!done && res) { done = true; resolve(res); } };
    const timer = setTimeout(() => fallback().then(finish), NETWORK_TIMEOUT);
    fetch(req)
      .then((res) => {
        clearTimeout(timer);
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        finish(res);
      })
      .catch(() => { clearTimeout(timer); fallback().then((r) => finish(r || Response.error())); });
  });
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin === location.origin) return e.respondWith(networkFirst(e.request));
  if (url.href.startsWith(FIREBASE) || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return e.respondWith(cacheFirst(e.request));
  }
  // Everything else (Firestore, sign-in) goes straight to the network.
});
