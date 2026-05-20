// DiariCore Dashboard JavaScript
const DAILY_PROMPTS = [
    "What's one thing you're grateful for today?",
    "How did your body feel when you woke up this morning?",
    "What emotion has been showing up the most lately?",
    "Is there something you've been avoiding thinking about?",
    "What would make today feel complete?",
    "Who made you feel seen this week?",
    "What's draining your energy right now?",
    "What are you looking forward to tomorrow?",
    "What's something small that brought you joy today?",
    "How kind have you been to yourself this week?",
    "What feeling are you carrying into today?",
    "What do you wish someone knew about how you're feeling?",
    "What does rest look like for you today?",
    "What are you holding on to that you could let go of?",
    "What made you proud of yourself recently?",
    "What boundary would help you feel safer today?",
];

/** Anchor labels from static/js/mood-scoring.js feelingToScore(). */
function hydrateMoodKeyAnchors() {
    const nodes = document.querySelectorAll('.mood-key-tile__anchor[data-mood]');
    if (!nodes.length || typeof window.feelingToScore !== 'function') return;
    nodes.forEach((el) => {
        const mood = el.getAttribute('data-mood');
        if (!mood) return;
        const v = window.feelingToScore(mood);
        if (!Number.isFinite(v)) return;
        const shown = Number.isInteger(v) ? String(v) : v.toFixed(1);
        el.textContent = `Anchor ${shown} / 10`;
    });
}

const WELLNESS_QUOTES = [
    { text: "You yourself, as much as anybody in the universe, deserve your love.", author: "Buddha" },
    { text: "Almost everything will work again if you unplug it for a few minutes, including you.", author: "Anne Lamott" },
    { text: "Feelings are just visitors, let them come and go.", author: "Mooji" },
    { text: "In the middle of difficulty lies opportunity.", author: "Albert Einstein" },
    { text: "What you resist, persists.", author: "Carl Jung" },
    { text: "You don't have to be positive all the time.", author: "Lori Deschene" },
    { text: "The present moment is the only moment available to us.", author: "Thich Nhat Hanh" },
    { text: "Owning our story and loving ourselves through that process is the bravest thing we'll ever do.", author: "Brené Brown" },
    { text: "Not all storms come to disrupt your life, some come to clear your path.", author: "Unknown" },
    { text: "Sometimes the most productive thing you can do is rest.", author: "Unknown" },
    { text: "Your emotions are valid. All of them.", author: "Unknown" },
    { text: "Healing is not linear.", author: "Unknown" },
    { text: "Be gentle with yourself, you are a child of the universe.", author: "Max Ehrmann" },
    { text: "You are allowed to be both a masterpiece and a work in progress.", author: "Sophia Bush" },
    { text: "The only way out is through.", author: "Robert Frost" },
    { text: "Peace is the result of retraining your mind.", author: "Wayne Dyer" },
    { text: "Self-care is not selfish.", author: "Audre Lorde" },
    { text: "Give yourself the same compassion you would give a good friend.", author: "Unknown" },
    { text: "It's okay to not be okay.", author: "Unknown" },
    { text: "Rest is not idleness.", author: "John Lubbock" },
];

const DASHBOARD_INSIGHT_POSITIVE = [
    "Your recent entries show a positive emotional trend. Keep the momentum going.",
    "You're carrying more steady energy lately. Keep doing what supports you.",
    "Your emotions have been leaning brighter this week. Great consistency.",
    "You seem to be in a healthier rhythm recently. Keep nurturing it.",
    "Your journal reflects stronger emotional balance right now. Nice progress.",
    "You are showing stronger emotional recovery lately. Keep building on it.",
    "Your latest pattern looks lighter and more hopeful. Nice direction.",
    "Your emotional signals have improved this week. Keep your supportive routines going.",
    "You are handling recent days with more balance. That's meaningful progress.",
    "Recent entries point to healthier emotional momentum. Stay consistent.",
];

const DASHBOARD_INSIGHT_MID = [
    "Your recent emotion looks fairly steady. A short reflection can keep you grounded.",
    "You're in a balanced range lately. Small positive habits can lift it further.",
    "Your entries show a mixed but stable pattern. Try one intentional check-in today.",
    "Your emotional trend is moderate right now. A quick mindful pause may help.",
    "You seem steady overall, with room to improve. One small win can shift the day.",
    "Your emotional tone is holding in the middle range. A brief reset could help raise it.",
    "You're fairly stable right now. One intentional action can improve today's tone.",
    "Recent logs suggest a neutral trend. A short gratitude note may help nudge upward.",
    "Your pattern is balanced but variable. A quick emotional check-in could help.",
    "You are maintaining a moderate baseline. Small routines can make it steadier.",
];

