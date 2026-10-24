/* Parchi Cloud - service worker KILL SWITCH (deployed 2026-10-24).
   Phones stuck on the old cache-first worker (v1/v2) fetch this version
   on the browser's next update check. It then:
     1. deletes every cache (parchi-cloud-v1, parchi-cloud-v2, ...),
     2. unregisters itself,
   so the phone is left with NO service worker and NO cached files -
   every load after that is served fresh from the network.
   NOTE: it deliberately does NOT reload the page itself, to avoid a
   register -> activate -> reload loop (index.html still registers sw.js,
   so the kill switch re-installs harmlessly on each load and immediately
   unregisters again). After the user confirms the fresh login screen,
   remove the registration line from index.html and delete this file. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (e) { /* storage may already be gone */ }
      try {
        await self.registration.unregister();
      } catch (e) { /* already unregistered */ }
    })()
  );
});
