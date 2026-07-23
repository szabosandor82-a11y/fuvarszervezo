const C='fuvarszervezo-v35-20260723';
const A=['./','./index.html','./styles.css?v=35','./app.js?v=35','./planner-v32.js?v=35','./planner-v33.js?v=35','./planner-v34.js?v=35','./planner-v35.js?v=35','./data.js?v=35','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(A)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url),local=u.origin===self.location.origin;
  const appAsset=local&&(u.pathname.endsWith('/')||u.pathname.endsWith('/index.html')||u.pathname.endsWith('/app.js')||u.pathname.endsWith('/planner-v32.js')||u.pathname.endsWith('/planner-v33.js')||u.pathname.endsWith('/planner-v34.js')||u.pathname.endsWith('/planner-v35.js')||u.pathname.endsWith('/data.js')||u.pathname.endsWith('/styles.css')||u.pathname.endsWith('/manifest.webmanifest'));
  if(appAsset){
    e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./index.html'))));
  }else e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request)));
});
