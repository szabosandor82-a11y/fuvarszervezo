const CACHE_NAME = 'fuvarszervezo-v43-20260804';
const APP_ASSETS = [
  './', './index.html', './styles.css?v=43', './app.js?v=43', './data.js?v=43',
  './planner-v32.js?v=43', './planner-v33.js?v=43', './planner-v34.js?v=43',
  './planner-v35.js?v=43', './planner-v37.js?v=43', './planner-v41.js?v=43', './planner-v43.js?v=43',
  './ole-msg-reader.js?v=43', './manifest.webmanifest', './icon-192.png', './icon-512.png'
];
self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE_NAME).then(cache => cache.addAll(APP_ASSETS)).then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const local = url.origin === self.location.origin;
  const appAsset = local && (url.pathname.endsWith('/') || /\/(?:index\.html|styles\.css|app\.js|data\.js|planner-v(?:32|33|34|35|37|41|43)\.js|ole-msg-reader\.js|manifest\.webmanifest|icon-(?:192|512)\.png)$/.test(url.pathname));
  if (appAsset) {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
  } else {
    event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
  }
});
