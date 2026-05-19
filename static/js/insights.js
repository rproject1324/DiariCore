// DiariCore Insights Page JavaScript - New Layout
let INSIGHTS_ENTRIES = [];
let HAS_INSIGHTS_DATA = false;
let WEEKLY_DESKTOP_CHART = null;
let WEEKLY_MOBILE_CHART = null;
let INSIGHTS_CONSISTENCY_CHART = null;
let MOOD_BY_TAG_CHART = null;
let consistencyMonthSelectBound = false;
const CONSISTENCY_MONTH_STORAGE_KEY = 'diariCoreInsightsConsistencyMonth';

function insightsIsMobileChartUi() {
    return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
}

function chartFlowLoadAnimation() {
    return window.DiariChartFlow?.getLoadAnimation?.() ?? false;
}

function bindInsightsChartFlow(chart, weekly, moodColors) {
    if (!chart || !window.DiariChartFlow) return;
    if (weekly && moodColors) {
        chart._diariMoodPointColors = weekly.dominantMoods.map((m, i) =>
            weekly.data[i] == null ? null : moodColorForKey(m, moodColors)
        );
    }
    DiariChartFlow.bindChart(chart);
}

function insightsMobileTooltipPluginOpts() {
    if (!insightsIsMobileChartUi()) return {};
    return {
        tooltip: {
            /* Manual show/hide via bindInsightsMobileChartTapToggle (avoids double-toggle with Chart.js). */
            events: [],
        },
    };
}

/** Mobile: hide Chart.js tooltip (tap same bar again or empty chart area). */
function insightsDismissChartTooltip(chart) {
    if (!chart) return;
    chart._diariTipIdx = -1;
    if (typeof chart.setActiveElements === 'function') chart.setActiveElements([]);
    const tt = chart.tooltip;
    if (tt) {
        if (typeof tt.setActiveElements === 'function') tt.setActiveElements([], { x: 0, y: 0 });
        tt.opacity = 0;
    }
    chart.update('none');
}

function insightsChartActiveTipIndex(chart) {
    if (!chart?.tooltip || typeof chart.tooltip.getActiveElements !== 'function') {
        return chart?._diariTipIdx ?? -1;
    }
    const active = chart.tooltip.getActiveElements();
    return active?.[0]?.index ?? -1;
}

/** Re-stack Emotion-by-Tag bars so visible moods fill 100% (matches desktop legend toggle feel). */
function moodByTagRecalcVisiblePercentages(chart) {
    const breakdown = chart?._diariTagBreakdown;
    if (!breakdown?.rankedTagKeys?.length) return;
    const moodKeys = ['happy', 'sad', 'angry', 'anxious', 'neutral'];
    chart.data.datasets.forEach((ds, di) => {
        const mood = moodKeys[di];
        if (!mood) return;
        ds.data = breakdown.rankedTagKeys.map((tagKey) => {
            if (!chart.isDatasetVisible(di)) return 0;
            const visibleTotal = moodKeys.reduce((sum, mk, idx) => {
                if (!chart.isDatasetVisible(idx)) return sum;
                return sum + (breakdown.countsByTag[tagKey]?.[mk] || 0);
            }, 0);
            const count = breakdown.countsByTag[tagKey]?.[mood] || 0;
            if (visibleTotal <= 0) return 0;
            return Math.round((count / visibleTotal) * 1000) / 10;
        });
    });
}

function moodByTagLegendToggle(chart, datasetIndex) {
    if (!chart || datasetIndex == null) return;
    chart.setDatasetVisibility(datasetIndex, !chart.isDatasetVisible(datasetIndex));
    moodByTagRecalcVisiblePercentages(chart);
    chart.update();
}

/** Mobile/PWA: legend is drawn on the canvas — detect taps/clicks on legend hit boxes. */
function insightsTryHandleChartLegendClick(chart, e) {
    const legend = chart?.legend;
    if (!legend?.legendHitBoxes?.length || !legend.legendItems?.length) return false;

    let x;
    let y;
    if (typeof Chart !== 'undefined' && Chart.helpers?.getRelativePosition) {
        const pos = Chart.helpers.getRelativePosition(e, chart);
        x = pos.x;
        y = pos.y;
    } else {
        const rect = chart.canvas.getBoundingClientRect();
        const scaleX = chart.width / (rect.width || 1);
        const scaleY = chart.height / (rect.height || 1);
        x = (e.clientX - rect.left) * scaleX;
        y = (e.clientY - rect.top) * scaleY;
    }

    const pad = 6;
    const hitIndex = legend.legendHitBoxes.findIndex((box) =>
        x >= box.left - pad &&
        x <= box.left + box.width + pad &&
        y >= box.top - pad &&
        y <= box.top + box.height + pad
    );
    if (hitIndex < 0) return false;

    const item = legend.legendItems[hitIndex];
    if (chart._diariTagBreakdown && item.datasetIndex != null) {
        moodByTagLegendToggle(chart, item.datasetIndex);
        return true;
    }

    const onClick = legend.options?.onClick;
    if (typeof onClick === 'function') {
        onClick(e, item, legend);
    } else if (item.datasetIndex != null) {
        chart.setDatasetVisibility(item.datasetIndex, !chart.isDatasetVisible(item.datasetIndex));
        chart.update();
    }
    return true;
}

/** Emotion-by-Tag: legend toggle + mobile bar tooltips (no capture wrapper — it blocked legend). */
function bindMoodByTagChartInteractions(chart) {
    if (!chart?.canvas) return;
    const canvas = chart.canvas;
    if (canvas.dataset.diariMoodByTagBound === '1') return;
    canvas.dataset.diariMoodByTagBound = '1';

    const handlePointer = (e) => {
        if (insightsTryHandleChartLegendClick(chart, e)) return;
        if (!insightsIsMobileChartUi()) return;
        let elements = [];
        try {
            elements = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, true) || [];
        } catch (_) {
            elements = [];
        }
        insightsBarChartOnClick(chart, elements);
    };

    canvas.addEventListener('click', handlePointer);
    canvas.addEventListener(
        'touchend',
        (e) => {
            const touch = e.changedTouches?.[0];
            if (!touch) return;
            handlePointer({
                clientX: touch.clientX,
                clientY: touch.clientY,
                target: canvas,
                preventDefault: () => {},
                stopPropagation: () => {},
            });
        },
        { passive: true }
    );
}

/** Mobile: tap same bar again to dismiss; tap chart container padding to dismiss. */
function insightsBarChartOnClick(chart, elements) {
    if (!chart || !insightsIsMobileChartUi()) return;
    if (!elements?.length) {
        insightsDismissChartTooltip(chart);
        return;
    }
    const idx = elements[0].index;
    const activeIdx = insightsChartActiveTipIndex(chart);
    if (activeIdx === idx || chart._diariTipIdx === idx) {
        insightsDismissChartTooltip(chart);
        return;
    }
    chart._diariTipIdx = idx;
    if (typeof chart.setActiveElements === 'function') chart.setActiveElements(elements);
    if (chart.tooltip) {
        if (typeof chart.tooltip.setActiveElements === 'function') {
            chart.tooltip.setActiveElements(elements, { x: 0, y: 0 });
        }
        chart.tooltip.opacity = 1;
    }
    chart.update('none');
}

function bindInsightsMobileChartTapToggle(chart) {
    if (!chart?.canvas || !insightsIsMobileChartUi()) return;
    const wrap = chart.canvas.closest('.chart-container');
    if (!wrap || wrap.dataset.diariInsightsTap === '1') return;
    wrap.dataset.diariInsightsTap = '1';

    const handleTap = (e) => {
        if (!insightsIsMobileChartUi()) return;
        if (insightsTryHandleChartLegendClick(chart, e)) return;
        e.preventDefault();
        e.stopPropagation();
        let elements = [];
        try {
            elements = chart.getElementsAtEventForMode(e, 'index', { intersect: false }, true) || [];
        } catch (_) {
            elements = [];
        }
        insightsBarChartOnClick(chart, elements);
    };

    wrap.addEventListener('click', handleTap, true);
}

