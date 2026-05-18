// DiariCore Entries Page JavaScript

const ENTRIES_PAGE_SIZE = 6;

function escapeHtml(text) {
    if (window.DiariSecurity && typeof window.DiariSecurity.escapeHtml === 'function') {
        return window.DiariSecurity.escapeHtml(text);
    }
    return String(text ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Mood filter chips — matches `resolveEntryFeeling` / card labels (lowercase values). */
const MOOD_FILTER_VALUES = new Set(['happy', 'sad', 'angry', 'anxious', 'neutral']);

/** Default tags aligned with Write Entry; merged with `/api/tags` and tags on stored entries. */
const DEFAULT_ENTRIES_FILTER_TAGS = ['School', 'Home', 'Friends', 'Work', 'Family', 'Health', 'Money', 'Bills'];

let entriesMasterSorted = [];
let entriesByMonthKey = {};
let entriesMonthKeysOrdered = [];
let entriesSelectedMonthKey = '';
let entriesCurrentPage = 1;

const PWA_OFFLINE_SAVED_MSG =
    'Saved offline. Changes will sync automatically when connected.';

/** PWA installed / standalone — not desktop browser tab. */
function isPwaOfflineEntriesUi() {
    if (window.DiariOffline?.isPwaUiContext) {
        return window.DiariOffline.isPwaUiContext();
    }
    if (window.DiariOffline?.isPwaStandalone) {
        return window.DiariOffline.isPwaStandalone();
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

function ensurePwaDocumentMarkers() {
    if (!isPwaOfflineEntriesUi()) return;
    document.documentElement.classList.add('diari-pwa-standalone');
    document.documentElement.setAttribute('data-diari-pwa', 'standalone');
}

function readEntriesListFromCache() {
    if (window.DiariOffline && typeof window.DiariOffline.readEntriesCache === 'function') {
        return window.DiariOffline.readEntriesCache();
    }
    try {
        const arr = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        return Array.isArray(arr) ? arr : [];
    } catch {
        return [];
    }
}

function resolveEntriesUserId() {
    if (window.DiariOffline?.getUserId) {
        const uid = window.DiariOffline.getUserId();
        if (uid) return uid;
    }
    try {
        const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        const raw = user?.id ?? user?.userId ?? 0;
        const n = Number(raw);
        return Number.isInteger(n) && n > 0 ? n : 0;
    } catch {
        return 0;
    }
}

function findCachedEntryByKey(entryKey) {
    const key = String(entryKey ?? '');
    return readEntriesListFromCache().find((e) => String(e?.id ?? '') === key) || null;
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
    ensurePwaDocumentMarkers();
    try {
        if (sessionStorage.getItem('diariEntriesUpdatedToast') === '1') {
            sessionStorage.removeItem('diariEntriesUpdatedToast');
            showNotification('Updated the Entry Successfully...', 'success');
        }
        if (sessionStorage.getItem('diariEntriesDeletedToast') === '1') {
            sessionStorage.removeItem('diariEntriesDeletedToast');
            showNotification('Entry was Deleted Successfully', 'success');
        }
    } catch (_) {}

    await syncEntriesFromApi();
    if (isPwaOfflineEntriesUi()) {
        entriesPwaInitialSyncDone = true;
    }
    initializeEntriesFromStorage();
    await syncEntriesFilterTagsFromApi();
    initializeFilterDropdown();
    initializeSearch();
    initializeEntryCards();
    initializeEntriesPagination();
    initializeEntriesResizeEmptyState();
    openEntriesDetailFromQuery();

    const refreshEntriesFromSyncedStorage = () => {
        initializeEntriesFromStorage({ preserveNavigation: true });
        void syncEntriesFilterTagsFromApi();
    };

    window.addEventListener('diari-offline-sync-complete', refreshEntriesFromSyncedStorage);
    window.addEventListener('diari-remote-state-refreshed', refreshEntriesFromSyncedStorage);
    window.addEventListener('diari-entries-cache-updated', refreshEntriesFromSyncedStorage);

    window.addEventListener('pageshow', () => {
        if (navigator.onLine === false) return;
        void (async () => {
            if (typeof window.DiariOffline?.syncAllForPageLoad === 'function') {
                await window.DiariOffline.syncAllForPageLoad();
            }
            refreshEntriesFromSyncedStorage();
        })();
    });

    if (typeof window.DiariOffline?.wirePwaPageAutoSync === 'function') {
        window.DiariOffline.wirePwaPageAutoSync(refreshEntriesFromSyncedStorage);
    }

    if (isPwaOfflineEntriesUi()) {
        window.addEventListener('online', () => {
            entriesPwaReachable = null;
            void runPwaEntriesSyncNow();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && entriesPwaInitialSyncDone) {
                void tickPwaEntriesConnectivity();
            }
        });
        startPwaEntriesConnectivityWatch();
    }
    } finally {
        if (window.DiariShell && typeof window.DiariShell.release === 'function') {
            window.DiariShell.release();
        }
    }
});

async function syncEntriesFromApi() {
    if (typeof window.DiariOffline?.syncAllForPageLoad === 'function' && navigator.onLine !== false) {
        await window.DiariOffline.syncAllForPageLoad();
        return;
    }
    if (window.DiariOffline?.syncEntriesFromApi) {
        await window.DiariOffline.syncEntriesFromApi();
    }
}

let entriesPwaInitialSyncDone = false;
let entriesPwaReachable = null;
let entriesPwaConnectivityTimer = null;

async function tickPwaEntriesConnectivity() {
    if (!isPwaOfflineEntriesUi() || document.visibilityState === 'hidden') return;
    if (navigator.onLine === false) {
        entriesPwaReachable = false;
        return;
    }
    let reachable = true;
    if (typeof window.DiariOffline?.probeReachability === 'function') {
        try {
            reachable = await window.DiariOffline.probeReachability();
        } catch {
            reachable = false;
        }
    }
    const wasUnreachable = entriesPwaReachable === false;
    entriesPwaReachable = reachable;

    let pending = false;
    if (typeof window.DiariOffline?.hasPendingOfflineWorkAsync === 'function') {
        pending = await window.DiariOffline.hasPendingOfflineWorkAsync();
    } else if (typeof window.DiariOffline?.hasPendingOfflineWork === 'function') {
        pending = window.DiariOffline.hasPendingOfflineWork();
    }

    if (reachable && (wasUnreachable || pending)) {
        await runPwaEntriesSyncNow();
    }
}

function startPwaEntriesConnectivityWatch() {
    if (!isPwaOfflineEntriesUi() || entriesPwaConnectivityTimer != null) return;
    entriesPwaConnectivityTimer = window.setInterval(() => {
        void tickPwaEntriesConnectivity();
    }, 4000);
    void tickPwaEntriesConnectivity();
}

async function runPwaEntriesSyncNow() {
    if (!isPwaOfflineEntriesUi() || navigator.onLine === false) return;
    await syncEntriesFromApi();
    initializeEntriesFromStorage({ preserveNavigation: true });
    entriesPwaInitialSyncDone = true;
}

function monthKeyFromDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
}

