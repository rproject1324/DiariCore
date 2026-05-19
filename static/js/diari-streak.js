/**
 * Shared journal streak (dashboard, profile, desktop, mobile, PWA).
 * One entry per local calendar day counts. Missing a full day breaks the streak at midnight:
 * no multi-day grace — if you did not write yesterday, streak is 0 today.
 * While today is still open, yesterday's entry keeps the streak until tonight's midnight.
 */
(function (global) {
    'use strict';

    const MS_PER_DAY = 86400000;

    function startOfLocalDayMsFromEntry(raw) {
        if (typeof raw !== 'string' && typeof raw !== 'number' && !(raw instanceof Date)) return null;
        let dt;
        const s = String(raw).trim();
        if (!s) return null;
        const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
        if (dateOnly) {
            const y = parseInt(dateOnly[1], 10);
            const mo = parseInt(dateOnly[2], 10) - 1;
            const d = parseInt(dateOnly[3], 10);
            dt = new Date(y, mo, d, 12, 0, 0, 0);
        } else {
            const normalized = s.includes('T') ? s : s.replace(' ', 'T');
            const naiveDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?$/.test(normalized);
            const tail = normalized.includes('T') ? normalized.slice(normalized.indexOf('T') + 1) : '';
            const hasTz = /[zZ]$/.test(normalized) || /[+-][0-9]{2}/.test(tail);
            if (naiveDateTime && !hasTz) {
                dt = new Date(`${normalized}Z`);
            } else {
                dt = new Date(normalized);
            }
        }
        if (!dt || Number.isNaN(dt.getTime())) return null;
        const local = new Date(dt);
        local.setHours(0, 0, 0, 0);
        return local.getTime();
    }

    /**
     * @param {Array} entries
     * @returns {{ streak: number, streakDayMs: Set<number>, hasEntryToday: boolean }}
     */
    function computeEntryStreak(entries) {
        const empty = { streak: 0, streakDayMs: new Set(), hasEntryToday: false };
        if (!Array.isArray(entries) || entries.length === 0) return empty;

        const daySet = new Set();
        entries.forEach((e) => {
            if (!e) return;
            const raw = e.date || e.createdAt;
            if (!raw) return;
            const ms = startOfLocalDayMsFromEntry(raw);
            if (ms != null) daySet.add(ms);
        });
        if (daySet.size === 0) return empty;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();
        const yesterdayMs = todayMs - MS_PER_DAY;
        const hasEntryToday = daySet.has(todayMs);
        const hasEntryYesterday = daySet.has(yesterdayMs);

        let anchorMs;
        if (hasEntryToday) {
            anchorMs = todayMs;
        } else if (hasEntryYesterday) {
            anchorMs = yesterdayMs;
        } else {
            return empty;
        }

        const streakDayMs = new Set();
        let streak = 0;
        for (let i = 0; i < 400; i += 1) {
            const d = anchorMs - i * MS_PER_DAY;
            if (daySet.has(d)) {
                streak += 1;
                streakDayMs.add(d);
            } else break;
        }
        return { streak, streakDayMs, hasEntryToday };
    }

    function streakCount(entries) {
        return computeEntryStreak(entries).streak;
    }

    function streakPanelHintText(streak, hasEntryToday) {
        if (streak <= 0) return 'Journal today to start.';
        if (!hasEntryToday) return 'Log today before midnight to keep your streak.';
        if (streak === 1) return 'Log again tomorrow to extend it.';
        return "You're on a roll — keep it up.";
    }

    global.DiariStreak = {
        MS_PER_DAY,
        startOfLocalDayMsFromEntry,
        computeEntryStreak,
        streakCount,
        streakPanelHintText,
    };
})(typeof window !== 'undefined' ? window : globalThis);
