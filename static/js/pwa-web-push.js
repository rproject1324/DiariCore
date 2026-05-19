/**
 * PWA only: true Web Push (server-sent via VAPID). Works when the app is closed.
 */
(function (global) {
    'use strict';

    const WEB_PUSH_ACTIVE_KEY = 'diariCoreWebPushActive';
    const LAST_SAVE_KEY = 'diariCorePushLastSave';
    const PUSH_STATUS_KEY = 'diariCorePushLastStatus';
    const SESSION_REGISTERED_KEY = 'diariPwaPushSessionRegistered';
    const SAVE_DEBOUNCE_MS = 300000;
    const SESSION_WAIT_MS = 45000;

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

    function toKeyBytes(key) {
        if (!key) return null;
        if (key instanceof Uint8Array) return key;
        if (key instanceof ArrayBuffer) return new Uint8Array(key);
        if (key.buffer instanceof ArrayBuffer) {
            return new Uint8Array(key.buffer, key.byteOffset || 0, key.byteLength);
        }
        return null;
    }

    function subscriptionUsesVapidKey(sub, publicKeyB64) {
        if (!sub || !publicKeyB64) return false;
        const rawKey = sub.options && sub.options.applicationServerKey;
        if (!rawKey) return true;
        const appKey = toKeyBytes(rawKey);
        const expected = urlBase64ToUint8Array(publicKeyB64);
        if (!appKey || appKey.byteLength !== expected.byteLength) return false;
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

    function hasLocalLoggedInUser() {
        try {
            const raw = global.localStorage.getItem('diariCoreUser');
            if (!raw) return false;
            const u = JSON.parse(raw);
            if (!u || u.isLoggedIn === false) return false;
            const id = u.id != null ? u.id : u.userId;
            return id != null && id !== '' && Number(id) !== 0;
        } catch (_) {
            return false;
        }
    }

    function writePushStatus(patch) {
        try {
            const prev = JSON.parse(global.localStorage.getItem(PUSH_STATUS_KEY) || '{}');
            global.localStorage.setItem(
                PUSH_STATUS_KEY,
                JSON.stringify(
                    Object.assign({}, prev, patch, { at: new Date().toISOString() })
                )
            );
        } catch (_) {
            /* ignore */
        }
    }

    function clearSessionRegistered() {
        try {
            global.sessionStorage.removeItem(SESSION_REGISTERED_KEY);
        } catch (_) {
            /* ignore */
        }
    }

    async function countServerDevices() {
        try {
            const status = await fetchScheduleStatus();
            if (status && status.success === false) return 0;
            return Number(status.subscribedDevices ?? 0);
        } catch (_) {
            return 0;
        }
    }

    /**
     * Wait until Flask session accepts API calls (subscribe fails with 401 before login cookie exists).
     */
    async function waitForServerSession(timeoutMs) {
        const max = timeoutMs || SESSION_WAIT_MS;
        const start = Date.now();
        while (Date.now() - start < max) {
            if (!hasLocalLoggedInUser()) {
                await delay(400);
                continue;
            }
            try {
                const res = await apiFetch('/api/push/schedule-status', {
                    credentials: 'same-origin',
                });
                if (res.status === 401) {
                    clearSessionRegistered();
                    await delay(600);
                    continue;
                }
                if (res.ok) {
                    return true;
                }
            } catch (_) {
                /* retry */
            }
            await delay(500);
        }
        return false;
    }

    async function postNotificationPrefsToServer() {
        const body = buildNotificationPrefsPayload();
        const res = await apiFetch('/api/push/preferences', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
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
        if (res.status === 401) {
            clearSessionRegistered();
            throw new Error('Please sign in again to register push reminders.');
        }
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Subscribe failed (HTTP ' + res.status + ')');
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

    async function getOrCreatePushSubscription(reg, publicKeyB64, options) {
        const forceRenew = !!(options && options.forceRenew);
        let sub = await reg.pushManager.getSubscription();
        if (sub && forceRenew) {
            try {
                await sub.unsubscribe();
            } catch (_) {
                /* ignore */
            }
            sub = null;
        } else if (sub && !subscriptionUsesVapidKey(sub, publicKeyB64)) {
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

    function readLastSave() {
        try {
            const raw = global.localStorage.getItem(LAST_SAVE_KEY);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    function writeLastSave(endpoint, devices, schedule) {
        try {
            const payload = {
                ep: endpoint,
                at: Date.now(),
                devices: devices,
            };
            if (schedule) payload.schedule = schedule;
            global.localStorage.setItem(LAST_SAVE_KEY, JSON.stringify(payload));
        } catch (_) {
            /* ignore */
        }
    }

    /**
     * Save the browser's current push subscription to Railway without unsubscribing first.
     */
    async function syncPushSubscriptionToServer(options) {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        if (!('serviceWorker' in navigator) || !('PushManager' in global)) {
            return { ok: false, error: 'Push not supported' };
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return { ok: false, error: 'Notifications not allowed' };
        }
        const force = !!(options && options.force);
        const publicKey = await fetchVapidPublicKey();
        const reg = await ensureServiceWorkerReady();
        const sub = await getOrCreatePushSubscription(reg, publicKey, {
            forceRenew: !!(options && options.forceRenew),
        });
        const endpoint = sub && sub.endpoint ? String(sub.endpoint) : '';
        const last = readLastSave();
        const sameEndpoint = endpoint && last && last.ep === endpoint;
        const recentlySaved = sameEndpoint && Date.now() - (last.at || 0) < SAVE_DEBOUNCE_MS;
        if (recentlySaved) {
            const serverDevices = await countServerDevices();
            if (serverDevices >= 1) {
                return {
                    ok: true,
                    skipped: true,
                    subscribedDevices: serverDevices,
                    schedule: last.schedule,
                };
            }
        }
        const data = await saveSubscriptionOnServer(sub);
        const devices =
            data.subscribedDevices ??
            data.schedule?.subscribedDevices ??
            0;
        writeLastSave(endpoint, devices, data.schedule);
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
    let registrationWatchdog = null;

    function startRegistrationWatchdog() {
        if (registrationWatchdog || !isPwaStandalone()) return;
        let ticks = 0;
        registrationWatchdog = global.setInterval(function () {
            ticks += 1;
            if (ticks > 10) {
                global.clearInterval(registrationWatchdog);
                registrationWatchdog = null;
                return;
            }
            try {
                if (global.sessionStorage.getItem(SESSION_REGISTERED_KEY) === '1') {
                    global.clearInterval(registrationWatchdog);
                    registrationWatchdog = null;
                    return;
                }
            } catch (_) {
                /* ignore */
            }
            void ensureServerPushRegistration({
                quiet: true,
                maxAttempts: 2,
                force: false,
            });
        }, 20000);
    }

    /**
     * Classmate-style flow: SW ready → PushManager.subscribe(VAPID) → POST /api/push/subscribe
     * → verify server has ≥1 device (replaces debug-panel “Use this phone only”).
     */
    async function ensureServerPushRegistration(options) {
        const quiet = !options || options.quiet !== false;
        const maxAttempts = (options && options.maxAttempts) || 6;
        const force = !!(options && options.force);
        if (!isPwaStandalone()) {
            writePushStatus({ ok: false, error: 'not_pwa' });
            return { ok: false, error: 'Open DiariCore from your home-screen app, not a browser tab.' };
        }
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            writePushStatus({ ok: false, error: 'permission_denied' });
            return {
                ok: false,
                error: 'Allow notifications for Chrome in Android Settings, then reopen DiariCore.',
            };
        }
        if (!('serviceWorker' in navigator) || !('PushManager' in global)) {
            writePushStatus({ ok: false, error: 'unsupported' });
            return { ok: false, error: 'Push not supported on this browser' };
        }
        if (!hasLocalLoggedInUser()) {
            writePushStatus({ ok: false, error: 'not_logged_in_local' });
            return { ok: false, error: 'Sign in first, then reopen DiariCore from your home screen.' };
        }
        const sessionReady = await waitForServerSession(options && options.sessionWaitMs);
        if (!sessionReady) {
            writePushStatus({ ok: false, error: 'server_session_timeout' });
            startRegistrationWatchdog();
            return {
                ok: false,
                error: 'Could not reach the server while signed in. Check connection and open DiariCore again.',
            };
        }
        let lastError = 'Could not register this phone on the server';
        let lastSchedule = null;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            try {
                const result = await syncPushSubscriptionToServer({
                    force: force || attempt > 0,
                });
                let devices =
                    result.subscribedDevices ??
                    result.schedule?.subscribedDevices ??
                    0;
                if (devices < 1) {
                    devices = await countServerDevices();
                }
                if (result.schedule) {
                    lastSchedule = result.schedule;
                }
                if (result.ok && devices >= 1) {
                    try {
                        await postNotificationPrefsToServer();
                    } catch (prefErr) {
                        if (!quiet) {
                            console.warn('[DiariPwaWebPush] prefs sync after subscribe', prefErr);
                        }
                    }
                    try {
                        global.sessionStorage.setItem(SESSION_REGISTERED_KEY, '1');
                    } catch (_) {
                        /* ignore */
                    }
                    try {
                        global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
                    } catch (_) {
                        /* ignore */
                    }
                    if (global.DiariPwaNotifications?.syncPrefsToWorker) {
                        void global.DiariPwaNotifications.syncPrefsToWorker();
                    }
                    writePushStatus({
                        ok: true,
                        subscribedDevices: devices,
                        reminderTime: buildNotificationPrefsPayload().notifications.reminderTimeOverride,
                        schedule: lastSchedule,
                    });
                    global.dispatchEvent(new CustomEvent('diari-web-push-subscribed'));
                    return { ok: true, subscribedDevices: devices, schedule: result.schedule || lastSchedule };
                }
                if (result && result.error) {
                    lastError = result.error;
                }
            } catch (e) {
                lastError = e && e.message ? e.message : lastError;
                if (!quiet) {
                    console.warn('[DiariPwaWebPush] ensure register attempt', attempt + 1, e);
                }
            }
            await delay(attempt < 2 ? 500 : attempt < 4 ? 900 : 1400);
        }
        try {
            const diag = await runPushDiagnostics();
            if (diag.error) {
                lastError = diag.error;
            }
            writePushStatus({
                ok: false,
                error: lastError,
                diagnostics: diag,
            });
        } catch (_) {
            writePushStatus({ ok: false, error: lastError });
        }
        startRegistrationWatchdog();
        return { ok: false, error: lastError, schedule: lastSchedule };
    }

    async function registerPushForReminders(options) {
        return ensureServerPushRegistration(options);
    }

    /**
     * Re-register this device when the PWA opens or returns to foreground (debounced).
     */
    async function maintainPushRegistration(options) {
        const force = !!(options && options.force);
        let sessionNeedsRegister = false;
        try {
            sessionNeedsRegister =
                global.sessionStorage.getItem(SESSION_REGISTERED_KEY) !== '1';
        } catch (_) {
            sessionNeedsRegister = true;
        }
        const now = Date.now();
        if (!force && !sessionNeedsRegister && now - lastMaintainAttemptMs < 300000) {
            return { ok: true, skipped: true };
        }
        if (maintainInFlight) {
            return maintainInFlight;
        }
        lastMaintainAttemptMs = now;
        maintainInFlight = ensureServerPushRegistration({
            quiet: true,
            maxAttempts: force || sessionNeedsRegister ? 6 : 3,
            force: force || sessionNeedsRegister,
        })
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
        function onAuthOrSyncReady() {
            if (!isPwaStandalone()) return;
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
                return;
            }
            void ensureServerPushRegistration({ force: true, maxAttempts: 5, quiet: true });
        }
        global.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') {
                void maintainPushRegistration();
            } else if (global.DiariPwaWebPush?.syncNotificationPrefsToServerBeacon) {
                syncNotificationPrefsToServerBeacon();
            }
        });
        global.addEventListener('online', function () {
            void maintainPushRegistration({ force: true });
        });
        global.addEventListener('pagehide', function () {
            if (global.DiariPwaWebPush?.syncNotificationPrefsToServerBeacon) {
                syncNotificationPrefsToServerBeacon();
            }
        });
        global.addEventListener('storage', function (e) {
            if (e.key === 'diariCoreUser') {
                if (!e.newValue) {
                    clearSessionRegistered();
                    return;
                }
                onAuthOrSyncReady();
            }
        });
        ['diari-user-updated', 'diari-offline-sync-complete', 'diari-remote-state-refreshed'].forEach(
            function (name) {
                global.addEventListener(name, onAuthOrSyncReady);
            }
        );
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

    /** PWA console helper: register device + send real daily-style test push. */
    async function runClosedAppPushSelfCheck() {
        const reg = await ensureServerPushRegistration({
            force: true,
            maxAttempts: 6,
            quiet: false,
        });
        if (!reg.ok) {
            return { ok: false, step: 'register', register: reg };
        }
        const res = await apiFetch('/api/push/send-daily-test', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
        });
        const test = await res.json().catch(() => ({}));
        writePushStatus({ ok: !!test.ok, selfCheck: true, register: reg, test: test });
        return { ok: !!test.ok, register: reg, test: test };
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
        let registered = false;
        try {
            registered = global.sessionStorage.getItem(SESSION_REGISTERED_KEY) === '1';
        } catch (_) {
            registered = false;
        }
        if (!registered) {
            await ensureServerPushRegistration({ quiet: true, maxAttempts: 4, force: true });
        }
        try {
            const data = await postNotificationPrefsToServer();
            writePushStatus({
                ok: registered || (await countServerDevices()) >= 1,
                prefsSynced: true,
                reminderTime: buildNotificationPrefsPayload().notifications.reminderTimeOverride,
            });
            return data;
        } catch (_) {
            syncNotificationPrefsToServerBeacon();
        }
    }

    function getPushLastStatus() {
        try {
            return JSON.parse(global.localStorage.getItem(PUSH_STATUS_KEY) || 'null');
        } catch (_) {
            return null;
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
        ensureServerPushRegistration,
        waitForServerSession,
        getPushLastStatus,
        startRegistrationWatchdog,
        maintainPushRegistration,
        syncPushSubscriptionToServer,
        renewPushSubscription,
        registerThisPhoneOnly,
        confirmPushOnThisPhone,
        confirmWebPushWithServerTest,
        sendTestPush,
        runClosedAppPushSelfCheck,
        syncNotificationPrefsToServer,
        syncNotificationPrefsToServerBeacon,
        buildNotificationPrefsPayload,
        getEffectiveReminderHHmm,
        waitForReady,
        runPushDiagnostics,
        ensureServiceWorkerReady,
    };
})(typeof window !== 'undefined' ? window : globalThis);
