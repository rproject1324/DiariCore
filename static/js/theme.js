(function () {
    const STORAGE_KEY = 'diariCoreTheme';
    const PALETTE_KEY = 'diariCorePalette';
    const DARK_CLASS = 'theme-dark';
    const FAB_ID = 'diariThemeToggleFab';
    const PALETTES = [
        { id: 'theme-1', name: 'Soft Sage Green', primary: '#6F8F7F' },
        { id: 'theme-2', name: 'Lavender Purple', primary: '#8E7CB5' },
        { id: 'theme-3', name: 'Sky Blue', primary: '#6F9BB8' },
        { id: 'theme-4', name: 'Warm Peach', primary: '#D89A82' },
        { id: 'theme-5', name: 'Aqua Teal', primary: '#4FAFB0' },
        { id: 'theme-6', name: 'Sand Beige', primary: '#B5957E' },
        { id: 'theme-7', name: 'Rose Quartz', primary: '#BC7E97' },
        { id: 'theme-8', name: 'Mint Green', primary: '#6FAF9B' },
        { id: 'theme-9', name: 'Mauve Pink', primary: '#A97B95' },
        { id: 'theme-10', name: 'Sage Gray', primary: '#7F9393' },
    ];
    const VALID_PALETTE_IDS = new Set(PALETTES.map(function (p) {
        return p.id;
    }));
    const DEFAULT_THEME = 'light';
    const DEFAULT_PALETTE_ID = 'theme-1';
    let prefsSyncTimer = null;

    function isMobileViewport() {
        try {
            return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
        } catch (_) {
            return false;
        }
    }

    /** Mobile only: hide topbar person icon until uploaded photo is applied (avoids refresh flash). */
    function syncMobileAvatarEarlyClass() {
        if (!isMobileViewport()) {
            document.documentElement.classList.remove('diari-mobile-has-avatar');
            return;
        }
        try {
            const u = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
            const hasPhoto = Boolean(
                u &&
                    u.isLoggedIn &&
                    typeof u.avatarDataUrl === 'string' &&
                    u.avatarDataUrl.trim()
            );
            document.documentElement.classList.toggle('diari-mobile-has-avatar', hasPhoto);
        } catch (_) {
            document.documentElement.classList.remove('diari-mobile-has-avatar');
        }
    }

    function getSavedTheme() {
        const raw = (localStorage.getItem(STORAGE_KEY) || '').toLowerCase();
        return raw === 'dark' ? 'dark' : 'light';
    }

    function getPaletteById(id) {
        return PALETTES.find((p) => p.id === id) || PALETTES[0];
    }

    function getSavedPaletteId() {
        const raw = (localStorage.getItem(PALETTE_KEY) || '').toLowerCase();
        return getPaletteById(raw).id;
    }

    function hexToRgb(hex) {
        const safe = (hex || '').replace('#', '').trim();
        if (safe.length !== 6) return { r: 140, g: 185, b: 184 };
        return {
            r: Number.parseInt(safe.slice(0, 2), 16),
            g: Number.parseInt(safe.slice(2, 4), 16),
            b: Number.parseInt(safe.slice(4, 6), 16),
        };
    }

    function shade(hex, percent) {
        const { r, g, b } = hexToRgb(hex);
        const factor = Math.max(-1, Math.min(1, percent));
        const apply = (v) => {
            const next = factor >= 0 ? v + (255 - v) * factor : v * (1 + factor);
            return Math.max(0, Math.min(255, Math.round(next)));
        };
        const rr = apply(r).toString(16).padStart(2, '0');
        const gg = apply(g).toString(16).padStart(2, '0');
        const bb = apply(b).toString(16).padStart(2, '0');
        return `#${rr}${gg}${bb}`;
    }

    function isAuthPage() {
        const path = String(window.location.pathname || '').replace(/\\/g, '/').toLowerCase();
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

    function applySuccessColorsFromPrimary(primary) {
        const root = document.documentElement;
        const isDark = root.classList.contains(DARK_CLASS);
        root.style.setProperty('--diari-success-sage-solid', primary);
        root.style.setProperty('--diari-success-sage-text', primary);
        root.style.setProperty('--success-color', primary);
        root.style.setProperty(
            '--diari-success-tint-bg',
            isDark
                ? `color-mix(in srgb, ${primary} 20%, #182126)`
                : `color-mix(in srgb, ${primary} 14%, #ffffff)`
        );
    }

    function applyPaletteById(paletteId) {
        const palette = getPaletteById(paletteId);
        const root = document.documentElement;
        const primary = palette.primary;
        const primaryHover = shade(primary, -0.12);
        const primaryLight = shade(primary, 0.12);
        const accent = shade(primary, 0.22);
        const darkPrimary = shade(primary, 0.08);
        const darkPrimaryHover = shade(primary, -0.05);
        const darkPrimaryLight = shade(primary, 0.22);
        const primaryRgb = hexToRgb(primary);

        root.style.setProperty('--primary-color', primary);
        root.style.setProperty('--primary-hover', primaryHover);
        root.style.setProperty('--primary-light', primaryLight);
        root.style.setProperty('--primary-rgb', `${primaryRgb.r}, ${primaryRgb.g}, ${primaryRgb.b}`);
        root.style.setProperty('--accent-green', accent);
        root.style.setProperty('--theme-dark-primary', darkPrimary);
        root.style.setProperty('--theme-dark-primary-hover', darkPrimaryHover);
        root.style.setProperty('--theme-dark-primary-light', darkPrimaryLight);
        applySuccessColorsFromPrimary(primary);

        const currentName = document.querySelector('[data-theme-palette-name]');
        if (currentName) currentName.textContent = palette.name;

        const currentSwatch = document.querySelector('[data-theme-palette-swatch]');
        if (currentSwatch) currentSwatch.style.background = palette.primary;

        document.querySelectorAll('[data-theme-palette]').forEach((btn) => {
            const isActive = btn.getAttribute('data-theme-palette') === palette.id;
            btn.classList.toggle('is-active', isActive);
            btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });

        window.dispatchEvent(
            new CustomEvent('diari-palette-changed', {
                detail: {
                    paletteId: palette.id,
                    paletteName: palette.name,
                    primaryColor: palette.primary,
                },
            })
        );
    }

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        document.documentElement.classList.toggle(DARK_CLASS, isDark);
        if (document.body) {
            document.body.classList.toggle(DARK_CLASS, isDark);
        }
        applySuccessColorsFromPrimary(getPaletteById(getSavedPaletteId()).primary);
    }

    function hasPwaPendingUiPrefs() {
        try {
            return (
                window.DiariOffline &&
                typeof window.DiariOffline.hasPwaPendingUiPrefs === 'function' &&
                window.DiariOffline.hasPwaPendingUiPrefs()
            );
        } catch (_) {
            return false;
        }
    }

    function applyAppearanceFromStoredUser() {
        if (isAuthPage()) return;
        let user = null;
        try {
            user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        } catch (_) {
            user = null;
        }
        if (user && user.isLoggedIn && (user.uiTheme || user.uiPaletteId) && !hasPwaPendingUiPrefs()) {
            applyFromUserObject(user);
            return;
        }
        applyTheme(getSavedTheme());
        applyPaletteById(getSavedPaletteId());
    }

    function bootstrapAppearance() {
        if (isAuthPage()) {
            applyTheme(DEFAULT_THEME);
            applyPaletteById(DEFAULT_PALETTE_ID);
            return;
        }
        applyAppearanceFromStoredUser();
        syncMobileAvatarEarlyClass();
    }

    function queueSyncUserUiPreferences() {
        if (prefsSyncTimer) {
            clearTimeout(prefsSyncTimer);
        }
        prefsSyncTimer = setTimeout(function () {
            prefsSyncTimer = null;
            let raw;
            try {
                raw = localStorage.getItem('diariCoreUser');
            } catch (_) {
                return;
            }
            if (!raw) return;
            let u;
            try {
                u = JSON.parse(raw);
            } catch (_) {
                return;
            }
            if (!u || !u.isLoggedIn || !u.id) return;
            const theme = getSavedTheme();
            const palette = getSavedPaletteId();
            const body = { userId: u.id };
            if (theme === 'light' || theme === 'dark') {
                body.uiTheme = theme;
            }
            if (palette && VALID_PALETTE_IDS.has(palette)) {
                body.uiPaletteId = palette;
            }
            if (!body.uiTheme && !body.uiPaletteId) return;
            fetch('/api/user/ui-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'same-origin',
            })
                .then(function (r) {
                    return r.json();
                })
                .then(function (data) {
                    if (!data || !data.success || !data.user) return;
                    applyFromUserObject(data.user);
                    try {
                        localStorage.removeItem('diariCoreSyncRevision');
                    } catch (_) {
                        /* ignore */
                    }
                    if (window.DiariOffline && typeof window.DiariOffline.pullRemoteStateForRefresh === 'function') {
                        void window.DiariOffline.pullRemoteStateForRefresh({ force: true });
                    }
                })
                .catch(function () {});
        }, 450);
    }

    function persistUserUiPrefsLocally(theme, paletteId) {
        try {
            const raw = localStorage.getItem('diariCoreUser');
            if (!raw) return;
            const cur = JSON.parse(raw);
            if (!cur || typeof cur !== 'object') return;
            if (theme === 'light' || theme === 'dark') cur.uiTheme = theme;
            if (paletteId && VALID_PALETTE_IDS.has(paletteId)) cur.uiPaletteId = paletteId;
            localStorage.setItem('diariCoreUser', JSON.stringify(cur));
        } catch (_) {}
    }

    function applyFromUserObject(u) {
        if (!u || typeof u !== 'object') return;
        if (isAuthPage()) return;
        const opts = { skipServerSync: true };
        if (u.uiTheme === 'light' || u.uiTheme === 'dark') {
            setTheme(u.uiTheme, opts);
        }
        if (typeof u.uiPaletteId === 'string' && VALID_PALETTE_IDS.has(u.uiPaletteId)) {
            setPalette(u.uiPaletteId, opts);
        }
        try {
            const raw = localStorage.getItem('diariCoreUser');
            if (!raw) return;
            const cur = JSON.parse(raw);
            if (!cur || typeof cur !== 'object') return;
            if (u.uiTheme === 'light' || u.uiTheme === 'dark') {
                cur.uiTheme = u.uiTheme;
            }
            if (typeof u.uiPaletteId === 'string' && VALID_PALETTE_IDS.has(u.uiPaletteId)) {
                cur.uiPaletteId = u.uiPaletteId;
            }
            localStorage.setItem('diariCoreUser', JSON.stringify(cur));
        } catch (_) {}
    }

    function setTheme(theme, opts) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        localStorage.setItem(STORAGE_KEY, nextTheme);
        applyTheme(nextTheme);
        syncFabState(nextTheme);
        syncToggleState();
        persistUserUiPrefsLocally(nextTheme, getSavedPaletteId());
        window.dispatchEvent(new CustomEvent('diari-theme-changed', { detail: { theme: nextTheme } }));
        if (!(opts && opts.skipServerSync)) {
            queueSyncUserUiPreferences();
        }
    }

    function setPalette(paletteId, opts) {
        const nextPalette = getPaletteById(paletteId);
        localStorage.setItem(PALETTE_KEY, nextPalette.id);
        applyPaletteById(nextPalette.id);
        persistUserUiPrefsLocally(getSavedTheme(), nextPalette.id);
        if (!(opts && opts.skipServerSync)) {
            queueSyncUserUiPreferences();
        }
    }

    function persistDefaultPreferences() {
        if (prefsSyncTimer) {
            clearTimeout(prefsSyncTimer);
            prefsSyncTimer = null;
        }
        localStorage.setItem(STORAGE_KEY, DEFAULT_THEME);
        localStorage.setItem(PALETTE_KEY, DEFAULT_PALETTE_ID);
    }

    /** Restore system defaults and apply to the current page (use when staying on-app). */
    function resetToDefaults() {
        persistDefaultPreferences();
        applyTheme(DEFAULT_THEME);
        applyPaletteById(DEFAULT_PALETTE_ID);
        syncFabState(DEFAULT_THEME);
        syncToggleState();
        const defaultPalette = getPaletteById(DEFAULT_PALETTE_ID);
        window.dispatchEvent(
            new CustomEvent('diari-theme-changed', { detail: { theme: DEFAULT_THEME } })
        );
        window.dispatchEvent(
            new CustomEvent('diari-palette-changed', {
                detail: {
                    paletteId: DEFAULT_PALETTE_ID,
                    paletteName: defaultPalette.name,
                    primaryColor: defaultPalette.primary,
                },
            })
        );
    }

    /** Clear session and prefs, redirect to login without flashing theme on current page. */
    function logout(redirectUrl) {
        persistDefaultPreferences();
        try {
            if (window.DiariSecurity && typeof window.DiariSecurity.clearCsrfToken === 'function') {
                window.DiariSecurity.clearCsrfToken();
            }
            if (typeof fetch === 'function') {
                fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(function () {});
            }
            localStorage.removeItem('diariCoreUser');
            if (window.DiariSecurity && typeof window.DiariSecurity.clearUserScopedLocalData === 'function') {
                window.DiariSecurity.clearUserScopedLocalData();
            }
        } catch (_) {}
        window.location.href = redirectUrl || 'login.html';
    }

    function syncToggleState() {
        const toggle = document.getElementById('toggleDarkMode');
        if (!toggle) return;
        const isDark = document.documentElement.classList.contains(DARK_CLASS);
        toggle.checked = isDark;
        const hint = document.getElementById('darkModeStatusHint');
        if (hint) {
            hint.textContent = isDark ? 'Currently on' : 'Currently off';
        }
    }

    function syncFabState(theme) {
        const fab = document.getElementById(FAB_ID);
        if (!fab) return;
        const isDark = theme === 'dark';
        fab.setAttribute('data-theme', isDark ? 'dark' : 'light');
        fab.setAttribute(
            'aria-label',
            isDark ? 'Switch to light mode' : 'Switch to dark mode'
        );
        fab.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    }

    function isMobileViewport() {
        return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function createThemeToggleFab() {
        if (!document.body || document.getElementById(FAB_ID)) return;
        if (isMobileViewport()) return;

        const fab = document.createElement('button');
        fab.type = 'button';
        fab.id = FAB_ID;
        fab.className = 'theme-toggle-fab';
        fab.innerHTML = `
            <span class="theme-toggle-fab__icon theme-toggle-fab__icon--sun" aria-hidden="true">☀</span>
            <span class="theme-toggle-fab__icon theme-toggle-fab__icon--moon" aria-hidden="true">🌙</span>
        `;

        fab.addEventListener('click', function () {
            const current = document.documentElement.classList.contains(DARK_CLASS) ? 'dark' : 'light';
            setTheme(current === 'dark' ? 'light' : 'dark');
        });

        document.body.appendChild(fab);
        syncFabState(getSavedTheme());
    }

    function bindPaletteButtons() {
        const paletteButtons = document.querySelectorAll('[data-theme-palette]');
        if (!paletteButtons.length) return;

        paletteButtons.forEach((btn) => {
            if (btn.dataset.paletteBound === '1') return;
            btn.dataset.paletteBound = '1';
            btn.addEventListener('click', function () {
                const paletteId = this.getAttribute('data-theme-palette');
                if (!paletteId) return;
                const inProfilePrefs = Boolean(
                    document.getElementById('profileSectionPreferences') &&
                        !document.getElementById('profileSectionPreferences').hidden
                );
                if (
                    inProfilePrefs &&
                    window.DiariOffline &&
                    typeof window.DiariOffline.isPwaUiContext === 'function' &&
                    window.DiariOffline.isPwaUiContext() &&
                    typeof window.handlePwaProfilePalettePick === 'function'
                ) {
                    void window.handlePwaProfilePalettePick(paletteId);
                    const panel = document.getElementById('themePalettePanel');
                    const toggleBtn = document.getElementById('themePaletteToggle');
                    if (panel && toggleBtn) {
                        panel.hidden = true;
                        toggleBtn.setAttribute('aria-expanded', 'false');
                    }
                    return;
                }
                setPalette(paletteId);
                const panel = document.getElementById('themePalettePanel');
                const toggleBtn = document.getElementById('themePaletteToggle');
                if (panel && toggleBtn) {
                    panel.hidden = true;
                    toggleBtn.setAttribute('aria-expanded', 'false');
                }
            });
        });
    }

    function bindPalettePanelToggle() {
        const toggleBtn = document.getElementById('themePaletteToggle');
        const panel = document.getElementById('themePalettePanel');
        if (!toggleBtn || !panel || toggleBtn.dataset.bound === '1') return;
        toggleBtn.dataset.bound = '1';

        toggleBtn.addEventListener('click', function () {
            const nextOpen = panel.hidden;
            panel.hidden = !nextOpen;
            toggleBtn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
        });

        document.addEventListener('click', function (event) {
            if (panel.hidden) return;
            if (panel.contains(event.target) || toggleBtn.contains(event.target)) return;
            panel.hidden = true;
            toggleBtn.setAttribute('aria-expanded', 'false');
        });
    }

    // Apply immediately to reduce theme flicker.
    bootstrapAppearance();

    document.addEventListener('DOMContentLoaded', function () {
        bootstrapAppearance();
        createThemeToggleFab();
        bindPaletteButtons();
        bindPalettePanelToggle();
        syncToggleState();
    });

    document.addEventListener('diari-user-updated', function () {
        syncMobileAvatarEarlyClass();
        applyAppearanceFromStoredUser();
    });
    document.addEventListener('diari-remote-state-refreshed', applyAppearanceFromStoredUser);

    window.addEventListener('storage', function (event) {
        if (event.key === 'diariCoreUser') {
            syncMobileAvatarEarlyClass();
            return;
        }
        if (event.key === STORAGE_KEY) {
            const nextTheme = getSavedTheme();
            applyTheme(nextTheme);
            syncFabState(nextTheme);
            syncToggleState();
            return;
        }
        if (event.key === PALETTE_KEY) {
            applyPaletteById(getSavedPaletteId());
        }
    });

    window.syncMobileAvatarEarlyClass = syncMobileAvatarEarlyClass;

    window.DiariTheme = {
        getTheme: getSavedTheme,
        getPalette: getSavedPaletteId,
        getPalettes: function () {
            return PALETTES.slice();
        },
        setTheme,
        setPalette,
        applyTheme,
        applyPaletteById,
        syncToggleState,
        applyFromUser: applyFromUserObject,
        persistDefaultPreferences,
        resetToDefaults,
        logout,
        isAuthPage,
        DEFAULT_THEME,
        DEFAULT_PALETTE_ID,
    };
})();
