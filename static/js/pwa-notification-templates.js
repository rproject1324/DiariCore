/**
 * PWA-only notification copy (short phrases). Placeholders: {mood}, {insight}, {title}, {snippet}
 */
(function (global) {
    'use strict';

    const DAILY_REMINDER_TEMPLATES = [
        'Your journal is waiting — even a few lines count today.',
        'Take a quiet minute and jot down how today feels.',
        'DiariCore reminder: capture today before the day slips away.',
        'A short entry now can lighten the rest of your evening.',
        'What stood out today? Your future self will thank you.',
        'Pause and write — your streak-friendly moment is here.',
        'Gentle nudge: open your diary and name one real thing from today.',
        'Today deserves a line in your journal. Start small.',
        'Your mindful journal is ready when you are.',
        'Check in with yourself — a quick entry is enough.',
        'Write the mood, not the novel. You’ve got this.',
        'Reminder: your story today is worth saving.',
        'Open DiariCore and let today leave a footprint.',
        'One honest sentence can shift the whole day.',
        'Time to reflect — your diary misses your voice.',
        'Capture a win, a worry, or a wonder from today.',
        'Your daily journal moment is here. Keep it simple.',
        'Slow down for sixty seconds and write what’s true.',
        'DiariCore: today’s page is still blank. Fill it gently.',
        'A little journaling now beats a perfect entry never.',
        'What are you carrying today? Put it on the page.',
        'Your reflection habit starts with showing up — now works.',
        'Note one feeling from today. That counts as journaling.',
        'Evening check-in: how did today actually go?',
        'Morning pages or night notes — either way, write today.',
        'Your consistency grows one entry at a time. Today’s turn.',
        'Don’t overthink it — open Write Entry and start.',
        'Reminder from DiariCore: your inner weather changes; log it.',
        'A blank entry is still progress. Begin with one word.',
        'You set this time because journaling helps — honor that.',
    ];

    const INSIGHT_HIGH = [
        'You’ve been leaning {mood} lately. {insight}',
        'Today’s tone feels brighter ({mood}). {insight}',
        'Your last entry carried {mood} energy. {insight}',
        'Nice momentum — mood: {mood}. {insight}',
        '“{title}” — you sounded {mood}. {insight}',
    ];

    const INSIGHT_MID = [
        'You seem fairly steady ({mood}). {insight}',
        'Today’s mood reads {mood}. {insight}',
        'From “{title}”: a {mood} check-in. {insight}',
        'Balanced day so far ({mood}). {insight}',
        'Your journal shows {mood} — {insight}',
    ];

    const INSIGHT_LOW = [
        'You’ve been carrying {mood} lately. {insight}',
        'Your last entry felt {mood}. {insight}',
        '“{snippet}” — sounds {mood}. {insight}',
        'Heavy days happen ({mood}). {insight}',
        'Be gentle with yourself; mood: {mood}. {insight}',
    ];

    const INSIGHT_NEUTRAL = [
        'Your last entry is in — ready for another line? {insight}',
        'You wrote about “{title}”. {insight}',
        'Journal check-in: {insight}',
        'Still thinking about today? {insight}',
        'Your diary has room for more. {insight}',
    ];

    const INSIGHT_PHRASES_HIGH = [
        'Keep the routines that are working.',
        'Ride this positive rhythm while it lasts.',
        'A short gratitude note could anchor the day.',
        'You’re building healthy emotional momentum.',
        'Celebrate the small wins you logged.',
    ];

    const INSIGHT_PHRASES_MID = [
        'A brief pause and write can keep you grounded.',
        'One intentional check-in may help today.',
        'Small habits nudge the tone upward.',
        'Name one feeling and one need — that’s enough.',
        'Stay curious about what today needs.',
    ];

    const INSIGHT_PHRASES_LOW = [
        'Try a short breath-and-write reset.',
        'One gentle step of self-support can help.',
        'You don’t have to fix it — just name it.',
        'Keep today light; one manageable step is enough.',
        'Your journal is a safe place for the hard stuff.',
    ];

    const INSIGHT_PHRASES_NEUTRAL = [
        'Add a line about how the day shifted since then.',
        'Capture what you notice right now.',
        'Even a sentence keeps the habit alive.',
        'Your future self likes honest notes.',
        'Reflect before the day fully fades.',
    ];

    function pickRandom(arr) {
        if (!arr || !arr.length) return '';
        return arr[Math.floor(Math.random() * arr.length)];
    }

    function fillTemplate(tpl, vars) {
        return String(tpl || '').replace(/\{(\w+)\}/g, (_, key) => {
            const v = vars[key];
            return v != null ? String(v) : '';
        });
    }

    function moodBucket(moodRaw) {
        const m = String(moodRaw || 'neutral').toLowerCase();
        if (m === 'happy') return 'high';
        if (m === 'sad' || m === 'angry' || m === 'anxious') return 'low';
        if (m === 'neutral') return 'neutral';
        return 'mid';
    }

    function buildDailyReminderBody() {
        return pickRandom(DAILY_REMINDER_TEMPLATES);
    }

    function buildInsightNotificationBody(vars) {
        const bucket = moodBucket(vars.mood);
        let pool;
        let phrasePool;
        if (bucket === 'high') {
            pool = INSIGHT_HIGH;
            phrasePool = INSIGHT_PHRASES_HIGH;
        } else if (bucket === 'low') {
            pool = INSIGHT_LOW;
            phrasePool = INSIGHT_PHRASES_LOW;
        } else if (bucket === 'neutral') {
            pool = INSIGHT_NEUTRAL;
            phrasePool = INSIGHT_PHRASES_NEUTRAL;
        } else {
            pool = INSIGHT_MID;
            phrasePool = INSIGHT_PHRASES_MID;
        }
        const insight = vars.insight || pickRandom(phrasePool);
        const moodLabel =
            vars.moodLabel ||
            (vars.mood ? String(vars.mood).charAt(0).toUpperCase() + String(vars.mood).slice(1) : 'Neutral');
        return fillTemplate(pickRandom(pool), {
            mood: moodLabel.toLowerCase(),
            insight,
            title: vars.title || 'your last entry',
            snippet: vars.snippet || vars.title || 'your last note',
        });
    }

    global.DiariPwaNotificationTemplates = {
        buildDailyReminderBody,
        buildInsightNotificationBody,
        pickRandom,
        moodBucket,
    };
})(typeof window !== 'undefined' ? window : self);
