// DiariCore Profile Page JavaScript

function refreshProfileAfterPwaSync() {
    initializeProfileFromStorage();
    hydratePersonalInfoPanel();
    hydrateProfileReminderTimeInput();
    if (window.DiariTheme && typeof window.DiariTheme.syncToggleState === 'function') {
        window.DiariTheme.syncToggleState();
    }
    refreshProfilePersonalSaveButton();
}

document.addEventListener('DOMContentLoaded', async function() {
    window.addEventListener('diari-offline-sync-complete', refreshProfileAfterPwaSync);
    window.addEventListener('diari-remote-state-refreshed', refreshProfileAfterPwaSync);
    window.addEventListener('diari-user-updated', refreshProfileAfterPwaSync);
    window.addEventListener('offline', function () {
        refreshProfilePersonalSaveButton();
    });
    if (window.DiariOffline?.registerPageRefreshHandler) {
        window.DiariOffline.registerPageRefreshHandler(refreshProfileAfterPwaSync);
    }
    if (window.DiariOffline?.wirePwaPageAutoSync) {
        window.DiariOffline.wirePwaPageAutoSync(refreshProfileAfterPwaSync);
    }

    if (window.DiariOffline?.awaitServerState) {
        await window.DiariOffline.awaitServerState();
    }
    refreshProfileAfterPwaSync();
    if (window.DiariShell && typeof window.DiariShell.release === 'function') {
        window.DiariShell.release();
    }

    initializeProfileInteractions();
    initializePreferenceToggles();
    initializeReminderTimePreference();
    initializeStorageActions();
    initializeProfileSectionNavigation();
    initializeAccountDetailPanels();
});

let profileSecPwLiveInst = null;
let lastOpenedProfileSectionKey = '';
let profilePwdChangeSuccessAnim = null;
let profilePwdChangeOtpResendInterval = null;
let profilePwdChangeOtpResendRemaining = 0;
let profilePwdChangeOtpVerifyInProgress = false;
let profilePwdChangeOtpAutoVerifyTimeout = null;
let profilePwdChangeSuccessLogoutTimer = null;
let profilePwdChangeSuccessRedirectInterval = null;

function profileBlockingModalIds() {
    return [
        'profilePwdChangeOtpModal',
        'profileEmailChangeOtpModal',
        'profilePwdChangeSuccessModal',
        'profileTotpModal',
    ];
}

function syncProfileModalBodyScrollLock() {
    const anyOpen = profileBlockingModalIds().some(function (id) {
        const el = document.getElementById(id);
        return el && !el.hidden;
    });
    if (anyOpen) {
        document.body.classList.add('profile-totp-modal-open');
        document.body.style.overflow = 'hidden';
    } else {
        document.body.classList.remove('profile-totp-modal-open');
        document.body.style.overflow = '';
    }
}

let profileEmailChangeOtpResendInterval = null;
let profileEmailChangeOtpResendRemaining = 0;
let profileEmailChangeOtpVerifyInProgress = false;
let profileEmailChangeOtpAutoVerifyTimeout = null;

const PWA_OFFLINE_SAVED_MSG = 'Saved offline. Changes will sync automatically when connected.';
const PWA_INTERNET_REQUIRED_MSG = 'Please connect to the internet and try again.';
const PWA_PASSWORD_INTERNET_MSG =
    'Please connect to the internet and try changing you password again.';

function isPwaProfileContext() {
    if (window.DiariOffline?.isPwaUiContext?.()) return true;
    if (window.DiariOffline?.isPwaStandalone?.()) return true;
    try {
        if (window.DiariPWA?.isStandalone?.()) return true;
    } catch (_) {
        /* ignore */
    }
    const el = document.documentElement;
    return (
        el.classList.contains('diari-pwa-standalone') ||
        el.getAttribute('data-diari-pwa') === 'standalone' ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true
    );
}

async function isPwaOfflineForUserActions() {
    if (!isPwaProfileContext()) return false;
    if (window.DiariOffline?.isPwaOfflineNow) {
        return window.DiariOffline.isPwaOfflineNow();
    }
    return navigator.onLine === false;
}

function isPwaOfflineForUserActionsSync() {
    if (!isPwaProfileContext()) return false;
    if (window.DiariOffline?.isPwaOfflineNow) {
        return window.DiariOffline.isPwaOfflineNow();
    }
    return navigator.onLine === false;
}

function profilePersonalNicknameEmailChangedFromStored(user, nick, email) {
    if (!user) return true;
    const origNick = String(user.nickname || '').trim();
    const origEmail = String(user.email || '')
        .trim()
        .toLowerCase();
    if (nick.trim() !== origNick) return true;
    if (email.trim().toLowerCase() !== origEmail) return true;
    return false;
}

function isProfilePersonalFormValidForPwaOffline() {
    if (!validateProfilePersonalField('profileFieldFirstName')) return false;
    if (!validateProfilePersonalField('profileFieldLastName')) return false;
    if (!validateProfilePersonalField('profileFieldBirthday')) return false;
    const nickEl = document.getElementById('profileFieldNickname');
    const emEl = document.getElementById('profileFieldEmail');
    const nv = ((nickEl && nickEl.value) || '').trim();
    const ev = ((emEl && emEl.value) || '').trim();
    if (!nv || nv.length < 4 || nv.length > 64) return false;
    if (!ev || !profilePersonalIsValidEmail(ev)) return false;
    return true;
}

function showPwaInternetRequiredToast() {
    showNotification(PWA_INTERNET_REQUIRED_MSG, 'warning', 5000);
}

function showPwaPasswordInternetToast() {
    showNotification(PWA_PASSWORD_INTERNET_MSG, 'warning', 5000);
}

function showPwaTotpInternetToast() {
    showNotification(PWA_INTERNET_REQUIRED_MSG, 'warning', 5000);
}

function showPwaSavedOfflineToast() {
    showNotification(PWA_OFFLINE_SAVED_MSG, 'info', 5000);
}

window.handlePwaProfilePalettePick = async function (paletteId) {
    if (!paletteId || !window.DiariTheme) return;
    if (await isPwaOfflineForUserActions()) {
        window.DiariTheme.setPalette(paletteId, { skipServerSync: true });
        if (window.DiariOffline?.savePwaUiPrefsPending) {
            window.DiariOffline.savePwaUiPrefsPending({
                uiPaletteId: paletteId,
                uiTheme: window.DiariTheme.getTheme(),
            });
        }
        showPwaSavedOfflineToast();
        return;
    }
    window.DiariTheme.setPalette(paletteId);
};

function finishProfilePersonalSaveSuccessOffline(patch) {
    const prev = getStoredDiariUser() || {};
    mergeDiariUserIntoStorage(Object.assign({}, prev, patch));
    initializeProfileFromStorage();
    hydratePersonalInfoPanel();
    showPwaSavedOfflineToast();
}

function initializeProfileFromStorage() {
    try {
    const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        const safeEntries = Array.isArray(entries) ? entries.filter((e) => e && (e.date || e.createdAt)) : [];

    const nameEl = document.querySelector('.profile-name');
    const emailEl = document.querySelector('.profile-email');
    const memberSinceEl = document.querySelector('.profile-member-since');
    const statEls = document.querySelectorAll('.profile-stats .stat-number');

    if (nameEl) {
        const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
        nameEl.textContent = fullName || user?.nickname || 'New User';
    }
    if (emailEl) emailEl.textContent = user?.email || 'No email available';
    if (memberSinceEl) {
        const parsed = user?.createdAt ? new Date(user.createdAt) : null;
        const createdAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
        const monthYear = createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        memberSinceEl.textContent = `Member since ${monthYear}`;
    }

    const entryCount = safeEntries.length;
    const streak = calculateEntryStreak(safeEntries);
        const thisWeekCount = countEntriesThisCalendarWeek(safeEntries);
    if (statEls[0]) statEls[0].textContent = String(entryCount);
    if (statEls[1]) statEls[1].textContent = String(streak);
        if (statEls[2]) statEls[2].textContent = String(thisWeekCount);

        applyProfileOverviewAvatar(user);
    } finally {
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                if (window.DiariShell && typeof window.DiariShell.release === 'function') {
                    window.DiariShell.release();
                } else {
                    document.documentElement.classList.remove('diari-shell-pending');
                }
            });
        });
    }
}

const PROFILE_MS_PER_DAY = 86400000;

function profileJournalDayStartMs(raw) {
    if (raw == null) return null;
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return null;
    const local = new Date(dt);
    local.setHours(0, 0, 0, 0);
    return local.getTime();
}

function calculateEntryStreak(entries) {
    if (window.DiariStreak && typeof window.DiariStreak.streakCount === 'function') {
        return window.DiariStreak.streakCount(entries);
    }
    return 0;
}

/** Monday 00:00 local for the Mon–Sun week containing `ref` (same week model as the dashboard). */
function profileMondayStartMs(ref) {
    const t = new Date(ref);
    t.setHours(0, 0, 0, 0);
    const dow = t.getDay();
    const daysFromMonday = dow === 0 ? 6 : dow - 1;
    const monday = new Date(t);
    monday.setDate(t.getDate() - daysFromMonday);
    monday.setHours(0, 0, 0, 0);
    return monday.getTime();
}

/** How many entries fall on Mon–Sun of the current local calendar week. */
function countEntriesThisCalendarWeek(entries) {
    if (!Array.isArray(entries) || !entries.length) return 0;
    const mondayMs = profileMondayStartMs(new Date());
    const weekEndMs = mondayMs + 7 * PROFILE_MS_PER_DAY;
    let n = 0;
    entries.forEach((e) => {
        if (!e) return;
        const raw = e.date || e.createdAt;
        if (!raw) return;
        const ms = profileJournalDayStartMs(raw);
        if (ms == null) return;
        if (ms >= mondayMs && ms < weekEndMs) n += 1;
    });
    return n;
}

function toDateInputValue(raw) {
    if (raw == null || raw === '') return '';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function normalizeGenderForSelect(g) {
    const s = String(g || '').trim().toLowerCase();
    if (s === 'male' || s === 'm') return 'Male';
    if (s === 'female' || s === 'f') return 'Female';
    if (
        s === 'prefer not to say' ||
        s === 'other' ||
        s === 'non-binary' ||
        s === 'nonbinary' ||
        !s
    ) {
        return 'Prefer not to say';
    }
    if (g === 'Male' || g === 'Female' || g === 'Prefer not to say') return g;
    return 'Prefer not to say';
}

function profileDisplayNameFromUser(user) {
    const fullName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim();
    return fullName || user?.nickname || 'New User';
}

function profileInitialsFromUser(user) {
    const displayName = profileDisplayNameFromUser(user);
    const parts = displayName.split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

function applyProfileOverviewAvatar(user) {
    const avatarEl = document.querySelector('.profile-overview-section .avatar-image');
    const initialsEl = document.getElementById('profileOverviewAvatarInitials');
    if (!avatarEl || !initialsEl) return;
    const dataUrl = user && typeof user.avatarDataUrl === 'string' ? user.avatarDataUrl.trim() : '';
    if (dataUrl) {
        avatarEl.src = dataUrl;
        avatarEl.hidden = false;
        initialsEl.style.display = 'none';
        initialsEl.textContent = '';
    } else {
        avatarEl.removeAttribute('src');
        avatarEl.hidden = true;
        initialsEl.style.display = 'flex';
        initialsEl.textContent = profileInitialsFromUser(user);
    }
}

function hydratePersonalInfoPanel() {
    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    } catch (_) {
        user = null;
    }
    const img = document.getElementById('profilePersonalSummaryAvatar');
    const initialsEl = document.getElementById('profilePersonalSummaryInitials');
    const nameEl = document.getElementById('profilePersonalSummaryName');
    const memberEl = document.getElementById('profilePersonalSummaryMember');
    const firstEl = document.getElementById('profileFieldFirstName');
    const lastEl = document.getElementById('profileFieldLastName');
    const nickEl = document.getElementById('profileFieldNickname');
    const emailEl = document.getElementById('profileFieldEmail');
    const genderEl = document.getElementById('profileFieldGender');
    const bdayEl = document.getElementById('profileFieldBirthday');

    const displayName = profileDisplayNameFromUser(user);
    if (nameEl) nameEl.textContent = displayName;
    if (memberEl) {
        const parsed = user?.createdAt ? new Date(user.createdAt) : null;
        const createdAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();
        const monthYear = createdAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        memberEl.textContent = `Member since ${monthYear}`;
    }

    const dataUrl = user && typeof user.avatarDataUrl === 'string' ? user.avatarDataUrl.trim() : '';
    if (img && initialsEl) {
        if (dataUrl) {
            img.src = dataUrl;
            img.hidden = false;
            initialsEl.style.display = 'none';
        } else {
            img.removeAttribute('src');
            img.hidden = true;
            initialsEl.style.display = 'flex';
            initialsEl.textContent = profileInitialsFromUser(user);
        }
    }

    if (firstEl) firstEl.value = user?.firstName != null ? String(user.firstName) : '';
    if (lastEl) lastEl.value = user?.lastName != null ? String(user.lastName) : '';
    if (nickEl) nickEl.value = user?.nickname != null ? String(user.nickname) : '';
    if (emailEl) emailEl.value = user?.email != null ? String(user.email) : '';
    if (genderEl) genderEl.value = normalizeGenderForSelect(user?.gender);
    if (bdayEl) bdayEl.value = toDateInputValue(user?.birthday);

    wireProfilePersonalLiveValidation();
    PROFILE_PERSONAL_AVAIL_FIELD_IDS.forEach(function (fid) {
        resetProfilePersonalAvailabilityField(fid);
    });
    [
        'profileFieldFirstName',
        'profileFieldLastName',
        'profileFieldNickname',
        'profileFieldEmail',
        'profileFieldBirthday',
    ].forEach(function (fid) {
        var f = document.getElementById(fid);
        if (f) {
            f.classList.remove('error', 'success');
            var err = document.getElementById(`${fid}-error`);
            if (err) err.classList.remove('show');
        }
    });
    [
        'profileFieldFirstName',
        'profileFieldLastName',
        'profileFieldNickname',
        'profileFieldEmail',
        'profileFieldBirthday',
    ].forEach(function (fid) {
        validateProfilePersonalField(fid);
    });
    refreshProfilePersonalSaveButton();
}

function getProfileSecurityPersonal() {
    const user = getStoredDiariUser() || {};
    const nickEl = document.getElementById('profileFieldNickname');
    const emailEl = document.getElementById('profileFieldEmail');
    const firstEl = document.getElementById('profileFieldFirstName');
    const lastEl = document.getElementById('profileFieldLastName');
    return {
        nickname: (nickEl && nickEl.value.trim()) || String(user.nickname || '').trim(),
        email: (emailEl && emailEl.value.trim()) || String(user.email || '').trim(),
        firstName: (firstEl && firstEl.value.trim()) || String(user.firstName || '').trim(),
        lastName: (lastEl && lastEl.value.trim()) || String(user.lastName || '').trim(),
    };
}

const PROFILE_PERSONAL_AVAIL_FIELD_IDS = ['profileFieldNickname', 'profileFieldEmail'];
let profilePersonalAvailState = {
    profileFieldNickname: { lastCheckedValue: '', isAvailable: null, pendingPromise: null },
    profileFieldEmail: { lastCheckedValue: '', isAvailable: null, pendingPromise: null },
};
let profilePersonalAvailTimers = { profileFieldNickname: null, profileFieldEmail: null };
let profilePersonalLiveValidationWired = false;

function getProfilePersonalExcludeUserId() {
    const u = getStoredDiariUser();
    if (!u || u.id == null) return '';
    const id = typeof u.id === 'number' ? u.id : parseInt(String(u.id), 10);
    return id && !Number.isNaN(id) ? String(id) : '';
}

function resetProfilePersonalAvailabilityField(fieldInputId) {
    if (!profilePersonalAvailState[fieldInputId]) return;
    profilePersonalAvailState[fieldInputId].lastCheckedValue = '';
    profilePersonalAvailState[fieldInputId].isAvailable = null;
    profilePersonalAvailState[fieldInputId].pendingPromise = null;
    if (profilePersonalAvailTimers[fieldInputId]) {
        clearTimeout(profilePersonalAvailTimers[fieldInputId]);
        profilePersonalAvailTimers[fieldInputId] = null;
    }
}

function profilePersonalShowError(inputElement, message) {
    if (!inputElement) return;
    inputElement.classList.add('error');
    inputElement.classList.remove('success');
    const customError = document.getElementById(`${inputElement.id}-error`);
    if (customError) {
        customError.textContent = message;
        customError.classList.add('show');
    }
}

function profilePersonalShowSuccess(inputElement) {
    if (!inputElement) return;
    inputElement.classList.remove('error');
    inputElement.classList.add('success');
    const customError = document.getElementById(`${inputElement.id}-error`);
    if (customError) customError.classList.remove('show');
}

function profilePersonalIsValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(String(email || '').trim());
}

