/* Network-only PWA worker: never cache app code, Firebase requests or user data. */
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  const scope = new URL(self.registration.scope);
  // Only in-scope page navigation. All APIs and other requests use normal networking.
  if (request.method === 'GET' && request.mode === 'navigate' &&
      url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    event.respondWith(fetch(request));
  }
});