const DASHBOARD_INSIGHT_LOW = [
    "Your recent emotion looks lower than usual. Try a short reflective entry.",
    "You've had heavier emotional days lately. A gentle check-in might help.",
    "Your recent entries suggest added strain. Writing briefly may ease the load.",
    "Your emotional trend has dipped a bit. Try naming one feeling and one need today.",
    "Recent logs show tougher moments. A small grounding step could help right now.",
    "Your recent pattern looks emotionally heavy. Try one small self-support step today.",
    "You may be carrying extra stress this week. A brief pause and journal check-in can help.",
    "Recent entries reflect lower energy. Keep today light and focus on one manageable step.",
    "Your emotional trend is under pressure right now. Try a short breath-and-write reset.",
    "You're going through a tougher stretch. One gentle routine can help you stabilize.",
];

function refreshDashboardFromSyncedStorage() {
    initializeDashboardFromUserData();
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
    hydrateMoodKeyAnchors();
    if (typeof window.DiariOffline?.registerPageRefreshHandler === 'function') {
        window.DiariOffline.registerPageRefreshHandler(refreshDashboardFromSyncedStorage);
    }
    // Cache-first paint: render immediately, then refresh from server in background.
    refreshDashboardFromSyncedStorage();
    if (window.DiariShell && typeof window.DiariShell.release === 'function') {
        window.DiariShell.release();
    }
    initializeGreetingClock();
    initializeStreakBook();
    
    // Add smooth scrolling for navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // Only prevent default for hash links (same page navigation)
            if (href.startsWith('#')) {
                e.preventDefault();
            }
            
            // Remove active class from all nav items
            document.querySelectorAll('.nav-item').forEach(item => {
                item.classList.remove('active');
            });
            
            // Add active class to clicked nav item
            this.parentElement.classList.add('active');
        });
    });
    
    // Add click handlers for action buttons
    document.querySelectorAll('.action-btn').forEach(button => {
        button.addEventListener('click', function() {
            const buttonTitle = this.querySelector('.btn-title').textContent;
            console.log('Clicked:', buttonTitle);
            
            if (buttonTitle === 'Write Entry') {
                // Navigate to write entry page
                window.location.href = 'write-entry.html';
            } else if (buttonTitle === 'Voice Entry') {
                // Placeholder for voice entry functionality
                console.log('Voice entry functionality to be implemented');
                alert('Voice entry feature coming soon!');
            }
            
            // Add ripple effect
            const ripple = document.createElement('span');
            ripple.classList.add('ripple');
            this.appendChild(ripple);
            
            setTimeout(() => {
                ripple.remove();
            }, 600);
        });
    });
    
    // Add hover effects for stat cards
    document.querySelectorAll('.stat-card').forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(0)';
        });
    });

    window.addEventListener('diari-palette-changed', function () {
        const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        renderWeeklyChart(entries);
    });

    if (window.DiariChartFlow) DiariChartFlow.decorateChartContainers(document);

    window.addEventListener('diari-remote-state-refreshed', refreshDashboardFromSyncedStorage);
    if (window.DiariOffline?.wirePwaPageAutoSync) {
        window.DiariOffline.wirePwaPageAutoSync(refreshDashboardFromSyncedStorage);
    }
    setTimeout(() => {
        void (async () => {
            try {
                await syncEntriesFromApi();
                refreshDashboardFromSyncedStorage();
            } catch (error) {
                console.warn('Dashboard background sync failed:', error);
            }
        })();
    }, 0);
    } finally {
        if (window.DiariShell && typeof window.DiariShell.release === 'function') {
            window.DiariShell.release();
        }
    }
});

const MS_PER_DAY = 86400000;

/**
 * Parse entry `date` from API or localStorage. Plain `YYYY-MM-DD` is treated as a
 * local calendar day (not UTC midnight), so week columns match the user's timezone.
 */
function parseEntryDate(raw) {
    if (raw == null) return null;
    const s = String(raw).trim();
    if (!s) return null;
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (dateOnly) {
        const y = parseInt(dateOnly[1], 10);
        const mo = parseInt(dateOnly[2], 10) - 1;
        const d = parseInt(dateOnly[3], 10);
        return new Date(y, mo, d, 12, 0, 0, 0);
    }
    const normalized = s.includes('T') ? s : s.replace(' ', 'T');
    // API / DB legacy: naive `YYYY-MM-DDTHH:mm:ss` was UTC from the server; without Z, JS treats as local.
    const naiveDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,9})?$/.test(normalized);
    const tail = normalized.includes('T') ? normalized.slice(normalized.indexOf('T') + 1) : '';
    const hasTz = /[zZ]$/.test(normalized) || /[+-][0-9]{2}/.test(tail);
    if (naiveDateTime && !hasTz) {
        const parsedUtc = new Date(`${normalized}Z`);
        return Number.isNaN(parsedUtc.getTime()) ? null : parsedUtc;
    }
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Local midnight timestamp for the calendar day of this entry. */
function startOfLocalDayMsFromEntry(raw) {
    const dt = parseEntryDate(raw);
    if (!dt) return null;
    const local = new Date(dt);
    local.setHours(0, 0, 0, 0);
    return local.getTime();
}

