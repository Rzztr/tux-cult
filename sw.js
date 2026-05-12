const VERSION = "v1.0.0-kanban";
const CACHE_NAME = `kanban-cache-${VERSION}`;
const STATIC_ASSETS = [
    "/",
    "/index.html",
    "/style.css",
    "/script.js",
    "/favicon.ico",
    "/manifest.json"
];

self.addEventListener("install", (event) => {
    console.log("[SW] Instalando Kanban Service Worker...");
    event.waitUntil(
        caches
            .open(CACHE_NAME)
            .then((cache) => {
                console.log("[SW] Cacheando archivos estáticos");
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    console.log("[SW] Activando y limpiando cachés antiguos...");
    event.waitUntil(
        caches.keys().then((cacheNames) =>
            Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME && name.startsWith('kanban-cache-'))
                    .map((name) => caches.delete(name))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    if (event.request.method !== "GET" || event.request.url.startsWith("chrome-extension://")) {
        return;
    }

    const url = new URL(event.request.url);

    // Para la API de Supabase (Base de datos), intentar siempre la red.
    // Si no hay red, devolvemos un JSON de error de offline amigable.
    if (url.hostname.includes("supabase.co")) {
        event.respondWith(
            fetch(event.request).catch(() => {
                return new Response(JSON.stringify({ error: "Modo Offline" }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            })
        );
        return;
    }

    // Para archivos estáticos (HTML, CSS, JS), usamos estrategia Stale-While-Revalidate
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                // Actualizar caché en segundo plano
                fetch(event.request).then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResponse.clone());
                        });
                    }
                }).catch(() => { });
                return cachedResponse;
            }

            // Si no está en caché, ir a la red
            return fetch(event.request).then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200) {
                    const responseToCache = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseToCache);
                    });
                }
                return networkResponse;
            }).catch(() => {
                console.log("[SW] No hay conexión y el recurso no está cacheado:", event.request.url);
            });
        })
    );
});
