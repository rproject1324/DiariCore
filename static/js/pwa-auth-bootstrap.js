/**
 * PWA-only auth routing: redirect logged-in users away from login; guard app pages when logged out.
 * Does not hide or alter the sign-in page in the normal browser (desktop/mobile tab).
 */
(function (g) {
    'use strict';

    function isPwaStandalone() {
        if (!g) return false;
        try {
            if (g.DiariPWA && typeof g.DiariPWA.isStandalone === 'function' && g.DiariPWA.isStandalone()) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
        try {
            return (
                (g.matchMedia && g.matchMedia('(display-mode: standalone)').matches) ||
                (g.navigator && g.navigator.standalone === true)
            );
        } catch (_) {
            return false;
        }
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

    if (!isPwaStandalone()) {
        return;
    }

    const page = pageName();
    const user = readSessionUser();
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
    }
})();