function hexToRgba(hex, alpha) {
    const safe = String(hex || '').trim().replace('#', '');
    if (safe.length !== 6) return `rgba(111, 143, 127, ${alpha})`;
    const r = Number.parseInt(safe.slice(0, 2), 16);
    const g = Number.parseInt(safe.slice(2, 4), 16);
    const b = Number.parseInt(safe.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getMoodColorsFromCss() {
    const moodColorFromCss = (name, fallback) => {
        const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    };
    return {
        happy: moodColorFromCss('--mood-happy', '#E3A263'),
        sad: moodColorFromCss('--mood-sad', '#6FA6C9'),
        angry: moodColorFromCss('--mood-angry', '#D97B7B'),
        anxious: moodColorFromCss('--mood-anxious', '#B59AD9'),
        neutral: moodColorFromCss('--mood-neutral', '#9AA9A1'),
    };
}

function moodColorForKey(moodKey, moodColors) {
    const key = String(moodKey || '').toLowerCase();
    return moodColors[key] || moodColors.neutral;
}

function buildWeeklyMoodLineDataset(weekly, chartTheme, moodColors, pointSize) {
    const hasData = weekly.data.some((v) => v !== null && v !== undefined);
    const radius = pointSize.radius ?? 6;
    const hoverRadius = pointSize.hoverRadius ?? 8;
    return {
        label: 'Emotion Score',
        data: weekly.data,
        borderColor: chartTheme.primary,
        backgroundColor: chartTheme.primarySoft,
        borderWidth: 3,
        fill: true,
        tension: 0.35,
        spanGaps: false,
        pointBackgroundColor: (context) => {
            const i = context.dataIndex;
            if (weekly.data[i] == null) return 'transparent';
            const mood = weekly.dominantMoods[i];
            return mood ? moodColorForKey(mood, moodColors) : chartTheme.border;
        },
        pointBorderColor: (context) => {
            const i = context.dataIndex;
            if (weekly.data[i] == null) return 'transparent';
            const mood = weekly.dominantMoods[i];
            return mood ? moodColorForKey(mood, moodColors) : chartTheme.primary;
        },
        pointBorderWidth: 2,
        pointRadius: (context) => (weekly.data[context.dataIndex] != null && hasData ? radius : 0),
        pointHoverRadius: (context) => (weekly.data[context.dataIndex] != null && hasData ? hoverRadius : 0),
    };
}

function getChartTheme() {
    const styles = window.getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--primary-color').trim() || '#6F8F7F';
    const isDarkMode = document.documentElement.classList.contains('theme-dark');
    if (isDarkMode) {
        return {
            primary,
            primarySoft: hexToRgba(primary, 0.22),
            tick: '#b7c7cd',
            grid: 'rgba(66, 84, 92, 0.55)',
            tooltipBg: 'rgba(16, 24, 29, 0.95)',
            border: '#182126',
            pieFallback: '#4e5e64',
        };
    }
    return {
        primary,
        primarySoft: hexToRgba(primary, 0.1),
        tick: '#6B7C74',
        grid: '#E0E6E3',
        tooltipBg: 'rgba(47, 62, 54, 0.9)',
        border: '#ffffff',
        pieFallback: '#B7C2BC',
    };
}

function renderTagBasedSummaryCard(summary) {
    const esc = (t) =>
        String(t)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    const topStress = summary.topStressTrigger || 'Not enough data yet';
    const topHappy = summary.topHappinessTrigger || 'Not enough data yet';
    const stressDesc = summary.stressDescription || 'Add more tagged stress-related entries to unlock your stress trigger insight.';
    const happyDesc = summary.happinessDescription || 'Add more tagged happy entries to unlock your positive trigger insight.';
    const stressJustification = summary.stressJustification || '';
    const happyJustification = summary.happinessJustification || '';
    return `
        <div class="emotion-triggers-stack">
            <article class="emotion-trigger-block emotion-trigger-block--stress" aria-labelledby="stressTriggerTitle">
                <div class="emotion-trigger-block__top">
                    <span class="emotion-trigger-block__emoji" aria-hidden="true">😰</span>
                    <div class="emotion-trigger-block__intro">
                        <p class="emotion-trigger-block__eyebrow" id="stressTriggerTitle">Top stress trigger</p>
                        <p class="emotion-trigger-block__accent">${esc(topStress)}</p>
                    </div>
                </div>
                <p class="emotion-trigger-block__desc">${esc(stressDesc)}</p>
                ${stressJustification ? `
                    <details class="trigger-justification emotion-trigger-block__details">
                        <summary>Why this is the top stress trigger</summary>
                        <p>${esc(stressJustification)}</p>
                    </details>
                ` : ``}
            </article>
            <article class="emotion-trigger-block emotion-trigger-block--happiness" aria-labelledby="happyTriggerTitle">
                <div class="emotion-trigger-block__top">
                    <span class="emotion-trigger-block__emoji" aria-hidden="true">😊</span>
                    <div class="emotion-trigger-block__intro">
                        <p class="emotion-trigger-block__eyebrow" id="happyTriggerTitle">Top happiness trigger</p>
                        <p class="emotion-trigger-block__accent">${esc(topHappy)}</p>
                    </div>
                </div>
                <p class="emotion-trigger-block__desc">${esc(happyDesc)}</p>
                ${happyJustification ? `
                    <details class="trigger-justification emotion-trigger-block__details">
                        <summary>Why this is the top happiness trigger</summary>
                        <p>${esc(happyJustification)}</p>
                    </details>
                ` : ``}
            </article>
        </div>`;
}

async function loadEmotionTriggersDashboard() {
    const el = document.getElementById('emotionTriggersDashboard');
    if (!el) return;

    const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    const userId = Number(user?.id || 0);
    if (!userId) {
        el.innerHTML =
            '<p class="emotion-triggers-empty">Log in and save entries with tags to see your trigger summary here.</p>';
        return;
    }

    if (window.DiariOffline && !window.DiariOffline.isOnline()) {
        el.innerHTML =
            '<p class="emotion-triggers-empty">You are offline. Trigger patterns will refresh when you reconnect.</p>';
        return;
    }

    el.innerHTML =
        '<p class="emotion-triggers-loading" role="status">Loading trigger patterns…</p>';

    try {
        const summaryRes = await fetch(`/api/triggers/summary?userId=${encodeURIComponent(String(userId))}`);
        const summaryJson = await summaryRes.json();
        if (!summaryRes.ok || !summaryJson.success) {
            throw new Error(summaryJson.error || 'Could not load tag trigger summary.');
        }

        const hasAnySignal = Boolean(summaryJson.topStressTrigger || summaryJson.topHappinessTrigger);
        if (!hasAnySignal) {
            el.innerHTML =
                '<p class="emotion-triggers-empty">No strong trigger pattern yet. Add tags when writing entries, then save at least 3 stress-related and 3 happy entries.</p>';
            return;
        }
        el.innerHTML = `<div class="emotion-triggers-list">${renderTagBasedSummaryCard(summaryJson)}</div>`;
    } catch (err) {
        console.error('emotion triggers dashboard:', err);
        el.innerHTML =
            '<p class="emotion-triggers-empty">Could not load trigger patterns. Please refresh or try again later.</p>';
    }
}

function refreshInsightsFromSyncedStorage() {
    INSIGHTS_ENTRIES = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]').filter((e) => e && e.date);
    HAS_INSIGHTS_DATA = INSIGHTS_ENTRIES.length > 0;
    applyInsightsEmptyState();
    initializeWeeklyMoodChart();
    initializeWeeklyMoodChartDesktop();
    initializeEmotionPieChart();
    initializeEmotionPieChartMobile();
    initializeMoodByTagChart();
    loadInsightsData();
    void loadEmotionTriggersDashboard();
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
    if (typeof window.DiariOffline?.registerPageRefreshHandler === 'function') {
        window.DiariOffline.registerPageRefreshHandler(refreshInsightsFromSyncedStorage);
    }
    if (window.DiariOffline?.awaitServerState) {
        await window.DiariOffline.awaitServerState();
    } else {
    await syncInsightsEntriesFromApi();
    }
    if (window.DiariShell && typeof window.DiariShell.release === 'function') {
        window.DiariShell.release();
    }
    INSIGHTS_ENTRIES = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]').filter((e) => e && e.date);
    HAS_INSIGHTS_DATA = INSIGHTS_ENTRIES.length > 0;
    applyInsightsEmptyState();
    // Initialize Charts
    initializeWeeklyMoodChart();
    initializeWeeklyMoodChartDesktop();
    initializeEmotionPieChart();
    initializeEmotionPieChartMobile();
    initializeMoodByTagChart();
    
    // Load Data
    loadInsightsData();
    
    await loadEmotionTriggersDashboard();

    initializeInsightsHeroTabs();

    window.addEventListener('diari-palette-changed', function () {
        initializeWeeklyMoodChart();
        initializeWeeklyMoodChartDesktop();
    });

    if (window.DiariChartFlow) DiariChartFlow.decorateChartContainers(document);

    window.addEventListener('diari-remote-state-refreshed', refreshInsightsFromSyncedStorage);
    if (window.DiariOffline?.wirePwaPageAutoSync) {
        window.DiariOffline.wirePwaPageAutoSync(refreshInsightsFromSyncedStorage);
    }
    } finally {
        if (window.DiariShell && typeof window.DiariShell.release === 'function') {
            window.DiariShell.release();
        }
    }
});

async function syncInsightsEntriesFromApi() {
    if (window.DiariOffline?.syncEntriesFromApi) {
        await window.DiariOffline.syncEntriesFromApi();
        return;
    }
}