function checkProfilePersonalAvailability(fieldInputId, value) {
    if (!profilePersonalAvailState[fieldInputId]) return Promise.resolve(true);
    const state = profilePersonalAvailState[fieldInputId];
    if (state.lastCheckedValue === value && state.isAvailable !== null) {
        const el = document.getElementById(fieldInputId);
        if (el) {
            if (state.isAvailable) {
                profilePersonalShowSuccess(el);
            } else {
                profilePersonalShowError(
                    el,
                    fieldInputId === 'profileFieldNickname'
                        ? 'Username already exists.'
                        : 'Email already exists.'
                );
            }
        }
        return Promise.resolve(state.isAvailable);
    }
    if (state.lastCheckedValue === value && state.pendingPromise) return state.pendingPromise;

    const apiField = fieldInputId === 'profileFieldNickname' ? 'nickname' : 'email';
    state.lastCheckedValue = value;
    state.isAvailable = null;
    const ex = getProfilePersonalExcludeUserId();
    const q =
        `field=${encodeURIComponent(apiField)}&value=${encodeURIComponent(value)}` +
        (ex ? `&excludeUserId=${encodeURIComponent(ex)}` : '');
    state.pendingPromise = fetch(`/api/check-availability?${q}`)
        .then(function (res) {
            return res.json().then(function (data) {
                return { ok: res.ok, data: data };
            });
        })
        .then(function (_ref) {
            var ok = _ref.ok;
            var data = _ref.data;
            if (!ok || !data.success) return true;
            if (state.lastCheckedValue !== value) return true;
            state.isAvailable = !!data.available;
            var el = document.getElementById(fieldInputId);
            if (!el) return state.isAvailable;
            if (state.isAvailable) {
                profilePersonalShowSuccess(el);
                return true;
            }
            profilePersonalShowError(
                el,
                data.message ||
                    (fieldInputId === 'profileFieldNickname'
                        ? 'Username already exists.'
                        : 'Email already exists.')
            );
            return false;
        })
        .catch(function () {
            return true;
        })
        .finally(function () {
            if (state.lastCheckedValue === value) state.pendingPromise = null;
            refreshProfilePersonalSaveButton();
        });
    return state.pendingPromise;
}

function scheduleProfilePersonalAvailabilityCheck(fieldInputId, value) {
    if (!profilePersonalAvailState[fieldInputId]) return;
    if (profilePersonalAvailTimers[fieldInputId]) {
        clearTimeout(profilePersonalAvailTimers[fieldInputId]);
    }
    profilePersonalAvailTimers[fieldInputId] = setTimeout(function () {
        profilePersonalAvailTimers[fieldInputId] = null;
        void checkProfilePersonalAvailability(fieldInputId, value);
    }, 300);
}

function profileRejectAngleBrackets(field, value, label) {
    if (!window.DiariSecurity || typeof window.DiariSecurity.validateNoAngleBrackets !== 'function') {
        return true;
    }
    const check = window.DiariSecurity.validateNoAngleBrackets(value, label);
    if (!check.ok) {
        profilePersonalShowError(field, check.message);
        return false;
    }
    return true;
}

function validateProfilePersonalField(fieldId) {
    const field = document.getElementById(fieldId);
    if (!field) return true;
    const value = (field.value || '').trim();

    if (fieldId === 'profileFieldFirstName') {
        if (!profileRejectAngleBrackets(field, value, 'First name')) return false;
        if (!value) {
            profilePersonalShowError(field, 'First name is required.');
            return false;
        }
        profilePersonalShowSuccess(field);
        return true;
    }
    if (fieldId === 'profileFieldLastName') {
        if (!profileRejectAngleBrackets(field, value, 'Last name')) return false;
        if (!value) {
            profilePersonalShowError(field, 'Last name is required.');
            return false;
        }
        profilePersonalShowSuccess(field);
        return true;
    }
    if (fieldId === 'profileFieldNickname') {
        if (!profileRejectAngleBrackets(field, value, 'Username')) return false;
        if (!value) {
            resetProfilePersonalAvailabilityField('profileFieldNickname');
            profilePersonalShowError(field, 'Username is required.');
            return false;
        }
        if (value.length < 4 || value.length > 64) {
            resetProfilePersonalAvailabilityField('profileFieldNickname');
            profilePersonalShowError(field, 'Field must be between 4 and 64 characters long.');
            return false;
        }
        var st = profilePersonalAvailState.profileFieldNickname;
        if (st.lastCheckedValue === value && st.isAvailable === false) {
            profilePersonalShowError(field, 'Username already exists.');
            return false;
        }
        if (st.lastCheckedValue === value && st.isAvailable === true) {
            profilePersonalShowSuccess(field);
            return true;
        }
        scheduleProfilePersonalAvailabilityCheck('profileFieldNickname', value);
        return true;
    }
    if (fieldId === 'profileFieldEmail') {
        if (!profileRejectAngleBrackets(field, value, 'Email')) return false;
        if (!value) {
            resetProfilePersonalAvailabilityField('profileFieldEmail');
            profilePersonalShowError(field, 'Email is required.');
            return false;
        }
        if (!profilePersonalIsValidEmail(value)) {
            resetProfilePersonalAvailabilityField('profileFieldEmail');
            profilePersonalShowError(field, 'Please enter a valid email.');
            return false;
        }
        var stE = profilePersonalAvailState.profileFieldEmail;
        if (stE.lastCheckedValue === value && stE.isAvailable === false) {
            profilePersonalShowError(field, 'Email already exists.');
            return false;
        }
        if (stE.lastCheckedValue === value && stE.isAvailable === true) {
            profilePersonalShowSuccess(field);
            return true;
        }
        scheduleProfilePersonalAvailabilityCheck('profileFieldEmail', value);
        return true;
    }
    if (fieldId === 'profileFieldBirthday') {
        if (!value) {
            profilePersonalShowError(field, 'Date of birth is required.');
            return false;
        }
        profilePersonalShowSuccess(field);
        return true;
    }
    return true;
}

function profilePersonalNickEmailConfirmedReady(fieldInputId, val) {
    var st = profilePersonalAvailState[fieldInputId];
    return st.lastCheckedValue === val && st.isAvailable === true;
}

function isProfilePersonalFormValid() {
    if (!validateProfilePersonalField('profileFieldFirstName')) return false;
    if (!validateProfilePersonalField('profileFieldLastName')) return false;
    if (!validateProfilePersonalField('profileFieldBirthday')) return false;
    if (!validateProfilePersonalField('profileFieldNickname')) return false;
    if (!validateProfilePersonalField('profileFieldEmail')) return false;
    var nickEl = document.getElementById('profileFieldNickname');
    var emEl = document.getElementById('profileFieldEmail');
    var nv = ((nickEl && nickEl.value) || '').trim();
    var ev = ((emEl && emEl.value) || '').trim();
    var nickLocal = nv.length >= 4 && nv.length <= 64;
    var emLocal = !!ev && profilePersonalIsValidEmail(ev);
    if (nickLocal && !profilePersonalNickEmailConfirmedReady('profileFieldNickname', nv)) return false;
    if (emLocal && !profilePersonalNickEmailConfirmedReady('profileFieldEmail', ev)) return false;
    return true;
}

function refreshProfilePersonalSaveButton() {
    var btn = document.getElementById('profilePersonalSaveBtn');
    if (!btn) return;
    btn.disabled = isPwaOfflineForUserActionsSync()
        ? !isProfilePersonalFormValidForPwaOffline()
        : !isProfilePersonalFormValid();
}

function wireProfilePersonalLiveValidation() {
    if (profilePersonalLiveValidationWired) return;
    profilePersonalLiveValidationWired = true;
    [
        'profileFieldFirstName',
        'profileFieldLastName',
        'profileFieldNickname',
        'profileFieldEmail',
        'profileFieldBirthday',
    ].forEach(function (fid) {
        var el = document.getElementById(fid);
        if (!el) return;
        if (
            window.DiariSecurity &&
            typeof window.DiariSecurity.bindAngleBracketInput === 'function' &&
            ['profileFieldFirstName', 'profileFieldLastName', 'profileFieldNickname', 'profileFieldEmail'].indexOf(fid) !== -1
        ) {
            window.DiariSecurity.bindAngleBracketInput(el);
        }
        var run = function () {
            validateProfilePersonalField(fid);
            refreshProfilePersonalSaveButton();
        };
        el.addEventListener('input', run);
        el.addEventListener('change', run);
        el.addEventListener('blur', run);
    });
    var genderEl = document.getElementById('profileFieldGender');
    if (genderEl) {
        genderEl.addEventListener('change', function () {
            refreshProfilePersonalSaveButton();
        });
    }
}

function destroyProfileSecPasswordLive() {
    if (profileSecPwLiveInst) {
        profileSecPwLiveInst.destroy();
        profileSecPwLiveInst = null;
    }
}

function initProfileSecPasswordLive() {
    destroyProfileSecPasswordLive();
    const newEl = document.getElementById('profileSecNewPassword');
    const confEl = document.getElementById('profileSecConfirmPassword');
    const liveWrap = document.getElementById('profileSecPwLive');
    const submitBtn = document.getElementById('profileSecuritySaveBtn');
    const commonErr = document.getElementById('profileSecPwCommonErr');
    const formRoot = document.getElementById('profileSectionSecurity');
    if (
        !window.DiariPasswordLive ||
        !newEl ||
        !confEl ||
        !liveWrap ||
        !submitBtn ||
        !formRoot
    ) {
        return;
    }
    liveWrap.innerHTML = '';
    profileSecPwLiveInst = window.DiariPasswordLive.attach({
        passwordEl: newEl,
        confirmEl: confEl,
        hintEl: null,
        liveWrap: liveWrap,
        submitBtn: submitBtn,
        commonErrorEl: commonErr,
        formRoot: formRoot,
        getPersonal: getProfileSecurityPersonal,
    });
}

