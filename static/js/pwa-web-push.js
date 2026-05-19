/**
 * PWA only: true Web Push (server-sent via VAPID). Works when the app is closed.
 */
(function (global) {
    'use strict';

    const WEB_PUSH_ACTIVE_KEY = 'diariCoreWebPushActive';

    function isPwaStandalone() {
        try {
            if (global.DiariPWA && typeof global.DiariPWA.isStandalone === 'function') {
                if (global.DiariPWA.isStandalone()) return true;
            }
        } catch (_) {
            /* ignore */
        }
        try {
            if (global.DiariOffline?.isPwaUiContext?.()) return true;
        } catch (_) {
            /* ignore */
        }
        const el = global.document?.documentElement;
        if (el?.classList.contains('diari-pwa-standalone')) return true;
        if (el?.getAttribute('data-diari-pwa') === 'standalone') return true;
        const modes = ['standalone', 'fullscreen', 'minimal-ui'];
        for (let i = 0; i < modes.length; i += 1) {
            try {
                if (global.matchMedia && global.matchMedia('(display-mode: ' + modes[i] + ')').matches) {
                    return true;
                }
            } catch (_) {
                /* ignore */
            }
        }
        if (global.navigator?.standalone === true) return true;
        try {
            if (global.document?.referrer && global.document.referrer.indexOf('android-app://') === 0) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
        return false;
    }

    async function ensureServiceWorkerReady() {
        if (!('serviceWorker' in navigator)) {
            throw new Error('Service worker not supported on this browser');
        }
        let reg = await navigator.serviceWorker.getRegistration('/');
        if (!reg) {
            reg = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        }
        await navigator.serviceWorker.ready;
        return reg;
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = global.atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
        return out;
    }

    function subscriptionUsesVapidKey(sub, publicKeyB64) {
        if (!sub || !publicKeyB64) return false;
        const appKey = sub.options && sub.options.applicationServerKey;
        if (!appKey) return true;
        const expected = urlBase64ToUint8Array(publicKeyB64);
        if (appKey.byteLength !== expected.byteLength) return false;
        for (let i = 0; i < appKey.byteLength; i += 1) {
            if (appKey[i] !== expected[i]) return false;
        }
        return true;
    }

    function getEffectiveReminderHHmm() {
        try {
            if (global.DiariPwaNotifications?.getEffectiveReminderHHmm) {
                const t = global.DiariPwaNotifications.getEffectiveReminderHHmm();
                if (t && /^\d{2}:\d{2}$/.test(t)) return t;
            }
        } catch (_) {
            /* ignore */
        }
        const override = global.localStorage.getItem('diariCoreReminderTimeUserOverride');
        if (override && /^\d{2}:\d{2}$/.test(override.trim())) return override.trim();
        return '09:00';
    }

    function buildNotificationPrefsPayload() {
        return {
            notifications: {
                dailyEnabled: global.localStorage.getItem('diariCorePwaDailyRemindersEnabled') !== '0',
                streakEnabled: global.localStorage.getItem('diariCorePwaStreakRemindersEnabled') !== '0',
                insightEnabled: global.localStorage.getItem('diariCorePwaInsightFollowupsEnabled') !== '0',
                reminderTimeOverride: getEffectiveReminderHHmm(),
            },
        };
    }

    function apiFetch(input, init) {
        if (global.DiariSecurity?.apiFetch) {
            return global.DiariSecurity.apiFetch(input, init);
        }
        return fetch(input, init);
    }

    async function fetchVapidPublicKey() {
        const res = await apiFetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.publicKey) {
            throw new Error(data.error || 'Web Push not available');
        }
        return data.publicKey;
    }

    async function fetchScheduleStatus() {
        const res = await apiFetch('/api/push/schedule-status', { credentials: 'same-origin' });
        return res.json().catch(() => ({}));
    }

    async function saveSubscriptionOnServer(sub) {
        const body = {
            subscription: sub.toJSON(),
            keepThisDeviceOnly: true,
            ...buildNotificationPrefsPayload(),
        };
        const res = await apiFetch('/api/push/subscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Subscribe failed');
        }
        return data;
    }

    /**
     * Browser push subscription matching current VAPID key (re-subscribe only if mismatched).
     */
    async function runPushDiagnostics() {
        const diag = {
            at: new Date().toISOString(),
            pwaStandalone: isPwaStandalone(),
            notificationPermission:
                typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
            serviceWorker: 'serviceWorker' in navigator,
            pushManager: 'PushManager' in global,
            displayMode: null,
            hasBrowserSubscription: false,
            serverDevices: null,
            steps: [],
        };
        try {
            diag.displayMode = global.matchMedia('(display-mode: standalone)').matches
                ? 'standalone'
                : global.matchMedia('(display-mode: minimal-ui)').matches
                  ? 'minimal-ui'
                  : global.matchMedia('(display-mode: fullscreen)').matches
                    ? 'fullscreen'
                    : 'browser/other';
        } catch (_) {
            diag.displayMode = 'unknown';
        }
        if (!diag.pwaStandalone) {
            diag.steps.push('FAIL: not detected as installed PWA');
            return diag;
        }
        if (diag.notificationPermission !== 'granted') {
            diag.steps.push('FAIL: notifications not allowed — enable in Android Settings → Apps → Chrome → Notifications');
            return diag;
        }
        try {
            const publicKey = await fetchVapidPublicKey();
            diag.vapidOk = true;
            const reg = await ensureServiceWorkerReady();
            diag.serviceWorkerState = reg.active ? 'active' : reg.installing ? 'installing' : 'waiting';
            const sub = await reg.pushManager.getSubscription();
            diag.hasBrowserSubscription = !!sub;
            diag.subscriptionEndpoint = sub
                ? String(sub.endpoint || '').slice(0, 48) + '…'
                : null;
            if (!sub) {
                diag.steps.push('WARN: no browser push subscription yet');
            } else {
                diag.steps.push('OK: browser has push subscription');
            }
            const saved = await saveSubscriptionOnServer(sub || (await getOrCreatePushSubscription(reg, publicKey)));
            diag.serverDevices =
                saved.subscribedDevices ?? saved.schedule?.subscribedDevices ?? null;
            if ((diag.serverDevices ?? 0) >= 1) {
                diag.steps.push('OK: server saved this device (' + diag.serverDevices + ')');
            } else {
                diag.steps.push('FAIL: server still shows 0 devices after subscribe');
            }
        } catch (e) {
            diag.error = e && e.message ? e.message : String(e);
            diag.steps.push('FAIL: ' + diag.error);
        }
        try {
            await apiFetch('/api/push/diagnostics', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ report: diag }),
            });
        } catch (_) {
            /* ignore */
        }
        return diag;
    }

    async function getOrCreatePushSubscription(reg, publicKeyB64) {
        let sub = await reg.pushManager.getSubscription();
        if (sub && !subscriptionUsesVapidKey(sub, publicKeyB64)) {
            try {
                await sub.unsubscribe();
            } catch (_) {
                /* ignore */
            }
            sub = null;
        }
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKeyB64),
            });
        }
        return sub;
    }

    /**
     * Save the browser's current push subscription to Railway without unsubscribing first.
     */
    async function syncPushSubscriptionToServer() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        if (!('serviceWorker' in navigator) || !('PushManager' in global)) {
            return { ok: false, error: 'Push not supported' };
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return { ok: false, error: 'Notifications not allowed' };
        }
        const publicKey = await fetchVapidPublicKey();
        const reg = await ensureServiceWorkerReady();
        const sub = await getOrCreatePushSubscription(reg, publicKey);
        const data = await saveSubscriptionOnServer(sub);
        const devices =
            data.subscribedDevices ??
            data.schedule?.subscribedDevices ??
            0;
        try {
            global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        if (global.DiariPwaNotifications?.syncPrefsToWorker) {
            void global.DiariPwaNotifications.syncPrefsToWorker();
        }
        global.dispatchEvent(new CustomEvent('diari-web-push-subscribed'));
        return { ok: true, schedule: data.schedule, subscribedDevices: devices };
    }

    async function subscribeWebPush() {
        const result = await registerPushForReminders({ quiet: true });
        return !!result.ok;
    }

    /**
     * Ensure this phone is registered on the server (retries). Required for closed-app reminders.
     */
    let lastMaintainAttemptMs = 0;
    let maintainInFlight = null;

    async function registerPushForReminders(options) {
        const quiet = !options || options.quiet !== false;
        const maxAttempts = options && options.maxAttempts ? options.maxAttempts : 5;
        if (!isPwaStandalone()) {
            return { ok: false, error: 'Open DiariCore from your home-screen app, not a browser tab.' };
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return {
                ok: false,
                error: 'Allow notifications for Chrome in Android Settings, then reopen DiariCore.',
            };
        }
        let lastError = 'Could not register this phone';
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const result = await syncPushSubscriptionToServer();
                const devices =
                    result.subscribedDevices ??
                    result.schedule?.subscribedDevices ??
                    0;
                if (result.ok && devices >= 1) {
                    return { ok: true, subscribedDevices: devices };
                }
                if (result && result.error) {
                    lastError = result.error;
                }
            } catch (e) {
                lastError = e && e.message ? e.message : lastError;
                if (!quiet) {
                    console.warn('[DiariPwaWebPush] register attempt', attempt + 1, e);
                }
            }
            await delay(attempt < 2 ? 400 : 800);
        }
        return { ok: false, error: lastError };
    }

    /**
     * Re-register this device when the PWA opens or returns to foreground (debounced).
     */
    async function maintainPushRegistration(options) {
        const force = !!(options && options.force);
        const now = Date.now();
        if (!force && now - lastMaintainAttemptMs < 45000) {
            return { ok: true, skipped: true };
        }
        if (maintainInFlight) {
            return maintainInFlight;
        }
        lastMaintainAttemptMs = now;
        maintainInFlight = registerPushForReminders({ quiet: true, maxAttempts: force ? 5 : 3 })
            .then(function (result) {
                maintainInFlight = null;
                return result;
            })
            .catch(function (e) {
                maintainInFlight = null;
                return { ok: false, error: e && e.message ? e.message : String(e) };
            });
        return maintainInFlight;
    }

    function bindPushLifecycleMaintenance() {
        if (bindPushLifecycleMaintenance._bound) return;
        bindPushLifecycleMaintenance._bound = true;
        global.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                void maintainPushRegistration();
            } else if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                void syncPushSubscriptionToServer().catch(function () {
                    /* ignore */
                });
                syncNotificationPrefsToServerBeacon();
            }
        });
        global.addEventListener('online', function () {
            void maintainPushRegistration({ force: true });
        });
        global.addEventListener('pagehide', function () {
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
                void syncPushSubscriptionToServer().catch(function () {
                    /* ignore */
                });
                syncNotificationPrefsToServerBeacon();
            }
        });
    }
    bindPushLifecycleMaintenance();

    /** Force new FCM token (only when user taps "Use this phone only"). */
    async function renewPushSubscription() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return { ok: false, error: 'Notifications not allowed' };
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in global)) {
            return { ok: false, error: 'Push not supported on this browser' };
        }
        const publicKey = await fetchVapidPublicKey();
        const reg = await ensureServiceWorkerReady();
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
            try {
                await existing.unsubscribe();
            } catch (_) {
                /* ignore */
            }
        }
        const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        const data = await saveSubscriptionOnServer(sub);
        const devices =
            data.subscribedDevices ??
            data.schedule?.subscribedDevices ??
            0;
        try {
            global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        if (global.DiariPwaNotifications?.syncPrefsToWorker) {
            void global.DiariPwaNotifications.syncPrefsToWorker();
        }
        return { ok: true, ...data, subscribedDevices: devices };
    }

    async function confirmWebPushWithServerTest() {
        const result = await confirmPushOnThisPhone();
        return !!result.ok;
    }

    async function sendTestPush() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        const res = await apiFetch('/api/push/test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
        });
        return res.json().catch(() => ({}));
    }

    function syncNotificationPrefsToServerBeacon() {
        if (!isPwaStandalone()) return false;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return false;
        }
        const body = JSON.stringify(buildNotificationPrefsPayload());
        try {
            if (navigator.sendBeacon) {
                const blob = new Blob([body], { type: 'application/json' });
                return navigator.sendBeacon('/api/push/preferences', blob);
            }
        } catch (_) {
            /* ignore */
        }
        return false;
    }

    async function syncNotificationPrefsToServer() {
        if (!isPwaStandalone()) return;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return;
        }
        await registerPushForReminders({ quiet: true });
        const body = buildNotificationPrefsPayload();
        try {
            const res = await apiFetch('/api/push/preferences', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.warn('[DiariPwaWebPush] preferences sync failed', data);
            }
            return data;
        } catch (_) {
            syncNotificationPrefsToServerBeacon();
        }
    }

    function isWebPushActive() {
        try {
            return global.localStorage.getItem(WEB_PUSH_ACTIVE_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    function delay(ms) {
        return new Promise((resolve) => global.setTimeout(resolve, ms));
    }

    async function registerThisPhoneOnly() {
        if (!isPwaStandalone()) {
            return {
                ok: false,
                error:
                    'Open DiariCore from your home-screen icon (installed app), not a Chrome tab.',
            };
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return {
                ok: false,
                error:
                    'Notifications blocked. Android Settings → Apps → Chrome → Notifications → Allow.',
            };
        }
        try {
            let data = await syncPushSubscriptionToServer();
            if (!data.ok) {
                data = await renewPushSubscription();
            }
            if (!data.ok) {
                return {
                    ok: false,
                    error: data.error || 'Could not register this phone',
                    schedule: data.schedule,
                    subscribedDevices: data.subscribedDevices,
                };
            }
            return {
                ok: true,
                schedule: data.schedule,
                subscribedDevices: data.subscribedDevices,
                error: null,
            };
        } catch (e) {
            return { ok: false, error: e && e.message ? e.message : 'Could not register this phone' };
        }
    }

    /**
     * Register this device on the server. Does NOT run an immediate test push (that was
     * deleting fresh subscriptions when FCM returned 410 for a few seconds).
     */
    async function confirmPushOnThisPhone() {
        let reg;
        try {
            reg = await registerThisPhoneOnly();
        } catch (e) {
            return { ok: false, error: e && e.message ? e.message : 'Could not register this phone' };
        }
        if (!reg.ok) {
            return { ok: false, error: reg.error || 'Could not register this phone', diagnostics: reg.diagnostics };
        }
        let devices = reg.subscribedDevices;
        if (devices == null && reg.schedule) {
            devices = reg.schedule.subscribedDevices;
        }
        if (devices < 1) {
            await delay(500);
            const status = await fetchScheduleStatus();
            devices = status.subscribedDevices ?? 0;
        }
        if (devices >= 1) {
            try {
                global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            return {
                ok: true,
                subscribedDevices: devices,
                message:
                    'Registered on server (' +
                    devices +
                    ' device). Tap “Test daily nudge now”, then fully close the app.',
            };
        }
        const diag = await runPushDiagnostics();
        return {
            ok: false,
            error: diag.error || 'Server still shows 0 devices after register.',
            diagnostics: diag,
        };
    }

    /** Resolve when DiariPwaWebPush API is available (profile loads this file synchronously). */
    function waitForReady(timeoutMs) {
        const max = timeoutMs || 8000;
        if (global.DiariPwaWebPush) return Promise.resolve(global.DiariPwaWebPush);
        return new Promise(function (resolve, reject) {
            const start = Date.now();
            (function tick() {
                if (global.DiariPwaWebPush) {
                    resolve(global.DiariPwaWebPush);
                    return;
                }
                if (Date.now() - start > max) {
                    reject(new Error('Push module did not load'));
                    return;
                }
                global.setTimeout(tick, 50);
            })();
        });
    }

    global.DiariPwaWebPush = {
        isPwaStandalone,
        isWebPushActive,
        subscribeWebPush,
        registerPushForReminders,
        maintainPushRegistration,
        syncPushSubscriptionToServer,
        renewPushSubscription,
        registerThisPhoneOnly,
        confirmPushOnThisPhone,
        confirmWebPushWithServerTest,
        sendTestPush,
        syncNotificationPrefsToServer,
        syncNotificationPrefsToServerBeacon,
        buildNotificationPrefsPayload,
        getEffectiveReminderHHmm,
        waitForReady,
        runPushDiagnostics,
        ensureServiceWorkerReady,
    };
})(typeof window !== 'undefined' ? window : globalThis);