function parseMonthKey(key) {
    const [y, m] = key.split('-').map(Number);
    return { year: y, monthIndex: m };
}

function formatMonthDropdownLabel(key) {
    const { year, monthIndex } = parseMonthKey(key);
    return new Date(year, monthIndex, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function formatMonthHeaderUpper(key) {
    const { year, monthIndex } = parseMonthKey(key);
    const monthUpper = new Date(year, monthIndex, 1).toLocaleString('en-US', { month: 'long' }).toUpperCase();
    return `${monthUpper} ${year}`;
}

function getCheckedFilterValues() {
    return Array.from(document.querySelectorAll('.filter-option input[type="checkbox"]:checked')).map((cb) =>
        String(cb.value || '').toLowerCase()
    );
}

function partitionEmotionAndTagFilters(checked) {
    const emotionVals = checked.filter((v) => MOOD_FILTER_VALUES.has(v));
    const tagVals = checked.filter((v) => !MOOD_FILTER_VALUES.has(v));
    return { emotionVals, tagVals };
}

/** Normalize tag text for matching (handles #prefix, casing). */
function normalizeTagCompare(raw) {
    return String(raw || '')
        .trim()
        .replace(/^#+/i, '')
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function formatTagDisplayLabel(raw) {
    const s = String(raw || '').trim().replace(/^#+/i, '');
    return s || '';
}

/** Build sorted [normalizedKey, displayLabel] pairs for the filter menu. */
function mergeEntriesFilterTagPairs(apiTagList) {
    const labelByNorm = new Map();
    DEFAULT_ENTRIES_FILTER_TAGS.forEach((t) => {
        const n = normalizeTagCompare(t);
        if (n && !labelByNorm.has(n)) labelByNorm.set(n, formatTagDisplayLabel(t));
    });
    (Array.isArray(apiTagList) ? apiTagList : []).forEach((item) => {
        const raw = typeof item === 'string' ? item : item?.tag;
        const n = normalizeTagCompare(raw);
        if (n && !labelByNorm.has(n)) labelByNorm.set(n, formatTagDisplayLabel(raw));
    });
    entriesMasterSorted.forEach((e) => {
        (Array.isArray(e.tags) ? e.tags : []).forEach((t) => {
            const n = normalizeTagCompare(t);
            if (n && !labelByNorm.has(n)) labelByNorm.set(n, formatTagDisplayLabel(t));
        });
    });
    return Array.from(labelByNorm.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function renderEntriesFilterTagOptions(pairs) {
    const container = document.getElementById('entriesFilterTagOptions');
    if (!container) return;
    const prevChecked = new Set(
        Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map((cb) =>
            String(cb.value || '').toLowerCase()
        )
    );
    container.innerHTML = '';
    if (!pairs.length) {
        const p = document.createElement('p');
        p.className = 'entries-filter-tags-empty';
        p.textContent = 'No tags yet. Tags from your entries and custom tags will appear here.';
        container.appendChild(p);
        return;
    }
    pairs.forEach(([norm, displayLabel]) => {
        const lab = document.createElement('label');
        lab.className = 'filter-option';
        const inp = document.createElement('input');
        inp.type = 'checkbox';
        inp.value = norm;
        if (prevChecked.has(norm)) inp.checked = true;
        const cm = document.createElement('span');
        cm.className = 'checkmark';
        const sl = document.createElement('span');
        sl.className = 'filter-label';
        sl.textContent = displayLabel || norm;
        lab.appendChild(inp);
        lab.appendChild(cm);
        lab.appendChild(sl);
        container.appendChild(lab);
    });
}

async function syncEntriesFilterTagsFromApi() {
    const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    const userId = Number(user?.id || 0);
    let apiTags = [];
    if (userId) {
        try {
            const res = await fetch(`/api/tags?userId=${encodeURIComponent(String(userId))}`);
            const data = await res.json();
            if (res.ok && data.success && Array.isArray(data.tags)) apiTags = data.tags;
        } catch (_) {}
    }
    renderEntriesFilterTagOptions(mergeEntriesFilterTagPairs(apiTags));
}

function entryMatchesFilters(entry, checked) {
    if (!checked.length) return true;
    const { emotionVals, tagVals } = partitionEmotionAndTagFilters(checked);
    const moodLabel = moodDisplayLabel(resolveEntryFeeling(entry)).toLowerCase();
    const rawTags = Array.isArray(entry.tags) ? entry.tags : [];
    const entryTagsNorm = rawTags.map((t) => normalizeTagCompare(t)).filter(Boolean);
    const emotionMatch = emotionVals.length === 0 || emotionVals.includes(moodLabel);
    const tagMatch =
        tagVals.length === 0 || tagVals.some((ft) => entryTagsNorm.includes(normalizeTagCompare(ft)));
    return emotionMatch && tagMatch;
}

function entryMatchesSearch(entry, query) {
    if (!query) return true;
    const q = query.toLowerCase();
    const titleRaw = (entry.title && String(entry.title).trim())
        ? String(entry.title).toLowerCase()
        : (entry.text ? entry.text.trim().split('\n')[0].toLowerCase() : '');
    const excerpt = String(entry.text || '').toLowerCase();
    const tags = (entry.tags || []).map((t) => String(t).toLowerCase());
    return titleRaw.includes(q) || excerpt.includes(q) || tags.some((t) => t.includes(q));
}

function getFilteredEntriesForSelectedMonth() {
    const list = entriesByMonthKey[entriesSelectedMonthKey] || [];
    const query = getEntriesSearchQuery();
    const checked = getCheckedFilterValues();
    return list.filter((e) => entryMatchesSearch(e, query) && entryMatchesFilters(e, checked));
}

function renderEntriesView(options = {}) {
    const skipFade = Boolean(options.skipFade);
    const grid = document.getElementById('entriesGrid');
    const section = document.getElementById('entriesMainSection');
    const monthHeaderText = document.getElementById('entriesMonthHeaderText');
    const paginationEl = document.getElementById('entriesPagination');
    const prevBtn = document.getElementById('entriesPagePrev');
    const nextBtn = document.getElementById('entriesPageNext');
    const indicator = document.getElementById('entriesPageIndicator');
    if (!grid || !section) return;

    const filtered = getFilteredEntriesForSelectedMonth();
    const totalInMonth = (entriesByMonthKey[entriesSelectedMonthKey] || []).length;
    const totalPages = Math.max(1, Math.ceil(filtered.length / ENTRIES_PAGE_SIZE));
    if (entriesCurrentPage > totalPages) entriesCurrentPage = totalPages;
    if (entriesCurrentPage < 1) entriesCurrentPage = 1;

    const fillGrid = () => {
        grid.innerHTML = '';
        const start = (entriesCurrentPage - 1) * ENTRIES_PAGE_SIZE;
        filtered.slice(start, start + ENTRIES_PAGE_SIZE).forEach((entry) => {
            grid.appendChild(createStoredEntryCard(entry));
        });

        if (monthHeaderText && entriesSelectedMonthKey) {
            monthHeaderText.textContent = formatMonthHeaderUpper(entriesSelectedMonthKey);
        }

        if (paginationEl && prevBtn && nextBtn && indicator) {
            const showPag = filtered.length > ENTRIES_PAGE_SIZE;
            paginationEl.hidden = !showPag;
            indicator.textContent = `Page ${entriesCurrentPage} of ${totalPages}`;
            prevBtn.disabled = entriesCurrentPage <= 1;
            nextBtn.disabled = entriesCurrentPage >= totalPages;
        }

        updateResultsMessage(filtered.length, totalInMonth);
        syncEntriesEmptyResultsLayout(filtered.length);

        grid.style.opacity = '1';
    };

    if (!skipFade) {
        grid.style.opacity = '0.45';
        requestAnimationFrame(() => requestAnimationFrame(fillGrid));
    } else {
        fillGrid();
    }
}

function initializeEntriesPagination() {
    const prevBtn = document.getElementById('entriesPagePrev');
    const nextBtn = document.getElementById('entriesPageNext');
    if (!prevBtn || !nextBtn || prevBtn.dataset.entriesPaginationInit) return;
    prevBtn.dataset.entriesPaginationInit = '1';
    prevBtn.addEventListener('click', () => {
        if (entriesCurrentPage > 1) {
            entriesCurrentPage -= 1;
            renderEntriesView();
        }
    });
    nextBtn.addEventListener('click', () => {
        const filtered = getFilteredEntriesForSelectedMonth();
        const totalPages = Math.max(1, Math.ceil(filtered.length / ENTRIES_PAGE_SIZE));
        if (entriesCurrentPage < totalPages) {
            entriesCurrentPage += 1;
            renderEntriesView();
        }
    });
}

function initializeEntriesFromStorage(options = {}) {
    const preserveNav = Boolean(options.preserveNavigation);
    const entries = readEntriesListFromCache();
    const main = document.querySelector('.entries-content');
    const emptyState = document.getElementById('entriesEmptyState');
    const firstSection = document.getElementById('entriesMainSection');
    const monthSelect = document.getElementById('entriesMonthSelect');
    const toolbar = document.querySelector('.entries-toolbar');
    const monthHeaderBlock = document.getElementById('entriesMonthHeader');
    const paginationEl = document.getElementById('entriesPagination');

    if (!main || !emptyState || !firstSection || !monthSelect) return;

    const normalize = (arr) => (Array.isArray(arr) ? arr : []);
    entriesMasterSorted = normalize(entries)
        .filter((e) => e && e.date)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (entriesMasterSorted.length === 0) {
        firstSection.style.display = 'none';
        if (toolbar) toolbar.hidden = true;
        if (monthHeaderBlock) monthHeaderBlock.hidden = true;
        if (paginationEl) paginationEl.hidden = true;
        main.classList.add('entries-content--empty-results');

        main.classList.add('entries-content--no-journal-entries');
        updateEntriesEmptyStateCopy(true);
        entriesByMonthKey = {};
        entriesMonthKeysOrdered = [];
        entriesSelectedMonthKey = '';
        entriesCurrentPage = 1;
        if (document.getElementById('entriesGrid')) {
            renderEntriesView({ skipFade: true });
        }
        return;
    }

    main.classList.remove('entries-content--empty-results');
    firstSection.style.display = '';
    if (toolbar) toolbar.hidden = false;
    if (monthHeaderBlock) monthHeaderBlock.hidden = false;

    entriesByMonthKey = {};
    entriesMasterSorted.forEach((entry) => {
        const d = new Date(entry.date);
        if (Number.isNaN(d.getTime())) return;
        const key = monthKeyFromDate(d);
        if (!entriesByMonthKey[key]) entriesByMonthKey[key] = [];
        entriesByMonthKey[key].push(entry);
    });

    entriesMonthKeysOrdered = Object.keys(entriesByMonthKey).sort((a, b) => {
        const { year: ay, monthIndex: am } = parseMonthKey(a);
        const { year: by, monthIndex: bm } = parseMonthKey(b);
        return new Date(by, bm, 1) - new Date(ay, am, 1);
    });

    monthSelect.innerHTML = '';
    entriesMonthKeysOrdered.forEach((key) => {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = formatMonthDropdownLabel(key);
        monthSelect.appendChild(opt);
    });

    const nowKey = monthKeyFromDate(new Date());
    const defaultMonth = entriesMonthKeysOrdered.includes(nowKey) ? nowKey : entriesMonthKeysOrdered[0];

    if (preserveNav && entriesSelectedMonthKey && entriesMonthKeysOrdered.includes(entriesSelectedMonthKey)) {
        monthSelect.value = entriesSelectedMonthKey;
        const filtered = getFilteredEntriesForSelectedMonth();
        const totalPages = Math.max(1, Math.ceil(filtered.length / ENTRIES_PAGE_SIZE));
        if (entriesCurrentPage > totalPages) entriesCurrentPage = totalPages;
        if (entriesCurrentPage < 1) entriesCurrentPage = 1;
    } else {
        entriesSelectedMonthKey = defaultMonth;
        entriesCurrentPage = 1;
        monthSelect.value = entriesSelectedMonthKey;
    }

    if (!monthSelect.dataset.entriesMonthBound) {
        monthSelect.dataset.entriesMonthBound = '1';
        monthSelect.addEventListener('change', () => {
            entriesSelectedMonthKey = monthSelect.value;
            entriesCurrentPage = 1;
            renderEntriesView();
        });
    }

    renderEntriesView({ skipFade: true });
}

function resolveEntryFeeling(entry) {
    const raw = String(entry?.emotionLabel || entry?.feeling || '').toLowerCase();
    if (raw && raw !== 'unspecified') {
        if (raw === 'excited') return 'happy';
        if (raw === 'stressed') return 'anxious';
        if (raw === 'calm' || raw === 'peaceful') return 'neutral';
        if (['happy', 'sad', 'angry', 'anxious', 'neutral'].includes(raw)) return raw;
    }
    const sentiment = String(entry?.sentimentLabel || '').toLowerCase();
    if (sentiment === 'positive') return 'happy';
    if (sentiment === 'negative') return 'anxious';
    return 'neutral';
}

function moodDisplayLabel(feelingRaw) {
    const feeling = (feelingRaw || '').toLowerCase();
    if (feeling === 'happy') return 'Happy';
    if (feeling === 'sad') return 'Sad';
    if (feeling === 'angry') return 'Angry';
    if (feeling === 'anxious') return 'Anxious';
    return 'Neutral';
}

function isEntryEditPendingForList(ent) {
    if (!isPwaOfflineEntriesUi() || !ent) return false;
    if (window.DiariOffline?.shouldShowEntryEditPendingPill) {
        return window.DiariOffline.shouldShowEntryEditPendingPill(ent);
    }
    if (ent.pwaEditPending !== true) return false;
    return !navigator.onLine;
}

function isEntryEditedForList(ent) {
    if (isPwaOfflineEntriesUi() && ent && (isEntryEditPendingForList(ent) || ent.pwaDeletionPending === true)) {
        return false;
    }
    if (isPwaOfflineEntriesUi() && ent && ent.pwaShowEdited === true) {
        return true;
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

/** ISO string used for the time row on list cards (prefer last save when edited). */
function entryCardTimeIso(ent) {
    if (!ent) return '';
    if (isEntryEditedForList(ent) && ent.updatedAt) return ent.updatedAt;
    return ent.date || ent.createdAt || '';
}

function entrySyncPillHtml(entry) {
    if (!isPwaOfflineEntriesUi() || !entry) return '';
    let label = null;
    if (window.DiariOffline && typeof window.DiariOffline.getEntrySyncLabel === 'function') {
        label = window.DiariOffline.getEntrySyncLabel(entry);
    }
    if (!label) {
        if (entry.pwaDeletionPending === true) {
            label = { text: 'Deletion Pending', kind: 'delete' };
        } else if (isEntryEditPendingForList(entry)) {
            label = { text: 'Edit Pending', kind: 'edit' };
        } else {
            const id = String(entry.id ?? '');
            const engine = String(entry.engine || '').toLowerCase();
            if (
                id.startsWith('offline_') ||
                entry.pendingServerAnalysis === true ||
                entry.moodScoringOffline === true ||
                engine === 'offline-estimate' ||
                engine === 'offline-local'
            ) {
                label = { text: 'Pending', kind: 'pending' };
            }
        }
    }
    if (!label) return '';
    return `<span class="entry-sync-pill entry-sync-pill--${escapeHtml(label.kind)}">${escapeHtml(label.text)}</span>`;
}

function createStoredEntryCard(entry) {
    const article = document.createElement('article');
    article.className = 'entry-card';
    if (entry.pwaDeletionPending === true && isPwaOfflineEntriesUi()) {
        article.classList.add('entry-card--deletion-pending');
    }
    if (entry.id != null && entry.id !== '') {
        article.dataset.entryId = String(entry.id);
    }
    const date = new Date(entry.date);
    const dateText = Number.isNaN(date.getTime())
        ? 'Unknown date'
        : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeSource = entryCardTimeIso(entry) || entry.date;
    const timeDate = new Date(timeSource);
    const timeText = Number.isNaN(timeDate.getTime())
        ? ''
        : timeDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const showEditedPill = isEntryEditedForList(entry);

    const title = (entry.title && String(entry.title).trim())
        ? String(entry.title).trim().slice(0, 80)
        : (entry.text ? entry.text.trim().split('\n')[0].slice(0, 80) : 'Journal Entry');
    const excerpt = entry.text || '';
    const tags = Array.isArray(entry.tags) ? entry.tags : [];

    const resolvedFeeling = resolveEntryFeeling(entry);
    const moodLabel = moodDisplayLabel(resolvedFeeling);
    const safeTitle = escapeHtml(title || 'Journal Entry');
    const safeExcerpt = escapeHtml(excerpt || 'No details provided.');
    const safeTagsHtml = tags.length
        ? tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join('')
        : '';
    article.innerHTML = `
        <div class="entry-content-wrapper">
            <div class="entry-header">
                <div class="entry-meta">
                    <span class="entry-date"><i class="bi bi-calendar3" aria-hidden="true"></i><span>${escapeHtml(dateText)}</span></span>
                    <span class="entry-time">${escapeHtml(timeText)}</span>
                    <h3 class="entry-title">${safeTitle}</h3>
                </div>
                <div class="entry-mood">
                    ${entrySyncPillHtml(entry)}
                    <span class="mood-label mood-label--${escapeHtml(resolvedFeeling)}">${escapeHtml(moodLabel)}</span>
                    ${showEditedPill ? '<span class="entry-edited-pill" aria-label="Edited after save">Edited</span>' : ''}
                </div>
            </div>
            <div class="entry-content">
                <p class="entry-excerpt">${safeExcerpt}</p>
                ${safeTagsHtml ? `<div class="entry-tags">${safeTagsHtml}</div>` : ''}
            </div>
        </div>
    `;
    return article;
}

let entriesResizeTimer;

function getEntriesSearchQuery() {
    const input = document.querySelector('.search-input');
    const top = document.getElementById('mobileAppTopbarSearchInput');
    const a = input ? input.value.trim() : '';
    const b = top ? top.value.trim() : '';
    return a || b;
}

function initializeEntriesResizeEmptyState() {
    window.addEventListener('resize', function () {
        clearTimeout(entriesResizeTimer);
        entriesResizeTimer = setTimeout(function () {
            if (document.getElementById('entriesGrid')) {
                renderEntriesView({ skipFade: true });
            }
        }, 150);
    });
}

// Filter Dropdown Functionality
function initializeFilterDropdown() {
    const filterBtn = document.getElementById('filterBtn');
    const filterMenu = document.getElementById('filterMenu');
    const applyFiltersBtn = document.getElementById('applyFilters');
    const clearFiltersBtn = document.getElementById('clearFilters');

    // Toggle filter menu
    if (filterBtn && filterMenu) {
        filterBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            filterMenu.classList.toggle('show');
        });

        // Close filter menu when clicking outside (mobile trigger may load later — resolve each click)
        document.addEventListener('click', function(e) {
            const mb = document.getElementById('mobileTopbarFilterTrigger');
            const inFilterBtn = filterBtn.contains(e.target);
            const inMobileTrigger = mb && mb.contains(e.target);
            if (!filterMenu.contains(e.target) && !inFilterBtn && !inMobileTrigger) {
                filterMenu.classList.remove('show');
            }
        });

        // Prevent menu close when clicking inside
        filterMenu.addEventListener('click', function(e) {
            e.stopPropagation();
        });
    }

    // Apply filters
    if (applyFiltersBtn) {
        applyFiltersBtn.addEventListener('click', function() {
            applyFilters();
            filterMenu.classList.remove('show');
            showNotification('Filters applied successfully', 'success');
        });
    }

    // Clear filters
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', function() {
            clearAllFilters();
            filterMenu.classList.remove('show');
            showNotification('Filters cleared', 'info');
        });
    }
}

// Apply Filters
function applyFilters() {
    entriesCurrentPage = 1;
    renderEntriesView();
}

// Clear All Filters
function clearAllFilters() {
    const checkboxes = document.querySelectorAll('.filter-option input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    entriesCurrentPage = 1;
    renderEntriesView();
}

function hasActiveSearchOrFilters() {
    const q = getEntriesSearchQuery();
    if (q.length > 0) return true;
    return document.querySelectorAll('.filter-option input[type="checkbox"]:checked').length > 0;
}

function updateEntriesEmptyStateCopy(noJournalEntries) {
    const emptyState = document.getElementById('entriesEmptyState');
    if (!emptyState) return;
    const desktopTitle = emptyState.querySelector('.entries-empty-state__title--desktop');
    const desktopHint = emptyState.querySelector('.entries-empty-state__hint--desktop');
    const mobileTitle = emptyState.querySelector('.entries-empty-state__title--mobile');
    const mobileHint = emptyState.querySelector('.entries-empty-state__hint--mobile');
    if (noJournalEntries) {
        if (desktopTitle) desktopTitle.textContent = 'No entries yet';
        if (desktopHint) {
            desktopHint.textContent = 'Your journal is still empty. Write your first entry to start tracking your journey.';
        }
        if (mobileTitle) mobileTitle.textContent = 'No entries yet';
        if (mobileHint) mobileHint.textContent = 'Write your first entry to get started.';
        return;
    }
    if (desktopTitle) desktopTitle.textContent = 'No entries match your search or filters';
    if (desktopHint) {
        desktopHint.textContent = 'Try different keywords, clear the search box, or adjust filters to see your journal entries.';
    }
    if (mobileTitle) mobileTitle.textContent = 'No matches';
    if (mobileHint) mobileHint.textContent = 'Try other words or clear the search bar.';
}

function syncEntriesEmptyResultsLayout(visibleCount) {
    const main = document.querySelector('.entries-content');
    if (!main) return;
    const noJournalEntries = entriesMasterSorted.length === 0;
    if (noJournalEntries) {
        main.classList.add('entries-content--empty-results', 'entries-content--no-journal-entries');
        updateEntriesEmptyStateCopy(true);
        return;
    }
    main.classList.remove('entries-content--no-journal-entries');
    if (visibleCount === 0 && hasActiveSearchOrFilters()) {
        main.classList.add('entries-content--empty-results');
        updateEntriesEmptyStateCopy(false);
    } else {
        main.classList.remove('entries-content--empty-results');
    }
}

// Update results message
function updateResultsMessage(visibleCount, totalCount) {
    const existingMessage = document.querySelector('.results-message');
    if (existingMessage) {
        existingMessage.remove();
    }

    const searchSection = document.querySelector('.search-filter-section');
    const main = document.querySelector('.entries-content');
    if (!searchSection || !main) return;

    if (visibleCount < totalCount) {
        const message = document.createElement('div');
        message.className = 'results-message';
        message.innerHTML = `<p>Showing ${visibleCount} of ${totalCount} entries</p>`;
        /* After search, before empty-state markup — keeps “Showing X of Y” above the no-match card on all viewports */
        searchSection.insertAdjacentElement('afterend', message);
    }

    syncEntriesEmptyResultsLayout(visibleCount);
}

let entriesSearchDebounceTimer;

function onEntriesSearchInput(source) {
    const searchInput = document.querySelector('.search-input');
    const topbarInput = document.getElementById('mobileAppTopbarSearchInput');
    const v = source.value;
    if (searchInput && source !== searchInput) searchInput.value = v;
    if (topbarInput && source !== topbarInput) topbarInput.value = v;
    clearTimeout(entriesSearchDebounceTimer);
    entriesSearchDebounceTimer = setTimeout(() => {
        performSearch();
    }, 300);
}

// Search: desktop field binds on load; navbar field binds when side-bar injects (async)
function initializeSearch() {
    const searchInput = document.querySelector('.search-input');
    if (searchInput && !searchInput.dataset.entriesSearchInit) {
        searchInput.dataset.entriesSearchInit = '1';
        searchInput.addEventListener('input', function() {
            onEntriesSearchInput(this);
        });
    }
    attachMobileTopbarSearchInput();
}

function attachMobileTopbarSearchInput() {
    const topbarInput = document.getElementById('mobileAppTopbarSearchInput');
    if (!topbarInput || topbarInput.dataset.entriesSearchInit) return;
    topbarInput.dataset.entriesSearchInit = '1';
    topbarInput.addEventListener('input', function() {
        onEntriesSearchInput(this);
    });
}

function attachMobileTopbarFilterTrigger() {
    const filterBtn = document.getElementById('filterBtn');
    const mobileTopbarFilterTrigger = document.getElementById('mobileTopbarFilterTrigger');
    if (!filterBtn || !mobileTopbarFilterTrigger || mobileTopbarFilterTrigger.dataset.filterInit) return;
    mobileTopbarFilterTrigger.dataset.filterInit = '1';
    mobileTopbarFilterTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        e.preventDefault();
        filterBtn.click();
    });
}

function openMobileNavbarSearchFromQuery() {
    if (window.innerWidth > 768) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('openSearch') !== '1') return;
    const searchToggle = document.querySelector('.mobile-app-topbar__btn--search-toggle');
    const toggleVisible = searchToggle && searchToggle.offsetParent !== null
        && window.getComputedStyle(searchToggle).display !== 'none';
    if (toggleVisible && typeof window.diariOpenMobileTopbarSearch === 'function') {
        window.diariOpenMobileTopbarSearch();
    } else {
        const inlineSearch = document.querySelector('.entries-content .search-input');
        if (inlineSearch) {
            inlineSearch.focus({ preventScroll: false });
            inlineSearch.scrollIntoView({ block: 'center', behavior: 'smooth' });
        }
    }
    params.delete('openSearch');
    const q = params.toString();
    const base = window.location.pathname.split('/').pop() || 'entries.html';
    history.replaceState({}, '', q ? `${base}?${q}` : base);
}

document.addEventListener('diari-mobile-shell-ready', function() {
    attachMobileTopbarSearchInput();
    attachMobileTopbarFilterTrigger();
    requestAnimationFrame(() => {
        requestAnimationFrame(openMobileNavbarSearchFromQuery);
    });
});

// Perform Search (selected month only; client-side)
function performSearch() {
    entriesCurrentPage = 1;
    renderEntriesView();
}

function setEntriesDetailLoading(on) {
    const ov = document.getElementById('entriesDetailLoadingOverlay');
    const actions = document.getElementById('entryViewActions');
    if (!ov) return;
    if (on) {
        ov.classList.add('is-visible');
        ov.setAttribute('aria-busy', 'true');
        if (actions) actions.hidden = true;
    } else {
        ov.classList.remove('is-visible');
        ov.setAttribute('aria-busy', 'false');
    }
}

async function openEntriesDetailInline(entryId) {
    const entryKey = String(entryId ?? '').trim();
    if (!entryKey) return;

    const shell = document.getElementById('entriesDetailShell');
    const list = document.getElementById('entriesListShell');
    if (!shell || !list || !window.DiariEntryDetail || typeof window.DiariEntryDetail.mount !== 'function') {
        window.location.href = `entry-view.html?id=${encodeURIComponent(entryKey)}`;
        return;
    }

    const cached = findCachedEntryByKey(entryKey);
    if (!cached) {
        window.location.href = `entry-view.html?id=${encodeURIComponent(entryKey)}`;
        return;
    }

    setEntriesDetailLoading(true);
    try {
        const url = new URL(window.location.href);
        url.searchParams.set('entryId', entryKey);
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
    list.hidden = true;
    document.body.classList.add('page-entries-detail-open');
    window.scrollTo(0, 0);
    try {
        const uid = resolveEntriesUserId();
        const mountOpts = {
            entryId: entryKey,
            onLeavePanel: closeEntriesDetailInline,
            afterMetadataSaveToEntries: (detail) => {
                closeEntriesDetailInline();
                if (detail && detail.offlineSave && isPwaOfflineEntriesUi()) {
                    showNotification(PWA_OFFLINE_SAVED_MSG, 'info', 5000);
                    return;
                }
                showNotification('Updated the Entry Successfully...', 'success');
            },
            afterEntryDeletedToEntries: (detail) => {
                closeEntriesDetailInline();
                if (!detail || !detail.offline) {
                    showNotification('Entry was Deleted Successfully', 'success');
                }
            },
        };
        if (uid) mountOpts.userId = uid;
        const mounted = await window.DiariEntryDetail.mount(mountOpts);
        if (!mounted) {
            window.location.href = `entry-view.html?id=${encodeURIComponent(entryKey)}`;
            return;
        }
        shell.hidden = false;
        void shell.offsetWidth;
        if (typeof window.DiariEntryDetail.refreshImages === 'function') {
            window.requestAnimationFrame(() => {
                window.requestAnimationFrame(() => {
                    window.DiariEntryDetail.refreshImages();
                    window.setTimeout(() => window.DiariEntryDetail.refreshImages(), 120);
                });
            });
        }
        if (typeof window.DiariEntryDetail.reflowEditorLayout === 'function') {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    window.DiariEntryDetail.reflowEditorLayout();
                });
            });
        }
        try {
            document.documentElement.classList.remove('entries-restore-detail');
        } catch (_) {}
    } catch (err) {
        console.error(err);
        closeEntriesDetailInline();
    } finally {
        setEntriesDetailLoading(false);
    }
}

