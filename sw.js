/* Parchi Cloud service worker - cache app shell */
const CACHE = 'parchi-cloud-v1';
const SHELL = ['.', 'index.html', 'manifest.json', 'css/style.css',
  'js/config.js', 'js/math.js', 'js/app.js'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
    const copy = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, copy));
    return res;
  }).catch(() => caches.match('index.html'))));
});
