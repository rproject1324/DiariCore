// Write Entry Page JavaScript

document.addEventListener('DOMContentLoaded', async function () {
    try {
    if (window.DiariOffline?.awaitServerState) {
        await window.DiariOffline.awaitServerState();
    }

    // Initialize variables
    let selectedFeeling = null;
    let selectedTags = new Set();
    let manualDateTime = null;
    /** Last-good datetime-local value while editing; reverting avoids overwriting digits with “now”. */
    let journalDateTimeBaselineLocal = '';
    let pickerOpenedAtLocalStr = '';
    let priorManualDateTimeOnPickerOpen = null;

    if (window.DiariMoodAnalysis?.primeMoodAnalysisBookLottie) {
        window.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
    }

    function normalizeTag(tag) {
        let t = String(tag || '').trim().replace(/\s+/g, ' ');
        if (window.DiariSecurity && typeof window.DiariSecurity.stripAngleBrackets === 'function') {
            t = window.DiariSecurity.stripAngleBrackets(t);
        } else {
            t = t.replace(/</g, '').replace(/>/g, '');
        }
        return t;
    }

    function getCurrentUserId() {
        const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        const raw = user?.id ?? user?.userId ?? 0;
        const parsed = Number(raw);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
    }

    let writeImageItemSeq = 0;
    const IU = window.DiariImageUpload || {};
    const scheduleWriteImageUpload = typeof IU.createUploadPool === 'function'
        ? IU.createUploadPool(IU.PARALLEL_UPLOADS)
        : (task) => Promise.resolve().then(task);

    function isImageStillUploading(im) {
        const p = Number(im?.progress ?? 0);
        return p > 0 && p < 100;
    }

    function entryImgSpinnerHtml(bytesLabel) {
        if (typeof IU.spinnerHtml === 'function') return IU.spinnerHtml(bytesLabel);
        return '<div class="entry-img-spinner" role="status" aria-label="Uploading"><span class="entry-img-spinner__ring" aria-hidden="true"></span></div>';
    }

    function uploadBytesLabel(im) {
        if (typeof IU.formatProgress === 'function') {
            return IU.formatProgress(im?.uploadLoaded, im?.uploadTotal);
        }
        return '';
    }

    function patchAttachedImage(id, patch) {
        const idx = attachedImages.findIndex((img) => img.id === id);
        if (idx === -1) return;
        attachedImages[idx] = { ...attachedImages[idx], ...patch };
    }

    const DEFAULT_TAGS = [
        { name: 'School', icon: 'bi bi-book', iconType: 'bi' },
        { name: 'Home', icon: 'bi bi-house', iconType: 'bi' },
        { name: 'Friends', icon: 'bi bi-people', iconType: 'bi' },
        { name: 'Work', icon: 'bi bi-briefcase', iconType: 'bi' },
        { name: 'Family', icon: 'bi bi-heart', iconType: 'bi' },
        { name: 'Health', icon: 'bi bi-heart-pulse', iconType: 'bi' },
        { name: 'Money', icon: 'bi bi-currency-dollar', iconType: 'bi' },
        { name: 'Bills', icon: 'bi bi-receipt', iconType: 'bi' },
    ];
    const DEFAULT_TAG_SET = new Set(DEFAULT_TAGS.map((x) => normalizeTag(x.name).toLowerCase()));
    const TAG_USAGE_KEY = 'diariCoreTagUsage';
    const TAG_EXPANDED_KEY = 'diariCoreTagsExpanded';
    const TAG_SYNC_QUEUE_KEY = 'diariCoreTagSyncQueue';

    function getCustomTagIconsPerPage() {
        try {
            return window.matchMedia('(max-width: 768px)').matches ? 25 : 48;
        } catch (e) {
            return 48;
        }
    }

    function isCustomTagPickerCompact() {
        try {
            return !window.matchMedia('(max-width: 768px)').matches;
        } catch (e) {
            return true;
        }
    }

    const ICON_SEARCH_ALIASES = {
        money: ['cash', 'coin', 'wallet', 'credit-card', 'bank', 'piggy-bank', 'currency'],
        bills: ['receipt', 'cash', 'credit-card', 'wallet', 'currency'],
        budget: ['wallet', 'piggy-bank', 'cash', 'graph', 'calculator'],
        finance: ['bank', 'cash', 'coin', 'wallet', 'credit-card', 'currency'],
        payment: ['credit-card', 'wallet', 'cash', 'coin', 'receipt'],
        food: ['cup', 'egg', 'apple', 'basket', 'cake', 'cup-hot'],
        fitness: ['heart-pulse', 'activity', 'bicycle', 'trophy', 'stopwatch'],
        travel: ['airplane', 'car', 'bus', 'train', 'geo', 'suitcase'],
        study: ['book', 'journal', 'pen', 'pencil', 'mortarboard', 'backpack'],
        work: ['briefcase', 'building', 'laptop', 'display', 'clipboard'],
        home: ['house', 'lamp', 'door', 'window', 'shop'],
        family: ['people', 'person', 'heart', 'house-heart', 'emoji-smile'],
    };
    let pickerIconNames = [];
    let customTagPage = 0;
    let customTagSearch = '';
    let selectedPickerIconName = '';
    let tagItemsState = [];
    let tagExpanded = localStorage.getItem(TAG_EXPANDED_KEY) === '1';
    const OFFLINE_DB_NAME = 'diariCoreOfflineMedia';
    const OFFLINE_DB_STORE = 'pendingEntries';
    const MAX_IMAGE_WARN = 10;

    async function filterImageUploadFiles(fileList) {
        const files = [];
        const skipped = [];
        const coerce =
            window.DiariImageUpload && typeof window.DiariImageUpload.coerceImageUploadFile === 'function'
                ? window.DiariImageUpload.coerceImageUploadFile.bind(window.DiariImageUpload)
                : null;
        for (const raw of Array.from(fileList || [])) {
            let coerced = null;
            if (coerce) {
                coerced = await coerce(raw);
            } else if (raw && String(raw.type || '').toLowerCase().startsWith('image/')) {
                coerced = raw;
            }
            if (coerced) files.push(coerced);
            else if (raw) skipped.push(String(raw.name || 'image'));
        }
        return { files, skipped };
    }
    let attachedImages = [];
    let lightboxIndex = 0;
    let dragDepth = 0;

    /** True when the journal has any unsaved content (used for leave guards). */
    function hasUnsavedJournalDraft() {
        const jt = document.getElementById('journalText');
        const jti = document.getElementById('journalTitleInput');
        return Boolean(
            (jt && jt.value.trim()) ||
            (jti && jti.value.trim()) ||
            selectedTags.size > 0 ||
            attachedImages.length > 0
        );
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    /** Top-right toast — soft sage success (theme.css / DiariToastColors). */
    function showWriteEntryNotification(message, type = 'success') {
        if (window.DiariToast && typeof window.DiariToast.show === 'function') {
            window.DiariToast.show(message, type, 3000);
            return;
        }
        const existing = document.querySelector('.write-entry-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = 'write-entry-notification';
        notification.setAttribute('role', 'status');
        const iconClass =
            type === 'success' ? 'bi bi-check-circle-fill' : type === 'error' ? 'bi bi-exclamation-circle-fill' : 'bi bi-info-circle';
        notification.innerHTML = `<i class="${iconClass}" aria-hidden="true"></i><span></span>`;
        const span = notification.querySelector('span');
        if (span) span.textContent = message;

        const bg =
            window.DiariToastColors && window.DiariToastColors.bg
                ? window.DiariToastColors.bg(type)
                : type === 'success'
                  ? '#8da399'
                  : type === 'error'
                    ? '#E74C3C'
                    : '#7FA7BF';
        const fg =
            window.DiariToastColors && window.DiariToastColors.fg ? window.DiariToastColors.fg(type) : '#ffffff';

        notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        border-radius: 12px;
        display: flex;
        align-items: center;
        gap: 0.75rem;
        font-weight: 500;
        z-index: 14000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        background: ${bg};
        color: ${fg};
        font-family: 'Inter', sans-serif;
    `;

        document.body.appendChild(notification);
        setTimeout(() => {
            notification.style.transform = 'translateX(0)';
        }, 10);
        setTimeout(() => {
            notification.style.transform = 'translateX(100%)';
            setTimeout(() => {
                if (notification.parentNode) notification.remove();
            }, 300);
        }, 3000);
    }

    function iconClassForTag(tagName) {
        const t = normalizeTag(tagName).toLowerCase();
        const match = DEFAULT_TAGS.find((x) => x.name.toLowerCase() === t);
        return match ? match.icon : 'bi bi-hash';
    }

    function iconMarkup(iconName, iconType = 'bi') {
        if (iconType === 'bi') {
            const normalized = String(iconName || '').trim();
            const cls = normalized.startsWith('bi ') ? normalized : `bi bi-${normalized || 'hash'}`;
            return `<i class="${escapeHtml(cls)}"></i>`;
        }
        return `<i class="bi bi-hash"></i>`;
    }

    function openOfflineDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(OFFLINE_DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(OFFLINE_DB_STORE)) {
                    db.createObjectStore(OFFLINE_DB_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        });
    }

    async function idbPut(value) {
        const db = await openOfflineDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
            tx.objectStore(OFFLINE_DB_STORE).put(value);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB put failed'));
        });
        db.close();
    }

    async function idbGetAll() {
        const db = await openOfflineDb();
        const result = await new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readonly');
            const req = tx.objectStore(OFFLINE_DB_STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
        });
        db.close();
        return result;
    }

    async function idbDelete(id) {
        const db = await openOfflineDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(OFFLINE_DB_STORE, 'readwrite');
            tx.objectStore(OFFLINE_DB_STORE).delete(id);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
        });
        db.close();
    }

    function formatPhotoCount(n) {
        return `${n} photo${n === 1 ? '' : 's'} attached`;
    }

    function updatePhotoBadge() {
        const badge = document.getElementById('photoCountBadge');
        if (!badge) return;
        const count = attachedImages.length;
        badge.hidden = count <= 0;
        badge.textContent = formatPhotoCount(count);
    }

    function isWriteEntryMobileLayout() {
        return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    /** Desktop: 2×3 visible cells; mobile: 2×2 (4) then scroll. */
    function getWriteGalleryGridLayout() {
        if (isWriteEntryMobileLayout()) {
            return { rows: 2, cols: 2, maxVisible: 4 };
        }
        return { rows: 3, cols: 2, maxVisible: 6 };
    }

    let writeGalleryResizeObserver = null;

    function syncWriteEntryGalleryViewport() {
        const scrollEl = document.getElementById('entryGalleryScroll');
        const galleryEl = document.getElementById('entryGallery');
        if (!scrollEl || !galleryEl) return;

        if (galleryEl.classList.contains('is-empty')) {
            scrollEl.style.removeProperty('--gallery-viewport-px');
            scrollEl.classList.remove('entry-gallery-scroll--overflow');
            return;
        }

        const { rows, cols, maxVisible } = getWriteGalleryGridLayout();
        const cs = getComputedStyle(scrollEl);
        const padL = parseFloat(cs.paddingLeft) || 0;
        const padR = parseFloat(cs.paddingRight) || 0;
        const innerW = Math.max(0, scrollEl.clientWidth - padL - padR);

        const grid = galleryEl.querySelector('.entry-gallery-grid');
        let gapPx = 5.76;
        if (grid) {
            const gcs = getComputedStyle(grid);
            gapPx = parseFloat(gcs.columnGap) || parseFloat(gcs.gap) || gapPx;
        }

        const cell = Math.max(0, (innerW - (cols - 1) * gapPx) / cols);
        const viewportH = rows * cell + (rows - 1) * gapPx;
        scrollEl.style.setProperty('--gallery-viewport-px', `${Math.round(viewportH * 100) / 100}px`);

        const count = galleryEl.querySelectorAll('.entry-gallery-item').length;
        scrollEl.classList.toggle('entry-gallery-scroll--overflow', count > maxVisible);
    }

    function initWriteGalleryViewportObserver() {
        const scrollEl = document.getElementById('entryGalleryScroll');
        if (!scrollEl || !window.ResizeObserver || writeGalleryResizeObserver) return;
        writeGalleryResizeObserver = new ResizeObserver(() => syncWriteEntryGalleryViewport());
        writeGalleryResizeObserver.observe(scrollEl);
    }

    function patchWriteImageUploadDom(id) {
        const im = attachedImages.find((img) => img.id === id);
        const item = document.querySelector(`#entryGallery [data-image-id="${id}"]`);
        if (!im || !item) return false;
        const bar = item.querySelector('.entry-img-progress span');
        if (bar) bar.style.width = `${Math.max(8, im.progress)}%`;
        const uploading = isImageStillUploading(im);
        const wrap = item.querySelector('.entry-gallery-img-wrap');
        let spinner = item.querySelector('.entry-img-spinner');
        const label = uploadBytesLabel(im);
        if (uploading) {
            if (!spinner && wrap) {
                wrap.insertAdjacentHTML('beforeend', entryImgSpinnerHtml(label));
            } else if (spinner && typeof IU.setSpinnerBytes === 'function') {
                IU.setSpinnerBytes(spinner, label);
            } else if (spinner) {
                const bytesEl = spinner.querySelector('.entry-img-spinner__bytes');
                if (bytesEl) bytesEl.textContent = label;
            }
        } else if (spinner) {
            spinner.remove();
        }
        return true;
    }

    function updateImageUploadState(id, patch) {
        patchAttachedImage(id, patch);
        if (!patchWriteImageUploadDom(id)) renderImageGallery();
    }

    async function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('Could not read file'));
            reader.readAsDataURL(file);
        });
    }

    function dataUrlToBlob(dataUrl) {
        const [meta, base64] = String(dataUrl || '').split(',');
        const mimeMatch = /data:(.*?);base64/.exec(meta || '');
        const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
        const bytes = Uint8Array.from(atob(base64 || ''), (c) => c.charCodeAt(0));
        return new Blob([bytes], { type: mime });
    }

    async function uploadImageOnline(file, userId, localId) {
        if (!userId) {
            throw new Error('Please log in again to upload photos.');
        }
        return scheduleWriteImageUpload(async () => {
            const prepared = typeof IU.prepareUploadFile === 'function'
                ? await IU.prepareUploadFile(file)
                : file;
            const total = prepared.size || file.size || 0;
            updateImageUploadState(localId, { uploadTotal: total, uploadLoaded: 0, progress: 2 });

            const onProgress = (loaded, uploadTotal) => {
                const progress = typeof IU.progressFromBytes === 'function'
                    ? IU.progressFromBytes(loaded, uploadTotal)
                    : Math.min(99, Math.round((loaded / Math.max(1, uploadTotal)) * 100));
                updateImageUploadState(localId, {
                    uploadLoaded: loaded,
                    uploadTotal,
                    progress,
                });
            };

            if (typeof IU.uploadWithRetries === 'function') {
                const url = await IU.uploadWithRetries(prepared, userId, onProgress, 3);
                updateImageUploadState(localId, {
                    uploadLoaded: prepared.size || total,
                    uploadTotal: prepared.size || total,
                    progress: 100,
                });
                return url;
            }

            const form = new FormData();
            form.append('file', prepared);
            form.append('userId', String(userId));
            const res = await fetch('/api/uploads/image', { method: 'POST', body: form });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success || !json?.url) {
                throw new Error(json?.error || `Upload failed (${res.status})`);
            }
            updateImageUploadState(localId, { progress: 100, uploadLoaded: total, uploadTotal: total });
            return String(json.url);
        });
    }

    function makeImageItem({ url = '', dataUrl = '', name = '' } = {}) {
        writeImageItemSeq += 1;
        return {
            id: `${Date.now()}_${writeImageItemSeq}_${Math.random().toString(36).slice(2, 10)}`,
            url,
            dataUrl,
            name,
            progress: 0,
            uploadLoaded: 0,
            uploadTotal: 0,
        };
    }

    function autoAdjustJournalTextarea() {
        const jt = document.getElementById('journalText');
        if (!jt) return;
        const titleEl = document.getElementById('journalTitleInput');
        const gal = document.querySelector('.entry-gallery-pane');
        if (gal) {
            const titleH = titleEl ? titleEl.offsetHeight + 10 : 0;
            let minPx;
            if (isWriteEntryMobileLayout()) {
                minPx = Math.max(200, Math.min(420, Math.round(window.innerHeight * 0.32)));
            } else {
                minPx = Math.max(96, gal.offsetHeight - titleH);
            }
            jt.style.minHeight = `${Math.round(minPx)}px`;
        }
        jt.style.height = 'auto';
        const min = parseFloat(jt.style.minHeight) || 96;
        jt.style.height = `${Math.max(jt.scrollHeight, min)}px`;
    }
    window.__diariAdjustWriteJournal = autoAdjustJournalTextarea;

    function wireGalleryImageLoads(gallery) {
        gallery.querySelectorAll('.entry-gallery-img-wrap').forEach((wrap) => {
            const img = wrap.querySelector('img');
            if (!img) return;
            const done = () => {
                wrap.classList.remove('entry-gallery-img-wrap--loading', 'entry-gallery-img-wrap--pending');
                wrap.classList.add('entry-gallery-img-wrap--loaded');
                syncWriteEntryGalleryViewport();
            };
            const fail = () => {
                wrap.classList.remove('entry-gallery-img-wrap--loading', 'entry-gallery-img-wrap--pending');
                wrap.classList.add('entry-gallery-img-wrap--error');
            };
            if (img.complete && img.naturalHeight > 0) {
                done();
            } else {
                img.addEventListener('load', done, { once: true });
                img.addEventListener('error', fail, { once: true });
            }
        });
    }

    function wireWriteEntryGalleryInteractions(gallery) {
        gallery.querySelectorAll('.entry-gallery-item').forEach((item) => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.entry-gallery-action-btn')) return;
                const wasActive = item.classList.contains('is-active');
                gallery.querySelectorAll('.entry-gallery-item.is-active').forEach((el) => el.classList.remove('is-active'));
                if (!wasActive) item.classList.add('is-active');
            });
        });
    }

    function renderImageGallery() {
        const gallery = document.getElementById('entryGallery');
        const toolbar = document.getElementById('entryGalleryToolbar');
        const stickyAdd = document.getElementById('entryGalleryStickyAdd');
        if (!gallery) return;
        const count = attachedImages.length;
        if (toolbar) {
            toolbar.hidden = isWriteEntryMobileLayout() ? false : count !== 1;
        }
        if (stickyAdd) stickyAdd.hidden = !(count > 0 && count < MAX_IMAGE_WARN);
        updatePhotoBadge();
        if (!count) {
            gallery.className = 'entry-gallery diari-scrollbar is-empty';
            gallery.innerHTML = `
                <button type="button" class="entry-gallery-empty" id="entryGalleryEmptyTrigger">
                    <i class="bi bi-image"></i>
                    <span>Add photos to your entry</span>
                </button>
            `;
            const trigger = document.getElementById('entryGalleryEmptyTrigger');
            trigger?.addEventListener('click', () => document.getElementById('imageFileInput')?.click());
            syncWriteEntryGalleryViewport();
            if (typeof window.__diariAdjustWriteJournal === 'function') window.__diariAdjustWriteJournal();
            return;
        }
        gallery.className = 'entry-gallery diari-scrollbar';
        const baseCells = attachedImages.map((img, idx) => {
            const src = (img.url || img.dataUrl || '').trim();
            const hasSrc = Boolean(src);
            const uploading = isImageStillUploading(img);
            const progress = uploading
                ? `<div class="entry-img-progress"><span style="width:${Math.max(8, img.progress)}%"></span></div>`
                : '';
            const spinner = uploading ? entryImgSpinnerHtml(uploadBytesLabel(img)) : '';
            const wrapState = hasSrc
                ? 'entry-gallery-img-wrap entry-gallery-img-wrap--loading'
                : 'entry-gallery-img-wrap entry-gallery-img-wrap--pending';
            const imgTag = hasSrc
                ? `<img src="${escapeHtml(src)}" alt="" decoding="async" />`
                : '';
            return `
                <div class="entry-gallery-item" data-image-id="${escapeHtml(img.id)}">
                    <div class="${wrapState}">
                        <div class="entry-img-skeleton" aria-hidden="true"></div>
                        ${imgTag}
                        ${spinner}
                    </div>
                    ${progress}
                    <div class="entry-gallery-item-overlay" aria-hidden="true"></div>
                    <div class="entry-gallery-item-actions">
                        <button type="button" class="entry-gallery-action-btn" data-action="preview" data-index="${idx}" aria-label="Preview image"><i class="bi bi-search"></i></button>
                        <button type="button" class="entry-gallery-action-btn" data-action="delete" data-id="${escapeHtml(img.id)}" aria-label="Delete image"><i class="bi bi-trash3"></i></button>
                    </div>
                </div>
            `;
        });
        gallery.innerHTML = `<div class="entry-gallery-grid entry-gallery-grid--matrix">${baseCells.join('')}</div>`;
        wireGalleryImageLoads(gallery);
        wireWriteEntryGalleryInteractions(gallery);
        gallery.querySelectorAll('[data-action="preview"]').forEach((btn) => {
            btn.addEventListener('click', () => openLightbox(Number(btn.dataset.index || 0)));
        });
        gallery.querySelectorAll('[data-action="delete"]').forEach((btn) => {
            btn.addEventListener('click', async () => {
                const id = String(btn.dataset.id || '');
                if (!id) return;
                openWriteRemovePhotoModal(id);
            });
        });
        requestAnimationFrame(() => {
            syncWriteEntryGalleryViewport();
            if (typeof window.__diariAdjustWriteJournal === 'function') window.__diariAdjustWriteJournal();
        });
    }

    function openLightbox(index) {
        if (!attachedImages.length) return;
        lightboxIndex = Math.max(0, Math.min(index, attachedImages.length - 1));
        const modal = document.getElementById('photoLightbox');
        const img = document.getElementById('photoLightboxImage');
        if (!modal || !img) return;
        const current = attachedImages[lightboxIndex];
        img.src = current.url || current.dataUrl || '';
        modal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
        const modal = document.getElementById('photoLightbox');
        if (!modal) return;
        modal.hidden = true;
        document.body.style.overflow = '';
    }

    function moveLightbox(step) {
        if (!attachedImages.length) return;
        const next = (lightboxIndex + step + attachedImages.length) % attachedImages.length;
        openLightbox(next);
    }

    async function addImagesFromFiles(fileList) {
        const { files, skipped } = await filterImageUploadFiles(fileList);
        if (skipped.length) {
            alert(
                'Some files were skipped. Use a common photo format (JPEG, PNG, WebP, GIF, HEIC, BMP, TIFF, or AVIF).'
            );
        }
        if (!files.length) return;
        const uploadFiles = Array.from(files);
        const userId = getCurrentUserId();
        if (attachedImages.length + uploadFiles.length > MAX_IMAGE_WARN) {
            alert('You added more than 10 images. This is okay, but it may affect upload speed.');
        }

        const batch = [];
        for (const file of uploadFiles) {
            const item = makeImageItem({ name: file.name });
            item.progress = 5;
            item.uploadTotal = file.size || 0;
            item.uploadLoaded = 0;
            attachedImages.push(item);
            batch.push({ file, item });
        }
        renderImageGallery();

        await Promise.all(
            batch.map(async ({ file, item }) => {
                try {
                    const previewUrl = await fileToDataUrl(file);
                    patchAttachedImage(item.id, { dataUrl: previewUrl, progress: 10 });
                    patchWriteImageUploadDom(item.id);
                } catch (_) { /* preview optional */ }
            })
        );
        renderImageGallery();

        let uploadFailures = 0;
        await Promise.all(
            batch.map(async ({ file, item }) => {
                try {
                    if (isOnlineNow() && userId) {
                        const url = await uploadImageOnline(file, userId, item.id);
                        patchAttachedImage(item.id, {
                            url,
                            dataUrl: '',
                            progress: 100,
                            uploadLoaded: item.uploadTotal || file.size || 0,
                        });
                    } else {
                        const dataUrl = await fileToDataUrl(file);
                        patchAttachedImage(item.id, { dataUrl, progress: 100 });
                    }
                } catch (e) {
                    console.error('Image add failed:', e);
                    attachedImages = attachedImages.filter((img) => img.id !== item.id);
                    uploadFailures += 1;
                }
            })
        );
        renderImageGallery();
        if (uploadFailures) {
            alert(
                uploadFailures === 1
                    ? 'One photo could not be uploaded. Try again one at a time, or use a smaller image file.'
                    : `${uploadFailures} photos could not be uploaded. Try adding them one at a time, or use smaller image files.`
            );
        }
    }

    async function flushOfflineEntryQueue() {
        if (!isOnlineNow()) return;
        const userId = getCurrentUserId();
        if (!userId) return;
        let pending = [];
        try {
            pending = await idbGetAll();
        } catch (e) {
            console.warn('Unable to read pending offline entries:', e);
            return;
        }
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
                        const file = new File([blob], `offline-${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
                        const url = await uploadImageOnline(file, userId, `offline_${Math.random()}`);
                        imageUrls.push(url);
                    }
                }
                const response = await fetch('/api/entries', {
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
                await idbDelete(item.id);
            } catch (e) {
                console.warn('Offline entry sync failed for item:', item?.id, e);
            }
        }
    }

    function isOnlineNow() {
        if (window.DiariOffline && typeof window.DiariOffline.isOnline === 'function') {
            return window.DiariOffline.isOnline();
        }
        return navigator.onLine !== false;
    }

    async function probeLiveNetwork() {
        try {
            const ctrl = new AbortController();
            const timer = window.setTimeout(() => ctrl.abort(), 4500);
            const res = await fetch('/api/health?dcReach=' + Date.now(), {
                method: 'GET',
                cache: 'no-store',
                credentials: 'same-origin',
                signal: ctrl.signal,
                headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
            });
            window.clearTimeout(timer);
            if (!res.ok) return false;
            const data = await res.json().catch(() => ({}));
            return Boolean(data && data.ok);
        } catch {
            return false;
        }
    }

    function isPwaStandaloneApp() {
        try {
            if (window.DiariPWA && typeof window.DiariPWA.isStandalone === 'function') {
                return window.DiariPWA.isStandalone();
            }
        } catch (_) {
            /* ignore */
        }
        return (
            document.documentElement.classList.contains('diari-pwa-standalone') ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true
        );
    }

    async function shouldUseOfflineSave() {
        if (!isPwaStandaloneApp()) return false;
        if (navigator.onLine === false) return true;
        const reachable = await probeLiveNetwork();
        if (!reachable) return true;
        if (window.DiariOffline && typeof window.DiariOffline.shouldSaveEntryOffline === 'function') {
            return window.DiariOffline.shouldSaveEntryOffline();
        }
        return false;
    }

    const OFFLINE_ENTRIES_KEY = 'diariCoreEntries';
    const OFFLINE_ENTRIES_OWNER_KEY = 'diariCoreEntriesOwnerId';
    const OFFLINE_CREATE_QUEUE_LS = 'diariCoreOfflineCreateQueue';
    const OFFLINE_MEDIA_DB = 'diariCoreOfflineMedia';
    const OFFLINE_MEDIA_STORE = 'pendingEntries';

    function analyzeTextLocallyBuiltin(text) {
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
            sentimentLabel:
                top === 'happy' ? 'positive' : top === 'sad' || top === 'angry' || top === 'anxious' ? 'negative' : 'neutral',
            sentimentScore: confidence,
            all_probs,
            moodScoringOffline: true,
            engine: 'offline-estimate',
            pendingServerAnalysis: true,
        };
    }

    /** PWA only: temporary estimate until server re-analyzes after sync. */
    async function analyzeForSaveOffline(text) {
        if (!isPwaStandaloneApp()) return null;
        return analyzeTextLocallyBuiltin(text);
    }

    function readOfflineCreateQueueLs() {
        try {
            const arr = JSON.parse(localStorage.getItem(OFFLINE_CREATE_QUEUE_LS) || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeOfflineCreateQueueLs(rows) {
        localStorage.setItem(OFFLINE_CREATE_QUEUE_LS, JSON.stringify(rows));
    }

    function openOfflineMediaDb() {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB unavailable'));
                return;
            }
            const req = indexedDB.open(OFFLINE_MEDIA_DB, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(OFFLINE_MEDIA_STORE)) {
                    db.createObjectStore(OFFLINE_MEDIA_STORE, { keyPath: 'id' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        });
    }

    async function queueOfflineCreateRecord(record) {
        try {
            const db = await openOfflineMediaDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(OFFLINE_MEDIA_STORE, 'readwrite');
                tx.objectStore(OFFLINE_MEDIA_STORE).put(record);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            db.close();
            return true;
        } catch (e) {
            console.warn('[WriteEntry] IndexedDB queue failed, using localStorage:', e);
            const q = readOfflineCreateQueueLs();
            q.push(record);
            writeOfflineCreateQueueLs(q);
            return false;
        }
    }

    /** PWA only: save locally when diari-offline.js did not load. */
    async function saveEntryOfflineBuiltin(opts) {
        if (!isPwaStandaloneApp()) {
            throw new Error('Offline save is only available in the installed app.');
        }
        const analysis = await analyzeForSaveOffline(opts.text || '');
        const now = new Date().toISOString();
        const localId = `offline_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const queueId = `offline_entry_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const imageUrls = (opts.images || [])
            .map((im) => im.url || '')
            .filter((u) => u && !String(u).startsWith('data:'));

        const entry = {
            id: localId,
            title: opts.title || '',
            text: opts.text || '',
            tags: opts.tags || [],
            imageUrls,
            date: opts.entryDateTimeLocal ? new Date(opts.entryDateTimeLocal).toISOString() : now,
            createdAt: now,
            characterCount: String(opts.text || '').length,
            ...analysis,
        };

        const queueRecord = {
            id: queueId,
            localEntryId: localId,
            userId: opts.userId,
            title: opts.title || '',
            entryDateTimeLocal: opts.entryDateTimeLocal || '',
            text: opts.text || '',
            tags: opts.tags || [],
            images: (opts.images || []).map((im) => ({ url: im.url || '', dataUrl: im.dataUrl || '' })),
            createdAt: now,
        };

        await queueOfflineCreateRecord(queueRecord);

        let list = [];
        try {
            list = JSON.parse(localStorage.getItem(OFFLINE_ENTRIES_KEY) || '[]');
            if (!Array.isArray(list)) list = [];
        } catch {
            list = [];
        }
        list.push(entry);
        try {
            localStorage.setItem(OFFLINE_ENTRIES_KEY, JSON.stringify(list));
            if (opts.userId) {
                localStorage.setItem(OFFLINE_ENTRIES_OWNER_KEY, String(opts.userId));
            }
        } catch (storageErr) {
            const trimmed = list.slice(-40);
            localStorage.setItem(OFFLINE_ENTRIES_KEY, JSON.stringify(trimmed));
            if (opts.userId) localStorage.setItem(OFFLINE_ENTRIES_OWNER_KEY, String(opts.userId));
            if (trimmed.length < list.length) {
                throw new Error('Browser app storage is full. Remove photos or free space, then try again.');
            }
            throw storageErr;
        }

        return { entry, queueOk: true };
    }

    function readJsonStorage(key, fallbackValue) {
        try {
            const raw = localStorage.getItem(key);
            if (!raw) return fallbackValue;
            const parsed = JSON.parse(raw);
            return parsed ?? fallbackValue;
        } catch {
            return fallbackValue;
        }
    }

    function writeJsonStorage(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {
            console.warn(`Failed to persist ${key}:`, e);
        }
    }

    function getTagUsageMap() {
        const raw = readJsonStorage(TAG_USAGE_KEY, {});
        return raw && typeof raw === 'object' ? raw : {};
    }

    function setTagUsage(tagName, ts = Date.now()) {
        const key = normalizeTag(tagName).toLowerCase();
        if (!key) return;
        const usage = getTagUsageMap();
        usage[key] = ts;
        writeJsonStorage(TAG_USAGE_KEY, usage);
    }

    function getTagSyncQueue() {
        const queue = readJsonStorage(TAG_SYNC_QUEUE_KEY, []);
        return Array.isArray(queue) ? queue : [];
    }

    function setTagSyncQueue(queue) {
        writeJsonStorage(TAG_SYNC_QUEUE_KEY, Array.isArray(queue) ? queue : []);
    }

    function queueTagOperation(op) {
        const queue = getTagSyncQueue();
        queue.push({ ...op, queuedAt: Date.now() });
        setTagSyncQueue(queue);
    }

    async function flushTagSyncQueue() {
        const userId = getCurrentUserId();
        if (!userId || !isOnlineNow()) return;
        const queue = getTagSyncQueue();
        if (!queue.length) return;
        const remaining = [];
        for (const op of queue) {
            try {
                if (op?.type === 'add') {
                    const res = await fetch('/api/tags', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId,
                            tag: op.tag,
                            iconName: op.iconName || '',
                        }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || !json?.success) throw new Error(json?.error || 'Add sync failed');
                } else if (op?.type === 'delete') {
                    const res = await fetch('/api/tags', {
                        method: 'DELETE',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            userId,
                            tag: op.tag,
                        }),
                    });
                    const json = await res.json().catch(() => ({}));
                    if (!res.ok || !json?.success) throw new Error(json?.error || 'Delete sync failed');
                }
            } catch (e) {
                console.warn('Deferred tag sync failed, keeping in queue:', e);
                remaining.push(op);
            }
        }
        setTagSyncQueue(remaining);
    }

    function getOrderedTags(items) {
        const usage = getTagUsageMap();
        return [...items].sort((a, b) => {
            const aUsed = Number(usage[normalizeTag(a.tag).toLowerCase()] || 0);
            const bUsed = Number(usage[normalizeTag(b.tag).toLowerCase()] || 0);
            if (aUsed !== bUsed) return bUsed - aUsed;
            return Number(a.baseOrder || 0) - Number(b.baseOrder || 0);
        });
    }

    function setTagExpanded(nextValue) {
        tagExpanded = !!nextValue;
        localStorage.setItem(TAG_EXPANDED_KEY, tagExpanded ? '1' : '0');
    }

    function updateMoreButton(extraCount) {
        const moreBtn = document.getElementById('moreTagsBtn');
        if (!moreBtn) return;
        const textEl = moreBtn.querySelector('span');
        if (!extraCount || extraCount <= 0) {
            moreBtn.style.display = 'none';
            moreBtn.classList.remove('expanded');
            if (textEl) textEl.textContent = 'more';
            return;
        }
        moreBtn.style.display = 'inline-flex';
        moreBtn.classList.toggle('expanded', tagExpanded);
        if (textEl) {
            textEl.textContent = tagExpanded ? 'less' : `+ ${extraCount} more tags`;
        }
    }

    function applyTagCollapse() {
        const container = document.querySelector('.tags-container');
        const addBtn = container?.querySelector('.tag-btn.add-tag');
        if (!container || !addBtn) return;

        const tagButtons = Array.from(container.querySelectorAll('.tag-btn:not(.add-tag)'));
        tagButtons.forEach((btn) => {
            btn.classList.remove('extra-row');
            btn.classList.remove('is-hidden-row');
            btn.style.display = 'flex';
        });
        addBtn.style.display = 'flex';

        if (!tagButtons.length) {
            updateMoreButton(0);
            return;
        }

        const rowTop = tagButtons[0].offsetTop;
        const firstRowTags = tagButtons.filter((btn) => Math.abs(btn.offsetTop - rowTop) <= 2);
        const firstRowSet = new Set(firstRowTags);
        const extras = tagButtons.filter((btn) => !firstRowSet.has(btn));
        extras.forEach((btn) => btn.classList.add('extra-row'));

        if (!tagExpanded) {
            const firstHidden = extras[0] || null;
            if (firstHidden) container.insertBefore(addBtn, firstHidden);
            extras.forEach((btn) => {
                btn.classList.add('is-hidden-row');
            });
            container.classList.add('is-collapsed');
            container.classList.remove('is-expanded');
        } else {
            container.appendChild(addBtn);
            extras.forEach((btn) => {
                btn.classList.remove('is-hidden-row');
            });
            container.classList.add('is-expanded');
            container.classList.remove('is-collapsed');
        }
        updateMoreButton(extras.length);
    }

    function renderTagButtons() {
        const container = document.querySelector('.tags-container');
        if (!container) return;
        const addBtn = container.querySelector('.tag-btn.add-tag');
        container.querySelectorAll('.tag-btn:not(.add-tag)').forEach((el) => el.remove());

        const ordered = getOrderedTags(tagItemsState);
        ordered.forEach((item) => {
            const btn = document.createElement('button');
            btn.className = 'tag-btn';
            btn.dataset.tag = item.tag;
            btn.dataset.iconName = item.iconName || '';
            btn.dataset.iconType = 'bi';
            btn.dataset.custom = item.isDefault ? '0' : '1';
            const resolvedBi = item.iconName || iconClassForTag(item.tag);
            const deleteMarkup = item.isDefault
                ? ''
                : `<button type="button" class="tag-delete-btn" aria-label="Delete ${escapeHtml(item.tag)} tag" title="Delete tag">&times;</button>`;
            btn.innerHTML = `${iconMarkup(resolvedBi, 'bi')}<span>${escapeHtml(item.tag)}</span>${deleteMarkup}`;
            btn.addEventListener('click', function(event) {
                const deleteBtn = event.target.closest('.tag-delete-btn');
                if (deleteBtn) return;
                const tag = normalizeTag(this.dataset.tag);
                if (!tag) return;
                if (selectedTags.has(tag)) {
                    selectedTags.delete(tag);
                    this.classList.remove('selected');
                } else {
                    selectedTags.add(tag);
                    this.classList.add('selected');
                    setTagUsage(tag);
                }
                applyTagCollapse();
            });
            const deleteBtn = btn.querySelector('.tag-delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const tag = normalizeTag(btn.dataset.tag);
                    if (!tag) return;
                    openWriteDeleteTagModal(tag);
                });
            }
            if (selectedTags.has(item.tag)) btn.classList.add('selected');
            if (addBtn) container.insertBefore(btn, addBtn);
            else container.appendChild(btn);
        });

        applyTagCollapse();
    }

    async function syncUserTagsIntoUI() {
        const userId = getCurrentUserId();
        const defaults = DEFAULT_TAGS.map((x, idx) => ({
            tag: normalizeTag(x.name),
            iconName: x.icon,
            isDefault: true,
            baseOrder: idx,
        }));
        let merged = [...defaults];

        if (userId && isOnlineNow()) {
            try {
                const res = await fetch(`/api/tags?userId=${encodeURIComponent(String(userId))}`);
                const json = await res.json();
                if (res.ok && json.success) {
                    const custom = Array.isArray(json.tagItems)
                        ? json.tagItems.map((x, idx) => ({
                            tag: normalizeTag(x?.tag),
                            iconName: String(x?.iconName || '').trim().toLowerCase(),
                            isDefault: false,
                            baseOrder: defaults.length + idx,
                        }))
                        : [];
                    merged = defaults.concat(custom);
                }
            } catch (e) {
                console.warn('Using local tag fallback due to sync error:', e);
            }
        }

        // Apply offline queue effects optimistically in UI.
        const queue = getTagSyncQueue();
        queue.forEach((op) => {
            const key = normalizeTag(op?.tag).toLowerCase();
            if (!key) return;
            if (op.type === 'add') {
                if (!merged.some((x) => normalizeTag(x.tag).toLowerCase() === key)) {
                    merged.push({
                        tag: normalizeTag(op.tag),
                        iconName: String(op.iconName || '').trim().toLowerCase(),
                        isDefault: DEFAULT_TAG_SET.has(key),
                        baseOrder: merged.length,
                    });
                }
            } else if (op.type === 'delete') {
                merged = merged.filter((x) => normalizeTag(x.tag).toLowerCase() !== key || x.isDefault);
            }
        });

        const seen = new Set();
        tagItemsState = merged.filter((item, idx) => {
            const key = normalizeTag(item?.tag).toLowerCase();
            if (!key || seen.has(key)) return false;
            seen.add(key);
            item.baseOrder = Number(item.baseOrder ?? idx);
            item.isDefault = DEFAULT_TAG_SET.has(key);
            if (!item.iconName) item.iconName = iconClassForTag(item.tag);
            return true;
        });
        renderTagButtons();
        await flushTagSyncQueue();
    }

    function updateJournalDateTime() {
        const dateTimeEl = document.getElementById('journalDateTime');
        if (!dateTimeEl) return;
        const sourceDate = manualDateTime || new Date();
        const datePart = sourceDate.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
        const timePart = sourceDate.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
        dateTimeEl.textContent = `${datePart} | ${timePart}`;
    }
    
    // Reset selected states on page load
    function resetSelections() {
        // Reset feelings selection
        selectedFeeling = null;
        const feelingCards = document.querySelectorAll('.feeling-card');
        feelingCards.forEach(card => {
            card.classList.remove('selected');
        });
        
        // Reset tags selection
        selectedTags.clear();
        const tagButtons = document.querySelectorAll('.tag-btn:not(.add-tag)');
        tagButtons.forEach(button => {
            button.classList.remove('selected');
        });
        
        console.log('Selections reset on page load');
    }
    
    // Call reset function immediately
    resetSelections();
    
    // Category switching functionality
    const categoryButtons = document.querySelectorAll('.category-btn');
    const categoryGrids = document.querySelectorAll('.category-grid');
    
    categoryButtons.forEach(button => {
        button.addEventListener('click', function() {
            const category = this.dataset.category;
            
            // Remove active class from all buttons and grids
            categoryButtons.forEach(btn => btn.classList.remove('active'));
            categoryGrids.forEach(grid => grid.classList.remove('active'));
            
            // Add active class to clicked button and corresponding grid
            this.classList.add('active');
            const targetGrid = document.querySelector(`.category-grid[data-category="${category}"]`);
            if (targetGrid) {
                targetGrid.classList.add('active');
            }
        });
    });
    
    // Feeling selection functionality
    const feelingCards = document.querySelectorAll('.feeling-card');
    feelingCards.forEach(card => {
        card.addEventListener('click', function() {
            // Remove selected class from all cards
            feelingCards.forEach(c => c.classList.remove('selected'));
            
            // Add selected class to clicked card
            this.classList.add('selected');
            selectedFeeling = this.dataset.feeling;
            
            console.log('Selected feeling:', selectedFeeling);
        });
    });
    
    function updateTagVisibility() {
        applyTagCollapse();
    }
    
    // Initialize tags (defaults + user tags) then apply visibility rules.
    // Must complete before shell release or static HTML tags flash until fetch returns.
    await syncUserTagsIntoUI();
    
    // Update on window resize
    window.addEventListener('resize', updateTagVisibility);
    window.addEventListener('online', () => {
        flushTagSyncQueue();
        syncUserTagsIntoUI();
        flushOfflineEntryQueue();
        if (window.DiariOffline?.isPwaUiContext?.()) {
            if (window.DiariOffline.requestPwaSync) {
                void window.DiariOffline.requestPwaSync({ trustNavigatorOnline: true });
            } else if (window.DiariOffline.syncAll) {
                void window.DiariOffline.syncAll({ trustNavigatorOnline: true });
            }
        }
    });
    window.addEventListener('diari-offline-sync', () => {
        flushTagSyncQueue();
        flushOfflineEntryQueue();
    });
    
    const customTagModal = document.getElementById('customTagModal');
    const customTagNameInput = document.getElementById('customTagNameInput');
    const customTagIconSearch = document.getElementById('customTagIconSearch');
    const customTagIconsGrid = document.getElementById('customTagIconsGrid');
    const customTagPagination = document.getElementById('customTagPagination');
    const customTagIconMeta = document.getElementById('customTagIconMeta');
    const customTagSaveBtn = document.getElementById('customTagSaveBtn');
    const customTagDuplicateAlert = document.getElementById('customTagDuplicateAlert');
    const customTagDuplicatePill = document.getElementById('customTagDuplicatePill');
    const writeDiscardModal = document.getElementById('writeDiscardModal');
    const writeDiscardKeepBtn = document.getElementById('writeDiscardKeepBtn');
    const writeDiscardConfirmBtn = document.getElementById('writeDiscardConfirmBtn');
    const writeDeleteTagModal = document.getElementById('writeDeleteTagModal');
    const writeDeleteTagKeepBtn = document.getElementById('writeDeleteTagKeepBtn');
    const writeDeleteTagConfirmBtn = document.getElementById('writeDeleteTagConfirmBtn');
    const writeDeleteTagPill = document.getElementById('writeDeleteTagPill');
    const writeDeleteTagWarnText = document.getElementById('writeDeleteTagWarnText');
    const writeRemovePhotoModal = document.getElementById('writeRemovePhotoModal');
    const writeRemovePhotoCancelBtn = document.getElementById('writeRemovePhotoCancelBtn');
    const writeRemovePhotoConfirmBtn = document.getElementById('writeRemovePhotoConfirmBtn');
    const writeRemovePhotoPreviewTitle = document.getElementById('writeRemovePhotoPreviewTitle');
    const writeRemovePhotoPreviewMeta = document.getElementById('writeRemovePhotoPreviewMeta');

    let pendingDeleteTagName = null;
    let pendingRemoveWritePhotoId = null;
    /** @type {null | { kind: 'href', href: string } | { kind: 'logout' }} */
    let pendingWriteDiscard = null;

    function releaseBodyScrollIfNoModals() {
        const d = writeDiscardModal;
        const t = writeDeleteTagModal;
        const c = customTagModal;
        const rp = writeRemovePhotoModal;
        const allClosed =
            (!d || d.hidden) && (!t || t.hidden) && (!c || c.hidden) && (!rp || rp.hidden);
        if (allClosed) document.body.style.overflow = '';
    }

    function hideCustomTagDuplicateAlert() {
        if (customTagDuplicateAlert) customTagDuplicateAlert.hidden = true;
    }

    function showCustomTagDuplicateAlert(tagName) {
        if (!customTagDuplicateAlert || !customTagDuplicatePill) return;
        const name = escapeHtml(String(tagName || '').trim());
        const rawIcon = String(selectedPickerIconName || '').trim().toLowerCase();
        const iconHtml = rawIcon && /^[a-z0-9-]+$/.test(rawIcon)
            ? `<i class="bi bi-${escapeHtml(rawIcon)}"></i>`
            : '';
        customTagDuplicatePill.innerHTML = `${iconHtml}<span>${name}</span>`;
        customTagDuplicateAlert.hidden = false;
    }

    function openWriteDiscardModal() {
        if (!writeDiscardModal) return;
        writeDiscardModal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeWriteDiscardModal() {
        if (!writeDiscardModal) return;
        pendingWriteDiscard = null;
        writeDiscardModal.hidden = true;
        releaseBodyScrollIfNoModals();
    }

    function resolveBiIconSuffix(raw) {
        const s = String(raw || '').trim();
        const m = /^bi\s+bi-([\w-]+)$/i.exec(s);
        if (m) return m[1].toLowerCase();
        if (/^[a-z0-9-]+$/i.test(s)) return s.toLowerCase();
        return 'hash';
    }

    function openWriteDeleteTagModal(tag) {
        const normalized = normalizeTag(tag);
        if (!normalized || !writeDeleteTagModal || !writeDeleteTagPill) return;
        pendingDeleteTagName = normalized;
        const item = tagItemsState.find((x) => normalizeTag(x.tag).toLowerCase() === normalized.toLowerCase());
        const icn = item?.iconName || iconClassForTag(normalized);
        const bi = resolveBiIconSuffix(icn);
        writeDeleteTagPill.innerHTML = `<i class="bi bi-${escapeHtml(bi)}"></i><span>${escapeHtml(normalized)}</span>`;
        if (writeDeleteTagWarnText) {
            writeDeleteTagWarnText.innerHTML = `Any entries tagged with &lsquo;<strong>${escapeHtml(normalized)}</strong>&rsquo; will no longer have this tag. This cannot be undone.`;
        }
        writeDeleteTagModal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    function closeWriteDeleteTagModal() {
        pendingDeleteTagName = null;
        if (writeDeleteTagModal) writeDeleteTagModal.hidden = true;
        releaseBodyScrollIfNoModals();
    }

    writeDiscardKeepBtn?.addEventListener('click', () => closeWriteDiscardModal());
    writeDiscardConfirmBtn?.addEventListener('click', () => {
        const p = pendingWriteDiscard;
        pendingWriteDiscard = null;
        if (writeDiscardModal) writeDiscardModal.hidden = true;
        releaseBodyScrollIfNoModals();
        if (p?.kind === 'logout') {
            if (window.DiariTheme && typeof window.DiariTheme.logout === 'function') {
                window.DiariTheme.logout('login.html');
            } else {
                try {
                    localStorage.removeItem('diariCoreUser');
                } catch (_) {}
                window.location.href = 'login.html';
            }
            return;
        }
        try {
            localStorage.removeItem('diariCoreDraft');
        } catch (_) {}
        window.location.href = p?.kind === 'href' ? p.href : 'dashboard.html';
    });
    writeDiscardModal?.addEventListener('click', (e) => {
        if (e.target?.matches?.('[data-write-discard-dismiss]')) closeWriteDiscardModal();
    });

    writeDeleteTagKeepBtn?.addEventListener('click', () => closeWriteDeleteTagModal());
    writeDeleteTagConfirmBtn?.addEventListener('click', async () => {
        const tag = pendingDeleteTagName;
        if (!tag) return;
        closeWriteDeleteTagModal();
        const ok = await deleteCustomTag(tag);
        if (ok) showWriteEntryNotification('Deleted the Tag Successfully...');
    });
    writeDeleteTagModal?.addEventListener('click', (e) => {
        if (e.target?.matches?.('[data-write-delete-tag-dismiss]')) closeWriteDeleteTagModal();
    });

    function closeWriteRemovePhotoModal() {
        pendingRemoveWritePhotoId = null;
        if (writeRemovePhotoModal) writeRemovePhotoModal.hidden = true;
        releaseBodyScrollIfNoModals();
    }

    function openWriteRemovePhotoModal(imageId) {
        const id = String(imageId || '').trim();
        if (!id || !writeRemovePhotoModal) return;
        const titleRaw = String(document.getElementById('journalTitleInput')?.value || '').trim();
        const textRaw = String(document.getElementById('journalText')?.value || '').trim();
        const fallbackTitle = textRaw ? textRaw.split('\n')[0].trim() : '';
        const previewTitle = (titleRaw || fallbackTitle || 'Untitled entry').slice(0, 100);
        const dateLabel = String(document.getElementById('journalDateTime')?.textContent || '').trim();
        const tagsLabel = Array.from(selectedTags).slice(0, 2).join(', ');
        const previewMeta = [dateLabel, tagsLabel].filter(Boolean).join(' · ') || 'No date';
        if (writeRemovePhotoPreviewTitle) writeRemovePhotoPreviewTitle.textContent = previewTitle;
        if (writeRemovePhotoPreviewMeta) writeRemovePhotoPreviewMeta.textContent = previewMeta;
        pendingRemoveWritePhotoId = id;
        writeRemovePhotoModal.hidden = false;
        document.body.style.overflow = 'hidden';
    }

    writeRemovePhotoCancelBtn?.addEventListener('click', () => closeWriteRemovePhotoModal());
    writeRemovePhotoConfirmBtn?.addEventListener('click', () => {
        const id = pendingRemoveWritePhotoId;
        closeWriteRemovePhotoModal();
        if (!id) return;
        attachedImages = attachedImages.filter((img) => img.id !== id);
        renderImageGallery();
    });
    writeRemovePhotoModal?.addEventListener('click', (e) => {
        if (e.target?.matches?.('[data-write-remove-photo-dismiss]')) closeWriteRemovePhotoModal();
    });

    function filteredPickerIcons() {
        const q = customTagSearch.trim().toLowerCase();
        if (!q) return pickerIconNames;
        const aliasTerms = ICON_SEARCH_ALIASES[q] || [];
        return pickerIconNames.filter((name) => {
            if (name.includes(q)) return true;
            return aliasTerms.some((term) => name.includes(term));
        });
    }

    function renderCustomTagIconPage() {
        if (!customTagIconsGrid || !customTagPagination || !customTagIconMeta) return;
        const filtered = filteredPickerIcons();
        const perPage = getCustomTagIconsPerPage();
        const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
        customTagPage = Math.max(0, Math.min(customTagPage, pageCount - 1));
        const start = customTagPage * perPage;
        const end = Math.min(filtered.length, start + perPage);
        const items = filtered.slice(start, end);
        const compactIcons = isCustomTagPickerCompact() || perPage <= 25;
        customTagIconsGrid.innerHTML = items
            .map((iconName) => {
                const label = escapeHtml(iconName);
                const labelSpan = compactIcons ? '' : `<span>${label}</span>`;
                const aria = compactIcons ? ` aria-label="${label}" title="${label}"` : '';
                return `
                <button type="button" class="custom-tag-icon-btn${selectedPickerIconName === iconName ? ' is-selected' : ''}" data-icon-name="${escapeHtml(iconName)}"${aria}>
                    <i class="bi bi-${escapeHtml(iconName)}"></i>
                    ${labelSpan}
                </button>
            `;
            })
            .join('');
        customTagIconMeta.textContent = `${filtered.length} icons • page ${customTagPage + 1}/${pageCount}`;

        customTagPagination.innerHTML = `
            <button type="button" class="custom-tag-page-btn" data-page="prev" ${customTagPage <= 0 ? 'disabled' : ''}>Previous</button>
            <span class="custom-tag-page-meta">Showing ${filtered.length ? (start + 1) : 0}–${end} of ${filtered.length}</span>
            <button type="button" class="custom-tag-page-btn" data-page="next" ${customTagPage >= pageCount - 1 ? 'disabled' : ''}>Next</button>
        `;

        customTagIconsGrid.querySelectorAll('.custom-tag-icon-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedPickerIconName = btn.dataset.iconName || '';
                renderCustomTagIconPage();
                updateCustomTagSaveState();
            });
        });
        customTagPagination.querySelectorAll('.custom-tag-page-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.page === 'prev') customTagPage -= 1;
                if (btn.dataset.page === 'next') customTagPage += 1;
                renderCustomTagIconPage();
            });
        });
    }

    function updateCustomTagSaveState() {
        if (!customTagSaveBtn) return;
        const validName = normalizeTag(customTagNameInput?.value || '');
        customTagSaveBtn.disabled = !(validName && selectedPickerIconName);
    }

    async function ensurePickerIconNamesLoaded() {
        if (pickerIconNames.length) return;
        const res = await fetch('/bootstrap-icon-names.json');
        const json = await res.json();
        if (!Array.isArray(json)) throw new Error('Invalid icon list');
        pickerIconNames = json
            .map((x) => String(x || '').trim().toLowerCase())
            .filter((x) => /^[a-z0-9-]+$/.test(x));
    }

    async function openCustomTagModal() {
        if (!customTagModal) return;
        hideCustomTagDuplicateAlert();
        customTagNameInput.value = '';
        customTagIconSearch.value = '';
        customTagSearch = '';
        selectedPickerIconName = '';
        customTagPage = 0;
        customTagSaveBtn.disabled = true;
        customTagModal.hidden = false;
        document.body.style.overflow = 'hidden';
        customTagIconMeta.textContent = 'Loading icons...';
        try {
            await ensurePickerIconNamesLoaded();
            renderCustomTagIconPage();
        } catch (e) {
            customTagIconMeta.textContent = 'Could not load icons. Try again.';
            customTagIconsGrid.innerHTML = '';
            customTagPagination.innerHTML = '';
            console.error(e);
        }
    }

    function closeCustomTagModal() {
        if (!customTagModal) return;
        hideCustomTagDuplicateAlert();
        customTagModal.hidden = true;
        releaseBodyScrollIfNoModals();
    }

    // Add tag functionality
    const addTagBtn = document.querySelector('.tag-btn.add-tag');
    addTagBtn.addEventListener('click', openCustomTagModal);
    const moreTagsBtn = document.getElementById('moreTagsBtn');
    if (moreTagsBtn) {
        moreTagsBtn.addEventListener('click', () => {
            setTagExpanded(!tagExpanded);
            applyTagCollapse();
        });
    }

    if (customTagModal) {
        customTagModal.querySelectorAll('[data-role="close-modal"]').forEach((el) => {
            el.addEventListener('click', closeCustomTagModal);
        });
        customTagModal.addEventListener('click', (event) => {
            if (event.target === customTagModal) closeCustomTagModal();
        });
    }
    if (customTagIconSearch) {
        customTagIconSearch.addEventListener('input', () => {
            customTagSearch = String(customTagIconSearch.value || '');
            customTagPage = 0;
            renderCustomTagIconPage();
        });
    }
    if (customTagNameInput) {
        customTagNameInput.addEventListener('input', () => {
            hideCustomTagDuplicateAlert();
            updateCustomTagSaveState();
        });
    }
    if (customTagSaveBtn) {
        customTagSaveBtn.addEventListener('click', async () => {
            const tagName = normalizeTag(customTagNameInput?.value || '');
            if (!tagName || !selectedPickerIconName) return;
            const ok = await createNewTag(tagName, selectedPickerIconName, 'bi');
            if (ok) {
                closeCustomTagModal();
                showWriteEntryNotification('Added the Tag Successfully...');
                } else {
                customTagNameInput.focus();
                customTagNameInput.select();
                }
            });
        }
        
    window.addEventListener('resize', () => {
        if (customTagModal && !customTagModal.hidden) {
            renderCustomTagIconPage();
        }
    });

    async function createNewTag(tagName, iconName = '', iconType = 'bi') {
        const normalizedName = normalizeTag(tagName);
        if (!normalizedName) return false;
        const normalizedKey = normalizedName.toLowerCase();
        if (tagItemsState.some((item) => normalizeTag(item.tag).toLowerCase() === normalizedKey)) {
            showCustomTagDuplicateAlert(normalizedName);
            return false;
        }

        const nextTag = {
            tag: normalizedName,
            iconName: (iconType === 'bi' ? iconName : '') || iconClassForTag(normalizedName),
            isDefault: false,
            baseOrder: tagItemsState.length + DEFAULT_TAGS.length + 10,
        };
        tagItemsState.push(nextTag);
        setTagUsage(normalizedName);
        setTagExpanded(true);
        renderTagButtons();

        const userId = getCurrentUserId();
        if (!userId) {
            queueTagOperation({ type: 'add', tag: normalizedName, iconName: nextTag.iconName });
            return true;
        }

        if (!isOnlineNow()) {
            queueTagOperation({ type: 'add', tag: normalizedName, iconName: nextTag.iconName });
            return true;
        }

        try {
            const response = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, tag: normalizedName, iconName: nextTag.iconName }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || 'Failed to save tag.');
            }
        } catch (e) {
            console.error('Failed to save tag:', e);
            queueTagOperation({ type: 'add', tag: normalizedName, iconName: nextTag.iconName });
        }

        return true;
    }

    function stripTagFromLocalStoredEntries(tagName) {
        const key = normalizeTag(tagName).toLowerCase();
        if (!key) return;
        try {
            const raw = localStorage.getItem('diariCoreEntries');
            const list = JSON.parse(raw || '[]');
            if (!Array.isArray(list)) return;
            let changed = false;
            const next = list.map((e) => {
                const tags = Array.isArray(e?.tags) ? e.tags : [];
                const filtered = tags.filter((t) => normalizeTag(t).toLowerCase() !== key);
                if (filtered.length === tags.length) return e;
                changed = true;
                return { ...e, tags: filtered };
            });
            if (changed) localStorage.setItem('diariCoreEntries', JSON.stringify(next));
        } catch (_) {
            /* ignore */
        }
    }

    async function deleteCustomTag(tagName) {
        const normalized = normalizeTag(tagName);
        const key = normalized.toLowerCase();
        if (!normalized || DEFAULT_TAG_SET.has(key)) return false;
        tagItemsState = tagItemsState.filter((x) => normalizeTag(x.tag).toLowerCase() !== key);
        selectedTags.delete(normalized);
        renderTagButtons();
        stripTagFromLocalStoredEntries(normalized);

        const userId = getCurrentUserId();
        if (!userId || !isOnlineNow()) {
            queueTagOperation({ type: 'delete', tag: normalized });
            return true;
        }
        try {
            const response = await fetch('/api/tags', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, tag: normalized }),
            });
            const result = await response.json().catch(() => ({}));
            if (!response.ok || !result?.success) {
                throw new Error(result?.error || 'Failed to delete tag.');
            }
        } catch (e) {
            console.warn('Delete will sync later:', e);
            queueTagOperation({ type: 'delete', tag: normalized });
        }
        return true;
    }

    const imageFileInput = document.getElementById('imageFileInput');
    const addPhotosBtn = document.getElementById('addPhotosBtn');
    const entrySplitLayout = document.getElementById('entrySplitLayout');
    const entryDropOverlay = document.getElementById('entryDropOverlay');
    const photoLightbox = document.getElementById('photoLightbox');
    const photoLightboxClose = document.getElementById('photoLightboxClose');
    const photoLightboxPrev = document.getElementById('photoLightboxPrev');
    const photoLightboxNext = document.getElementById('photoLightboxNext');

    addPhotosBtn?.addEventListener('click', () => imageFileInput?.click());
    imageFileInput?.addEventListener('change', async () => {
        const picked = imageFileInput.files ? Array.from(imageFileInput.files) : [];
        imageFileInput.value = '';
        await addImagesFromFiles(picked);
    });

    if (entrySplitLayout) {
        const hasImageDrag = (evt) => Array.from(evt.dataTransfer?.types || []).includes('Files');
        entrySplitLayout.addEventListener('dragenter', (event) => {
            if (!hasImageDrag(event)) return;
            event.preventDefault();
            dragDepth += 1;
            if (entryDropOverlay) entryDropOverlay.hidden = false;
        });
        entrySplitLayout.addEventListener('dragover', (event) => {
            if (!hasImageDrag(event)) return;
            event.preventDefault();
        });
        entrySplitLayout.addEventListener('dragleave', (event) => {
            if (!hasImageDrag(event)) return;
            event.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0 && entryDropOverlay) entryDropOverlay.hidden = true;
        });
        entrySplitLayout.addEventListener('drop', async (event) => {
            if (!hasImageDrag(event)) return;
            event.preventDefault();
            dragDepth = 0;
            if (entryDropOverlay) entryDropOverlay.hidden = true;
            await addImagesFromFiles(event.dataTransfer?.files || []);
        });
    }

    photoLightboxClose?.addEventListener('click', closeLightbox);
    photoLightboxPrev?.addEventListener('click', () => moveLightbox(-1));
    photoLightboxNext?.addEventListener('click', () => moveLightbox(1));
    photoLightbox?.addEventListener('click', (event) => {
        if (event.target === photoLightbox) closeLightbox();
    });

    document.addEventListener('click', (e) => {
        const g = document.getElementById('entryGallery');
        if (!g || g.classList.contains('is-empty')) return;
        const item = e.target.closest('.entry-gallery-item');
        if (item && g.contains(item)) return;
        g.querySelectorAll('.entry-gallery-item.is-active').forEach((el) => el.classList.remove('is-active'));
    });
    document.getElementById('entryGalleryStickyAdd')?.addEventListener('click', () => {
        document.getElementById('imageFileInput')?.click();
    });

    renderImageGallery();
    initWriteGalleryViewportObserver();
    requestAnimationFrame(() => {
        syncWriteEntryGalleryViewport();
        window.setTimeout(syncWriteEntryGalleryViewport, 120);
    });
    syncWriteEntryGalleryViewport();

    const journalText = document.getElementById('journalText');
    const journalTitleInput = document.getElementById('journalTitleInput');
    const wordCountEl = document.getElementById('wordCount');
    const journalWordCounter = document.getElementById('journalWordCounter');
    const ENTRY_WORD_MAX = 300;
    const ENTRY_WORD_NEAR = 270;

    function countEntryWords(text) {
        const t = String(text || '').trim();
        if (!t) return 0;
        return t.split(/\s+/).length;
    }

    function updateJournalWordCounter() {
        if (!journalText || !wordCountEl) return;
        const count = countEntryWords(journalText.value);
        wordCountEl.textContent = String(count);
        if (!journalWordCounter) return;
        journalWordCounter.classList.toggle('is-over-limit', count > ENTRY_WORD_MAX);
        journalWordCounter.classList.toggle('is-near-limit', count > ENTRY_WORD_NEAR && count <= ENTRY_WORD_MAX);
    }
    const journalDateTimeBtn = document.getElementById('journalDateTimeBtn');
    const journalDateTimeInput = document.getElementById('journalDateTimeInput');

    if (entrySplitLayout && window.ResizeObserver) {
        const ro = new ResizeObserver(() => autoAdjustJournalTextarea());
        ro.observe(entrySplitLayout);
    }
    window.addEventListener('resize', () => {
        window.requestAnimationFrame(() => {
            syncWriteEntryGalleryViewport();
            autoAdjustJournalTextarea();
        });
    });
    journalTitleInput?.addEventListener('input', () => autoAdjustJournalTextarea());

    if (window.DiariSecurity && typeof window.DiariSecurity.bindAngleBracketInput === 'function') {
        window.DiariSecurity.bindAngleBracketInput(journalText);
        window.DiariSecurity.bindAngleBracketInput(journalTitleInput);
        window.DiariSecurity.bindAngleBracketInput(document.getElementById('customTagNameInput'));
    }

    const toLocalInputValue = (dateObj) => {
        const d = new Date(dateObj.getTime() - dateObj.getTimezoneOffset() * 60000);
        return d.toISOString().slice(0, 16);
    };
    const nowLocalInputValue = () => toLocalInputValue(new Date());

    function parseManualFromLocalDatetime(str) {
        if (!str || typeof str !== 'string' || str.length < 16) return null;
        const d = new Date(str);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    /** Respect HTML datetime-local ordering: same string shape as max ⇒ year/month/day/time constrained consistently. */
    function applyCommittedLocalDatetime(localStr) {
        if (priorManualDateTimeOnPickerOpen === null && localStr === pickerOpenedAtLocalStr) {
            manualDateTime = null;
            } else {
            manualDateTime = parseManualFromLocalDatetime(localStr);
        }
        updateJournalDateTime();
    }

    /**
     * Only validates when value is a complete datetime-local string (yyyy-mm-ddThh:mm).
     * Incomplete values are left alone so typing / native picker aren’t wiped on blur.
     * Future values revert to last baseline or current max (never mid-keystroke — no input listener).
     */
    function clampFutureJournalDateTimeLocal() {
        if (!journalDateTimeInput) return;
        const maxStr = nowLocalInputValue();
        journalDateTimeInput.max = maxStr;
        const v = (journalDateTimeInput.value || '').trim();
        if (v.length < 16) return;
        if (v > maxStr) {
            const fb = journalDateTimeBaselineLocal || pickerOpenedAtLocalStr || maxStr;
            journalDateTimeInput.value = fb;
            journalDateTimeBaselineLocal = fb;
            applyCommittedLocalDatetime(fb);
            return;
        }
        journalDateTimeBaselineLocal = v;
        applyCommittedLocalDatetime(v);
    }

    let journalDateTimeBlurHideTimer = null;

    function hideJournalDateTimeEditor() {
        clearTimeout(journalDateTimeBlurHideTimer);
        journalDateTimeBlurHideTimer = null;
        clampFutureJournalDateTimeLocal();
        if (journalDateTimeInput) {
            journalDateTimeInput.classList.remove('journal-datetime-input--open');
            journalDateTimeInput.style.display = 'none';
        }
    }

    function journalDateTimeEditorIsOpen() {
        return Boolean(journalDateTimeInput && journalDateTimeInput.classList.contains('journal-datetime-input--open'));
    }

    if (journalDateTimeInput) {
        journalDateTimeInput.max = nowLocalInputValue();
    }

    updateJournalDateTime();
    setInterval(() => {
        if (!manualDateTime) updateJournalDateTime();
        if (journalDateTimeInput) journalDateTimeInput.max = nowLocalInputValue();
    }, 30000);

    if (journalDateTimeBtn && journalDateTimeInput) {
        journalDateTimeBtn.addEventListener('click', () => {
            if (journalDateTimeEditorIsOpen()) {
                hideJournalDateTimeEditor();
                return;
            }
            priorManualDateTimeOnPickerOpen = manualDateTime;
            const baseDate = manualDateTime || new Date();
            journalDateTimeInput.max = nowLocalInputValue();
            const candidate = new Date(baseDate);
            const now = new Date();
            const safeBase = candidate.getTime() > now.getTime() ? now : candidate;
            pickerOpenedAtLocalStr = toLocalInputValue(safeBase);
            journalDateTimeBaselineLocal = pickerOpenedAtLocalStr;
            journalDateTimeInput.value = journalDateTimeBaselineLocal;
            journalDateTimeInput.classList.add('journal-datetime-input--open');
            if (isWriteEntryMobileLayout()) {
                journalDateTimeInput.style.removeProperty('display');
            } else {
            journalDateTimeInput.style.display = 'inline-block';
            }
            journalDateTimeInput.focus();
        });

        journalDateTimeInput.addEventListener('focus', () => {
            clearTimeout(journalDateTimeBlurHideTimer);
            journalDateTimeBlurHideTimer = null;
            journalDateTimeInput.max = nowLocalInputValue();
        });
        journalDateTimeInput.addEventListener('change', () => {
            clampFutureJournalDateTimeLocal();
        });

        journalDateTimeInput.addEventListener('blur', () => {
            clearTimeout(journalDateTimeBlurHideTimer);
            journalDateTimeBlurHideTimer = setTimeout(() => {
                journalDateTimeBlurHideTimer = null;
                if (!journalDateTimeEditorIsOpen()) return;
                if (document.activeElement === journalDateTimeInput) return;
                hideJournalDateTimeEditor();
            }, 200);
        });
        journalDateTimeInput.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' || event.key === 'Enter') hideJournalDateTimeEditor();
        });
    }

    journalText.addEventListener('input', function() {
        updateJournalWordCounter();
        autoAdjustJournalTextarea();
    });
    updateJournalWordCounter();

    const VOICE_TO_WRITE_STORAGE_KEY = 'diariCoreVoiceDraftForWrite';

    function applyVoiceTranscriptHandoff() {
        if (!journalText) return;
        let raw = '';
        try {
            raw = sessionStorage.getItem(VOICE_TO_WRITE_STORAGE_KEY) || '';
        } catch (_) {
            return;
        }
        if (!raw) return;
        try {
            sessionStorage.removeItem(VOICE_TO_WRITE_STORAGE_KEY);
        } catch (_) {}

        let text = '';
        try {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
                text = parsed.text;
            }
        } catch (_) {
            text = String(raw).trim();
        }
        text = String(text || '').trim();
        if (!text) return;

        journalText.value = text;
        journalText.dispatchEvent(new Event('input', { bubbles: true }));
        showWriteEntryNotification(
            'Voice transcript added — add tags or photos if you like, then save to analyze your emotions.',
            'info'
        );
    }

    applyVoiceTranscriptHandoff();
    
    // Voice input button functionality
    const voiceInputBtn = document.getElementById('voiceInputBtn');
    
    if (voiceInputBtn) {
        voiceInputBtn.addEventListener('click', function() {
            // Both mobile and desktop now redirect to voice-entry.html
            window.location.href = 'voice-entry.html';
        });
    }
    
    async function handleSaveEntry() {
        const entryText = journalText.value.trim();
        const entryTitle = normalizeTag(journalTitleInput?.value || '');
        if (journalDateTimeInput && journalDateTimeInput.value.trim().length >= 16) {
            clampFutureJournalDateTimeLocal();
        }
        const entryDateTimeLocal = manualDateTime && journalDateTimeInput?.value ? String(journalDateTimeInput.value) : '';
        if (!entryText) {
            alert('Please write something in your journal entry.');
            return;
        }
        const entryWordCount = countEntryWords(entryText);
        if (entryWordCount > ENTRY_WORD_MAX) {
            const wordLimitMsg = `Your entry has ${entryWordCount} words. Please shorten it to ${ENTRY_WORD_MAX} words or fewer — that's our current maximum.`;
            if (typeof window.DiariToast !== 'undefined' && window.DiariToast.show) {
                window.DiariToast.show(wordLimitMsg, 'warning');
            } else {
                alert(wordLimitMsg);
            }
            updateJournalWordCounter();
            return;
        }
        Array.from(selectedTags).forEach((tag) => setTagUsage(tag));
        renderTagButtons();

        const userId = getCurrentUserId();
        const saveOffline = await shouldUseOfflineSave();

        setSavingState(true);
        window.DiariMoodAnalysis.resetSession();
        const analysisOverlay = window.DiariMoodAnalysis.ensureAnalysisOverlay();

        const offlinePayloadOpts = {
            userId,
            title: entryTitle,
            entryDateTimeLocal,
            text: entryText,
            tags: Array.from(selectedTags).map(normalizeTag).filter(Boolean),
            images: attachedImages.map((img) => ({ url: img.url || '', dataUrl: img.dataUrl || '' })),
        };

        const moodOptsForEntry = (savedEntry) => ({
            onSaveExit() {
                analysisOverlay.hidden = true;
                window.location.href = 'dashboard.html';
            },
            fetchRerunAnalysis: async () => {
                const t = journalText.value.trim();
                if (!t) throw new Error('empty');
                if (isPwaStandaloneApp() && window.DiariOffline && !isOnlineNow()) {
                    const entry = await window.DiariOffline.analyzeForOffline(t);
                    return {
                        entry,
                        isFallback: entry.moodScoringOffline === true || entry.engine === 'fallback',
                    };
                }
                const res = await fetch('/api/entries/analyze-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, text: t }),
                });
                const result = await res.json();
                if (!res.ok || !result.success) throw new Error(result.error || 'analyze failed');
                const fb = (result.analysisEngine || '').toString().toLowerCase() === 'fallback';
                return {
                    entry: {
                        emotionLabel: result.emotionLabel,
                        emotionScore: result.emotionScore,
                        sentimentLabel: result.sentimentLabel,
                        sentimentScore: result.sentimentScore,
                        all_probs: result.all_probs || {},
                        feeling: result.emotionLabel,
                    },
                    isFallback: fb,
                };
            },
        });

        const showOfflineAnalysisForEntry = async (savedEntry, skipAnalysisGate) => {
            if (!skipAnalysisGate) {
                await window.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
            }
            const isOfflineEstimate =
                savedEntry.engine === 'offline-estimate' ||
                savedEntry.pendingServerAnalysis === true ||
                savedEntry.moodScoringOffline === true;
            const offlineFallback = isOfflineEstimate || savedEntry.engine === 'fallback';
            window.DiariMoodAnalysis.showAnalysisResult(
                analysisOverlay,
                savedEntry,
                offlineFallback,
                { ...moodOptsForEntry(savedEntry), offlineEstimate: isOfflineEstimate }
            );
            try {
                localStorage.removeItem('diariCoreDraft');
            } catch (_) {}
            attachedImages = [];
            renderImageGallery();
            if (window.DiariToast) {
                window.DiariToast.show('Saved offline. We will sync when you are back online.', 'info', 4000);
            }
        };

        const saveOfflineEntryToStorage = async () => {
            if (typeof window.DiariOffline?.saveEntryLocally === 'function') {
                try {
                    const result = await window.DiariOffline.saveEntryLocally(offlinePayloadOpts);
                    return result.entry;
                } catch (moduleErr) {
                    console.warn('[WriteEntry] DiariOffline.save failed, using built-in:', moduleErr);
                    return (await saveEntryOfflineBuiltin(offlinePayloadOpts)).entry;
                }
            }
            return (await saveEntryOfflineBuiltin(offlinePayloadOpts)).entry;
        };

        if (saveOffline) {
            try {
                if (window.DiariMoodAnalysis) {
                    try {
                        await window.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
                    } catch (_) {
                        /* cached lottie or copy-only */
                    }
                    if (analysisOverlay && window.DiariMoodAnalysis.showAnalysisLoading) {
                        window.DiariMoodAnalysis.showAnalysisLoading(analysisOverlay);
                    }
                }
                const savedEntry = await saveOfflineEntryToStorage();
                if (window.DiariMoodAnalysis?.delayUntilMoodAnalysisGate) {
                    await window.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                }
                await showOfflineAnalysisForEntry(savedEntry, true);
            } catch (offlineErr) {
                console.error('Offline save failed:', offlineErr);
                if (window.DiariMoodAnalysis?.hideAnalysisOverlay) {
                    window.DiariMoodAnalysis.hideAnalysisOverlay(analysisOverlay);
                } else if (analysisOverlay) {
                    analysisOverlay.hidden = true;
                }
                const errMsg =
                    offlineErr && offlineErr.message
                        ? offlineErr.message
                        : 'Could not save offline. Try again.';
                if (window.DiariToast) {
                    window.DiariToast.show(errMsg, 'warning', 6000);
                }
            } finally {
                setSavingState(false);
            }
            return;
        }

        try {
            try {
                await window.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
            } catch (_) {
                /* overlay still shows copy-only loading */
            }
            window.DiariMoodAnalysis.showAnalysisLoading(analysisOverlay);
            let imageUrls = attachedImages.map((img) => img.url).filter(Boolean);
            if (isOnlineNow() && userId) {
                const pendingUploads = attachedImages.filter((img) => !img.url && img.dataUrl);
                for (const item of pendingUploads) {
                    const blob = dataUrlToBlob(item.dataUrl);
                    const ext = (blob.type || 'image/png').split('/')[1] || 'png';
                    const file = new File([blob], `queued-${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
                    const url = await uploadImageOnline(file, userId, item.id);
                    attachedImages = attachedImages.map((img) => (img.id === item.id ? { ...img, url, progress: 100 } : img));
                }
                imageUrls = attachedImages.map((img) => img.url).filter(Boolean);
            }
            const response = await fetch('/api/entries', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId,
                    title: entryTitle,
                    entryDateTimeLocal,
                    text: entryText,
                    tags: Array.from(selectedTags).map(normalizeTag).filter(Boolean),
                    imageUrls
                })
            });
            const result = await response.json();
            if (!response.ok || !result.success || !result.entry) {
                throw new Error(result.error || 'Failed to save entry.');
            }
            const analysisEngine = (result.analysisEngine || '').toString().toLowerCase();

            const savedEntry = {
                ...result.entry,
                title: result.entry.title || entryTitle,
                characterCount: entryText.length,
                moodScoringOffline: false,
            };
            const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
            entries.push(savedEntry);
            localStorage.setItem('diariCoreEntries', JSON.stringify(entries));
            console.log('Entry saved:', savedEntry);

            await window.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
            window.DiariMoodAnalysis.showAnalysisResult(
                analysisOverlay,
                savedEntry,
                analysisEngine === 'fallback',
                moodOptsForEntry(savedEntry)
            );
            try {
            localStorage.removeItem('diariCoreDraft');
            } catch (_) {}
            attachedImages = [];
            renderImageGallery();
        } catch (error) {
            console.error('Failed to save entry via API:', error);
            const tryOffline = saveOffline || navigator.onLine === false;
            if (!tryOffline) {
                if (window.DiariMoodAnalysis.hideAnalysisOverlay) {
                    window.DiariMoodAnalysis.hideAnalysisOverlay(analysisOverlay);
                }
                if (window.DiariToast) {
                    window.DiariToast.show('Could not save your entry. Check your connection.', 'warning', 5000);
                }
            } else {
            try {
                if (!window.DiariMoodAnalysis.showAnalysisLoading) {
                    window.DiariMoodAnalysis.showAnalysisLoading(analysisOverlay);
                }
                const savedEntry = await saveOfflineEntryToStorage();
                if (window.DiariMoodAnalysis?.delayUntilMoodAnalysisGate) {
                    await window.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                }
                await showOfflineAnalysisForEntry(savedEntry, true);
            } catch (recoveryErr) {
                console.error('Offline recovery failed:', recoveryErr);
                if (window.DiariMoodAnalysis.hideAnalysisOverlay) {
                    window.DiariMoodAnalysis.hideAnalysisOverlay(analysisOverlay);
                } else {
                    analysisOverlay.hidden = true;
                }
                const errMsg =
                    recoveryErr && recoveryErr.message
                        ? recoveryErr.message
                        : 'Could not save offline. Try again.';
                if (window.DiariToast) {
                    window.DiariToast.show(errMsg, 'warning', 6000);
                }
            }
            }
        } finally {
            setSavingState(false);
        }
    }

    // Save entry functionality (desktop + mobile save buttons)
    const saveEntryButtons = document.querySelectorAll('#saveEntryBtn, .btn-save-entry');
    saveEntryButtons.forEach((btn) => {
        btn.addEventListener('click', handleSaveEntry);
    });
    
    // Cancel functionality
    const cancelBtn = document.getElementById('cancelBtn');
    cancelBtn?.addEventListener('click', function() {
        if (hasUnsavedJournalDraft()) {
            pendingWriteDiscard = { kind: 'href', href: 'dashboard.html' };
            openWriteDiscardModal();
        } else {
            window.location.href = 'dashboard.html';
        }
    });

    function setSavingState(isSaving) {
        const buttons = document.querySelectorAll('#saveEntryBtn, .btn-save-entry');
        buttons.forEach((btn) => {
            btn.disabled = isSaving;
            btn.style.opacity = isSaving ? '0.75' : '1';
            btn.style.cursor = isSaving ? 'not-allowed' : 'pointer';
        });
    }
    
    flushOfflineEntryQueue();
    autoAdjustJournalTextarea();
    requestAnimationFrame(() => autoAdjustJournalTextarea());

    document.addEventListener(
        'click',
        (e) => {
            if (!document.body.classList.contains('page-write-entry')) return;
            const t = e.target;
            if (!t || !t.closest) return;
            if (
                t.closest('#writeDiscardModal') ||
                t.closest('#writeDeleteTagModal') ||
                t.closest('#customTagModal') ||
                t.closest('#writeRemovePhotoModal')
            )
        return;
            const lb = document.getElementById('photoLightbox');
            if (lb && !lb.hidden && lb.contains(t)) return;

            const voice = t.closest('#voiceInputBtn');
            if (voice) {
                if (!hasUnsavedJournalDraft()) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                pendingWriteDiscard = { kind: 'href', href: 'voice-entry.html' };
                openWriteDiscardModal();
                return;
            }

            const logout = t.closest('.logout-btn');
            if (logout) {
                if (!hasUnsavedJournalDraft()) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                pendingWriteDiscard = { kind: 'logout' };
                openWriteDiscardModal();
                return;
            }

            const navLink = t.closest(
                '.sidebar a.nav-link[href], .mobile-bottom-nav a[href], a.mobile-write-fab__sat[href], a.mobile-app-topbar__brand[href], a.mobile-app-topbar__profile[href]'
            );
            if (navLink) {
                const href = navLink.getAttribute('href');
                if (!href || href === '#' || href.startsWith('javascript:')) return;
                const pathOnly = href.split('?')[0].split('#')[0];
                if (/write-entry\.html$/i.test(pathOnly) || pathOnly.endsWith('/write-entry.html')) return;
                if (!hasUnsavedJournalDraft()) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                pendingWriteDiscard = { kind: 'href', href };
                openWriteDiscardModal();
            }
        },
        true
    );
    const refreshWriteEntryFromSyncedStorage = async () => {
        flushTagSyncQueue();
        await syncUserTagsIntoUI();
    };

    window.addEventListener('diari-remote-state-refreshed', () => {
        void refreshWriteEntryFromSyncedStorage();
    });

    if (window.DiariOffline?.wirePwaPageAutoSync) {
        window.DiariOffline.wirePwaPageAutoSync(refreshWriteEntryFromSyncedStorage);
    }

    if (window.DiariOffline?.registerPageRefreshHandler) {
        window.DiariOffline.registerPageRefreshHandler(() => {
            void refreshWriteEntryFromSyncedStorage();
        });
    }
    } finally {
        if (window.DiariShell && typeof window.DiariShell.release === 'function') {
            window.DiariShell.release();
        }
    }
});