function clearSecurityForm() {
    ['profileSecCurrentPassword', 'profileSecNewPassword', 'profileSecConfirmPassword'].forEach(function (id) {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const err = document.getElementById('profileSecPwCommonErr');
    if (err) {
        err.textContent = '';
        err.classList.remove('show');
    }
    if (profileSecPwLiveInst && typeof profileSecPwLiveInst.refresh === 'function') {
        profileSecPwLiveInst.refresh();
    }
}

function getStoredDiariUser() {
    try {
        return JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    } catch (_) {
        return null;
    }
}

function mergeDiariUserIntoStorage(serverUser) {
    if (!serverUser || typeof serverUser !== 'object') return;
    const prev = getStoredDiariUser() || {};
    const merged = Object.assign({}, prev, serverUser, {
        isLoggedIn: prev.isLoggedIn !== false,
    });
    localStorage.setItem('diariCoreUser', JSON.stringify(merged));
    if (window.DiariTheme && typeof window.DiariTheme.applyFromUser === 'function') {
        window.DiariTheme.applyFromUser(merged);
    }
    try {
        document.dispatchEvent(new CustomEvent('diari-user-updated', { bubbles: true }));
    } catch (_) {}
}

function updateSecurityStatusPill(user) {
    const pill = document.querySelector('.profile-account-detail-card--security .profile-security-status span');
    if (!pill) return;
    const on = !!(user && user.totpEnabled);
    pill.textContent = on ? 'Two-factor sign-in is on.' : 'Two-factor sign-in is off.';
}

function hydrateSecurity2fa() {
    const user = getStoredDiariUser();
    const toggle = document.getElementById('profileSec2faToggle');
    if (!toggle) return;
    toggle.dataset.hydrating = '1';
    toggle.checked = !!(user && user.totpEnabled);
    delete toggle.dataset.hydrating;
    updateSecurityStatusPill(user);
}

function getProfileTotpDisableDigitInputs() {
    return Array.from(document.querySelectorAll('[data-profile-totp-disable-digit]'));
}

function getProfileTotpDisableCode() {
    return getProfileTotpDisableDigitInputs()
        .map(function (d) {
            return (d.value || '').replace(/\D/g, '');
        })
        .join('');
}

function updateProfileTotpDisableCounter() {
    const el = document.getElementById('profileTotpDisableCounter');
    if (!el) return;
    el.textContent = `${getProfileTotpDisableCode().length}/6`;
}

function clearProfileTotpDisableDigits() {
    getProfileTotpDisableDigitInputs().forEach(function (d) {
        d.value = '';
        d.disabled = false;
    });
    updateProfileTotpDisableCounter();
}

function setProfileTotpDisablePrimaryButton() {
    const primary = document.getElementById('profileTotpModalPrimary');
    if (!primary) return;
    primary.classList.remove('is-loading');
    primary.classList.add('profile-totp-modal__btn--danger');
    primary.innerHTML = '<i class="bi bi-shield-slash" aria-hidden="true"></i> Disable 2FA';
}

function wireProfileTotpDisableDigits() {
    const digits = getProfileTotpDisableDigitInputs();
    if (!digits.length || digits[0].dataset.totpDigitsWired === '1') return;
    digits[0].dataset.totpDigitsWired = '1';
    digits.forEach(function (input, idx) {
        input.addEventListener('input', function (e) {
            var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
            e.target.value = v;
            updateProfileTotpDisableCounter();
            if (v && idx < digits.length - 1) {
                digits[idx + 1].focus();
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
            }
        });
        input.addEventListener('paste', function (e) {
            e.preventDefault();
            var raw = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
            digits.forEach(function (d, i) {
                d.value = raw[i] || '';
            });
            updateProfileTotpDisableCounter();
            var next = raw.length >= 6 ? 5 : raw.length;
            if (digits[next]) {
                digits[next].focus();
            }
        });
    });
}

function getProfileTotpSetupDigitInputs() {
    return Array.from(document.querySelectorAll('[data-profile-totp-setup-digit]'));
}

function getProfileTotpSetupConfirmCode() {
    return getProfileTotpSetupDigitInputs()
        .map(function (d) {
            return (d.value || '').replace(/\D/g, '');
        })
        .join('');
}

function updateProfileTotpSetupCounter() {
    const el = document.getElementById('profileTotpSetupCounter');
    if (!el) return;
    el.textContent = `${getProfileTotpSetupConfirmCode().length}/6`;
}

function clearProfileTotpSetupDigits() {
    getProfileTotpSetupDigitInputs().forEach(function (d) {
        d.value = '';
        d.disabled = false;
    });
    updateProfileTotpSetupCounter();
    refreshTotpSetupStepperVerifyPhase();
}

function wireProfileTotpSetupDigits() {
    const digits = getProfileTotpSetupDigitInputs();
    if (!digits.length || digits[0].dataset.totpSetupDigitsWired === '1') return;
    digits[0].dataset.totpSetupDigitsWired = '1';
    digits.forEach(function (input, idx) {
        input.addEventListener('input', function (e) {
            var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
            e.target.value = v;
            updateProfileTotpSetupCounter();
            refreshTotpSetupStepperVerifyPhase();
            if (v && idx < digits.length - 1) {
                digits[idx + 1].focus();
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
            }
        });
        input.addEventListener('focusin', function () {
            refreshTotpSetupStepperVerifyPhase();
        });
        input.addEventListener('focusout', function () {
            setTimeout(refreshTotpSetupStepperVerifyPhase, 0);
        });
        input.addEventListener('paste', function (e) {
            e.preventDefault();
            var raw = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
            digits.forEach(function (d, i) {
                d.value = raw[i] || '';
            });
            updateProfileTotpSetupCounter();
            refreshTotpSetupStepperVerifyPhase();
            var next = raw.length >= 6 ? 5 : raw.length;
            if (digits[next]) {
                digits[next].focus();
            }
        });
    });
}

var PROFILE_TOTP_SETUP_SUBTITLE_PASSWORD = 'Enter your password to generate a QR code.';
var PROFILE_TOTP_SETUP_SUBTITLE_SCAN = 'Scan & verify to enable 2FA';

function setProfileTotpSetupSubtitle(text) {
    const el = document.getElementById('profileTotpSetupSubtitle');
    if (el) el.textContent = text || '';
}

function syncTotpSetupStepper(phase) {
    const root = document.getElementById('profileTotpSetupStepper');
    if (!root) return;
    var p = 'password';
    if (phase === 'scan') p = 'scan';
    else if (phase === 'verify') p = 'verify';
    root.dataset.phase = p;

    function sel(step) {
        return root.querySelectorAll('[data-setup-step="' + step + '"]');
    }

    function setStepState(step, state) {
        sel(step).forEach(function (el) {
            el.classList.remove('is-done', 'is-current', 'is-upcoming');
            if (state) el.classList.add('is-' + state);
        });
    }

    function setLine(n, active) {
        const line = root.querySelector('[data-setup-line="' + n + '"]');
        if (line) line.classList.toggle('is-active', !!active);
    }

    if (p === 'password') {
        setStepState(1, 'current');
        setStepState(2, 'upcoming');
        setStepState(3, 'upcoming');
        setLine(1, false);
        setLine(2, false);
    } else if (p === 'scan') {
        setStepState(1, 'done');
        setStepState(2, 'current');
        setStepState(3, 'upcoming');
        setLine(1, true);
        setLine(2, false);
    } else if (p === 'verify') {
        setStepState(1, 'done');
        setStepState(2, 'done');
        setStepState(3, 'current');
        setLine(1, true);
        setLine(2, true);
    }

    const setupPanel = document.getElementById('profileTotpModalSetup');
    if (setupPanel) setupPanel.dataset.totpStepperPhase = p;
}

function setProfileTotpQrUiPhase(phase) {
    const qr = document.getElementById('profileTotpQrBlock');
    const scanEl = document.getElementById('profileTotpScanPhase');
    const verEl = document.getElementById('profileTotpVerifyPhase');
    if (!qr) return;
    var v = phase === 'verify' ? 'verify' : 'scan';
    var prev = qr.dataset.qrUi || 'scan';
    qr.dataset.qrUi = v;
    if (scanEl) scanEl.hidden = v === 'verify';
    if (verEl) verEl.hidden = v !== 'verify';
    if (v === 'verify') {
        syncTotpSetupStepper('verify');
        if (prev === 'scan') {
            clearProfileTotpSetupDigits();
        }
        var digits = getProfileTotpSetupDigitInputs();
        setTimeout(function () {
            if (digits[0]) digits[0].focus();
        }, 50);
    } else {
        syncTotpSetupStepper('scan');
        if (prev === 'verify') {
            clearProfileTotpSetupDigits();
        }
    }
    applyTotpSetupPrimaryForQrUi();
}

/** Footer primary: scan phase → continue; verify phase → Enable 2FA. */
function applyTotpSetupPrimaryForQrUi() {
    const setup = document.getElementById('profileTotpModalSetup');
    const qr = document.getElementById('profileTotpQrBlock');
    const primary = document.getElementById('profileTotpModalPrimary');
    if (!setup || setup.hidden || !qr || qr.hidden || !primary) return;
    var ui = qr.dataset.qrUi || 'scan';
    if (ui === 'scan') {
        primary.classList.remove('is-loading', 'profile-totp-modal__btn--danger');
        primary.disabled = false;
        primary.innerHTML =
            '<i class="bi bi-arrow-right-circle" aria-hidden="true"></i> Continue to verification';
        primary.dataset.totpAction = 'setup-to-verify';
        return;
    }
    setPrimaryEnableTwoFaButton();
}

/** While QR step is visible: scan UI keeps step 2; verify UI keeps step 3. */
function refreshTotpSetupStepperVerifyPhase() {
    const qrBlock = document.getElementById('profileTotpQrBlock');
    if (!qrBlock || qrBlock.hidden) return;
    if ((qrBlock.dataset.qrUi || 'scan') === 'scan') {
        syncTotpSetupStepper('scan');
        return;
    }
    syncTotpSetupStepper('verify');
}

function setPrimaryShowQrCodeButton() {
    const primary = document.getElementById('profileTotpModalPrimary');
    if (!primary) return;
    primary.classList.remove('is-loading', 'profile-totp-modal__btn--danger');
    primary.disabled = false;
    primary.innerHTML = '<i class="bi bi-qr-code" aria-hidden="true"></i> Show QR code';
    primary.dataset.totpAction = 'setup-qr';
}

function setPrimaryEnableTwoFaButton() {
    const primary = document.getElementById('profileTotpModalPrimary');
    if (!primary) return;
    primary.classList.remove('is-loading', 'profile-totp-modal__btn--danger');
    primary.disabled = false;
    primary.innerHTML = '<i class="bi bi-shield-check" aria-hidden="true"></i> Enable 2FA';
    primary.dataset.totpAction = 'setup-confirm';
}

function setPrimaryLoadingLabel(label) {
    const primary = document.getElementById('profileTotpModalPrimary');
    if (!primary) return;
    primary.classList.add('is-loading');
    primary.disabled = true;
    primary.innerHTML =
        '<span class="profile-totp-modal__spinner" aria-hidden="true"></span><span>' +
        String(label || 'Loading…') +
        '</span>';
}

function resetTotpModal() {
    const modal = document.getElementById('profileTotpModal');
    const setup = document.getElementById('profileTotpModalSetup');
    const disable = document.getElementById('profileTotpModalDisable');
    const qrBlock = document.getElementById('profileTotpQrBlock');
    const pw = document.getElementById('profileTotpSetupPassword');
    const passStep = document.getElementById('profileTotpSetupPasswordStep');
    const dpw = document.getElementById('profileTotpDisablePassword');
    const primary = document.getElementById('profileTotpModalPrimary');
    if (modal) modal.hidden = true;
    if (setup) setup.hidden = true;
    if (disable) disable.hidden = true;
    if (qrBlock) qrBlock.hidden = true;
    if (qrBlock) qrBlock.removeAttribute('data-totp-secret');
    if (qrBlock) qrBlock.dataset.qrUi = 'scan';
    const scanPhReset = document.getElementById('profileTotpScanPhase');
    const verPhReset = document.getElementById('profileTotpVerifyPhase');
    if (scanPhReset) scanPhReset.hidden = false;
    if (verPhReset) verPhReset.hidden = true;
    const qrImg = document.getElementById('profileTotpQrImg');
    if (qrImg) qrImg.removeAttribute('src');
    if (passStep) passStep.hidden = false;
    if (pw) pw.value = '';
    if (dpw) dpw.value = '';
    clearProfileTotpDisableDigits();
    clearProfileTotpSetupDigits();
    syncTotpSetupStepper('password');
    setProfileTotpSetupSubtitle(PROFILE_TOTP_SETUP_SUBTITLE_PASSWORD);
    if (primary) {
        primary.disabled = false;
        primary.classList.remove('profile-totp-modal__btn--danger', 'is-loading');
        primary.textContent = 'Continue';
    }
    const dialog = document.querySelector('.profile-totp-modal__dialog');
    if (dialog) dialog.setAttribute('aria-labelledby', 'profileTotpModalTitle');
    syncProfileModalBodyScrollLock();
}

function openTotpModal() {
    const modal = document.getElementById('profileTotpModal');
    if (!modal) return;
    modal.hidden = false;
    syncProfileModalBodyScrollLock();
}

function openTotpSetupModal() {
    const setup = document.getElementById('profileTotpModalSetup');
    const disable = document.getElementById('profileTotpModalDisable');
    const title = document.getElementById('profileTotpModalTitle');
    const qrBlock = document.getElementById('profileTotpQrBlock');
    const passStep = document.getElementById('profileTotpSetupPasswordStep');
    if (disable) disable.hidden = true;
    if (setup) setup.hidden = false;
    if (passStep) passStep.hidden = false;
    if (title) title.textContent = 'Set up authenticator';
    if (qrBlock) qrBlock.hidden = true;
    if (qrBlock) qrBlock.removeAttribute('data-totp-secret');
    if (qrBlock) qrBlock.dataset.qrUi = 'scan';
    const scanPhOpen = document.getElementById('profileTotpScanPhase');
    const verPhOpen = document.getElementById('profileTotpVerifyPhase');
    if (scanPhOpen) scanPhOpen.hidden = false;
    if (verPhOpen) verPhOpen.hidden = true;
    const img = document.getElementById('profileTotpQrImg');
    if (img) img.removeAttribute('src');
    const pw = document.getElementById('profileTotpSetupPassword');
    if (pw) pw.value = '';
    clearProfileTotpSetupDigits();
    syncTotpSetupStepper('password');
    setProfileTotpSetupSubtitle(PROFILE_TOTP_SETUP_SUBTITLE_PASSWORD);
    setPrimaryShowQrCodeButton();
    const dialog = document.querySelector('.profile-totp-modal__dialog');
    if (dialog) dialog.setAttribute('aria-labelledby', 'profileTotpModalTitle');
    openTotpModal();
    setTimeout(function () {
        if (pw) pw.focus();
    }, 50);
}

function openTotpDisableModal() {
    const setup = document.getElementById('profileTotpModalSetup');
    const disable = document.getElementById('profileTotpModalDisable');
    const primary = document.getElementById('profileTotpModalPrimary');
    if (setup) setup.hidden = true;
    if (disable) disable.hidden = false;
    const dpw = document.getElementById('profileTotpDisablePassword');
    if (dpw) dpw.value = '';
    clearProfileTotpDisableDigits();
    if (primary) {
        primary.disabled = false;
        primary.dataset.totpAction = 'disable';
        setProfileTotpDisablePrimaryButton();
    }
    const dialog = document.querySelector('.profile-totp-modal__dialog');
    if (dialog) dialog.setAttribute('aria-labelledby', 'profileTotpDisableTitle');
    openTotpModal();
    setTimeout(function () {
        if (dpw) dpw.focus();
    }, 50);
}

function wireProfileTotpModal() {
    const modal = document.getElementById('profileTotpModal');
    if (!modal || modal.dataset.wired === '1') return;
    modal.dataset.wired = '1';

    const backdrop = document.getElementById('profileTotpModalBackdrop');
    const cancel = document.getElementById('profileTotpModalCancel');
    const primary = document.getElementById('profileTotpModalPrimary');

    function close() {
        resetTotpModal();
        hydrateSecurity2fa();
    }

    if (backdrop) backdrop.addEventListener('click', close);
    if (cancel) cancel.addEventListener('click', close);
    const closeBtn = document.getElementById('profileTotpModalCloseBtn');
    if (closeBtn) closeBtn.addEventListener('click', close);

    wireProfileTotpDisableDigits();
    wireProfileTotpSetupDigits();

    const copySecretBtn = document.getElementById('profileTotpCopySecretBtn');
    if (copySecretBtn) {
        copySecretBtn.addEventListener('click', function () {
            const qrBlock = document.getElementById('profileTotpQrBlock');
            const secret = (qrBlock && qrBlock.getAttribute('data-totp-secret')) || '';
            if (!secret.trim()) {
                showNotification('Secret key is not available yet.', 'warning');
                return;
            }
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard
                    .writeText(secret.trim())
                    .then(function () {
                        showNotification('Secret key copied to clipboard.', 'success');
                    })
                    .catch(function () {
                        showNotification('Could not copy to clipboard.', 'error');
                    });
            } else {
                showNotification('Clipboard is not supported in this browser.', 'warning');
            }
        });
    }

    if (primary) {
        primary.addEventListener('click', function () {
            void (async function () {
            const user = getStoredDiariUser();
            const uid = user && user.id != null ? Number(user.id) : 0;
            if (!uid) {
                showNotification('Sign in to manage two-factor authentication.', 'warning');
                close();
                return;
            }
            if (await isPwaOfflineForUserActions()) {
                showPwaTotpInternetToast();
                if (primary.dataset.totpAction === 'setup-qr') setPrimaryShowQrCodeButton();
                else if (primary.dataset.totpAction === 'setup-confirm') setPrimaryEnableTwoFaButton();
                else setProfileTotpDisablePrimaryButton();
                return;
            }
            const action = primary.dataset.totpAction || '';

            if (action === 'setup-to-verify') {
                setProfileTotpQrUiPhase('verify');
                return;
            }

            if (action === 'setup-qr') {
                const password = (document.getElementById('profileTotpSetupPassword')?.value || '').trim();
                if (!password) {
                    showNotification('Enter your password to continue.', 'warning');
                    return;
                }
                setPrimaryLoadingLabel('Loading…');
                fetch('/api/user/totp/setup', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: uid, password: password }),
                })
                    .then(function (res) {
                        return res.json().then(function (data) {
                            return { ok: res.ok, data: data };
                        });
                    })
                    .then(function (_ref) {
                        var ok = _ref.ok;
                        var data = _ref.data;
                        if (!ok || !data.success) {
                            showNotification(data.error || 'Could not start setup.', 'error');
                            setPrimaryShowQrCodeButton();
                            return;
                        }
                        const img = document.getElementById('profileTotpQrImg');
                        if (img && data.qrDataUri) img.src = data.qrDataUri;
                        const qrBlock = document.getElementById('profileTotpQrBlock');
                        const passStep = document.getElementById('profileTotpSetupPasswordStep');
                        if (passStep) passStep.hidden = true;
                        if (qrBlock) {
                            qrBlock.hidden = false;
                            if (data.totpSecret) {
                                qrBlock.setAttribute('data-totp-secret', String(data.totpSecret));
                            } else {
                                qrBlock.removeAttribute('data-totp-secret');
                            }
                        }
                        setProfileTotpSetupSubtitle(PROFILE_TOTP_SETUP_SUBTITLE_SCAN);
                        clearProfileTotpSetupDigits();
                        setProfileTotpQrUiPhase('scan');
                    })
                    .catch(function () {
                        setPrimaryShowQrCodeButton();
                        if (isPwaProfileContext()) showPwaTotpInternetToast();
                        else showNotification('Could not reach the server.', 'error');
                    });
                return;
            }

            if (action === 'setup-confirm') {
                const code = getProfileTotpSetupConfirmCode();
                if (code.length !== 6) {
                    showNotification('Enter the 6-digit code from your app.', 'warning');
                    return;
                }
                setPrimaryLoadingLabel('Enabling…');
                syncTotpSetupStepper('verify');
                fetch('/api/user/totp/confirm', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: uid, code: code }),
                })
                    .then(function (res) {
                        return res.json().then(function (data) {
                            return { ok: res.ok, data: data };
                        });
                    })
                    .then(function (_ref2) {
                        var ok2 = _ref2.ok;
                        var data2 = _ref2.data;
                        if (!ok2 || !data2.success) {
                            showNotification(data2.error || 'Invalid code.', 'error');
                            setPrimaryEnableTwoFaButton();
                            refreshTotpSetupStepperVerifyPhase();
                            return;
                        }
                        mergeDiariUserIntoStorage(data2.user);
                        hydrateSecurity2fa();
                        initializeProfileFromStorage();
                        showNotification('Two-factor authentication is enabled.', 'success');
                        resetTotpModal();
                    })
                    .catch(function () {
                        setPrimaryEnableTwoFaButton();
                        refreshTotpSetupStepperVerifyPhase();
                        if (isPwaProfileContext()) showPwaTotpInternetToast();
                        else showNotification('Could not reach the server.', 'error');
                    });
                return;
            }

            if (action === 'disable') {
                const password = (document.getElementById('profileTotpDisablePassword')?.value || '').trim();
                const code = getProfileTotpDisableCode();
                if (!password || code.length !== 6) {
                    showNotification('Enter your password and a 6-digit code.', 'warning');
                    return;
                }
                primary.classList.add('profile-totp-modal__btn--danger');
                setPrimaryLoadingLabel('Disabling…');
                fetch('/api/user/totp/disable', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId: uid, password: password, code: code }),
                })
                    .then(function (res) {
                        return res.json().then(function (data) {
                            return { ok: res.ok, data: data };
                        });
                    })
                    .then(function (_ref3) {
                        var ok3 = _ref3.ok;
                        var data3 = _ref3.data;
                        primary.disabled = false;
                        setProfileTotpDisablePrimaryButton();
                        if (!ok3 || !data3.success) {
                            showNotification(data3.error || 'Could not disable 2FA.', 'error');
                            return;
                        }
                        mergeDiariUserIntoStorage(data3.user);
                        hydrateSecurity2fa();
                        initializeProfileFromStorage();
                        showNotification('Two-factor authentication is disabled.', 'success');
                        resetTotpModal();
                    })
                    .catch(function () {
                        primary.disabled = false;
                        setProfileTotpDisablePrimaryButton();
                        if (isPwaProfileContext()) showPwaTotpInternetToast();
                        else showNotification('Could not reach the server.', 'error');
                    });
            }
            })();
        });
    }
}

