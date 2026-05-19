/**
 * PWA only: apply user theme/palette to :root BEFORE stylesheets paint (prevents sage-green topbar flash).
 * Keep palette ids in sync with theme.js. Load as the first <script> in <head> on app pages.
 */
(function (g) {
    'use strict';

    const PALETTES = {
        'theme-1': '#6F8F7F',
        'theme-2': '#8E7CB5',
        'theme-3': '#6F9BB8',
        'theme-4': '#D89A82',
        'theme-5': '#4FAFB0',
        'theme-6': '#B5957E',
        'theme-7': '#BC7E97',
        'theme-8': '#6FAF9B',
        'theme-9': '#A97B95',
        'theme-10': '#7F9393',
    };

    const DARK_CLASS = 'theme-dark';

    function isPwaStandalone() {
        try {
            if (g.DiariPWA && typeof g.DiariPWA.isStandalone === 'function' && g.DiariPWA.isStandalone()) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
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

    function hexToRgb(hex) {
        const safe = (hex || '').replace('#', '').trim();
        if (safe.length !== 6) return { r: 111, g: 143, b: 127 };
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
        return (
            '#' +
            apply(r).toString(16).padStart(2, '0') +
            apply(g).toString(16).padStart(2, '0') +
            apply(b).toString(16).padStart(2, '0')
        );
    }

    function applyShellBackgrounds(primary, isDark) {
        const root = g.document.documentElement;
        if (isDark) {
            root.style.setProperty('--background-color', '#11171a');
            root.style.setProperty('--background-soft', '#1a2327');
            root.style.setProperty('--background-accent', '#1f2b30');
            root.style.setProperty('--card-background', '#182126');
            return;
        }
        root.style.setProperty(
            '--background-color',
            `color-mix(in srgb, ${primary} 8%, #f5f7f6)`
        );
        root.style.setProperty(
            '--background-soft',
            `color-mix(in srgb, ${primary} 14%, #eef2f0)`
        );
        root.style.setProperty(
            '--background-accent',
            `color-mix(in srgb, ${primary} 20%, #e6efea)`
        );
        root.style.setProperty('--card-background', '#ffffff');
    }

    function applyPaletteVars(primary, isDark) {
        const root = g.document.documentElement;
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
        root.style.setProperty('--diari-success-sage-solid', primary);
        root.style.setProperty('--diari-success-sage-text', primary);
        root.style.setProperty('--success-color', primary);
        root.style.setProperty(
            '--diari-success-tint-bg',
            isDark
                ? `color-mix(in srgb, ${primary} 20%, #182126)`
                : `color-mix(in srgb, ${primary} 14%, #ffffff)`
        );
        applyShellBackgrounds(primary, isDark);

        root.classList.toggle(DARK_CLASS, isDark);
        if (g.document.body) {
            g.document.body.classList.toggle(DARK_CLASS, isDark);
        }

        let meta = g.document.querySelector('meta[name="theme-color"]');
        if (!meta) {
            meta = g.document.createElement('meta');
            meta.setAttribute('name', 'theme-color');
            g.document.head.appendChild(meta);
        }
        meta.setAttribute('content', isDark ? '#11171a' : primary);
        root.classList.add('diari-pwa-theme-early');
    }

    function resolvePaletteId() {
        let paletteId = 'theme-1';
        try {
            const pendingRaw = g.localStorage.getItem('diariCorePwaPendingUiPrefs');
            if (pendingRaw) {
                const pending = JSON.parse(pendingRaw);
                if (pending && pending.uiPaletteId && PALETTES[pending.uiPaletteId]) {
                    return pending.uiPaletteId;
                }
            }
        } catch (_) {
            /* ignore */
        }
        try {
            const u = JSON.parse(g.localStorage.getItem('diariCoreUser') || 'null');
            if (u && u.isLoggedIn && u.uiPaletteId && PALETTES[u.uiPaletteId]) {
                return u.uiPaletteId;
            }
        } catch (_) {
            /* ignore */
        }
        try {
            const raw = (g.localStorage.getItem('diariCorePalette') || '').toLowerCase();
            if (raw && PALETTES[raw]) return raw;
        } catch (_) {
            /* ignore */
        }
        return paletteId;
    }

    function resolveTheme() {
        try {
            const pendingRaw = g.localStorage.getItem('diariCorePwaPendingUiPrefs');
            if (pendingRaw) {
                const pending = JSON.parse(pendingRaw);
                if (pending && pending.uiTheme === 'dark') return 'dark';
            }
        } catch (_) {
            /* ignore */
        }
        try {
            const u = JSON.parse(g.localStorage.getItem('diariCoreUser') || 'null');
            if (u && u.isLoggedIn && u.uiTheme === 'dark') return 'dark';
        } catch (_) {
            /* ignore */
        }
        try {
            const raw = (g.localStorage.getItem('diariCoreTheme') || '').toLowerCase();
            if (raw === 'dark') return 'dark';
        } catch (_) {
            /* ignore */
        }
        return 'light';
    }

    function applyEarlyAppearance() {
        if (!isPwaStandalone()) return;
        if (isAuthPage()) {
            applyPaletteVars(PALETTES['theme-1'], false);
            return;
        }
        const paletteId = resolvePaletteId();
        const primary = PALETTES[paletteId] || PALETTES['theme-1'];
        applyPaletteVars(primary, resolveTheme() === 'dark');
    }

    applyEarlyAppearance();
    g.addEventListener('pageshow', function (ev) {
        if (ev.persisted) applyEarlyAppearance();
    });
})(typeof window !== 'undefined' ? window : globalThis);