function resolveDetectedMood(entry) {
    const raw = (entry?.emotionLabel || entry?.feeling || '').toLowerCase();
    const allowed = new Set(['happy', 'sad', 'angry', 'anxious', 'neutral']);
    if (allowed.has(raw)) return raw;
    // fall back to the older heuristic mapping if needed
    const resolved = resolveEntryFeeling(entry);
    if (allowed.has(resolved)) return resolved;
    return 'neutral';
}

function titleCaseWord(value) {
    const s = String(value || '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : '';
}

/** Monday 00:00 local for the calendar week (Mon–Sun) containing `ref`. Matches dashboard weekly glance. */
function mondayStartOfLocalWeek(ref = new Date()) {
    const t = new Date(ref);
    t.setHours(0, 0, 0, 0);
    const dow = t.getDay();
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(t);
    monday.setDate(t.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

const MS_PER_DAY = 86400000;

/**
 * Mon–Sun calendar week: per-day average emotion, dominant emotion, entry counts.
 * Richer than the dashboard sparkline; same week boundaries as the dashboard strip.
 */
function insightsCalendarWeekSeries() {
    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const monday = mondayStartOfLocalWeek();
    const dayLabelForTooltip = [];
    for (let i = 0; i < 7; i += 1) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dayLabelForTooltip.push(
            d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
        );
    }
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const rangeCaption = `${monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${sunday.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    const dayBuckets = Array.from({ length: 7 }, () => []);
    if (HAS_INSIGHTS_DATA) {
    INSIGHTS_ENTRIES.forEach((entry) => {
            if (!entry?.date) return;
        const d = new Date(entry.date);
            d.setHours(0, 0, 0, 0);
            const idx = Math.round((d.getTime() - monday.getTime()) / MS_PER_DAY);
            if (idx < 0 || idx > 6) return;
            dayBuckets[idx].push(entry);
        });
    }

    const emotionTags = [];
    const dominantMoods = [];
    const data = dayBuckets.map((dayEntries) => {
        if (!dayEntries.length) {
            emotionTags.push('No entries');
            dominantMoods.push(null);
            return null;
        }
        const scores = dayEntries.map((e) => entryMoodScore10(e));
        const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
        const emotionCount = {};
        dayEntries.forEach((e) => {
            const mood = resolveDetectedMood(e);
            emotionCount[mood] = (emotionCount[mood] || 0) + 1;
        });
        const topMood =
            Object.keys(emotionCount).sort((a, b) => emotionCount[b] - emotionCount[a] || a.localeCompare(b))[0] ||
            'neutral';
        emotionTags.push(titleCaseWord(topMood));
        dominantMoods.push(topMood);
        return avg;
    });
    const entryCounts = dayBuckets.map((b) => b.length);

    return {
        labels,
        data,
        emotionTags,
        dominantMoods,
        entryCounts,
        dayLabelForTooltip,
        rangeCaption,
        monday,
    };
}

function weeklyHighlightDayIndex(weekly) {
    const { monday, data } = weekly;
    if (!monday || !Array.isArray(data)) return -1;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const idx = Math.round((today.getTime() - monday.getTime()) / MS_PER_DAY);
    if (idx >= 0 && idx <= 6 && data[idx] != null) return idx;
    for (let i = 6; i >= 0; i -= 1) {
        if (data[i] != null) return i;
    }
    return -1;
}

function localDayStartMs(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return NaN;
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Distinct calendar days with at least one entry (local midnight keys). */
function buildEntryDaySet(entries) {
    const set = new Set();
    entries.forEach((e) => {
        const raw = e?.date || e?.createdAt;
        if (!raw) return;
        const ms = localDayStartMs(raw);
        if (!Number.isNaN(ms)) set.add(ms);
    });
    return set;
}

/**
 * Rolling six Mon–Sun ISO weeks (same logic as the former bar chart); used only for the “Entries / week” KPI.
 */
function sumSixIsoWeekEntryCounts() {
    const entries = INSIGHTS_ENTRIES.filter((e) => e && (e.date || e.createdAt));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const thisMonday = mondayStartOfLocalWeek(today);
    const weekCounts = [];
    for (let w = 0; w < 6; w += 1) {
        const weekStart = new Date(thisMonday);
        weekStart.setDate(thisMonday.getDate() - (5 - w) * 7);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 7);
        let cnt = 0;
        entries.forEach((e) => {
            const raw = e.date || e.createdAt;
            const dm = localDayStartMs(raw);
            if (Number.isNaN(dm)) return;
            if (dm >= weekStart.getTime() && dm < weekEnd.getTime()) cnt += 1;
        });
        weekCounts.push(cnt);
    }
    return weekCounts;
}

/**
 * Consistency tab KPIs (chart uses selected month via `getConsistencyChartSegmentMeta`).
 */
function computeConsistencyInsightBundle() {
    const entries = INSIGHTS_ENTRIES.filter((e) => e && (e.date || e.createdAt));
    const entryDays = buildEntryDaySet(entries);
    const totalActiveDays = entryDays.size;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let activeInLast30 = 0;
    for (let i = 0; i < 30; i += 1) {
        const d = new Date(today);
        d.setDate(today.getDate() - i);
        d.setHours(0, 0, 0, 0);
        if (entryDays.has(d.getTime())) activeInLast30 += 1;
    }
    const consistencyRate = Math.round((activeInLast30 / 30) * 100);

    const isoWeeks = sumSixIsoWeekEntryCounts();
    const entriesPerWeek = Math.round((isoWeeks.reduce((a, b) => a + b, 0) / 6) * 10) / 10;

    const MAT = globalThis.DiariMostActiveTime;
    const peakHour = MAT && typeof MAT.computeMostActiveHour24FromEntries === 'function'
        ? MAT.computeMostActiveHour24FromEntries(entries)
        : null;
    let mostActiveTimeLabel = '—';
    if (peakHour != null && MAT && typeof MAT.formatHourClockInManila === 'function') {
        mostActiveTimeLabel = MAT.formatHourClockInManila(peakHour);
    }

    return {
        totalActiveDays,
        consistencyRate,
        entriesPerWeek,
        mostActiveTimeLabel,
    };
}

function parseYearMonthKey(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || '').trim());
    if (!m) return null;
    const y = Number(m[1]);
    const m0 = Number(m[2]) - 1;
    if (!Number.isFinite(y) || m0 < 0 || m0 > 11) return null;
    return { y, m0 };
}

/** W1–W4 = calendar day ranges within that month (22–end captures 8–11 days in long months). */
function computeFourSegmentsForMonth(ymKey) {
    const p = parseYearMonthKey(ymKey);
    if (!p) {
        return {
            labels: ['W1', 'W2', 'W3', 'W4'],
            counts: [0, 0, 0, 0],
            ranges: ['Days 1–7', 'Days 8–14', 'Days 15–21', 'Days 22–28'],
            monthLabel: '',
            y: 0,
            m0: 0,
            dim: 28,
        };
    }
    const { y, m0 } = p;
    const dim = new Date(y, m0 + 1, 0).getDate();
    const counts = [0, 0, 0, 0];
    const entries = INSIGHTS_ENTRIES.filter((e) => e && (e.date || e.createdAt));
    entries.forEach((e) => {
        const d = new Date(e.date || e.createdAt);
        if (Number.isNaN(d.getTime())) return;
        if (d.getFullYear() !== y || d.getMonth() !== m0) return;
        const dom = d.getDate();
        if (dom <= 7) counts[0] += 1;
        else if (dom <= 14) counts[1] += 1;
        else if (dom <= 21) counts[2] += 1;
        else if (dom <= dim) counts[3] += 1;
    });
    const ranges = ['Days 1–7', 'Days 8–14', 'Days 15–21', `Days 22–${dim}`];
    const monthLabel = new Date(y, m0, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    return {
        labels: ['W1', 'W2', 'W3', 'W4'],
        counts,
        ranges,
        monthLabel,
        y,
        m0,
        dim,
    };
}

function getConsistencyChartSegmentMeta() {
    const sel = document.getElementById('insightsConsistencyMonthSelect');
    return computeFourSegmentsForMonth(sel?.value || '');
}

function monthStartMs(ts) {
    const d = new Date(ts);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

/** Newest-first month keys from oldest entry month through current calendar month. */
function listMonthKeysNewestFirst() {
    const entries = INSIGHTS_ENTRIES.filter((e) => e && (e.date || e.createdAt));
    const now = new Date();
    let endMs = monthStartMs(now.getTime());
    let startMs = endMs;
    if (entries.length) {
        let minTs = Infinity;
        entries.forEach((e) => {
            const d = new Date(e.date || e.createdAt);
            if (!Number.isNaN(d.getTime())) minTs = Math.min(minTs, d.getTime());
        });
        if (Number.isFinite(minTs)) startMs = monthStartMs(minTs);
    }
    if (startMs > endMs) startMs = endMs;
    const keys = [];
    const cur = new Date(endMs);
    const stop = new Date(startMs);
    for (;;) {
        keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        if (cur.getFullYear() === stop.getFullYear() && cur.getMonth() === stop.getMonth()) break;
        cur.setMonth(cur.getMonth() - 1);
    }
    return keys;
}

function populateInsightsConsistencyMonthSelect(sel) {
    if (!sel) return;
    const keys = listMonthKeysNewestFirst();
    const keepValue = sel.value;
    sel.innerHTML = '';
    keys.forEach((k) => {
        const parsed = parseYearMonthKey(k);
        if (!parsed) return;
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = new Date(parsed.y, parsed.m0, 1).toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
        });
        sel.appendChild(opt);
    });
    let stored = '';
    try {
        stored = sessionStorage.getItem(CONSISTENCY_MONTH_STORAGE_KEY) || '';
    } catch (_) {
        stored = '';
    }
    if (stored && keys.includes(stored)) sel.value = stored;
    else if (keepValue && keys.includes(keepValue)) sel.value = keepValue;
    else if (keys[0]) sel.value = keys[0];
}

function destroyInsightsConsistencyChart() {
    if (INSIGHTS_CONSISTENCY_CHART) {
        if (window.DiariChartFlow) DiariChartFlow.stopChartFlow(INSIGHTS_CONSISTENCY_CHART);
        INSIGHTS_CONSISTENCY_CHART.destroy();
        INSIGHTS_CONSISTENCY_CHART = null;
    }
}

function updateConsistencyMonthBarChart() {
    const canvas = document.getElementById('insightsConsistencyWeekChart');
    const sel = document.getElementById('insightsConsistencyMonthSelect');
    const capEl = document.getElementById('insightsConsistencyChartCaption');
    if (!canvas || typeof Chart === 'undefined' || !sel || !sel.value) return;

    const meta = getConsistencyChartSegmentMeta();
    if (capEl) {
        capEl.textContent = meta.monthLabel
            ? `${meta.monthLabel}: W1 ${meta.ranges[0]}, W2 ${meta.ranges[1]}, W3 ${meta.ranges[2]}, W4 ${meta.ranges[3]} — your entry counts.`
            : 'Pick a month to see four calendar segments (W1–W4).';
    }

    const maxC = Math.max(...meta.counts, 0);
    const suggestedMax = maxC <= 0 ? 6 : Math.max(6, Math.ceil(maxC * 1.08));
    const chartTheme = getChartTheme();

    if (INSIGHTS_CONSISTENCY_CHART) {
        INSIGHTS_CONSISTENCY_CHART.data.labels = [...meta.labels];
        INSIGHTS_CONSISTENCY_CHART.data.datasets[0].data = [...meta.counts];
        INSIGHTS_CONSISTENCY_CHART.options.scales.y.suggestedMax = suggestedMax;
        INSIGHTS_CONSISTENCY_CHART.update();
        return;
    }

    INSIGHTS_CONSISTENCY_CHART = new Chart(canvas, {
        type: 'bar',
        data: {
            labels: [...meta.labels],
            datasets: [
                {
                    label: 'Entries',
                    data: [...meta.counts],
                    backgroundColor: chartTheme.primary,
                    borderColor: chartTheme.primary,
                    borderWidth: 1,
                    borderRadius: 8,
                    barThickness: 40,
                    maxBarThickness: 52,
                },
            ],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            layout: { padding: { top: 8, bottom: 4, left: 4, right: 4 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: chartTheme.tooltipBg,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    padding: 12,
                    cornerRadius: 8,
                    ...(insightsMobileTooltipPluginOpts().tooltip || {}),
                    callbacks: {
                        title(items) {
                            const m = getConsistencyChartSegmentMeta();
                            const i = items[0]?.dataIndex ?? 0;
                            const lab = m.labels[i] || 'W1';
                            const rng = m.ranges[i] || '';
                            return `${lab} (${rng})`;
                        },
                        label(ctx) {
                            const n = Number(ctx.parsed.y ?? 0);
                            return `${n} ${n === 1 ? 'entry' : 'entries'}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: chartTheme.tick,
                        font: { size: 12, weight: '600' },
                    },
                },
                y: {
                    beginAtZero: true,
                    suggestedMax,
                    grid: {
                        color: chartTheme.grid,
                        borderDash: [5, 5],
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: { size: 12, weight: '500' },
                        maxTicksLimit: 9,
                    },
                },
            },
            interaction: { intersect: false, mode: 'index' },
        },
    });
    bindInsightsChartFlow(INSIGHTS_CONSISTENCY_CHART);
    bindInsightsMobileChartTapToggle(INSIGHTS_CONSISTENCY_CHART);
}

