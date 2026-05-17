/**
 * DiariCore offline emotion ONNX — browser inference when offline only.
 * Online saves still use /api → Hugging Face Space; this module is never called when online.
 */
(function (global) {
    'use strict';

    const HF_MODEL_ID = 'sseia/diari-core-mood';
    const ML_CACHE = 'diaricore-ml-v2';
    const MODEL_IDB_NAME = 'diariCoreOfflineML';
    const MODEL_IDB_VERSION = 1;
    const MODEL_IDB_STORE = 'onnx';
    const MODEL_IDB_KEY = 'model.onnx';

    /** Same-origin proxy (app.py) — reliable download + progress on mobile PWA. */
    function modelUrl() {
        const origin =
            global.location && global.location.origin ? global.location.origin : '';
        return origin + '/offline-ml/model.onnx';
    }
    const WORKER_URL = '/diari-emotion-onnx-worker.js';
    const TRANSFORMERS_ESM = 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm';
    const PREPARE_TIMEOUT_MS = 120000;
    const MAX_LEN = 256;
    /** Hub file size hint when Content-Length is missing (~1.11 GB, same as HF Space). */
    const MODEL_BYTES_HINT = Math.round(1.11 * 1024 * 1024 * 1024);
    const MODEL_MIN_BYTES = Math.round(0.9 * 1024 * 1024 * 1024);
    const MODEL_TOTAL_LABEL = '1.11 GB';

    let ready = false;
    let preparing = null;
    let tokenizer = null;
    let worker = null;
    let runId = 0;

    let downloadProgress = {
        phase: 'idle',
        loaded: 0,
        total: MODEL_BYTES_HINT,
        percent: 0,
        message: '',
    };

    function isOnline() {
        return global.navigator.onLine !== false;
    }

    /** Phones cannot load ~1.1 GB into a browser tab without crashing (Aw, Snap / OOM). */
    function isMobilePhone() {
        const ua = global.navigator.userAgent || '';
        if (/iPhone|iPod|Mobile/i.test(ua) && !/iPad/i.test(ua)) return true;
        if (/Android/i.test(ua) && !/Tablet/i.test(ua)) return true;
        return (
            global.navigator.maxTouchPoints > 1 &&
            global.innerWidth > 0 &&
            global.innerWidth < 900
        );
    }

    function canUseHeavyOnnx() {
        if (!isMobilePhone()) return true;
        const mem = global.navigator.deviceMemory;
        return typeof mem === 'number' && mem >= 8;
    }

    function getDeviceOnnxMessage() {
        if (canUseHeavyOnnx()) return '';
        return 'This phone cannot run the 1.11 GB model in the browser (it would crash). Offline saves use a local estimate; full AI analysis runs when you sync online.';
    }

    function setDownloadProgress(patch) {
        const next = { ...downloadProgress, ...patch };
        if (next.total > 0 && next.phase !== 'ready' && next.phase !== 'error') {
            next.percent = Math.min(100, Math.round((next.loaded / next.total) * 100));
        }
        if (next.phase === 'ready') {
            next.percent = 100;
        }
        downloadProgress = next;
        try {
            global.dispatchEvent(
                new CustomEvent('diari-emotion-download', { detail: { ...downloadProgress } })
            );
        } catch (_) {
            /* ignore */
        }
    }

    function getDownloadStatus() {
        return { ...downloadProgress };
    }

    function tensorToIntArray(tensor) {
        if (!tensor) return [];
        if (tensor.data) {
            const d = tensor.data;
            if (typeof d.length === 'number') {
                return Array.from(d, (v) => Number(v));
            }
        }
        if (Array.isArray(tensor)) return tensor.map((v) => Number(v));
        return [];
    }

    function openModelIdb() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            const req = indexedDB.open(MODEL_IDB_NAME, MODEL_IDB_VERSION);
            req.onupgradeneeded = () => {
                if (!req.result.objectStoreNames.contains(MODEL_IDB_STORE)) {
                    req.result.createObjectStore(MODEL_IDB_STORE);
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        });
    }

    async function readModelFromIdb() {
        try {
            const db = await openModelIdb();
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(MODEL_IDB_STORE, 'readonly');
                const req = tx.objectStore(MODEL_IDB_STORE).get(MODEL_IDB_KEY);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
            });
        } catch {
            return null;
        }
    }

    async function writeModelToIdb(buf) {
        const db = await openModelIdb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(MODEL_IDB_STORE, 'readwrite');
            tx.objectStore(MODEL_IDB_STORE).put(buf, MODEL_IDB_KEY);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
        });
    }

    async function readCachedModelSize() {
        let size = 0;
        try {
            const cache = await caches.open(ML_CACHE);
            const hit = await cache.match(modelUrl());
            if (hit) {
                const blob = await hit.blob();
                size = Math.max(size, blob.size || 0);
            }
        } catch {
            /* ignore */
        }
        try {
            const idbBuf = await readModelFromIdb();
            if (idbBuf && idbBuf.byteLength) {
                size = Math.max(size, idbBuf.byteLength);
            }
        } catch {
            /* ignore */
        }
        return size;
    }

    async function isModelCached() {
        const size = await readCachedModelSize();
        return size >= MODEL_MIN_BYTES;
    }

    async function persistModelBuffer(buf, cacheKeyUrl) {
        let savedBytes = 0;
        try {
            const cache = await caches.open(ML_CACHE);
            await cache.put(cacheKeyUrl, new Response(buf.slice(0)));
            const hit = await cache.match(cacheKeyUrl);
            if (hit) {
                const blob = await hit.blob();
                savedBytes = blob.size || 0;
            }
        } catch (cacheErr) {
            console.warn('[DiariEmotionOnnx] Cache API save failed:', cacheErr);
        }
        if (savedBytes < MODEL_MIN_BYTES) {
            try {
                await writeModelToIdb(buf);
                const idbBuf = await readModelFromIdb();
                savedBytes = idbBuf && idbBuf.byteLength ? idbBuf.byteLength : 0;
            } catch (idbErr) {
                console.warn('[DiariEmotionOnnx] IndexedDB save failed:', idbErr);
            }
        }
        if (savedBytes < MODEL_MIN_BYTES) {
            throw new Error(
                'Could not save the model on this device (~1.1 GB). Check free space, then tap Download on Profile over Wi‑Fi.'
            );
        }
        return savedBytes;
    }

    function formatLoadedForDisplay(loadedBytes) {
        const n = Math.max(0, Number(loadedBytes) || 0);
        if (n >= 1024 * 1024 * 1024) {
            return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
        }
        if (n >= 1024 * 1024) {
            return Math.round(n / (1024 * 1024)) + ' MB';
        }
        if (n >= 1024) {
            return Math.round(n / 1024) + ' KB';
        }
        return '0 MB';
    }

    function isDownloadActive() {
        return Boolean(
            downloadPromise ||
                downloadProgress.phase === 'connecting' ||
                downloadProgress.phase === 'downloading'
        );
    }

    async function resolveModelDownloadUrl() {
        const origin = global.location && global.location.origin ? global.location.origin : '';
        setDownloadProgress({
            phase: 'connecting',
            loaded: 0,
            total: MODEL_BYTES_HINT,
            percent: 0,
            message: 'Connecting to download server…',
        });

        const resolveRes = await fetch(origin + '/offline-ml/resolve', {
            credentials: 'same-origin',
            cache: 'no-store',
        });
        if (!resolveRes.ok) {
            throw new Error('Resolve failed: ' + resolveRes.status);
        }
        const data = await resolveRes.json().catch(() => ({}));
        if (!data || !data.success || !data.url) {
            throw new Error(data?.error || 'Could not resolve model download URL');
        }
        return data.url;
    }

    /**
     * XHR download — reports byte progress on mobile (fetch streams often stay at 0%).
     */
    function downloadUrlWithProgress(downloadUrl, cacheKeyUrl) {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', downloadUrl, true);
            xhr.responseType = 'arraybuffer';

            xhr.onprogress = (ev) => {
                const total = ev.lengthComputable && ev.total > 0 ? ev.total : MODEL_BYTES_HINT;
                const loaded = ev.loaded || 0;
                setDownloadProgress({
                    phase: 'downloading',
                    loaded,
                    total,
                    message:
                        formatLoadedForDisplay(loaded) +
                        ' / ' +
                        MODEL_TOTAL_LABEL +
                        ' — downloading…',
                });
            };

            xhr.onload = async () => {
                if (xhr.status < 200 || xhr.status >= 300) {
                    reject(new Error('Download failed: HTTP ' + xhr.status));
                    return;
                }
                const buf = xhr.response;
                if (!buf || !buf.byteLength) {
                    reject(new Error('Download returned empty file'));
                    return;
                }
                if (buf.byteLength < MODEL_MIN_BYTES) {
                    reject(
                        new Error(
                            'Download incomplete (' +
                                formatLoadedForDisplay(buf.byteLength) +
                                '). Tap Download again on Wi‑Fi.'
                        )
                    );
                    return;
                }
                let size = buf.byteLength;
                try {
                    size = await persistModelBuffer(buf, cacheKeyUrl);
                } catch (persistErr) {
                    reject(persistErr);
                    return;
                }
                setDownloadProgress({
                    phase: 'ready',
                    loaded: size,
                    total: size,
                    percent: 100,
                    message: 'Offline emotion model ready',
                });
                resolve(buf);
            };

            xhr.onerror = () => reject(new Error('Network error during model download'));
            xhr.onabort = () => reject(new Error('Model download cancelled'));
            xhr.send();
        });
    }

    async function fetchModelBuffer() {
        const url = modelUrl();
        const cachedSize = await readCachedModelSize();
        if (cachedSize >= MODEL_MIN_BYTES) {
            setDownloadProgress({
                phase: 'ready',
                loaded: cachedSize,
                total: cachedSize,
                percent: 100,
                message: 'Offline emotion model ready',
            });
            try {
                const cache = await caches.open(ML_CACHE);
                const res = await cache.match(url);
                if (res) {
                    const blob = await res.blob();
                    if ((blob.size || 0) >= MODEL_MIN_BYTES) {
                        return blob.arrayBuffer();
                    }
                }
            } catch {
                /* fall through to IndexedDB */
            }
            const idbBuf = await readModelFromIdb();
            if (idbBuf && idbBuf.byteLength >= MODEL_MIN_BYTES) {
                return idbBuf;
            }
        } else if (cachedSize > 0) {
            try {
                const cache = await caches.open(ML_CACHE);
                await cache.delete(url);
            } catch {
                /* ignore */
            }
            setDownloadProgress({
                phase: 'error',
                loaded: cachedSize,
                total: MODEL_BYTES_HINT,
                percent: 0,
                message:
                    'Cached file incomplete (' +
                    formatLoadedForDisplay(cachedSize) +
                    '). Tap Download on Profile (Wi‑Fi).',
            });
            throw new Error('Cached model file is too small');
        }

        if (!isOnline()) {
            setDownloadProgress({
                phase: 'unavailable',
                loaded: 0,
                total: MODEL_BYTES_HINT,
                percent: 0,
                message: 'Connect online once to download the offline model',
            });
            throw new Error('Emotion model not cached; connect once while online to download it.');
        }

        setDownloadProgress({
            phase: 'downloading',
            loaded: 0,
            total: MODEL_BYTES_HINT,
            percent: 0,
            message: '0 MB / ' + MODEL_TOTAL_LABEL + ' — starting…',
        });

        try {
            const cdnUrl = await resolveModelDownloadUrl();
            return await downloadUrlWithProgress(cdnUrl, url);
        } catch (resolveErr) {
            console.warn('[DiariEmotionOnnx] CDN resolve failed, trying app URL:', resolveErr);
        }

        setDownloadProgress({
            phase: 'downloading',
            loaded: 0,
            total: MODEL_BYTES_HINT,
            percent: 0,
            message: '0 MB / ' + MODEL_TOTAL_LABEL + ' — starting…',
        });

        return downloadUrlWithProgress(url, url);
    }

    function createWorker() {
        return new Promise((resolve, reject) => {
            const w = new Worker(WORKER_URL);
            const timeout = setTimeout(() => {
                w.terminate();
                reject(new Error('Worker init timeout'));
            }, 180000);

            w.onmessage = (ev) => {
                const data = ev.data || {};
                if (data.type === 'ready') {
                    clearTimeout(timeout);
                    resolve(w);
                } else if (data.type === 'error' && !data.id) {
                    clearTimeout(timeout);
                    reject(new Error(data.message || 'Worker error'));
                }
            };

            w.onerror = (e) => {
                clearTimeout(timeout);
                reject(e.error || new Error('Worker failed'));
            };

            setDownloadProgress({
                phase: 'initializing',
                message: 'Starting offline analysis engine…',
            });

            fetchModelBuffer()
                .then((buf) => {
                    w.postMessage({ type: 'init', model: buf }, [buf]);
                })
                .catch((err) => {
                    clearTimeout(timeout);
                    reject(err);
                });
        });
    }

    async function loadTokenizer() {
        setDownloadProgress({
            phase: 'tokenizer',
            loaded: 0,
            total: 22 * 1024 * 1024,
            percent: 0,
            message: 'Downloading tokenizer files…',
        });

        let mod;
        try {
            mod = await import(/* webpackIgnore: true */ TRANSFORMERS_ESM);
        } catch (cdnErr) {
            console.warn('[DiariEmotionOnnx] Transformers CDN import failed:', cdnErr);
            throw cdnErr;
        }
        const { AutoTokenizer, env } = mod;
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends && env.backends.onnx && env.backends.onnx.wasm) {
            env.backends.onnx.wasm.numThreads = 1;
        }

        return AutoTokenizer.from_pretrained(HF_MODEL_ID, {
            progress_callback: (data) => {
                if (!data || data.status !== 'progress') return;
                const loaded = Number(data.loaded || 0);
                const total = Number(data.total || 22 * 1024 * 1024);
                setDownloadProgress({
                    phase: 'tokenizer',
                    loaded,
                    total,
                    message: 'Downloading tokenizer files…',
                });
            },
        });
    }

    async function refreshCachedReadyState() {
        if (ready) {
            setDownloadProgress({
                phase: 'ready',
                loaded: downloadProgress.total || MODEL_BYTES_HINT,
                total: downloadProgress.total || MODEL_BYTES_HINT,
                percent: 100,
                message: 'Offline emotion model ready',
            });
            return;
        }
        const cached = await isModelCached();
        if (cached) {
            const size = await readCachedModelSize();
            setDownloadProgress({
                phase: 'ready',
                loaded: size || MODEL_BYTES_HINT,
                total: size || MODEL_BYTES_HINT,
                percent: 100,
                message: 'Offline emotion model ready',
            });
        } else if (!isOnline()) {
            setDownloadProgress({
                phase: 'unavailable',
                loaded: 0,
                total: MODEL_BYTES_HINT,
                percent: 0,
                message: 'Connect online once to download the offline model',
            });
        } else if (isDownloadActive()) {
            /* Do not reset progress while a download is running */
            return;
        } else if (!preparing) {
            setDownloadProgress({
                phase: 'idle',
                loaded: 0,
                total: MODEL_BYTES_HINT,
                percent: 0,
                message: 'Tap Download to save ' + MODEL_TOTAL_LABEL + ' for offline use',
            });
        }
    }

    /**
     * Load tokenizer + worker when model bytes are already on device (works offline if
     * tokenizer/CDN were cached during a prior online prepare).
     */
    async function ensurePreparedForInference() {
        if (!canUseHeavyOnnx()) return false;
        if (ready) return true;
        const cached = await isModelCached();
        if (!cached) return false;
        if (preparing) {
            try {
                await preparing;
                return ready;
            } catch {
                return false;
            }
        }
        try {
            await Promise.race([
                prepare(),
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Offline model prepare timeout')), PREPARE_TIMEOUT_MS);
                }),
            ]);
            return ready;
        } catch (e) {
            console.warn('[DiariEmotionOnnx] ensurePreparedForInference:', e.message || e);
            return false;
        }
    }

    async function prepare() {
        if (!canUseHeavyOnnx()) {
            throw new Error(getDeviceOnnxMessage());
        }
        if (ready) {
            await refreshCachedReadyState();
            return true;
        }
        if (preparing) return preparing;

        preparing = (async () => {
            if (!global.DiariEmotionPipeline) {
                throw new Error('DiariEmotionPipeline not loaded');
            }
            const [tok, w] = await Promise.all([loadTokenizer(), createWorker()]);
            tokenizer = tok;
            worker = w;
            ready = true;
            const size = await readCachedModelSize();
            setDownloadProgress({
                phase: 'ready',
                loaded: size || MODEL_BYTES_HINT,
                total: size || MODEL_BYTES_HINT,
                percent: 100,
                message: 'Offline emotion model ready',
            });
            return true;
        })();

        try {
            return await preparing;
        } catch (e) {
            preparing = null;
            if (downloadProgress.phase !== 'unavailable') {
                setDownloadProgress({
                    phase: 'error',
                    message: (e && e.message) || 'Offline model setup failed',
                });
            }
            throw e;
        }
    }

    function runInference(inputIds, attentionMask) {
        return new Promise((resolve, reject) => {
            if (!worker) {
                reject(new Error('Worker not ready'));
                return;
            }
            const id = ++runId;
            const onMsg = (ev) => {
                const data = ev.data || {};
                if (data.type === 'result' && data.id === id) {
                    worker.removeEventListener('message', onMsg);
                    resolve(data.logits);
                } else if (data.type === 'error' && data.id === id) {
                    worker.removeEventListener('message', onMsg);
                    reject(new Error(data.message || 'Inference failed'));
                }
            };
            worker.addEventListener('message', onMsg);
            worker.postMessage({
                type: 'run',
                id,
                inputIds,
                attentionMask,
            });
        });
    }

    async function analyze(text) {
        const clean = (text || '').trim();
        if (!clean) {
            return global.DiariEmotionPipeline.fallback(clean);
        }

        await prepare();

        const encoded = await tokenizer(clean, {
            add_special_tokens: true,
            max_length: MAX_LEN,
            padding: 'max_length',
            truncation: true,
        });

        const inputIds = tensorToIntArray(encoded.input_ids);
        const attentionMask = tensorToIntArray(encoded.attention_mask);

        const logits = await runInference(inputIds, attentionMask);
        return global.DiariEmotionPipeline.analyzeFromLogits(clean, logits);
    }

    let downloadPromise = null;

    /** Download model.onnx into Cache API (shows progress events). */
    function startModelDownload() {
        if (!isOnline()) {
            setDownloadProgress({
                phase: 'unavailable',
                message: 'Connect to Wi‑Fi to download the offline model',
            });
            return Promise.reject(new Error('offline'));
        }
        if (downloadPromise) return downloadPromise;
        downloadPromise = (async () => {
            try {
                await fetchModelBuffer();
            } finally {
                downloadPromise = null;
            }
        })();
        return downloadPromise;
    }

    /** Warm tokenizer + worker when model is on device (online or offline). */
    function prepareInBackground() {
        if (!canUseHeavyOnnx() || ready || preparing) return;
        void (async () => {
            try {
                const cached = await isModelCached();
                if (!cached) {
                    if (!isOnline()) return;
                    await startModelDownload();
                }
                await ensurePreparedForInference();
            } catch (e) {
                console.info('[DiariEmotionOnnx] Background prepare skipped:', e.message || e);
            }
        })();
    }

    global.DiariEmotionOnnx = {
        prepare,
        ensurePreparedForInference,
        analyze,
        canUseHeavyOnnx,
        isMobilePhone,
        getDeviceOnnxMessage,
        isReady: () => ready,
        isPreparing: () => Boolean(preparing),
        isModelCached,
        getDownloadStatus,
        refreshCachedReadyState,
        startModelDownload,
        prepareInBackground,
        get MODEL_URL() {
            return modelUrl();
        },
        MODEL_BYTES_HINT,
        MODEL_TOTAL_LABEL,
        formatLoadedForDisplay,
        isDownloadActive,
    };

    void refreshCachedReadyState();
})(typeof window !== 'undefined' ? window : self);
