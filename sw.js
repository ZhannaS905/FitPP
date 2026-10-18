self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => { await caches.delete('fitpp-cache-v1'); await self.registration.unregister(); await self.clients.claim(); })()));
