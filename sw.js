const CACHE_NAME = 'fuvarszervezo-v47-online-20260806-5';
const APP_ASSETS = [
  './', './index.html', './styles.css?v=47.5', './app.js?v=47.5', './data.js?v=47.5',
  './planner-v32.js?v=47.5', './planner-v33.js?v=47.5', './planner-v34.js?v=47.5',
  './planner-v35.js?v=47.5', './planner-v37.js?v=47.5', './planner-v41.js?v=47.5',
  './planner-v43.js?v=47.5', './planner-v44.js?v=47.5', './auth-v44-2.js?v=47.5',
  './online-config.js?v=47.5', './online-v44-2.js?v=47.5',
  './ole-msg-reader.js?v=47.5', './manifest.webmanifest', './icon-192.png', './icon-512.png'
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
  const appAsset = local && (url.pathname.endsWith('/') || /\/(?:index\.html|styles\.css|app\.js|data\.js|auth-v44-2\.js|online-config\.js|online-v44-2\.js|planner-v(?:32|33|34|35|37|41|43|44)\.js|ole-msg-reader\.js|manifest\.webmanifest|icon-(?:192|512)\.png)$/.test(url.pathname));
  if (appAsset) {
    event.respondWith(fetch(event.request).then(response => {
      const copy = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)); return response;
    }).catch(() => caches.match(event.request).then(response => response || caches.match('./index.html'))));
  } else event.respondWith(caches.match(event.request).then(response => response || fetch(event.request)));
});