/** Monday 00:00 local for the week (Mon–Sun) that contains `ref`. */
function mondayOfWeekContaining(ref = new Date()) {
    const t = new Date(ref);
    t.setHours(0, 0, 0, 0);
    const dow = t.getDay();
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(t);
    monday.setDate(t.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

/** 0–6 index within the week starting at `mondayMs`, or null if outside that week. */
function weekDayIndexSinceMonday(entryDateRaw, mondayMs) {
    const dayStartMs = startOfLocalDayMsFromEntry(entryDateRaw);
    if (dayStartMs == null) return null;
    const idx = Math.round((dayStartMs - mondayMs) / MS_PER_DAY);
    if (idx < 0 || idx > 6) return null;
    return idx;
}

/**
 * Mon–Sun calendar week (local): per-day mean emotion score, feelings list, and entry count.
 * Used by the Weekly Average stat card and the Weekly Emotion chart so numbers match.
 */
function aggregateCalendarWeekMood(entries) {
    const monday = mondayOfWeekContaining();
    const mondayMs = monday.getTime();
    const dayScores = new Array(7).fill(null).map(() => []);
    const dayFeelings = new Array(7).fill(null).map(() => []);
    const sortedForWeek = [...(entries || [])]
        .filter((e) => e && (e.date || e.createdAt))
        .sort(
            (a, b) =>
                (parseEntryDate(a.date || a.createdAt)?.getTime() ?? 0) -
                (parseEntryDate(b.date || b.createdAt)?.getTime() ?? 0)
        );

    let entriesInWeek = 0;
    sortedForWeek.forEach((entry) => {
        const idx = weekDayIndexSinceMonday(entry.date || entry.createdAt, mondayMs);
        if (idx == null) return;
        entriesInWeek += 1;
        const feeling = resolveEntryFeeling(entry);
        dayScores[idx].push(entryMoodScore10(entry));
        dayFeelings[idx].push(String(feeling || '').toLowerCase());
    });

    const chartData = dayScores.map((scores) => {
        if (scores.length === 0) return null;
        return scores.reduce((sum, s) => sum + s, 0) / scores.length;
    });

    return { mondayMs, dayScores, dayFeelings, chartData, entriesInWeek };
}

/** @see diari-streak.js — shared across desktop, mobile, and PWA */
function computeEntryStreak(entries) {
    if (window.DiariStreak && typeof window.DiariStreak.computeEntryStreak === 'function') {
        return window.DiariStreak.computeEntryStreak(entries);
    }
    return { streak: 0, streakDayMs: new Set(), hasEntryToday: false };
}

function streakPanelHintText(streak, hasEntryToday) {
    if (window.DiariStreak && typeof window.DiariStreak.streakPanelHintText === 'function') {
        return window.DiariStreak.streakPanelHintText(streak, hasEntryToday);
    }
    if (streak <= 0) return 'Journal today to start.';
    if (!hasEntryToday) return 'Log today before midnight to keep your streak.';
    return "You're on a roll — keep it up.";
}

function updateStreakPanelUI(entries) {
    const { streak, streakDayMs, hasEntryToday } = computeEntryStreak(entries || []);
    const numEl = document.getElementById('floatingStreakNum');
    const hintEl = document.getElementById('floatingStreakHint');
    const weekEl = document.getElementById('floatingStreakWeek');
    const legacy = document.querySelector('.streak-count');

    if (numEl) numEl.textContent = String(streak);
    const daysLbl = document.getElementById('floatingStreakDaysLabel');
    if (daysLbl) daysLbl.textContent = streak === 1 ? 'day' : 'days';
    if (hintEl) hintEl.textContent = streakPanelHintText(streak, hasEntryToday);
    if (legacy) legacy.textContent = `${streak} day${streak === 1 ? '' : 's'}`;

    if (!weekEl) return;

    const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
    const mondayMs = mondayOfWeekContaining().getTime();
    const streakDays = streakDayMs;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    weekEl.innerHTML = letters.map((letter, idx) => {
        const dayMs = mondayMs + idx * MS_PER_DAY;
        const isFuture = dayMs > todayMs;
        const isDone = streakDays.has(dayMs);
        let cls = 'floating-streak-panel__dow';
        if (isDone) cls += ' floating-streak-panel__dow--done';
        else if (isFuture) cls += ' floating-streak-panel__dow--future';
        else cls += ' floating-streak-panel__dow--idle';
        return `<li class="${cls}"><span>${letter}</span></li>`;
    }).join('');
}

const STREAK_BOOK_LOTTIE_SRC = '/BOOK.json';

function initializeStreakBook() {
    const root = document.getElementById('floatingStreakRoot');
    const toggleBtn = document.getElementById('floatingStreakToggle');
    const panel = document.getElementById('floatingStreakPanel');
    const mount = document.getElementById('floatingStreakBookMount');
    if (!toggleBtn || !panel || !root || !mount || toggleBtn.dataset.bound === '1') return;
    toggleBtn.dataset.bound = '1';

    let streakAnim = null;
    let revealTimer = null;
    let completeHandler = null;
    let bookReady = false;

    const getAnim = () => streakAnim;

    const clearRevealSchedule = () => {
        if (revealTimer) {
            clearTimeout(revealTimer);
            revealTimer = null;
        }
        const anim = getAnim();
        if (completeHandler && anim) {
            anim.removeEventListener('complete', completeHandler);
            completeHandler = null;
        }
    };

    const hidePanel = () => {
        panel.hidden = true;
        toggleBtn.setAttribute('aria-expanded', 'false');
        toggleBtn.setAttribute('aria-label', 'Open streak book');
    };

    const showPanel = () => {
        panel.hidden = false;
        toggleBtn.setAttribute('aria-expanded', 'true');
        toggleBtn.setAttribute('aria-label', 'Close streak book');
    };

    const endFrame = () => {
        const anim = getAnim();
        if (!anim) return 45;
        return Math.max(1, Math.floor(anim.totalFrames || 46) - 1);
    };

    const freezeClosed = () => {
        const anim = getAnim();
        if (!anim) return;
        try {
            anim.loop = false;
            anim.goToAndStop(0, true);
            anim.pause();
        } catch (e) {
            /* ignore */
        }
    };

    const freezeOpenHold = () => {
        const anim = getAnim();
        if (!anim) return;
        try {
            anim.loop = false;
            anim.goToAndStop(endFrame(), true);
            anim.pause();
        } catch (e) {
            /* ignore */
        }
    };

    const streakRevealOk = () => root.dataset.inside === '1' || root.dataset.clickOpen === '1';

    const revealPanelIfActive = () => {
        if (!streakRevealOk()) return;
        showPanel();
        freezeOpenHold();
    };

    const beginOpenSequence = () => {
        const anim = getAnim();
        if (!anim || !bookReady) return;
        clearRevealSchedule();
        hidePanel();
        try {
            anim.loop = false;
            anim.stop();
            anim.goToAndStop(0, true);
            anim.play();
        } catch (e) {
            /* ignore */
        }

        const finishOpen = () => {
            if (!streakRevealOk()) return;
            clearRevealSchedule();
            revealPanelIfActive();
        };

        completeHandler = finishOpen;
        anim.addEventListener('complete', completeHandler);
        revealTimer = setTimeout(finishOpen, 1200);
    };

    const endOpenSequence = () => {
        root.dataset.clickOpen = '0';
        clearRevealSchedule();
        hidePanel();
        freezeClosed();
    };

    const bindStreakInteractions = () => {
        root.addEventListener('mouseenter', () => {
            root.dataset.inside = '1';
            beginOpenSequence();
        });
        root.addEventListener('mouseleave', (event) => {
            const next = event.relatedTarget;
            if (next && root.contains(next)) return;
            root.dataset.inside = '0';
            root.dataset.clickOpen = '0';
            endOpenSequence();
        });

        root.addEventListener(
            'touchstart',
            () => {
                if (root.dataset.inside === '1') return;
                root.dataset.clickOpen = '1';
                beginOpenSequence();
            },
            { passive: true }
        );

        toggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (!panel.hidden) {
                root.dataset.inside = '0';
                endOpenSequence();
                return;
            }
            if (root.dataset.inside === '1') return;
            root.dataset.clickOpen = '1';
            beginOpenSequence();
        });

        document.addEventListener('click', (event) => {
            if (panel.hidden) return;
            if (root.contains(event.target)) return;
            root.dataset.inside = '0';
            endOpenSequence();
        });

        document.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape' || panel.hidden) return;
            root.dataset.inside = '0';
            endOpenSequence();
        });
    };

    const markBookReady = () => {
        if (bookReady) return;
        bookReady = true;
        mount.classList.remove('floating-streak-book__lottie--loading');
        mount.classList.remove('floating-streak-book__lottie--error');
        freezeClosed();
    };

    const loadStreakBook = async () => {
        if (typeof window.lottie === 'undefined' || typeof window.lottie.loadAnimation !== 'function') {
            mount.classList.add('floating-streak-book__lottie--error');
            return;
        }
        mount.classList.add('floating-streak-book__lottie--loading');
        try {
            const res = await fetch(STREAK_BOOK_LOTTIE_SRC, { credentials: 'same-origin' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            streakAnim = window.lottie.loadAnimation({
                container: mount,
                renderer: 'svg',
                loop: false,
                autoplay: false,
                animationData: data,
                rendererSettings: {
                    preserveAspectRatio: 'xMidYMid meet',
                    progressiveLoad: false,
                },
            });
            streakAnim.addEventListener('DOMLoaded', markBookReady);
            streakAnim.addEventListener('data_ready', markBookReady);
            streakAnim.addEventListener('data_failed', () => {
                mount.classList.add('floating-streak-book__lottie--error');
            });
            setTimeout(markBookReady, 800);
        } catch (e) {
            console.warn('Streak book failed to load:', e);
            mount.classList.remove('floating-streak-book__lottie--loading');
            mount.classList.add('floating-streak-book__lottie--error');
        }
    };

    bindStreakInteractions();
    loadStreakBook();
}

function initializeGreetingClock() {
    const hourHand = document.getElementById('greetingClockHour');
    const minuteHand = document.getElementById('greetingClockMinute');
    const secondHand = document.getElementById('greetingClockSecond');
    const timeLabel = document.getElementById('greetingClockTime');
    const dateLabel = document.getElementById('greetingClockDate');
    if (!hourHand || !minuteHand || !secondHand || !timeLabel || !dateLabel) return;

    function tick() {
        const now = new Date();
        const seconds = now.getSeconds();
        const minutes = now.getMinutes();
        const hours = now.getHours();

        const secondAngle = seconds * 6;
        const minuteAngle = (minutes + seconds / 60) * 6;
        const hourAngle = ((hours % 12) + minutes / 60) * 30;

        hourHand.style.transform = `rotate(${hourAngle}deg)`;
        minuteHand.style.transform = `rotate(${minuteAngle}deg)`;
        secondHand.style.transform = `rotate(${secondAngle}deg)`;
        timeLabel.textContent = now.toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        dateLabel.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        });
    }

    tick();
    setInterval(tick, 1000);
}

