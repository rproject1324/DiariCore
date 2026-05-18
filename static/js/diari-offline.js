/**
 * DiariCore offline layer: cached entries, sync queues, local emotion analysis, auth guard.
 */
(function (global) {
    'use strict';

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
            global.navigator.standalone === true
        );
    }

    /**
     * Live network check — must hit /api (never served from SW precache).
     * Do NOT use /diariclogo.png: the service worker returns cached 200 while offline.
     */
    async function probeReachability() {
        if (!isOnline()) return false;
        try {
            const ctrl = new AbortController();
            const timer = global.setTimeout(() => ctrl.abort(), 4500);
            const res = await fetch('/api/health?dcReach=' + Date.now(), {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                signal: ctrl.signal,
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            global.clearTimeout(timer);
            if (!res.ok) return false;
            const data = await res.json().catch(() => ({}));
            return data && data.ok === true;
        } catch {
            return false;
        }
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
        if (!user?.isLoggedIn) return 0;
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

    function writeEntriesCache(entries, userId) {
        try {
            global.localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
            if (userId) global.localStorage.setItem(ENTRIES_OWNER_KEY, String(userId));
            return true;
        } catch (e) {
            console.warn('[DiariOffline] Failed to write entries cache:', e);
            return false;
        }
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
        return (
            isPwaStandalone() ||
            (global.document &&
                global.document.documentElement.classList.contains('diari-pwa-standalone'))
        );
    }

    function getEntrySyncLabel(entry) {
        if (!isPwaUiContext() || !entry) return null;
        if (entry.pwaDeletionPending === true) {
            return { text: 'Deletion Pending', kind: 'delete' };
        }
        if (entry.pwaEditPending === true) {
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

    function markEntryEditPendingInCache(entryKey, patch, userId) {
        const list = readEntriesCache();
        const idx = findEntryIndexInCache(list, entryKey);
        if (idx < 0) return null;
        list[idx] = {
            ...list[idx],
            ...(patch || {}),
            pwaEditPending: true,
            pwaDeletionPending: false,
        };
        writeEntriesCache(list, userId);
        return list[idx];
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
            if (loc.pwaDeletionPending === true) {
                return { ...s, pwaDeletionPending: true, pwaEditPending: false };
            }
            if (loc.pwaEditPending === true) {
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
                patch.pendingServerAnalysis = false;
                patch.moodScoringOffline = false;
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

    async function syncEntriesFromApi() {
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

        let reachable = false;
        if (isOnline()) {
            reachable = isPwaUiContext() ? await probeReachability() : true;
        }
        if (!reachable) {
            return { ok: true, offline: true, entries: readEntriesCache(), fromCache: true };
        }

        try {
            const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
            const response = await fetchFn('/api/entries', {
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            const result = await response.json().catch(() => ({}));
            if (response.status === 401) {
                global.localStorage.setItem(ENTRIES_KEY, '[]');
                global.localStorage.removeItem(ENTRIES_OWNER_KEY);
                return { ok: false, offline: false, entries: [] };
            }
            if (!response.ok || !result.success || !Array.isArray(result.entries)) {
                return { ok: false, offline: false, entries: readEntriesCache(), fromCache: true };
            }
            const merged = mergeServerEntriesWithLocal(result.entries, userId);
            return { ok: true, offline: false, entries: merged };
        } catch (err) {
            console.warn('[DiariOffline] syncEntriesFromApi failed, using cache:', err);
            return { ok: false, offline: true, entries: readEntriesCache(), fromCache: true };
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

    async function flushPendingEntryEdits() {
        if (!isOnline()) return;
        const userId = getUserId();
        if (!userId) return;

        const q = readEditQueue();
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
                let imageUrls = Array.isArray(row.imageUrls) ? [...row.imageUrls] : [];
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
                    title: row.title,
                    text: row.text,
                    tags: row.tags,
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
        return readEntriesCache().some((e) => isOfflineLocalEntry(e));
    }

    async function syncAll() {
        if (!isPwaUiContext()) return;
        if (!isOnline()) return;

        let reachable = await probeReachability();
        if (!reachable) {
            await new Promise((r) => global.setTimeout(r, 600));
            reachable = await probeReachability();
        }
        if (!reachable) return;

        global.dispatchEvent(new CustomEvent('diari-offline-sync'));
        await flushPendingEntryCreates();
        await flushPendingEntryEdits();
        await flushPendingEntryDeletes();
        await flushTagSyncQueue();
        await reanalyzeCachedFallbackEntries();
        await syncEntriesFromApi();
        global.dispatchEvent(new CustomEvent('diari-offline-sync-complete'));
    }

    function guardOfflineAuth() {
        const page = (global.location.pathname || '').split('/').pop() || 'login.html';
        if (PUBLIC_PAGES.has(page)) return;
        const user = getSessionUser();
        if (user?.isLoggedIn) return;
        if (isOnline()) {
            global.location.href = 'login.html';
            return;
        }
        const cached = readEntriesCache();
        if (cached.length > 0) return;
        global.location.href = 'login.html';
    }

    function init() {
        if (!isPwaUiContext()) return;
        guardOfflineAuth();
        global.addEventListener('online', () => {
            void syncAll();
        });
        if (isOnline()) {
            void syncAll();
        }
    }

    global.DiariOffline = {
        isOnline,
        isPwaStandalone,
        isPwaUiContext,
        hasPendingOfflineWork,
        probeReachability,
        shouldActOffline,
        shouldSaveEntryOffline,
        getEntrySyncLabel,
        markEntryEditPendingInCache,
        markEntryDeletionPending,
        getSessionUser,
        getUserId,
        readEntriesCache,
        writeEntriesCache,
        mergeEntryIntoCache,
        syncEntriesFromApi,
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
