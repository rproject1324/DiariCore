/**
 * DiariCore PWA service worker — offline app shell + cached static assets.
 * API routes are never cached (session/auth stay fresh).
 */
const CACHE_NAME = 'diaricore-pwa-v83';
const PWA_CACHE_PREFIX = 'diaricore-pwa-';

function shouldDeleteCacheOnActivate(name) {
    if (name === CACHE_NAME) return false;
    if (name.startsWith(PWA_CACHE_PREFIX)) return true;
    return false;
}

const PRECACHE_URLS = [
    '/pwa-splash.html',
    '/pwa-splash-boot.js',
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
    '/diari-pwa-launch.css',
    '/diari-pwa-launch.js',
    '/lottie-web.min.js',
    '/noto-emoji/basic_loading_bar.json',
    '/noto-emoji/explosion.json',
    '/diariclogo-pwa-192.png',
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
    '/pwa-theme-early.js',
    '/pwa-auth-bootstrap.js',
    '/diari-offline.js',
    '/diari-security.js',
    '/diari-shell.js',
    '/entries.js',
    '/entry-view.js',
    '/lottie-web.min.js',
    '/mood-scoring.js',
    '/side-bar.js',
    '/most-active-time.js',
    '/diari-streak.js',
    '/pwa-notification-idb.js',
    '/pwa-notification-templates.js',
    '/pwa-notification-scheduler-sw.js',
    '/pwa-web-push.js',
    '/push-templates.json',
];

/**
 * Web Push display — registered here (not only in importScripts) so pushes still show
 * when scheduler scripts fail to load or an older cached bundle is active.
 */
self.addEventListener('push', (event) => {
    let payload = { title: 'DiariCore', body: '', url: '/write-entry.html', tag: 'diari-web-push' };
    try {
        if (event.data) {
            const parsed = event.data.json();
            if (parsed && typeof parsed === 'object') payload = { ...payload, ...parsed };
        }
    } catch (e) {
        console.warn('[PWA SW] push payload parse failed:', e);
    }
    const notifTag = payload.tag || 'diari-web-push';
    const title = payload.title || 'DiariCore';
    const body = payload.body || '';
    const url = payload.url || '/write-entry.html';

    event.waitUntil(
        (async () => {
            try {
                const notifOpts = {
                    body,
                    tag: notifTag,
                    renotify: notifTag !== 'diari-daily-reminder',
                    requireInteraction: false,
                    silent: false,
                    icon: '/diariclogo.png',
                    badge: '/diariclogo.png',
                    vibrate: [300, 100, 300, 100, 300],
                    data: { url, tag: notifTag },
                };
                try {
                    notifOpts.priority = 'high';
                } catch (_) {
                    /* ignore */
                }
                await self.registration.showNotification(title, notifOpts);
            } catch (e) {
                console.warn('[PWA SW] showNotification failed:', e);
            }
            fetch('/api/push/delivery-ack', {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tag: notifTag,
                    title,
                    receivedAt: new Date().toISOString(),
                }),
            }).catch(function (e) {
                console.warn('[PWA SW] delivery-ack failed:', e);
            });
        })()
    );
});

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
}

async function resubscribePushInServiceWorker() {
    const reg = self.registration;
    if (!reg || !reg.pushManager) return;
    const vapidRes = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
    const vapidData = await vapidRes.json().catch(() => ({}));
    if (!vapidRes.ok || !vapidData.publicKey) return;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
        });
    }
    if (!sub) return;
    await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            subscription: sub.toJSON(),
            keepThisDeviceOnly: true,
        }),
    });
}

self.addEventListener('pushsubscriptionchange', (event) => {
    event.waitUntil(
        (async () => {
            const clients = await self.clients.matchAll({
                type: 'window',
                includeUncontrolled: true,
            });
            if (clients.length) {
                for (const client of clients) {
                    client.postMessage({ type: 'DIARI_PUSH_SUBSCRIPTION_CHANGE' });
                }
                return;
            }
            try {
                await resubscribePushInServiceWorker();
            } catch (e) {
                console.warn('[PWA SW] pushsubscriptionchange resubscribe failed:', e);
            }
        })()
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = event.notification?.data?.url || '/dashboard.html';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
            for (const c of list) {
                if ('focus' in c) {
                    if ('navigate' in c) {
                        return c.navigate(url).then(() => c.focus());
                    }
                    return c.focus();
                }
            }
            if (self.clients.openWindow) return self.clients.openWindow(url);
        })
    );
});

try {
    importScripts(
        '/diari-streak.js',
        '/pwa-notification-idb.js',
        '/pwa-notification-templates.js',
        '/pwa-notification-scheduler-sw.js'
    );
} catch (e) {
    console.warn('[PWA] Notification scheduler scripts failed to load:', e);
}

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
