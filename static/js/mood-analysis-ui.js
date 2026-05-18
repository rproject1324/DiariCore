/**
 * Shared emotion analysis overlay: book Lottie, progress bar, result modal.
 * Used by write-entry and entry-view. Depends on lottie-web (window.lottie).
 */
(function (global) {
    'use strict';

    const MOOD_ANALYSIS_TOTAL_MS = 8000;
    const MOOD_ANALYSIS_MIN_AFTER_BOOK_MS = 1200;
    const MOOD_ANALYSIS_BOOK_LOTTIE_SRC = '/noto-emoji/book.json?v=20260517b';
    const ENTRY_UPDATE_EDITING_LOTTIE_SRC = '/noto-emoji/pencil_write.json?v=20260513d';
    const ENTRY_UPDATE_TOTAL_MS = 4200;
    /** Minimum time the PWA update overlay stays visible (offline saves are instant). */
    const ENTRY_UPDATE_PWA_MIN_MS = 1200;
    const ENTRY_UPDATE_MIN_AFTER_EDITING_MS = 700;

    let moodAnalysisLoadingShownAt = 0;
    let entryUpdateLoadingShownAt = 0;
    let moodAnalysisBookReadyAt = null;
    let moodAnalysisProgressTimer = null;
    let moodAnalysisBookMountEl = null;
    let moodAnalysisBookAnim = null;
    let moodAnalysisBookPrimePromise = null;

    let entryUpdateEditingReadyAt = null;
    let entryUpdateEditingMountEl = null;
    let entryUpdateEditingAnim = null;
    let entryUpdateEditingPrimePromise = null;
    let entryUpdateEditingData = null;
    let entryUpdateSaveFinished = false;
    let entryUpdateProgressTotalMs = ENTRY_UPDATE_TOTAL_MS;
    let entryUpdateProgressSnap = null;
    let entryUpdateProgressRefs = null;

    function clearMoodAnalysisProgressTimer() {
        if (moodAnalysisProgressTimer != null) {
            clearInterval(moodAnalysisProgressTimer);
            moodAnalysisProgressTimer = null;
        }
    }

    function escapeHtml(text) {
        if (window.DiariSecurity && typeof window.DiariSecurity.escapeHtml === 'function') {
            return window.DiariSecurity.escapeHtml(text);
        }
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function resetSession() {
        clearMoodAnalysisProgressTimer();
        moodAnalysisLoadingShownAt = 0;
        moodAnalysisBookReadyAt = null;
        entryUpdateLoadingShownAt = 0;
        entryUpdateEditingReadyAt = null;
        entryUpdateSaveFinished = false;
    }

    function snapEntryUpdateProgressToComplete() {
        if (entryUpdateProgressSnap) {
            entryUpdateProgressSnap();
            entryUpdateProgressSnap = null;
        }
    }

    function finishEntryUpdateLoading() {
        entryUpdateSaveFinished = true;
        snapEntryUpdateProgressToComplete();
    }

    function setEntryUpdateProgressPct(pct) {
        if (!entryUpdateProgressRefs) return;
        const p = Math.max(0, Math.min(100, Math.round(pct)));
        entryUpdateProgressRefs.progressPct.textContent = `${p}%`;
        entryUpdateProgressRefs.progressWrap.setAttribute('aria-valuenow', String(p));
        entryUpdateProgressRefs.progressFill.style.width = `${p}%`;
    }

    function stopEntryUpdateProgressSync() {
        entryUpdateProgressRefs = null;
        clearMoodAnalysisProgressTimer();
    }

    /**
     * PWA only: progress reaches 100% when save finishes; overlay proceeds immediately after (no extra timer wait).
     */
    async function runEntryUpdateLoadingWithSave(saveFn, overlay, options) {
        const ov = overlay || ensureAnalysisOverlay();
        const minMs =
            options && typeof options.minDurationMs === 'number'
                ? options.minDurationMs
                : ENTRY_UPDATE_PWA_MIN_MS;

        try {
            await primeEntryUpdateEditingLottie();
        } catch (_) {
            /* ignore */
        }

        showEntryUpdateLoading(ov, { pwaSyncSave: true });
        const start = Date.now();
        let saveOk = false;
        let settled = false;

        const savePromise = Promise.resolve()
            .then(() => saveFn())
            .then((ok) => {
                saveOk = Boolean(ok);
                return saveOk;
            })
            .catch((err) => {
                console.error(err);
                saveOk = false;
                return false;
            })
            .finally(() => {
                settled = true;
            });

        while (true) {
            const elapsed = Date.now() - start;
            if (settled) {
                setEntryUpdateProgressPct(100);
                const remain = Math.max(0, minMs - elapsed);
                if (remain > 0) {
                    await new Promise((resolve) => global.setTimeout(resolve, remain));
                }
                break;
            }
            const pct = Math.min(90, (elapsed / 2400) * 90);
            setEntryUpdateProgressPct(pct);
            await new Promise((resolve) => global.setTimeout(resolve, 40));
        }

        await savePromise;
        return saveOk;
    }

    function getMoodAnalysisBookPool() {
        let el = document.getElementById('moodAnalysisBookPool');
        if (!el) {
            el = document.createElement('div');
            el.id = 'moodAnalysisBookPool';
            el.className = 'mood-analysis-book-pool';
            el.setAttribute('aria-hidden', 'true');
            document.body.appendChild(el);
        }
        return el;
    }

    function primeMoodAnalysisBookLottie() {
        if (moodAnalysisBookPrimePromise) return moodAnalysisBookPrimePromise;
        moodAnalysisBookPrimePromise = (async () => {
            if (typeof global.lottie === 'undefined' || typeof global.lottie.loadAnimation !== 'function') {
                console.warn('Book-Loader: lottie-web not loaded');
                return null;
            }
            if (moodAnalysisBookMountEl && moodAnalysisBookAnim) return moodAnalysisBookAnim;
            try {
                const res = await fetch(MOOD_ANALYSIS_BOOK_LOTTIE_SRC, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                const pool = getMoodAnalysisBookPool();
                const mount = document.createElement('div');
                mount.className = 'mood-analysis-book-lottie mood-analysis-book-mount';
                mount.setAttribute('aria-hidden', 'true');
                pool.appendChild(mount);
                moodAnalysisBookMountEl = mount;
                const anim = global.lottie.loadAnimation({
                    container: mount,
                    renderer: 'svg',
                    loop: true,
                    autoplay: true,
                    animationData: data,
                });
                moodAnalysisBookAnim = anim;
                try {
                    if (typeof anim.goToAndPlay === 'function') anim.goToAndPlay(0, true);
                    else if (typeof anim.play === 'function') anim.play();
                } catch (_) {}
                anim.addEventListener('DOMLoaded', () => {
                    if (!moodAnalysisBookReadyAt) moodAnalysisBookReadyAt = Date.now();
                    try {
                        if (typeof anim.goToAndPlay === 'function') anim.goToAndPlay(0, true);
                        else if (typeof anim.play === 'function') anim.play();
                    } catch (_) {}
                });
                requestAnimationFrame(() => {
                    if (!moodAnalysisBookReadyAt) moodAnalysisBookReadyAt = Date.now();
                });
                return anim;
            } catch (e) {
                console.warn('Book-Loader preload:', e);
                return null;
            }
        })();
        return moodAnalysisBookPrimePromise;
    }

    function primeEntryUpdateEditingLottie() {
        if (entryUpdateEditingPrimePromise) return entryUpdateEditingPrimePromise;
        entryUpdateEditingPrimePromise = (async () => {
            if (typeof global.lottie === 'undefined' || typeof global.lottie.loadAnimation !== 'function') {
                console.warn('Editing-Loader: lottie-web not loaded');
                return null;
            }
            if (entryUpdateEditingMountEl && entryUpdateEditingAnim) return entryUpdateEditingAnim;
            try {
                const res = await fetch(ENTRY_UPDATE_EDITING_LOTTIE_SRC, { credentials: 'same-origin' });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                entryUpdateEditingData = data;
                return data;
            } catch (e) {
                console.warn('Editing-Loader preload:', e);
                // Allow retry on next invocation if this attempt failed.
                entryUpdateEditingPrimePromise = null;
                return null;
            }
        })();
        return entryUpdateEditingPrimePromise;
    }

    function parkMoodAnalysisBookMount() {
        if (!moodAnalysisBookMountEl) return;
        const pool = getMoodAnalysisBookPool();
        moodAnalysisBookMountEl.classList.remove('mood-analysis-book-lottie--in-overlay');
        moodAnalysisBookMountEl.setAttribute('aria-hidden', 'true');
        pool.appendChild(moodAnalysisBookMountEl);
        try {
            if (moodAnalysisBookAnim && typeof moodAnalysisBookAnim.resize === 'function') moodAnalysisBookAnim.resize();
        } catch (_) {}
    }

    function parkEntryUpdateEditingMount() {
        try {
            if (entryUpdateEditingAnim && typeof entryUpdateEditingAnim.destroy === 'function') {
                entryUpdateEditingAnim.destroy();
            }
        } catch (_) {}
        entryUpdateEditingAnim = null;
        if (entryUpdateEditingMountEl && entryUpdateEditingMountEl.parentNode) {
            entryUpdateEditingMountEl.parentNode.removeChild(entryUpdateEditingMountEl);
        }
        entryUpdateEditingMountEl = null;
    }

    function ensureAnalysisOverlay() {
        let overlay = document.getElementById('moodAnalysisOverlay');
        if (overlay) {
            const card = overlay.querySelector('.mood-analysis-card');
            const footer = card?.querySelector('.mood-analysis-card__footer');
            if (footer) {
                const saveBtn = footer.querySelector('#moodAnalysisSaveExitBtn');
                const contBtn = footer.querySelector('#moodAnalysisContinueBtn');
                const needsUpgrade =
                    contBtn ||
                    footer.classList.contains('mood-analysis-card__footer--dual') ||
                    (saveBtn && saveBtn.classList.contains('mood-analysis-btn--outline'));
                if (needsUpgrade) {
                    footer.className = 'mood-analysis-card__footer';
                    footer.id = 'moodAnalysisFooter';
                    footer.innerHTML =
                        '<button type="button" class="mood-analysis-btn mood-analysis-btn--solid" id="moodAnalysisSaveExitBtn">Save &amp; Exit</button>';
                }
            }
            return overlay;
        }

        overlay = document.createElement('div');
        overlay.id = 'moodAnalysisOverlay';
        overlay.className = 'mood-analysis-overlay';
        overlay.hidden = true;
        overlay.innerHTML = `
            <div class="mood-analysis-card">
                <div class="mood-analysis-card__header">
                    <h3 class="mood-analysis-card__title">Emotion Analysis</h3>
                </div>
                <div class="mood-analysis-card__body" id="moodAnalysisBody"></div>
                <div class="mood-analysis-card__footer" id="moodAnalysisFooter">
                    <button type="button" class="mood-analysis-btn mood-analysis-btn--solid" id="moodAnalysisSaveExitBtn">Save &amp; Exit</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);
        return overlay;
    }

    function showAnalysisLoading(overlay) {
        parkMoodAnalysisBookMount();
        parkEntryUpdateEditingMount();
        clearMoodAnalysisProgressTimer();

        const header = overlay.querySelector('.mood-analysis-card__header');
        const body = overlay.querySelector('#moodAnalysisBody');
        const footer = overlay.querySelector('.mood-analysis-card__footer');
        if (header) header.style.display = 'none';
        body.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'mood-analysis-loading mood-analysis-loading--book';

        const mount = moodAnalysisBookMountEl;
        if (mount) {
            mount.classList.add('mood-analysis-book-lottie--in-overlay');
            mount.removeAttribute('aria-hidden');
            mount.setAttribute('aria-label', 'Loading animation');
            wrap.appendChild(mount);
            try {
                if (moodAnalysisBookAnim) {
                    if (typeof moodAnalysisBookAnim.goToAndPlay === 'function') {
                        moodAnalysisBookAnim.goToAndPlay(0, true);
                    } else if (typeof moodAnalysisBookAnim.play === 'function') {
                        moodAnalysisBookAnim.play();
                    }
                    if (typeof moodAnalysisBookAnim.resize === 'function') moodAnalysisBookAnim.resize();
                }
            } catch (_) {}
        }

        const titleEl = document.createElement('h4');
        titleEl.className = 'mood-analysis-loading__title';
        titleEl.textContent = 'Analyzing your entry...';

        const subEl = document.createElement('p');
        subEl.className = 'mood-analysis-loading__subtitle';
        subEl.textContent = 'Detecting emotion patterns and insights...';

        const progressWrap = document.createElement('div');
        progressWrap.className = 'mood-analysis-progress';
        progressWrap.setAttribute('role', 'progressbar');
        progressWrap.setAttribute('aria-valuemin', '0');
        progressWrap.setAttribute('aria-valuemax', '100');
        progressWrap.setAttribute('aria-valuenow', '0');
        progressWrap.setAttribute('aria-label', 'Analysis progress');

        const progressTrack = document.createElement('div');
        progressTrack.className = 'mood-analysis-progress__track';

        const progressFill = document.createElement('div');
        progressFill.className = 'mood-analysis-progress__fill';

        progressTrack.appendChild(progressFill);
        progressWrap.appendChild(progressTrack);

        const progressPct = document.createElement('span');
        progressPct.className = 'mood-analysis-progress__pct';
        progressPct.textContent = '0%';
        progressWrap.appendChild(progressPct);

        wrap.appendChild(titleEl);
        wrap.appendChild(subEl);
        wrap.appendChild(progressWrap);
        body.appendChild(wrap);

        overlay.querySelector('.mood-analysis-card')?.classList.remove('mood-analysis-card--result');
        overlay.querySelector('.mood-analysis-card')?.classList.add('mood-analysis-card--analyzing');

        footer.style.display = 'none';
        overlay.hidden = false;
        moodAnalysisLoadingShownAt = Date.now();

        const totalMs = MOOD_ANALYSIS_TOTAL_MS;
        const progressStart = Date.now();
        moodAnalysisProgressTimer = setInterval(() => {
            const elapsed = Date.now() - progressStart;
            const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
            progressPct.textContent = `${pct}%`;
            progressWrap.setAttribute('aria-valuenow', String(pct));
            if (pct >= 100) clearMoodAnalysisProgressTimer();
        }, 80);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                progressFill.style.transition = `width ${totalMs}ms linear`;
                progressFill.style.width = '100%';
            });
            try {
                if (moodAnalysisBookAnim && typeof moodAnalysisBookAnim.resize === 'function') moodAnalysisBookAnim.resize();
            } catch (_) {}
        });
    }

    function showEntryUpdateLoading(overlay, options) {
        parkMoodAnalysisBookMount();
        parkEntryUpdateEditingMount();
        clearMoodAnalysisProgressTimer();

        const header = overlay.querySelector('.mood-analysis-card__header');
        const body = overlay.querySelector('#moodAnalysisBody');
        const footer = overlay.querySelector('.mood-analysis-card__footer');
        if (header) header.style.display = 'none';
        body.innerHTML = '';

        const wrap = document.createElement('div');
        // Reuse the exact loading layout used by analysis so styling is identical.
        wrap.className = 'mood-analysis-loading mood-analysis-loading--book';

        // Build a fresh mount each time for update mode (prevents stale pooled mount issues).
        const mount = document.createElement('div');
        mount.className = 'mood-analysis-book-lottie mood-analysis-book-mount mood-analysis-editing-mount';
        mount.setAttribute('aria-label', 'Loading animation');
        wrap.appendChild(mount);
        entryUpdateEditingMountEl = mount;
        const showMissingIcon = () => {
            if (mount.querySelector('svg, canvas')) return;
            mount.innerHTML = '<i class="bi bi-pencil-square" aria-hidden="true" style="font-size:56px;color:#5d7268;"></i>';
        };
        const loadEditingAnimWithData = (data) => {
            if (typeof global.lottie === 'undefined' || typeof global.lottie.loadAnimation !== 'function') return null;
            try {
                if (entryUpdateEditingAnim && typeof entryUpdateEditingAnim.destroy === 'function') {
                    entryUpdateEditingAnim.destroy();
                }
            } catch (_) {}
            entryUpdateEditingAnim = global.lottie.loadAnimation({
                container: mount,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                animationData: data,
            });
            entryUpdateEditingAnim.addEventListener('DOMLoaded', () => {
                if (!entryUpdateEditingReadyAt) entryUpdateEditingReadyAt = Date.now();
            });
            return entryUpdateEditingAnim;
        };
        const mountEditingAnimation = async () => {
            try {
                if (entryUpdateEditingData) {
                    loadEditingAnimWithData(entryUpdateEditingData);
                    return;
                }
                const res = await fetch(ENTRY_UPDATE_EDITING_LOTTIE_SRC, {
                    credentials: 'same-origin',
                    cache: 'no-store',
                });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                entryUpdateEditingData = data;
                loadEditingAnimWithData(data);
            } catch (e) {
                console.warn('Editing-Loader render error:', e);
                showMissingIcon();
            }
        };
        void mountEditingAnimation();

        const titleEl = document.createElement('h4');
        titleEl.className = 'mood-analysis-loading__title';
        titleEl.textContent = 'Updating your entry...';

        const subEl = document.createElement('p');
        subEl.className = 'mood-analysis-loading__subtitle';
        subEl.textContent = 'Read and update new Title, Tags, or Images...';

        const progressWrap = document.createElement('div');
        progressWrap.className = 'mood-analysis-progress';
        progressWrap.setAttribute('role', 'progressbar');
        progressWrap.setAttribute('aria-valuemin', '0');
        progressWrap.setAttribute('aria-valuemax', '100');
        progressWrap.setAttribute('aria-valuenow', '0');
        progressWrap.setAttribute('aria-label', 'Update progress');

        const progressTrack = document.createElement('div');
        progressTrack.className = 'mood-analysis-progress__track';

        const progressFill = document.createElement('div');
        progressFill.className = 'mood-analysis-progress__fill';

        progressTrack.appendChild(progressFill);
        progressWrap.appendChild(progressTrack);

        const progressPct = document.createElement('span');
        progressPct.className = 'mood-analysis-progress__pct';
        progressPct.textContent = '0%';
        progressWrap.appendChild(progressPct);

        wrap.appendChild(titleEl);
        wrap.appendChild(subEl);
        wrap.appendChild(progressWrap);
        body.appendChild(wrap);

        overlay.querySelector('.mood-analysis-card')?.classList.remove('mood-analysis-card--result');
        overlay.querySelector('.mood-analysis-card')?.classList.add('mood-analysis-card--analyzing');

        if (footer) footer.style.display = 'none';
        overlay.hidden = false;
        entryUpdateLoadingShownAt = Date.now();
        entryUpdateSaveFinished = false;
        entryUpdateProgressRefs = { progressPct, progressFill, progressWrap };

        if (options && options.pwaSyncSave) {
            progressFill.style.transition = 'width 120ms ease-out';
            progressFill.style.width = '0%';
            try {
                if (entryUpdateEditingAnim && typeof entryUpdateEditingAnim.resize === 'function') {
                    entryUpdateEditingAnim.resize();
                }
            } catch (_) {}
            return;
        }

        entryUpdateProgressTotalMs = ENTRY_UPDATE_TOTAL_MS;
        const totalMs = entryUpdateProgressTotalMs;
        const progressStart = Date.now();
        entryUpdateProgressSnap = () => {
            clearMoodAnalysisProgressTimer();
            progressPct.textContent = '100%';
            progressWrap.setAttribute('aria-valuenow', '100');
            progressFill.style.transition = 'none';
            progressFill.style.width = '100%';
        };
        moodAnalysisProgressTimer = setInterval(() => {
            const elapsed = Date.now() - progressStart;
            const pct = Math.min(100, Math.round((elapsed / totalMs) * 100));
            progressPct.textContent = `${pct}%`;
            progressWrap.setAttribute('aria-valuenow', String(pct));
            if (pct >= 100) clearMoodAnalysisProgressTimer();
        }, 80);

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                progressFill.style.transition = `width ${totalMs}ms linear`;
                progressFill.style.width = '100%';
            });
            try {
                if (entryUpdateEditingAnim && typeof entryUpdateEditingAnim.resize === 'function') entryUpdateEditingAnim.resize();
            } catch (_) {}
        });
    }

    function hideAnalysisOverlay(overlay) {
        const ov = overlay || document.getElementById('moodAnalysisOverlay');
        if (!ov) return;
        clearMoodAnalysisProgressTimer();
        parkMoodAnalysisBookMount();
        parkEntryUpdateEditingMount();
        ov.hidden = true;
    }

    async function delayUntilMoodAnalysisGate() {
        const shownAt = moodAnalysisLoadingShownAt || Date.now();
        const barEnd = shownAt + MOOD_ANALYSIS_TOTAL_MS;
        const bookEnd = moodAnalysisBookReadyAt ? moodAnalysisBookReadyAt + MOOD_ANALYSIS_MIN_AFTER_BOOK_MS : 0;
        const targetEnd = Math.max(barEnd, bookEnd);
        const wait = Math.max(0, targetEnd - Date.now());
        await new Promise((resolve) => setTimeout(resolve, wait));
    }

    async function delayUntilEntryUpdateGate(options) {
        const shownAt = entryUpdateLoadingShownAt || Date.now();
        const totalMs = entryUpdateProgressTotalMs || ENTRY_UPDATE_TOTAL_MS;
        const barEnd = shownAt + totalMs;
        const requireSaveSignal = Boolean(options && options.requireSaveSignal);
        const pwaFast = Boolean(options && options.pwaFast);

        if (!requireSaveSignal) {
            const wait = Math.max(0, barEnd - Date.now());
            await new Promise((resolve) => global.setTimeout(resolve, wait));
            return;
        }

        const minEnd = shownAt + (pwaFast ? 280 : 500);
        const hardCap = shownAt + (pwaFast ? totalMs + 400 : ENTRY_UPDATE_TOTAL_MS + 2500);

        await new Promise((resolve) => {
            const done = () => resolve();
            const tick = () => {
                const now = Date.now();
                if (now >= hardCap) {
                    done();
                    return true;
                }
                const minDone = now >= minEnd;
                if (pwaFast && entryUpdateSaveFinished && minDone) {
                    done();
                    return true;
                }
                const barDone = now >= barEnd;
                if (barDone && minDone && entryUpdateSaveFinished) {
                    done();
                    return true;
                }
                return false;
            };
            if (tick()) return;
            const iv = global.setInterval(() => {
                if (tick()) global.clearInterval(iv);
            }, 40);
            global.setTimeout(() => {
                global.clearInterval(iv);
                done();
            }, Math.max(0, hardCap - Date.now()));
        });
    }

    function computeEnergy(score) {
        if (score >= 0.65) return 'High';
        if (score >= 0.45) return 'Moderate';
        return 'Low';
    }

    function computeInterpretation(score) {
        if (score >= 0.65) return 'Clear dominant emotion';
        if (score >= 0.45) return 'Mixed emotional signals';
        return 'Highly mixed / ambiguous';
    }

    function formatPct(value) {
        const n = Number(value ?? 0);
        return `${(Math.max(0, Math.min(1, n)) * 100).toFixed(1)}%`;
    }

    function toTitleCase(text) {
        return (text || '')
            .toString()
            .toLowerCase()
            .replace(/\b\w/g, (c) => c.toUpperCase());
    }

    function buildSignalPairs(entry, primaryEmotion, primaryScore) {
        const allowed = ['sad', 'anxious', 'angry', 'happy', 'neutral'];
        const allProbs = entry && typeof entry.all_probs === 'object' ? entry.all_probs : null;

        if (allProbs) {
            const merged = {};
            allowed.forEach((label) => {
                merged[label] = Number(allProbs[label] || 0);
            });
            if (primaryEmotion && primaryEmotion in merged) {
                merged[primaryEmotion] = Number(primaryScore || merged[primaryEmotion] || 0);
            }
            return Object.entries(merged).sort((a, b) => b[1] - a[1]);
        }

        const fallback = {};
        allowed.forEach((label) => {
            fallback[label] = label === primaryEmotion ? Number(primaryScore || 0.5) : 0;
        });
        return Object.entries(fallback).sort((a, b) => b[1] - a[1]);
    }

    function showAnalysisResult(overlay, entry, isFallback, options) {
        const opts = options || {};
        clearMoodAnalysisProgressTimer();
        parkMoodAnalysisBookMount();
        const analysisCard = overlay.querySelector('.mood-analysis-card');
        analysisCard?.classList.remove('mood-analysis-card--analyzing');
        analysisCard?.classList.add('mood-analysis-card--result');

        const header = overlay.querySelector('.mood-analysis-card__header');
        const body = overlay.querySelector('#moodAnalysisBody');
        const footer = overlay.querySelector('.mood-analysis-card__footer');
        if (header) header.style.display = 'none';

        const emotion = (entry.emotionLabel || entry.feeling || 'neutral').toString().toLowerCase();
        const score = Number(entry.emotionScore || entry.sentimentScore || 0.5);
        const sentiment = (entry.sentimentLabel || 'neutral').toString().toLowerCase();
        const valence = sentiment === 'positive' ? 'Positive' : sentiment === 'negative' ? 'Negative' : 'Balanced';
        const pairs = buildSignalPairs(entry, emotion, score);
        const secondary = pairs[1] && Number(pairs[1][1]) >= 0.15 ? pairs[1] : null;
        const interpretationText = computeInterpretation(score);
        const energyLabel = computeEnergy(score);

        const confidencePct = Math.max(0, Math.min(100, Math.round(score * 100)));
        const secondaryConfidencePct =
            secondary != null ? Math.max(0, Math.min(100, Math.round(Number(secondary[1]) * 100))) : null;

        const signalsBarsHtml = pairs
            .map(([label, prob]) => {
                const pct = Math.max(0, Math.min(100, Math.round(Number(prob) * 100)));
                const slug = String(label || '').toLowerCase();
                return `
                    <div class="mood-result-signal">
                        <div class="mood-result-signal__row">
                            <span class="mood-result-signal__name">${escapeHtml(toTitleCase(slug))}</span>
                            <span class="mood-result-signal__pct">${formatPct(prob)}</span>
                        </div>
                        <div class="mood-result-signal__track" aria-hidden="true">
                            <div class="mood-result-signal__fill mood-result-signal__fill--${escapeHtml(slug)}" data-pct="${pct}" style="width: 0%"></div>
                        </div>
                    </div>`;
            })
            .join('');

        const secondaryBlock = secondary
            ? `
                <div class="mood-result-emotion mood-result-emotion--secondary">
                    <span class="mood-result-emotion__label">Secondary</span>
                    <p class="mood-result-emotion__value">${escapeHtml(toTitleCase(String(secondary[0])))}</p>
                    <span class="mood-result-badge mood-result-badge--amber">${secondaryConfidencePct}% Confidence</span>
                </div>`
            : `
                <div class="mood-result-emotion mood-result-emotion--secondary mood-result-emotion--empty">
                    <span class="mood-result-emotion__label">Secondary</span>
                    <p class="mood-result-emotion__value mood-result-emotion__value--muted">None detected</p>
                    <span class="mood-result-badge mood-result-badge--muted">No strong secondary signal</span>
                </div>`;

        const viewDetailsRow =
            typeof opts.fetchRerunAnalysis === 'function'
                ? `<p class="mood-result-v2__actions"><button type="button" class="mood-result-v2__view-details" id="moodAnalysisViewDetailsBtn">View details</button></p>`
                : '';

        body.innerHTML = `
            <div class="mood-result-v2">
                <header class="mood-result-v2__hero">
                    <h2 class="mood-result-v2__title">Analysis Complete</h2>
                    <p class="mood-result-v2__subtitle">Here's what we observed from your entry.</p>
                    ${viewDetailsRow}
                </header>
                <div class="mood-result-v2__grid">
                    <div class="mood-result-v2__col mood-result-v2__col--primary">
                        <section class="mood-result-panel mood-result-panel--emotions" aria-labelledby="mood-result-emotions-heading">
                            <p id="mood-result-emotions-heading" class="mood-result-panel__eyebrow">Detected emotions</p>
                            <div class="mood-result-emotion mood-result-emotion--primary-block">
                                <span class="mood-result-emotion__label">Primary</span>
                                <p class="mood-result-emotion__value">${escapeHtml(toTitleCase(emotion))}</p>
                                <span class="mood-result-badge mood-result-badge--green">${confidencePct}% Confidence</span>
                            </div>
                            ${secondaryBlock}
                        </section>
                    </div>
                    <div class="mood-result-v2__col mood-result-v2__col--secondary">
                        <section class="mood-result-panel mood-result-panel--signals" aria-labelledby="mood-result-signals-heading">
                            <h3 id="mood-result-signals-heading" class="mood-result-panel__title mood-result-panel__title--icon">
                                <i class="bi bi-activity" aria-hidden="true"></i>
                                Emotional Signals
                            </h3>
                            <div class="mood-result-signal-list">${signalsBarsHtml}</div>
                        </section>
                        <section class="mood-result-panel mood-result-panel--insights" aria-labelledby="mood-result-insights-heading">
                            <h3 id="mood-result-insights-heading" class="visually-hidden">Valence, energy, and interpretation</h3>
                            <div class="mood-result-insights__pair">
                                <div class="mood-result-kv">
                                    <span class="mood-result-kv__label">Valence</span>
                                    <p class="mood-result-kv__value">${escapeHtml(valence)}</p>
                                </div>
                                <div class="mood-result-kv">
                                    <span class="mood-result-kv__label">Energy</span>
                                    <p class="mood-result-kv__value">${escapeHtml(energyLabel)}</p>
                                </div>
                            </div>
                            <p class="mood-result-insights__text">${escapeHtml(interpretationText)}</p>
                        </section>
                    </div>
                </div>
                ${
                    opts.offlineEstimate
                        ? '<p class="mood-result-fallback-note">Temporary offline estimate — full analysis when you are back online.</p>'
                        : isFallback
                          ? '<p class="mood-result-fallback-note">Saved with fallback analysis</p>'
                          : ''
                }
            </div>
        `;

        requestAnimationFrame(() => {
            body.querySelectorAll('.mood-result-signal__fill').forEach((el) => {
                const p = el.getAttribute('data-pct');
                if (p != null) el.style.width = `${p}%`;
            });
        });

        footer.style.display = 'flex';
        const saveExitBtn = overlay.querySelector('#moodAnalysisSaveExitBtn');
        if (saveExitBtn) {
            saveExitBtn.textContent = opts.footerCloseLabel ? String(opts.footerCloseLabel) : 'Save & Exit';
            saveExitBtn.onclick = () => {
                overlay.hidden = true;
                if (typeof opts.onSaveExit === 'function') opts.onSaveExit();
                else global.location.href = 'dashboard.html';
            };
        }

        const rerunBtn = body.querySelector('#moodAnalysisViewDetailsBtn');
        if (rerunBtn && typeof opts.fetchRerunAnalysis === 'function') {
            rerunBtn.onclick = async () => {
                rerunBtn.disabled = true;
                try {
                    resetSession();
                    await primeMoodAnalysisBookLottie();
                    showAnalysisLoading(overlay);
                    const pack = await opts.fetchRerunAnalysis();
                    await delayUntilMoodAnalysisGate();
                    showAnalysisResult(overlay, pack.entry, pack.isFallback === true, opts);
                } catch (err) {
                    console.error(err);
                    rerunBtn.disabled = false;
                }
            };
        }
    }

    global.DiariMoodAnalysis = {
        MOOD_ANALYSIS_TOTAL_MS,
        resetSession,
        primeMoodAnalysisBookLottie,
        primeEntryUpdateEditingLottie,
        ensureAnalysisOverlay,
        showAnalysisLoading,
        showEntryUpdateLoading,
        delayUntilMoodAnalysisGate,
        delayUntilEntryUpdateGate,
        finishEntryUpdateLoading,
        runEntryUpdateLoadingWithSave,
        hideAnalysisOverlay,
        showAnalysisResult,
        parkMoodAnalysisBookMount,
    };
})(typeof window !== 'undefined' ? window : this);