function getLoggedInUserId() {
    try {
        const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        if (!user?.isLoggedIn) return 0;
        return Number(user.id || 0);
    } catch (_) {
        return 0;
    }
}

async function syncEntriesFromApi() {
    if (window.DiariOffline?.syncEntriesFromApi) {
        await window.DiariOffline.syncEntriesFromApi();
        return;
    }
    const userId = getLoggedInUserId();
    if (!userId) {
        localStorage.setItem('diariCoreEntries', '[]');
        localStorage.removeItem('diariCoreEntriesOwnerId');
        return;
    }
    try {
        const response = await fetch('/api/entries', { credentials: 'same-origin' });
        const result = await response.json();
        if (!response.ok || !result.success || !Array.isArray(result.entries)) return;
        localStorage.setItem('diariCoreEntries', JSON.stringify(result.entries));
        localStorage.setItem('diariCoreEntriesOwnerId', String(userId));
    } catch (error) {
        console.error('Failed to sync dashboard entries:', error);
    }
}

function initializeDashboardFromUserData() {
    const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');

    updateGreeting(user);
    updateDashboardCards(entries);
    updateDailyPrompt();
    renderWeeklyChart(entries);
    updateRecentEntrySnapshot(entries);
    updateWellnessQuote();
}

function updateGreeting(user) {
    const titleEl = document.querySelector('.main-title');
    if (!titleEl) return;
    const displayName = (user?.firstName || user?.nickname || 'there').trim();
    const firstName = displayName.split(' ')[0];
    titleEl.textContent = `Good Morning, ${firstName}`;
}