function closeEntriesDetailInline() {
    try {
        document.documentElement.classList.remove('entries-restore-detail');
    } catch (_) {}
    setEntriesDetailLoading(false);
    if (window.DiariEntryDetail && typeof window.DiariEntryDetail.unmount === 'function') {
        window.DiariEntryDetail.unmount();
    }
    const shell = document.getElementById('entriesDetailShell');
    const list = document.getElementById('entriesListShell');
    const dlg = document.getElementById('entryUnsavedDialog');
    if (dlg) dlg.hidden = true;
    if (shell) shell.hidden = true;
    if (list) list.hidden = false;
    document.body.classList.remove('page-entries-detail-open');
    try {
        const url = new URL(window.location.href);
        url.searchParams.delete('entryId');
        window.history.replaceState({}, '', url.toString());
    } catch (_) {}
    if (document.getElementById('entriesGrid')) {
        initializeEntriesFromStorage({ preserveNavigation: true });
        void syncEntriesFilterTagsFromApi();
    }
}

function openEntriesDetailFromQuery() {
    try {
        const url = new URL(window.location.href);
        const id = (url.searchParams.get('entryId') || '').trim();
        if (!id) return;
        const listShell = document.getElementById('entriesListShell');
        const detailShell = document.getElementById('entriesDetailShell');
        // Avoid showing the grid first: immediately flip shells, then mount.
        if (listShell && detailShell) {
            listShell.hidden = true;
            detailShell.hidden = false;
            document.body.classList.add('page-entries-detail-open');
        }
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
                openEntriesDetailInline(id);
            });
        });
    } catch (_) {}
}

