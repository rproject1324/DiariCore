/**
 * PWA-only: offline emotion model download status on Profile (installed app).
 * Hidden in browser tabs (desktop/mobile) — no change to deployed web UX.
 */
(function () {
    'use strict';

    function isPwaStandalone() {
        if (window.DiariPWA && typeof window.DiariPWA.isStandalone === 'function') {
            return window.DiariPWA.isStandalone();
        }
        return (
            document.documentElement.classList.contains('diari-pwa-standalone') ||
            window.matchMedia('(display-mode: standalone)').matches ||
            window.navigator.standalone === true
        );
    }

    function totalLabel() {
        return window.DiariEmotionOnnx?.MODEL_TOTAL_LABEL || '1.11 GB';
    }

    function formatLoaded(loadedBytes) {
        if (window.DiariEmotionOnnx?.formatLoadedForDisplay) {
            return window.DiariEmotionOnnx.formatLoadedForDisplay(loadedBytes);
        }
        const n = Math.max(0, Number(loadedBytes) || 0);
        if (n >= 1024 * 1024) {
            return Math.round(n / (1024 * 1024)) + ' MB';
        }
        return '0 MB';
    }

    /** Always "59 MB / 1.11 GB" style (never "Up to 1.11 GB"). */
    function formatLiveSize(loadedBytes, totalBytes) {
        return formatLoaded(loadedBytes) + ' / ' + totalLabel();
    }

    function bindProfileOfflineModelStatus() {
        if (!isPwaStandalone()) return;

        const root = document.getElementById('pwaOfflineModelStatus');
        if (!root || root.dataset.bound === '1') return;
        root.dataset.bound = '1';
        root.hidden = false;

        const titleEl = root.querySelector('.pwa-offline-model-status__title');
        const barWrap = root.querySelector('.pwa-offline-model-status__bar');
        const barFill = root.querySelector('.pwa-offline-model-status__bar-fill');
        const pctEl = root.querySelector('.pwa-offline-model-status__pct');
        const sizeEl = root.querySelector('.pwa-offline-model-status__size');
        const hintEl = root.querySelector('.pwa-offline-model-status__hint');
        const downloadBtn = document.getElementById('pwaOfflineModelDownloadBtn');

        let pollTimer = null;

        function updateDownloadButton(detail) {
            if (!downloadBtn) return;
            const phase = detail?.phase || 'idle';
            const online = navigator.onLine !== false;
            const active =
                phase === 'connecting' ||
                phase === 'downloading' ||
                phase === 'tokenizer' ||
                phase === 'initializing' ||
                (window.DiariEmotionOnnx?.isDownloadActive && window.DiariEmotionOnnx.isDownloadActive());
            if (active && online) {
                downloadBtn.hidden = false;
                downloadBtn.disabled = true;
                downloadBtn.textContent = 'Downloading…';
                return;
            }
            const show = online && phase !== 'ready';
            downloadBtn.hidden = !show;
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download for offline use';
        }

        function render(detail) {
            if (!detail) return;

            const phase = detail.phase || 'idle';
            const loaded = Number(detail.loaded) || 0;
            const total = Number(detail.total) || window.DiariEmotionOnnx?.MODEL_BYTES_HINT || 0;
            const pct = Number(detail.percent) || 0;

            root.classList.toggle('is-ready', phase === 'ready');
            root.classList.toggle('is-error', phase === 'error' || phase === 'unavailable');
            root.classList.toggle(
                'is-active',
                phase === 'connecting' ||
                    phase === 'downloading' ||
                    phase === 'tokenizer' ||
                    phase === 'initializing'
            );

            if (titleEl) {
                if (phase === 'ready') {
                    titleEl.textContent = 'Offline emotion model';
                } else if (phase === 'connecting') {
                    titleEl.textContent = 'Starting download…';
                } else if (phase === 'downloading') {
                    titleEl.textContent = 'Downloading offline model';
                } else if (phase === 'tokenizer') {
                    titleEl.textContent = 'Downloading tokenizer';
                } else if (phase === 'initializing') {
                    titleEl.textContent = 'Preparing offline model';
                } else if (phase === 'error') {
                    titleEl.textContent = 'Offline model download failed';
                } else if (phase === 'unavailable') {
                    titleEl.textContent = 'Offline model not downloaded';
                } else {
                    titleEl.textContent = 'Offline emotion model';
                }
            }

            const pctClamped = Math.min(100, Math.max(0, pct));
            if (barFill) {
                barFill.style.width = pctClamped + '%';
            }
            if (barWrap) {
                barWrap.setAttribute('aria-valuenow', String(pctClamped));
            }
            if (pctEl) {
                pctEl.textContent = phase === 'ready' ? '100%' : pctClamped + '%';
            }
            if (sizeEl) {
                if (phase === 'ready') {
                    const saved =
                        loaded >= 1024 * 1024 * 1024 * 0.9
                            ? formatLoaded(loaded)
                            : totalLabel();
                    sizeEl.textContent = saved + ' saved on device';
                } else {
                    sizeEl.textContent = formatLiveSize(loaded, total);
                }
            }
            if (hintEl) {
                hintEl.textContent = detail.message || '';
            }

            updateDownloadButton(detail);

            if (
                phase === 'connecting' ||
                phase === 'downloading' ||
                phase === 'tokenizer' ||
                phase === 'initializing'
            ) {
                if (!pollTimer) {
                    pollTimer = window.setInterval(refresh, 250);
                }
            } else if (pollTimer) {
                window.clearInterval(pollTimer);
                pollTimer = null;
            }
        }

        function refresh() {
            if (window.DiariEmotionOnnx?.getDownloadStatus) {
                render(window.DiariEmotionOnnx.getDownloadStatus());
            }
        }

        async function startDownload() {
            if (!window.DiariEmotionOnnx?.startModelDownload) return;
            if (navigator.onLine === false) {
                render({
                    phase: 'unavailable',
                    loaded: 0,
                    total: window.DiariEmotionOnnx?.MODEL_BYTES_HINT || 0,
                    percent: 0,
                    message: 'Turn off airplane mode and use Wi‑Fi to download (~1.1 GB)',
                });
                return;
            }

            render({
                phase: 'connecting',
                loaded: 0,
                total: window.DiariEmotionOnnx?.MODEL_BYTES_HINT || 0,
                percent: 0,
                message: '0 MB / ' + totalLabel() + ' — connecting…',
            });

            try {
                await window.DiariEmotionOnnx.startModelDownload();
            } catch (e) {
                console.warn('[PWA] Model download:', e);
                render({
                    phase: 'error',
                    loaded: 0,
                    total: window.DiariEmotionOnnx?.MODEL_BYTES_HINT || 0,
                    percent: 0,
                    message: (e && e.message) || 'Download failed. Tap Download to retry on Wi‑Fi.',
                });
            } finally {
                refresh();
            }
        }

        document.addEventListener('diari-emotion-download', (ev) => {
            render(ev.detail);
        });

        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => {
                void startDownload();
            });
        }

        void (async () => {
            if (window.DiariEmotionOnnx?.refreshCachedReadyState) {
                await window.DiariEmotionOnnx.refreshCachedReadyState();
            }
            const cached =
                window.DiariEmotionOnnx?.isModelCached &&
                (await window.DiariEmotionOnnx.isModelCached());
            refresh();
            if (cached) return;
            const st = window.DiariEmotionOnnx?.getDownloadStatus?.();
            if (
                navigator.onLine !== false &&
                st &&
                st.phase !== 'ready' &&
                st.phase !== 'connecting' &&
                st.phase !== 'downloading'
            ) {
                void startDownload();
            }
        })();

        window.addEventListener('online', () => {
            refresh();
            const st = window.DiariEmotionOnnx?.getDownloadStatus?.();
            if (st && st.phase !== 'ready' && st.phase !== 'downloading' && st.phase !== 'connecting') {
                void startDownload();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindProfileOfflineModelStatus);
    } else {
        bindProfileOfflineModelStatus();
    }
})();
