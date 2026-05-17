/**
 * DiariCore PWA service worker — offline app shell + cached static assets.
 * API routes are never cached (session/auth stay fresh).
 */
const CACHE_NAME = 'diaricore-pwa-v8';

const PRECACHE_URLS = [
    '/login.html',
    '/dashboard.html',
    '/entries.html',
    '/write-entry.html',
    '/insights.html',
    '/profile.html',
    '/suggestions.html',
    '/voice-entry.html',
    '/entry-view.html',
    '/diariclogo.png',
    '/theme.css',
    '/mobile-global.css',
    '/diari-shell-pending.css',
    '/side-bar.css',
    '/dashboard.css',
    '/entries.css',
    '/insights.css',
    '/write-entry.css',
    '/chart-flow.css',
    '/pwa.css',
    '/theme.js',
    '/pwa.js',
    '/diari-emotion-pipeline.js',
    '/diari-emotion-onnx.js',
    '/diari-emotion-onnx-worker.js',
    '/diari-offline.js',
    '/diari-pwa-offline-model-status.js',
    '/diari-security.js',
    '/diari-shell.js',
    '/mood-scoring.js',
    '/side-bar.js',
];

function isApiRequest(url) {
    return url.pathname.startsWith('/api/') || url.pathname.startsWith('/offline-ml/');
    /* offline-ml: resolve JSON + optional redirect; never served from precache */
}

function isStaticAsset(url) {
    const p = url.pathname;
    if (
        p.endsWith('.css') ||
        p.endsWith('.js') ||
        p.endsWith('.png') ||
        p.endsWith('.jpg') ||
        p.endsWith('.webp') ||
        p.endsWith('.svg') ||
        p.endsWith('.ico') ||
        p.endsWith('.woff2') ||
        p.endsWith('.json')
    ) {
        return true;
    }
    return p.endsWith('.html');
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => undefined)
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return;
    if (isApiRequest(url)) return;

    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
                    }
                    return res;
                })
                .catch(async () => {
                    const cached = await caches.match(request);
                    if (cached) return cached;
                    const fallback =
                        (await caches.match('/dashboard.html')) ||
                        (await caches.match('/login.html'));
                    return fallback || Response.error();
                })
        );
        return;
    }

    if (!isStaticAsset(url)) return;

    event.respondWith(
        caches.match(request).then((cached) => {
            const network = fetch(request)
                .then((res) => {
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
                    }
                    return res;
                })
                .catch(() => cached);

            return cached || network;
        })
    );
});
