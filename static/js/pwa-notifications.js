/**
 * PWA-only local notifications: daily journal reminders + insight follow-ups.
 * Works offline (prefs + entries from localStorage → IndexedDB for the service worker).
 */
(function (global) {
    'use strict';

    const REMINDER_OVERRIDE_KEY = 'diariCoreReminderTimeUserOverride';
    const DAILY_ENABLED_KEY = 'diariCorePwaDailyRemindersEnabled';
    const INSIGHT_ENABLED_KEY = 'diariCorePwaInsightFollowupsEnabled';
    const STREAK_ENABLED_KEY = 'diariCorePwaStreakRemindersEnabled';
    const PERMISSION_ASKED_KEY = 'diariCorePwaNotificationsPermissionAsked';

    const NOTIFY_TZ = 'Asia/Manila';
    let schedulerTimer = null;
    let started = false;

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
        return global.navigator?.standalone === true;
    }

    function readEntries() {
        try {
            const raw = global.localStorage.getItem('diariCoreEntries');
            const arr = JSON.parse(raw || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch (_) {
            return [];
        }
    }

    function computeSuggestedReminderHHmm() {
        const MAT = global.DiariMostActiveTime;
        const entries = readEntries().filter((e) => e && e.date);
        if (!MAT || typeof MAT.computeMostActiveHour24FromEntries !== 'function') {
            return '09:00';
        }
        const peak = MAT.computeMostActiveHour24FromEntries(entries);
        const t = MAT.hour24ToTimeInputValue(peak);
        return t || '09:00';
    }

    /** Profile override wins; else Consistency “most active” default. */
    function getEffectiveReminderHHmm() {
        try {
            const v = global.localStorage.getItem(REMINDER_OVERRIDE_KEY);
            if (v && /^\d{2}:\d{2}$/.test(v.trim())) return v.trim();
        } catch (_) {
            /* ignore */
        }
        return computeSuggestedReminderHHmm();
    }

    function isDailyRemindersEnabled() {
        try {
            const v = global.localStorage.getItem(DAILY_ENABLED_KEY);
            if (v === '0' || v === 'false') return false;
            return true;
        } catch (_) {
            return true;
        }
    }

    function isInsightFollowupsEnabled() {
        try {
            const v = global.localStorage.getItem(INSIGHT_ENABLED_KEY);
            if (v === '0' || v === 'false') return false;
            return true;
        } catch (_) {
            return true;
        }
    }

    function isStreakRemindersEnabled() {
        try {
            const v = global.localStorage.getItem(STREAK_ENABLED_KEY);
            if (v === '0' || v === 'false') return false;
            return true;
        } catch (_) {
            return true;
        }
    }

    function setDailyRemindersEnabled(on) {
        try {
            global.localStorage.setItem(DAILY_ENABLED_KEY, on ? '1' : '0');
        } catch (_) {
            /* ignore */
        }
    }

    function setInsightFollowupsEnabled(on) {
        try {
            global.localStorage.setItem(INSIGHT_ENABLED_KEY, on ? '1' : '0');
        } catch (_) {
            /* ignore */
        }
    }

    function readPrefsSnapshotFromStorage() {
        let lastDaily = '';
        let lastInsightId = '';
        let lastInsightDate = '';
        let lastStreak1hr = '';
        let lastStreak30min = '';
        try {
            lastDaily = global.localStorage.getItem('diariCorePwaLastDailyReminderDateKey') || '';
            lastInsightId = global.localStorage.getItem('diariCorePwaLastInsightEntryId') || '';
            lastInsightDate = global.localStorage.getItem('diariCorePwaLastInsightDateKey') || '';
            lastStreak1hr = global.localStorage.getItem('diariCorePwaLastStreak1hrDateKey') || '';
            lastStreak30min = global.localStorage.getItem('diariCorePwaLastStreak30minDateKey') || '';
        } catch (_) {
            /* ignore */
        }
        let webPushActive = false;
        try {
            webPushActive = global.localStorage.getItem('diariCoreWebPushActive') === '1';
        } catch (_) {
            /* ignore */
        }
        return {
            pwaOnly: true,
            webPushActive,
            permission:
                typeof Notification !== 'undefined' && Notification.permission
                    ? Notification.permission
                    : 'default',
            dailyRemindersEnabled: isDailyRemindersEnabled(),
            insightFollowupsEnabled: isInsightFollowupsEnabled(),
            streakRemindersEnabled: isStreakRemindersEnabled(),
            reminderHHmm: getEffectiveReminderHHmm(),
            entries: readEntries(),
            lastDailyReminderDateKey: lastDaily,
            lastInsightEntryId: lastInsightId,
            lastInsightDateKey: lastInsightDate,
            lastStreak1hrDateKey: lastStreak1hr,
            lastStreak30minDateKey: lastStreak30min,
            updatedAt: new Date().toISOString(),
        };
    }

    async function syncPrefsToWorker() {
        if (!isPwaStandalone()) return false;
        const idb = global.DiariPwaNotificationIdb;
        if (!idb || typeof idb.writePrefs !== 'function') return false;
        const prefs = readPrefsSnapshotFromStorage();
        try {
            const existing = await idb.readPrefs();
            if (existing && typeof existing === 'object') {
                if (existing.lastDailyReminderDateKey) {
                    prefs.lastDailyReminderDateKey = existing.lastDailyReminderDateKey;
                }
                if (existing.lastInsightEntryId) {
                    prefs.lastInsightEntryId = existing.lastInsightEntryId;
                }
                if (existing.lastInsightDateKey) {
                    prefs.lastInsightDateKey = existing.lastInsightDateKey;
                }
                if (existing.lastStreak1hrDateKey) {
                    prefs.lastStreak1hrDateKey = existing.lastStreak1hrDateKey;
                }
                if (existing.lastStreak30minDateKey) {
                    prefs.lastStreak30minDateKey = existing.lastStreak30minDateKey;
                }
            }
            await idb.writePrefs(prefs);
            try {
                if (prefs.lastDailyReminderDateKey) {
                    global.localStorage.setItem(
                        'diariCorePwaLastDailyReminderDateKey',
                        prefs.lastDailyReminderDateKey
                    );
                }
                if (prefs.lastInsightEntryId) {
                    global.localStorage.setItem('diariCorePwaLastInsightEntryId', prefs.lastInsightEntryId);
                }
                if (prefs.lastInsightDateKey) {
                    global.localStorage.setItem('diariCorePwaLastInsightDateKey', prefs.lastInsightDateKey);
                }
                if (prefs.lastStreak1hrDateKey) {
                    global.localStorage.setItem('diariCorePwaLastStreak1hrDateKey', prefs.lastStreak1hrDateKey);
                }
                if (prefs.lastStreak30minDateKey) {
                    global.localStorage.setItem('diariCorePwaLastStreak30minDateKey', prefs.lastStreak30minDateKey);
                }
            } catch (_) {
                /* ignore */
            }
        } catch (e) {
            console.warn('[DiariPwaNotifications] IDB write failed:', e);
            return false;
        }
        try {
            const reg = await navigator.serviceWorker?.ready;
            reg?.active?.postMessage({ type: 'DIARI_PWA_CHECK_NOTIFICATIONS' });
        } catch (_) {
            /* ignore */
        }
        return true;
    }

    async function requestPermissionIfNeeded() {
        if (!isPwaStandalone() || typeof Notification === 'undefined') {
            return 'denied';
        }
        if (Notification.permission === 'granted') return 'granted';
        if (Notification.permission === 'denied') return 'denied';
        try {
            global.localStorage.setItem(PERMISSION_ASKED_KEY, '1');
        } catch (_) {
            /* ignore */
        }
        const result = await Notification.requestPermission();
        await syncPrefsToWorker();
        if (result === 'granted' && global.DiariPwaWebPush?.subscribeWebPush) {
            try {
                await global.DiariPwaWebPush.subscribeWebPush();
                if (global.DiariPwaWebPush?.confirmWebPushWithServerTest) {
                    const ok = await global.DiariPwaWebPush.confirmWebPushWithServerTest();
                    if (!ok) {
                        console.warn(
                            '[DiariPwa] Server push not confirmed — local reminders stay active as backup.'
                        );
                    }
                }
            } catch (e) {
                console.warn('[DiariPwaNotifications] Web Push subscribe failed:', e);
            }
        }
        return result;
    }

    async function registerBackgroundChecks() {
        if (!isPwaStandalone() || !('serviceWorker' in navigator)) return;
        try {
            const reg = await navigator.serviceWorker.ready;
            if ('periodicSync' in reg) {
                try {
                    await reg.periodicSync.register('diari-pwa-notification-check', {
                        minInterval: 60 * 60 * 1000,
                    });
                } catch (_) {
                    /* permission or unsupported */
                }
            }
            if ('sync' in reg) {
                try {
                    await reg.sync.register('diari-pwa-notification-check');
                } catch (_) {
                    /* ignore */
                }
            }
        } catch (_) {
            /* ignore */
        }
    }

    function kickWorkerCheck() {
        if (!isPwaStandalone()) return;
        syncPrefsToWorker();
        navigator.serviceWorker?.ready
            ?.then((reg) => reg.active?.postMessage({ type: 'DIARI_PWA_CHECK_NOTIFICATIONS' }))
            .catch(() => {});
    }

    function bindLifecycle() {
        if (navigator.serviceWorker) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                if (event.data && event.data.type === 'DIARI_PUSH_SUBSCRIPTION_CHANGE') {
                    if (global.DiariPwaWebPush?.subscribeWebPush) {
                        void global.DiariPwaWebPush.subscribeWebPush();
                    }
                }
            });
        }
        global.addEventListener('diari-entries-cache-updated', () => kickWorkerCheck());
        global.addEventListener('diari-remote-state-refreshed', () => kickWorkerCheck());
        global.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                kickWorkerCheck();
            } else if (global.DiariPwaWebPush?.syncNotificationPrefsToServerBeacon) {
                global.DiariPwaWebPush.syncNotificationPrefsToServerBeacon();
            }
        });
        global.addEventListener('pagehide', () => {
            if (global.DiariPwaWebPush?.syncNotificationPrefsToServerBeacon) {
                global.DiariPwaWebPush.syncNotificationPrefsToServerBeacon();
            }
        });
        global.addEventListener('online', () => kickWorkerCheck());
    }

    function startScheduler() {
        if (started || !isPwaStandalone()) return;
        started = true;
        bindLifecycle();
        void (async () => {
            await syncPrefsToWorker();
            await registerBackgroundChecks();
            kickWorkerCheck();
        })();
        if (schedulerTimer) global.clearInterval(schedulerTimer);
        schedulerTimer = global.setInterval(() => kickWorkerCheck(), 60 * 1000);
    }

    function stopScheduler() {
        if (schedulerTimer) {
            global.clearInterval(schedulerTimer);
            schedulerTimer = null;
        }
        started = false;
    }

    function hydrateProfileNotificationUi() {
        if (!isPwaStandalone()) return;
        const dailyToggle = document.getElementById('toggleDailyReminders');
        if (dailyToggle) {
            dailyToggle.checked = isDailyRemindersEnabled();
            if (dailyToggle.dataset.pwaNotifyBound !== '1') {
                dailyToggle.dataset.pwaNotifyBound = '1';
                dailyToggle.addEventListener('change', async () => {
                    setDailyRemindersEnabled(dailyToggle.checked);
                    if (dailyToggle.checked) await requestPermissionIfNeeded();
                    await syncPrefsToWorker();
                    if (global.DiariPwaWebPush?.syncNotificationPrefsToServer) {
                        void global.DiariPwaWebPush.syncNotificationPrefsToServer();
                    }
                });
            }
        }
        const timeInput = document.getElementById('profileReminderTimeInput');
        if (timeInput) {
            timeInput.value = getEffectiveReminderHHmm();
            if (timeInput.dataset.pwaNotifyTimeBound !== '1') {
                timeInput.dataset.pwaNotifyTimeBound = '1';
                timeInput.addEventListener('change', () => {
                    try {
                        const v = timeInput.value;
                        if (v && /^\d{2}:\d{2}$/.test(v)) {
                            global.localStorage.setItem(REMINDER_OVERRIDE_KEY, v);
                        }
                    } catch (_) {
                        /* ignore */
                    }
                    void syncPrefsToWorker();
                    if (global.DiariPwaWebPush?.syncNotificationPrefsToServer) {
                        void global.DiariPwaWebPush.syncNotificationPrefsToServer();
                    }
                });
            }
        }
    }

    function markNonPwaNotificationUi() {
        const card = document.querySelector('.profile-prefs-card--notifications');
        if (!card || isPwaStandalone()) return;
        if (card.querySelector('.pwa-notifications-browser-note')) return;
        const note = document.createElement('p');
        note.className = 'pwa-notifications-browser-note';
        note.textContent =
            'Push reminders are available in the installed DiariCore app (PWA) only, not in the browser tab.';
        const section = card.querySelector('.notifications-section');
        if (section) section.prepend(note);
        card.querySelectorAll('.notifications-control input').forEach((el) => {
            el.disabled = true;
        });
    }

    function init() {
        if (!isPwaStandalone()) {
            markNonPwaNotificationUi();
            return;
        }
        document.documentElement.classList.add('diari-pwa-standalone');
        hydrateProfileNotificationUi();
        void (async () => {
            const asked = global.localStorage.getItem(PERMISSION_ASKED_KEY);
            if (isDailyRemindersEnabled() && !asked && Notification?.permission === 'default') {
                await requestPermissionIfNeeded();
            } else if (
                Notification?.permission === 'granted' &&
                global.DiariPwaWebPush?.syncPushSubscriptionToServer
            ) {
                try {
                    await global.DiariPwaWebPush.syncPushSubscriptionToServer();
                } catch (e) {
                    console.warn('[DiariPwaNotifications] sync push to server failed:', e);
                }
            }
            if (global.DiariPwaWebPush?.syncNotificationPrefsToServer) {
                void global.DiariPwaWebPush.syncNotificationPrefsToServer();
            }
            startScheduler();
        })();
    }

    global.DiariPwaNotifications = {
        isPwaStandalone,
        getEffectiveReminderHHmm,
        computeSuggestedReminderHHmm,
        isDailyRemindersEnabled,
        setDailyRemindersEnabled,
        isInsightFollowupsEnabled,
        setInsightFollowupsEnabled,
        isStreakRemindersEnabled,
        requestPermissionIfNeeded,
        syncPrefsToWorker,
        startScheduler,
        stopScheduler,
        hydrateProfileNotificationUi,
        NOTIFY_TZ,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
