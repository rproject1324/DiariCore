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
        if (!isPwaStandalone()) return false;
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
        const id = String(entry.id ?? '');
        if (id.startsWith('offline_')) return true;
        return entry.pendingServerAnalysis === true || entry.moodScoringOffline === true;
    }

    /** Keep unsynced PWA offline drafts when refreshing from the server. */
    function mergeServerEntriesWithLocal(serverEntries, userId) {
        const server = Array.isArray(serverEntries) ? serverEntries : [];
        if (!isPwaStandalone()) {
            writeEntriesCache(server, userId);
            return server;
        }
        const local = readEntriesCache();
        const pending = local.filter((e) => isOfflineLocalEntry(e));
        if (!pending.length) {
            writeEntriesCache(server, userId);
            return server;
        }
        const serverIds = new Set(server.map((e) => String(e?.id ?? '')));
        const kept = pending.filter((e) => {
            const id = String(e?.id ?? '');
            return !serverIds.has(id);
        });
        const merged = [...server, ...kept];
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
        if (pendingImages.length > 0) {
            slimEntry.offlinePendingImages = pendingImages.length;
        }

        let queueOk = false;
        try {
            await queuePendingEntry(payload.queueRecord);
            queueOk = true;
        } catch (queueErr) {
            console.warn('[DiariOffline] IndexedDB queue skipped:', queueErr);
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
            reachable = isPwaStandalone() ? await probeReachability() : true;
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
                    removeOfflineEntryByLocalId(item.localEntryId, userId);
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

    async function reanalyzeCachedFallbackEntries() {
        if (!isOnline() || !isPwaStandalone()) return;
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

    async function syncAll() {
        if (!isPwaStandalone()) return;
        if (!isOnline()) return;
        if (!(await probeReachability())) return;
        global.dispatchEvent(new CustomEvent('diari-offline-sync'));
        await flushPendingEntryCreates();
        await flushPendingEntryEdits();
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
        if (!isPwaStandalone()) return;
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
        saveEntryLocally,
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