function renderInsightsConsistencyPanel() {
    try {
        const bundle = computeConsistencyInsightBundle();
        const dEl = document.getElementById('insightsConsTotalDays');
        const rEl = document.getElementById('insightsConsRate');
        const wEl = document.getElementById('insightsConsEntriesWeek');
        const tEl = document.getElementById('insightsConsPeakTime');
        if (dEl) dEl.textContent = String(bundle.totalActiveDays);
        if (rEl) rEl.textContent = `${bundle.consistencyRate}%`;
        if (wEl) wEl.textContent = bundle.entriesPerWeek.toFixed(1);
        if (tEl) tEl.textContent = bundle.mostActiveTimeLabel;

        destroyInsightsConsistencyChart();

        const sel = document.getElementById('insightsConsistencyMonthSelect');
        populateInsightsConsistencyMonthSelect(sel);
        if (sel && !consistencyMonthSelectBound) {
            consistencyMonthSelectBound = true;
            sel.addEventListener('change', () => {
                try {
                    sessionStorage.setItem(CONSISTENCY_MONTH_STORAGE_KEY, sel.value);
                } catch (_) {
                    /* private mode */
                }
                updateConsistencyMonthBarChart();
            });
        }

        updateConsistencyMonthBarChart();
        requestAnimationFrame(() => {
            if (INSIGHTS_CONSISTENCY_CHART && typeof INSIGHTS_CONSISTENCY_CHART.resize === 'function') {
                INSIGHTS_CONSISTENCY_CHART.resize();
            }
        });
    } finally {
        document.documentElement.classList.remove('insights-consistency-await-data');
    }
}

function insightsHeroSetMode(mode) {
    const title = document.querySelector('.insights-hero__title');
    const sub = document.getElementById('insightsHeroSubtitle');
    if (title && !title.dataset.insightsDefaultTitle) {
        title.dataset.insightsDefaultTitle = title.textContent.trim();
    }
    if (sub && !sub.dataset.insightsDefaultSubtitle) {
        sub.dataset.insightsDefaultSubtitle = sub.textContent.trim();
    }
    if (mode === 'consistency') {
        if (title) title.textContent = 'Usage Insights';
        if (sub) sub.textContent = 'Your journaling habits and consistency.';
    } else {
        if (title) title.textContent = title.dataset.insightsDefaultTitle || 'Insights & Patterns';
        if (sub) sub.textContent = sub.dataset.insightsDefaultSubtitle || '';
    }
}

