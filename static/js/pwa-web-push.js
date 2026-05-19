/**
 * PWA only: true Web Push (server-sent via VAPID). Works when the app is closed.
 */
(function (global) {
    'use strict';

    const WEB_PUSH_ACTIVE_KEY = 'diariCoreWebPushActive';

    function isPwaStandalone() {
        try {
            if (global.DiariPWA && typeof global.DiariPWA.isStandalone === 'function') {
                return global.DiariPWA.isStandalone();
            }
        } catch (_) {
            /* ignore */
        }
        return (
            (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
            global.navigator.standalone === true
        );
    }

    function urlBase64ToUint8Array(base64String) {
        const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
        const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
        const raw = global.atob(base64);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
        return out;
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
     * Save the browser's current push subscription to Railway without unsubscribing first.
     * Unsubscribing on every open was invalidating FCM tokens (closed-app push then fails).
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
        const reg = await navigator.serviceWorker.ready;
        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
            sub = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey),
            });
        }
        const data = await saveSubscriptionOnServer(sub);
        try {
            global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        if (global.DiariPwaNotifications?.syncPrefsToWorker) {
            void global.DiariPwaNotifications.syncPrefsToWorker();
        }
        global.dispatchEvent(new CustomEvent('diari-web-push-subscribed'));
        return { ok: true, schedule: data.schedule, subscribedDevices: data.schedule?.subscribedDevices };
    }

    async function subscribeWebPush() {
        if (!isPwaStandalone()) return false;
        try {
            const result = await syncPushSubscriptionToServer();
            return !!result.ok;
        } catch (e) {
            console.warn('[DiariPwaWebPush] syncPushSubscriptionToServer failed:', e);
            return false;
        }
    }

    /** Force new FCM token (only when user taps "Use this phone only"). */
    async function renewPushSubscription() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return { ok: false, error: 'Notifications not allowed' };
        }
        const publicKey = await fetchVapidPublicKey();
        const reg = await navigator.serviceWorker.ready;
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
        try {
            global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        if (global.DiariPwaNotifications?.syncPrefsToWorker) {
            void global.DiariPwaNotifications.syncPrefsToWorker();
        }
        return { ok: true, ...data };
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
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        try {
            const data = await renewPushSubscription();
            return {
                ok: !!data.ok,
                schedule: data.schedule,
                error: data.ok ? null : 'Could not register this phone',
            };
        } catch (e) {
            return { ok: false, error: e && e.message ? e.message : 'Could not register this phone' };
        }
    }

    /**
     * Subscribe + prune, then try test push (FCM may need a second after re-subscribe).
     */
    async function confirmPushOnThisPhone() {
        const reg = await registerThisPhoneOnly();
        if (!reg.ok) {
            return { ok: false, error: reg.error || 'Could not register this phone' };
        }
        await delay(2000);
        let test = await sendTestPush();
        if (!test || !test.ok) {
            try {
                const res = await apiFetch('/api/push/send-daily-test', {
                    method: 'POST',
                    credentials: 'same-origin',
                });
                test = await res.json().catch(() => ({}));
            } catch (_) {
                test = {};
            }
        }
        if (test && test.ok) {
            try {
                global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            return { ok: true, tested: true };
        }
        const devices = reg.schedule && reg.schedule.subscribedDevices;
        if (devices >= 1) {
            try {
                global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            return {
                ok: true,
                soft: true,
                message:
                    'This phone is registered for reminders. Tap “Test daily nudge now”, then fully close the app.',
            };
        }
        return {
            ok: false,
            error: (test && test.error) || 'Test push did not send. Check notification permission for Chrome.',
        };
    }

    global.DiariPwaWebPush = {
        isPwaStandalone,
        isWebPushActive,
        subscribeWebPush,
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
    };
})(typeof window !== 'undefined' ? window : globalThis);