function finishProfilePersonalSaveSuccess(serverUser) {
    if (!serverUser || typeof serverUser !== 'object') {
        refreshProfilePersonalSaveButton();
        showNotification('Invalid response from server.', 'error');
        return;
    }
    mergeDiariUserIntoStorage(serverUser);
    try {
        localStorage.removeItem('diariCoreSyncRevision');
    } catch (_) {
        /* ignore */
    }
    if (window.DiariOffline?.pullRemoteStateForRefresh) {
        void window.DiariOffline.pullRemoteStateForRefresh({ force: true });
    }
    initializeProfileFromStorage();
    showNotification('Profile updated.', 'success');
    closeProfileSection();
}

function getProfileEmailChangeOtpDigitInputs() {
    return Array.from(document.querySelectorAll('[data-profile-email-change-otp]'));
}

function getProfileEmailChangeOtpCode() {
    return getProfileEmailChangeOtpDigitInputs()
        .map(function (d) {
            return (d.value || '').replace(/\D/g, '');
        })
        .join('');
}

function clearProfileEmailChangeOtpDigits() {
    getProfileEmailChangeOtpDigitInputs().forEach(function (d) {
        d.value = '';
        d.disabled = false;
    });
}

function setProfileEmailChangeOtpError(message) {
    const wrap = document.getElementById('profileEmailChangeOtpError');
    const text = document.getElementById('profileEmailChangeOtpErrorText');
    if (!wrap || !text) return;
    if (message) {
        text.textContent = message;
        wrap.hidden = false;
    } else {
        text.textContent = '';
        wrap.hidden = true;
    }
}

function clearProfileEmailChangeResendCooldown() {
    if (profileEmailChangeOtpResendInterval) {
        clearInterval(profileEmailChangeOtpResendInterval);
        profileEmailChangeOtpResendInterval = null;
    }
    profileEmailChangeOtpResendRemaining = 0;
    const timer = document.getElementById('profileEmailChangeOtpTimer');
    if (timer) timer.textContent = '00:00';
    const btn = document.getElementById('profileEmailChangeOtpResendBtn');
    if (btn) btn.disabled = false;
    const cooldownRow = document.getElementById('profileEmailChangeOtpCooldownRow');
    const resendRow = document.getElementById('profileEmailChangeOtpResendRow');
    if (cooldownRow) cooldownRow.hidden = true;
    if (resendRow) resendRow.hidden = false;
}

function startProfileEmailChangeResendCooldown(seconds) {
    const btn = document.getElementById('profileEmailChangeOtpResendBtn');
    const timer = document.getElementById('profileEmailChangeOtpTimer');
    const cooldownRow = document.getElementById('profileEmailChangeOtpCooldownRow');
    const resendRow = document.getElementById('profileEmailChangeOtpResendRow');
    profileEmailChangeOtpResendRemaining = seconds;
    if (btn) btn.disabled = true;
    if (cooldownRow) cooldownRow.hidden = false;
    if (resendRow) resendRow.hidden = true;
    if (profileEmailChangeOtpResendInterval) clearInterval(profileEmailChangeOtpResendInterval);
    function tick() {
        if (profileEmailChangeOtpResendRemaining <= 0) {
            clearProfileEmailChangeResendCooldown();
            return;
        }
        const mm = Math.floor(profileEmailChangeOtpResendRemaining / 60);
        const ss = profileEmailChangeOtpResendRemaining % 60;
        if (timer) {
            timer.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        profileEmailChangeOtpResendRemaining -= 1;
    }
    tick();
    profileEmailChangeOtpResendInterval = setInterval(tick, 1000);
}

function setProfileEmailChangeOtpVerifyLoading(isLoading) {
    const btn = document.getElementById('profileEmailChangeOtpVerifyBtn');
    if (!btn) return;
    const label = btn.querySelector('.profile-pwd-change-otp-modal__verify-label');
    if (isLoading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        if (label) label.textContent = 'Verifying…';
    } else {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        if (label) label.textContent = 'Verify';
    }
}

function setProfileEmailChangeOtpResendLoading(isLoading) {
    const btn = document.getElementById('profileEmailChangeOtpResendBtn');
    if (!btn) return;
    const label = btn.querySelector('.profile-pwd-change-otp-modal__resend-label');
    if (isLoading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        if (label) label.textContent = 'Sending…';
    } else {
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
        if (label) label.textContent = 'Resend code';
    }
}

function clearProfileEmailChangeOtpAutoVerify() {
    if (profileEmailChangeOtpAutoVerifyTimeout) {
        clearTimeout(profileEmailChangeOtpAutoVerifyTimeout);
        profileEmailChangeOtpAutoVerifyTimeout = null;
    }
}

function scheduleProfileEmailChangeOtpAutoVerify() {
    clearProfileEmailChangeOtpAutoVerify();
    profileEmailChangeOtpAutoVerifyTimeout = setTimeout(function () {
        profileEmailChangeOtpAutoVerifyTimeout = null;
        const modal = document.getElementById('profileEmailChangeOtpModal');
        if (!modal || modal.hidden) return;
        if (getProfileEmailChangeOtpCode().length !== 6) return;
        if (profileEmailChangeOtpVerifyInProgress) return;
        void verifyProfileEmailChangeOtp();
    }, 260);
}

function openProfileEmailChangeOtpModal(newEmail) {
    const modal = document.getElementById('profileEmailChangeOtpModal');
    if (!modal) return;
    clearProfileEmailChangeOtpAutoVerify();
    profileEmailChangeOtpVerifyInProgress = false;
    setProfileEmailChangeOtpVerifyLoading(false);
    setProfileEmailChangeOtpError('');
    clearProfileEmailChangeOtpDigits();
    const lead = document.getElementById('profileEmailChangeOtpLead');
    if (lead) {
        lead.textContent = `We sent a 6-digit code to ${String(newEmail || '').trim()}. Enter it below to save your profile.`;
    }
    modal.hidden = false;
    syncProfileModalBodyScrollLock();
    startProfileEmailChangeResendCooldown(60);
    const first = getProfileEmailChangeOtpDigitInputs()[0];
    if (first) setTimeout(function () { first.focus(); }, 80);
}

function closeProfileEmailChangeOtpModal() {
    const modal = document.getElementById('profileEmailChangeOtpModal');
    if (!modal || modal.hidden) return;
    clearProfileEmailChangeOtpAutoVerify();
    modal.hidden = true;
    syncProfileModalBodyScrollLock();
    clearProfileEmailChangeResendCooldown();
    profileEmailChangeOtpVerifyInProgress = false;
    setProfileEmailChangeOtpVerifyLoading(false);
}

function wireProfileEmailChangeOtpDigits() {
    const digits = getProfileEmailChangeOtpDigitInputs();
    if (!digits.length || digits[0].dataset.emailChangeOtpWired === '1') return;
    digits[0].dataset.emailChangeOtpWired = '1';
    digits.forEach(function (input, idx) {
        input.addEventListener('input', function (e) {
            var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
            e.target.value = v;
            setProfileEmailChangeOtpError('');
            if (v && idx < digits.length - 1) {
                digits[idx + 1].focus();
            }
            clearProfileEmailChangeOtpAutoVerify();
            if (getProfileEmailChangeOtpCode().length === 6) {
                scheduleProfileEmailChangeOtpAutoVerify();
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
            }
        });
        input.addEventListener('paste', function (e) {
            e.preventDefault();
            var raw = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
            digits.forEach(function (d, i) {
                d.value = raw[i] || '';
            });
            var lastIdx = Math.min(raw.length, digits.length) - 1;
            if (lastIdx >= 0) digits[lastIdx].focus();
            setProfileEmailChangeOtpError('');
            clearProfileEmailChangeOtpAutoVerify();
            if (getProfileEmailChangeOtpCode().length === 6) {
                scheduleProfileEmailChangeOtpAutoVerify();
            }
        });
    });
}

async function submitProfileEmailChangeResend() {
    const user = getStoredDiariUser();
    if (!user || !user.id) {
        showNotification('Sign in to continue.', 'warning');
        return false;
    }
    setProfileEmailChangeOtpResendLoading(true);
    try {
        const res = await fetch('/api/user/profile/email-change-resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id }),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
            showNotification(data.error || 'Could not resend code.', 'warning');
            return false;
        }
        showNotification(data.message || 'A new code was sent.', 'success');
        clearProfileEmailChangeOtpDigits();
        setProfileEmailChangeOtpError('');
        startProfileEmailChangeResendCooldown(60);
        return true;
    } catch (_) {
        showNotification('Could not resend code. Check your connection.', 'error');
        return false;
    } finally {
        setProfileEmailChangeOtpResendLoading(false);
        const btn = document.getElementById('profileEmailChangeOtpResendBtn');
        if (btn && !profileEmailChangeOtpResendInterval && profileEmailChangeOtpResendRemaining <= 0) {
            btn.disabled = false;
        }
    }
}

async function verifyProfileEmailChangeOtp() {
    if (profileEmailChangeOtpVerifyInProgress) return;
    const user = getStoredDiariUser();
    if (!user || !user.id) return;
    const code = getProfileEmailChangeOtpCode();
    if (code.length !== 6) {
        setProfileEmailChangeOtpError('Please enter the 6-digit code from your email.');
        return;
    }
    const uid = typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10);
    if (!uid || Number.isNaN(uid)) {
        setProfileEmailChangeOtpError('Your session is invalid. Please sign in again.');
        return;
    }
    clearProfileEmailChangeOtpAutoVerify();
    profileEmailChangeOtpVerifyInProgress = true;
    setProfileEmailChangeOtpVerifyLoading(true);
    setProfileEmailChangeOtpError('');
    try {
        const controller = new AbortController();
        const abortTimer = setTimeout(function () {
            controller.abort();
        }, 30000);
        let res;
        try {
            res = await fetch('/api/user/profile/email-change-confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: uid, code: code }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(abortTimer);
        }
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
            setProfileEmailChangeOtpError(data.error || 'Invalid or expired verification code.');
            const fid = data.field;
            if (fid) {
                const fel = document.getElementById(fid);
                if (fel) profilePersonalShowError(fel, data.error || '');
            }
            return;
        }
        if (!data.user || typeof data.user !== 'object') {
            setProfileEmailChangeOtpError('Invalid response from server.');
            return;
        }
        clearProfileEmailChangeOtpAutoVerify();
        closeProfileEmailChangeOtpModal();
        finishProfilePersonalSaveSuccess(data.user);
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        setProfileEmailChangeOtpError(
            aborted
                ? 'Request timed out. Check your connection and tap Verify again.'
                : 'Could not reach the server. Check your connection and try again.'
        );
    } finally {
        profileEmailChangeOtpVerifyInProgress = false;
        setProfileEmailChangeOtpVerifyLoading(false);
    }
}