/** Vendored static mood art under static/img/noto-emoji-static/ (single-frame PNG). */
const STAT_NOTO_MOOD_SRC = {
    happy: '/noto-emoji-static/3591-laughter.png',
    sad: '/noto-emoji-static/9946_sobbing.png',
    angry: '/noto-emoji-static/8712_visibly_disgusted.png',
    anxious: '/noto-emoji-static/3591-concern.png',
    neutral: '/noto-emoji-static/3563-lookat.png',
};

/** Weekly day-strip: animated Noto Lottie (paths relative to static/img/). */
const WEEK_STRIP_MOOD_LOTTIE_SRC = {
    happy: 'noto-emoji/noto-happy.json',
    sad: 'noto-emoji/noto-sad.json',
    angry: 'noto-emoji/noto-angry.json',
    anxious: 'noto-emoji/noto-anxious.json',
    neutral: 'noto-emoji/noto-neutral.json',
};

function feelingToStatNotoKey(feelingRaw) {
    const f = String(feelingRaw || '').toLowerCase();
    if (f === 'happy' || f === 'excited' || f === 'grateful') return 'happy';
    if (f === 'sad') return 'sad';
    if (f === 'angry') return 'angry';
    if (f === 'anxious' || f === 'stressed') return 'anxious';
    return 'neutral';
}

function weekStripLottieSrcForFeeling(feelingRaw) {
    const k = feelingToStatNotoKey(feelingRaw);
    return WEEK_STRIP_MOOD_LOTTIE_SRC[k] || '';
}

function statNotoSrcForFeeling(feelingRaw) {
    const k = feelingToStatNotoKey(feelingRaw);
    return STAT_NOTO_MOOD_SRC[k] || STAT_NOTO_MOOD_SRC.neutral;
}

function titleCase(value) {
    const v = (value || '').trim();
    if (!v) return '';
    return v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();
}

function getLatestEntry(entries) {
    if (!Array.isArray(entries) || entries.length === 0) return null;
    return [...entries]
        .filter((e) => e && (e.date || e.createdAt))
        .sort(
            (a, b) =>
                (parseEntryDate(b.date || b.createdAt)?.getTime() ?? 0) -
                (parseEntryDate(a.date || a.createdAt)?.getTime() ?? 0)
        )[0] || null;
}

