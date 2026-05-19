/**
 * PWA only: grey out Profile → Personal Information while offline (matches notification prefs pattern).
 */
(function (global) {
    'use strict';

    const FIELD_IDS = [
        'profileFieldFirstName',
        'profileFieldLastName',
        'profileFieldNickname',
        'profileFieldEmail',
        'profileFieldGender',
        'profileFieldBirthday',
    ];

    function isPwaShell() {
        try {
            if (global.DiariOffline?.isPwaUiContext?.()) return true;
            if (global.DiariPWA?.isStandalone?.()) return true;
        } catch (_) {
            /* ignore */
        }
        const el = global.document?.documentElement;
        if (!el) return false;
        if (el.classList.contains('diari-pwa-standalone')) return true;
        if (el.getAttribute('data-diari-pwa') === 'standalone') return true;
        try {
            if (global.matchMedia('(display-mode: standalone)').matches) return true;
            if (global.matchMedia('(display-mode: fullscreen)').matches) return true;
            if (global.matchMedia('(display-mode: minimal-ui)').matches) return true;
        } catch (_) {
            /* ignore */
        }
        return global.navigator?.standalone === true;
    }

    function isProfilePersonalOffline() {
        if (!isPwaShell()) return false;
        try {
            if (global.DiariOffline?.isPwaOfflineNow) {
                return global.DiariOffline.isPwaOfflineNow();
            }
        } catch (_) {
            /* ignore */
        }
        return global.navigator?.onLine === false;
    }

    function applyPwaProfilePersonalOfflineState() {
        if (!isPwaShell()) return;

        const offline = isProfilePersonalOffline();
        const root = global.document.documentElement;
        const panel = global.document.getElementById('profileSectionPersonalInfo');
        const card = panel?.querySelector('.profile-account-detail-card');
        const form = panel?.querySelector('.profile-account-detail-form');

        if (root) {
            root.classList.toggle('diari-pwa-offline', offline);
        }
        if (panel) {
            panel.classList.toggle('pwa-profile-personal-offline', offline);
        }
        if (card) {
            card.classList.toggle('pwa-profile-personal-offline', offline);
            if (offline) {
                card.setAttribute('inert', '');
                card.setAttribute('aria-disabled', 'true');
            } else {
                card.removeAttribute('inert');
                card.removeAttribute('aria-disabled');
            }
        }
        if (form) {
            form.classList.toggle('pwa-profile-personal-offline', offline);
        }

        FIELD_IDS.forEach(function (id) {
            const el = global.document.getElementById(id);
            if (!el) return;
            el.disabled = offline;
            el.readOnly = offline;
            el.setAttribute('aria-disabled', offline ? 'true' : 'false');
            if (offline) {
                el.setAttribute('tabindex', '-1');
            } else {
                el.removeAttribute('tabindex');
            }
        });

        ['profilePersonalCancelBtn', 'profilePersonalSaveBtn', 'profilePersonalChangePhotoBtn'].forEach(
            function (id) {
                const btn = global.document.getElementById(id);
                if (!btn) return;
                btn.disabled = offline;
                btn.setAttribute('aria-disabled', offline ? 'true' : 'false');
                if (offline) {
                    btn.setAttribute('tabindex', '-1');
                } else {
                    btn.removeAttribute('tabindex');
                }
            }
        );

        if (typeof global.refreshProfilePersonalSaveButton === 'function') {
            global.refreshProfilePersonalSaveButton();
        }
    }

    function wire() {
        if (!isPwaShell()) return;
        applyPwaProfilePersonalOfflineState();
        ['offline', 'online', 'diari-remote-state-refreshed', 'diari-offline-sync-complete'].forEach(
            function (ev) {
                global.addEventListener(ev, applyPwaProfilePersonalOfflineState);
            }
        );
    }

    global.applyPwaProfilePersonalOfflineState = applyPwaProfilePersonalOfflineState;
    global.isPwaProfilePersonalOffline = isProfilePersonalOffline;

    if (global.document.readyState === 'loading') {
        global.document.addEventListener('DOMContentLoaded', wire);
    } else {
        wire();
    }
})(typeof window !== 'undefined' ? window : globalThis);