function insightsTabFromHash() {
    const h = String(window.location.hash || '')
        .replace(/^#/, '')
        .trim()
        .toLowerCase();
    return h === 'consistency' ? 'consistency' : 'emotions';
}

function replaceInsightsUrlForTab(which) {
    const base = `${window.location.pathname}${window.location.search}`;
    const want = which === 'consistency' ? `${base}#consistency` : base;
    const cur = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (cur !== want) history.replaceState(null, '', want);
}

function syncInsightsMobileTabFab(which) {
    const menu = document.getElementById('insightsMobileTabFabMenu');
    if (!menu) return;
    menu.querySelectorAll('[data-insights-mobile-tab]').forEach((btn) => {
        const on = btn.getAttribute('data-insights-mobile-tab') === which;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
}

function initializeInsightsMobileTabFab(activate) {
    const wrap = document.getElementById('insightsMobileTabFab');
    const trigger = document.getElementById('insightsMobileTabFabTrigger');
    const menu = document.getElementById('insightsMobileTabFabMenu');
    if (!wrap || !trigger || !menu || typeof activate !== 'function') return;

    const mq = window.matchMedia('(max-width: 768px)');

    const closeFab = () => {
        wrap.classList.remove('is-open');
        trigger.setAttribute('aria-expanded', 'false');
        menu.hidden = true;
    };

    const setFabVisible = () => {
        wrap.hidden = !mq.matches;
        if (!mq.matches) closeFab();
    };

    mq.addEventListener('change', setFabVisible);
    setFabVisible();

    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (wrap.classList.contains('is-open')) closeFab();
        else {
            wrap.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            menu.hidden = false;
        }
    });

    menu.querySelectorAll('[data-insights-mobile-tab]').forEach((btn) => {
        btn.addEventListener('click', () => {
            activate(btn.getAttribute('data-insights-mobile-tab'));
            closeFab();
        });
    });

    document.addEventListener('click', (e) => {
        if (!wrap.classList.contains('is-open')) return;
        if (!wrap.contains(e.target)) closeFab();
    });
}

function initializeInsightsHeroTabs() {
    const emotions = document.getElementById('insightsTabEmotions');
    const consistency = document.getElementById('insightsTabConsistency');
    const panelEmotions = document.getElementById('insightsPanelEmotions');
    const panelConsistency = document.getElementById('insightsPanelConsistency');
    if (!emotions || !consistency || !panelEmotions || !panelConsistency) {
        document.documentElement.classList.remove('insights-consistency-hash-boot', 'insights-consistency-await-data');
        return;
    }

    const activate = (which) => {
        const isCons = which === 'consistency';
        emotions.classList.toggle('is-active', !isCons);
        emotions.setAttribute('aria-selected', !isCons ? 'true' : 'false');
        consistency.classList.toggle('is-active', isCons);
        consistency.setAttribute('aria-selected', isCons ? 'true' : 'false');

        panelEmotions.classList.toggle('is-active', !isCons);
        panelEmotions.hidden = isCons;
        panelConsistency.classList.toggle('is-active', isCons);
        panelConsistency.hidden = !isCons;

        document.body.classList.toggle('insights-view-consistency', isCons);
        insightsHeroSetMode(isCons ? 'consistency' : 'emotions');
        syncInsightsMobileTabFab(which);

        if (isCons) {
            renderInsightsConsistencyPanel();
        } else {
            destroyInsightsConsistencyChart();
        }

        replaceInsightsUrlForTab(which);
        document.documentElement.classList.remove('insights-consistency-hash-boot', 'insights-consistency-await-data');
    };

    emotions.addEventListener('click', () => activate('emotions'));
    consistency.addEventListener('click', () => activate('consistency'));

    window.addEventListener('hashchange', () => {
        activate(insightsTabFromHash());
    });

    initializeInsightsMobileTabFab(activate);
    activate(insightsTabFromHash());
}

/** Pick 0..len-1 from calendar day + week (Monday) so copy shifts daily and when the week rolls over. */
function snapshotLedeTemplateIndex(len, weekly) {
    if (len <= 1) return 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    const epochDays = Math.floor(d.getTime() / 86400000);
    const mon = weekly?.monday;
    const weekEpoch =
        mon instanceof Date && !Number.isNaN(mon.getTime()) ? Math.floor(mon.getTime() / 86400000) : 0;
    const mix = epochDays * 31 + weekEpoch * 17 + (Array.isArray(weekly?.labels) ? weekly.labels.length * 3 : 21);
    return ((mix % len) + len) % len;
}

/**
 * Weekly snapshot ledes — same Mon–Sun `weekly` series as the chart; pool + day/week index keeps copy fresh.
 */
const WEEKLY_SNAPSHOT_LEDE_TEMPLATES = [
    (c) =>
        `This week, your average emotion is ${c.avg} / 10 with a ${c.trWord} trend between the first and second half of your logged days.`,
    (c) =>
        `From the days you journaled this week, emotion averaged ${c.avg} / 10 — a ${c.trWord} arc from earlier entries toward later ones.`,
    (c) =>
        `Your check-ins this week center around ${c.avg} / 10 overall, with a ${c.trWord} shift between the first half of logged days and the second.`,
    (c) =>
        `Across ${c.n} days with entries, daily emotion averages ${c.avg} / 10, reading ${c.trWord} through the span you captured.`,
    (c) =>
        `The emotions you logged this week sit near ${c.avg} / 10 on average, showing a ${c.trWord} tilt from earlier journal days to the ones that followed.`,
    (c) =>
        `So far this week, when you wrote, scores averaged ${c.avg} / 10 with a ${c.trWord} pattern between the first and second halves of what you recorded.`,
    (c) =>
        `Weekly emotion from your entries lands around ${c.avg} / 10, with a ${c.trWord} run across the days you journaled.`,
    (c) =>
        `Plotting the days you saved, the week averages ${c.avg} / 10 and carries a ${c.trWord} feel from earlier check-ins to later ones.`,
    (c) =>
        c.totalEntries > c.n
            ? `You left ${c.totalEntries} entries across ${c.n} calendar days; daily emotion averages ${c.avg} / 10 with a ${c.trWord} swing from the first batch of notes to the next.`
            : `Glancing at ${c.n} days with emotion data, the week settles near ${c.avg} / 10 and moves in a ${c.trWord} direction from earlier to later logs.`,
    (c) =>
        c.rangeCaption
            ? `Between ${c.rangeCaption}, your logged emotions average ${c.avg} / 10 — a ${c.trWord} story from the first half of those days to the second.`
            : `Your logged emotions average ${c.avg} / 10 this week — a ${c.trWord} story from the first half of those days to the second.`,
    (c) =>
        c.hasContrast
            ? `The week still centers near ${c.avg} / 10, with a ${c.trWord} pull across your notes — ${c.bestDay} peaked at ${c.bestScore}/10 while ${c.toughDay} landed softer at ${c.toughScore}/10.`
            : `The week centers near ${c.avg} / 10, with a ${c.trWord} pull across the ${c.n} days you chose to log.`,
    (c) =>
        c.hasContrast && parseFloat(c.spread) >= 1.5
            ? `There is about a ${c.spread}-point swing between your highest and lowest logged days, yet the week averages ${c.avg} / 10 overall, trending ${c.trWord} from earlier entries to later ones.`
            : `Emotion traces stay clustered enough to average ${c.avg} / 10, while the week still reads ${c.trWord} from first notes toward the last.`,
    (c) =>
        `Your line this week hovers near ${c.avg} / 10; the half-and-half read is ${c.trWord} — a different tone at the start of what you logged than by the time you closed the week.`,
    (c) =>
        c.hasContrast
            ? `${c.bestDay} felt like the emotional high note (${c.bestScore}/10) and ${c.toughDay} the low tide (${c.toughScore}/10); between them the week still averages ${c.avg} / 10 and trends ${c.trWord}.`
            : `Day by day, the thread averages ${c.avg} / 10 and trends ${c.trWord} across what you put on the page.`,
    (c) =>
        `Picture the week as ${c.n} stepping stones: together they average ${c.avg} / 10, and the stride between the first stones and the last feels ${c.trWord}.`,
    (c) =>
        `If we smooth every emotion you captured, we land on ${c.avg} / 10 — not flat, but ${c.trWord} as you move from the opening days you logged toward the finale.`,
];

const WEEKLY_SNAPSHOT_LEDE_SINGLE_DAY_TEMPLATES = [
    (c) =>
        `You logged emotion on one day this week (${c.avg} / 10). Add a few more dated entries to see how the rest of the week shapes up.`,
    (c) =>
        `Only one emotion check-in so far this week — ${c.avg} / 10. A fuller week of notes will make this summary richer.`,
    (c) =>
        `This week's journal shows a single emotion snapshot at ${c.avg} / 10; keep logging to trace the arc across more days.`,
    (c) =>
        c.totalEntries > 1
            ? `Several entries landed on the same day, averaging ${c.avg} / 10 — sprinkle emotions across more days so this card can stretch its legs.`
            : `One quiet dot on the calendar (${c.avg} / 10) — give the rest of the week a voice when you can.`,
    (c) =>
        c.rangeCaption
            ? `Across ${c.rangeCaption}, only one day carries an emotion score so far (${c.avg} / 10); the rest of the ribbon is still waiting for you.`
            : `Only one day carries an emotion score so far (${c.avg} / 10); the rest of the ribbon is still waiting for you.`,
];

function updateInsightsSnapshotFromWeekly(weekly) {
    const lede = document.getElementById('insightsMemoryLede');
    const bestVal = document.getElementById('insightHighlightBestValue');
    const toughVal = document.getElementById('insightHighlightToughValue');
    const data = weekly?.data || [];
    const labels = weekly?.labels || [];
    let bestI = -1;
    let toughI = -1;
    const validIdx = [];
    data.forEach((v, i) => {
        if (v !== null && v !== undefined && !Number.isNaN(Number(v))) validIdx.push(i);
    });
    if (validIdx.length) {
        let bestV = -Infinity;
        let toughV = Infinity;
        validIdx.forEach((i) => {
            const v = Number(data[i]);
            if (v > bestV) {
                bestV = v;
                bestI = i;
            }
            if (v < toughV) {
                toughV = v;
                toughI = i;
            }
        });
    }
    if (bestVal) bestVal.textContent = bestI >= 0 ? `${labels[bestI]} (${Number(data[bestI]).toFixed(1)})` : '—';
    if (toughVal) toughVal.textContent = toughI >= 0 ? `${labels[toughI]} (${Number(data[toughI]).toFixed(1)})` : '—';

    const vals = data.filter((v) => v !== null && v !== undefined).map(Number);
    const n = vals.length;
    if (lede) {
        if (!n) {
            lede.textContent = 'Save a few dated entries to see your weekly emotion snapshot here.';
        } else {
            const avgStr = (vals.reduce((a, b) => a + b, 0) / n).toFixed(1);
            const half = Math.max(1, Math.floor(n / 2));
            const first = vals.slice(0, half);
            const second = vals.slice(half);
            const firstAvg = first.reduce((a, b) => a + b, 0) / first.length;
            const secondAvg = second.length ? second.reduce((a, b) => a + b, 0) / second.length : firstAvg;
            const tr = secondAvg - firstAvg;
            const trWord = tr > 0.08 ? 'lifting' : tr < -0.08 ? 'softening' : 'steady';
            const ec = weekly?.entryCounts;
            const totalEntries = Array.isArray(ec) ? ec.reduce((s, x) => s + (Number(x) || 0), 0) : 0;
            const bestDay = bestI >= 0 ? labels[bestI] : '';
            const toughDay = toughI >= 0 ? labels[toughI] : '';
            const bestScore = bestI >= 0 ? Number(data[bestI]).toFixed(1) : '';
            const toughScore = toughI >= 0 ? Number(data[toughI]).toFixed(1) : '';
            const spreadNum = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
            const spreadStr = spreadNum.toFixed(1);
            const hasContrast = Boolean(bestDay && toughDay && bestI !== toughI);
            const rangeCaption = weekly?.rangeCaption ? String(weekly.rangeCaption).trim() : '';
            const ctx = {
                avg: avgStr,
                trWord,
                n,
                totalEntries,
                bestDay,
                toughDay,
                bestScore,
                toughScore,
                spread: spreadStr,
                hasContrast,
                rangeCaption,
            };

            if (n < 2) {
                const pool = WEEKLY_SNAPSHOT_LEDE_SINGLE_DAY_TEMPLATES;
                const idx = snapshotLedeTemplateIndex(pool.length, weekly);
                lede.textContent = pool[idx](ctx);
            } else {
                const pool = WEEKLY_SNAPSHOT_LEDE_TEMPLATES;
                const idx = snapshotLedeTemplateIndex(pool.length, weekly);
                lede.textContent = pool[idx](ctx);
            }
        }
    }
}

function emotionBreakdownData() {
    if (!HAS_INSIGHTS_DATA) {
        return { labels: ['No Data'], values: [1], percentages: { happy: 0, neutral: 0, sad: 0, anxious: 0, angry: 0 } };
    }
    const counts = { happy: 0, neutral: 0, sad: 0, anxious: 0, angry: 0 };
    INSIGHTS_ENTRIES.forEach((entry) => {
        const f = resolveDetectedMood(entry);
        if (Object.prototype.hasOwnProperty.call(counts, f)) counts[f] += 1;
        else counts.neutral += 1;
    });
    const total = INSIGHTS_ENTRIES.length || 1;
    const pct = (n) => (n / total) * 100;
    const oneDecimal = (v) => Math.round(v * 10) / 10;
    const ensureSumsTo100 = (arr) => {
        // Round to 0.1 and distribute remainder so labels sum to exactly 100.0
        const rounded = arr.map(oneDecimal);
        let sum = oneDecimal(rounded.reduce((a, b) => a + b, 0));
        let diff = oneDecimal(100 - sum);
        // Apply diff in 0.1 steps to the largest slices first
        const order = arr
            .map((v, idx) => ({ idx, v }))
            .sort((a, b) => b.v - a.v)
            .map((x) => x.idx);
        let guard = 0;
        while (Math.abs(diff) >= 0.1 && guard < 2000) {
            const step = diff > 0 ? 0.1 : -0.1;
            const idx = order[guard % order.length];
            rounded[idx] = oneDecimal(rounded[idx] + step);
            diff = oneDecimal(diff - step);
            guard += 1;
        }
        return rounded;
    };
    const rawPercents = [
        pct(counts.happy),
        pct(counts.sad),
        pct(counts.angry),
        pct(counts.anxious),
        pct(counts.neutral),
    ];
    const percents = ensureSumsTo100(rawPercents);
    return {
        labels: ['Happy', 'Sad', 'Angry', 'Anxious', 'Neutral'],
        values: [counts.happy, counts.sad, counts.angry, counts.anxious, counts.neutral],
        percentages: {
            happy: percents[0],
            sad: percents[1],
            angry: percents[2],
            anxious: percents[3],
            neutral: percents[4],
        }
    };
}

function applyInsightsEmptyState() {
    if (HAS_INSIGHTS_DATA) return;
    const moodHeader = document.getElementById('insightsHeroSubtitle');
    if (moodHeader) moodHeader.textContent = 'Insights will appear once you start journaling.';
}

// Initialize Weekly Emotion Chart (mobile — same Mon–Sun week + detail as desktop)
function initializeWeeklyMoodChart() {
    const ctx = document.getElementById('weeklyChart');
    if (!ctx) return;
    
    const chartTheme = getChartTheme();
    const moodColors = getMoodColorsFromCss();
    const weekly = insightsCalendarWeekSeries();
    const capEl = document.getElementById('weeklyTrendRangeCaption');
    if (capEl) {
        capEl.textContent = `This week (Mon–Sun) · ${weekly.rangeCaption}`;
    }
    const hasData = weekly.data.some((v) => v !== null && v !== undefined);

    const weeklyData = {
        labels: weekly.labels,
        datasets: [
            buildWeeklyMoodLineDataset(weekly, chartTheme, moodColors, { radius: 6, hoverRadius: 8 }),
        ],
    };
    
    const config = {
        type: 'line',
        data: weeklyData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    enabled: hasData,
                    backgroundColor: chartTheme.tooltipBg,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: (context) => {
                            const idx = context?.[0]?.dataIndex ?? 0;
                            return weekly.dayLabelForTooltip[idx] || '';
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const y = context.parsed.y;
                            if (y == null || Number.isNaN(Number(y))) {
                                return 'No entries this day';
                            }
                            const lines = [
                                `Average emotion: ${Number(y).toFixed(1)}/10`,
                                `Top emotion: ${weekly.emotionTags[idx] || '—'}`,
                            ];
                            const n = weekly.entryCounts[idx] || 0;
                            if (n) lines.push(`${n} journal ${n === 1 ? 'entry' : 'entries'}`);
                            return lines;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: {
                        display: false,
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 12,
                            weight: '500',
                        },
                    },
                },
                y: {
                    beginAtZero: true,
                    max: 10,
                    grid: {
                        color: chartTheme.grid,
                        borderDash: [5, 5],
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 12,
                            weight: '500',
                        },
                        stepSize: 1,
                        precision: 0,
                    },
                },
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        },
    };
    
    if (WEEKLY_MOBILE_CHART) {
        if (window.DiariChartFlow) DiariChartFlow.stopChartFlow(WEEKLY_MOBILE_CHART);
        WEEKLY_MOBILE_CHART.destroy();
    }
    WEEKLY_MOBILE_CHART = new Chart(ctx, config);
    bindInsightsChartFlow(WEEKLY_MOBILE_CHART, weekly, moodColors);
}