function updateDashboardCards(entries) {
    const list = entries || [];
    updateStreakPanelUI(list);

    const moodImg = document.querySelector('.stat-card-mood .mood-emoji__img');
    const moodValue = document.querySelector('.stat-card-mood .stat-value');
    const moodDescription = document.querySelector('.stat-card-mood .stat-description');
    const avgNum = document.querySelector('.stat-card-average .stat-value__num');
    const avgDenom = document.querySelector('.stat-card-average .stat-value__denom');
    const avgDescription = document.querySelector('.stat-card-average .stat-description');
    const insightValue = document.querySelector('.stat-card-insight .insight-text');
    const insightDescription = document.querySelector('.stat-card-insight .stat-description');

    const latest = getLatestEntry(entries);
    const weekAgg = aggregateCalendarWeekMood(entries || []);
    const dailyMeans = weekAgg.chartData.filter((v) => v != null);

    if (!latest) {
        if (moodImg) {
            moodImg.src = STAT_NOTO_MOOD_SRC.neutral;
            moodImg.alt = 'No emotion data yet';
        }
        if (moodValue) moodValue.textContent = 'No emotion data yet';
        if (moodDescription) moodDescription.textContent = 'Write your first entry to track your emotions.';
        if (avgNum) avgNum.textContent = '--';
        if (avgDenom) avgDenom.textContent = '/10';
        if (avgDescription) avgDescription.textContent = 'No weekly entries yet.';
        if (insightValue) insightValue.textContent = 'No insights yet. Start journaling to discover patterns.';
        if (insightDescription) insightDescription.textContent = 'Based on your recent entries';
        return;
    }

    const latestFeeling = resolveEntryFeeling(latest);
    const moodLabel = titleCase(latestFeeling) || 'Recorded';
    if (moodImg) {
        moodImg.src = statNotoSrcForFeeling(latestFeeling);
        moodImg.alt = `${moodLabel} emotion`;
    }
    if (moodValue) moodValue.textContent = moodLabel;
    if (moodDescription) moodDescription.textContent = 'Based on your most recent entry.';

    if (dailyMeans.length === 0) {
        if (avgNum) avgNum.textContent = '--';
        if (avgDenom) avgDenom.textContent = '/10';
        if (avgDescription) avgDescription.textContent = 'No entries Mon–Sun this week yet.';
    } else {
        const avg = dailyMeans.reduce((sum, score) => sum + score, 0) / dailyMeans.length;
        if (avgNum) avgNum.textContent = avg.toFixed(1);
        if (avgDenom) avgDenom.textContent = '/10';
        const n = weekAgg.entriesInWeek;
        if (avgDescription) {
            avgDescription.textContent = n === 1
                ? '1 emotion entry this week (Mon–Sun)'
                : `${n} emotion entries this week (Mon–Sun)`;
        }
    }

    if (insightValue) {
        const score = entryMoodScore10(latest);
        insightValue.textContent = pickDashboardInsightLine(score);
    }
    if (insightDescription) insightDescription.textContent = 'Based on your recent entries';
}

function daySeedNumber() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return Math.floor(d.getTime() / 86400000);
}

function pickDailyFromList(items) {
    if (!Array.isArray(items) || items.length === 0) return null;
    const idx = daySeedNumber() % items.length;
    return items[idx];
}

function pickDashboardInsightLine(score) {
    const pool = score >= 7.5
        ? DASHBOARD_INSIGHT_POSITIVE
        : (score >= 5.5 ? DASHBOARD_INSIGHT_MID : DASHBOARD_INSIGHT_LOW);
    return pickDailyFromList(pool) || "How are you feeling right now?";
}

function updateDailyPrompt() {
    const el = document.getElementById('dailyPrompt');
    if (!el) return;
    const prompt = pickDailyFromList(DAILY_PROMPTS) || "How are you feeling right now?";
    el.textContent = prompt;
}

