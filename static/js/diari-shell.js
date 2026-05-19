/**
 * Toast colors from theme.css (soft sage success). Used by entries, login, profile, etc.
 */
(function (w) {
    function readToastColors() {
        try {
            var s = getComputedStyle(document.documentElement);
            return {
                successBg: (s.getPropertyValue('--diari-success-sage-solid').trim() || '#8da399'),
                successFg: (s.getPropertyValue('--diari-success-on-solid').trim() || '#ffffff'),
                errorBg: (s.getPropertyValue('--diari-error-toast-bg').trim() || '#e74c3c'),
                errorFg: '#ffffff',
                warningBg: (s.getPropertyValue('--diari-warning-toast-bg').trim() || '#d9822b'),
                warningFg: '#ffffff',
                infoBg: (s.getPropertyValue('--diari-info-toast-bg').trim() || '#7fa7bf'),
                infoFg: '#ffffff',
            };
        } catch (e) {
            return {
                successBg: '#8da399',
                successFg: '#ffffff',
                errorBg: '#e74c3c',
                errorFg: '#ffffff',
                warningBg: '#d9822b',
                warningFg: '#ffffff',
                infoBg: '#7fa7bf',
                infoFg: '#ffffff',
            };
        }
    }
    function toastBg(type) {
        var c = readToastColors();
        if (type === 'success') return c.successBg;
        if (type === 'error') return c.errorBg;
        if (type === 'warning') return c.warningBg;
        return c.infoBg;
    }
    function toastFg(type) {
        var c = readToastColors();
        if (type === 'success') return c.successFg;
        if (type === 'error') return c.errorFg;
        if (type === 'warning') return c.warningFg;
        return c.infoFg;
    }
    function toastIcon(type) {
        if (type === 'success') return 'check-circle';
        if (type === 'error') return 'x-circle';
        if (type === 'warning') return 'exclamation-triangle';
        return 'info-circle';
    }

    function isMobileToastViewport() {
        try {
            return Boolean(w.matchMedia && w.matchMedia('(max-width: 768px)').matches);
        } catch (e) {
            return false;
        }
    }

  function removeExistingToasts() {
        var sel =
            '.diari-toast, .notification, .profile-notification, .write-entry-notification, .entries-notification, .sidebar-notification, .suggestions-notification';
        document.querySelectorAll(sel).forEach(function (el) {
            el.remove();
        });
    }

    function showToast(message, type, durationMs) {
        if (!document.body) return;
        var kind = type || 'info';
        var duration = typeof durationMs === 'number' ? durationMs : 3000;
        removeExistingToasts();

        var toast = document.createElement('div');
        toast.className = 'diari-toast diari-toast--' + kind;
        toast.setAttribute('role', 'status');
        toast.innerHTML =
            '<i class="bi bi-' +
            toastIcon(kind) +
            '" aria-hidden="true"></i><span></span>';
        var span = toast.querySelector('span');
        if (span) span.textContent = String(message || '');

        var mobile = isMobileToastViewport();
        var offscreenX = mobile ? 'translateX(calc(100% + 24px))' : 'translateX(calc(100% + 28px))';
        toast.style.cssText =
            'position:fixed;top:20px;z-index:13000;padding:0.72rem 1rem;border-radius:12px;display:flex;align-items:center;gap:0.65rem;font-weight:500;font-family:Inter,sans-serif;box-shadow:0 4px 20px rgba(0,0,0,0.15);transition:transform 0.3s ease,opacity 0.3s ease;word-wrap:break-word;opacity:0;background:' +
            toastBg(kind) +
            ';color:' +
            toastFg(kind) +
            ';';

        if (mobile) {
            toast.style.right = '12px';
            toast.style.left = 'auto';
            toast.style.width = 'max-content';
            toast.style.maxWidth = 'min(20rem, calc(100vw - 2rem))';
        } else {
            toast.style.right = '20px';
            toast.style.left = 'auto';
            toast.style.maxWidth = '400px';
        }
        toast.style.transform = offscreenX;

        document.body.appendChild(toast);
        void toast.offsetWidth;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(0)';
            });
        });
        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = offscreenX;
            setTimeout(function () {
                if (toast.parentNode) toast.remove();
            }, 300);
        }, duration);
    }

    w.DiariToastColors = { get: readToastColors, bg: toastBg, fg: toastFg };
    w.DiariToast = w.DiariToast || {};
    w.DiariToast.show = showToast;
})(typeof window !== 'undefined' ? window : this);

/**
 * Global first-paint shell: pages set <html class="diari-shell-pending"> and mark the
 * primary column with .diari-shell-main, then call DiariShell.release() after localStorage / API hydration.
 * Pages without .diari-shell-main auto-release on DOMContentLoaded (auth-only layouts).
 */
(function () {
    var PENDING = 'diari-shell-pending';
    var READY = 'diari-shell-ready';
    var releaseQueued = false;

    function completeRelease() {
        if (!document.documentElement.classList.contains(PENDING)) return;
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                document.documentElement.classList.remove(PENDING);
                if (document.body) document.body.classList.add(READY);
            });
        });
    }

    function release() {
        if (!document.documentElement.classList.contains(PENDING)) return;
        releaseQueued = true;
        if (
            window.DiariPwaLaunch &&
            typeof window.DiariPwaLaunch.shouldRunLaunch === 'function' &&
            window.DiariPwaLaunch.shouldRunLaunch() &&
            typeof window.DiariPwaLaunch.notifyAppReady === 'function'
        ) {
            window.DiariPwaLaunch.notifyAppReady();
            return;
        }
        if (window.DiariPwaLaunch && typeof window.DiariPwaLaunch.isFinished === 'function') {
            if (!window.DiariPwaLaunch.isFinished()) {
                if (typeof window.DiariPwaLaunch.whenFinished === 'function') {
                    window.DiariPwaLaunch.whenFinished().then(completeRelease);
                }
                return;
            }
        }
        completeRelease();
    }

    window.DiariShell = {
        release: release,
        _completeRelease: function () {
            if (releaseQueued) completeRelease();
        },
    };

    document.addEventListener('DOMContentLoaded', function () {
        if (!document.querySelector('.diari-shell-main')) {
            release();
        }
    });
})();
