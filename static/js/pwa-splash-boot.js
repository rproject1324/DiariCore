/**
 * PWA only: after launch animation on pwa-splash.html, go to dashboard or login.
 */
(function (g) {
    'use strict';

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

    function destination() {
        const u = readSessionUser();
        if (!u) return 'login.html';
        return u.isAdmin ? 'admin' : 'dashboard.html';
    }

    function goNext() {
        g.location.replace(destination());
    }

    if (g.DiariPwaLaunch && typeof g.DiariPwaLaunch.whenFinished === 'function') {
        g.DiariPwaLaunch.whenFinished().then(goNext);
    } else {
        g.setTimeout(goNext, 800);
    }
})(typeof window !== 'undefined' ? window : globalThis);