function wireProfileEmailChangeOtpFlow() {
    wireProfileEmailChangeOtpDigits();
    const backdrop = document.getElementById('profileEmailChangeOtpBackdrop');
    const closeBtn = document.getElementById('profileEmailChangeOtpCloseBtn');
    const cancelBtn = document.getElementById('profileEmailChangeOtpCancelBtn');
    [backdrop, closeBtn, cancelBtn].forEach(function (el) {
        if (el && !el.dataset.emailChangeOtpCloseWired) {
            el.dataset.emailChangeOtpCloseWired = '1';
            el.addEventListener('click', function () {
                closeProfileEmailChangeOtpModal();
            });
        }
    });
    const verifyBtn = document.getElementById('profileEmailChangeOtpVerifyBtn');
    if (verifyBtn && !verifyBtn.dataset.emailChangeVerifyWired) {
        verifyBtn.dataset.emailChangeVerifyWired = '1';
        verifyBtn.addEventListener('click', function () {
            void verifyProfileEmailChangeOtp();
        });
    }
    const resendBtn = document.getElementById('profileEmailChangeOtpResendBtn');
    if (resendBtn && !resendBtn.dataset.emailChangeResendWired) {
        resendBtn.dataset.emailChangeResendWired = '1';
        resendBtn.addEventListener('click', function () {
            void submitProfileEmailChangeResend();
        });
    }
}

function savePersonalInfoForm() {
    const user = getStoredDiariUser();
    if (!user || typeof user !== 'object') {
        showNotification('Sign in to save profile details.', 'warning');
        return;
    }

    const first = (document.getElementById('profileFieldFirstName')?.value || '').trim();
    const last = (document.getElementById('profileFieldLastName')?.value || '').trim();
    const nick = (document.getElementById('profileFieldNickname')?.value || '').trim();
    const email = (document.getElementById('profileFieldEmail')?.value || '').trim();
    const gender = (document.getElementById('profileFieldGender')?.value || '').trim();
    const bday = (document.getElementById('profileFieldBirthday')?.value || '').trim();

    const saveBtn = document.getElementById('profilePersonalSaveBtn');
    void (async function () {
        const offline = await isPwaOfflineForUserActions();
        if (offline && isPwaProfileContext()) {
            if (!isProfilePersonalFormValidForPwaOffline()) {
                showNotification('Please fix the highlighted fields before saving.', 'warning');
                return;
            }
            if (profilePersonalNicknameEmailChangedFromStored(user, nick, email)) {
                showPwaInternetRequiredToast();
                return;
            }
            if (saveBtn) saveBtn.disabled = true;
            const patch = {
                firstName: first,
                lastName: last,
                gender: gender || null,
                birthday: bday || null,
            };
            if (window.DiariOffline?.savePwaProfilePending) {
                window.DiariOffline.savePwaProfilePending(patch);
            }
            if (saveBtn) saveBtn.disabled = false;
            refreshProfilePersonalSaveButton();
            finishProfilePersonalSaveSuccessOffline(patch);
            return;
        }

        if (!isProfilePersonalFormValid()) {
            showNotification('Please fix the highlighted fields before saving.', 'warning');
            return;
        }

        const availabilityChecks = [
            checkProfilePersonalAvailability('profileFieldNickname', nick),
            checkProfilePersonalAvailability('profileFieldEmail', email),
        ];
        return Promise.all(availabilityChecks);
    })().then(async function (results) {
        if (!results) return;
        if (!results[0] || !results[1]) {
            refreshProfilePersonalSaveButton();
            showNotification('Username or email is not available.', 'warning');
            return;
        }
        const uid = Number(user.id ?? user.userId ?? 0);
        if (!Number.isInteger(uid) || uid <= 0) {
            showNotification('Sign in to save profile details.', 'warning');
            return;
        }
        const originalEmail = String(user.email || '')
            .trim()
            .toLowerCase();
        const newEmailNorm = email.trim().toLowerCase();
        const emailChanged = newEmailNorm !== originalEmail;

        const profileBody = {
            userId: uid,
            firstName: first,
            lastName: last,
            nickname: nick,
            email: email,
            gender: gender || null,
            birthday: bday || null,
        };

        if (saveBtn) saveBtn.disabled = true;

        if (emailChanged) {
            fetch('/api/user/profile/email-change-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(profileBody),
            })
                .then(function (res) {
                    return res.json().then(function (data) {
                        return { ok: res.ok, data: data };
                    });
                })
                .then(function (ref) {
                    if (saveBtn) saveBtn.disabled = false;
                    const data = ref.data || {};
                    if (!ref.ok || !data.success) {
                        refreshProfilePersonalSaveButton();
                        const msg = data.error || 'Could not send verification email.';
                        showNotification(msg, 'error');
                        const fid = data.field;
                        if (fid) {
                            const fel = document.getElementById(fid);
                            if (fel) profilePersonalShowError(fel, msg);
                        }
                        return;
                    }
                    showNotification(
                        data.message || 'Check your new email for a verification code.',
                        'success'
                    );
                    openProfileEmailChangeOtpModal(email.trim());
                })
                .catch(async function () {
                    if (saveBtn) saveBtn.disabled = false;
                    refreshProfilePersonalSaveButton();
                    if (await isPwaOfflineForUserActions()) {
                        showPwaInternetRequiredToast();
                    } else {
                        showNotification('Could not reach the server.', 'error');
                    }
                });
            return;
        }

        fetch('/api/user/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(profileBody),
        })
            .then(function (res) {
                return res.json().then(function (data) {
                    return { ok: res.ok, data: data };
                });
            })
            .then(function (ref) {
                if (saveBtn) saveBtn.disabled = false;
                const data = ref.data || {};
                if (!ref.ok || !data.success) {
                    refreshProfilePersonalSaveButton();
                    const msg = data.error || 'Could not save profile.';
                    showNotification(msg, 'error');
                    const fid = data.field;
                    if (fid) {
                        const fel = document.getElementById(fid);
                        if (fel) profilePersonalShowError(fel, msg);
                    }
                    return;
                }
                finishProfilePersonalSaveSuccess(data.user);
            })
            .catch(function () {
                if (saveBtn) saveBtn.disabled = false;
                refreshProfilePersonalSaveButton();
                showNotification('Could not reach the server.', 'error');
            });
    });
}

function getProfilePwdChangePayload() {
    const user = getStoredDiariUser();
    return {
        userId: user && user.id,
        currentPassword: (document.getElementById('profileSecCurrentPassword')?.value || '').trim(),
        newPassword: document.getElementById('profileSecNewPassword')?.value || '',
        confirmPassword: document.getElementById('profileSecConfirmPassword')?.value || '',
    };
}

function getProfilePwdChangeOtpDigitInputs() {
    return Array.from(document.querySelectorAll('[data-profile-pwd-change-otp]'));
}

function getProfilePwdChangeOtpCode() {
    return getProfilePwdChangeOtpDigitInputs()
        .map(function (d) {
            return (d.value || '').replace(/\D/g, '');
        })
        .join('');
}

function clearProfilePwdChangeOtpDigits() {
    getProfilePwdChangeOtpDigitInputs().forEach(function (d) {
        d.value = '';
        d.disabled = false;
    });
}

function setProfilePwdChangeOtpError(message) {
    const wrap = document.getElementById('profilePwdChangeOtpError');
    const text = document.getElementById('profilePwdChangeOtpErrorText');
    if (!wrap || !text) return;
    if (message) {
        text.textContent = message;
        wrap.hidden = false;
    } else {
        text.textContent = '';
        wrap.hidden = true;
    }
}

function clearProfilePwdChangeResendCooldown() {
    if (profilePwdChangeOtpResendInterval) {
        clearInterval(profilePwdChangeOtpResendInterval);
        profilePwdChangeOtpResendInterval = null;
    }
    profilePwdChangeOtpResendRemaining = 0;
    const timer = document.getElementById('profilePwdChangeOtpTimer');
    if (timer) timer.textContent = '00:00';
    const btn = document.getElementById('profilePwdChangeOtpResendBtn');
    if (btn) btn.disabled = false;
    const cooldownRow = document.getElementById('profilePwdChangeOtpCooldownRow');
    const resendRow = document.getElementById('profilePwdChangeOtpResendRow');
    if (cooldownRow) cooldownRow.hidden = true;
    if (resendRow) resendRow.hidden = false;
}