// Entry cards: delegated clicks on dynamically rendered grid
function initializeEntryCards() {
    const grid = document.getElementById('entriesGrid');
    if (!grid || grid.dataset.entriesCardInit) return;
    grid.dataset.entriesCardInit = '1';

    grid.addEventListener('click', function (e) {
        const card = e.target.closest('.entry-card');
        if (!card || e.target.closest('button')) return;
        showEntryDetails(card);
    });
}

// Show Entry Details — inline panel on Entries page (fallback: standalone entry-view.html)
function showEntryDetails(card) {
    const id = card.dataset.entryId;
    if (!id) {
        const title = card.querySelector('.entry-title')?.textContent || 'Entry';
        showNotification(`This entry cannot be opened (missing id): ${title}`, 'error');
        return;
    }
    openEntriesDetailInline(id);
}

// Legacy load-more UI removed from Entries page (month dropdown + pagination replace it).
function initializeLoadMore() {}

function loadMoreEntries() {
    const loadMoreBtn = document.getElementById('loadMoreBtn');
    const entriesGrid = document.querySelector('.entries-grid');
    
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
        // Mobile: Show 2 more hidden entries or April section
        const hiddenEntries = document.querySelectorAll('.entries-grid > .entry-card:nth-child(n+7)');
        let shownCount = 0;
        
        hiddenEntries.forEach(entry => {
            if (shownCount < 2) {
                // Force display to flex to override CSS
                entry.style.setProperty('display', 'flex', 'important');
                shownCount++;
            }
        });
        
        // Count remaining hidden entries more accurately
        const allHiddenEntries = document.querySelectorAll('.entries-grid > .entry-card:nth-child(n+7)');
        let remainingCount = 0;
        
        allHiddenEntries.forEach(entry => {
            const computedStyle = window.getComputedStyle(entry);
            if (computedStyle.display === 'none') {
                remainingCount++;
            }
        });
        
        // If no more March entries, show April section
        if (remainingCount === 0) {
            const aprilSection = document.querySelector('.april-section');
            if (aprilSection) {
                aprilSection.classList.add('april-section--visible');
                
                // Show first 2 April entries
                const aprilEntries = aprilSection.querySelectorAll('.entries-grid > .entry-card:nth-child(n+7)');
                let aprilShownCount = 0;
                
                aprilEntries.forEach(entry => {
                    if (aprilShownCount < 2) {
                        entry.style.setProperty('display', 'flex', 'important');
                        aprilShownCount++;
                    }
                });
                
                // Check if there are still more April entries to show
                const remainingAprilEntries = aprilSection.querySelectorAll('.entries-grid > .entry-card:nth-child(n+7)');
                let remainingAprilCount = 0;
                
                remainingAprilEntries.forEach(entry => {
                    const computedStyle = window.getComputedStyle(entry);
                    if (computedStyle.display === 'none') {
                        remainingAprilCount++;
                    }
                });
                
                // Hide button and show message if no more entries at all
                if (remainingAprilCount === 0) {
                    loadMoreBtn.style.display = 'none';
                    
                    // Add "nothing to show" message
            const nothingToShow = document.createElement('div');
            nothingToShow.className = 'nothing-to-show-mobile';
            nothingToShow.innerHTML = `
                <p style="text-align: center; color: var(--text-secondary); font-size: 0.9rem; margin: 2rem 0; font-style: italic;">
                    Nothing more to show for this month
                </p>
            `;
                    
                    // Insert after load more button container
                    const loadMoreContainer = loadMoreBtn.parentElement;
                    loadMoreContainer.parentNode.insertBefore(nothingToShow, loadMoreContainer.nextSibling);
                }
            }
        }
        
        showNotification(`${shownCount} more entries loaded`, 'success');
    } else {
        // Desktop: reveal April month (hidden until first click); then hide control
        const aprilSection = document.querySelector('.april-section');
        if (aprilSection && !aprilSection.classList.contains('april-section--visible')) {
            aprilSection.classList.add('april-section--visible');
            if (loadMoreBtn) {
                loadMoreBtn.style.display = 'none';
            }
            showNotification('More entries loaded', 'success');
            return;
        }
        
        if (loadMoreBtn) {
            loadMoreBtn.style.display = 'none';
        }
    }
}