// Initialize Desktop Weekly Emotion Chart (Mon–Sun calendar week; richer than dashboard glance)
function initializeWeeklyMoodChartDesktop() {
    const ctx = document.getElementById('weeklyChartDesktop');
    if (!ctx) return;
    
    const capEl = document.getElementById('weeklyTrendRangeCaption');
    const chartTheme = getChartTheme();
    const moodColors = getMoodColorsFromCss();
    const weekly = insightsCalendarWeekSeries();
    if (capEl) {
        capEl.textContent = `This week (Mon–Sun) · ${weekly.rangeCaption}`;
    }

    const hasData = weekly.data.some((v) => v !== null && v !== undefined);
    const bestIdx = weekly.data.reduce(
        (best, v, i, arr) => (v != null && !Number.isNaN(Number(v)) && (best < 0 || Number(v) > Number(arr[best])) ? i : best),
        -1
    );

    const weeklyData = {
        labels: weekly.labels,
        datasets: [
            buildWeeklyMoodLineDataset(weekly, chartTheme, moodColors, { radius: 5, hoverRadius: 7 }),
        ],
    };

    const bestPointPlugin = {
        id: 'bestPointLabel',
        afterDatasetsDraw(chart) {
            if (bestIdx < 0) return;
            const point = chart.getDatasetMeta(0)?.data?.[bestIdx];
            const value = weekly.data[bestIdx];
            if (!point || value == null) return;
            const { ctx: c } = chart;
            c.save();
            c.fillStyle = '#f7efd9';
            c.strokeStyle = '#e3cfa6';
            c.lineWidth = 1;
            const label = `Best: ${Number(value).toFixed(1)}`;
            c.font = '600 11px Inter, sans-serif';
            const tw = c.measureText(label).width;
            const x = point.x - tw / 2 - 7;
            const y = point.y - 24;
            const w = tw + 14;
            const h = 18;
            c.beginPath();
            if (typeof c.roundRect === 'function') {
                c.roundRect(x, y, w, h, 6);
            } else {
                c.rect(x, y, w, h);
            }
            c.fill();
            c.stroke();
            c.fillStyle = '#8d6227';
            c.fillText(label, x + 7, y + 12);
            c.restore();
        },
    };
    
    const config = {
        type: 'line',
        data: weeklyData,
        plugins: [bestPointPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            plugins: {
                legend: {
                    display: false,
                },
                tooltip: {
                    enabled: hasData,
                    backgroundColor: chartTheme.tooltipBg,
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: chartTheme.primary,
                    borderWidth: 1,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        title: (context) => {
                            const idx = context?.[0]?.dataIndex ?? 0;
                            return weekly.dayLabelForTooltip[idx] || '';
                        },
                        label: (context) => {
                            const idx = context.dataIndex;
                            const y = context.parsed.y;
                            if (y == null || Number.isNaN(Number(y))) {
                                return 'No entries this day';
                            }
                            const lines = [
                                `Average emotion: ${Number(y).toFixed(1)}/10`,
                                `Top emotion: ${weekly.emotionTags[idx] || '—'}`,
                            ];
                            const n = weekly.entryCounts[idx] || 0;
                            if (n) lines.push(`${n} journal ${n === 1 ? 'entry' : 'entries'}`);
                            return lines;
                        },
                    },
                },
            },
            scales: {
                y: {
                    beginAtZero: true,
                    max: 10,
                    grid: {
                        color: 'rgba(130, 150, 140, 0.35)',
                        drawBorder: false,
                        borderDash: [5, 5],
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 12,
                        },
                        stepSize: 1,
                        precision: 0,
                    },
                },
                x: {
                    grid: {
                        display: false,
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 12,
                        },
                    },
                },
            },
            interaction: {
                intersect: false,
                mode: 'index',
            },
        },
    };

    if (WEEKLY_DESKTOP_CHART) {
        if (window.DiariChartFlow) DiariChartFlow.stopChartFlow(WEEKLY_DESKTOP_CHART);
        WEEKLY_DESKTOP_CHART.destroy();
    }
    WEEKLY_DESKTOP_CHART = new Chart(ctx, config);
    bindInsightsChartFlow(WEEKLY_DESKTOP_CHART, weekly, moodColors);

    const avgEl = document.getElementById('weeklyStatAvg');
    const trendEl = document.getElementById('weeklyStatTrend');
    const peakEl = document.getElementById('weeklyStatPeak');
    const valid = weekly.data.filter((v) => v !== null && v !== undefined).map(Number);
    const avg = valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
    const half = Math.max(1, Math.floor(valid.length / 2));
    const firstAvg = valid.length ? valid.slice(0, half).reduce((a, b) => a + b, 0) / half : 0;
    const second = valid.slice(half);
    const secondAvg = second.length ? second.reduce((a, b) => a + b, 0) / second.length : firstAvg;
    const trend = secondAvg - firstAvg;

    if (avgEl) avgEl.textContent = avg == null ? '--' : avg.toFixed(1);
    if (trendEl) {
        trendEl.textContent = valid.length ? `${trend > 0 ? '+' : ''}${trend.toFixed(1)}` : '--';
        trendEl.classList.remove('is-up', 'is-down');
        if (trend > 0.05) trendEl.classList.add('is-up');
        else if (trend < -0.05) trendEl.classList.add('is-down');
    }
    if (peakEl) peakEl.textContent = bestIdx >= 0 ? weekly.labels[bestIdx] : '--';

    updateInsightsSnapshotFromWeekly(weekly);
}