function startProfilePwdChangeResendCooldown(seconds) {
    const btn = document.getElementById('profilePwdChangeOtpResendBtn');
    const timer = document.getElementById('profilePwdChangeOtpTimer');
    const cooldownRow = document.getElementById('profilePwdChangeOtpCooldownRow');
    const resendRow = document.getElementById('profilePwdChangeOtpResendRow');
    profilePwdChangeOtpResendRemaining = seconds;
    if (btn) btn.disabled = true;
    if (cooldownRow) cooldownRow.hidden = false;
    if (resendRow) resendRow.hidden = true;
    if (profilePwdChangeOtpResendInterval) clearInterval(profilePwdChangeOtpResendInterval);
    function tick() {
        if (profilePwdChangeOtpResendRemaining <= 0) {
            clearProfilePwdChangeResendCooldown();
            return;
        }
        const mm = Math.floor(profilePwdChangeOtpResendRemaining / 60);
        const ss = profilePwdChangeOtpResendRemaining % 60;
        if (timer) {
            timer.textContent = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        profilePwdChangeOtpResendRemaining -= 1;
    }
    tick();
    profilePwdChangeOtpResendInterval = setInterval(tick, 1000);
}

function setProfilePwdChangeOtpVerifyLoading(isLoading) {
    const btn = document.getElementById('profilePwdChangeOtpVerifyBtn');
    if (!btn) return;
    const label = btn.querySelector('.profile-pwd-change-otp-modal__verify-label');
    if (isLoading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        if (label) label.textContent = 'Verifying…';
    } else {
        btn.classList.remove('is-loading');
        btn.disabled = false;
        if (label) label.textContent = 'Verify';
    }
}

function clearProfilePwdChangeOtpAutoVerify() {
    if (profilePwdChangeOtpAutoVerifyTimeout) {
        clearTimeout(profilePwdChangeOtpAutoVerifyTimeout);
        profilePwdChangeOtpAutoVerifyTimeout = null;
    }
}

function scheduleProfilePwdChangeOtpAutoVerify() {
    clearProfilePwdChangeOtpAutoVerify();
    profilePwdChangeOtpAutoVerifyTimeout = setTimeout(function () {
        profilePwdChangeOtpAutoVerifyTimeout = null;
        const modal = document.getElementById('profilePwdChangeOtpModal');
        if (!modal || modal.hidden) return;
        if (getProfilePwdChangeOtpCode().length !== 6) return;
        if (profilePwdChangeOtpVerifyInProgress) return;
        void verifyProfilePasswordChangeOtp();
    }, 260);
}

function openProfilePwdChangeOtpModal() {
    const modal = document.getElementById('profilePwdChangeOtpModal');
    if (!modal) return;
    clearProfilePwdChangeOtpAutoVerify();
    profilePwdChangeOtpVerifyInProgress = false;
    setProfilePwdChangeOtpVerifyLoading(false);
    setProfilePwdChangeOtpError('');
    clearProfilePwdChangeOtpDigits();
    modal.hidden = false;
    syncProfileModalBodyScrollLock();
    startProfilePwdChangeResendCooldown(60);
    const first = getProfilePwdChangeOtpDigitInputs()[0];
    if (first) setTimeout(function () { first.focus(); }, 80);
}

function closeProfilePwdChangeOtpModal() {
    const modal = document.getElementById('profilePwdChangeOtpModal');
    if (!modal || modal.hidden) return;
    clearProfilePwdChangeOtpAutoVerify();
    modal.hidden = true;
    syncProfileModalBodyScrollLock();
    clearProfilePwdChangeResendCooldown();
    profilePwdChangeOtpVerifyInProgress = false;
    setProfilePwdChangeOtpVerifyLoading(false);
}

function destroyProfilePwdChangeSuccessAnim() {
    if (profilePwdChangeSuccessAnim && typeof profilePwdChangeSuccessAnim.destroy === 'function') {
        try {
            profilePwdChangeSuccessAnim.destroy();
        } catch (_) {}
    }
    profilePwdChangeSuccessAnim = null;
    const mount = document.getElementById('profilePwdChangeSuccessLottie');
    if (mount) {
        mount.innerHTML = '';
        delete mount.dataset.lottieReady;
    }
}

function clearProfilePwdChangeSuccessRedirectAnim() {
    if (profilePwdChangeSuccessRedirectInterval) {
        clearInterval(profilePwdChangeSuccessRedirectInterval);
        profilePwdChangeSuccessRedirectInterval = null;
    }
}

function setProfilePwdChangeOtpResendLoading(isLoading) {
    const btn = document.getElementById('profilePwdChangeOtpResendBtn');
    if (!btn) return;
    const label = btn.querySelector('.profile-pwd-change-otp-modal__resend-label');
    if (isLoading) {
        btn.classList.add('is-loading');
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        if (label) label.textContent = 'Sending…';
    } else {
        btn.classList.remove('is-loading');
        btn.removeAttribute('aria-busy');
        if (label) label.textContent = 'Resend code';
    }
}

function performProfileLogout() {
    if (window.DiariTheme && typeof window.DiariTheme.logout === 'function') {
        window.DiariTheme.logout('login.html');
        return;
    }
    try {
        localStorage.removeItem('diariCoreUser');
    } catch (_) {}
    window.location.href = 'login.html';
}

function openProfilePwdChangeSuccessModalThenLogout() {
    if (profilePwdChangeSuccessLogoutTimer) {
        clearTimeout(profilePwdChangeSuccessLogoutTimer);
        profilePwdChangeSuccessLogoutTimer = null;
    }
    clearProfilePwdChangeSuccessRedirectAnim();
    const modal = document.getElementById('profilePwdChangeSuccessModal');
    const mount = document.getElementById('profilePwdChangeSuccessLottie');
    const labelEl = document.getElementById('profilePwdChangeSuccessRedirectLabel');
    const fillEl = document.getElementById('profilePwdChangeSuccessRedirectFill');
    if (!modal || !mount) {
        performProfileLogout();
        return;
    }
    modal.hidden = false;
    syncProfileModalBodyScrollLock();

    destroyProfilePwdChangeSuccessAnim();
    mount.innerHTML = '';
    if (typeof window.lottie !== 'undefined' && typeof window.lottie.loadAnimation === 'function') {
        try {
            profilePwdChangeSuccessAnim = window.lottie.loadAnimation({
                container: mount,
                renderer: 'svg',
                loop: true,
                autoplay: true,
                path: 'noto-emoji/loading.json',
            });
        } catch (_) {
            profilePwdChangeSuccessAnim = null;
        }
    }

    const redirectMs = 5000;
    const start = Date.now();
    if (labelEl) labelEl.textContent = 'Redirecting to login in 5s...';
    if (fillEl) fillEl.style.width = '0%';

    function tickRedirectUi() {
        const elapsed = Date.now() - start;
        const rem = Math.max(0, Math.ceil((redirectMs - elapsed) / 1000));
        if (labelEl) labelEl.textContent = `Redirecting to login in ${rem}s...`;
        if (fillEl) fillEl.style.width = `${Math.min(100, (elapsed / redirectMs) * 100)}%`;
    }
    tickRedirectUi();
    profilePwdChangeSuccessRedirectInterval = setInterval(tickRedirectUi, 200);

    profilePwdChangeSuccessLogoutTimer = setTimeout(function () {
        profilePwdChangeSuccessLogoutTimer = null;
        clearProfilePwdChangeSuccessRedirectAnim();
        if (labelEl) labelEl.textContent = 'Redirecting to login in 0s...';
        if (fillEl) fillEl.style.width = '100%';
        modal.hidden = true;
        syncProfileModalBodyScrollLock();
        destroyProfilePwdChangeSuccessAnim();
        performProfileLogout();
    }, redirectMs);
}

async function submitProfilePasswordChangeRequest(isResend) {
    const user = getStoredDiariUser();
    if (!user || !user.id) {
        showNotification('Sign in to change your password.', 'warning');
        return false;
    }
    const p = getProfilePwdChangePayload();
    if (!p.currentPassword || !p.newPassword || !p.confirmPassword) {
        if (!isResend) {
            showNotification(
                'To change your password, enter your current password, a new password, and confirmation. Use the switch above for two-factor authentication.',
                'info'
            );
        }
        return false;
    }
    if (p.newPassword !== p.confirmPassword) {
        showNotification('New password and confirmation do not match.', 'warning');
        return false;
    }
    if (profileSecPwLiveInst && typeof profileSecPwLiveInst.refresh === 'function') {
        const r = profileSecPwLiveInst.refresh();
        if (!r || !r.ready) {
            if (!isResend) {
                showNotification('Please meet all password requirements before continuing.', 'warning');
            }
            return false;
        }
    } else if (
        window.DiariPasswordPolicy &&
        !window.DiariPasswordPolicy.isPasswordSubmitReady(p.newPassword, p.confirmPassword, getProfileSecurityPersonal())
    ) {
        if (!isResend) {
            showNotification('Please meet all password requirements before continuing.', 'warning');
        }
        return false;
    }
    if (await isPwaOfflineForUserActions()) {
        showPwaPasswordInternetToast();
        return false;
    }
    if (!isPwaProfileContext() && !navigator.onLine) {
        showNotification('You must be online to change your password.', 'error');
        return false;
    }

    const body = {
        userId: user.id,
        currentPassword: p.currentPassword,
        newPassword: p.newPassword,
        confirmPassword: p.confirmPassword,
    };

    if (isResend) {
        setProfilePwdChangeOtpResendLoading(true);
        try {
            const res = await fetch('/api/user/password/change-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(function () { return {}; });
            if (!res.ok || !data.success) {
                showNotification(data.error || 'Could not resend code.', 'warning');
                return false;
            }
            showNotification(data.message || 'A new code was sent.', 'success');
            clearProfilePwdChangeOtpDigits();
            setProfilePwdChangeOtpError('');
            startProfilePwdChangeResendCooldown(60);
            return true;
        } catch (_) {
            showNotification('Could not resend code. Check your connection.', 'error');
            return false;
        } finally {
            setProfilePwdChangeOtpResendLoading(false);
            const btn = document.getElementById('profilePwdChangeOtpResendBtn');
            if (btn && !profilePwdChangeOtpResendInterval && profilePwdChangeOtpResendRemaining <= 0) {
                btn.disabled = false;
            }
        }
    }

    const saveBtn = document.getElementById('profileSecuritySaveBtn');
    const prevHtml = saveBtn ? saveBtn.innerHTML : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<span class="profile-totp-modal__spinner" aria-hidden="true"></span><span>Sending…</span>';
        saveBtn.classList.add('is-loading');
    }
    try {
        const res = await fetch('/api/user/password/change-request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
            if (data.field === 'profileSecNewPassword' && data.error) {
                const err = document.getElementById('profileSecPwCommonErr');
                if (err) {
                    err.textContent = data.error;
                    err.classList.add('show');
                } else {
                    showNotification(data.error, 'warning');
                }
            } else {
                showNotification(data.error || 'Could not send verification code.', 'warning');
            }
            return false;
        }
        showNotification(data.message || 'Verification code sent. Check your email.', 'success');
        openProfilePwdChangeOtpModal();
        return true;
    } catch (_) {
        if (isPwaProfileContext() && !navigator.onLine) {
            showPwaPasswordInternetToast();
        } else {
            showNotification('Could not send verification code. Check your connection.', 'error');
        }
        return false;
    } finally {
        if (saveBtn) {
            saveBtn.classList.remove('is-loading');
            saveBtn.innerHTML = prevHtml;
        }
        if (profileSecPwLiveInst && typeof profileSecPwLiveInst.refresh === 'function') {
            profileSecPwLiveInst.refresh();
        }
    }
}

async function verifyProfilePasswordChangeOtp() {
    if (profilePwdChangeOtpVerifyInProgress) return;
    const user = getStoredDiariUser();
    if (!user || !user.id) return;
    const code = getProfilePwdChangeOtpCode();
    if (code.length !== 6) {
        setProfilePwdChangeOtpError('Please enter the 6-digit code from your email.');
        return;
    }
    const uid = typeof user.id === 'number' ? user.id : parseInt(String(user.id), 10);
    if (!uid || Number.isNaN(uid)) {
        setProfilePwdChangeOtpError('Your session is invalid. Please sign in again.');
        return;
    }
    clearProfilePwdChangeOtpAutoVerify();
    profilePwdChangeOtpVerifyInProgress = true;
    setProfilePwdChangeOtpVerifyLoading(true);
    setProfilePwdChangeOtpError('');
    try {
        const p = getProfilePwdChangePayload();
        const controller = new AbortController();
        const abortTimer = setTimeout(function () {
            controller.abort();
        }, 30000);
        let res;
        try {
            res = await fetch('/api/user/password/change-confirm', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: uid,
                    currentPassword: p.currentPassword,
                    newPassword: p.newPassword,
                    confirmPassword: p.confirmPassword,
                    code: code,
                }),
                signal: controller.signal,
            });
        } finally {
            clearTimeout(abortTimer);
        }
        const data = await res.json().catch(function () { return {}; });
        if (!res.ok || !data.success) {
            setProfilePwdChangeOtpError(data.error || 'Invalid or expired verification code.');
            return;
        }
        clearProfilePwdChangeOtpAutoVerify();
        closeProfilePwdChangeOtpModal();
        clearSecurityForm();
        showNotification(data.message || 'Password changed successfully.', 'success');
        openProfilePwdChangeSuccessModalThenLogout();
    } catch (err) {
        const aborted = err && (err.name === 'AbortError' || err.name === 'TimeoutError');
        setProfilePwdChangeOtpError(
            aborted
                ? 'Request timed out. Check your connection and tap Verify code again.'
                : 'Could not reach the server. Check your connection and try again.'
        );
    } finally {
        profilePwdChangeOtpVerifyInProgress = false;
        setProfilePwdChangeOtpVerifyLoading(false);
    }
}

function wireProfilePwdChangeOtpDigits() {
    const digits = getProfilePwdChangeOtpDigitInputs();
    if (!digits.length || digits[0].dataset.pwdChangeOtpWired === '1') return;
    digits[0].dataset.pwdChangeOtpWired = '1';
    digits.forEach(function (input, idx) {
        input.addEventListener('input', function (e) {
            var v = (e.target.value || '').replace(/\D/g, '').slice(-1);
            e.target.value = v;
            setProfilePwdChangeOtpError('');
            if (v && idx < digits.length - 1) {
                digits[idx + 1].focus();
            }
            clearProfilePwdChangeOtpAutoVerify();
            if (getProfilePwdChangeOtpCode().length === 6) {
                scheduleProfilePwdChangeOtpAutoVerify();
            }
        });
        input.addEventListener('keydown', function (e) {
            if (e.key === 'Backspace' && !input.value && idx > 0) {
                digits[idx - 1].focus();
            }
        });
        input.addEventListener('paste', function (e) {
            e.preventDefault();
            var raw = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6).split('');
            digits.forEach(function (d, i) {
                d.value = raw[i] || '';
            });
            var lastIdx = Math.min(raw.length, digits.length) - 1;
            if (lastIdx >= 0) digits[lastIdx].focus();
            setProfilePwdChangeOtpError('');
            clearProfilePwdChangeOtpAutoVerify();
            if (getProfilePwdChangeOtpCode().length === 6) {
                scheduleProfilePwdChangeOtpAutoVerify();
            }
        });
    });
}

function wireProfilePasswordChangeFlow() {
    wireProfilePwdChangeOtpDigits();
    wireProfilePwdChangeSuccessModal();
    const saveBtn = document.getElementById('profileSecuritySaveBtn');
    if (saveBtn && !saveBtn.dataset.pwdChangeWired) {
        saveBtn.dataset.pwdChangeWired = '1';
        saveBtn.addEventListener('click', function () {
            void submitProfilePasswordChangeRequest(false);
        });
    }
    const backdrop = document.getElementById('profilePwdChangeOtpBackdrop');
    const closeBtn = document.getElementById('profilePwdChangeOtpCloseBtn');
    const cancelBtn = document.getElementById('profilePwdChangeOtpCancelBtn');
    [backdrop, closeBtn, cancelBtn].forEach(function (el) {
        if (el && !el.dataset.pwdChangeOtpCloseWired) {
            el.dataset.pwdChangeOtpCloseWired = '1';
            el.addEventListener('click', function () {
                closeProfilePwdChangeOtpModal();
            });
        }
    });
    const verifyBtn = document.getElementById('profilePwdChangeOtpVerifyBtn');
    if (verifyBtn && !verifyBtn.dataset.pwdChangeVerifyWired) {
        verifyBtn.dataset.pwdChangeVerifyWired = '1';
        verifyBtn.addEventListener('click', function () {
            void verifyProfilePasswordChangeOtp();
        });
    }
    const resendBtn = document.getElementById('profilePwdChangeOtpResendBtn');
    if (resendBtn && !resendBtn.dataset.pwdChangeResendWired) {
        resendBtn.dataset.pwdChangeResendWired = '1';
        resendBtn.addEventListener('click', function () {
            void submitProfilePasswordChangeRequest(true);
        });
    }
}

function wireProfilePwdChangeSuccessModal() {
    const loginNow = document.getElementById('profilePwdChangeSuccessLoginNowBtn');
    if (!loginNow || loginNow.dataset.pwdChangeSuccessLoginWired) return;
    loginNow.dataset.pwdChangeSuccessLoginWired = '1';
    loginNow.addEventListener('click', function () {
        if (profilePwdChangeSuccessLogoutTimer) {
            clearTimeout(profilePwdChangeSuccessLogoutTimer);
            profilePwdChangeSuccessLogoutTimer = null;
        }
        clearProfilePwdChangeSuccessRedirectAnim();
        const modal = document.getElementById('profilePwdChangeSuccessModal');
        if (modal) modal.hidden = true;
        syncProfileModalBodyScrollLock();
        destroyProfilePwdChangeSuccessAnim();
        performProfileLogout();
    });
}

function initializeAccountDetailPanels() {
    document.getElementById('profilePersonalCancelBtn')?.addEventListener('click', function () {
        closeProfileSection();
    });
    document.getElementById('profilePersonalSaveBtn')?.addEventListener('click', savePersonalInfoForm);
    document.getElementById('profileSecurityCancelBtn')?.addEventListener('click', function () {
        clearSecurityForm();
        closeProfileSection();
    });

    document.querySelectorAll('.profile-account-field__reveal').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const id = btn.getAttribute('data-profile-pw');
            const field = id && document.getElementById(id);
            if (!field) return;
            const show = field.type === 'password';
            field.type = show ? 'text' : 'password';
            const icon = btn.querySelector('i');
            if (icon) {
                icon.classList.toggle('bi-eye', show);
                icon.classList.toggle('bi-eye-slash', !show);
            }
        });
    });

    wireProfilePasswordChangeFlow();

    wireProfileEmailChangeOtpFlow();

    wireProfileTotpModal();
    const totpToggle = document.getElementById('profileSec2faToggle');
    if (totpToggle && !totpToggle.dataset.wired) {
        totpToggle.dataset.wired = '1';
        totpToggle.addEventListener('change', function () {
            if (totpToggle.dataset.hydrating === '1') return;
            const wantOn = totpToggle.checked;
            void (async function () {
                if (await isPwaOfflineForUserActions()) {
                    totpToggle.checked = !wantOn;
                    showPwaInternetRequiredToast();
                    return;
                }
                const user = getStoredDiariUser();
                if (!user || !user.id) {
                    showNotification('Sign in to manage two-factor authentication.', 'warning');
                    totpToggle.checked = false;
                    return;
                }
                if (wantOn) {
                    totpToggle.checked = false;
                    openTotpSetupModal();
                } else {
                    totpToggle.checked = true;
                    openTotpDisableModal();
                }
            })();
        });
    }
}