// Generate Mock Entries
function generateMockEntries(count) {
    const mockEntries = [];
    const emotions = [
        { emoji: '😊', label: 'Happy' },
        { emoji: '😔', label: 'Sad' },
        { emoji: '😌', label: 'Calm' },
        { emoji: '😡', label: 'Angry' },
        { emoji: '😰', label: 'Anxious' }
    ];
    
    const titles = [
        'Morning Coffee Thoughts',
        'Weekend Reflections',
        'Project Update',
        'Family Time',
        'Personal Growth',
        'Daily Gratitude'
    ];
    
    const excerpts = [
        'Today was filled with unexpected moments that made me realize the importance of being present...',
        'Sometimes the smallest victories are the ones that matter most in our journey...',
        'Taking time to reflect on where I am and where I want to be has been eye-opening...',
        'The connections we make with others truly shape our experiences in profound ways...',
        'Learning to embrace change has been one of the most challenging yet rewarding lessons...',
        'Gratitude practice has transformed how I view even the simplest moments of each day...'
    ];

    const tags = [
        ['Personal', 'Reflection'],
        ['Work', 'Growth'],
        ['Family', 'Love'],
        ['Health', 'Wellness'],
        ['Goals', 'Future'],
        ['Gratitude', 'Mindfulness']
    ];

    for (let i = 0; i < count; i++) {
        const emotion = emotions[Math.floor(Math.random() * emotions.length)];
        const title = titles[Math.floor(Math.random() * titles.length)];
        const excerpt = excerpts[Math.floor(Math.random() * excerpts.length)];
        const entryTags = tags[Math.floor(Math.random() * tags.length)];
        const date = new Date();
        date.setDate(date.getDate() - (i + 7)); // Go back in time

        const entryCard = createEntryCard({
            day: date.getDate(),
            month: date.toLocaleDateString('en', { month: 'short' }),
            emotion: emotion,
            title: title,
            excerpt: excerpt,
            tags: entryTags
        });

        mockEntries.push(entryCard);
    }

    return mockEntries;
}

