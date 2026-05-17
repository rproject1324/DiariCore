/**
 * DiariCore offline emotion ONNX — browser inference when offline only.
 * Online saves still use /api → Hugging Face Space; this module is never called when online.
 */
(function (global) {
    'use strict';

    const HF_MODEL_ID = 'sseia/diari-core-mood';
    const ML_CACHE = 'diaricore-ml-v2';

    /** Same-origin proxy (app.py) — reliable download + progress on mobile PWA. */
    function modelUrl() {
        const origin =
            global.location && global.location.origin ? global.location.origin : '';
        return origin + '/offline-ml/model.onnx';
    }
    const WORKER_URL = '/diari-emotion-onnx-worker.js';
    const MAX_LEN = 256;
    /** Hub file size hint when Content-Length is missing (~1.11 GB, same as HF Space). */
    const MODEL_BYTES_HINT = Math.round(1.11 * 1024 * 1024 * 1024);

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

    async function isModelCached() {
        try {
            const cache = await caches.open(ML_CACHE);
            const hit = await cache.match(modelUrl());
            return Boolean(hit);
        } catch {
            return false;
        }
    }

    async function fetchModelResponse(cacheKeyUrl) {
        const origin = global.location && global.location.origin ? global.location.origin : '';

        try {
            const resolveRes = await fetch(origin + '/offline-ml/resolve', {
                credentials: 'same-origin',
                cache: 'no-store',
            });
            if (resolveRes.ok) {
                const data = await resolveRes.json().catch(() => ({}));
                if (data && data.success && data.url) {
                    const cdnRes = await fetch(data.url, {
                        mode: 'cors',
                        credentials: 'omit',
                        cache: 'no-store',
                    });
                    if (cdnRes.ok) {
                        return cdnRes;
                    }
                    console.warn(
                        '[DiariEmotionOnnx] CDN fetch failed:',
                        cdnRes.status,
                        '— trying app proxy'
                    );
                }
            }
        } catch (resolveErr) {
            console.warn('[DiariEmotionOnnx] resolve failed, trying proxy:', resolveErr);
        }

        return fetch(cacheKeyUrl, {
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'follow',
        });
    }

    async function readCachedModelSize() {
        try {
            const cache = await caches.open(ML_CACHE);
            const hit = await cache.match(modelUrl());
            if (!hit) return 0;
            const blob = await hit.blob();
            return blob.size || 0;
        } catch {
            return 0;
        }
    }

    async function fetchModelBuffer() {
        const cache = await caches.open(ML_CACHE);
        const url = modelUrl();
        let res = await cache.match(url);

        if (res) {
            const blob = await res.blob();
            const size = blob.size || MODEL_BYTES_HINT;
            setDownloadProgress({
                phase: 'ready',
                loaded: size,
                total: size,
                percent: 100,
                message: 'Offline emotion model ready',
            });
            return blob.arrayBuffer();
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
            message: 'Downloading offline emotion model…',
        });

        const response = await fetchModelResponse(url);
        if (!response.ok) {
            setDownloadProgress({
                phase: 'error',
                message: 'Model download failed (' + response.status + '). Use Wi‑Fi and tap Download again.',
            });
            throw new Error('Model download failed: ' + response.status);
        }

        const total =
            Number(response.headers.get('content-length')) || MODEL_BYTES_HINT;
        setDownloadProgress({
            phase: 'downloading',
            loaded: 0,
            total,
            percent: 0,
            message: 'Downloading offline emotion model…',
        });

        if (!response.body || typeof response.body.getReader !== 'function') {
            const buf = await response.arrayBuffer();
            await cache.put(url, new Response(buf));
            setDownloadProgress({
                phase: 'ready',
                loaded: buf.byteLength,
                total: buf.byteLength || total,
                percent: 100,
                message: 'Offline emotion model ready',
            });
            return buf;
        }

        const reader = response.body.getReader();
        const chunks = [];
        let loaded = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength;
            setDownloadProgress({
                phase: 'downloading',
                loaded,
                total,
                message: 'Downloading offline emotion model…',
            });
        }

        const merged = new Uint8Array(loaded);
        let offset = 0;
        for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.byteLength;
        }

        await cache.put(url, new Response(merged.buffer));
        setDownloadProgress({
            phase: 'ready',
            loaded,
            total: loaded || total,
            percent: 100,
            message: 'Offline emotion model ready',
        });
        return merged.buffer;
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

        const mod = await import(
            /* webpackIgnore: true */ 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm'
        );
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
        } else if (!preparing) {
            setDownloadProgress({
                phase: 'idle',
                loaded: 0,
                total: MODEL_BYTES_HINT,
                percent: 0,
                message: 'Offline model will download in the background',
            });
        }
    }

    async function prepare() {
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

    /** Fire-and-forget cache warm-up while online; does not change online API behavior. */
    function prepareInBackground() {
        if (!isOnline() || ready || preparing) return;
        void (async () => {
            try {
                await startModelDownload();
                await prepare();
            } catch (e) {
                console.info('[DiariEmotionOnnx] Background prepare skipped:', e.message || e);
            }
        })();
    }

    global.DiariEmotionOnnx = {
        prepare,
        analyze,
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
    };

    void refreshCachedReadyState();
})(typeof window !== 'undefined' ? window : self);