function processAvatarFileToDataUrl(file, done) {
    const reader = new FileReader();
    reader.onload = function () {
        const result = reader.result;
        if (typeof result !== 'string') {
            done(null);
            return;
        }
        const image = new Image();
        image.onload = function () {
            try {
                const maxEdge = 360;
                let w = image.naturalWidth || image.width;
                let h = image.naturalHeight || image.height;
                if (!w || !h) {
                    done(null);
                    return;
                }
                if (w > maxEdge || h > maxEdge) {
                    const scale = Math.min(maxEdge / w, maxEdge / h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    done(result);
                    return;
                }
                ctx.drawImage(image, 0, 0, w, h);
                done(canvas.toDataURL('image/jpeg', 0.86));
            } catch (_) {
                done(null);
            }
        };
        image.onerror = function () {
            done(null);
        };
        image.src = result;
    };
    reader.onerror = function () {
        done(null);
    };
    reader.readAsDataURL(file);
}

function ensureProfileAvatarFileInput() {
    let el = document.getElementById('profileAvatarFileInput');
    if (!el) {
        el = document.createElement('input');
        el.type = 'file';
        el.id = 'profileAvatarFileInput';
        el.accept = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif';
        el.setAttribute('aria-hidden', 'true');
        el.tabIndex = -1;
        el.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-100px;top:0;';
        document.body.appendChild(el);
    }
    return el;
}

// Initialize Profile Interactions
function initializeProfileInteractions() {
    const mobileLogoutBtn = document.getElementById('profileMobileLogoutBtn');
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', function() {
            performProfileLogout();
        });
    }

    const pageLogoutBtn = document.getElementById('profilePageLogoutBtn');
    if (pageLogoutBtn) {
        pageLogoutBtn.addEventListener('click', function() {
            performProfileLogout();
        });
    }

    document.addEventListener('diari-user-updated', function () {
        try {
            const user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
            applyProfileOverviewAvatar(user);
        } catch (_) {
            applyProfileOverviewAvatar(null);
        }
    });

    // Avatar: open file picker, resize, save to diariCoreUser.avatarDataUrl, sync sidebar
    const avatarEditBtn = document.querySelector('.avatar-edit-btn');
    const personalChangePhotoBtn = document.getElementById('profilePersonalChangePhotoBtn');
    const avatarMainImg = document.querySelector('.profile-overview-section .avatar-image');
    const input = ensureProfileAvatarFileInput();
    if (input.dataset.avatarBound !== '1') {
        input.dataset.avatarBound = '1';
        function openAvatarPicker(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            input.click();
        }
        if (avatarEditBtn) avatarEditBtn.addEventListener('click', openAvatarPicker);
        if (personalChangePhotoBtn) personalChangePhotoBtn.addEventListener('click', openAvatarPicker);
        input.addEventListener('change', function () {
                const file = input.files && input.files[0];
                input.value = '';
                if (!file) return;
                if (!file.type.startsWith('image/')) {
                    showNotification('Please choose an image file.', 'warning');
                    return;
                }
                if (file.size > 4 * 1024 * 1024) {
                    showNotification('Image is too large (max 4 MB).', 'warning');
                    return;
                }
                processAvatarFileToDataUrl(file, function (dataUrl) {
                    if (!dataUrl) {
                        showNotification('Could not read that image. Try JPG or PNG.', 'error');
                        return;
                    }
                    if (dataUrl.length > 900000) {
                        showNotification('Processed image is still too large. Try a smaller photo.', 'error');
                        return;
                    }
                    let user = null;
                    try {
                        user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
                    } catch (_) {
                        user = null;
                    }
                    if (!user || typeof user !== 'object') {
                        showNotification('Sign in to save a profile photo.', 'warning');
                        return;
                    }
                    user.avatarDataUrl = dataUrl;
                    localStorage.setItem('diariCoreUser', JSON.stringify(user));
                    applyProfileOverviewAvatar(user);
                    document.dispatchEvent(new CustomEvent('diari-user-updated', { bubbles: true }));

                    void (async function () {
                        if (await isPwaOfflineForUserActions()) {
                            if (window.DiariOffline?.savePwaAvatarPending) {
                                window.DiariOffline.savePwaAvatarPending(dataUrl);
                            }
                            showPwaSavedOfflineToast();
                            const personalPanel = document.getElementById('profileSectionPersonalInfo');
                            if (personalPanel && !personalPanel.hidden) {
                                hydratePersonalInfoPanel();
                            }
                            return;
                        }

                    const uid = Number(user.id ?? user.userId ?? 0);
                    if (Number.isInteger(uid) && uid > 0) {
                        fetch('/api/user/avatar', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: uid, avatarDataUrl: dataUrl }),
                        })
                            .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
                            .then(({ ok, data }) => {
                                if (!ok || !data.success) throw new Error(data.error || 'save failed');
                                const serverUser = data.user;
                                if (serverUser && typeof serverUser === 'object') {
                                    const next = { ...user, ...serverUser };
                                    if (serverUser.avatarDataUrl) next.avatarDataUrl = serverUser.avatarDataUrl;
                                    localStorage.setItem('diariCoreUser', JSON.stringify(next));
                                    document.dispatchEvent(new CustomEvent('diari-user-updated', { bubbles: true }));
                                }
                                showNotification('Profile photo updated.', 'success');
                                const personalPanel = document.getElementById('profileSectionPersonalInfo');
                                if (personalPanel && !personalPanel.hidden) {
                                    hydratePersonalInfoPanel();
                                }
                            })
                            .catch(function () {
                                if (isPwaProfileContext()) showPwaSavedOfflineToast();
                                else {
                                    showNotification(
                                        'Photo is saved on this device only. Could not sync to the server—try again when you are online.',
                                        'warning'
                                    );
                                }
                            });
                    } else {
                        showNotification('Profile photo updated.', 'success');
                    }
                    })();
                });
            });
    }
}

const REMINDER_TIME_USER_OVERRIDE_KEY = 'diariCoreReminderTimeUserOverride';

function getProfileEntriesForInsightsMostActive() {
    try {
        const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
        if (!Array.isArray(entries)) return [];
        return entries.filter((e) => e && e.date);
    } catch (_) {
        return [];
    }
}

/** Matches Consistency “most active time”: Manila mode hour from save timestamps; falls back if no data. */
function computeSuggestedReminderTimeHHmm() {
    const MAT = window.DiariMostActiveTime;
    const list = getProfileEntriesForInsightsMostActive();
    if (!MAT || typeof MAT.computeMostActiveHour24FromEntries !== 'function') {
        return '09:00';
    }
    const peak = MAT.computeMostActiveHour24FromEntries(list);
    const t = MAT.hour24ToTimeInputValue(peak);
    return t || '09:00';
}

function readReminderTimeUserOverride() {
    try {
        const v = localStorage.getItem(REMINDER_TIME_USER_OVERRIDE_KEY);
        if (!v || typeof v !== 'string') return null;
        const s = v.trim();
        return /^\d{2}:\d{2}$/.test(s) ? s : null;
    } catch (_) {
        return null;
    }
}

function hydrateProfileReminderTimeInput() {
    const input = document.getElementById('profileReminderTimeInput');
    if (!input) return;
    const user = readReminderTimeUserOverride();
    input.value = user || computeSuggestedReminderTimeHHmm();
}

/**
 * Server-side daily Web Push uses ui_preferences_json; pwa-web-push.js loads async after this file,
 * so DiariPwaWebPush is often missing when the user changes reminder time — sync from here always.
 */
function buildPushNotificationPrefsPayloadForServer() {
    let reminderTimeOverride = '';
    try {
        const o = localStorage.getItem(REMINDER_TIME_USER_OVERRIDE_KEY);
        if (o && /^\d{2}:\d{2}$/.test(String(o).trim())) {
            reminderTimeOverride = String(o).trim();
        } else {
            const input = document.getElementById('profileReminderTimeInput');
            if (input && input.value && /^\d{2}:\d{2}$/.test(input.value)) {
                reminderTimeOverride = input.value;
            }
        }
    } catch (_) {
        /* ignore */
    }
    let dailyEnabled = true;
    let streakEnabled = true;
    let insightEnabled = true;
    try {
        dailyEnabled = localStorage.getItem('diariCorePwaDailyRemindersEnabled') !== '0';
        streakEnabled = localStorage.getItem('diariCorePwaStreakRemindersEnabled') !== '0';
        insightEnabled = localStorage.getItem('diariCorePwaInsightFollowupsEnabled') !== '0';
    } catch (_) {
        /* ignore */
    }
    const dailyToggle = document.getElementById('toggleDailyReminders');
    if (dailyToggle) {
        dailyEnabled = !!dailyToggle.checked;
    }
    return {
        notifications: {
            dailyEnabled,
            streakEnabled,
            insightEnabled,
            reminderTimeOverride,
        },
    };
}

function formatProfilePushStatusForPhone(data) {
    if (!data || !data.success) {
        return 'Could not load status. Check internet and try Refresh.';
    }
    const lines = [];
    lines.push('Server time (Manila): ' + (data.manilaNow || '?'));
    lines.push('Reminder server will use: ' + (data.reminderTimeUsed || '(not set)'));
    lines.push('Your override saved: ' + (data.reminderTimeOverride || '(none — using default hour)'));
    lines.push('Daily reminders on: ' + (data.dailyEnabled ? 'yes' : 'no'));
    lines.push('Wrote entry today: ' + (data.hasEntryToday ? 'yes — no daily nudge today' : 'no'));
    lines.push('Due right now (15 min window): ' + (data.dailyDueNow ? 'YES' : 'no'));
    lines.push('Already sent today: ' + (data.dailyAlreadySentToday ? 'yes' : 'no'));
    lines.push('This account devices subscribed: ' + (data.subscribedDevices ?? 0));
    if (data.lastPushReceivedOnPhone && data.lastPushReceivedOnPhone.at) {
        lines.push(
            'Last push received ON THIS PHONE: ' +
                (data.lastPushReceivedOnPhone.title || 'notification') +
                ' at ' +
                data.lastPushReceivedOnPhone.at
        );
    } else {
        lines.push('Last push received ON THIS PHONE: (none logged yet)');
    }
    if ((data.subscribedDevices ?? 0) > 1) {
        lines.push('');
        lines.push('⚠ More than one device is registered. Tap “Use this phone only” before testing.');
    }
    if (data.subscriptionWarning) {
        lines.push('');
        lines.push('⚠ ' + data.subscriptionWarning);
    }
    if (Array.isArray(data.subscriptionDeviceHints) && data.subscriptionDeviceHints.length) {
        lines.push('Registered: ' + data.subscriptionDeviceHints.join(', '));
    }
    if (data.internalCronDisabled) {
        lines.push('');
        lines.push('⚠ Scheduler OFF on Railway (DISABLE_INTERNAL_PUSH_CRON).');
        lines.push('Scheduled reminders will NOT fire until that is removed.');
    } else {
        lines.push('Scheduler on server: ' + (data.scheduledDispatchActive ? 'running' : 'not started yet'));
        lines.push('Last server check: ' + (data.lastServerDispatchAt || '(none yet — wait 1–2 min)'));
    }
    lines.push('');
    lines.push(
        'With app OPEN, an old local backup could show reminders. True closed-app push needs the app fully closed.'
    );
    if (data.needsCron && typeof data.needsCron === 'string') {
        lines.push('');
        lines.push(data.needsCron);
    }
    return lines.join('\n');
}

let profilePushStatusBound = false;

async function refreshProfilePushStatusPanel() {
    const panel = document.getElementById('profilePushStatusPanel');
    const pre = document.getElementById('profilePushStatusText');
    if (!panel || !pre) return;
    if (!isPwaProfileContext()) {
        panel.hidden = true;
        return;
    }
    panel.hidden = false;
    pre.textContent = 'Loading…';
    try {
        const res = await fetch('/api/push/schedule-status', { credentials: 'same-origin' });
        const data = await res.json().catch(() => ({}));
        pre.textContent = formatProfilePushStatusForPhone(data);
    } catch (e) {
        pre.textContent = 'Network error: ' + (e && e.message ? e.message : 'try again');
    }
}

function initializeProfilePushStatusPanel() {
    const panel = document.getElementById('profilePushStatusPanel');
    if (!panel || profilePushStatusBound) return;
    profilePushStatusBound = true;
    const refreshBtn = document.getElementById('profilePushStatusRefresh');
    const resetBtn = document.getElementById('profilePushResetDaily');
    const dailyTestBtn = document.getElementById('profilePushDailyTest');
    if (dailyTestBtn) {
        dailyTestBtn.addEventListener('click', async function () {
            dailyTestBtn.disabled = true;
            try {
                async function sendDailyTest() {
                    const res = await fetch('/api/push/send-daily-test', {
                        method: 'POST',
                        credentials: 'same-origin',
                    });
                    return res.json().catch(() => ({}));
                }
                let data = await sendDailyTest();
                if (
                    !data.ok &&
                    (data.needsResubscribe ||
                        /expired|unsubscribed|use this phone only/i.test(String(data.error || '')))
                ) {
                    if (window.DiariPwaWebPush?.confirmPushOnThisPhone) {
                        showNotification('Refreshing push registration on this phone…', 'info', 3000);
                        await window.DiariPwaWebPush.confirmPushOnThisPhone();
                        data = await sendDailyTest();
                    }
                }
                if (data.ok) {
                    showNotification(
                        'Daily nudge sent — fully close the app and watch for the banner.',
                        'info',
                        7000
                    );
                } else {
                    showNotification(
                        data.hint || data.error || 'Daily test send failed.',
                        'warning',
                        7000
                    );
                }
            } catch (_) {
                showNotification('Daily test send failed.', 'warning', 5000);
            } finally {
                dailyTestBtn.disabled = false;
                global.setTimeout(function () {
                    void refreshProfilePushStatusPanel();
                }, 3000);
            }
        });
    }
    const thisPhoneBtn = document.getElementById('profilePushThisPhoneOnly');
    if (thisPhoneBtn) {
        thisPhoneBtn.addEventListener('click', async function () {
            thisPhoneBtn.disabled = true;
            try {
                let result = { ok: false };
                if (window.DiariPwaWebPush?.confirmPushOnThisPhone) {
                    result = await window.DiariPwaWebPush.confirmPushOnThisPhone();
                } else if (window.DiariPwaWebPush?.registerThisPhoneOnly) {
                    const reg = await window.DiariPwaWebPush.registerThisPhoneOnly();
                    result = { ok: !!reg.ok };
                }
                if (result.ok) {
                    showNotification(
                        result.message ||
                            'This phone is set for reminders. Tap “Test daily nudge now”, then close the app to verify.',
                        result.soft ? 'info' : 'success',
                        7000
                    );
                } else {
                    showNotification(
                        result.error || 'Could not register push on this phone.',
                        'warning',
                        6000
                    );
                }
                await fetch('/api/push/reset-daily-reminder', {
                    method: 'POST',
                    credentials: 'same-origin',
                });
            } catch (e) {
                showNotification('Setup failed — check notification permission.', 'warning', 5000);
            } finally {
                thisPhoneBtn.disabled = false;
                void refreshProfilePushStatusPanel();
            }
        });
    }
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function () {
            void refreshProfilePushStatusPanel();
        });
    }
    if (resetBtn) {
        resetBtn.addEventListener('click', async function () {
            resetBtn.disabled = true;
            try {
                await fetch('/api/push/reset-daily-reminder', {
                    method: 'POST',
                    credentials: 'same-origin',
                });
                showNotification('Reset — you can test today’s reminder again.', 'info', 4000);
            } catch (_) {
                showNotification('Reset failed — check connection.', 'warning', 4000);
            } finally {
                resetBtn.disabled = false;
                void refreshProfilePushStatusPanel();
            }
        });
    }
}

async function syncPushNotificationPrefsToServerFromProfile() {
    try {
        const res = await fetch('/api/push/preferences', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildPushNotificationPrefsPayloadForServer()),
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            console.warn('[Profile] push notification prefs sync failed', res.status, t);
        }
    } catch (e) {
        console.warn('[Profile] push notification prefs sync error', e);
    }
}