// Initialize Emotion Pie Chart
function initializeEmotionPieChart() {
    const ctx = document.getElementById('emotionPieChart');
    if (!ctx) return;
    
    const chartTheme = getChartTheme();
    const breakdown = emotionBreakdownData();
    const emotionData = {
        labels: HAS_INSIGHTS_DATA
            ? ['Happy (uplifted)', 'Sad (low)', 'Angry (frustrated)', 'Anxious (stressed)', 'Neutral (steady)']
            : ['No Data'],
        datasets: [{
            data: HAS_INSIGHTS_DATA ? breakdown.values : [1],
            backgroundColor: [
                HAS_INSIGHTS_DATA ? '#2A9D8F' : chartTheme.pieFallback, // happy
                '#457B9D', // sad
                '#E63946', // angry
                '#F4A261', // anxious
                '#9AA5B1', // neutral
            ],
            borderColor: chartTheme.border,
            borderWidth: 2
        }]
    };
    
    const config = {
        type: 'pie',
        data: emotionData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: HAS_INSIGHTS_DATA,
                    backgroundColor: chartTheme.tooltipBg,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    padding: 12,
                    cornerRadius: 8,
                    callbacks: {
                        label: function(context) {
                            const idx = context.dataIndex;
                            const name = String(context.label || '').trim();
                            const pMap = breakdown.percentages;
                            const order = ['happy', 'sad', 'angry', 'anxious', 'neutral'];
                            const key = order[idx] || 'neutral';
                            const pctValue = Number(pMap[key] ?? 0);
                            return `${name}: ${pctValue.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    };
    
    const emotionDesktopChart = new Chart(ctx, config);
    bindInsightsChartFlow(emotionDesktopChart);

    // Custom desktop legend (clearer than default legend + avoids icons inside chart)
    const legendEl = document.getElementById('emotionLegendDesktop');
    if (legendEl && HAS_INSIGHTS_DATA) {
        const p = breakdown.percentages;
        const items = [
            { key: 'happy', name: 'Happy', color: '#2A9D8F', pct: p.happy },
            { key: 'sad', name: 'Sad', color: '#457B9D', pct: p.sad },
            { key: 'angry', name: 'Angry', color: '#E63946', pct: p.angry },
            { key: 'anxious', name: 'Anxious', color: '#F4A261', pct: p.anxious },
            { key: 'neutral', name: 'Neutral', color: '#9AA5B1', pct: p.neutral },
        ];
        legendEl.innerHTML = items
            .map(
                (it) => `
                <div class="emotion-legend-compact" role="listitem">
                    <span class="emotion-legend-compact__dot" style="background:${it.color}" aria-hidden="true"></span>
                    <span class="emotion-legend-compact__line">
                        <span class="emotion-legend-compact__pct">${it.pct.toFixed(1)}%</span>
                        <span class="emotion-legend-compact__name">${it.name}</span>
                    </span>
                </div>
            `
            )
            .join('');
    } else if (legendEl) {
        legendEl.innerHTML = '';
    }
}

// Initialize Mobile Emotion Pie Chart
function initializeEmotionPieChartMobile() {
    const ctx = document.getElementById('emotionPieChartMobile');
    if (!ctx) return;
    
    const chartTheme = getChartTheme();
    const breakdown = emotionBreakdownData();
    const emotionData = {
        labels: HAS_INSIGHTS_DATA ? ['Happy', 'Sad', 'Angry', 'Anxious', 'Neutral'] : ['No Data'],
        datasets: [{
            data: HAS_INSIGHTS_DATA ? breakdown.values : [1],
            backgroundColor: [
                HAS_INSIGHTS_DATA ? '#2A9D8F' : chartTheme.pieFallback, // happy
                '#457B9D', // sad
                '#E63946', // angry
                '#F4A261', // anxious
                '#9AA5B1', // neutral
            ],
            borderColor: chartTheme.border,
            borderWidth: 2
        }]
    };
    
    const config = {
        type: 'pie',
        data: emotionData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    enabled: HAS_INSIGHTS_DATA,
                    callbacks: {
                        label: function(context) {
                            const name = String(context.label || '').trim();
                            const idx = context.dataIndex;
                            const pMap = breakdown.percentages;
                            const order = ['happy', 'sad', 'angry', 'anxious', 'neutral'];
                            const key = order[idx] || 'neutral';
                            const pctValue = Number(pMap[key] ?? 0);
                            return `${name}: ${pctValue.toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    };
    
    const emotionMobileChart = new Chart(ctx, config);
    bindInsightsChartFlow(emotionMobileChart);

    if (HAS_INSIGHTS_DATA) {
        const legendItems = document.querySelectorAll('.emotion-legend-item');
        const p = breakdown.percentages;
        if (legendItems[0]) legendItems[0].querySelector('.emotion-legend-percentage').textContent = `${Number(p.happy ?? 0).toFixed(1)}%`;
        if (legendItems[1]) legendItems[1].querySelector('.emotion-legend-percentage').textContent = `${Number(p.sad ?? 0).toFixed(1)}%`;
        if (legendItems[2]) legendItems[2].querySelector('.emotion-legend-percentage').textContent = `${Number(p.angry ?? 0).toFixed(1)}%`;
        if (legendItems[3]) legendItems[3].querySelector('.emotion-legend-percentage').textContent = `${Number(p.anxious ?? 0).toFixed(1)}%`;
        if (legendItems[4]) legendItems[4].querySelector('.emotion-legend-percentage').textContent = `${Number(p.neutral ?? 0).toFixed(1)}%`;
    } else {
        document.querySelectorAll('.emotion-legend-percentage').forEach((el) => {
            el.textContent = '0.0%';
        });
    }
}

function normalizeTagValue(tag) {
    return String(tag || '').trim().replace(/\s+/g, ' ');
}

function buildTagMoodBreakdown() {
    const countsByTag = {};
    const totalsByTag = {};
    const moods = ['happy', 'sad', 'angry', 'anxious', 'neutral'];

    INSIGHTS_ENTRIES.forEach((entry) => {
        const tags = Array.isArray(entry?.tags) ? entry.tags : [];
        if (!tags.length) return;
        const mood = resolveDetectedMood(entry);

        tags.forEach((raw) => {
            const normalized = normalizeTagValue(raw);
            if (!normalized) return;
            const key = normalized.toLowerCase();

            if (!countsByTag[key]) {
                countsByTag[key] = { display: normalized, happy: 0, sad: 0, angry: 0, anxious: 0, neutral: 0 };
                totalsByTag[key] = 0;
            }

            countsByTag[key][mood] = (countsByTag[key][mood] || 0) + 1;
            totalsByTag[key] += 1;
        });
    });

    const rankedTagKeys = Object.keys(totalsByTag)
        .sort((a, b) => (totalsByTag[b] - totalsByTag[a]) || a.localeCompare(b))
        .slice(0, 7);

    const labels = rankedTagKeys.map((k) => countsByTag[k].display);
    const totals = rankedTagKeys.map((k) => totalsByTag[k] || 0);

    const pct = (tagKey, moodKey) => {
        const total = totalsByTag[tagKey] || 1;
        return Math.round(((countsByTag[tagKey][moodKey] || 0) / total) * 1000) / 10; // 0.1%
    };

    const datasets = moods.map((m) => ({
        mood: m,
        data: rankedTagKeys.map((k) => pct(k, m)),
    }));

    return { labels, rankedTagKeys, totals, countsByTag, datasets };
}

// Initialize Activity Impact Chart
function initializeMoodByTagChart() {
    const ctx = document.getElementById('activityImpactChart');
    if (!ctx) return;
    
    const chartTheme = getChartTheme();

    const moodColors = {
        happy: '#2A9D8F',
        sad: '#457B9D',
        angry: '#E63946',
        anxious: '#F4A261',
        neutral: '#9AA5B1',
    };

    const breakdown = HAS_INSIGHTS_DATA ? buildTagMoodBreakdown() : null;
    const labels = breakdown && breakdown.labels.length ? breakdown.labels : ['No Data'];

    const datasets = breakdown
        ? breakdown.datasets.map((d) => ({
            label: d.mood.charAt(0).toUpperCase() + d.mood.slice(1),
            data: d.data,
            backgroundColor: moodColors[d.mood],
            borderColor: moodColors[d.mood],
            borderWidth: 1,
            borderRadius: 6,
            barThickness: 26,
            maxBarThickness: 32,
            stack: 'moods',
        }))
        : [{
            label: 'No Data',
            data: [0],
            backgroundColor: chartTheme.pieFallback,
            borderColor: chartTheme.pieFallback,
            borderWidth: 1,
            borderRadius: 6,
            barThickness: 26,
            maxBarThickness: 32,
            stack: 'moods',
        }];
    
    const config = {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: chartFlowLoadAnimation(),
            layout: {
                // Inset chart + legend from canvas edge so the top legend (Happy…) clears the Y-axis “100%”.
                padding: { top: 6, bottom: 2, left: 28, right: 10 },
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    onClick(e, legendItem, legend) {
                        const idx = legendItem.datasetIndex;
                        if (idx == null) return;
                        moodByTagLegendToggle(legend.chart, idx);
                    },
                    labels: {
                        color: chartTheme.tick,
                        font: { size: 11, weight: '600' },
                        padding: 12,
                        boxWidth: 12,
                        boxHeight: 12,
                        usePointStyle: true,
                        pointStyle: 'rectRounded',
                        // Chart.js label `padding` is mostly vertical between rows; pad text for horizontal gaps.
                        generateLabels(chart) {
                            const datasets = chart.data.datasets || [];
                            const gap = '\u2002\u2002'; // modest space between mood labels
                            return datasets.map((dataset, i) => ({
                                text: `${dataset.label || ''}${i < datasets.length - 1 ? gap : ''}`,
                                fillStyle: Array.isArray(dataset.backgroundColor)
                                    ? dataset.backgroundColor[0]
                                    : dataset.backgroundColor,
                                strokeStyle: Array.isArray(dataset.borderColor)
                                    ? dataset.borderColor[0]
                                    : dataset.borderColor,
                                lineWidth: 0,
                                hidden: !chart.isDatasetVisible(i),
                                datasetIndex: i,
                                fontColor: chartTheme.tick,
                                pointStyle: 'rectRounded',
                            }));
                        },
                    },
                },
                tooltip: {
                    enabled: HAS_INSIGHTS_DATA,
                    backgroundColor: chartTheme.tooltipBg,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: true,
                    ...(insightsMobileTooltipPluginOpts().tooltip || {}),
                    callbacks: {
                        label: function(context) {
                            const mood = String(context.dataset.label || '');
                            const pctValue = Number(context.parsed.y || 0);
                            return `${mood}: ${pctValue.toFixed(1)}%`;
                        },
                        afterBody: function(context) {
                            if (!breakdown) return '';
                            const idx = context?.[0]?.dataIndex ?? -1;
                            const tagKey = breakdown.rankedTagKeys?.[idx];
                            if (!tagKey) return '';
                            const total = breakdown.totals?.[idx] ?? 0;
                            return `Based on ${total} tagged entries`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    stacked: true,
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 11,
                            weight: '500'
                        },
                        maxRotation: 40,
                        minRotation: 0,
                        autoSkip: true,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            return String(label || '');
                        }
                    }
                },
                y: {
                    beginAtZero: true,
                    max: 100,
                    stacked: true,
                    grid: {
                        color: chartTheme.grid,
                        borderDash: [5, 5]
                    },
                    ticks: {
                        color: chartTheme.tick,
                        font: {
                            size: 12,
                            weight: '500'
                        },
                        callback: function(value) {
                            return value + '%';
                        }
                    }
                }
            },
            interaction: {
                intersect: false,
                mode: 'index'
            },
        }
    };
    
    if (MOOD_BY_TAG_CHART) {
        if (window.DiariChartFlow) DiariChartFlow.stopChartFlow(MOOD_BY_TAG_CHART);
        MOOD_BY_TAG_CHART.destroy();
        MOOD_BY_TAG_CHART = null;
    }
    MOOD_BY_TAG_CHART = new Chart(ctx, config);
    if (breakdown) MOOD_BY_TAG_CHART._diariTagBreakdown = breakdown;
    bindInsightsChartFlow(MOOD_BY_TAG_CHART);
    if (insightsIsMobileChartUi()) {
        bindMoodByTagChartInteractions(MOOD_BY_TAG_CHART);
    }
}

