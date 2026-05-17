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
                try {
                    const cache = await caches.open(ML_CACHE);
                    await cache.put(cacheKeyUrl, new Response(buf));
                } catch (cacheErr) {
                    console.warn('[DiariEmotionOnnx] Cache write failed:', cacheErr);
                }
                const size = buf.byteLength;
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
            const size = blob.size || 0;
            if (size < MODEL_MIN_BYTES) {
                await cache.delete(url);
                setDownloadProgress({
                    phase: 'error',
                    loaded: size,
                    total: MODEL_BYTES_HINT,
                    percent: 0,
                    message:
                        'Cached file incomplete (' +
                        formatLoadedForDisplay(size) +
                        '). Tap Download on Profile (Wi‑Fi).',
                });
                throw new Error('Cached model file is too small');
            }
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
        MODEL_TOTAL_LABEL,
        formatLoadedForDisplay,
        isDownloadActive,
    };

    void refreshCachedReadyState();
})(typeof window !== 'undefined' ? window : self);
