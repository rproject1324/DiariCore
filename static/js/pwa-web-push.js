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

    async function fetchVapidPublicKey() {
        const res = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.publicKey) {
            throw new Error(data.error || 'Web Push not available');
        }
        return data.publicKey;
    }

    async function subscribeWebPush() {
        if (!isPwaStandalone()) return false;
        if (!('serviceWorker' in navigator) || !('PushManager' in global)) return false;
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            return false;
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

        const body = {
            subscription: sub.toJSON(),
            keepThisDeviceOnly: true,
            ...buildNotificationPrefsPayload(),
        };
        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Subscribe failed');
        }

        global.dispatchEvent(new CustomEvent('diari-web-push-subscribed'));
        return true;
    }

    async function confirmWebPushWithServerTest() {
        const test = await sendTestPush();
        if (test && test.ok) {
            try {
                global.localStorage.setItem(WEB_PUSH_ACTIVE_KEY, '1');
            } catch (_) {
                /* ignore */
            }
            return true;
        }
        try {
            global.localStorage.removeItem(WEB_PUSH_ACTIVE_KEY);
        } catch (_) {
            /* ignore */
        }
        return false;
    }

    async function sendTestPush() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        const res = await fetch('/api/push/test', {
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
            const res = await fetch('/api/push/preferences', {
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

    async function registerThisPhoneOnly() {
        if (!isPwaStandalone()) return { ok: false, error: 'PWA only' };
        const subscribed = await subscribeWebPush();
        if (!subscribed) return { ok: false, error: 'Could not subscribe this phone' };
        let endpoint = '';
        try {
            const reg = await navigator.serviceWorker.ready;
            const sub = await reg.pushManager.getSubscription();
            endpoint = sub && sub.endpoint ? sub.endpoint : '';
        } catch (_) {
            /* ignore */
        }
        const res = await fetch('/api/push/prune-devices', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint }),
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok && data.success, ...data };
    }

    global.DiariPwaWebPush = {
        isPwaStandalone,
        isWebPushActive,
        subscribeWebPush,
        registerThisPhoneOnly,
        confirmWebPushWithServerTest,
        sendTestPush,
        syncNotificationPrefsToServer,
        syncNotificationPrefsToServerBeacon,
        buildNotificationPrefsPayload,
        getEffectiveReminderHHmm,
    };
})(typeof window !== 'undefined' ? window : globalThis);
