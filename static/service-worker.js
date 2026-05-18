/**
 * DiariCore PWA service worker — offline app shell + cached static assets.
 * API routes are never cached (session/auth stay fresh).
 */
const CACHE_NAME = 'diaricore-pwa-v41';
const PWA_CACHE_PREFIX = 'diaricore-pwa-';

function shouldDeleteCacheOnActivate(name) {
    if (name === CACHE_NAME) return false;
    if (name.startsWith(PWA_CACHE_PREFIX)) return true;
    return false;
}

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
    '/write-entry.js',
    '/mood-analysis-ui.js',
    '/image-upload-utils.js',
    '/chart-flow.css',
    '/pwa.css',
    '/theme.js',
    '/pwa.js',
    '/pwa-auth-bootstrap.js',
    '/diari-offline.js',
    '/diari-security.js',
    '/diari-shell.js',
    '/entries.js',
    '/entry-view.js',
    '/lottie-web.min.js',
    '/mood-scoring.js',
    '/side-bar.js',
];

const PRECACHE_URL_SET = new Set(PRECACHE_URLS);

function isApiRequest(url) {
    return url.pathname.startsWith('/api/');
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
            Promise.all(keys.filter(shouldDeleteCacheOnActivate).map((k) => caches.delete(k)))
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

    const path = url.pathname;
    const networkFirstJs = path.endsWith('.js');

    event.respondWith(
        (async () => {
            let cached = await caches.match(request);
            if (!cached && PRECACHE_URL_SET.has(path)) {
                cached = await caches.match(path);
            }
            if (!cached) {
                const base = path.split('/').pop();
                if (base) cached = await caches.match('/' + base);
            }

            if (networkFirstJs) {
                try {
                    const res = await fetch(request);
                    if (res.ok) {
                        const copy = res.clone();
                        caches.open(CACHE_NAME).then((c) => c.put(request, copy));
                    }
                    return res;
                } catch {
                    if (cached) return cached;
                    return (await caches.match('/write-entry.html')) || Response.error();
                }
            }

            if (cached) return cached;

            try {
                const res = await fetch(request);
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE_NAME).then((c) => c.put(request, copy));
                }
                return res;
            } catch {
                return cached || (await caches.match('/write-entry.html')) || Response.error();
            }
        })()
    );
});
