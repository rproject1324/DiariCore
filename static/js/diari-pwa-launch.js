/**
 * PWA only: white launch screen with loading bar → explosion + logo + DIARICORE, then reveal app.
 */
(function (g) {
    'use strict';

    const LOADING_SRC = '/noto-emoji/basic_loading_bar.json';
    const EXPLOSION_SRC = '/noto-emoji/explosion.json';
    /** Transparent artwork only — no sage-green PWA icon box. */
    const LOGO_SRC = '/diariclogo.png';
    const SESSION_KEY = 'diariPwaLaunchDone';
    const MAX_WAIT_MS = 14000;
    const BRAND_SHOW_AT_PROGRESS = 0.38;

    let finished = true;
    let finishWaiters = [];
    let overlayEl = null;
    let animDone = false;
    let appReady = false;

    function isPwaStandalone() {
        try {
            if (g.DiariPWA && typeof g.DiariPWA.isStandalone === 'function' && g.DiariPWA.isStandalone()) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
        const el = g.document && g.document.documentElement;
        if (el && el.classList.contains('diari-pwa-standalone')) return true;
        if (el && el.getAttribute('data-diari-pwa') === 'standalone') return true;
        return (
            (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) ||
            g.navigator.standalone === true
        );
    }

    function isAuthPage() {
        const path = String(g.location.pathname || '').replace(/\\/g, '/').toLowerCase();
        const base = path.split('/').pop() || '';
        return (
            !path ||
            path === '/' ||
            base === '' ||
            base === 'index.html' ||
            base === 'login.html' ||
            base === 'register.html' ||
            base === 'verify-registration.html'
        );
    }

    function shouldRunLaunch() {
        if (!isPwaStandalone()) return false;
        if (isAuthPage()) return false;
        if (!g.document.querySelector('.diari-shell-main')) return false;
        try {
            if (g.sessionStorage.getItem(SESSION_KEY) === '1') return false;
        } catch (_) {
            /* ignore */
        }
        return true;
    }

    function isFinished() {
        return finished;
    }

    function whenFinished() {
        if (finished) return Promise.resolve();
        return new Promise(function (resolve) {
            finishWaiters.push(resolve);
        });
    }

    function resolveFinishWaiters() {
        const list = finishWaiters.slice();
        finishWaiters = [];
        list.forEach(function (fn) {
            try {
                fn();
            } catch (_) {
                /* ignore */
            }
        });
    }

    function tryRevealApp() {
        if (finished) return;
        if (!animDone || !appReady) return;
        finished = true;
        try {
            g.sessionStorage.setItem(SESSION_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        const root = g.document.documentElement;
        if (root) {
            root.classList.remove('diari-pwa-launch-active', 'diari-pwa-launch-pending');
        }
        if (overlayEl && overlayEl.parentNode) {
            overlayEl.parentNode.removeChild(overlayEl);
        }
        overlayEl = null;
        resolveFinishWaiters();
        if (g.DiariShell && typeof g.DiariShell._completeRelease === 'function') {
            g.DiariShell._completeRelease();
        }
    }

    function notifyAppReady() {
        appReady = true;
        tryRevealApp();
    }

    function paintWhiteShell() {
        const root = g.document.documentElement;
        if (root) {
            root.classList.add('diari-pwa-launch-pending', 'diari-pwa-launch-active');
            root.style.backgroundColor = '#ffffff';
        }
        if (g.document.body) {
            g.document.body.style.backgroundColor = '#ffffff';
        }
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            const existing = g.document.querySelector('script[data-diari-launch-src="' + src + '"]');
            if (existing && g.lottie && g.lottie.loadAnimation) {
                resolve();
                return;
            }
            const s = g.document.createElement('script');
            s.src = src;
            s.dataset.diariLaunchSrc = src;
            s.onload = function () {
                resolve();
            };
            s.onerror = function () {
                reject(new Error('Failed to load ' + src));
            };
            g.document.head.appendChild(s);
        });
    }

    function fetchAnimation(url) {
        return fetch(url, { credentials: 'same-origin' }).then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
            return res.json();
        });
    }

    function waitForComplete(anim) {
        return new Promise(function (resolve) {
            if (!anim) {
                resolve();
                return;
            }
            function done() {
                anim.removeEventListener('complete', done);
                resolve();
            }
            anim.addEventListener('complete', done);
            g.setTimeout(resolve, 9000);
        });
    }

    function buildOverlay() {
        const overlay = g.document.createElement('div');
        overlay.className = 'diari-pwa-launch';
        overlay.setAttribute('role', 'presentation');
        overlay.setAttribute('aria-hidden', 'true');

        const stage = g.document.createElement('div');
        stage.className = 'diari-pwa-launch__stage';

        const loading = g.document.createElement('div');
        loading.className = 'diari-pwa-launch__loading';
        loading.id = 'diariPwaLaunchLoading';

        const explosionWrap = g.document.createElement('div');
        explosionWrap.className = 'diari-pwa-launch__explosion-wrap diari-pwa-launch--hidden';
        explosionWrap.id = 'diariPwaLaunchExplosionWrap';

        const explosion = g.document.createElement('div');
        explosion.className = 'diari-pwa-launch__explosion';
        explosion.id = 'diariPwaLaunchExplosion';

        const brand = g.document.createElement('div');
        brand.className = 'diari-pwa-launch__brand';
        brand.id = 'diariPwaLaunchBrand';

        const logo = g.document.createElement('img');
        logo.className = 'diari-pwa-launch__logo';
        logo.src = LOGO_SRC;
        logo.alt = '';
        logo.width = 168;
        logo.height = 168;
        logo.decoding = 'async';

        const title = g.document.createElement('p');
        title.className = 'diari-pwa-launch__title';
        title.textContent = 'DIARICORE';

        brand.appendChild(logo);
        brand.appendChild(title);
        explosionWrap.appendChild(explosion);
        explosionWrap.appendChild(brand);
        stage.appendChild(loading);
        stage.appendChild(explosionWrap);
        overlay.appendChild(stage);
        return overlay;
    }

    function playLottie(container, data, loop) {
        return g.lottie.loadAnimation({
            container: container,
            renderer: 'svg',
            loop: !!loop,
            autoplay: true,
            animationData: data,
            rendererSettings: {
                preserveAspectRatio: 'xMidYMid meet',
                progressiveLoad: false,
            },
        });
    }

    function mountOverlayImmediately() {
        if (overlayEl) return overlayEl;
        paintWhiteShell();
        overlayEl = buildOverlay();
        const mountTarget = g.document.body || g.document.documentElement;
        mountTarget.appendChild(overlayEl);
        return overlayEl;
    }

    async function runLaunchSequence() {
        finished = false;
        mountOverlayImmediately();

        const loadingMount = g.document.getElementById('diariPwaLaunchLoading');
        const explosionWrap = g.document.getElementById('diariPwaLaunchExplosionWrap');
        const explosionMount = g.document.getElementById('diariPwaLaunchExplosion');
        const brandEl = g.document.getElementById('diariPwaLaunchBrand');

        const failSafe = g.setTimeout(function () {
            animDone = true;
            appReady = true;
            tryRevealApp();
        }, MAX_WAIT_MS);

        try {
            await loadScript('lottie-web.min.js');
            const loadingData = await fetchAnimation(LOADING_SRC);
            const loadingAnim = playLottie(loadingMount, loadingData, false);
            await waitForComplete(loadingAnim);
            try {
                loadingAnim.destroy();
            } catch (_) {
                /* ignore */
            }
            loadingMount.classList.add('diari-pwa-launch--hidden');

            explosionWrap.classList.remove('diari-pwa-launch--hidden');
            const explosionData = await fetchAnimation(EXPLOSION_SRC);
            const explosionAnim = playLottie(explosionMount, explosionData, false);
            let brandShown = false;
            const showBrandAtFrame = Math.max(
                1,
                Math.floor(explosionAnim.totalFrames * BRAND_SHOW_AT_PROGRESS)
            );
            explosionAnim.addEventListener('enterFrame', function () {
                if (brandShown) return;
                if (explosionAnim.currentFrame >= showBrandAtFrame) {
                    brandShown = true;
                    brandEl.classList.add('is-visible');
                }
            });
            await waitForComplete(explosionAnim);
            try {
                explosionAnim.destroy();
            } catch (_) {
                /* ignore */
            }
        } catch (e) {
            console.warn('[DiariPwaLaunch]', e);
        } finally {
            g.clearTimeout(failSafe);
            animDone = true;
            tryRevealApp();
        }
    }

    function boot() {
        if (!shouldRunLaunch()) {
            finished = true;
            return;
        }
        paintWhiteShell();
        if (g.document.body) {
            void runLaunchSequence();
        } else {
            g.document.addEventListener('DOMContentLoaded', function () {
                void runLaunchSequence();
            });
        }
    }

    g.DiariPwaLaunch = {
        isFinished: isFinished,
        whenFinished: whenFinished,
        shouldRunLaunch: shouldRunLaunch,
        notifyAppReady: notifyAppReady,
    };

    boot();
})(typeof window !== 'undefined' ? window : globalThis);
