/**
 * DiariCore offline layer: cached entries, sync queues, local emotion analysis, auth guard.
 */
(function () {
    'use strict';

    /** IIFE must not rely on an outer `global` binding — pass window explicitly. */
    const global = typeof window !== 'undefined' ? window : globalThis;

    const ENTRIES_KEY = 'diariCoreEntries';
    const ENTRIES_OWNER_KEY = 'diariCoreEntriesOwnerId';
    const USER_KEY = 'diariCoreUser';
    const TAG_QUEUE_KEY = 'diariCoreTagSyncQueue';
    const ENTRY_EDIT_QUEUE_KEY = 'diariCoreEntryEditQueue';
    const PENDING_ENTRIES_DB = 'diariCoreOfflineMedia';
    const PENDING_ENTRIES_STORE = 'pendingEntries';
    const ENTRY_EDIT_MEDIA_DB = 'diariCoreOfflineEntryEditMedia';
    const ENTRY_EDIT_MEDIA_STORE = 'records';
    /** Fallback when write-entry saves without IDB (same key as write-entry.js). */
    const OFFLINE_CREATE_QUEUE_LS = 'diariCoreOfflineCreateQueue';
    const ENTRY_DELETE_QUEUE_KEY = 'diariCoreEntryDeleteQueue';
    const PWA_PENDING_PROFILE_KEY = 'diariCorePwaPendingProfile';
    const PWA_PENDING_UI_PREFS_KEY = 'diariCorePwaPendingUiPrefs';
    const PWA_PENDING_AVATAR_KEY = 'diariCorePwaPendingAvatar';
    const SYNC_REV_KEY = 'diariCoreSyncRevision';

    const PUBLIC_PAGES = new Set([
        'login.html',
        'register.html',
        'verify-registration.html',
        'index.html',
        '',
    ]);

    function isOnline() {
        return global.navigator.onLine !== false;
    }

    function isPwaStandalone() {
        try {
            if (global.DiariPWA && typeof global.DiariPWA.isStandalone === 'function') {
                return global.DiariPWA.isStandalone();
            }
        } catch (_) {
            /* ignore */
        }
        return (
            (global.document &&
                global.document.documentElement.classList.contains('diari-pwa-standalone')) ||
            (global.matchMedia && global.matchMedia('(display-mode: standalone)').matches) ||
            (global.navigator && global.navigator.standalone === true)
        );
    }

    /**
     * Live network check — must hit /api (never served from SW precache).
     * Do NOT use /diariclogo.png: the service worker returns cached 200 while offline.
     */
    async function probeReachability() {
        if (!isOnline()) return false;
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        const probeOpts = {
            method: 'GET',
            cache: 'no-store',
            credentials: 'same-origin',
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        };

        async function tryUrl(url) {
            const ctrl = new AbortController();
            const timer = global.setTimeout(() => ctrl.abort(), 8000);
            try {
                const res = await fetchFn(url, { ...probeOpts, signal: ctrl.signal });
                global.clearTimeout(timer);
                if (!res.ok) return false;
                if (url.includes('/api/health')) {
                    const data = await res.json().catch(() => ({}));
                    return data && data.ok === true;
                }
                return true;
            } catch {
                global.clearTimeout(timer);
                return false;
            }
        }

        if (await tryUrl('/api/health?dcReach=' + Date.now())) return true;
        const userId = getUserId();
        if (userId && (await tryUrl('/api/entries?dcReach=' + Date.now() + '&userId=' + encodeURIComponent(String(userId))))) {
            return true;
        }
        return false;
    }

    /**
     * True when the entry should be saved locally (PWA airplane mode, offline events, or no network).
     */
    async function shouldSaveEntryOffline() {
        if (!isPwaUiContext()) return false;
        if (!isOnline()) return true;
        return !(await probeReachability());
    }

    function getSessionUser() {
        try {
            return JSON.parse(global.localStorage.getItem(USER_KEY) || 'null');
        } catch {
            return null;
        }
    }

    function getUserId() {
        const user = getSessionUser();
        if (!user) return 0;
        if (user.isLoggedIn === false) return 0;
        const raw = user.id ?? user.userId ?? 0;
        const n = Number(raw);
        return Number.isInteger(n) && n > 0 ? n : 0;
    }

    function readEntriesCache() {
        try {
            const raw = global.localStorage.getItem(ENTRIES_KEY);
            const arr = JSON.parse(raw || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function stripDataUrlsFromEntry(entry) {
        if (!entry || typeof entry !== 'object') return entry;
        const imageUrls = (entry.imageUrls || []).map((u) => {
            const s = String(u || '');
            return s.startsWith('data:') ? '' : s;
        }).filter(Boolean);
        return { ...entry, imageUrls };
    }

    function stripEntriesListForStorage(entries) {
        return (entries || []).map((e) => stripDataUrlsFromEntry(e));
    }

    function storageErrorMessage(err) {
        const name = err && err.name ? String(err.name) : '';
        if (name === 'QuotaExceededError') {
            return 'Browser app storage is full (not your phone storage). We trimmed photos from cache — try again.';
        }
        return (err && err.message) || 'Could not write to browser storage';
    }

    function writeEntriesCache(entries, userId, options) {
        try {
            const nextJson = JSON.stringify(entries);
            const prevJson = global.localStorage.getItem(ENTRIES_KEY);
            global.localStorage.setItem(ENTRIES_KEY, nextJson);
            if (userId) global.localStorage.setItem(ENTRIES_OWNER_KEY, String(userId));
            const forceNotify = options && options.forceNotify === true;
            if (forceNotify || prevJson !== nextJson) {
                try {
                    global.dispatchEvent(new CustomEvent('diari-entries-cache-updated'));
                } catch (_) {
                    /* ignore */
                }
            }
            return true;
        } catch (e) {
            console.warn('[DiariOffline] Failed to write entries cache:', e);
            return false;
        }
    }

    function mergeServerUserIntoLocal(serverUser, options = {}) {
        if (!serverUser || typeof serverUser !== 'object') return false;
        const prev = getSessionUser() || {};
        const remoteWins = options.remoteWins === true;
        const hasPending =
            hasPwaPendingProfile() || hasPwaPendingAvatar() || hasPwaPendingUiPrefs();

        let merged = Object.assign({}, prev, serverUser, {
            isLoggedIn: prev.isLoggedIn !== false,
            loginTime: prev.loginTime || null,
            id: serverUser.id ?? prev.id,
            userId: serverUser.id ?? prev.userId ?? prev.id,
        });

        const forceRemote = options.forceRemote === true;
        const applyServerOnly = forceRemote || (remoteWins && !hasPending);

        if (!applyServerOnly) {
            if (hasPwaPendingAvatar()) {
                const pendingAv = readPwaPendingAvatar();
                if (pendingAv) merged.avatarDataUrl = pendingAv;
            }
            if (hasPwaPendingUiPrefs()) {
                const prefs = readPwaPendingUiPrefs();
                if (prefs && prefs.uiTheme) merged.uiTheme = prefs.uiTheme;
                if (prefs && prefs.uiPaletteId) merged.uiPaletteId = prefs.uiPaletteId;
            }
            if (hasPwaPendingProfile()) {
                const pending = readPwaPendingProfile();
                if (pending && typeof pending === 'object') {
                    Object.assign(merged, pending);
                }
            }
        }

        const prevJson = JSON.stringify(prev);
        const nextJson = JSON.stringify(merged);
        const changed = prevJson !== nextJson;
        global.localStorage.setItem(USER_KEY, nextJson);
        try {
            if (global.DiariTheme && typeof global.DiariTheme.applyFromUser === 'function') {
                global.DiariTheme.applyFromUser(merged);
            }
        } catch (_) {
            /* ignore */
        }
        if (changed || forceRemote) {
            try {
                global.dispatchEvent(new CustomEvent('diari-user-updated', { bubbles: true }));
            } catch (_) {
                /* ignore */
            }
        }
        return changed;
    }

    function isOfflineLocalEntry(entry) {
        if (!entry) return false;
        if (entry.pwaDeletionPending === true) return true;
        if (entry.pwaEditPending === true) return true;
        const id = String(entry.id ?? '');
        if (id.startsWith('offline_')) return true;
        return entry.pendingServerAnalysis === true || entry.moodScoringOffline === true;
    }

    async function shouldActOffline() {
        if (!isPwaUiContext()) return false;
        if (!isOnline()) return true;
        return !(await probeReachability());
    }

    function isPwaUiContext() {
        if (isPwaStandalone()) return true;
        const el = global.document && global.document.documentElement;
        if (!el) return false;
        if (el.classList.contains('diari-pwa-standalone')) return true;
        if (el.getAttribute('data-diari-pwa') === 'standalone') return true;
        return false;
    }

    function ensurePwaDocumentMarkers() {
        if (!isPwaUiContext()) return;
        const el = global.document && global.document.documentElement;
        if (!el) return;
        el.classList.add('diari-pwa-standalone');
        el.setAttribute('data-diari-pwa', 'standalone');
    }

    /** PWA installed app with no network (airplane mode) — not “server unreachable” while online. */
    function isPwaOfflineNow() {
        return isPwaUiContext() && !isOnline();
    }

    function shouldShowEntryEditPendingPill(entry) {
        return Boolean(entry && entry.pwaEditPending === true && !isOnline());
    }

    function getEntrySyncLabel(entry) {
        if (!isPwaUiContext() || !entry) return null;
        if (entry.pwaDeletionPending === true) {
            return { text: 'Deletion Pending', kind: 'delete' };
        }
        if (shouldShowEntryEditPendingPill(entry)) {
            return { text: 'Edit Pending', kind: 'edit' };
        }
        const id = String(entry.id ?? '');
        const engine = String(entry.engine || '').toLowerCase();
        if (
            id.startsWith('offline_') ||
            entry.pendingServerAnalysis === true ||
            entry.moodScoringOffline === true ||
            engine === 'offline-estimate' ||
            engine === 'offline-local'
        ) {
            return { text: 'Pending', kind: 'pending' };
        }
        return null;
    }

    function readDeleteQueue() {
        try {
            const arr = JSON.parse(global.localStorage.getItem(ENTRY_DELETE_QUEUE_KEY) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeDeleteQueue(rows) {
        global.localStorage.setItem(ENTRY_DELETE_QUEUE_KEY, JSON.stringify(rows));
    }

    function findEntryIndexInCache(list, entryKey) {
        const key = String(entryKey ?? '');
        return list.findIndex((e) => String(e?.id ?? '') === key);
    }

    function markEntryEditPendingInCache(entryKey, patch, userId, fallbackEntry) {
        const key = String(entryKey ?? '');
        const list = readEntriesCache();
        let idx = findEntryIndexInCache(list, key);
        if (idx < 0 && fallbackEntry) {
            list.push({
                ...fallbackEntry,
                id: key || fallbackEntry.id,
            });
            idx = list.length - 1;
        }
        if (idx < 0) return null;
        list[idx] = {
            ...list[idx],
            ...(patch || {}),
            id: key || list[idx].id,
            pwaEditPending: true,
            pwaDeletionPending: false,
            pwaShowEdited: false,
        };
        writeEntriesCache(list, userId);
        return list[idx];
    }

    function upsertEditQueueRecord(record) {
        const key = String(record?.entryId ?? '');
        const q = readEditQueue().filter((row) => String(row?.entryId ?? '') !== key);
        q.push(record);
        writeEditQueue(q);
    }

    function removeEditQueueForEntry(entryKey) {
        const key = String(entryKey ?? '');
        const q = readEditQueue().filter((row) => String(row?.entryId ?? '') !== key);
        writeEditQueue(q);
    }

    function coalesceEditQueueLatest() {
        const q = readEditQueue();
        if (!q.length) return [];
        const byId = new Map();
        for (const row of q) {
            const key = String(row?.entryId ?? '');
            if (!key) continue;
            const prev = byId.get(key);
            if (!prev) {
                byId.set(key, row);
                continue;
            }
            const ta = new Date(row.queuedAt || 0).getTime();
            const tb = new Date(prev.queuedAt || 0).getTime();
            byId.set(key, ta >= tb ? row : prev);
        }
        return Array.from(byId.values());
    }

    async function removePendingCreateByLocalEntryId(localEntryId) {
        const key = String(localEntryId ?? '');
        if (!key) return;
        const ls = readOfflineCreateQueueLs();
        writeOfflineCreateQueueLs(ls.filter((r) => String(r.localEntryId || '') !== key));

        try {
            const pending = await pendingEntriesGetAll();
            for (const row of pending) {
                if (String(row.localEntryId || '') === key) {
                    await pendingEntryDelete(row.id);
                }
            }
        } catch (e) {
            console.warn('[DiariOffline] Could not trim create queue:', e);
        }
    }

    async function markEntryDeletionPending(entryKey, userId, fallbackEntry) {
        const key = String(entryKey ?? '');
        const list = readEntriesCache();
        let idx = findEntryIndexInCache(list, key);
        if (idx < 0 && fallbackEntry) {
            list.push({
                ...fallbackEntry,
                id: key || fallbackEntry.id,
                pwaDeletionPending: true,
                pwaEditPending: false,
            });
            writeEntriesCache(list, userId);
            idx = list.length - 1;
        }
        if (idx < 0) return false;

        list[idx] = {
            ...list[idx],
            pwaDeletionPending: true,
            pwaEditPending: false,
        };
        writeEntriesCache(list, userId);

        const q = readDeleteQueue();
        if (!q.some((row) => String(row.entryKey) === key)) {
            q.push({
                entryKey: key,
                userId,
                localOnly: key.startsWith('offline_'),
                queuedAt: new Date().toISOString(),
            });
            writeDeleteQueue(q);
        }

        if (key.startsWith('offline_')) {
            await removePendingCreateByLocalEntryId(key);
            const editQ = readEditQueue().filter((row) => String(row.entryId) !== key);
            writeEditQueue(editQ);
        }
        return true;
    }

    async function flushPendingEntryDeletes() {
        if (!isPwaUiContext()) return;
        const userId = getUserId();
        if (!userId) return;

        const q = readDeleteQueue();
        if (!q.length) return;

        const remaining = [];
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;

        for (const row of q) {
            const key = String(row.entryKey || '');
            try {
                if (row.localOnly || key.startsWith('offline_')) {
                    const list = readEntriesCache().filter((e) => String(e?.id) !== key);
                    writeEntriesCache(list, userId);
                    continue;
                }
                const numericId = Number(key);
                if (!Number.isInteger(numericId) || numericId <= 0) {
                    continue;
                }
                const res = await fetchFn(`/api/entries/${numericId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: row.userId || userId }),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data?.success) {
                    throw new Error(data?.error || 'Delete sync failed');
                }
                const list = readEntriesCache().filter((e) => String(e?.id) !== key);
                writeEntriesCache(list, userId);
            } catch (e) {
                console.warn('[DiariOffline] Pending delete sync failed:', key, e);
                remaining.push(row);
            }
        }
        writeDeleteQueue(remaining);
    }

    function hasQueuedEditForEntry(entryKey) {
        const key = String(entryKey ?? '');
        return readEditQueue().some((r) => String(r?.entryId ?? '') === key);
    }

    function hasQueuedDeleteForEntry(entryKey) {
        const key = String(entryKey ?? '');
        return readDeleteQueue().some((r) => String(r?.entryId ?? '') === key);
    }

    function readPwaPendingProfile() {
        try {
            const raw = global.localStorage.getItem(PWA_PENDING_PROFILE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function writePwaPendingProfile(patch) {
        if (!patch || typeof patch !== 'object') {
            global.localStorage.removeItem(PWA_PENDING_PROFILE_KEY);
            return;
        }
        global.localStorage.setItem(PWA_PENDING_PROFILE_KEY, JSON.stringify(patch));
    }

    function hasPwaPendingProfile() {
        const p = readPwaPendingProfile();
        return !!(p && typeof p === 'object' && Object.keys(p).length > 0);
    }

    function readPwaPendingUiPrefs() {
        try {
            const raw = global.localStorage.getItem(PWA_PENDING_UI_PREFS_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    function writePwaPendingUiPrefs(prefs) {
        if (!prefs || typeof prefs !== 'object') {
            global.localStorage.removeItem(PWA_PENDING_UI_PREFS_KEY);
            return;
        }
        global.localStorage.setItem(PWA_PENDING_UI_PREFS_KEY, JSON.stringify(prefs));
    }

    function hasPwaPendingUiPrefs() {
        const p = readPwaPendingUiPrefs();
        return !!(p && (p.uiTheme || p.uiPaletteId));
    }

    function readPwaPendingAvatar() {
        try {
            const raw = global.localStorage.getItem(PWA_PENDING_AVATAR_KEY);
            return raw && String(raw).trim() ? String(raw).trim() : '';
        } catch {
            return '';
        }
    }

    function writePwaPendingAvatar(dataUrl) {
        if (!dataUrl || !String(dataUrl).trim()) {
            global.localStorage.removeItem(PWA_PENDING_AVATAR_KEY);
            return;
        }
        global.localStorage.setItem(PWA_PENDING_AVATAR_KEY, String(dataUrl).trim());
    }

    function hasPwaPendingAvatar() {
        return readPwaPendingAvatar().length > 0;
    }

    function savePwaAvatarPending(avatarDataUrl) {
        if (!isPwaUiContext() || !avatarDataUrl) return;
        writePwaPendingAvatar(avatarDataUrl);
        mergePwaProfileIntoUser({ avatarDataUrl: String(avatarDataUrl).trim() });
    }

    function mergePwaProfileIntoUser(patch) {
        if (!patch || typeof patch !== 'object') return;
        try {
            const raw = global.localStorage.getItem(USER_KEY);
            if (!raw) return;
            const u = JSON.parse(raw);
            if (!u || typeof u !== 'object') return;
            Object.assign(u, patch);
            global.localStorage.setItem(USER_KEY, JSON.stringify(u));
            global.dispatchEvent(new CustomEvent('diari-user-updated'));
        } catch (_) {
            /* ignore */
        }
    }

    function savePwaProfilePending(patch) {
        if (!isPwaUiContext() || !patch) return;
        const prev = readPwaPendingProfile() || {};
        const next = Object.assign({}, prev, patch);
        writePwaPendingProfile(next);
        mergePwaProfileIntoUser(patch);
    }

    function savePwaUiPrefsPending(prefs) {
        if (!isPwaUiContext() || !prefs) return;
        const prev = readPwaPendingUiPrefs() || {};
        const next = Object.assign({}, prev, prefs);
        writePwaPendingUiPrefs(next);
        mergePwaProfileIntoUser({
            uiTheme: next.uiTheme,
            uiPaletteId: next.uiPaletteId,
        });
    }

    async function flushPwaProfilePending() {
        if (!isOnline() || !isPwaUiContext()) return;
        const pending = readPwaPendingProfile();
        if (!pending || typeof pending !== 'object') return;
        const userId = getUserId();
        if (!userId) return;
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        try {
            const body = Object.assign({ userId }, pending);
            const res = await fetchFn('/api/user/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Profile sync failed');
            }
            if (data.user) mergePwaProfileIntoUser(data.user);
            writePwaPendingProfile(null);
        } catch (e) {
            console.warn('[DiariOffline] PWA profile sync failed:', e);
        }
    }

    async function flushPwaAvatarPending() {
        if (!isOnline() || !isPwaUiContext()) return;
        const dataUrl = readPwaPendingAvatar();
        if (!dataUrl) return;
        const userId = getUserId();
        if (!userId) return;
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        try {
            const res = await fetchFn('/api/user/avatar', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, avatarDataUrl: dataUrl }),
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Avatar sync failed');
            }
            if (data.user) mergePwaProfileIntoUser(data.user);
            writePwaPendingAvatar(null);
        } catch (e) {
            console.warn('[DiariOffline] PWA avatar sync failed:', e);
        }
    }

    async function flushPwaUiPrefsPending() {
        if (!isOnline() || !isPwaUiContext()) return;
        const pending = readPwaPendingUiPrefs();
        if (!pending || typeof pending !== 'object') return;
        const userId = getUserId();
        if (!userId) return;
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        const body = { userId };
        if (pending.uiTheme === 'light' || pending.uiTheme === 'dark') body.uiTheme = pending.uiTheme;
        if (pending.uiPaletteId) body.uiPaletteId = pending.uiPaletteId;
        if (!body.uiTheme && !body.uiPaletteId) {
            writePwaPendingUiPrefs(null);
            return;
        }
        try {
            const res = await fetchFn('/api/user/ui-preferences', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
                credentials: 'same-origin',
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !data.success) {
                throw new Error(data.error || 'UI preferences sync failed');
            }
            if (data.user && global.DiariTheme && typeof global.DiariTheme.applyFromUser === 'function') {
                global.DiariTheme.applyFromUser(data.user);
            }
            writePwaPendingUiPrefs(null);
        } catch (e) {
            console.warn('[DiariOffline] PWA UI prefs sync failed:', e);
        }
    }

    function sanitizeEntriesCachePwaFlags() {
        if (!isPwaUiContext()) return;
        const userId = getUserId();
        const list = readEntriesCache();
        let changed = false;
        const next = list.map((e) => {
            if (!e || e.pwaEditPending !== true) return e;
            const key = String(e.id ?? '');
            if (hasQueuedEditForEntry(key)) return e;
            changed = true;
            return { ...e, pwaEditPending: false };
        });
        if (changed) writeEntriesCache(next, userId);
    }

    /** Keep unsynced PWA offline drafts when refreshing from the server. */
    function mergeServerEntriesWithLocal(serverEntries, userId) {
        const server = Array.isArray(serverEntries) ? serverEntries : [];
        if (!isPwaUiContext()) {
            writeEntriesCache(server, userId);
            return server;
        }
        const local = readEntriesCache();
        const pending = local.filter((e) => isOfflineLocalEntry(e));
        if (!pending.length) {
            writeEntriesCache(server, userId);
            return server;
        }
        const localById = new Map(local.map((e) => [String(e?.id ?? ''), e]));
        const mergedServer = server.map((s) => {
            const key = String(s?.id ?? '');
            const loc = localById.get(key);
            if (!loc) return s;
            if (loc.pwaDeletionPending === true && hasQueuedDeleteForEntry(key)) {
                return { ...s, pwaDeletionPending: true, pwaEditPending: false };
            }
            if (loc.pwaEditPending === true && (!isOnline() || hasQueuedEditForEntry(key))) {
                return {
                    ...s,
                    title: loc.title ?? s.title,
                    text: loc.text ?? s.text,
                    tags: loc.tags ?? s.tags,
                    imageUrls: loc.imageUrls ?? s.imageUrls,
                    feeling: loc.feeling ?? s.feeling,
                    emotionLabel: loc.emotionLabel ?? s.emotionLabel,
                    emotionScore: loc.emotionScore ?? s.emotionScore,
                    sentimentLabel: loc.sentimentLabel ?? s.sentimentLabel,
                    sentimentScore: loc.sentimentScore ?? s.sentimentScore,
                    all_probs: loc.all_probs ?? s.all_probs,
                    moodScoringOffline: loc.moodScoringOffline ?? s.moodScoringOffline,
                    pwaEditPending: true,
                    pwaDeletionPending: false,
                    pwaShowEdited: false,
                };
            }
            return s;
        });
        const serverIds = new Set(server.map((e) => String(e?.id ?? '')));
        const kept = pending.filter((e) => {
            const id = String(e?.id ?? '');
            return !serverIds.has(id);
        });
        const merged = [...mergedServer, ...kept];
        merged.sort((a, b) => {
            const ta = new Date(a?.date || a?.createdAt || 0).getTime();
            const tb = new Date(b?.date || b?.createdAt || 0).getTime();
            return tb - ta;
        });
        writeEntriesCache(merged, userId);
        return merged;
    }

    /**
     * Refresh pull: server list is truth; only keep unsynced offline drafts / queued edits on this device.
     */
    function applyServerEntriesOnRefresh(serverEntries, userId) {
        sanitizeEntriesCachePwaFlags();
        const server = Array.isArray(serverEntries) ? serverEntries : [];
        if (!isPwaUiContext()) {
            writeEntriesCache(server, userId, { forceNotify: true });
            return server;
        }

        const local = readEntriesCache();
        const serverIds = new Set(server.map((e) => String(e?.id ?? '')));
        const localById = new Map(local.map((e) => [String(e?.id ?? ''), e]));

        const mergedServer = server.map((s) => {
            const key = String(s?.id ?? '');
            const loc = localById.get(key);
            if (!loc) return s;
            if (loc.pwaDeletionPending === true && hasQueuedDeleteForEntry(key)) {
                return { ...s, pwaDeletionPending: true, pwaEditPending: false };
            }
            if (loc.pwaEditPending === true && hasQueuedEditForEntry(key)) {
                return {
                    ...s,
                    title: loc.title ?? s.title,
                    text: loc.text ?? s.text,
                    tags: loc.tags ?? s.tags,
                    imageUrls: loc.imageUrls ?? s.imageUrls,
                    feeling: loc.feeling ?? s.feeling,
                    emotionLabel: loc.emotionLabel ?? s.emotionLabel,
                    emotionScore: loc.emotionScore ?? s.emotionScore,
                    sentimentLabel: loc.sentimentLabel ?? s.sentimentLabel,
                    sentimentScore: loc.sentimentScore ?? s.sentimentScore,
                    all_probs: loc.all_probs ?? s.all_probs,
                    moodScoringOffline: loc.moodScoringOffline ?? s.moodScoringOffline,
                    pwaEditPending: true,
                    pwaDeletionPending: false,
                    pwaShowEdited: false,
                };
            }
            return s;
        });

        const extra = local.filter((e) => {
            if (!e) return false;
            const id = String(e?.id ?? '');
            if (serverIds.has(id)) return false;
            if (id.startsWith('offline_')) return true;
            return isOfflineLocalEntry(e);
        });

        const merged = [...mergedServer, ...extra];
        merged.sort((a, b) => {
            const ta = new Date(a?.date || a?.createdAt || 0).getTime();
            const tb = new Date(b?.date || b?.createdAt || 0).getTime();
            return tb - ta;
        });
        writeEntriesCache(merged, userId, { forceNotify: true });
        return merged;
    }

    /** Drop stuck PWA pending profile/theme keys when nothing is queued to upload. */
    function clearOrphanedPwaPendingAfterServerPull() {
        if (!isPwaUiContext()) return;
        if (readEditQueue().length > 0) return;
        if (readDeleteQueue().length > 0) return;
        if (readOfflineCreateQueueLs().length > 0) return;
        const hasActiveDraft = readEntriesCache().some((e) => {
            if (!e) return false;
            const id = String(e?.id ?? '');
            if (id.startsWith('offline_')) return true;
            if (e.pwaEditPending === true && hasQueuedEditForEntry(id)) return true;
            if (e.pwaDeletionPending === true && hasQueuedDeleteForEntry(id)) return true;
            return false;
        });
        if (hasActiveDraft) return;
        writePwaPendingProfile(null);
        writePwaPendingUiPrefs(null);
        writePwaPendingAvatar(null);
    }

    /**
     * Save a new entry locally for offline mode (PWA). Uses browser storage only — not phone disk directly.
     */
    async function saveEntryLocally({ userId, title, entryDateTimeLocal, text, tags, images }) {
        const payload = buildOfflineEntryPayloadSync({
            userId,
            title,
            entryDateTimeLocal,
            text,
            tags,
            images,
        });

        const pendingImages = (images || []).filter((im) => im && (im.dataUrl || im.url));
        const slimEntry = stripDataUrlsFromEntry(payload.entry);
        slimEntry.pwaEditPending = false;
        slimEntry.pwaDeletionPending = false;
        if (pendingImages.length > 0) {
            slimEntry.offlinePendingImages = pendingImages.length;
        }

        let queueOk = false;
        try {
            await queuePendingEntry(payload.queueRecord);
            queueOk = true;
        } catch (queueErr) {
            console.warn('[DiariOffline] IndexedDB queue skipped, using localStorage queue:', queueErr);
            try {
                const ls = readOfflineCreateQueueLs();
                const exists = ls.some((r) => r && r.id === payload.queueRecord.id);
                if (!exists) {
                    ls.push(payload.queueRecord);
                    writeOfflineCreateQueueLs(ls);
                }
                queueOk = true;
            } catch (lsErr) {
                console.warn('[DiariOffline] localStorage create queue failed:', lsErr);
            }
        }

        let list = stripEntriesListForStorage(readEntriesCache());
        list.push(slimEntry);

        if (!writeEntriesCache(list, userId)) {
            list = list.slice(-40);
            list = stripEntriesListForStorage(list);
            if (!writeEntriesCache(list, userId)) {
                try {
                    global.localStorage.setItem(ENTRIES_KEY, JSON.stringify([slimEntry]));
                    if (userId) global.localStorage.setItem(ENTRIES_OWNER_KEY, String(userId));
                } catch (retryErr) {
                    throw new Error(storageErrorMessage(retryErr));
                }
            }
        }

        return {
            entry: { ...payload.entry, ...slimEntry, id: slimEntry.id },
            queueOk,
            engine: payload.entry.engine || 'offline-local',
        };
    }

    function mergeEntryIntoCache(entry, userId) {
        if (!entry) return;
        const list = readEntriesCache();
        const id = entry.id;
        if (id != null && id !== '') {
            const key = String(id);
            const idx = list.findIndex((e) => String(e?.id ?? '') === key);
            const serverSynced =
                /^\d+$/.test(key) &&
                entry.pendingServerAnalysis !== true &&
                !String(entry.engine || '').toLowerCase().startsWith('offline');
            const patch = {
                ...entry,
                pwaEditPending: entry.pwaEditPending === true,
                pwaDeletionPending: entry.pwaDeletionPending === true,
            };
            if (serverSynced) {
                if (entry.pwaEditPending === true) {
                    patch.pwaEditPending = true;
                    patch.pwaShowEdited = false;
                } else {
                    patch.pwaEditPending = false;
                    patch.pwaDeletionPending = false;
                    patch.pendingServerAnalysis = false;
                    patch.moodScoringOffline = false;
                    if (isPwaUiContext()) {
                        if (entry.pwaShowEdited === true) {
                            patch.pwaShowEdited = true;
                        } else {
                            const u = entry.updatedAt ? new Date(entry.updatedAt).getTime() : NaN;
                            const c = entry.createdAt
                                ? new Date(entry.createdAt).getTime()
                                : entry.date
                                  ? new Date(entry.date).getTime()
                                  : NaN;
                            patch.pwaShowEdited =
                                !Number.isNaN(u) && !Number.isNaN(c) && u > c + 1500;
                        }
                    }
                }
            }
            if (idx >= 0) list[idx] = { ...list[idx], ...patch };
            else list.unshift(patch);
        } else {
            list.unshift(entry);
        }
        writeEntriesCache(list, userId);
    }

    function dataUrlToBlob(dataUrl) {
        const parts = String(dataUrl).split(',');
        const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
        const bin = atob(parts[1] || '');
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
    }

    function openDb(name, version, onUpgrade) {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            const req = indexedDB.open(name, version);
            req.onupgradeneeded = () => onUpgrade(req.result);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        });
    }

    async function openPendingEntriesDb() {
        return openDb(PENDING_ENTRIES_DB, 1, (db) => {
            if (!db.objectStoreNames.contains(PENDING_ENTRIES_STORE)) {
                db.createObjectStore(PENDING_ENTRIES_STORE, { keyPath: 'id' });
            }
        });
    }

    async function openEditMediaDb() {
        return openDb(ENTRY_EDIT_MEDIA_DB, 1, (db) => {
            if (!db.objectStoreNames.contains(ENTRY_EDIT_MEDIA_STORE)) {
                db.createObjectStore(ENTRY_EDIT_MEDIA_STORE, { keyPath: 'key' });
            }
        });
    }

    function readOfflineCreateQueueLs() {
        try {
            const arr = JSON.parse(global.localStorage.getItem(OFFLINE_CREATE_QUEUE_LS) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeOfflineCreateQueueLs(rows) {
        global.localStorage.setItem(OFFLINE_CREATE_QUEUE_LS, JSON.stringify(rows));
    }

    async function pendingEntriesGetAll() {
        let rows = [];
        try {
            const db = await openPendingEntriesDb();
            rows = await new Promise((resolve, reject) => {
                const tx = db.transaction(PENDING_ENTRIES_STORE, 'readonly');
                const req = tx.objectStore(PENDING_ENTRIES_STORE).getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error);
            });
            db.close();
        } catch (e) {
            console.warn('[DiariOffline] IndexedDB pending read failed:', e);
        }
        const lsRows = readOfflineCreateQueueLs();
        if (!lsRows.length) return rows;
        const seen = new Set(rows.map((r) => r && r.id).filter(Boolean));
        lsRows.forEach((r) => {
            if (r && r.id && !seen.has(r.id)) {
                rows.push(r);
                seen.add(r.id);
            }
        });
        return rows;
    }

    async function pendingEntryDelete(id) {
        try {
            const db = await openPendingEntriesDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(PENDING_ENTRIES_STORE, 'readwrite');
                tx.objectStore(PENDING_ENTRIES_STORE).delete(id);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        } catch (e) {
            console.warn('[DiariOffline] IndexedDB pending delete failed:', e);
        }
        const ls = readOfflineCreateQueueLs().filter((r) => r && r.id !== id);
        writeOfflineCreateQueueLs(ls);
    }

    async function queuePendingEntry(record) {
        const db = await openPendingEntriesDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(PENDING_ENTRIES_STORE, 'readwrite');
            tx.objectStore(PENDING_ENTRIES_STORE).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }

    async function uploadImageFile(file, userId) {
        const IU = global.DiariImageUpload;
        if (IU && typeof IU.uploadWithRetries === 'function') {
            const prepared =
                typeof IU.prepareUploadFile === 'function' ? await IU.prepareUploadFile(file) : file;
            return IU.uploadWithRetries(prepared, userId, null, 3);
        }
        const form = new FormData();
        form.append('file', file);
        form.append('userId', String(userId));
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        const res = await fetchFn('/api/uploads/image', { method: 'POST', body: form });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json?.success || !json?.url) {
            throw new Error(json?.error || 'Upload failed');
        }
        return String(json.url);
    }

    function formatOfflineAnalysis(result) {
        return {
            ...result,
            feeling: result.feeling || result.emotionLabel,
            moodScoringOffline: result.moodScoringOffline === true,
        };
    }

    /**
     * PWA offline: temporary local estimate until sync runs server analysis (Space).
     */
    async function analyzeForOffline(text) {
        if (!isPwaStandalone()) {
            return analyzeTextLocally(text);
        }
        return {
            ...analyzeTextLocally(text),
            engine: 'offline-estimate',
            pendingServerAnalysis: true,
        };
    }

    /** Sync payload when async analysis must not block UI recovery. */
    function buildOfflineEntryPayloadSync({ userId, title, entryDateTimeLocal, text, tags, images }) {
        const analysis = analyzeTextLocally(text);
        const now = new Date().toISOString();
        const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
            queueRecord: {
                id: `offline_entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                localEntryId: localId,
                userId,
                title: title || '',
                entryDateTimeLocal: entryDateTimeLocal || '',
                text: text || '',
                tags: tags || [],
                images: (images || []).map((im) => ({ url: im.url || '', dataUrl: im.dataUrl || '' })),
                createdAt: now,
            },
            entry: {
                id: localId,
                title: title || '',
                text: text || '',
                tags: tags || [],
                imageUrls: (images || []).map((im) => im.url || im.dataUrl).filter(Boolean),
                date: entryDateTimeLocal ? new Date(entryDateTimeLocal).toISOString() : now,
                createdAt: now,
                characterCount: String(text || '').length,
                ...analysis,
                engine: 'offline-estimate',
                pendingServerAnalysis: true,
            },
        };
    }

    function analyzeTextLocally(text) {
        const t = String(text || '').toLowerCase();
        const scores = { happy: 0.15, sad: 0.15, angry: 0.12, anxious: 0.12, neutral: 0.46 };
        const lex = {
            happy: ['happy', 'joy', 'grateful', 'excited', 'love', 'wonderful', 'great', 'amazing', 'blessed', 'proud'],
            sad: ['sad', 'cry', 'depressed', 'lonely', 'grief', 'tears', 'miss', 'hurt', 'heartbroken'],
            angry: ['angry', 'furious', 'mad', 'hate', 'rage', 'annoyed', 'frustrated', 'irritated'],
            anxious: ['anxious', 'worried', 'stress', 'stressed', 'nervous', 'panic', 'afraid', 'overwhelm', 'scared'],
        };
        Object.keys(lex).forEach((k) => {
            lex[k].forEach((w) => {
                if (t.includes(w)) scores[k] += 0.22;
            });
        });
        let top = 'neutral';
        let topScore = scores.neutral;
        Object.keys(scores).forEach((k) => {
            if (scores[k] > topScore) {
                topScore = scores[k];
                top = k;
            }
        });
        const sum = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
        const all_probs = {};
        Object.keys(scores).forEach((k) => {
            all_probs[k] = Math.round((scores[k] / sum) * 1000) / 1000;
        });
        const confidence = Math.min(0.92, Math.max(0.42, topScore / sum));
        return {
            emotionLabel: top,
            feeling: top,
            emotionScore: confidence,
            sentimentLabel: top === 'happy' ? 'positive' : top === 'sad' || top === 'angry' || top === 'anxious' ? 'negative' : 'neutral',
            sentimentScore: confidence,
            all_probs,
            moodScoringOffline: true,
            engine: 'offline-estimate',
            pendingServerAnalysis: true,
        };
    }

    function entryNeedsServerReanalysis(entry) {
        if (!entry) return false;
        if (entry.pendingServerAnalysis === true) return true;
        if (entry.moodScoringOffline === true) return true;
        const engine = String(entry.engine || '').toLowerCase();
        return (
            engine === 'offline-estimate' ||
            engine === 'offline-local' ||
            engine === 'fallback'
        );
    }

    function removeOfflineEntryByLocalId(localEntryId, userId) {
        if (!localEntryId) return;
        const list = readEntriesCache().filter((e) => String(e?.id) !== String(localEntryId));
        writeEntriesCache(list, userId);
    }

    function remapEditQueueEntryId(oldId, newId) {
        const from = String(oldId ?? '');
        const to = String(newId ?? '');
        if (!from || !to || from === to) return;
        const q = readEditQueue();
        let changed = false;
        const next = q.map((row) => {
            if (String(row.entryId) !== from) return row;
            changed = true;
            return { ...row, entryId: to };
        });
        if (changed) writeEditQueue(next);
    }

    async function buildOfflineEntryPayload({ userId, title, entryDateTimeLocal, text, tags, images }) {
        const analysis = await analyzeForOffline(text);
        const now = new Date().toISOString();
        const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        return {
            queueRecord: {
                id: `offline_entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                userId,
                title: title || '',
                entryDateTimeLocal: entryDateTimeLocal || '',
                text: text || '',
                tags: tags || [],
                images: (images || []).map((im) => ({ url: im.url || '', dataUrl: im.dataUrl || '' })),
                createdAt: now,
            },
            entry: {
                id: localId,
                title: title || '',
                text: text || '',
                tags: tags || [],
                imageUrls: (images || []).map((im) => im.url || im.dataUrl).filter(Boolean),
                date: entryDateTimeLocal ? new Date(entryDateTimeLocal).toISOString() : now,
                createdAt: now,
                characterCount: String(text || '').length,
                ...analysis,
            },
        };
    }

    function notifyRemoteStateRefresh() {
        try {
            global.dispatchEvent(new CustomEvent('diari-offline-sync-complete'));
            global.dispatchEvent(new CustomEvent('diari-remote-state-refreshed'));
        } catch (_) {
            /* ignore */
        }
    }

    const pageRefreshHandlers = new Set();

    function registerPageRefreshHandler(handler) {
        if (typeof handler === 'function') pageRefreshHandlers.add(handler);
    }

    function runPageRefreshHandlers() {
        pageRefreshHandlers.forEach((handler) => {
            try {
                handler();
            } catch (e) {
                console.warn('[DiariOffline] page refresh handler failed:', e);
            }
        });
    }

    async function hasBlockingLocalEntryDrafts() {
        const local = readEntriesCache();
        for (const e of local) {
            const id = String(e?.id ?? '');
            if (id.startsWith('offline_')) return true;
            if (e.pwaDeletionPending === true && hasQueuedDeleteForEntry(id)) return true;
            if (e.pwaEditPending === true && hasQueuedEditForEntry(id)) return true;
        }
        return false;
    }

    async function shouldApplyServerEntriesDirectly(options = {}) {
        if (options.remoteWins !== true) return false;
        let pending = false;
        try {
            pending = await hasPendingOfflineWorkAsync();
        } catch {
            pending = hasPendingOfflineWork();
        }
        if (pending) return false;
        if (await hasBlockingLocalEntryDrafts()) return false;
        return true;
    }

    async function syncEntriesFromApi(options = {}) {
        const userId = getUserId();
        if (!userId) {
            global.localStorage.setItem(ENTRIES_KEY, '[]');
            global.localStorage.removeItem(ENTRIES_OWNER_KEY);
            return { ok: false, offline: !isOnline(), entries: [] };
        }

        const cacheOwner = global.localStorage.getItem(ENTRIES_OWNER_KEY);
        if (cacheOwner && cacheOwner !== String(userId)) {
            global.localStorage.setItem(ENTRIES_KEY, '[]');
        }

        if (isPwaUiContext()) {
            sanitizeEntriesCachePwaFlags();
        }

        const skipProbe = options.skipReachabilityProbe === true;
        const trustNav = options.trustNavigatorOnline === true;

        let reachable = false;
        if (isOnline()) {
            if (skipProbe || trustNav) {
                reachable = true;
            } else {
                reachable = isPwaUiContext() ? await probeReachability() : true;
            }
        }
        if (!reachable) {
            return { ok: true, offline: true, entries: readEntriesCache(), fromCache: true };
        }

        try {
            const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
            const response = await fetchFn(
                '/api/entries?dc=' + Date.now() + '&_=' + Math.random().toString(36).slice(2),
                {
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
                }
            );
            const result = await response.json().catch(() => ({}));
            if (response.status === 401) {
                global.localStorage.setItem(ENTRIES_KEY, '[]');
                global.localStorage.removeItem(ENTRIES_OWNER_KEY);
                return { ok: false, offline: false, entries: [], authExpired: true };
            }
            if (!response.ok || !result.success || !Array.isArray(result.entries)) {
                return { ok: false, offline: false, entries: readEntriesCache(), fromCache: true };
            }
            const server = result.entries;
            if (await shouldApplyServerEntriesDirectly(options)) {
                writeEntriesCache(server, userId);
                return { ok: true, offline: false, entries: server, fromServer: true };
            }
            const merged = mergeServerEntriesWithLocal(server, userId);
            return { ok: true, offline: false, entries: merged };
        } catch (err) {
            console.warn('[DiariOffline] syncEntriesFromApi failed, using cache:', err);
            return { ok: false, offline: true, entries: readEntriesCache(), fromCache: true };
        }
    }

    async function syncUserFromApi(options = {}) {
        const userId = getUserId();
        if (!userId) {
            return { ok: false, offline: !isOnline(), fromCache: true };
        }

        const skipProbe = options.skipReachabilityProbe === true;
        const trustNav = options.trustNavigatorOnline === true;

        let reachable = false;
        if (isOnline()) {
            if (skipProbe || trustNav) {
                reachable = true;
            } else {
                reachable = isPwaUiContext() ? await probeReachability() : true;
            }
        }
        if (!reachable) {
            return { ok: true, offline: true, fromCache: true };
        }

        try {
            const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
            const response = await fetchFn('/api/user/me?dc=' + Date.now(), {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 401) {
                return { ok: false, offline: false, authExpired: true };
            }
            if (!response.ok || !result.success || !result.user) {
                return { ok: false, offline: false, fromCache: true };
            }
            mergeServerUserIntoLocal(result.user, { remoteWins: options.remoteWins === true });
            return { ok: true, offline: false };
        } catch (err) {
            console.warn('[DiariOffline] syncUserFromApi failed, using cache:', err);
            return { ok: false, offline: true, fromCache: true };
        }
    }

    async function flushPendingEntryCreates() {
        if (!isOnline()) return;
        const userId = getUserId();
        if (!userId) return;

        const pending = await pendingEntriesGetAll();
        for (const item of pending) {
            try {
                const imageUrls = [];
                for (const img of item.images || []) {
                    if (img.url) {
                        imageUrls.push(img.url);
                        continue;
                    }
                    if (img.dataUrl) {
                        const blob = dataUrlToBlob(img.dataUrl);
                        const ext = (blob.type || 'image/png').split('/')[1] || 'png';
                        const file = new File([blob], `offline-${Date.now()}.${ext}`, {
                            type: blob.type || 'image/png',
                        });
                        imageUrls.push(await uploadImageFile(file, userId));
                    }
                }
                const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
                const response = await fetchFn('/api/entries', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        title: item.title || '',
                        entryDateTimeLocal: item.entryDateTimeLocal || '',
                        text: item.text || '',
                        tags: item.tags || [],
                        imageUrls,
                    }),
                });
                const result = await response.json().catch(() => ({}));
                if (!response.ok || !result?.success || !result?.entry) {
                    throw new Error(result?.error || 'Offline sync entry save failed');
                }
                if (item.localEntryId) {
                    remapEditQueueEntryId(item.localEntryId, result.entry.id);
                    removeOfflineEntryByLocalId(item.localEntryId, userId);
                }
                mergeEntryIntoCache(
                    {
                        ...result.entry,
                        pendingServerAnalysis: false,
                        moodScoringOffline: false,
                        pwaEditPending: false,
                        pwaDeletionPending: false,
                    },
                    userId
                );
                await pendingEntryDelete(item.id);
            } catch (e) {
                console.warn('[DiariOffline] Pending entry sync failed:', item?.id, e);
            }
        }
    }

    function readEditQueue() {
        try {
            const raw = global.localStorage.getItem(ENTRY_EDIT_QUEUE_KEY);
            const arr = JSON.parse(raw || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeEditQueue(arr) {
        global.localStorage.setItem(ENTRY_EDIT_QUEUE_KEY, JSON.stringify(arr));
    }

    async function idbEditMediaGet(key) {
        const db = await openEditMediaDb();
        const row = await new Promise((resolve, reject) => {
            const tx = db.transaction(ENTRY_EDIT_MEDIA_STORE, 'readonly');
            const req = tx.objectStore(ENTRY_EDIT_MEDIA_STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return row;
    }

    async function idbEditMediaDelete(key) {
        const db = await openEditMediaDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(ENTRY_EDIT_MEDIA_STORE, 'readwrite');
            tx.objectStore(ENTRY_EDIT_MEDIA_STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
    }

    async function waitForReachability(maxAttempts = 10, baseDelayMs = 400) {
        if (!isOnline()) return false;
        for (let i = 0; i < maxAttempts; i++) {
            if (await probeReachability()) return true;
            if (!isOnline()) return false;
            if (i < maxAttempts - 1) {
                await new Promise((r) => global.setTimeout(r, baseDelayMs * (i + 1)));
            }
        }
        return false;
    }

    let syncAllPromise = null;

    async function syncAll(options = {}) {
        if (!isPwaUiContext()) return { ok: false, reason: 'not-pwa' };
        if (!isOnline()) return { ok: false, reason: 'offline' };

        if (syncAllPromise) return syncAllPromise;

        const opts = options || {};

        syncAllPromise = (async () => {
            const trustNav = opts.trustNavigatorOnline === true;
            let reachable = true;

            if (!trustNav) {
                reachable = await waitForReachability();
                if (!reachable && isOnline() && (await hasPendingOfflineWorkAsync())) {
                    console.warn('[DiariOffline] Reachability probe failed; flushing pending PWA work anyway.');
                    reachable = true;
                }
            }

            if (!reachable) {
                return { ok: false, reason: 'unreachable' };
            }

            global.dispatchEvent(new CustomEvent('diari-offline-sync'));
            await flushPendingEntryCreates();
            await flushPendingEntryEdits();
            await flushPendingEntryDeletes();
            await flushTagSyncQueue();
            await flushPwaProfilePending();
            await flushPwaAvatarPending();
            await flushPwaUiPrefsPending();
            sanitizeEntriesCachePwaFlags();
            await reanalyzeCachedFallbackEntries();
            await syncEntriesFromApi({
                skipReachabilityProbe: true,
                trustNavigatorOnline: trustNav,
                remoteWins: true,
            });
            await syncUserFromApi({
                skipReachabilityProbe: true,
                trustNavigatorOnline: trustNav,
                remoteWins: opts.remoteWins !== false,
            });
            return { ok: true };
        })()
            .catch((e) => {
                console.warn('[DiariOffline] syncAll failed:', e);
                return { ok: false, reason: 'error' };
            })
            .finally(() => {
                syncAllPromise = null;
            });

        return syncAllPromise;
    }

    function requestPwaSync(options = {}) {
        if (!isPwaUiContext()) return Promise.resolve({ ok: false, reason: 'not-pwa' });
        return syncAll(options);
    }

    let syncPageLoadPromise = null;

    /**
     * Pull latest user + entries from server (and flush PWA queues when applicable).
     * Call before rendering authenticated pages and on refresh / tab revisit when online.
     */
    async function syncAllForPageLoad(options = {}) {
        const userId = getUserId();
        if (!userId) {
            return { ok: false, reason: 'anon' };
        }
        if (!isOnline() && options.refresh !== true) {
            return { ok: false, reason: 'offline' };
        }

        if (syncPageLoadPromise && options.forceRefresh !== true) {
            return syncPageLoadPromise;
        }

        const syncOpts = {
            trustNavigatorOnline: options.trustNavigatorOnline !== false,
            remoteWins: options.remoteWins !== false,
            skipReachabilityProbe: options.skipReachabilityProbe === true,
        };

        if (!isPwaUiContext()) {
            syncPageLoadPromise = (async () => {
                const [userRes, entriesRes] = await Promise.all([
                    syncUserFromApi(syncOpts),
                    syncEntriesFromApi(syncOpts),
                ]);
                notifyRemoteStateRefresh();
                runPageRefreshHandlers();
                return {
                    ok: true,
                    authExpired: Boolean(userRes?.authExpired || entriesRes?.authExpired),
                };
            })()
                .catch((e) => {
                    console.warn('[DiariOffline] syncAllForPageLoad failed:', e);
                    return { ok: false, reason: 'error' };
                })
                .finally(() => {
                    syncPageLoadPromise = null;
                });
            return syncPageLoadPromise;
        }

        syncPageLoadPromise = (async () => {
            const maxAttempts = Number(options.maxAttempts) > 0 ? Number(options.maxAttempts) : 4;
            let lastResult = { ok: false };

            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                lastResult = await syncAll(syncOpts);
                let pending = false;
                try {
                    pending = await hasPendingOfflineWorkAsync();
                } catch {
                    pending = hasPendingOfflineWork();
                }
                if (lastResult?.ok && !pending) {
                    break;
                }
                if (!pending && navigator.onLine !== false) {
                    break;
                }
                if (navigator.onLine === false) {
                    break;
                }
                if (attempt < maxAttempts - 1) {
                    await new Promise((r) => global.setTimeout(r, 900 * (attempt + 1)));
                }
            }
            notifyRemoteStateRefresh();
            runPageRefreshHandlers();
            return lastResult;
        })()
            .catch((e) => {
                console.warn('[DiariOffline] syncAllForPageLoad (PWA) failed:', e);
                return { ok: false, reason: 'error' };
            })
            .finally(() => {
                syncPageLoadPromise = null;
            });
        return syncPageLoadPromise;
    }

    /**
     * Re-run sync when the app returns online or the user revisits a tab; optional UI refresh callback.
     */
    function wirePwaPageAutoSync(onRefresh) {
        const refresh =
            typeof onRefresh === 'function'
                ? onRefresh
                : null;

        if (refresh) {
            global.addEventListener('diari-offline-sync-complete', refresh);
            global.addEventListener('diari-user-updated', refresh);
        }

        const kick = () => {
            if (!isOnline()) return;
            void pullRemoteStateForRefresh().then(() => {
                if (refresh) refresh();
            });
        };

        global.addEventListener('online', kick);
        global.addEventListener('pageshow', kick);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') kick();
        });
    }

    async function flushPendingEntryEdits() {
        if (!isOnline()) return;
        const userId = getUserId();
        if (!userId) return;

        const q = coalesceEditQueueLatest();
        const next = [];
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;

        for (const row of q) {
            const entryKey = String(row.entryId || '');
            if (entryKey.startsWith('offline_')) {
                next.push(row);
                continue;
            }
            const numericId = Number(entryKey);
            if (!Number.isInteger(numericId) || numericId <= 0) {
                next.push(row);
                continue;
            }
            try {
                const cacheRow = readEntriesCache().find((e) => String(e?.id ?? '') === entryKey);
                const title = cacheRow?.pwaEditPending ? cacheRow.title ?? row.title : row.title;
                const text = cacheRow?.pwaEditPending ? cacheRow.text ?? row.text : row.text;
                const tags = cacheRow?.pwaEditPending ? cacheRow.tags ?? row.tags : row.tags;

                let imageUrls = Array.isArray(row.imageUrls) ? [...row.imageUrls] : [];
                if (cacheRow?.pwaEditPending && Array.isArray(cacheRow.imageUrls) && cacheRow.imageUrls.length) {
                    imageUrls = cacheRow.imageUrls.filter((u) => u && !String(u).startsWith('data:'));
                }
                if (row.imageMediaKey) {
                    const blobRow = await idbEditMediaGet(row.imageMediaKey);
                    if (blobRow?.images?.length) {
                        const merged = [];
                        for (const im of blobRow.images) {
                            if (im.url) {
                                merged.push(im.url);
                                continue;
                            }
                            if (im.dataUrl) {
                                const blob = dataUrlToBlob(im.dataUrl);
                                const ext = (blob.type || 'image/png').split('/')[1] || 'png';
                                const file = new File([blob], `offline-${Date.now()}.${ext}`, {
                                    type: blob.type || 'image/png',
                                });
                                merged.push(await uploadImageFile(file, row.userId || userId));
                            }
                        }
                        if (merged.length) imageUrls = merged;
                    }
                }
                const body = {
                    userId: row.userId || userId,
                    title: title || '',
                    text: text || '',
                    tags: tags || [],
                    reanalyze: row.reanalyze,
                };
                if (row.imageMediaKey || imageUrls.length) body.imageUrls = imageUrls;

                const res = await fetchFn(`/api/entries/${numericId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success && data.entry) {
                    mergeEntryIntoCache(
                        {
                            ...data.entry,
                            pwaEditPending: false,
                            pwaDeletionPending: false,
                        },
                        userId
                    );
                    if (row.imageMediaKey) await idbEditMediaDelete(row.imageMediaKey);
                    continue;
                }
                throw new Error(data?.error || 'Edit sync failed');
            } catch (e) {
                console.warn('[DiariOffline] Pending edit sync failed:', row?.entryId, e);
                next.push(row);
            }
        }
        writeEditQueue(next);
    }

    async function flushTagSyncQueue() {
        if (!isOnline()) return;
        const userId = getUserId();
        if (!userId) return;
        let queue = [];
        try {
            const raw = global.localStorage.getItem(TAG_QUEUE_KEY);
            queue = JSON.parse(raw || '[]');
            if (!Array.isArray(queue)) queue = [];
        } catch {
            return;
        }
        if (!queue.length) return;

        const remaining = [];
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        for (const op of queue) {
            try {
                if (op?.type === 'add') {
                    const res = await fetchFn('/api/tags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId,
                            tag: op.tag,
                            iconName: op.iconName || '',
                        }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || !json?.success) throw new Error(json?.error || 'Tag add failed');
                } else if (op?.type === 'delete') {
                    const res = await fetchFn('/api/tags', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId, tag: op.tag }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || !json?.success) throw new Error(json?.error || 'Tag delete failed');
                }
            } catch (e) {
                remaining.push(op);
            }
        }
        global.localStorage.setItem(TAG_QUEUE_KEY, JSON.stringify(remaining));
    }

    async function reanalyzeCachedFallbackEntries() {
        if (!isOnline() || !isPwaUiContext()) return;
        const userId = getUserId();
        if (!userId) return;

        const list = readEntriesCache();
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;

        for (const entry of list) {
            if (!entryNeedsServerReanalysis(entry)) continue;
            const numericId = Number(entry.id);
            if (!Number.isInteger(numericId) || numericId <= 0) continue;
            try {
                const res = await fetchFn(`/api/entries/${numericId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        userId,
                        title: entry.title || '',
                        text: entry.text || '',
                        tags: entry.tags || [],
                        reanalyze: true,
                    }),
                });
                const json = await res.json().catch(() => ({}));
                if (res.ok && json?.success && json?.entry) {
                    mergeEntryIntoCache(json.entry, userId);
                }
            } catch (e) {
                console.warn('[DiariOffline] Server reanalyze failed:', entry.id, e);
            }
        }
    }

    function hasPendingOfflineWork() {
        if (readEditQueue().length > 0) return true;
        if (readDeleteQueue().length > 0) return true;
        if (readOfflineCreateQueueLs().length > 0) return true;
        if (hasPwaPendingProfile()) return true;
        if (hasPwaPendingAvatar()) return true;
        if (hasPwaPendingUiPrefs()) return true;
        return readEntriesCache().some((e) => isOfflineLocalEntry(e));
    }

    async function hasPendingOfflineWorkAsync() {
        if (hasPendingOfflineWork()) return true;
        try {
            const pending = await pendingEntriesGetAll();
            return pending.length > 0;
        } catch {
            return hasPendingOfflineWork();
        }
    }

    let connectivityWatchStarted = false;
    let remoteStateWatchStarted = false;
    let liveRemoteSyncStarted = false;
    let liveRemoteSyncTimer = null;
    const LIVE_REMOTE_SYNC_MS = 3000;
    let remotePullPromise = null;
    let syncEventSource = null;
    let syncEventSourceRetries = 0;
    let pwaLastReachable = null;

    function currentAppPageName() {
        const path = (global.location.pathname || '').split('/').pop() || '';
        return path || 'index.html';
    }

    function isAuthenticatedAppPage() {
        return getUserId() > 0 && !PUBLIC_PAGES.has(currentAppPageName());
    }

    function handleAuthExpiredFromSync(result) {
        if (!result || !result.authExpired) return false;
        try {
            global.localStorage.removeItem(USER_KEY);
        } catch (_) {
            /* ignore */
        }
        global.location.href = 'login.html';
        return true;
    }

    /**
     * Direct Railway pull — one request, replace local cache when allowed (no navigator.onLine gate).
     */
    async function pullFromServerHard() {
        const userId = getUserId();
        if (!userId) return { ok: false, reason: 'anon' };

        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        try {
            const res = await fetchFn('/api/sync/state?_=' + Date.now(), {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            const data = await res.json().catch(() => ({}));
            if (res.status === 401) {
                return { ok: false, authExpired: true };
            }
            if (!res.ok || !data.success) {
                return { ok: false, reason: 'api-error', status: res.status };
            }

            const sessionUid = getUserId();
            const serverUid = Number(data.user?.id ?? data.user?.userId ?? 0);
            if (serverUid > 0 && sessionUid > 0 && serverUid !== sessionUid) {
                console.warn('[DiariOffline] Session user mismatch; signing out.');
                return { ok: false, authExpired: true };
            }

            if (data.user) {
                mergeServerUserIntoLocal(data.user, { remoteWins: true, forceRemote: true });
            }
            if (Array.isArray(data.entries)) {
                applyServerEntriesOnRefresh(data.entries, userId);
            }
            clearOrphanedPwaPendingAfterServerPull();

            if (data.syncRevision) {
                try {
                    global.localStorage.setItem(SYNC_REV_KEY, String(data.syncRevision));
                } catch (_) {
                    /* ignore */
                }
            }

            notifyRemoteStateRefresh();
            runPageRefreshHandlers();
            return { ok: true, serverTime: data.serverTime, syncRevision: data.syncRevision };
        } catch (err) {
            console.warn('[DiariOffline] pullFromServerHard failed:', err);
            return { ok: false, reason: 'network-error' };
        }
    }

    async function fetchSyncCheck() {
        const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
        const res = await fetchFn('/api/sync/check?_=' + Date.now(), {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
            headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
        });
        const data = await res.json().catch(() => ({}));
        return { res, data };
    }

    /**
     * Cheap poll: true when Railway data changed since last pull on this device.
     */
    async function hasRemoteRevisionChanged() {
        try {
            const { res, data } = await fetchSyncCheck();
            if (res.status === 401) {
                return { changed: false, authExpired: true };
            }
            if (!res.ok || !data.success) {
                return { changed: true, reason: 'check-failed' };
            }
            const prev = global.localStorage.getItem(SYNC_REV_KEY) || '';
            const next = String(data.syncRevision || '');
            return { changed: prev !== next, syncRevision: next };
        } catch {
            return { changed: true, reason: 'network' };
        }
    }

    async function runPrePullFlush() {
        if (!isPwaUiContext()) return;
        let pending = false;
        try {
            pending = await hasPendingOfflineWorkAsync();
        } catch {
            pending = hasPendingOfflineWork();
        }
        if (pending) {
            try {
                await flushPendingEntryCreates();
                await flushPendingEntryEdits();
                await flushPendingEntryDeletes();
                await flushTagSyncQueue();
                await flushPwaProfilePending();
                await flushPwaAvatarPending();
                await flushPwaUiPrefsPending();
            } catch (e) {
                console.warn('[DiariOffline] pre-pull flush failed:', e);
            }
        }
        sanitizeEntriesCachePwaFlags();
    }

    /**
     * Force a network pull + UI refresh (page reload, tab return, live sync).
     * @param {{ force?: boolean }} options - force=true skips revision check (page load).
     */
    async function pullRemoteStateForRefresh(options = {}) {
        if (!getUserId()) return { ok: false, reason: 'anon' };
        syncPageLoadPromise = null;

        if (remotePullPromise) {
            return remotePullPromise;
        }

        remotePullPromise = (async () => {
            await runPrePullFlush();
            const result = await pullFromServerHard();
            handleAuthExpiredFromSync(result);
            return result;
        })()
            .catch((e) => {
                console.warn('[DiariOffline] pullRemoteStateForRefresh failed:', e);
                return { ok: false, reason: 'error' };
            })
            .finally(() => {
                remotePullPromise = null;
            });

        return remotePullPromise;
    }

    /**
     * Every authenticated page should await this before reading localStorage for UI.
     */
    let bootServerSyncPromise = null;

    function startBootServerSync() {
        if (bootServerSyncPromise || !isAuthenticatedAppPage()) return;
        bootServerSyncPromise = pullRemoteStateForRefresh({ force: true }).finally(() => {
            bootServerSyncPromise = null;
        });
    }

    async function awaitServerState() {
        if (!getUserId()) return { ok: false, reason: 'anon' };
        if (bootServerSyncPromise) {
            return bootServerSyncPromise;
        }
        return pullRemoteStateForRefresh({ force: true });
    }

    function stopSyncEventStream() {
        if (!syncEventSource) return;
        try {
            syncEventSource.close();
        } catch (_) {
            /* ignore */
        }
        syncEventSource = null;
    }

    function startSyncEventStream() {
        if (syncEventSource || typeof EventSource === 'undefined') return;
        if (!getUserId() || !isAuthenticatedAppPage()) return;

        const url = '/api/sync/stream?_=' + Date.now();
        try {
            syncEventSource = new EventSource(url);
        } catch (e) {
            console.warn('[DiariOffline] EventSource failed:', e);
            return;
        }

        syncEventSource.onopen = () => {
            syncEventSourceRetries = 0;
        };

        syncEventSource.onmessage = (ev) => {
            if (!ev || !ev.data) return;
            void pullRemoteStateForRefresh({ force: true });
        };

        syncEventSource.onerror = () => {
            stopSyncEventStream();
            syncEventSourceRetries += 1;
            const delay = Math.min(15000, 1500 * syncEventSourceRetries);
            global.setTimeout(() => {
                if (getUserId() > 0 && isAuthenticatedAppPage()) {
                    startSyncEventStream();
                }
            }, delay);
        };
    }

    function startLiveRemoteSync() {
        if (liveRemoteSyncStarted) return;
        liveRemoteSyncStarted = true;

        startSyncEventStream();

        const tick = () => {
            if (!isAuthenticatedAppPage()) return;
            if (document.visibilityState === 'hidden') return;
            void pullRemoteStateForRefresh({ force: true });
        };

        tick();
        liveRemoteSyncTimer = global.setInterval(tick, LIVE_REMOTE_SYNC_MS);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                startSyncEventStream();
                tick();
            } else {
                stopSyncEventStream();
            }
        });
    }

    function startRemoteStateWatch() {
        if (remoteStateWatchStarted) return;
        remoteStateWatchStarted = true;

        const kick = () => {
            if (!isAuthenticatedAppPage()) return;
            void pullRemoteStateForRefresh();
        };

        global.addEventListener('pageshow', kick);
        global.addEventListener('online', kick);
        global.addEventListener('focus', kick);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') kick();
        });

        try {
            global.addEventListener('storage', (event) => {
                if (
                    event.key === ENTRIES_KEY ||
                    event.key === USER_KEY ||
                    event.key === null
                ) {
                    notifyRemoteStateRefresh();
                    runPageRefreshHandlers();
                }
            });
        } catch (_) {
            /* ignore */
        }
    }

    function startPwaConnectivityWatch() {
        if (connectivityWatchStarted || !isPwaUiContext()) return;
        connectivityWatchStarted = true;

        const kickSync = () => void requestPwaSync({ trustNavigatorOnline: true });

        global.addEventListener('online', kickSync);
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') kickSync();
        });
        global.addEventListener('pageshow', kickSync);

        global.setInterval(() => {
            void (async () => {
                if (!isOnline()) {
                    pwaLastReachable = false;
                    return;
                }
                let reachable = true;
                try {
                    reachable = await probeReachability();
                } catch {
                    reachable = false;
                }
                const wasDown = pwaLastReachable === false;
                pwaLastReachable = reachable;
                const pending = await hasPendingOfflineWorkAsync();
                if (reachable && (wasDown || pending)) kickSync();
            })();
        }, 5000);
    }

    function guardOfflineAuth() {
        const page = (global.location.pathname || '').split('/').pop() || 'login.html';
        const user = getSessionUser();
        if (PUBLIC_PAGES.has(page)) {
            if (
                isPwaUiContext() &&
                user?.isLoggedIn &&
                (page === 'login.html' || page === 'index.html' || page === '')
            ) {
                global.location.replace(user.isAdmin ? 'admin' : 'dashboard.html');
            }
            return;
        }
        if (user?.isLoggedIn) return;
        if (isOnline()) {
            global.location.href = 'login.html';
            return;
        }
        const cached = readEntriesCache();
        if (cached.length > 0) return;
        global.location.href = 'login.html';
    }

    function tryStartAuthenticatedSync() {
        if (!isAuthenticatedAppPage()) return;
        startBootServerSync();
        startLiveRemoteSync();
    }

    async function hydrateLocalCacheFromServer() {
        const result = await pullFromServerHard();
        handleAuthExpiredFromSync(result);
        return result;
    }

    function init() {
        ensurePwaDocumentMarkers();
        if (isPwaUiContext()) {
            guardOfflineAuth();
            startPwaConnectivityWatch();
        }
        startRemoteStateWatch();
        tryStartAuthenticatedSync();
    }

    ensurePwaDocumentMarkers();
    if (getUserId() > 0 && isAuthenticatedAppPage()) {
        tryStartAuthenticatedSync();
    }

    global.DiariOffline = {
        isOnline,
        isPwaStandalone,
        isPwaUiContext,
        isPwaOfflineNow,
        ensurePwaDocumentMarkers,
        shouldShowEntryEditPendingPill,
        hasPendingOfflineWork,
        hasPendingOfflineWorkAsync,
        probeReachability,
        shouldActOffline,
        shouldSaveEntryOffline,
        getEntrySyncLabel,
        hasQueuedEditForEntry,
        removeEditQueueForEntry,
        savePwaProfilePending,
        savePwaAvatarPending,
        savePwaUiPrefsPending,
        hasPwaPendingProfile,
        hasPwaPendingAvatar,
        hasPwaPendingUiPrefs,
        flushPwaProfilePending,
        flushPwaAvatarPending,
        flushPwaUiPrefsPending,
        syncAllForPageLoad,
        pullRemoteStateForRefresh,
        pullFromServerHard,
        hydrateLocalCacheFromServer,
        awaitServerState,
        registerPageRefreshHandler,
        mergeServerUserIntoLocal,
        wirePwaPageAutoSync,
        sanitizeEntriesCachePwaFlags,
        markEntryEditPendingInCache,
        upsertEditQueueRecord,
        markEntryDeletionPending,
        requestPwaSync,
        getSessionUser,
        getUserId,
        readEntriesCache,
        writeEntriesCache,
        mergeEntryIntoCache,
        syncEntriesFromApi,
        syncUserFromApi,
        syncAll,
        analyzeTextLocally,
        analyzeForOffline,
        buildOfflineEntryPayloadSync,
        buildOfflineEntryPayload,
        saveEntryLocally,
        queuePendingEntry,
        flushPendingEntryCreates,
        flushPendingEntryEdits,
        flushPendingEntryDeletes,
        flushTagSyncQueue,
        init,
        guardOfflineAuth,
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