function initializeReminderTimePreference() {
    const input = document.getElementById('profileReminderTimeInput');
    if (!input || input.dataset.reminderTimeBound === '1') return;
    input.dataset.reminderTimeBound = '1';
    hydrateProfileReminderTimeInput();
    function onReminderTimeChanged() {
        const suggested = computeSuggestedReminderTimeHHmm();
        try {
            if (input.value === suggested) {
                localStorage.removeItem(REMINDER_TIME_USER_OVERRIDE_KEY);
            } else if (input.value && /^\d{2}:\d{2}$/.test(input.value)) {
                localStorage.setItem(REMINDER_TIME_USER_OVERRIDE_KEY, input.value);
            }
        } catch (_) { /* ignore */ }
        if (window.DiariPwaNotifications?.syncPrefsToWorker) {
            void window.DiariPwaNotifications.syncPrefsToWorker();
        }
        if (window.DiariPwaWebPush?.syncNotificationPrefsToServerBeacon) {
            window.DiariPwaWebPush.syncNotificationPrefsToServerBeacon();
        }
        if (window.DiariPwaWebPush?.syncNotificationPrefsToServer) {
            void window.DiariPwaWebPush.syncNotificationPrefsToServer();
        }
        void syncPushNotificationPrefsToServerFromProfile();
        void refreshProfilePushStatusPanel();
    }
    input.addEventListener('change', onReminderTimeChanged);
    input.addEventListener('input', onReminderTimeChanged);
}

// Initialize Preference Toggles
function initializePreferenceToggles() {
    const toggleSwitches = document.querySelectorAll(
        '#profileSectionPreferences .toggle-switch input[type="checkbox"], #profileSectionPreferences .switch input[type="checkbox"]'
    );

    const darkModeToggle = document.getElementById('toggleDarkMode');
    if (darkModeToggle && window.DiariTheme && typeof window.DiariTheme.getTheme === 'function') {
        darkModeToggle.checked = window.DiariTheme.getTheme() === 'dark';
    }
    
    toggleSwitches.forEach(toggle => {
        toggle.addEventListener('change', function() {
            const row = this.closest('.appearance-item, .notifications-item, .preference-item');
            if (!row) return;

            void (async function () {
                const isChecked = toggle.checked;
                const titleEl = row.querySelector(
                    '.appearance-subtitle, .notifications-subtitle, .preference-title'
                );
                const preferenceTitle = titleEl ? titleEl.textContent.trim() : 'Preference';

                if (toggle.id === 'toggleDarkMode' && window.DiariTheme && typeof window.DiariTheme.setTheme === 'function') {
                    const nextTheme = isChecked ? 'dark' : 'light';
                    if (await isPwaOfflineForUserActions()) {
                        window.DiariTheme.setTheme(nextTheme, { skipServerSync: true });
                        if (window.DiariOffline?.savePwaUiPrefsPending) {
                            window.DiariOffline.savePwaUiPrefsPending({
                                uiTheme: nextTheme,
                                uiPaletteId: window.DiariTheme.getPalette(),
                            });
                        }
                        showPwaSavedOfflineToast();
                        return;
                    }
                    window.DiariTheme.setTheme(nextTheme);
                    showNotification(`${preferenceTitle} ${isChecked ? 'enabled' : 'disabled'}`, 'success');
                    return;
                }

                if (toggle.id === 'toggleDailyReminders') {
                    try {
                        localStorage.setItem('diariCorePwaDailyRemindersEnabled', isChecked ? '1' : '0');
                    } catch (_) {
                        /* ignore */
                    }
                    if (window.DiariPwaNotifications?.syncPrefsToWorker) {
                        void window.DiariPwaNotifications.syncPrefsToWorker();
                    }
                    if (window.DiariPwaWebPush?.syncNotificationPrefsToServer) {
                        void window.DiariPwaWebPush.syncNotificationPrefsToServer();
                    }
                    await syncPushNotificationPrefsToServerFromProfile();
                    if (!(await isPwaOfflineForUserActions())) {
                        showNotification(`${preferenceTitle} ${isChecked ? 'enabled' : 'disabled'}`, 'success');
                    }
                    return;
                }

                if (!(await isPwaOfflineForUserActions())) {
                    showNotification(`${preferenceTitle} ${isChecked ? 'enabled' : 'disabled'}`, 'success');
                    savePreference(preferenceTitle, isChecked);
                }
            })();
        });
    });
}

// Save Preference (Mock Function)
function savePreference(title, value) {
    // In a real app, this would make an API call
    console.log('Saving preference:', title, value);
    
    // Simulate API call
    setTimeout(() => {
        console.log('Preference saved successfully');
    }, 500);
}

// Initialize Storage Actions
function initializeStorageActions() {
    // Export button
    const exportBtn = document.querySelector('.btn-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', function() {
            showNotification('Preparing data export...', 'info');
            
            // Simulate export process
            setTimeout(() => {
                exportData();
            }, 1500);
        });
    }

    document.querySelectorAll('.btn-privacy').forEach(function (btn) {
        btn.addEventListener('click', function () {
            showNotification('Privacy policy is coming soon.', 'info');
        });
    });

    // Backup button
    const backupBtn = document.querySelector('.btn-backup');
    if (backupBtn) {
        backupBtn.addEventListener('click', function() {
            showNotification('Creating backup...', 'info');
            
            // Simulate backup process
            setTimeout(() => {
                createBackup();
            }, 1500);
        });
    }

    // Clear data button
    const deleteBtn = document.querySelector('.btn-delete');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', function() {
            const confirmed = confirm('Are you sure you want to clear all data? This action cannot be undone.');
            
            if (confirmed) {
                showNotification('Clearing data...', 'warning');
                
                // Simulate data clearing
                setTimeout(() => {
                    clearData();
                }, 1500);
            }
        });
    }
}

// Export Data (Mock Function)
function exportData() {
    // In a real app, this would generate and download a file
    const mockData = {
        entries: [],
        preferences: {},
        exportDate: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(mockData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `diari-export-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    URL.revokeObjectURL(url);
    
    showNotification('Data exported successfully!', 'success');
}

// Create Backup (Mock Function)
function createBackup() {
    // In a real app, this would create a cloud backup
    console.log('Creating backup...');
    
    setTimeout(() => {
        showNotification('Backup created successfully!', 'success');
        console.log('Backup completed');
    }, 1000);
}

// Clear Data (Mock Function)
function clearData() {
    // In a real app, this would clear user data
    console.log('Clearing data...');
    
    setTimeout(() => {
        showNotification('All data cleared successfully', 'success');
        console.log('Data cleared');
        
        // Update storage display
        updateStorageDisplay(0, 0, 0);
    }, 1000);
}

// Update Storage Display
function updateStorageDisplay(textSize, attachmentSize, backupSize) {
    const totalSize = textSize + attachmentSize + backupSize;
    const percentage = (totalSize / 5 * 100).toFixed(0); // 5GB total
    
    // Update storage amount
    const storageAmount = document.querySelector('.storage-amount');
    if (storageAmount) {
        storageAmount.textContent = `${(totalSize / 1024).toFixed(1)} GB of 5 GB used`;
    }
    
    // Update storage bar
    const storageFill = document.querySelector('.storage-fill');
    if (storageFill) {
        storageFill.style.width = `${percentage}%`;
    }
    
    // Update storage breakdown
    const storageItems = document.querySelectorAll('.storage-item');
    if (storageItems[0]) storageItems[0].querySelector('.storage-size').textContent = `${(textSize / 1024).toFixed(1)} GB`;
    if (storageItems[1]) storageItems[1].querySelector('.storage-size').textContent = `${(attachmentSize / 1024).toFixed(1)} GB`;
    if (storageItems[2]) storageItems[2].querySelector('.storage-size').textContent = `${(backupSize / 1024).toFixed(1)} GB`;
}

const PROFILE_SECTION_PANELS = {
    preferences: 'profileSectionPreferences',
    privacy: 'profileSectionPrivacy',
    'personal-information': 'profileSectionPersonalInfo',
    security: 'profileSectionSecurity',
};

const PROFILE_SECTION_COPY = {
    preferences: {
        title: 'Preferences',
        subtitle: 'Customize your DiariCore experience.',
    },
    privacy: {
        title: 'Privacy',
        subtitle: 'Data usage and sharing.',
    },
    'personal-information': {
        title: 'Personal Information',
        subtitle: 'Update your name, email, and profile details',
    },
    security: {
        title: 'Security Settings',
        subtitle: 'Change password and enable two-factor authentication',
    },
};

function profileSectionFromHash() {
    const h = (location.hash || '').replace(/^#/, '').toLowerCase();
    return PROFILE_SECTION_PANELS[h] ? h : '';
}

function setProfileUrlHash(sectionKey) {
    try {
        const base = `${location.pathname}${location.search}`;
        if (sectionKey) {
            history.replaceState({}, '', `${base}#${sectionKey}`);
        } else {
            history.replaceState({}, '', base);
        }
    } catch (_) {}
}

function openProfileSection(sectionKey) {
    if (!PROFILE_SECTION_PANELS[sectionKey]) return;
    if (lastOpenedProfileSectionKey === 'security' && sectionKey !== 'security') {
        destroyProfileSecPasswordLive();
    }
    const overview = document.getElementById('profileOverviewShell');
    const shell = document.getElementById('profileSectionShell');
    if (!overview || !shell) return;

    overview.hidden = true;
    shell.hidden = false;
    document.body.classList.add('page-profile-section-open');

    Object.keys(PROFILE_SECTION_PANELS).forEach(function (k) {
        const el = document.getElementById(PROFILE_SECTION_PANELS[k]);
        if (el) el.hidden = k !== sectionKey;
    });

    const copy = PROFILE_SECTION_COPY[sectionKey];
    const titleEl = document.getElementById('profileSectionTitle');
    const subEl = document.getElementById('profileSectionSubtitle');
    if (titleEl && copy) titleEl.textContent = copy.title;
    if (subEl && copy) subEl.textContent = copy.subtitle;

    setProfileUrlHash(sectionKey);
    window.scrollTo(0, 0);

    if (sectionKey === 'preferences') {
        hydrateProfileReminderTimeInput();
        if (window.DiariPwaNotifications?.hydrateProfileNotificationUi) {
            window.DiariPwaNotifications.hydrateProfileNotificationUi();
        }
        initializeProfilePushStatusPanel();
        void syncPushNotificationPrefsToServerFromProfile();
        void refreshProfilePushStatusPanel();
    }
    if (sectionKey === 'personal-information') {
        hydratePersonalInfoPanel();
    }
    if (sectionKey === 'security') {
        clearSecurityForm();
        hydrateSecurity2fa();
        initProfileSecPasswordLive();
        ['profileFieldNickname', 'profileFieldEmail', 'profileFieldFirstName', 'profileFieldLastName'].forEach(function (fid) {
            const el = document.getElementById(fid);
            if (el && !el.dataset.profileSecPwdLiveRefresh) {
                el.dataset.profileSecPwdLiveRefresh = '1';
                el.addEventListener('input', function () {
                    if (profileSecPwLiveInst && typeof profileSecPwLiveInst.refresh === 'function') {
                        profileSecPwLiveInst.refresh();
            }
        });
    }
        });
    }
    lastOpenedProfileSectionKey = sectionKey;
}

function closeProfileSection() {
    const overview = document.getElementById('profileOverviewShell');
    const shell = document.getElementById('profileSectionShell');
    if (!overview || !shell || shell.hidden) return;

    shell.hidden = true;
    overview.hidden = false;
    document.body.classList.remove('page-profile-section-open');

    Object.keys(PROFILE_SECTION_PANELS).forEach(function (k) {
        const el = document.getElementById(PROFILE_SECTION_PANELS[k]);
        if (el) el.hidden = true;
    });

    setProfileUrlHash(null);
    window.scrollTo(0, 0);
    destroyProfileSecPasswordLive();
    lastOpenedProfileSectionKey = '';
    closeProfilePwdChangeOtpModal();
    closeProfileEmailChangeOtpModal();
    if (profilePwdChangeSuccessLogoutTimer) {
        clearTimeout(profilePwdChangeSuccessLogoutTimer);
        profilePwdChangeSuccessLogoutTimer = null;
    }
    const successModal = document.getElementById('profilePwdChangeSuccessModal');
    if (successModal) successModal.hidden = true;
    destroyProfilePwdChangeSuccessAnim();
    syncProfileModalBodyScrollLock();
}

function initializeProfileSectionNavigation() {
    const backBtn = document.getElementById('profileSectionBackBtn');
    if (backBtn) {
        backBtn.addEventListener('click', function () {
            closeProfileSection();
        });
    }

    document.querySelectorAll('[data-profile-section]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const key = btn.getAttribute('data-profile-section');
            if (key) openProfileSection(key);
        });
    });

    const mobileBackBtn = document.getElementById('profileMobileBackBtn');
    if (mobileBackBtn) {
        mobileBackBtn.addEventListener('click', function () {
            if (document.body.classList.contains('page-profile-section-open')) {
                closeProfileSection();
            } else {
                window.location.href = 'dashboard.html';
            }
        });
    }

    const editIdentityBtn = document.getElementById('profileEditIdentityBtn');
    if (editIdentityBtn) {
        editIdentityBtn.addEventListener('click', function () {
            openProfileSection('personal-information');
        });
    }

    window.addEventListener('hashchange', function () {
        const key = profileSectionFromHash();
        if (key) openProfileSection(key);
        else closeProfileSection();
    });

    const initial = profileSectionFromHash();
    if (initial) {
        openProfileSection(initial);
    }
}

// Show Notification
function showNotification(message, type = 'info', durationMs) {
    const duration = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3000;
    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
        window.DiariToast.show(message, type, duration);
        return;
    }
    // Remove existing notification
    const existingNotification = document.querySelector('.profile-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.className = 'profile-notification';
    notification.innerHTML = `
        <i class="bi bi-${getNotificationIcon(type)}"></i>
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
        z-index: 13000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        background: ${getNotificationColor(type)};
        color: ${window.DiariToastColors && window.DiariToastColors.fg ? window.DiariToastColors.fg(type) : 'white'};
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
    }, duration);
}

// Get Notification Icon
function getNotificationIcon(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'x-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
}

// Get Notification Color
function getNotificationColor(type) {
    if (window.DiariToastColors && window.DiariToastColors.bg) {
        return window.DiariToastColors.bg(type);
    }
    const colors = {
        success: '#8da399',
        error: '#E74C3C',
        warning: '#d9822b',
        info: '#7FA7BF',
    };
    return colors[type] || colors.info;
}

if (document.body && document.body.classList.contains('page-profile')) {
    /* Profile fields hydrate after sync in DOMContentLoaded (refresh + first load). */
} else if (window.DiariShell && typeof window.DiariShell.release === 'function') {
    window.DiariShell.release();
} else {
    document.documentElement.classList.remove('diari-shell-pending');
}
