/**
 * DiariCore PWA: manifest/meta tags, service worker, install prompt (mobile + desktop).
 */
(function () {
    'use strict';

    const MANIFEST_HREF = '/manifest.webmanifest';
    const SW_URL = '/service-worker.js';
    const ICON_HREF = '/diariclogo.png';
    const THEME_COLOR = '#6F8F7F';

    function injectPwaHead() {
        const head = document.head;
        if (!head || head.querySelector('link[rel="manifest"]')) return;

        const manifest = document.createElement('link');
        manifest.rel = 'manifest';
        manifest.href = MANIFEST_HREF;
        head.appendChild(manifest);

        const theme = document.createElement('meta');
        theme.name = 'theme-color';
        theme.content = THEME_COLOR;
        head.appendChild(theme);

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
        return (
            window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true
        );
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

    if (isStandalone()) {
        document.documentElement.classList.add('diari-pwa-standalone');
        document.documentElement.setAttribute('data-diari-pwa', 'standalone');
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
