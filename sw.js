const CACHE_NAME = "fitpp-cache-v5";
const ASSETS = [
  "/",
  "./index.html",
  "./styles.css",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

// Установка Service Worker и кэширование файлов
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
});

// Перехват запросов и работа в офлайне
self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches
      .match(event.request)
      .then((response) => response || fetch(event.request)),
  );
});

// Remove earlier app shells so caches.match cannot return an outdated interface.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith("fitpp-cache-") && name !== CACHE_NAME,
            )
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});