// Create Entry Card Element
function createEntryCard(data) {
    const card = document.createElement('article');
    card.className = 'entry-card';
    
    card.innerHTML = `
        <div class="entry-header">
            <div class="entry-date">
                <span class="date-day">${escapeHtml(String(data.day ?? ''))}</span>
                <span class="date-month">${escapeHtml(String(data.month ?? ''))}</span>
            </div>
            <div class="entry-mood">
                <span class="mood-emoji">${escapeHtml(String(data.emotion.emoji ?? ''))}</span>
                <span class="mood-label">${escapeHtml(String(data.emotion.label ?? ''))}</span>
            </div>
        </div>
        <div class="entry-content">
            <h3 class="entry-title">${escapeHtml(String(data.title ?? ''))}</h3>
            <p class="entry-excerpt">${escapeHtml(String(data.excerpt ?? ''))}</p>
            <div class="entry-tags">
                ${data.tags.map((tag) => `<span class="tag">${escapeHtml(String(tag ?? ''))}</span>`).join('')}
            </div>
        </div>
        <div class="entry-footer">
            <button class="btn-read-more">Read More</button>
        </div>
    `;
    
    return card;
}

// Show Notification
function showNotification(message, type = 'info') {
    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
        window.DiariToast.show(message, type, 3000);
        return;
    }
    // Remove existing notification
    const existingNotification = document.querySelector('.entries-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.className = 'entries-notification';
    notification.innerHTML = `
        <i class="bi bi-info-circle"></i>
        <span></span>
    `;
    if (window.DiariSecurity && window.DiariSecurity.setToastMessage) {
        window.DiariSecurity.setToastMessage(notification, message);
    } else {
        const span = notification.querySelector('span');
        if (span) span.textContent = String(message ?? '');
    }

    // Style the notification
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
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        background: ${window.DiariToastColors && window.DiariToastColors.bg ? window.DiariToastColors.bg(type) : type === 'success' ? '#8da399' : type === 'error' ? '#E74C3C' : '#7FA7BF'};
        color: ${window.DiariToastColors && window.DiariToastColors.fg ? window.DiariToastColors.fg(type) : '#ffffff'};
        font-family: 'Inter', sans-serif;
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);

    // Remove after delay
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}
