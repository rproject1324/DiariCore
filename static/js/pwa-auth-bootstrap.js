/**
 * PWA-only fast auth routing: skip login flash when session exists; guard app pages when logged out.
 * Loaded synchronously in <head> before body paint on login/dashboard and other shell pages.
 */
(function (g) {
    'use strict';

    function isPwaContext() {
        try {
            if (g.DiariPWA && typeof g.DiariPWA.isStandalone === 'function' && g.DiariPWA.isStandalone()) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
        return (
            (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) ||
            g.navigator.standalone === true ||
            (g.document && g.document.documentElement.classList.contains('diari-pwa-standalone'))
        );
    }

    function readSessionUser() {
        try {
            const raw = g.localStorage.getItem('diariCoreUser');
            if (!raw) return null;
            const u = JSON.parse(raw);
            if (!u || u.isLoggedIn === false) return null;
            const id = u.id != null ? u.id : u.userId;
            if (id == null || id === '' || Number(id) === 0) return null;
            return u;
        } catch (_) {
            return null;
        }
    }

    function pageName() {
        const p = (g.location.pathname || '').split('/').pop() || '';
        return p || 'index.html';
    }

    function dashboardHref(u) {
        return u && u.isAdmin ? 'admin' : 'dashboard.html';
    }

    function revealLoginIfPending() {
        try {
            g.document.documentElement.classList.remove('diari-pwa-auth-pending');
        } catch (_) {
            /* ignore */
        }
    }

    if (!isPwaContext()) {
        revealLoginIfPending();
        return;
    }

    const page = pageName();
    const user = readSessionUser();
    const isAuthEntry =
        page === '' || page === 'index.html' || page === 'login.html' || page === 'register.html';
    const isPublicAuth =
        page === '' ||
        page === 'index.html' ||
        page === 'login.html' ||
        page === 'register.html' ||
        page === 'verify-registration.html';

    if (user && (page === 'login.html' || page === '' || page === 'index.html')) {
        g.location.replace(dashboardHref(user));
        return;
    }

    if (!user && !isPublicAuth) {
        g.location.replace('login.html');
        return;
    }

    if (page === 'login.html' || isAuthEntry) {
        revealLoginIfPending();
    }
})();
