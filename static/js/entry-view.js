(function (global) {
    'use strict';

    const QUEUE_KEY = 'diariCoreEntryEditQueue';
    let entryImageItemSeq = 0;
    const IU = global.DiariImageUpload || {};
    const scheduleEntryImageUpload = typeof IU.createUploadPool === 'function'
        ? IU.createUploadPool(IU.PARALLEL_UPLOADS)
        : (task) => Promise.resolve().then(task);

    function isEntryEditMobileLayout() {
        return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    function captureEntryEditScroll() {
        const roots = [];
        const shell = document.getElementById('entriesDetailShell');
        const main = document.querySelector('.entry-view-main');
        if (shell && shell.scrollHeight > shell.clientHeight) roots.push(shell);
        if (main && main.scrollHeight > main.clientHeight) roots.push(main);
        roots.push(document.documentElement, document.body);
        const seen = new Set();
        const snapshots = [];
        roots.forEach((el) => {
            if (!el || seen.has(el)) return;
            seen.add(el);
            snapshots.push({ el, top: el.scrollTop, left: el.scrollLeft });
        });
        return { snapshots, windowY: window.scrollY };
    }

    function restoreEntryEditScroll(saved) {
        if (!saved) return;
        saved.snapshots.forEach(({ el, top, left }) => {
            if (el && typeof el.scrollTop === 'number') el.scrollTop = top;
            if (el && typeof el.scrollLeft === 'number') el.scrollLeft = left;
        });
        if (typeof saved.windowY === 'number') {
            window.scrollTo(0, saved.windowY);
        }
    }

    function isImageStillUploading(im) {
        const p = Number(im?.progress ?? 0);
        return p > 0 && p < 100;
    }

    function uploadBytesLabel(im) {
        if (typeof IU.formatProgress === 'function') {
            return IU.formatProgress(im?.uploadLoaded, im?.uploadTotal);
        }
        return '';
    }

    function createEntryImgSpinner(bytesLabel) {
        if (typeof IU.createSpinnerElement === 'function') {
            return IU.createSpinnerElement(bytesLabel);
        }
        const spinner = document.createElement('div');
        spinner.className = 'entry-img-spinner';
        spinner.setAttribute('role', 'status');
        spinner.setAttribute('aria-label', 'Uploading');
        spinner.innerHTML = '<span class="entry-img-spinner__ring" aria-hidden="true"></span>';
        return spinner;
    }

    function draftKey(entryId) {
        return `diariCoreEntryEditDraft_${entryId}`;
    }

    function getUserId() {
        if (window.DiariOffline && typeof window.DiariOffline.getUserId === 'function') {
            const uid = window.DiariOffline.getUserId();
            if (uid) return uid;
        }
        try {
            const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
            const raw = user?.id ?? user?.userId ?? 0;
            const parsed = Number(raw);
            return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
        } catch {
            return 0;
        }
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

    const DEFAULT_TAG_NAMES = ['School', 'Home', 'Friends', 'Work', 'Family', 'Health', 'Money', 'Bills'];

    function parseQueryId() {
        const q = new URLSearchParams(window.location.search);
        return (q.get('id') || q.get('entryId') || '').trim();
    }

    function loadEntryFromList(entryKey) {
        const key = String(entryKey ?? '');
        const list =
            window.DiariOffline && typeof window.DiariOffline.readEntriesCache === 'function'
                ? window.DiariOffline.readEntriesCache()
                : JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        return list.find((e) => String(e?.id ?? '') === key) || null;
    }

    function notifyPwaEntriesListRefresh() {
        if (!isPwaOfflineContext()) return;
        try {
            window.dispatchEvent(new CustomEvent('diari-entries-cache-updated'));
        } catch (_) {
            /* ignore */
        }
    }

    function replaceEntryInList(updated) {
        if (!updated) return;
        const uid = getUserId();
        if (
            isPwaOfflineContext() &&
            typeof window.DiariOffline?.mergeEntryIntoCache === 'function'
        ) {
            window.DiariOffline.mergeEntryIntoCache(
                {
                    ...updated,
                    pwaEditPending: updated.pwaEditPending === true,
                    pwaDeletionPending: updated.pwaDeletionPending === true,
                    pwaShowEdited: updated.pwaShowEdited === true,
                },
                uid
            );
            notifyPwaEntriesListRefresh();
            return;
        }
        const list = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        const key = String(updated?.id ?? '');
        const idx = list.findIndex((e) => String(e?.id ?? '') === key);
        if (idx >= 0) list[idx] = { ...list[idx], ...updated };
        else list.unshift(updated);
        localStorage.setItem('diariCoreEntries', JSON.stringify(list));
    }

    function removeEntryFromList(id) {
        const key = String(id ?? '');
        const list = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        const next = list.filter((e) => String(e?.id ?? '') !== key);
        localStorage.setItem('diariCoreEntries', JSON.stringify(next));
    }

    function readQueue() {
        try {
            const raw = localStorage.getItem(QUEUE_KEY);
            const arr = JSON.parse(raw || '[]');
            return Array.isArray(arr) ? arr : [];
        } catch {
            return [];
        }
    }

    function writeQueue(arr) {
        localStorage.setItem(QUEUE_KEY, JSON.stringify(arr));
    }

    function isOnline() {
        return navigator.onLine !== false;
    }

    function isPwaOfflineContext() {
        if (window.DiariOffline && typeof window.DiariOffline.isPwaUiContext === 'function') {
            return window.DiariOffline.isPwaUiContext();
        }
        try {
            if (window.DiariPWA && typeof window.DiariPWA.isStandalone === 'function' && window.DiariPWA.isStandalone()) {
                return true;
            }
        } catch (_) {
            /* ignore */
        }
        return (
            document.documentElement.classList.contains('diari-pwa-standalone') ||
            document.documentElement.getAttribute('data-diari-pwa') === 'standalone' ||
            (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
            window.navigator.standalone === true
        );
    }

    /** Offline entry save queue — airplane mode only (not “API probe failed” while online). */
    async function shouldSaveEntryAsOffline() {
        if (!isPwaOfflineContext()) return false;
        if (!isOnline()) return true;
        return false;
    }

    async function shouldActOffline() {
        return shouldSaveEntryAsOffline();
    }

    const ENTRY_EDIT_MEDIA_DB = 'diariCoreOfflineEntryEditMedia';
    const ENTRY_EDIT_MEDIA_STORE = 'records';
    const MAX_ENTRY_IMAGES = 10;

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

    function draftImagesKey(entryId) {
        return `entryDraftImg_${entryId}`;
    }

    function openEntryEditMediaDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(ENTRY_EDIT_MEDIA_DB, 1);
            req.onupgradeneeded = () => {
                const d = req.result;
                if (!d.objectStoreNames.contains(ENTRY_EDIT_MEDIA_STORE)) {
                    d.createObjectStore(ENTRY_EDIT_MEDIA_STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
        });
    }

    async function idbMediaPut(key, imagesPayload) {
        const db = await openEntryEditMediaDb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(ENTRY_EDIT_MEDIA_STORE, 'readwrite');
            tx.objectStore(ENTRY_EDIT_MEDIA_STORE).put({ key, images: imagesPayload });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('idb put'));
        });
        db.close();
    }

    async function idbMediaGet(key) {
        const db = await openEntryEditMediaDb();
        const row = await new Promise((resolve, reject) => {
            const tx = db.transaction(ENTRY_EDIT_MEDIA_STORE, 'readonly');
            const r = tx.objectStore(ENTRY_EDIT_MEDIA_STORE).get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
        db.close();
        return row;
    }

    async function idbMediaDelete(key) {
        try {
            const db = await openEntryEditMediaDb();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(ENTRY_EDIT_MEDIA_STORE, 'readwrite');
                tx.objectStore(ENTRY_EDIT_MEDIA_STORE).delete(key);
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
            db.close();
        } catch (_) {}
    }

    function makeImageItem({ url = '', dataUrl = '', name = '' } = {}) {
        entryImageItemSeq += 1;
        return {
            id: `${Date.now()}_${entryImageItemSeq}_${Math.random().toString(36).slice(2, 10)}`,
            url: String(url || '').trim(),
            dataUrl: String(dataUrl || '').trim(),
            name: String(name || ''),
            progress: String(url || '').trim() ? 100 : 0,
            uploadLoaded: 0,
            uploadTotal: 0,
        };
    }

    function imageItemsFromUrls(urls) {
        return (Array.isArray(urls) ? urls : [])
            .map((u) => {
                const s = normalizeDiariMediaUrl(u);
                if (!s) return null;
                if (s.startsWith('data:')) return makeImageItem({ dataUrl: s });
                return makeImageItem({ url: s });
            })
            .filter(Boolean);
    }

    function reviveImageItems(arr) {
        return (Array.isArray(arr) ? arr : [])
            .map((raw) => {
                if (raw && typeof raw === 'object') {
                    const url = normalizeDiariMediaUrl(raw.url || '').trim();
                    const dataUrl = String(raw.dataUrl || '').trim();
                    if (!url && !dataUrl) return null;
                    const pr = Number(raw.progress);
                    return {
                        id: String(raw.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
                        url,
                        dataUrl,
                        name: String(raw.name || ''),
                        progress: Number.isFinite(pr) && pr >= 0 ? pr : url ? 100 : 0,
                    };
                }
                const s = normalizeDiariMediaUrl(raw);
                if (!s) return null;
                return s.startsWith('data:') ? makeImageItem({ dataUrl: s }) : makeImageItem({ url: s });
            })
            .filter(Boolean);
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

    function formatEntryDateLine(isoDate) {
        const d = new Date(isoDate);
        if (Number.isNaN(d.getTime())) return '';
        const weekday = d.toLocaleDateString('en-US', { weekday: 'long' });
        const rest = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${weekday}, ${rest} · ${time}`;
    }

    function isEntryEdited(ent) {
        if (isPwaOfflineContext() && ent && (ent.pwaEditPending === true || ent.pwaDeletionPending === true)) {
            return false;
        }
        if (!ent || !ent.updatedAt) return false;
        const u = new Date(ent.updatedAt).getTime();
        if (Number.isNaN(u)) return false;
        const c = ent.createdAt ? new Date(ent.createdAt).getTime() : NaN;
        if (!Number.isNaN(c)) return u > c + 1500;
        const d0 = ent.date ? new Date(ent.date).getTime() : NaN;
        if (!Number.isNaN(d0)) return u > d0 + 1500;
        return true;
    }

    function entryDateTimeIsoForDisplay(ent) {
        if (!ent) return '';
        if (isEntryEdited(ent) && ent.updatedAt) return ent.updatedAt;
        return ent.date || ent.createdAt || '';
    }

    /** Short date for delete confirmation (e.g. Wed, May 13 · 12:11 PM). */
    function formatEntryDateShort(isoDate) {
        const d = new Date(isoDate);
        if (Number.isNaN(d.getTime())) return '';
        const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
        const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${wd}, ${md} · ${time}`;
    }

    function syncEditBodyMinToAsideFromDom() {
        const editPane = document.getElementById('entryViewEditPane');
        const bodyEl = document.getElementById('entryViewBody');
        const imagesAside = document.getElementById('entryViewImagesAside');
        const columnsEl = document.getElementById('entryViewColumns');
        if (!bodyEl) return;
        if (
            !editPane ||
            editPane.hidden ||
            !imagesAside ||
            imagesAside.hidden ||
            !columnsEl?.classList.contains('entry-view-columns--split')
        ) {
            bodyEl.style.minHeight = '';
            return;
        }
        const asideH = imagesAside.offsetHeight;
        const siblings = editPane.offsetHeight - bodyEl.offsetHeight;
        const minPx = Math.max(200, asideH - siblings);
        bodyEl.style.minHeight = `${Math.round(minPx)}px`;
    }

    function autoResizeTextarea(el) {
        if (!el) return;
        syncEditBodyMinToAsideFromDom();
        el.style.height = 'auto';
        const min = parseFloat(el.style.minHeight) || 200;
        el.style.height = `${Math.max(min, el.scrollHeight)}px`;
    }

    /** Re-measure body height after the editor is visible (hidden ancestors yield wrong scrollHeight). */
    function reflowEditorLayout() {
        if (!activeController || activeController.signal.aborted) return;
        const editPane = document.getElementById('entryViewEditPane');
        if (editPane && editPane.hidden) return;
        const el = document.getElementById('entryViewBody');
        if (!el) return;
        autoResizeTextarea(el);
    }

    let activeController = null;
    /** Set while mount() is active; entries inline panel calls after removing `hidden` so imgs decode. */
    let refreshEntryImageStrip = null;

    /**
     * Stored URLs may be absolute (old deploy host). Uploads always live on this origin under /uploads/.
     */
    function normalizeDiariMediaUrl(raw) {
        let s0 = String(raw || '').trim();
        while (
            s0.length >= 2 &&
            ((s0.startsWith('"') && s0.endsWith('"')) || (s0.startsWith("'") && s0.endsWith("'")))
        ) {
            s0 = s0.slice(1, -1).trim();
        }
        if (!s0 || s0.startsWith('data:') || s0.startsWith('blob:')) return s0;

        function rewriteFilesystemUploadPath(pathname) {
            const p = pathname || '';
            if (p.startsWith('/static/img/uploads/')) return `/uploads/${p.slice('/static/img/uploads/'.length)}`;
            if (p.startsWith('/img/uploads/')) return `/uploads/${p.slice('/img/uploads/'.length)}`;
            return pathname;
        }

        let s = s0;
        if (s.startsWith('/')) {
            const pathEnd = Math.min(
                ...[s.indexOf('?'), s.indexOf('#')].map((i) => (i < 0 ? s.length : i))
            );
            const pathOnly = s.slice(0, pathEnd);
            const rest = s.slice(pathEnd);
            const rw = rewriteFilesystemUploadPath(pathOnly);
            if (rw !== pathOnly) s = rw + rest;
            return s;
        }
        if (s.startsWith('//')) {
            try {
                const abs = new URL(`${window.location.protocol}${s}`);
                const path = rewriteFilesystemUploadPath(abs.pathname);
                if (path.startsWith('/uploads/')) {
                    return `${path}${abs.search}${abs.hash}`;
                }
                if (abs.pathname.startsWith('/uploads/')) {
                    return `${abs.pathname}${abs.search}${abs.hash}`;
                }
                return abs.href;
            } catch {
                return s;
            }
        }
        try {
            const abs = new URL(s);
            const path = rewriteFilesystemUploadPath(abs.pathname);
            if (path.startsWith('/uploads/')) {
                return `${path}${abs.search}${abs.hash}`;
            }
            if (abs.pathname.startsWith('/uploads/')) {
                return `${abs.pathname}${abs.search}${abs.hash}`;
            }
            return abs.href;
        } catch {
            try {
                const rel = new URL(s, window.location.origin);
                const path = rewriteFilesystemUploadPath(rel.pathname);
                if (path.startsWith('/uploads/')) {
                    return `${path}${rel.search}${rel.hash}`;
                }
                if (rel.pathname.startsWith('/uploads/')) {
                    return `${rel.pathname}${rel.search}${rel.hash}`;
                }
                return rel.href;
            } catch {
                return s;
            }
        }
    }

    /** Absolute URL for same-origin uploads — avoids stalled loads when subtree had zero layout width. */
    function resolveDisplayImgSrc(raw) {
        const s = normalizeDiariMediaUrl(String(raw || '').trim());
        if (!s || s.startsWith('data:') || s.startsWith('blob:')) return s;
        if (s.startsWith('/')) return `${window.location.origin}${s}`;
        return s;
    }

    /** Candidate URLs for resilient image loading (tries normalized + raw variants). */
    function buildImageSrcCandidates(raw) {
        const out = [];
        const add = (v) => {
            const s = String(v || '').trim();
            if (!s) return;
            if (!out.includes(s)) out.push(s);
        };

        const cleanedRaw = String(raw || '').trim();
        if (!cleanedRaw) return out;
        add(resolveDisplayImgSrc(cleanedRaw));
        add(normalizeDiariMediaUrl(cleanedRaw));
        add(cleanedRaw);

        // If stored URL is absolute from old host, also try its pathname directly.
        try {
            const abs = new URL(cleanedRaw, window.location.origin);
            add(resolveDisplayImgSrc(`${abs.pathname}${abs.search}${abs.hash}`));
        } catch (_) {}

        return out.filter(Boolean);
    }

    function resetEntryDetailLoadingState() {
        const titleEl = document.getElementById('entryViewTitle');
        const bodyEl = document.getElementById('entryViewBody');
        const dateLine = document.getElementById('entryViewDateLine');
        const dateLineRead = document.getElementById('entryViewDateLineRead');
        const tagsRow = document.getElementById('entryViewTagsRow');
        const tagsRead = document.getElementById('entryViewTagsRead');
        const titleRead = document.getElementById('entryViewTitleRead');
        const bodyRead = document.getElementById('entryViewBodyRead');
        const readPane = document.getElementById('entryViewReadPane');
        const editPane = document.getElementById('entryViewEditPane');
        const readToolbar = document.getElementById('entryViewReadToolbar');
        const cancelBtn = document.getElementById('entryViewCancelBtn');
        const actionsEl = document.getElementById('entryViewActions');
        const saveAnalyzeBtn = document.getElementById('entryViewSaveAnalyzeBtn');
        const loadingHtml =
            '<span class="entry-view-loading-line" style="color:var(--text-muted);font-size:0.8rem;">Loading entry…</span>';
        if (titleEl) titleEl.value = '';
        if (bodyEl) {
            bodyEl.value = '';
            bodyEl.style.height = 'auto';
        }
        if (tagsRow) tagsRow.innerHTML = '';
        if (tagsRead) tagsRead.innerHTML = '';
        if (titleRead) {
            titleRead.textContent = '';
            titleRead.classList.remove('entry-view-title-read--muted');
        }
        if (bodyRead) bodyRead.textContent = '';
        if (dateLine) dateLine.innerHTML = loadingHtml;
        if (dateLineRead) dateLineRead.innerHTML = loadingHtml;
        if (readPane) readPane.hidden = false;
        if (editPane) editPane.hidden = true;
        if (readToolbar) readToolbar.hidden = false;
        if (cancelBtn) cancelBtn.hidden = true;
        if (actionsEl) actionsEl.hidden = true;
        if (saveAnalyzeBtn) saveAnalyzeBtn.disabled = true;
        const delDlg = document.getElementById('entryDeleteDialog');
        if (delDlg) delDlg.hidden = true;
        const rmPhotoDlg = document.getElementById('entryRemovePhotoModal');
        if (rmPhotoDlg) rmPhotoDlg.hidden = true;
        const aside = document.getElementById('entryViewImagesAside');
        const cols = document.getElementById('entryViewColumns');
        const stripScroll = document.getElementById('entryViewImageStripScroll');
        const stripBadge = document.getElementById('entryViewImageStripBadge');
        const stripFade = document.getElementById('entryViewImageStripFade');
        const stripAdd = document.getElementById('entryViewImageStripAddBtn');
        if (aside) aside.hidden = true;
        if (cols) cols.classList.remove('entry-view-columns--split');
        if (stripScroll) stripScroll.innerHTML = '';
        if (stripBadge) {
            stripBadge.hidden = true;
            stripBadge.textContent = '';
        }
        if (stripFade) stripFade.hidden = true;
        if (stripAdd) stripAdd.hidden = true;
        const lb = document.getElementById('photoLightbox');
        if (lb) lb.hidden = true;
        document.body.style.overflow = '';
    }

    function unmount() {
        refreshEntryImageStrip = null;
        if (activeController) {
            activeController.abort();
            activeController = null;
        }
        resetEntryDetailLoadingState();
    }

    /**
     * @param {{
     *   entryId: number,
     *   onLeavePanel: () => void,
     *   userId?: number,
     *   afterMetadataSaveToEntries?: () => void,
     *   afterEntryDeletedToEntries?: (detail?: { offline?: boolean }) => void,
     * }} opts
     */
    async function mount(opts) {
        unmount();
        const ac = new AbortController();
        activeController = ac;
        const signal = ac.signal;

        const entryKey = String(opts.entryId ?? '').trim();
        const numericEntryId = /^\d+$/.test(entryKey) ? Number(entryKey) : 0;
        const userId = opts.userId != null ? Number(opts.userId) : getUserId();
        const onLeavePanel = typeof opts.onLeavePanel === 'function' ? opts.onLeavePanel : () => {};
        const afterMetadataSaveToEntries =
            typeof opts.afterMetadataSaveToEntries === 'function' ? opts.afterMetadataSaveToEntries : null;
        const afterEntryDeletedToEntries =
            typeof opts.afterEntryDeletedToEntries === 'function' ? opts.afterEntryDeletedToEntries : null;

        const titleEl = document.getElementById('entryViewTitle');
        const bodyEl = document.getElementById('entryViewBody');
        const dateLine = document.getElementById('entryViewDateLine');
        const dateLineRead = document.getElementById('entryViewDateLineRead');
        const tagsRow = document.getElementById('entryViewTagsRow');
        const readPane = document.getElementById('entryViewReadPane');
        const editPane = document.getElementById('entryViewEditPane');
        const tagsRead = document.getElementById('entryViewTagsRead');
        const titleRead = document.getElementById('entryViewTitleRead');
        const bodyRead = document.getElementById('entryViewBodyRead');
        const readToolbar = document.getElementById('entryViewReadToolbar');
        const editBtn = document.getElementById('entryViewEditBtn');
        const deleteBtn = document.getElementById('entryViewDeleteBtn');
        const viewDetailsBtn = document.getElementById('entryViewViewDetailsBtn');
        const aiEmotionLabel = document.getElementById('entryViewAiEmotionLabel');
        const editedPill = document.getElementById('entryViewEditedPill');
        const actionsEl = document.getElementById('entryViewActions');
        const backBtn = document.getElementById('entryViewBackBtn');
        const cancelBtn = document.getElementById('entryViewCancelBtn');
        const saveAnalyzeBtn = document.getElementById('entryViewSaveAnalyzeBtn');
        const unsavedDialog = document.getElementById('entryUnsavedDialog');
        const unsavedStay = document.getElementById('entryUnsavedStayBtn');
        const unsavedDiscard = document.getElementById('entryUnsavedDiscardBtn');
        const deleteDialog = document.getElementById('entryDeleteDialog');
        const deletePreviewTitleEl = document.getElementById('entryDeletePreviewTitle');
        const deletePreviewSnippetEl = document.getElementById('entryDeletePreviewSnippet');
        const deletePreviewDateEl = document.getElementById('entryDeletePreviewDate');
        const deletePreviewMoodLabelEl = document.getElementById('entryDeletePreviewMoodLabel');
        const deleteCancelBtn = document.getElementById('entryDeleteCancelBtn');
        const deleteConfirmBtn = document.getElementById('entryDeleteConfirmBtn');
        const columnsEl = document.getElementById('entryViewColumns');
        const imagesAside = document.getElementById('entryViewImagesAside');
        const imageStripScroll = document.getElementById('entryViewImageStripScroll');
        const imageStripViewport =
            (imagesAside && imagesAside.querySelector('.entry-view-image-strip__viewport')) ||
            document.querySelector('.entry-view-image-strip__viewport');
        const imageStripBadge = document.getElementById('entryViewImageStripBadge');
        const imageStripFade = document.getElementById('entryViewImageStripFade');
        const imageStripAddBtn = document.getElementById('entryViewImageStripAddBtn');
        const imageFileInput = document.getElementById('entryViewImageFileInput');

        function setBothDateLines(dateText) {
            const safe = escapeHtml(dateText);
            const markup = `<i class="bi bi-calendar3" aria-hidden="true"></i><span>${safe}</span>`;
            if (dateLine) dateLine.innerHTML = markup;
            if (dateLineRead) dateLineRead.innerHTML = markup;
        }

        function toTitleCaseEmotion(raw) {
            const s = String(raw || 'neutral').trim().toLowerCase();
            if (!s) return 'Neutral';
            return s.replace(/\b\w/g, (c) => c.toUpperCase());
        }

        function escapeHtml(text) {
            return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
        }

        let editMode = false;

        if (
            !entryKey ||
            !titleEl ||
            !bodyEl ||
            !tagsRow ||
            !backBtn ||
            !cancelBtn ||
            !readPane ||
            !editPane ||
            !tagsRead ||
            !titleRead ||
            !bodyRead ||
            !dateLineRead ||
            !readToolbar ||
            !editBtn ||
            !deleteBtn ||
            !viewDetailsBtn ||
            !aiEmotionLabel ||
            !deleteDialog ||
            !deletePreviewTitleEl ||
            !deletePreviewSnippetEl ||
            !deletePreviewDateEl ||
            !deletePreviewMoodLabelEl ||
            !deleteCancelBtn ||
            !deleteConfirmBtn
        ) {
            onLeavePanel();
            unmount();
            return false;
        }

        const listEntry = loadEntryFromList(entryKey);
        let entry = listEntry;

        if (!entry && isOnline() && numericEntryId > 0) {
            const loadingTags =
                '<span class="entry-view-tags-await" style="color:var(--text-muted);font-size:0.85rem;">Loading…</span>';
            tagsRead.innerHTML = loadingTags;
            try {
                const res = await fetch(`/api/entries/${numericEntryId}?userId=${encodeURIComponent(String(userId))}`);
                const data = await res.json();
                if (signal.aborted) return false;
                if (res.ok && data.success && data.entry) {
                    entry = data.entry;
                    replaceEntryInList(entry);
                }
            } catch (_) {}
        }

        if (signal.aborted) return false;

        if (!entry) {
            onLeavePanel();
            unmount();
            return false;
        }

        let tags = new Set((Array.isArray(entry.tags) ? entry.tags : []).map(normalizeTag).filter(Boolean));
        let editorImages = imageItemsFromUrls(entry.imageUrls || []);
        let allTagChoices = [];
        let tagPickerOpen = false;
        let pendingNavigate = null;
        let deleteRequestPending = false;
        let lightboxIndex = 0;
        let stripDragDepth = 0;
        let baseline = '';

        let pendingRemoveEntryPhotoId = null;
        const entryRemovePhotoModalEl = document.getElementById('entryRemovePhotoModal');
        const entryRemovePhotoCancelBtn = document.getElementById('entryRemovePhotoCancelBtn');
        const entryRemovePhotoConfirmBtn = document.getElementById('entryRemovePhotoConfirmBtn');
        const entryRemovePhotoPreviewTitle = document.getElementById('entryRemovePhotoPreviewTitle');
        const entryRemovePhotoPreviewMeta = document.getElementById('entryRemovePhotoPreviewMeta');

        function closeEntryRemovePhotoModal() {
            pendingRemoveEntryPhotoId = null;
            if (entryRemovePhotoModalEl) entryRemovePhotoModalEl.hidden = true;
        }

        function openEntryRemovePhotoModal(imageId) {
            const titleRaw = String(titleEl?.value || '').trim();
            const bodyRaw = String(bodyEl?.value || '').trim();
            const fallbackTitle = bodyRaw ? bodyRaw.split('\n')[0].trim() : '';
            const previewTitle = (titleRaw || fallbackTitle || 'Untitled entry').slice(0, 100);
            const dateText = formatEntryDateLine(entryDateTimeIsoForDisplay(entry));
            const tagsLabel = [...tags].slice(0, 2).join(', ');
            const previewMeta = [dateText, tagsLabel].filter(Boolean).join(' · ') || 'No date';
            if (entryRemovePhotoPreviewTitle) entryRemovePhotoPreviewTitle.textContent = previewTitle;
            if (entryRemovePhotoPreviewMeta) entryRemovePhotoPreviewMeta.textContent = previewMeta;
            pendingRemoveEntryPhotoId = imageId;
            if (entryRemovePhotoModalEl) entryRemovePhotoModalEl.hidden = false;
        }

        function imagesPayloadStrings() {
            return editorImages.map((im) => String(im.url || im.dataUrl || '').trim()).filter(Boolean);
        }

        function serializeState() {
            const title = (titleEl?.value || '').trim();
            const text = (bodyEl?.value || '').trim();
            const t = [...tags].map(normalizeTag).filter(Boolean).sort((a, b) => a.localeCompare(b));
            const images = imagesPayloadStrings();
            return JSON.stringify({ title, text, tags: t, images });
        }

        function readModeStripUrls() {
            try {
                const p = JSON.parse(baseline);
                return (Array.isArray(p.images) ? p.images : []).map((x) => String(x || '').trim()).filter(Boolean);
            } catch (_) {
                return [];
            }
        }

        function showImageAside() {
            if (editMode) return true;
            return readModeStripUrls().length > 0;
        }

        function updateColumnsLayout() {
            if (!columnsEl || !imagesAside) return;
            const show = showImageAside();
            imagesAside.hidden = !show;
            columnsEl.classList.toggle('entry-view-columns--split', show);
        }

        function stripDisplayItems() {
            if (editMode) return editorImages;
            const fromBaseline = imageItemsFromUrls(readModeStripUrls());
            if (fromBaseline.length) return fromBaseline;
            return editorImages;
        }

        function updateStripFade() {
            if (!imageStripFade || !imageStripScroll) return;
            const el = imageStripScroll;
            const more = el.scrollHeight > el.clientHeight + 4;
            imageStripFade.hidden = !more || editMode;
        }

        function syncEntryStripViewportPx() {
            if (!imageStripViewport || !imageStripScroll) return;
            const items = stripDisplayItems();
            const n = items.length;

            const cs = getComputedStyle(imageStripViewport);
            const padL = parseFloat(cs.paddingLeft) || 0;
            const padR = parseFloat(cs.paddingRight) || 0;
            const innerW = Math.max(0, imageStripViewport.clientWidth - padL - padR);
            const grid = imageStripScroll.querySelector('.entry-view-strip-grid');
            let gapPx = 5.76;
            if (grid) {
                const gcs = getComputedStyle(grid);
                gapPx = parseFloat(gcs.columnGap) || parseFloat(gcs.gap) || gapPx;
            }
            const cell = Math.max(0, (innerW - gapPx) / 2);
            /** Avoid --gallery-viewport-px: 0 when the shell is display:none (inline entries mount); use CSS fallback. */
            const layoutUsable = innerW >= 32;

            if (!n) {
                if (editMode && layoutUsable && cell >= 40) {
                    const h = cell;
                    imageStripViewport.style.setProperty('--gallery-viewport-px', `${Math.round(h * 100) / 100}px`);
                } else {
                    imageStripViewport.style.removeProperty('--gallery-viewport-px');
                }
                imageStripScroll.classList.remove('entry-view-image-strip--overflow');
                return;
            }

            const rows = 3;
            const h = rows * cell + (rows - 1) * gapPx;
            if (layoutUsable && h >= 96) {
                imageStripViewport.style.setProperty('--gallery-viewport-px', `${Math.round(h * 100) / 100}px`);
            } else {
                imageStripViewport.style.removeProperty('--gallery-viewport-px');
            }
            imageStripScroll.classList.toggle('entry-view-image-strip--overflow', n > 6);
        }

        let stripResizeObserver = null;
        if (typeof ResizeObserver !== 'undefined' && imageStripViewport) {
            stripResizeObserver = new ResizeObserver(() => {
                if (signal.aborted) return;
                syncEntryStripViewportPx();
                updateStripFade();
            });
            stripResizeObserver.observe(imageStripViewport);
            signal.addEventListener(
                'abort',
                () => {
                    try {
                        stripResizeObserver?.disconnect();
                    } catch (_) {}
                    stripResizeObserver = null;
                },
                { once: true }
            );
        }

        function serializeImagesForStorage() {
            return editorImages.map((im) => ({
                id: im.id,
                url: im.url,
                dataUrl: im.dataUrl,
                name: im.name,
                progress: im.progress,
            }));
        }

        async function persistDraftImages() {
            try {
                if (editorImages.some((im) => im.dataUrl)) {
                    await idbMediaPut(draftImagesKey(entryKey), serializeImagesForStorage());
                } else {
                    await idbMediaDelete(draftImagesKey(entryKey));
                }
            } catch (_) {}
        }

        function renderImageStrip(options = {}) {
            if (!imageStripScroll) return;
            const preserveScroll = Boolean(options.preserveScroll && isEntryEditMobileLayout());
            const skipBodyResize = Boolean(options.skipBodyResize && isEntryEditMobileLayout());
            const scrollSnapshot = preserveScroll ? captureEntryEditScroll() : null;
            const items = stripDisplayItems();
            const n = items.length;
            if (imageStripBadge) {
                if (n > 0) {
                    imageStripBadge.hidden = false;
                    imageStripBadge.textContent = `${n} photo${n === 1 ? '' : 's'}`;
                } else {
                    imageStripBadge.hidden = true;
                    imageStripBadge.textContent = '';
                }
            }
            if (imageStripAddBtn) {
                imageStripAddBtn.hidden = !editMode || n >= MAX_ENTRY_IMAGES;
            }
            imageStripScroll.innerHTML = '';
            const grid = document.createElement('div');
            grid.className = 'entry-view-strip-grid';

            if (editMode && n === 0) {
                const empty = document.createElement('button');
                empty.type = 'button';
                empty.className = 'entry-view-strip-empty';
                empty.innerHTML = '<i class="bi bi-image" aria-hidden="true"></i><span>Add photos to this entry</span>';
                empty.addEventListener('click', () => imageFileInput?.click(), { signal });
                grid.appendChild(empty);
            } else {
                items.forEach((im, idx) => {
                    const wrap = document.createElement('div');
                    wrap.className = `entry-view-strip-item${editMode ? '' : ' entry-view-strip-item--readonly'}`;
                    wrap.dataset.imageId = im.id;
                    const srcRaw = im.url || im.dataUrl;
                    const srcCandidates = buildImageSrcCandidates(String(srcRaw || '').trim());
                    const hasSrc = srcCandidates.length > 0;

                    const imgWrap = document.createElement('div');
                    imgWrap.className = hasSrc
                        ? 'entry-view-strip-imgwrap entry-view-strip-imgwrap--loading'
                        : 'entry-view-strip-imgwrap entry-view-strip-imgwrap--pending';
                    const skeleton = document.createElement('div');
                    skeleton.className = 'entry-img-skeleton';
                    skeleton.setAttribute('aria-hidden', 'true');
                    imgWrap.appendChild(skeleton);

                    if (hasSrc) {
                        const img = document.createElement('img');
                        img.alt = '';
                        img.decoding = 'async';
                        img.loading = 'eager';
                        let settled = false;
                        const markLoaded = () => {
                            if (settled) return;
                            settled = true;
                            imgWrap.classList.remove('entry-view-strip-imgwrap--loading', 'entry-view-strip-imgwrap--pending');
                            imgWrap.classList.add('entry-view-strip-imgwrap--loaded');
                            img.alt = 'Entry photo';
                        };
                        const markError = () => {
                            if (settled) return;
                            settled = true;
                            imgWrap.classList.remove('entry-view-strip-imgwrap--loading', 'entry-view-strip-imgwrap--pending');
                            imgWrap.classList.add('entry-view-strip-imgwrap--error');
                        };
                        let srcIdx = 0;
                        let settleTimer = null;
                        const clearSettleTimer = () => {
                            if (settleTimer) {
                                clearTimeout(settleTimer);
                                settleTimer = null;
                            }
                        };
                        const beginSrcTimeout = () => {
                            clearSettleTimer();
                            settleTimer = window.setTimeout(() => {
                                tryNextSrc();
                            }, 7000);
                        };
                        const tryNextSrc = () => {
                            if (settled) return;
                            clearSettleTimer();
                            if (srcIdx >= srcCandidates.length) {
                                markError();
                                return;
                            }
                            const nextSrc = srcCandidates[srcIdx++];
                            img.src = nextSrc;
                            beginSrcTimeout();
                        };
                        img.addEventListener('load', () => {
                            clearSettleTimer();
                            markLoaded();
                        });
                        img.addEventListener('error', () => {
                            tryNextSrc();
                        });
                        imgWrap.appendChild(img);
                        const trySync = () => {
                            if (settled) return;
                            if (img.complete && img.naturalHeight > 0) markLoaded();
                        };
                        tryNextSrc();
                        trySync();
                        requestAnimationFrame(trySync);
                        window.setTimeout(trySync, 80);
                        window.setTimeout(trySync, 400);
                    }

                    wrap.appendChild(imgWrap);
                    const uploading = isImageStillUploading(im);
                    if (uploading) {
                        const bar = document.createElement('div');
                        bar.className = 'entry-img-progress';
                        bar.innerHTML = `<span style="width:${Math.max(8, im.progress)}%"></span>`;
                        wrap.appendChild(bar);
                        wrap.appendChild(createEntryImgSpinner(uploadBytesLabel(im)));
                    }

                    const overlay = document.createElement('div');
                    overlay.className = 'entry-view-strip-item-overlay';
                    overlay.setAttribute('aria-hidden', 'true');
                    wrap.appendChild(overlay);

                    const actions = document.createElement('div');
                    actions.className = 'entry-view-strip-item__actions';

                    const exp = document.createElement('button');
                    exp.type = 'button';
                    exp.className = 'entry-view-strip-item__expand';
                    exp.setAttribute('aria-label', 'Expand image');
                    exp.innerHTML = '<i class="bi bi-search" aria-hidden="true"></i>';
                    exp.addEventListener(
                        'click',
                        (e) => {
                            e.stopPropagation();
                            openLightbox(idx);
                        },
                        { signal }
                    );
                    actions.appendChild(exp);

                    if (editMode) {
                        const del = document.createElement('button');
                        del.type = 'button';
                        del.className = 'entry-view-strip-item__del';
                        del.setAttribute('aria-label', 'Remove photo');
                        del.innerHTML = '<i class="bi bi-trash3" aria-hidden="true"></i>';
                        del.addEventListener(
                            'click',
                            (e) => {
                                e.stopPropagation();
                                openEntryRemovePhotoModal(im.id);
                            },
                            { signal }
                        );
                        actions.appendChild(del);
                    }
                    wrap.appendChild(actions);

                    wrap.addEventListener(
                        'click',
                        (e) => {
                            if (e.target.closest('.entry-view-strip-item__actions')) return;
                            const was = wrap.classList.contains('is-active');
                            imageStripScroll.querySelectorAll('.entry-view-strip-item.is-active').forEach((el) => el.classList.remove('is-active'));
                            if (!was) wrap.classList.add('is-active');
                        },
                        { signal }
                    );

                    grid.appendChild(wrap);
                });
            }
            imageStripScroll.appendChild(grid);
            updateColumnsLayout();
            requestAnimationFrame(() => {
                syncEntryStripViewportPx();
                updateStripFade();
                if (!skipBodyResize) autoResizeTextarea(bodyEl);
                if (preserveScroll) restoreEntryEditScroll(scrollSnapshot);
            });
            if (preserveScroll) {
                requestAnimationFrame(() => restoreEntryEditScroll(scrollSnapshot));
            }
        }

        function patchEntryImageUploadDom(localId) {
            const im = editorImages.find((img) => img.id === localId);
            const wrap = imageStripScroll?.querySelector(`[data-image-id="${localId}"]`);
            if (!im || !wrap) return false;
            const bar = wrap.querySelector('.entry-img-progress span');
            if (bar) bar.style.width = `${Math.max(8, im.progress)}%`;
            const uploading = isImageStillUploading(im);
            let spinner = wrap.querySelector('.entry-img-spinner');
            const label = uploadBytesLabel(im);
            if (uploading) {
                if (!spinner) {
                    wrap.appendChild(createEntryImgSpinner(label));
                } else if (typeof IU.setSpinnerBytes === 'function') {
                    IU.setSpinnerBytes(spinner, label);
                }
            } else if (spinner) {
                spinner.remove();
            }
            return true;
        }

        function setEditorImageUploadState(localId, patch) {
            editorImages = editorImages.map((img) =>
                img.id === localId ? { ...img, ...patch } : img
            );
            if (!patchEntryImageUploadDom(localId)) {
                renderImageStrip({ preserveScroll: true, skipBodyResize: true });
            }
        }

        async function uploadImageOnlineLocal(file, localId) {
            if (!userId) {
                throw new Error('Please log in again to upload photos.');
            }
            return scheduleEntryImageUpload(async () => {
                const prepared = typeof IU.prepareUploadFile === 'function'
                    ? await IU.prepareUploadFile(file)
                    : file;
                const total = prepared.size || file.size || 0;
                setEditorImageUploadState(localId, { uploadTotal: total, uploadLoaded: 0, progress: 2 });

                const onProgress = (loaded, uploadTotal) => {
                    const progress = typeof IU.progressFromBytes === 'function'
                        ? IU.progressFromBytes(loaded, uploadTotal)
                        : Math.min(99, Math.round((loaded / Math.max(1, uploadTotal)) * 100));
                    setEditorImageUploadState(localId, {
                        uploadLoaded: loaded,
                        uploadTotal,
                        progress,
                    });
                };

                if (typeof IU.uploadWithRetries === 'function') {
                    const url = await IU.uploadWithRetries(prepared, userId, onProgress, 3);
                    setEditorImageUploadState(localId, {
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
                setEditorImageUploadState(localId, {
                    progress: 100,
                    uploadLoaded: total,
                    uploadTotal: total,
                });
                return String(json.url);
            });
        }

        async function addImagesFromFiles(fileList) {
            const { files, skipped } = await filterImageUploadFiles(fileList);
            if (skipped.length) {
                window.alert(
                    'Some files were skipped. Use a common photo format (JPEG, PNG, WebP, GIF, HEIC, BMP, TIFF, or AVIF).'
                );
            }
            if (!files.length) return;
            const uploadFiles = Array.from(files);
            if (editorImages.length + uploadFiles.length > MAX_ENTRY_IMAGES) {
                window.alert(`Each entry allows at most ${MAX_ENTRY_IMAGES} images.`);
                return;
            }
            if (editorImages.length + uploadFiles.length === MAX_ENTRY_IMAGES && uploadFiles.length > 0) {
                window.alert('This entry will have 10 photos (the maximum per entry).');
            }

            const batch = [];
            for (const file of uploadFiles) {
                if (editorImages.length >= MAX_ENTRY_IMAGES) break;
                const item = makeImageItem({ name: file.name });
                item.progress = 5;
                item.uploadTotal = file.size || 0;
                item.uploadLoaded = 0;
                editorImages.push(item);
                batch.push({ file, item });
            }
            renderImageStrip({ preserveScroll: true, skipBodyResize: true });

            await Promise.all(
                batch.map(async ({ file, item }) => {
                    try {
                        const previewUrl = await fileToDataUrl(file);
                        setEditorImageUploadState(item.id, { dataUrl: previewUrl, progress: 10 });
                    } catch (_) { /* preview optional */ }
                })
            );
            renderImageStrip({ preserveScroll: true, skipBodyResize: true });

            const actOffline = await shouldActOffline();
            let uploadFailures = 0;
            await Promise.all(
                batch.map(async ({ file, item }) => {
                    try {
                        if (!actOffline && isOnline() && userId) {
                            const url = await uploadImageOnlineLocal(file, item.id);
                            setEditorImageUploadState(item.id, {
                                url,
                                dataUrl: '',
                                progress: 100,
                                uploadLoaded: item.uploadTotal || file.size || 0,
                            });
                        } else {
                            setEditorImageUploadState(item.id, { progress: 25 });
                            const dataUrl = await fileToDataUrl(file);
                            setEditorImageUploadState(item.id, { dataUrl, progress: 100 });
                        }
                    } catch (e) {
                        console.error(e);
                        editorImages = editorImages.filter((img) => img.id !== item.id);
                        uploadFailures += 1;
                    }
                })
            );
            renderImageStrip({ preserveScroll: true, skipBodyResize: true });
            if (actOffline || !isOnline()) {
                void persistDraftImages();
                persistDraft();
            }
            if (uploadFailures) {
                window.alert(
                    uploadFailures === 1
                        ? 'One photo could not be uploaded. Try again one at a time, or use a smaller image file.'
                        : `${uploadFailures} photos could not be uploaded. Try adding them one at a time, or use smaller image files.`
                );
            }
            if (imageFileInput) imageFileInput.value = '';
        }

        function openLightbox(index) {
            const list = stripDisplayItems();
            if (!list.length) return;
            lightboxIndex = Math.max(0, Math.min(index, list.length - 1));
            const modal = document.getElementById('photoLightbox');
            const imgEl = document.getElementById('photoLightboxImage');
            if (!modal || !imgEl) return;
            const cur = list[lightboxIndex];
            imgEl.src = resolveDisplayImgSrc(String(cur.url || cur.dataUrl || '').trim());
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
            const list = stripDisplayItems();
            if (!list.length) return;
            const next = (lightboxIndex + step + list.length) % list.length;
            openLightbox(next);
        }

        function wireLightboxOnce() {
            const modal = document.getElementById('photoLightbox');
            const closeBtn = document.getElementById('photoLightboxClose');
            const prevBtn = document.getElementById('photoLightboxPrev');
            const nextBtn = document.getElementById('photoLightboxNext');
            if (modal) {
                modal.addEventListener(
                    'click',
                    (e) => {
                        if (e.target === modal) closeLightbox();
                    },
                    { signal }
                );
            }
            closeBtn?.addEventListener('click', () => closeLightbox(), { signal });
            prevBtn?.addEventListener('click', () => moveLightbox(-1), { signal });
            nextBtn?.addEventListener('click', () => moveLightbox(1), { signal });
            document.addEventListener(
                'keydown',
                (e) => {
                    if (e.key !== 'Escape') return;
                    const m = document.getElementById('photoLightbox');
                    if (m && !m.hidden) closeLightbox();
                },
                { signal }
            );
        }

        wireLightboxOnce();

        if (imageStripAddBtn) {
            imageStripAddBtn.addEventListener('click', () => imageFileInput?.click(), { signal });
        }
        imageFileInput?.addEventListener(
            'change',
            () => {
                const picked = imageFileInput.files ? Array.from(imageFileInput.files) : [];
                imageFileInput.value = '';
                void addImagesFromFiles(picked);
            },
            { signal }
        );

        if (imageStripScroll) {
            imageStripScroll.addEventListener('scroll', () => updateStripFade(), { signal });
            imageStripScroll.addEventListener(
                'dragenter',
                (e) => {
                    if (!editMode) return;
                    e.preventDefault();
                    stripDragDepth += 1;
                    imageStripScroll.classList.add('entry-view-image-strip__scroll--drag');
                },
                { signal }
            );
            imageStripScroll.addEventListener(
                'dragleave',
                () => {
                    if (!editMode) return;
                    stripDragDepth = Math.max(0, stripDragDepth - 1);
                    if (stripDragDepth === 0) imageStripScroll.classList.remove('entry-view-image-strip__scroll--drag');
                },
                { signal }
            );
            imageStripScroll.addEventListener(
                'dragover',
                (e) => {
                    if (!editMode) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                },
                { signal }
            );
            imageStripScroll.addEventListener(
                'drop',
                (e) => {
                    if (!editMode) return;
                    e.preventDefault();
                    stripDragDepth = 0;
                    imageStripScroll.classList.remove('entry-view-image-strip__scroll--drag');
                    void addImagesFromFiles(e.dataTransfer?.files);
                },
                { signal }
            );
        }

        document.addEventListener(
            'click',
            (e) => {
                if (!imageStripScroll) return;
                const item = e.target.closest('.entry-view-strip-item');
                if (item && imageStripScroll.contains(item)) return;
                imageStripScroll.querySelectorAll('.entry-view-strip-item.is-active').forEach((x) => x.classList.remove('is-active'));
            },
            { signal }
        );

        if (columnsEl && window.ResizeObserver) {
            const ro = new ResizeObserver(() => autoResizeTextarea(bodyEl));
            ro.observe(columnsEl);
        }

        let stripVpObsLastW = -1;
        if (imageStripViewport && window.ResizeObserver) {
            const roStrip = new ResizeObserver(() => {
                const w = imageStripViewport.clientWidth;
                syncEntryStripViewportPx();
                updateStripFade();
                /* Inline entries shell starts hidden → viewport width 0; imgs stall until layout width exists. */
                if (stripVpObsLastW !== -1 && stripVpObsLastW <= 8 && w > 8) {
                    renderImageStrip();
                }
                stripVpObsLastW = w;
            });
            roStrip.observe(imageStripViewport);
            signal.addEventListener('abort', () => roStrip.disconnect(), { once: true });
        }

        function previewTitleForEntry(ent) {
            const t = (ent.title && String(ent.title).trim()) ? String(ent.title).trim() : '';
            if (t) return t.length > 140 ? `${t.slice(0, 137)}…` : t;
            const body = String(ent.text || '').trim();
            if (body) {
                const line = body.split('\n')[0].trim();
                if (line) return line.length > 140 ? `${line.slice(0, 137)}…` : line;
            }
            return 'Journal entry';
        }

        function closeDeleteDialog() {
            deleteDialog.hidden = true;
            deleteConfirmBtn.disabled = false;
        }

        function previewCardTitleForDelete(ent) {
            const t = String(ent.title || '').trim();
            if (t) return t.length > 120 ? `${t.slice(0, 117)}…` : t;
            return previewTitleForEntry(ent);
        }

        function previewSnippetForDelete(ent) {
            const body = String(ent.text || '')
                .replace(/\s+/g, ' ')
                .trim();
            if (!body) return 'No body text in this entry.';
            const max = 240;
            return body.length > max ? `${body.slice(0, max - 1)}…` : body;
        }

        function openDeleteDialog() {
            closeEntryRemovePhotoModal();
            deletePreviewTitleEl.textContent = previewCardTitleForDelete(entry);
            deletePreviewSnippetEl.textContent = previewSnippetForDelete(entry);
            const displayDate = entry.date || entry.createdAt;
            deletePreviewDateEl.textContent = formatEntryDateShort(displayDate) || '—';
            deletePreviewMoodLabelEl.textContent = toTitleCaseEmotion(entry.emotionLabel || entry.feeling || 'neutral');
            deleteDialog.hidden = false;
        }

        async function markDeletionPendingLocal() {
            const uid = userId || getUserId();
            if (typeof window.DiariOffline?.markEntryDeletionPending === 'function') {
                return window.DiariOffline.markEntryDeletionPending(entryKey, uid, entry);
            }
            const list =
                window.DiariOffline && typeof window.DiariOffline.readEntriesCache === 'function'
                    ? window.DiariOffline.readEntriesCache()
                    : JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
            const key = String(entryKey);
            const idx = list.findIndex((e) => String(e?.id ?? '') === key);
            const patch = {
                ...(idx >= 0 ? list[idx] : entry),
                id: key,
                pwaDeletionPending: true,
                pwaEditPending: false,
            };
            if (idx >= 0) list[idx] = patch;
            else list.push(patch);
            localStorage.setItem('diariCoreEntries', JSON.stringify(list));
            if (uid) localStorage.setItem('diariCoreEntriesOwnerId', String(uid));
            return true;
        }

        async function runConfirmedDelete() {
            if (signal.aborted || deleteRequestPending) return;
            if (await shouldActOffline()) {
                deleteRequestPending = true;
                deleteConfirmBtn.disabled = true;
                try {
                    const queued = await markDeletionPendingLocal();
                    if (!queued) {
                        throw new Error('Could not queue deletion');
                    }
                    closeDeleteDialog();
                    clearDraft();
                    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
                        window.DiariToast.show(
                            'Deletion pending. It will sync when you are back online.',
                            'info',
                            4000
                        );
                    }
                    if (afterEntryDeletedToEntries) {
                        onLeavePanel();
                        afterEntryDeletedToEntries();
                    } else {
                        onLeavePanel();
                    }
                } catch (e) {
                    console.error(e);
                    window.alert('Could not queue this entry for deletion.');
                } finally {
                    deleteRequestPending = false;
                    deleteConfirmBtn.disabled = false;
                }
                return;
            }
            if (!numericEntryId) {
                closeDeleteDialog();
                window.alert('This entry cannot be deleted until it syncs online.');
                return;
            }
            deleteRequestPending = true;
            deleteConfirmBtn.disabled = true;
            try {
                const res = await fetch(`/api/entries/${numericEntryId}`, {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId }),
                });
                let data = {};
                try {
                    data = await res.json();
                } catch (_) {}
                if (!res.ok || !data.success) {
                    window.alert(data.error || 'Could not delete this entry.');
                    return;
                }
                closeDeleteDialog();
                removeEntryFromList(entryKey);
                clearDraft();
                if (afterEntryDeletedToEntries) {
                    onLeavePanel();
                    afterEntryDeletedToEntries({ offline: false });
                } else {
                    try {
                        sessionStorage.setItem('diariEntriesDeletedToast', '1');
                    } catch (_) {}
                    onLeavePanel();
                }
            } catch (e) {
                console.error(e);
                window.alert('Could not delete this entry.');
            } finally {
                deleteRequestPending = false;
                deleteConfirmBtn.disabled = false;
            }
        }

        function applyDraftFromStorage() {
            try {
                const raw = localStorage.getItem(draftKey(entryKey));
                if (!raw) return;
                const d = JSON.parse(raw);
                if (!d || typeof d !== 'object') return;
                const stripBr = window.DiariSecurity && window.DiariSecurity.stripAngleBrackets
                    ? window.DiariSecurity.stripAngleBrackets.bind(window.DiariSecurity)
                    : (s) => String(s ?? '').replace(/</g, '').replace(/>/g, '');
                if (d.title != null) titleEl.value = stripBr(String(d.title));
                if (d.text != null) bodyEl.value = stripBr(String(d.text));
                if (Array.isArray(d.tags)) tags = new Set(d.tags.map(normalizeTag).filter(Boolean));
                if (Array.isArray(d.images) && d.images.length) {
                    editorImages = imageItemsFromUrls(d.images);
                }
            } catch (_) {}
        }

        const hadDraft = Boolean(localStorage.getItem(draftKey(entryKey)));

        applyDraftFromStorage();
        try {
            const row = await idbMediaGet(draftImagesKey(entryKey));
            if (hadDraft && row?.images?.length) editorImages = reviveImageItems(row.images);
        } catch (_) {}

        if (!hadDraft) {
            const strip = window.DiariSecurity && window.DiariSecurity.stripAngleBrackets
                ? window.DiariSecurity.stripAngleBrackets.bind(window.DiariSecurity)
                : (s) => String(s ?? '').replace(/</g, '').replace(/>/g, '');
            titleEl.value = strip(entry.title || '');
            bodyEl.value = strip(entry.text || '');
        }

        setBothDateLines(formatEntryDateLine(entryDateTimeIsoForDisplay(entry)));

        autoResizeTextarea(bodyEl);

        baseline = serializeState();

        function syncReadPane() {
            let p = { title: '', text: '', tags: [] };
            try {
                p = JSON.parse(baseline);
            } catch (_) {}
            setBothDateLines(formatEntryDateLine(entryDateTimeIsoForDisplay(entry)));
            if (editedPill) editedPill.hidden = !isEntryEdited(entry);
            tagsRead.innerHTML = '';
            const tagArr = Array.isArray(p.tags) ? p.tags : [];
            if (!tagArr.length) {
                const span = document.createElement('span');
                span.className = 'entry-view-tags-read-empty';
                span.textContent = 'No tags yet';
                tagsRead.appendChild(span);
            } else {
                tagArr.forEach((raw) => {
                    const tag = normalizeTag(raw);
                    if (!tag) return;
                    const pill = document.createElement('span');
                    pill.className = 'entry-view-tag-pill entry-view-tag-pill--readonly';
                    pill.textContent = tag.startsWith('#') ? tag : `#${tag}`;
                    tagsRead.appendChild(pill);
                });
            }
            const t = (p.title || '').trim();
            titleRead.textContent = t || 'Give your entry a title...';
            titleRead.classList.toggle('entry-view-title-read--muted', !t);
            bodyRead.textContent = p.text || '';
            aiEmotionLabel.textContent = toTitleCaseEmotion(entry.emotionLabel || entry.feeling || 'neutral');
            renderImageStrip();
        }

        function setEditMode(on) {
            editMode = Boolean(on);
            readPane.hidden = editMode;
            editPane.hidden = !editMode;
            readToolbar.hidden = editMode;
            cancelBtn.hidden = !editMode;
            if (actionsEl) actionsEl.hidden = !editMode;
            renderImageStrip();
            updateColumnsLayout();
        }

        refreshEntryImageStrip = () => {
            if (signal.aborted) return;
            renderImageStrip();
        };

        syncReadPane();

        function isDirty() {
            return serializeState() !== baseline;
        }

        function baselineSnapshot() {
            try {
                const p = JSON.parse(baseline);
                return p && typeof p === 'object' ? p : { title: '', text: '', tags: [], images: [] };
            } catch (_) {
                return { title: '', text: '', tags: [], images: [] };
            }
        }

        function didTextChangeFromBaseline() {
            const b = baselineSnapshot();
            const cur = String(bodyEl?.value || '').trim();
            const prev = String(b.text || '').trim();
            return cur !== prev;
        }

        function persistDraft() {
            localStorage.setItem(
                draftKey(entryKey),
                JSON.stringify({
                    title: titleEl.value,
                    text: bodyEl.value,
                    tags: Array.from(tags),
                    savedAt: new Date().toISOString(),
                    images: editorImages.some((im) => im.dataUrl) ? [] : imagesPayloadStrings(),
                })
            );
            void persistDraftImages();
        }

        function clearDraft() {
            localStorage.removeItem(draftKey(entryKey));
            void idbMediaDelete(draftImagesKey(entryKey));
        }

        async function loadTagChoices() {
            const fromApi = new Set();
            try {
                if (isOnline()) {
                    const res = await fetch(`/api/tags?userId=${encodeURIComponent(String(userId))}`);
                    const data = await res.json();
                    if (res.ok && data.success && Array.isArray(data.tags)) {
                        data.tags.forEach((t) => fromApi.add(normalizeTag(t)));
                    }
                }
            } catch (_) {}
            DEFAULT_TAG_NAMES.forEach((t) => fromApi.add(normalizeTag(t)));
            tags.forEach((t) => fromApi.add(t));
            allTagChoices = Array.from(fromApi).sort((a, b) => a.localeCompare(b));
        }

        /** Defaults + current entry tags only — no network; keeps layout stable while API loads. */
        function seedTagChoicesSync() {
            const s = new Set();
            DEFAULT_TAG_NAMES.forEach((t) => s.add(normalizeTag(t)));
            tags.forEach((t) => s.add(normalizeTag(t)));
            allTagChoices = Array.from(s).sort((a, b) => a.localeCompare(b));
        }

        seedTagChoicesSync();

        const addWrap = document.createElement('div');
        addWrap.className = 'entry-view-add-tag-wrap';
        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'tag-btn add-tag entry-view-add-tag';
        addBtn.innerHTML = '<i class="bi bi-plus-lg" aria-hidden="true"></i><span>Add tag</span>';
        const picker = document.createElement('div');
        picker.className = 'entry-view-tag-picker';
        picker.hidden = true;
        addWrap.appendChild(addBtn);
        addWrap.appendChild(picker);

        function fillPicker() {
            picker.innerHTML = '';
            const applied = new Set([...tags].map((t) => t.toLowerCase()));
            const avail = allTagChoices.filter((t) => !applied.has(t.toLowerCase()));
            if (!avail.length) {
                const empty = document.createElement('p');
                empty.style.cssText = 'margin:0.5rem;padding:0.25rem;font-size:0.85rem;color:var(--text-muted)';
                empty.textContent = 'No more tags to add.';
                picker.appendChild(empty);
                return;
            }
            avail.forEach((tag) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = tag;
                b.addEventListener(
                    'click',
                    () => {
                        tags.add(normalizeTag(tag));
                        tagPickerOpen = false;
                        picker.hidden = true;
                        renderTags();
                    },
                    { signal }
                );
                picker.appendChild(b);
            });
        }

        function renderTags() {
            tagsRow.innerHTML = '';
            tags.forEach((tag) => {
                const pill = document.createElement('span');
                pill.className = 'entry-view-tag-pill';
                pill.innerHTML = `<span>${escapeHtml(tag)}</span><button type="button" aria-label="Remove ${escapeHtml(tag)}">×</button>`;
                pill.querySelector('button').addEventListener(
                    'click',
                    () => {
                        tags.delete(tag);
                        renderTags();
                        void loadTagChoices().then(() => {
                            if (!signal.aborted) fillPicker();
                        });
                    },
                    { signal }
                );
                tagsRow.appendChild(pill);
            });
            tagsRow.appendChild(addWrap);
            fillPicker();
        }

        function restoreEditorFromBaseline() {
            try {
                const p = JSON.parse(baseline);
                titleEl.value = p.title || '';
                bodyEl.value = p.text || '';
                tags = new Set((Array.isArray(p.tags) ? p.tags : []).map(normalizeTag).filter(Boolean));
                editorImages = imageItemsFromUrls(Array.isArray(p.images) ? p.images : []);
                renderTags();
                renderImageStrip();
                autoResizeTextarea(bodyEl);
            } catch (_) {}
        }

        addBtn.addEventListener(
            'click',
            (e) => {
                e.stopPropagation();
                tagPickerOpen = !tagPickerOpen;
                picker.hidden = !tagPickerOpen;
                if (tagPickerOpen) {
                    void loadTagChoices().then(() => {
                        if (!signal.aborted) fillPicker();
                    });
                }
            },
            { signal }
        );

        document.addEventListener(
            'click',
            () => {
                if (tagPickerOpen) {
                    tagPickerOpen = false;
                    picker.hidden = true;
                }
            },
            { signal }
        );

        picker.addEventListener('click', (e) => e.stopPropagation(), { signal });

        renderTags();
        autoResizeTextarea(bodyEl);
        setEditMode(false);

        void loadTagChoices().then(() => {
            if (signal.aborted) return;
            fillPicker();
        });

        if (isOnline() && listEntry) {
            void (async () => {
                try {
                    const res = await fetch(`/api/entries/${numericEntryId}?userId=${encodeURIComponent(String(userId))}`);
                    const data = await res.json();
                    if (signal.aborted) return;
                    if (!res.ok || !data.success || !data.entry) return;
                    const incoming = data.entry;
                    replaceEntryInList(incoming);
                    if (localStorage.getItem(draftKey(entryKey))) {
                        void loadTagChoices().then(() => {
                            if (!signal.aborted) fillPicker();
                        });
                        return;
                    }
                    entry = incoming;
                    const stripBr = window.DiariSecurity && window.DiariSecurity.stripAngleBrackets
                        ? window.DiariSecurity.stripAngleBrackets.bind(window.DiariSecurity)
                        : (s) => String(s ?? '').replace(/</g, '').replace(/>/g, '');
                    titleEl.value = stripBr(entry.title || '');
                    bodyEl.value = stripBr(entry.text || '');
                    setBothDateLines(formatEntryDateLine(entryDateTimeIsoForDisplay(entry)));
                    tags = new Set((Array.isArray(entry.tags) ? entry.tags : []).map(normalizeTag).filter(Boolean));
                    editorImages = imageItemsFromUrls(entry.imageUrls || []);
                    seedTagChoicesSync();
                    renderTags();
                    autoResizeTextarea(bodyEl);
                    baseline = serializeState();
                    syncReadPane();
                    void loadTagChoices().then(() => {
                        if (!signal.aborted) fillPicker();
                    });
                } catch (_) {}
            })();
        }

        if (window.DiariSecurity && typeof window.DiariSecurity.bindAngleBracketInput === 'function') {
            window.DiariSecurity.bindAngleBracketInput(bodyEl);
            window.DiariSecurity.bindAngleBracketInput(titleEl);
        }

        bodyEl.addEventListener(
            'input',
            () => {
                autoResizeTextarea(bodyEl);
                if (!isOnline()) persistDraft();
            },
            { signal }
        );
        titleEl.addEventListener(
            'input',
            () => {
                autoResizeTextarea(bodyEl);
                if (!isOnline()) persistDraft();
            },
            { signal }
        );

        function moodOptions(overlay) {
            return {
                onSaveExit() {
                    overlay.hidden = true;
                    if (afterMetadataSaveToEntries) {
                        afterMetadataSaveToEntries();
                        return;
                    }
                    try {
                        sessionStorage.setItem('diariEntriesUpdatedToast', '1');
                    } catch (_) {}
                    onLeavePanel();
                },
                fetchRerunAnalysis: async () => {
                    const t = bodyEl.value.trim();
                    if (!t) throw new Error('empty');
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
            };
        }

        async function runToolbarViewAnalysis() {
            const text = (bodyEl.value || '').trim() || (entry.text || '').trim();
            if (!text) {
                window.alert('This entry has no text to analyze.');
                return;
            }
            global.DiariMoodAnalysis.resetSession();
            const overlay = global.DiariMoodAnalysis.ensureAnalysisOverlay();
            try {
                await global.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
            } catch (_) {}
            global.DiariMoodAnalysis.showAnalysisLoading(overlay);

            if (await shouldActOffline()) {
                try {
                    let previewEntry = { ...entry, text };
                    if (window.DiariOffline && typeof window.DiariOffline.analyzeForOffline === 'function') {
                        const est = await window.DiariOffline.analyzeForOffline(text);
                        previewEntry = { ...previewEntry, ...est, text };
                    }
                    await global.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                    const mo = moodOptions(overlay);
                    global.DiariMoodAnalysis.showAnalysisResult(overlay, previewEntry, true, {
                        ...mo,
                        offlineEstimate: true,
                        footerCloseLabel: 'Close',
                        onSaveExit() {
                            overlay.hidden = true;
                        },
                    });
                } catch (e) {
                    console.error(e);
                    overlay.hidden = true;
                    window.alert('Could not show offline analysis preview.');
                }
                return;
            }

            if (!isOnline()) {
                overlay.hidden = true;
                window.alert('Connect to the internet to run analysis.');
                return;
            }
            try {
                const res = await fetch('/api/entries/analyze-text', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, text }),
                });
                const result = await res.json();
                if (!res.ok || !result.success) throw new Error(result.error || 'Analyze failed');
                const previewEntry = {
                    ...entry,
                    emotionLabel: result.emotionLabel,
                    emotionScore: result.emotionScore,
                    sentimentLabel: result.sentimentLabel,
                    sentimentScore: result.sentimentScore,
                    all_probs: result.all_probs || {},
                    feeling: result.emotionLabel,
                };
                const fb = (result.analysisEngine || '').toString().toLowerCase() === 'fallback';
                await global.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                const mo = moodOptions(overlay);
                global.DiariMoodAnalysis.showAnalysisResult(overlay, previewEntry, fb, {
                    fetchRerunAnalysis: mo.fetchRerunAnalysis,
                    footerCloseLabel: 'Close',
                    onSaveExit() {
                        overlay.hidden = true;
                    },
                });
            } catch (e) {
                console.error(e);
                overlay.hidden = true;
                window.alert(e.message || 'Could not analyze this entry.');
            }
        }

        function openUnsaved(next) {
            if (!isDirty()) {
                next();
                return;
            }
            pendingNavigate = next;
            if (unsavedDialog) unsavedDialog.hidden = false;
        }

        backBtn.addEventListener(
            'click',
            () => {
                if (!editMode) {
                    onLeavePanel();
                    return;
                }
                openUnsaved(onLeavePanel);
            },
            { signal }
        );
        cancelBtn.addEventListener(
            'click',
            () => {
                if (!editMode) return;
                if (!isDirty()) {
                    setEditMode(false);
                    return;
                }
                pendingNavigate = () => {
                    restoreEditorFromBaseline();
                    setEditMode(false);
                    syncReadPane();
                };
                if (unsavedDialog) unsavedDialog.hidden = false;
            },
            { signal }
        );
        editBtn.addEventListener(
            'click',
            () => {
                if (signal.aborted) return;
                setEditMode(true);
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => reflowEditorLayout());
                });
            },
            { signal }
        );
        deleteBtn.addEventListener(
            'click',
            () => {
                if (signal.aborted) return;
                openDeleteDialog();
            },
            { signal }
        );
        deleteCancelBtn.addEventListener('click', () => closeDeleteDialog(), { signal });
        deleteDialog.querySelectorAll('[data-entry-delete-dismiss]').forEach((el) => {
            el.addEventListener('click', () => closeDeleteDialog(), { signal });
        });
        deleteConfirmBtn.addEventListener('click', () => void runConfirmedDelete(), { signal });
        viewDetailsBtn.addEventListener(
            'click',
            () => {
                if (signal.aborted) return;
                void runToolbarViewAnalysis();
            },
            { signal }
        );
        if (unsavedStay) {
            unsavedStay.addEventListener(
                'click',
                () => {
                    if (unsavedDialog) unsavedDialog.hidden = true;
                    pendingNavigate = null;
                },
                { signal }
            );
        }
        if (unsavedDiscard) {
            unsavedDiscard.addEventListener(
                'click',
                () => {
                    if (unsavedDialog) unsavedDialog.hidden = true;
                    const fn = pendingNavigate;
                    pendingNavigate = null;
                    if (fn) fn();
                },
                { signal }
            );
        }
        if (unsavedDialog) {
            const bd = unsavedDialog.querySelector('[data-close="1"]');
            if (bd) {
                bd.addEventListener(
                    'click',
                    () => {
                        unsavedDialog.hidden = true;
                        pendingNavigate = null;
                    },
                    { signal }
                );
            }
        }

        entryRemovePhotoCancelBtn?.addEventListener('click', () => closeEntryRemovePhotoModal(), { signal });
        entryRemovePhotoConfirmBtn?.addEventListener(
            'click',
            () => {
                const id = pendingRemoveEntryPhotoId;
                closeEntryRemovePhotoModal();
                if (!id) return;
                editorImages = editorImages.filter((x) => x.id !== id);
                renderImageStrip();
                updateColumnsLayout();
                if (!isOnline()) {
                    void persistDraftImages();
                    persistDraft();
                }
            },
            { signal }
        );
        entryRemovePhotoModalEl?.addEventListener(
            'click',
            (e) => {
                if (e.target?.matches?.('[data-entry-remove-photo-dismiss]')) closeEntryRemovePhotoModal();
            },
            { signal }
        );

        function entrySaveFetchTimeoutMs() {
            return isPwaOfflineContext() ? 45000 : 0;
        }

        async function fetchWithOptionalTimeout(url, options) {
            const timeoutMs = entrySaveFetchTimeoutMs();
            if (!timeoutMs) {
                return fetch(url, options);
            }
            const ctrl = new AbortController();
            const timer = global.setTimeout(() => ctrl.abort(), timeoutMs);
            try {
                return await fetch(url, { ...options, signal: ctrl.signal });
            } finally {
                global.clearTimeout(timer);
            }
        }

        async function patchRemote(reanalyze, imageUrlsList) {
            const payload = {
                userId,
                title: titleEl.value.trim(),
                text: bodyEl.value.trim(),
                tags: Array.from(tags).map(normalizeTag).filter(Boolean),
                imageUrls: imageUrlsList,
                reanalyze: Boolean(reanalyze),
            };
            if (!numericEntryId) {
                throw new Error('Entry is not synced yet.');
            }
            const res = await fetchWithOptionalTimeout(`/api/entries/${numericEntryId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (!res.ok || !data.success || !data.entry) {
                throw new Error(data.error || 'Save failed');
            }
            return data;
        }

        async function uploadImageForQueue(file, uid) {
            if (!uid) {
                throw new Error('Please log in again to upload photos.');
            }
            const form = new FormData();
            form.append('file', file);
            form.append('userId', String(uid));
            const res = await fetch('/api/uploads/image', { method: 'POST', body: form });
            const json = await res.json().catch(() => ({}));
            if (!res.ok || !json?.success || !json?.url) {
                throw new Error(json?.error || 'Upload failed');
            }
            return String(json.url);
        }

        async function flushPendingDataUrlsForSave() {
            for (const im of [...editorImages]) {
                if (im.url || !im.dataUrl) continue;
                const blob = dataUrlToBlob(im.dataUrl);
                const ext = (blob.type || 'image/png').split('/')[1] || 'png';
                const file = new File([blob], `pending-${Date.now()}.${ext}`, { type: blob.type || 'image/png' });
                const url = await uploadImageOnlineLocal(file, im.id);
                editorImages = editorImages.map((x) => (x.id === im.id ? { ...x, url, dataUrl: '', progress: 100 } : x));
                renderImageStrip();
            }
        }

        function offlineMergedEntry(reanalyze) {
            const base = { ...entry, id: entryKey };
            const nowIso = new Date().toISOString();
            base.updatedAt = nowIso;
            base.pwaEditPending = true;
            base.pwaDeletionPending = false;
            if (!base.createdAt && entry?.createdAt) base.createdAt = entry.createdAt;
            if (!base.createdAt && entry?.date) base.createdAt = entry.date;
            base.title = titleEl.value.trim();
            base.text = bodyEl.value.trim();
            base.tags = Array.from(tags).map(normalizeTag).filter(Boolean);
            base.imageUrls = imagesPayloadStrings();
            if (reanalyze) {
                base.feeling = 'neutral';
                base.emotionLabel = 'neutral';
                base.emotionScore = 0.55;
                base.sentimentLabel = 'neutral';
                base.sentimentScore = 0.55;
                base.all_probs = { neutral: 0.55, happy: 0.1, sad: 0.1, anxious: 0.1, angry: 0.15 };
                base.moodScoringOffline = true;
            }
            return base;
        }

        async function pushOfflineQueue(reanalyze) {
            const uid = userId || getUserId();
            const mediaKey = `editq_${entryKey}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            try {
                await idbMediaPut(mediaKey, serializeImagesForStorage());
            } catch (_) {}
            const record = {
                entryId: entryKey,
                userId: uid,
                title: titleEl.value.trim(),
                text: bodyEl.value.trim(),
                tags: Array.from(tags).map(normalizeTag).filter(Boolean),
                imageUrls: imagesPayloadStrings().filter((u) => !String(u).startsWith('data:')),
                imageMediaKey: mediaKey,
                reanalyze: Boolean(reanalyze),
                queuedAt: new Date().toISOString(),
            };
            if (typeof window.DiariOffline?.upsertEditQueueRecord === 'function') {
                window.DiariOffline.upsertEditQueueRecord(record);
            } else {
                const q = readQueue().filter((row) => String(row.entryId) !== String(entryKey));
                q.push(record);
                writeQueue(q);
            }
        }

        async function flushEditQueue() {
            if (!isOnline()) return;
            const q = readQueue();
            const next = [];
            for (const row of q) {
                const rowKey = String(row.entryId || '');
                if (rowKey.startsWith('offline_')) {
                    next.push(row);
                    continue;
                }
                const rowNumericId = Number(rowKey);
                if (!Number.isInteger(rowNumericId) || rowNumericId <= 0) {
                    next.push(row);
                    continue;
                }
                try {
                    let imageUrls = Array.isArray(row.imageUrls) ? [...row.imageUrls] : [];
                    if (row.imageMediaKey) {
                        const blobRow = await idbMediaGet(row.imageMediaKey);
                        if (blobRow?.images?.length) {
                            const revived = reviveImageItems(blobRow.images);
                            const merged = [];
                            for (const im of revived) {
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
                                    const url = await uploadImageForQueue(file, row.userId);
                                    merged.push(url);
                                }
                            }
                            if (merged.length) imageUrls = merged;
                        }
                    }
                    const body = {
                        userId: row.userId,
                        title: row.title,
                        text: row.text,
                        tags: row.tags,
                        reanalyze: row.reanalyze,
                    };
                    if (row.imageMediaKey || (Array.isArray(row.imageUrls) && row.imageUrls.length > 0)) {
                        body.imageUrls = imageUrls;
                    }
                    const res = await fetch(`/api/entries/${rowNumericId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    const data = await res.json();
                    if (res.ok && data.success && data.entry) {
                        replaceEntryInList({
                            ...data.entry,
                            pwaEditPending: false,
                            pwaDeletionPending: false,
                        });
                        try {
                            localStorage.removeItem(draftKey(String(row.entryId)));
                        } catch (_) {}
                        if (row.imageMediaKey) await idbMediaDelete(row.imageMediaKey);
                        continue;
                    }
                } catch (_) {}
                next.push(row);
            }
            writeQueue(next);
        }

        const onOnline = () => {
            if (typeof window.DiariOffline?.requestPwaSync === 'function') {
                void window.DiariOffline.requestPwaSync({ trustNavigatorOnline: true }).then(() => {
                    if (signal.aborted) return;
                    entry = loadEntryFromList(entryKey) || entry;
                    syncReadPane();
                    renderImageStrip();
                });
            } else {
                void flushEditQueue();
            }
            void loadTagChoices().then(() => {
                if (signal.aborted) return;
                fillPicker();
            });
        };
        window.addEventListener('online', onOnline, { signal });
        window.addEventListener(
            'diari-offline-sync-complete',
            () => {
                if (signal.aborted) return;
                entry = loadEntryFromList(entryKey) || entry;
                syncReadPane();
                renderImageStrip();
            },
            { signal }
        );
        window.addEventListener(
            'resize',
            () => {
                updateStripFade();
            },
            { signal }
        );

        /**
         * @returns {Promise<boolean>} Whether the requested save completed in a “good” state (API PATCH
         *          succeeded for metadata-only saves; broader success for reanalyze / offline paths).
         */
        async function runSave(reanalyze) {
            const text = bodyEl.value.trim();
            if (!text) {
                window.alert('Please add some text to your entry.');
                return false;
            }
            saveAnalyzeBtn.disabled = true;
            try {
                if (await shouldSaveEntryAsOffline()) {
                    await pushOfflineQueue(reanalyze);
                    const merged = offlineMergedEntry(reanalyze);
                    const uid = userId || getUserId();
                    let updated = null;
                    if (typeof window.DiariOffline?.markEntryEditPendingInCache === 'function') {
                        updated = window.DiariOffline.markEntryEditPendingInCache(entryKey, merged, uid, merged);
                    }
                    if (!updated) {
                        replaceEntryInList(merged);
                        updated = merged;
                    }
                    entry = loadEntryFromList(entryKey) || updated;
                    baseline = serializeState();
                    clearDraft();
                    renderImageStrip();
                    syncReadPane();
                    if (reanalyze) {
                        global.DiariMoodAnalysis.resetSession();
                        const overlay = global.DiariMoodAnalysis.ensureAnalysisOverlay();
                        try {
                            await global.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
                        } catch (_) {}
                        global.DiariMoodAnalysis.showAnalysisLoading(overlay);
                        await global.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                        global.DiariMoodAnalysis.showAnalysisResult(overlay, entry, true, moodOptions(overlay));
                    }
                    return true;
                }

                try {
                    await flushPendingDataUrlsForSave();
                } catch (e) {
                    console.error(e);
                    window.alert(e.message || 'Could not upload images. Try again when you have a stable connection.');
                    return false;
                }
                const imageSaveList = imagesPayloadStrings().filter((u) => !u.startsWith('data:'));

                if (reanalyze) {
                    global.DiariMoodAnalysis.resetSession();
                    const overlay = global.DiariMoodAnalysis.ensureAnalysisOverlay();
                    try {
                        await global.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
                    } catch (_) {}
                    global.DiariMoodAnalysis.showAnalysisLoading(overlay);
                    try {
                        const data = await patchRemote(true, imageSaveList);
                        entry = {
                            ...data.entry,
                            pwaEditPending: false,
                            pwaDeletionPending: false,
                            pwaShowEdited: true,
                        };
                        if (typeof window.DiariOffline?.removeEditQueueForEntry === 'function') {
                            window.DiariOffline.removeEditQueueForEntry(entryKey);
                        }
                        editorImages = imageItemsFromUrls(entry.imageUrls || []);
                        replaceEntryInList(entry);
                        const engine = (data.analysisEngine || '').toString().toLowerCase();
                        await global.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                        global.DiariMoodAnalysis.showAnalysisResult(overlay, data.entry, engine === 'fallback', moodOptions(overlay));
                        clearDraft();
                        baseline = serializeState();
                        return true;
                    } catch (err) {
                        console.error(err);
                        await pushOfflineQueue(true);
                        const merged = offlineMergedEntry(true);
                        replaceEntryInList(merged);
                        entry = merged;
                        baseline = serializeState();
                        await global.DiariMoodAnalysis.delayUntilMoodAnalysisGate();
                        global.DiariMoodAnalysis.showAnalysisResult(overlay, merged, true, moodOptions(overlay));
                        return true;
                    }
                }

                try {
                    const data = await patchRemote(false, imageSaveList);
                    entry = {
                        ...data.entry,
                        pwaEditPending: false,
                        pwaDeletionPending: false,
                        pwaShowEdited: true,
                    };
                    if (typeof window.DiariOffline?.removeEditQueueForEntry === 'function') {
                        window.DiariOffline.removeEditQueueForEntry(entryKey);
                    }
                    editorImages = imageItemsFromUrls(entry.imageUrls || []);
                    replaceEntryInList(entry);
                    clearDraft();
                    baseline = serializeState();
                    return true;
                } catch (err) {
                    console.error(err);
                    await pushOfflineQueue(false);
                    const merged = offlineMergedEntry(false);
                    replaceEntryInList(merged);
                    entry = merged;
                    baseline = serializeState();
                    window.alert('Saved offline. We will sync when you are back online.');
                    return false;
                }
            } finally {
                saveAnalyzeBtn.disabled = false;
                if (!signal.aborted) syncReadPane();
            }
        }

        saveAnalyzeBtn.addEventListener(
            'click',
            async () => {
                const shouldReanalyze = didTextChangeFromBaseline();
                if (shouldReanalyze) {
                    void runSave(true);
                    return;
                }
                if (!isDirty()) return;

                const actOffline = await shouldSaveEntryAsOffline();
                const overlay = global.DiariMoodAnalysis.ensureAnalysisOverlay();

                let metadataSavedOk = false;
                if (isPwaOfflineContext()) {
                    try {
                        if (typeof global.DiariMoodAnalysis.runEntryUpdateLoadingWithSave === 'function') {
                            metadataSavedOk = await global.DiariMoodAnalysis.runEntryUpdateLoadingWithSave(
                                () => runSave(false),
                                overlay
                            );
                        } else {
                            global.DiariMoodAnalysis.showEntryUpdateLoading(overlay);
                            metadataSavedOk = await runSave(false);
                        }
                    } finally {
                        global.DiariMoodAnalysis.hideAnalysisOverlay(overlay);
                    }
                } else {
                    global.DiariMoodAnalysis.resetSession();
                    try {
                        await global.DiariMoodAnalysis.primeEntryUpdateEditingLottie();
                    } catch (e) {
                        console.warn('Could not preload editing animation:', e);
                    }
                    global.DiariMoodAnalysis.showEntryUpdateLoading(overlay);
                    try {
                        const savePromise = runSave(false);
                        await Promise.all([
                            savePromise,
                            global.DiariMoodAnalysis.delayUntilEntryUpdateGate(),
                        ]);
                        metadataSavedOk = await savePromise;
                    } finally {
                        global.DiariMoodAnalysis.hideAnalysisOverlay(overlay);
                    }
                }

                if (metadataSavedOk && afterMetadataSaveToEntries) {
                    afterMetadataSaveToEntries({ offlineSave: actOffline });
                } else if (metadataSavedOk && actOffline) {
                    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
                        window.DiariToast.show(
                            'Saved offline. Changes will sync automatically when connected.',
                            'info',
                            5000
                        );
                    }
                }
            },
            { signal }
        );

        saveAnalyzeBtn.disabled = false;
        // Prime both loading animations early so save click shows immediately.
        try {
            void global.DiariMoodAnalysis.primeMoodAnalysisBookLottie();
            void global.DiariMoodAnalysis.primeEntryUpdateEditingLottie();
        } catch (_) {}

        flushEditQueue();

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (signal.aborted) return;
                reflowEditorLayout();
            });
        });

        return true;
    }

    global.DiariEntryDetail = {
        mount,
        unmount,
        getUserId,
        reflowEditorLayout,
        refreshImages() {
            refreshEntryImageStrip?.();
        },
    };

    document.addEventListener('DOMContentLoaded', async () => {
        try {
            if (!document.body.classList.contains('page-entry-view')) return;
            const id = parseQueryId();
            const uid = getUserId();
            if (!id || !uid) {
                window.location.href = 'entries.html';
                return;
            }
            if (window.DiariOffline?.syncAllForPageLoad && navigator.onLine !== false) {
                await window.DiariOffline.syncAllForPageLoad();
            }
            await mount({
                entryId: id,
                onLeavePanel: () => {
                    window.location.href = 'entries.html';
                },
            });
        } finally {
            if (window.DiariShell && typeof window.DiariShell.release === 'function') {
                window.DiariShell.release();
            }
        }
    });
})(typeof window !== 'undefined' ? window : this);