function formatRecentEntryDate(rawDate) {
    const d = parseEntryDate(rawDate);
    if (!d || Number.isNaN(d.getTime())) return '';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const diffDays = Math.round((today - target) / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function updateRecentEntrySnapshot(entries) {
    const card = document.getElementById('recentEntrySnapshot');
    const textEl = document.getElementById('recentEntryText');
    const dateEl = document.getElementById('recentEntryDate');
    const scoreEl = document.getElementById('recentEntryScore');
    const openBtn = document.getElementById('recentEntryOpenBtn');
    if (!card || !textEl || !dateEl || !scoreEl || !openBtn) return;

    const latest = getLatestEntry(entries || []);
    if (!latest) {
        card.hidden = true;
        return;
    }

    const rawText = String(latest.text || latest.textContent || '').trim();
    const snippet = rawText || 'No text content available for this entry.';
    const score = entryMoodScore10(latest);

    dateEl.textContent = formatRecentEntryDate(latest.date);
    textEl.textContent = snippet;
    scoreEl.textContent = `${score.toFixed(1)}/10`;
    openBtn.onclick = () => {
        if (latest.id != null) {
            localStorage.setItem('diariCoreFocusEntryId', String(latest.id));
        }
        window.location.href = 'entries.html';
    };
    card.hidden = false;
}

function updateWellnessQuote() {
    const quoteEl = document.getElementById('wellnessQuoteText');
    const authorEl = document.getElementById('wellnessQuoteAuthor');
    if (!quoteEl || !authorEl) return;
    const selected = pickDailyFromList(WELLNESS_QUOTES) || { text: "Take a deep breath. You are doing your best.", author: "Unknown" };
    quoteEl.textContent = selected.text;
    authorEl.textContent = `— ${selected.author}`;
}

function hexToRgba(hex, alpha) {
    const safe = String(hex || '').trim().replace('#', '');
    if (safe.length !== 6) return `rgba(111, 143, 127, ${alpha})`;
    const r = Number.parseInt(safe.slice(0, 2), 16);
    const g = Number.parseInt(safe.slice(2, 4), 16);
    const b = Number.parseInt(safe.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function buildChartThemeFromCss() {
    const styles = window.getComputedStyle(document.documentElement);
    const primary = styles.getPropertyValue('--primary-color').trim() || '#6F8F7F';
    const isDarkMode = document.documentElement.classList.contains('theme-dark');
    return {
        line: primary,
        fillTop: hexToRgba(primary, isDarkMode ? 0.35 : 0.3),
        fillBottom: hexToRgba(primary, isDarkMode ? 0.03 : 0.01),
        pointBorder: isDarkMode ? '#141c20' : '#ffffff',
        tooltipBg: isDarkMode ? 'rgba(16, 24, 29, 0.95)' : 'rgba(44, 62, 80, 0.9)',
        tick: isDarkMode ? '#b7c7cd' : '#6B7C74',
        grid: isDarkMode ? 'rgba(64, 82, 90, 0.6)' : 'rgba(224, 230, 227, 0.3)',
    };
}

function renderWeeklyChart(entries) {
    const sparklineEl = document.getElementById('dashboardWeeklySparkline');
    if (!sparklineEl) return;
    const avgEl = document.getElementById('dashboardWeeklyAvg');
    const bestDayEl = document.getElementById('dashboardWeeklyBestDay');
    const trendEl = document.getElementById('dashboardWeeklyTrend');
    const trendBadge = document.getElementById('dashboardTrendBadge');
    const weekStripEl = document.getElementById('dashboardWeekStrip');

    const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const {
        mondayMs,
        dayFeelings,
        chartData,
    } = aggregateCalendarWeekMood(entries);

    const presentVals = chartData.filter((v) => v != null);
    const hasData = presentVals.length > 0;
    const avg = hasData ? presentVals.reduce((a, b) => a + b, 0) / presentVals.length : 0;

    let bestIdx = -1;
    let bestVal = -Infinity;
    chartData.forEach((v, i) => {
        if (v == null) return;
        if (v > bestVal || (v === bestVal && i > bestIdx)) {
            bestVal = v;
            bestIdx = i;
        }
    });
    const bestDay = bestIdx >= 0 ? labels[bestIdx] : '--';

    // Same logic as insights.js weekly chart: split days-with-data (Mon→Sun order) into halves, compare averages.
    const valid = presentVals;
    const half = Math.max(1, Math.floor(valid.length / 2));
    const firstAvg = valid.length ? valid.slice(0, half).reduce((a, b) => a + b, 0) / half : 0;
    const secondSlice = valid.slice(half);
    const secondAvg = secondSlice.length
        ? secondSlice.reduce((a, b) => a + b, 0) / secondSlice.length
        : firstAvg;
    const delta = secondAvg - firstAvg;

    if (avgEl) avgEl.textContent = hasData ? `${avg.toFixed(1)}/10` : '--';
    if (bestDayEl) bestDayEl.textContent = hasData ? bestDay : '--';
    if (trendEl) {
        trendEl.textContent = valid.length ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '--';
    }
    if (trendBadge) {
        if (!hasData) {
            trendBadge.classList.remove('is-up');
            trendBadge.innerHTML = `<i class="bi bi-arrow-left-right"></i>Steady`;
        } else if (valid.length < 2) {
            trendBadge.classList.remove('is-up');
            trendBadge.innerHTML = `<i class="bi bi-calendar-week"></i>Partial week`;
        } else {
            const icon = delta > 0.15 ? 'bi-arrow-up-right' : (delta < -0.15 ? 'bi-arrow-down-right' : 'bi-arrow-left-right');
            trendBadge.classList.toggle('is-up', delta > 0.15);
            trendBadge.innerHTML = `<i class="bi ${icon}"></i>${delta > 0.15 ? 'Improving' : (delta < -0.15 ? 'Declining' : 'Steady')}`;
        }
    }

    // Week strip: animated Noto Lottie (Today's Emotion stat card stays static PNG).
    if (weekStripEl) {
        const now = new Date();
        const todayIdx = (() => {
            const t = new Date(now);
            t.setHours(0, 0, 0, 0);
            return Math.round((t.getTime() - mondayMs) / MS_PER_DAY);
        })();

        weekStripEl.innerHTML = labels.map((lbl, idx) => {
            const feelings = dayFeelings[idx] || [];
            const lastFeeling = feelings.length ? feelings[feelings.length - 1] : '';
            const lottieSrc = lastFeeling ? weekStripLottieSrcForFeeling(lastFeeling) : '';
            const isToday = idx === todayIdx;
            return `
                <div class="weekly-weekday${isToday ? ' is-today' : ''}">
                    <div class="weekly-weekday__dot" aria-hidden="true">
                        ${lottieSrc
                            ? `<lottie-player class="weekly-weekday__lottie" autoplay loop src="${lottieSrc}"></lottie-player>`
                            : ''}
                    </div>
                    <div class="weekly-weekday__label">${lbl}</div>
                </div>
            `;
        }).join('');
    }

    const moodColorFromCss = (name, fallback) => {
        const v = window.getComputedStyle(document.documentElement).getPropertyValue(name).trim();
        return v || fallback;
    };
    const MOOD_COLORS = {
        happy: moodColorFromCss('--mood-happy', '#E3A263'),
        sad: moodColorFromCss('--mood-sad', '#6FA6C9'),
        angry: moodColorFromCss('--mood-angry', '#D97B7B'),
        anxious: moodColorFromCss('--mood-anxious', '#B59AD9'),
        neutral: moodColorFromCss('--mood-neutral', '#9AA9A1'),
    };
    const moodDotColor = (dayIdx) => {
        const feelings = dayFeelings[dayIdx] || [];
        const mood = feelings.length ? String(feelings[feelings.length - 1]).toLowerCase() : '';
        return MOOD_COLORS[mood] || MOOD_COLORS.neutral;
    };
    const chartTheme = buildChartThemeFromCss();
    const lineColor = chartTheme.line;

    const w = 640;
    const h = 196;
    const padX = 12;
    const padY = 17;
    const step = (w - padX * 2) / 6;

    if (!hasData) {
        sparklineEl.innerHTML = `
            <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Weekly emotion sparkline">
                <text class="weekly-sparkline-empty" x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="14" font-family="inherit">No emotion data for this week yet</text>
            </svg>`;
        return;
    }

    // Y-scale from real daily means only (no padding fake points for empty weekdays).
    const visibleMin = Math.min(...presentVals);
    const visibleMax = Math.max(...presentVals);
    const span = Math.max(visibleMax - visibleMin, 2.5);
    const padYr = span * 0.18;
    const yMin = Math.max(0, visibleMin - padYr);
    const yMax = Math.min(10, visibleMax + padYr);
    const safeSpan = Math.max(yMax - yMin, 1);
    const toYSafe = (v) => h - padY - ((v - yMin) / safeSpan) * (h - padY * 2);

    const points = [];
    chartData.forEach((v, i) => {
        if (v == null) return;
        points.push({ x: padX + i * step, y: toYSafe(v), i, fill: moodDotColor(i) });
    });

    let lineD = '';
    points.forEach((p, segIdx) => {
        lineD += `${segIdx === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
    });
    lineD = lineD.trim();

    const baseY = (h - padY).toFixed(2);
    let areaD = '';
    if (points.length >= 2) {
        const lx = points[points.length - 1].x.toFixed(2);
        const fx = points[0].x.toFixed(2);
        areaD = `${lineD} L ${lx} ${baseY} L ${fx} ${baseY} Z`;
    } else if (points.length === 1) {
        const p = points[0];
        const wdg = 10;
        areaD = `M ${(p.x - wdg).toFixed(2)} ${baseY} L ${(p.x + wdg).toFixed(2)} ${baseY} L ${p.x.toFixed(2)} ${p.y.toFixed(2)} Z`;
    }

    const dots = points
        .map(
            (p) =>
                `<circle cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="5" fill="${p.fill}" stroke="${chartTheme.pointBorder}" stroke-width="1.4"></circle>`
        )
        .join('');

    let sparklineSvg = `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" aria-label="Weekly emotion sparkline">
            <defs>
                <linearGradient id="dashMoodFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.15"></stop>
                    <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"></stop>
                </linearGradient>
            </defs>
            ${areaD ? `<path d="${areaD}" fill="url(#dashMoodFill)"></path>` : ''}
            ${lineD ? `<path d="${lineD}" fill="none" stroke="${lineColor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></path>` : ''}
            ${dots}
        </svg>`;
    if (window.DiariChartFlow) {
        sparklineSvg = DiariChartFlow.enhanceSparklineSvg(
            sparklineSvg,
            Boolean(lineD),
            lineColor,
            chartTheme
        );
        DiariChartFlow.markSparklineWrap(sparklineEl);
    }
    sparklineEl.innerHTML = sparklineSvg;
}

// Mobile menu toggle (for responsive design)
function toggleMobileMenu() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('show');
}

// Add ripple effect CSS
const style = document.createElement('style');
style.textContent = `
    .action-btn {
        position: relative;
        overflow: hidden;
    }
    
    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.3);
        transform: scale(0);
        animation: ripple-animation 0.6s ease-out;
        pointer-events: none;
    }
    
    @keyframes ripple-animation {
        to {
            transform: scale(4);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);
