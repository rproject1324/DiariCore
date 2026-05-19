/**
 * DiariCore PWA: manifest/meta tags, service worker, install prompt (mobile + desktop).
 */
(function () {
    'use strict';

    /* PWA: white screen immediately so the install icon splash is not visible before loading bar. */
    (function paintPwaLaunchWhiteFirst() {
        try {
            var standalone =
                (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
                window.navigator.standalone === true;
            if (!standalone) return;
            var html = document.documentElement;
            html.classList.add('diari-pwa-launch-pending');
            html.style.backgroundColor = '#ffffff';
            if (document.body) {
                document.body.style.backgroundColor = '#ffffff';
            }
        } catch (_) {
            /* ignore */
        }
    })();

    const MANIFEST_HREF = '/manifest.webmanifest';
    const SW_URL = '/service-worker.js';
    const ICON_HREF = '/diariclogo.png';
    const THEME_COLOR = '#6F8F7F';

    function injectPwaLaunchAssets() {
        if (!isStandalone()) return;
        const head = document.head;
        if (!head || head.querySelector('[data-diari-pwa-launch-css]')) return;
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = '/diari-pwa-launch.css';
        link.dataset.diariPwaLaunchCss = '1';
        head.appendChild(link);
        const script = document.createElement('script');
        script.src = '/diari-pwa-launch.js';
        script.dataset.diariPwaLaunchJs = '1';
        head.appendChild(script);
    }

    function injectPwaHead() {
        const head = document.head;
        if (!head || head.querySelector('link[rel="manifest"]')) return;

        const manifest = document.createElement('link');
        manifest.rel = 'manifest';
        manifest.href = MANIFEST_HREF;
        head.appendChild(manifest);

        let theme = document.querySelector('meta[name="theme-color"]');
        if (!theme) {
            theme = document.createElement('meta');
            theme.name = 'theme-color';
            head.appendChild(theme);
        }
        try {
            const primary = getComputedStyle(document.documentElement)
                .getPropertyValue('--primary-color')
                .trim();
            theme.content = primary || THEME_COLOR;
        } catch (_) {
            theme.content = THEME_COLOR;
        }

        const appleCapable = document.createElement('meta');
        appleCapable.name = 'apple-mobile-web-app-capable';
        appleCapable.content = 'yes';
        head.appendChild(appleCapable);

        const appleStatus = document.createElement('meta');
        appleStatus.name = 'apple-mobile-web-app-status-bar-style';
        appleStatus.content = 'black-translucent';
        head.appendChild(appleStatus);

        const appleTitle = document.createElement('meta');
        appleTitle.name = 'apple-mobile-web-app-title';
        appleTitle.content = 'DiariCore';
        head.appendChild(appleTitle);

        const touch = document.createElement('link');
        touch.rel = 'apple-touch-icon';
        touch.href = ICON_HREF;
        head.appendChild(touch);

        const icon32 = document.createElement('link');
        icon32.rel = 'icon';
        icon32.type = 'image/png';
        icon32.sizes = '32x32';
        icon32.href = ICON_HREF;
        head.appendChild(icon32);

        const icon192 = document.createElement('link');
        icon192.rel = 'icon';
        icon192.type = 'image/png';
        icon192.sizes = '192x192';
        icon192.href = ICON_HREF;
        head.appendChild(icon192);

        const vp = document.querySelector('meta[name="viewport"]');
        if (vp && !/viewport-fit=cover/.test(vp.content)) {
            vp.content = vp.content.replace(/\s*$/, '') + ', viewport-fit=cover';
        }
    }

    function isStandalone() {
        try {
            if (window.DiariOffline?.isPwaUiContext?.()) return true;
        } catch (_) {
            /* ignore */
        }
        const el = document.documentElement;
        if (el?.classList.contains('diari-pwa-standalone')) return true;
        if (el?.getAttribute('data-diari-pwa') === 'standalone') return true;
        const modes = ['standalone', 'fullscreen', 'minimal-ui'];
        for (let i = 0; i < modes.length; i += 1) {
            try {
                if (window.matchMedia('(display-mode: ' + modes[i] + ')').matches) return true;
            } catch (_) {
                /* ignore */
            }
        }
        if (window.navigator.standalone === true) return true;
        try {
            if (document.referrer && document.referrer.indexOf('android-app://') === 0) return true;
        } catch (_) {
            /* ignore */
        }
        return false;
    }

    let deferredInstallPrompt = null;

    function hideInstallBanner() {
        const el = document.getElementById('diariPwaInstallBanner');
        if (el) el.hidden = true;
    }

    function createInstallBanner() {
        const existing = document.getElementById('diariPwaInstallBanner');
        if (existing) return existing;
        if (isStandalone()) return null;

        const root = document.createElement('div');
        root.id = 'diariPwaInstallBanner';
        root.className = 'pwa-install-banner';
        root.hidden = true;
        root.setAttribute('role', 'dialog');
        root.setAttribute('aria-label', 'Install DiariCore app');

        const inner = document.createElement('div');
        inner.className = 'pwa-install-banner__inner';

        const icon = document.createElement('img');
        icon.className = 'pwa-install-banner__icon';
        icon.src = ICON_HREF;
        icon.width = 44;
        icon.height = 44;
        icon.alt = '';
        icon.decoding = 'async';

        const textBlock = document.createElement('div');
        textBlock.className = 'pwa-install-banner__text';

        const title = document.createElement('strong');
        title.className = 'pwa-install-banner__title';
        title.textContent = 'Install DiariCore';

        const sub = document.createElement('span');
        sub.className = 'pwa-install-banner__sub';
        sub.id = 'diariPwaInstallSub';
        sub.textContent = 'Add to your home screen for quick access.';

        textBlock.appendChild(title);
        textBlock.appendChild(sub);

        const actions = document.createElement('div');
        actions.className = 'pwa-install-banner__actions';

        const installBtn = document.createElement('button');
        installBtn.type = 'button';
        installBtn.className = 'pwa-install-banner__btn pwa-install-banner__btn--primary';
        installBtn.id = 'diariPwaInstallBtn';
        installBtn.textContent = 'Install';

        const dismissBtn = document.createElement('button');
        dismissBtn.type = 'button';
        dismissBtn.className = 'pwa-install-banner__btn pwa-install-banner__btn--ghost';
        dismissBtn.id = 'diariPwaInstallDismiss';
        dismissBtn.setAttribute('aria-label', 'Dismiss');
        dismissBtn.textContent = 'Not now';

        actions.appendChild(installBtn);
        actions.appendChild(dismissBtn);
        inner.appendChild(icon);
        inner.appendChild(textBlock);
        inner.appendChild(actions);
        root.appendChild(inner);
        document.body.appendChild(root);

        installBtn.addEventListener('click', async () => {
            if (!deferredInstallPrompt) {
                showIosInstallHint();
                return;
            }
            deferredInstallPrompt.prompt();
            try {
                await deferredInstallPrompt.userChoice;
            } catch (_) {
                /* ignore */
            }
            deferredInstallPrompt = null;
            hideInstallBanner();
        });

        dismissBtn.addEventListener('click', () => {
            try {
                localStorage.setItem('diariPwaInstallDismissed', String(Date.now()));
            } catch (_) {
                /* ignore */
            }
            hideInstallBanner();
        });

        return root;
    }

    function showInstallBanner() {
        if (isStandalone()) return;
        try {
            const dismissed = Number(localStorage.getItem('diariPwaInstallDismissed') || 0);
            if (dismissed && Date.now() - dismissed < 7 * 24 * 60 * 60 * 1000) return;
        } catch (_) {
            /* ignore */
        }
        const banner = createInstallBanner();
        if (banner) banner.hidden = false;
    }

    function isIosSafari() {
        const ua = window.navigator.userAgent || '';
        const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const webkit = /WebKit/i.test(ua);
        return iOS && webkit && !/CriOS|FxiOS|EdgiOS/i.test(ua);
    }

    function showIosInstallHint() {
        if (!isIosSafari()) return;
        const banner = createInstallBanner();
        if (!banner) return;
        const sub = document.getElementById('diariPwaInstallSub');
        if (sub) sub.textContent = 'Tap Share, then “Add to Home Screen”.';
        const btn = document.getElementById('diariPwaInstallBtn');
        if (btn) btn.textContent = 'Got it';
        banner.hidden = false;
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        window.addEventListener('load', () => {
            navigator.serviceWorker
                .register(SW_URL, { scope: '/' })
                .then(function () {
                    if (isStandalone()) {
                        void bootPwaPushRegistration();
                    }
                })
                .catch((err) => console.warn('[PWA] Service worker registration failed:', err));
        });
    }

    function bindInstallPrompt() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredInstallPrompt = e;
            showInstallBanner();
        });

        window.addEventListener('appinstalled', () => {
            deferredInstallPrompt = null;
            hideInstallBanner();
        });

        if (isIosSafari() && !isStandalone()) {
            window.setTimeout(showIosInstallHint, 2400);
        }
    }

    function loadScriptOnce(src) {
        const existing = document.querySelector('script[data-diari-src="' + src + '"]');
        if (existing) {
            if (
                existing.dataset.diariLoaded === '1' ||
                existing.readyState === 'complete' ||
                existing.readyState === 'loaded'
            ) {
                existing.dataset.diariLoaded = '1';
                return Promise.resolve();
            }
            return new Promise(function (resolve, reject) {
                existing.addEventListener('load', function onLoad() {
                    existing.dataset.diariLoaded = '1';
                    existing.removeEventListener('load', onLoad);
                    resolve();
                });
                existing.addEventListener('error', function onErr() {
                    existing.removeEventListener('error', onErr);
                    reject(new Error('Failed to load ' + src));
                });
            });
        }
        return new Promise(function (resolve, reject) {
            const s = document.createElement('script');
            s.src = src;
            s.dataset.diariSrc = src;
            s.onload = function () {
                s.dataset.diariLoaded = '1';
                resolve();
            };
            s.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            document.head.appendChild(s);
        });
    }

    const PWA_NOTIFY_SCRIPTS = [
        'most-active-time.js',
        'pwa-notification-idb.js',
        'pwa-notification-templates.js',
        'pwa-web-push.js',
        'pwa-notifications.js',
    ];

    async function bootPwaPushRegistration() {
        if (!isStandalone()) return;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return;
        }
        try {
            const push = await window.DiariPwaWebPush.waitForReady(12000);
            if (push.maintainPushRegistration) {
                await push.maintainPushRegistration({ force: true });
            } else if (push.registerPushForReminders) {
                await push.registerPushForReminders({ quiet: true });
            }
            if (push.syncNotificationPrefsToServer) {
                await push.syncNotificationPrefsToServer();
            }
        } catch (e) {
            console.warn('[PWA] push registration boot failed:', e);
        }
    }

    function loadPwaNotificationStack() {
        if (!isStandalone()) return;
        void (async function () {
            try {
                for (let i = 0; i < PWA_NOTIFY_SCRIPTS.length; i += 1) {
                    await loadScriptOnce(PWA_NOTIFY_SCRIPTS[i]);
                }
                await bootPwaPushRegistration();
            } catch (e) {
                console.warn('[PWA] notification stack load failed:', e);
            }
        })();
    }

    if (isStandalone()) {
        document.documentElement.classList.add('diari-pwa-standalone');
        document.documentElement.setAttribute('data-diari-pwa', 'standalone');
        loadPwaNotificationStack();
    }

    function syncThemeColorMeta() {
        try {
            const primary = getComputedStyle(document.documentElement)
                .getPropertyValue('--primary-color')
                .trim();
            if (!primary) return;
            let meta = document.querySelector('meta[name="theme-color"]');
            if (!meta) {
                meta = document.createElement('meta');
                meta.name = 'theme-color';
                document.head.appendChild(meta);
            }
            meta.content = primary;
        } catch (_) {
            /* ignore */
        }
    }

    injectPwaLaunchAssets();
    injectPwaHead();
    registerServiceWorker();
    bindInstallPrompt();

    window.addEventListener('diari-palette-changed', syncThemeColorMeta);
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', syncThemeColorMeta);
    } else {
        syncThemeColorMeta();
    }

    window.DiariPWA = {
        isStandalone,
        showInstallBanner,
        hideInstallBanner,
    };
})();
