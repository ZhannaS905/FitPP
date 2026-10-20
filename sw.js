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
    const fresh = new URL(request.url);
    fresh.searchParams.set('__fitpp_build', 'compat-reader-20261020-1');
    event.respondWith(fetch(fresh.href, { cache: 'no-store', credentials: 'same-origin' }));
  }
});

// Read-only build handshake for update verification.
self.addEventListener('message', event => {
  if (event.data === 'FITPP_BUILD' && event.ports[0]) event.ports[0].postMessage('compat-reader-20261020-1');
});
