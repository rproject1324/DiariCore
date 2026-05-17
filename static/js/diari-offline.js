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

    /** Quick same-origin probe — catches airplane mode when navigator.onLine lies. */
    async function probeReachability() {
        if (!isOnline()) return false;
        try {
            const ctrl = new AbortController();
            const timer = global.setTimeout(() => ctrl.abort(), 3500);
            const res = await fetch(
                (global.location?.origin || '') + '/diariclogo.png?dcReach=' + Date.now(),
                { method: 'GET', cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal }
            );
            global.clearTimeout(timer);
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * True when the entry should be saved locally (PWA airplane mode, offline events, or no network).
     */
    async function shouldSaveEntryOffline() {
        if (!isOnline()) return true;
        if (isPwaStandalone()) {
            return !(await probeReachability());
        }
        return false;
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
        return user?.isLoggedIn ? Number(user.id || 0) : 0;
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

    function writeEntriesCache(entries, userId) {
        try {
            global.localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries));
            if (userId) global.localStorage.setItem(ENTRIES_OWNER_KEY, String(userId));
        } catch (e) {
            console.warn('[DiariOffline] Failed to write entries cache:', e);
        }
    }

    function mergeEntryIntoCache(entry, userId) {
        if (!entry) return;
        const list = readEntriesCache();
        const id = entry.id;
        if (id != null && id !== '') {
            const idx = list.findIndex((e) => Number(e?.id) === Number(id));
            if (idx >= 0) list[idx] = { ...list[idx], ...entry };
            else list.unshift(entry);
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

    async function pendingEntriesGetAll() {
        const db = await openPendingEntriesDb();
        const rows = await new Promise((resolve, reject) => {
            const tx = db.transaction(PENDING_ENTRIES_STORE, 'readonly');
            const req = tx.objectStore(PENDING_ENTRIES_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
        db.close();
        return rows;
    }

    async function pendingEntryDelete(id) {
        const db = await openPendingEntriesDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(PENDING_ENTRIES_STORE, 'readwrite');
            tx.objectStore(PENDING_ENTRIES_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        db.close();
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

    /**
     * Lightweight local emotion estimate when the API is unreachable.
     */
    const OFFLINE_ONNX_PREPARE_MS = 15000;

    function formatOfflineAnalysis(result) {
        return {
            ...result,
            feeling: result.feeling || result.emotionLabel,
            moodScoringOffline: result.moodScoringOffline === true,
        };
    }

    /**
     * Offline emotion analysis: use cached ONNX only if already loaded.
     * Never blocks on a multi‑minute Hub download while offline.
     */
    async function analyzeForOffline(text) {
        if (global.DiariEmotionOnnx?.isReady?.()) {
            try {
                const result = await global.DiariEmotionOnnx.analyze(text);
                if (result && result.emotionLabel) {
                    return formatOfflineAnalysis(result);
                }
            } catch (err) {
                console.warn(
                    '[DiariOffline] Cached ONNX analyze failed, using heuristic:',
                    err && err.message ? err.message : err
                );
            }
            return analyzeTextLocally(text);
        }

        if (!isOnline()) {
            if (global.DiariEmotionOnnx) {
                console.info(
                    '[DiariOffline] Offline without cached ONNX — fast local estimate (sync when online for full model)'
                );
            }
            return analyzeTextLocally(text);
        }

        if (global.DiariEmotionOnnx && global.DiariEmotionPipeline) {
            try {
                const cached = await global.DiariEmotionOnnx.isModelCached();
                if (!cached) {
                    return analyzeTextLocally(text);
                }
                await Promise.race([
                    global.DiariEmotionOnnx.prepare(),
                    new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('ONNX prepare timeout')), OFFLINE_ONNX_PREPARE_MS);
                    }),
                ]);
                const result = await global.DiariEmotionOnnx.analyze(text);
                if (result && result.emotionLabel) {
                    return formatOfflineAnalysis(result);
                }
            } catch (err) {
                console.warn(
                    '[DiariOffline] Browser ONNX analyze unavailable, using heuristic:',
                    err && err.message ? err.message : err
                );
            }
        }
        return analyzeTextLocally(text);
    }

    /** Sync payload when async analysis must not block UI recovery. */
    function buildOfflineEntryPayloadSync({ userId, title, entryDateTimeLocal, text, tags, images }) {
        const analysis = analyzeTextLocally(text);
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
        };
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

        if (!isOnline()) {
            return { ok: true, offline: true, entries: readEntriesCache(), fromCache: true };
        }

        try {
            const fetchFn = global.DiariSecurity?.apiFetch || global.fetch;
            const response = await fetchFn('/api/entries', { credentials: 'same-origin' });
            const result = await response.json().catch(() => ({}));
            if (response.status === 401) {
                global.localStorage.setItem(ENTRIES_KEY, '[]');
                global.localStorage.removeItem(ENTRIES_OWNER_KEY);
                return { ok: false, offline: false, entries: [] };
            }
            if (!response.ok || !result.success || !Array.isArray(result.entries)) {
                return { ok: false, offline: false, entries: readEntriesCache(), fromCache: true };
            }
            writeEntriesCache(result.entries, userId);
            return { ok: true, offline: false, entries: result.entries };
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
                mergeEntryIntoCache(result.entry, userId);
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

                const res = await fetchFn(`/api/entries/${row.entryId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (res.ok && data.success && data.entry) {
                    mergeEntryIntoCache(data.entry, userId);
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

    async function syncAll() {
        if (!isOnline()) return;
        global.dispatchEvent(new CustomEvent('diari-offline-sync'));
        await flushPendingEntryCreates();
        await flushPendingEntryEdits();
        await flushTagSyncQueue();
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
        probeReachability,
        shouldSaveEntryOffline,
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
        queuePendingEntry,
        flushPendingEntryCreates,
        flushPendingEntryEdits,
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