// Load Insights Data
function loadInsightsData() {
    // Simulate loading data
    setTimeout(() => {
        // Charts are already animated by Chart.js
    }, 500);
}

// Show Notification
function showNotification(message, type = 'info') {
    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
        window.DiariToast.show(message, type, 3000);
        return;
    }
    const existingNotification = document.querySelector('.notification');
    if (existingNotification) {
        existingNotification.remove();
    }
    
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    
    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';
    if (type === 'warning') icon = 'exclamation-triangle';
    
    notification.innerHTML = `
        <i class="bi bi-${icon}"></i>
        <span></span>
    `;
    if (window.DiariSecurity && window.DiariSecurity.setToastMessage) {
        window.DiariSecurity.setToastMessage(notification, message);
    } else {
        const span = notification.querySelector('span');
        if (span) span.textContent = String(message ?? '');
    }
    
    const toastBg =
        window.DiariToastColors && window.DiariToastColors.bg
            ? window.DiariToastColors.bg(type)
            : type === 'success'
              ? '#8da399'
              : type === 'error'
                ? '#E74C3C'
                : type === 'warning'
                  ? '#d9822b'
                  : '#7FA7BF';
    const toastFg =
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
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        background: ${toastBg};
        color: ${toastFg};
        font-family: 'Inter', sans-serif;
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 10);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}
