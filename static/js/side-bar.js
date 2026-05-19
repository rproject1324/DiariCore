// DiariCore Sidebar Component JavaScript
// Temporary seed mode: keep UI empty while features are being built.
const DIARICORE_FORCE_EMPTY_STATE = false;

function isMobileViewportForAvatar() {
    try {
        return Boolean(window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    } catch (_) {
        return false;
    }
}

/**
 * Mobile topbar only: apply cached profile photo before paint when possible (desktop unchanged).
 */
function hydrateMobileTopbarProfileFromStorage() {
    if (!isMobileViewportForAvatar()) return;

    let user = null;
    try {
        user = JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
    } catch (_) {
        user = null;
    }

    document.querySelectorAll('.mobile-app-topbar__profile').forEach((link) => {
        const img = link.querySelector('.mobile-app-topbar__profile-img');
        const fallback = link.querySelector('.mobile-app-topbar__profile-fallback');
        if (!img || !fallback) return;

        if (!user || !user.isLoggedIn) {
            img.removeAttribute('src');
            img.hidden = true;
            fallback.hidden = false;
            link.classList.remove('mobile-app-topbar__profile--photo');
            link.classList.add('mobile-app-topbar__profile--hydrated');
            return;
        }

        const dataUrl =
            typeof user.avatarDataUrl === 'string' ? user.avatarDataUrl.trim() : '';
        if (!dataUrl) {
            img.removeAttribute('src');
            img.hidden = true;
            fallback.hidden = false;
            link.classList.remove('mobile-app-topbar__profile--photo');
            link.classList.add('mobile-app-topbar__profile--hydrated');
            return;
        }

        const applyPhoto = () => {
            link.classList.add('mobile-app-topbar__profile--photo');
            fallback.hidden = true;
            img.hidden = false;
            link.classList.add('mobile-app-topbar__profile--hydrated');
        };

        if (img.src === dataUrl && !img.hidden) {
            applyPhoto();
            return;
        }

        img.hidden = true;
        fallback.hidden = true;
        link.classList.remove('mobile-app-topbar__profile--photo');

        const onReady = () => {
            applyPhoto();
        };
        img.onload = onReady;
        img.onerror = () => {
            img.removeAttribute('src');
            img.hidden = true;
            fallback.hidden = false;
            link.classList.remove('mobile-app-topbar__profile--photo');
            link.classList.add('mobile-app-topbar__profile--hydrated');
        };
        img.src = dataUrl;
        if (img.complete) {
            onReady();
        }
    });
}

if (typeof window !== 'undefined') {
    window.hydrateMobileTopbarProfileFromStorage = hydrateMobileTopbarProfileFromStorage;
    if (document.body) {
        hydrateMobileTopbarProfileFromStorage();
    } else {
        document.addEventListener('DOMContentLoaded', hydrateMobileTopbarProfileFromStorage, {
            once: true,
        });
    }
}

class SidebarComponent {
    constructor() {
        this.currentPage = this.getCurrentPage();
        this.sidebarElement = null;
        this.mobileToggle = null;
        this.overlay = null;
        this.syncBadgeEl = null;
        this.syncBadgePoller = null;
        this.init();
    }

    init() {
        hydrateMobileTopbarProfileFromStorage();
        this.initSyncStatusBadge();
        this.loadSidebar();
        this.setupMobileToggle();
        this.setupEventListeners();
        document.addEventListener('diari-user-updated', () => {
            this.applyCurrentUserIdentity();
        });
        document.addEventListener('diari-remote-state-refreshed', () => {
            hydrateMobileTopbarProfileFromStorage();
            this.applyCurrentUserIdentity();
        });
        document.addEventListener('diari-mobile-shell-ready', hydrateMobileTopbarProfileFromStorage);
    }

    getCurrentPage() {
        const path = window.location.pathname;
        const filename = path.split('/').pop();
        return filename.replace('.html', '') || 'dashboard';
    }

    async loadSidebar() {
        try {
            const response = await fetch('side-bar.html');
            const html = await response.text();
            
            // Create a temporary div to parse the HTML
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;
            
            this.sidebarElement = tempDiv.querySelector('.sidebar');
            this.mobileBottomNav = tempDiv.querySelector('.mobile-bottom-nav');
            this.mobileAppTopbar = tempDiv.querySelector('.mobile-app-topbar');
            
            // Insert sidebar and mobile nav into the page
            this.insertSidebar();
            
            // Set active page and setup logout AFTER sidebar is loaded
            this.setActivePage();
            this.setupLogoutButton();
            this.initMobileWriteFab();
            this.initMobileTopbarSearchExpand();
            this.applyCurrentUserIdentity();
            this.applyGuestEmptyState();
            
            document.dispatchEvent(new CustomEvent('diari-mobile-shell-ready', { bubbles: true }));
        } catch (error) {
            console.error('Failed to load sidebar:', error);
        }
    }

    insertSidebar() {
        if (!this.sidebarElement) return;

        if (this.mobileAppTopbar) {
            const existingTopbar = document.querySelector('.mobile-app-topbar');
            if (!existingTopbar) {
                document.body.insertBefore(this.mobileAppTopbar, document.body.firstChild);
            }
            document.body.classList.add('has-mobile-app-topbar');
        }

        // Find where to insert the sidebar (before main content)
        const mainContent = document.querySelector('.main-content') || 
                           document.querySelector('main') || 
                           document.body;
        
        if (mainContent) {
            mainContent.parentNode.insertBefore(this.sidebarElement, mainContent);
        } else {
            document.body.appendChild(this.sidebarElement);
        }
        
        // Also insert mobile bottom navigation if it exists
        if (this.mobileBottomNav) {
            document.body.appendChild(this.mobileBottomNav);
        }
    }

    /**
     * Mobile: center + opens radial Write/Voice icon circles (no dim overlay).
     */
    initMobileWriteFab() {
        const fab = document.querySelector('.mobile-write-fab');
        if (!fab || fab.dataset.writeFabBound === '1') return;
        fab.dataset.writeFabBound = '1';

        const trigger = fab.querySelector('.mobile-bottom-nav-link--write-fab');
        const radial = fab.querySelector('.mobile-write-fab__radial');
        const iconPlus = fab.querySelector('.mobile-write-fab__icon-plus');
        const iconClose = fab.querySelector('.mobile-write-fab__icon-close');
        if (!trigger || !radial) return;

        const setIconsClosed = () => {
            if (iconPlus) iconPlus.classList.remove('is-hidden');
            if (iconClose) iconClose.classList.add('is-hidden');
        };

        const setIconsOpen = () => {
            if (iconPlus) iconPlus.classList.add('is-hidden');
            if (iconClose) iconClose.classList.remove('is-hidden');
        };

        const closeRadial = () => {
            radial.classList.remove('mobile-write-fab__radial--open');
            radial.setAttribute('aria-hidden', 'true');
            trigger.classList.remove('is-open');
            trigger.setAttribute('aria-expanded', 'false');
            setIconsClosed();
            document.removeEventListener('click', docClose, true);
        };

        const docClose = (e) => {
            if (!fab.contains(e.target)) {
                closeRadial();
            }
        };

        const openRadial = () => {
            if (window.innerWidth > 768) return;
            radial.setAttribute('aria-hidden', 'false');
            trigger.classList.add('is-open');
            trigger.setAttribute('aria-expanded', 'true');
            setIconsOpen();
            /* One frame at closed styles so opacity/transform transitions run (not display:none). */
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    radial.classList.add('mobile-write-fab__radial--open');
                });
            });
            setTimeout(() => document.addEventListener('click', docClose, true), 0);
        };

        trigger.addEventListener('click', (e) => {
            if (window.innerWidth > 768) return;
            e.preventDefault();
            if (!radial.classList.contains('mobile-write-fab__radial--open')) {
                openRadial();
            } else {
                closeRadial();
            }
        });

        fab.querySelectorAll('.mobile-write-fab__sat').forEach((link) => {
            link.addEventListener('click', () => closeRadial());
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeRadial();
            }
        });
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && radial.classList.contains('mobile-write-fab__radial--open')) {
                closeRadial();
            }
        });
    }

    /**
     * Mobile (≤768px): expand search field over the top bar; close on outside tap or Escape.
     * Entries page wires the input + filter trigger in entries.js.
     */
    initMobileTopbarSearchExpand() {
        const topbar = document.querySelector('.mobile-app-topbar');
        const openBtn = document.querySelector('.mobile-app-topbar__btn--search-toggle');
        const closeBtn = document.querySelector('.mobile-app-topbar__search-close');
        const expand = document.getElementById('mobileAppTopbarSearchExpand');
        const input = document.getElementById('mobileAppTopbarSearchInput');
        if (!topbar || !openBtn || !closeBtn || !expand || !input) return;

        const filterMenu = document.getElementById('filterMenu');

        const isMobile = () => window.innerWidth <= 768;

        const syncFromEntriesInput = () => {
            const hidden = document.querySelector('.search-input');
            if (hidden) input.value = hidden.value;
        };

        const setOpen = (open) => {
            if (!isMobile()) return;
            topbar.classList.toggle('mobile-app-topbar--search-active', open);
            expand.setAttribute('aria-hidden', open ? 'false' : 'true');
            openBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (open) {
                syncFromEntriesInput();
                if (!document.body.classList.contains('page-entries')) {
                    input.placeholder = 'Search…';
                } else {
                    input.placeholder = 'Search entries…';
                }
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => input.focus({ preventScroll: true }));
                });
            }
        };

        const close = () => setOpen(false);

        const currentHtmlFile = () =>
            (window.location.pathname.split('/').pop() || '').toLowerCase();

        /** Mobile: from dashboard / insights / suggestions, go to entries with search already open */
        const shouldRedirectSearchToEntries = () => {
            if (!isMobile()) return false;
            const f = currentHtmlFile();
            return (
                f === 'dashboard.html' ||
                f === 'insights.html' ||
                f === 'suggestions.html'
            );
        };

        openBtn.addEventListener('click', (e) => {
            if (!isMobile()) return;
            e.stopPropagation();
            if (shouldRedirectSearchToEntries()) {
                window.location.href = 'entries.html?openSearch=1';
                return;
            }
            if (topbar.classList.contains('mobile-app-topbar--search-active')) {
                close();
            } else {
                setOpen(true);
            }
        });

        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            close();
        });

        expand.addEventListener('click', (e) => e.stopPropagation());

        document.addEventListener(
            'click',
            (e) => {
                if (!isMobile() || !topbar.classList.contains('mobile-app-topbar--search-active')) return;
                if (topbar.contains(e.target)) return;
                if (filterMenu && filterMenu.contains(e.target)) return;
                close();
            },
            true
        );

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && topbar.classList.contains('mobile-app-topbar--search-active')) {
                close();
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) close();
        });

        window.diariCloseMobileTopbarSearch = close;
        window.diariOpenMobileTopbarSearch = () => setOpen(true);
    }

    setupMobileToggle() {
        // Temporarily disabled hamburger menu
        // if (window.innerWidth <= 768) {
        //     // Create mobile toggle button
        //     this.mobileToggle = document.createElement('button');
        //     this.mobileToggle.className = 'mobile-menu-toggle';
        //     this.mobileToggle.innerHTML = '<i class="bi bi-list"></i>';
        //     this.mobileToggle.setAttribute('aria-label', 'Toggle menu');
        //     
        //     // Create overlay
        //     this.overlay = document.createElement('div');
        //     this.overlay.className = 'sidebar-overlay';
        //     
        //     // Insert at the beginning of body
        //     document.body.insertBefore(this.mobileToggle, document.body.firstChild);
        //     document.body.insertBefore(this.overlay, document.body.firstChild);
        // }
    }

    setActivePage() {
        if (!this.sidebarElement) return;

        // Remove all active classes from desktop sidebar
        const navItems = this.sidebarElement.querySelectorAll('.nav-item');
        navItems.forEach(item => item.classList.remove('active'));

        // Set active class for current page in desktop sidebar
        const activeItem = this.sidebarElement.querySelector(`[data-page="${this.currentPage}"]`);
        if (activeItem) {
            activeItem.classList.add('active');
        }

        // Handle mobile bottom navigation
        const mobileNavLinks = document.querySelectorAll('.mobile-bottom-nav-link');
        mobileNavLinks.forEach(link => link.classList.remove('active'));

        const activeMobileLink = document.querySelector(`.mobile-bottom-nav-link[data-page="${this.currentPage}"]`);
        if (activeMobileLink) {
            activeMobileLink.classList.add('active');
        } else if (this.currentPage === 'voice-entry') {
            const writeTrigger = document.querySelector('.mobile-bottom-nav-link--write-fab');
            if (writeTrigger) {
                writeTrigger.classList.add('active');
            }
        }
    }

    setupEventListeners() {
        // Mobile toggle
        if (this.mobileToggle) {
            this.mobileToggle.addEventListener('click', () => this.toggleMobileMenu());
        }

        // Overlay click
        if (this.overlay) {
            this.overlay.addEventListener('click', () => this.closeMobileMenu());
        }

        // Navigation links
        if (this.sidebarElement) {
            const navLinks = this.sidebarElement.querySelectorAll('.nav-link');
            navLinks.forEach(link => {
                link.addEventListener('click', (e) => this.handleNavClick(e));
            });
        }

        // Handle window resize
        window.addEventListener('resize', () => this.handleResize());

        window.addEventListener('online', () => {
            this.refreshSyncStatusBadge();
            if (window.DiariOffline?.isPwaUiContext?.() && window.DiariOffline?.requestPwaSync) {
                void window.DiariOffline.requestPwaSync({ trustNavigatorOnline: true });
            }
        });
        window.addEventListener('offline', () => this.refreshSyncStatusBadge());
        window.addEventListener('storage', () => this.refreshSyncStatusBadge());
        window.addEventListener('diari-offline-sync', () => this.refreshSyncStatusBadge());
        window.addEventListener('diari-offline-sync-complete', () => this.refreshSyncStatusBadge());
    }

    initSyncStatusBadge() {
        if (window.DiariOffline?.isPwaUiContext?.()) {
            const existing = document.querySelector('.sync-status-badge');
            if (existing) existing.remove();
            return;
        }
        if (document.querySelector('.sync-status-badge')) {
            this.syncBadgeEl = document.querySelector('.sync-status-badge');
            this.refreshSyncStatusBadge();
            return;
        }
        const el = document.createElement('div');
        el.className = 'sync-status-badge';
        el.hidden = true;
        el.innerHTML = `
            <i class="bi bi-cloud-slash"></i>
            <span>Offline mode</span>
        `;
        document.body.appendChild(el);
        this.syncBadgeEl = el;
        this.refreshSyncStatusBadge();
        if (this.syncBadgePoller) clearInterval(this.syncBadgePoller);
        this.syncBadgePoller = setInterval(() => this.refreshSyncStatusBadge(), 12000);
    }

    readTagPendingCount() {
        try {
            const raw = localStorage.getItem('diariCoreTagSyncQueue');
            if (!raw) return 0;
            const arr = JSON.parse(raw);
            return Array.isArray(arr) ? arr.length : 0;
        } catch {
            return 0;
        }
    }

    async readOfflineEntryPendingCount() {
        if (typeof indexedDB === 'undefined') return 0;
        try {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open('diariCoreOfflineMedia', 1);
                req.onupgradeneeded = () => {
                    const dbX = req.result;
                    if (!dbX.objectStoreNames.contains('pendingEntries')) {
                        dbX.createObjectStore('pendingEntries', { keyPath: 'id' });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
            });
            const count = await new Promise((resolve, reject) => {
                const tx = db.transaction('pendingEntries', 'readonly');
                const req = tx.objectStore('pendingEntries').count();
                req.onsuccess = () => resolve(Number(req.result || 0));
                req.onerror = () => reject(req.error || new Error('IndexedDB count failed'));
            });
            db.close();
            return count;
        } catch {
            return 0;
        }
    }

    async refreshSyncStatusBadge() {
        if (window.DiariOffline?.isPwaUiContext?.()) return;
        if (!this.syncBadgeEl) return;
        const isOnline = navigator.onLine !== false;
        const pendingTags = this.readTagPendingCount();
        const pendingEntries = await this.readOfflineEntryPendingCount();
        const totalPending = pendingTags + pendingEntries;

        const icon = this.syncBadgeEl.querySelector('i');
        const label = this.syncBadgeEl.querySelector('span');
        if (!icon || !label) return;

        if (!isOnline) {
            this.syncBadgeEl.hidden = false;
            this.syncBadgeEl.classList.add('is-offline');
            this.syncBadgeEl.classList.remove('is-pending');
            icon.className = 'bi bi-cloud-slash';
            label.textContent = totalPending > 0
                ? `Offline mode • ${totalPending} pending sync`
                : 'Offline mode';
            return;
        }

        if (totalPending > 0) {
            this.syncBadgeEl.hidden = false;
            this.syncBadgeEl.classList.remove('is-offline');
            this.syncBadgeEl.classList.add('is-pending');
            icon.className = 'bi bi-arrow-repeat';
            label.textContent = `Sync pending • ${totalPending} item${totalPending === 1 ? '' : 's'}`;
            return;
        }

        this.syncBadgeEl.hidden = true;
        this.syncBadgeEl.classList.remove('is-offline', 'is-pending');
        icon.className = 'bi bi-cloud-check';
        label.textContent = 'All changes synced';
    }

    // Logout button setup
    setupLogoutButton() {
        if (!this.sidebarElement) return;
        
        const logoutBtn = this.sidebarElement.querySelector('.logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                if (window.DiariTheme && typeof window.DiariTheme.logout === 'function') {
                    window.DiariTheme.logout('login.html');
                    return;
                }
                try {
                    localStorage.removeItem('diariCoreUser');
                } catch (_) {}
                window.location.href = 'login.html';
            });
        }
    }

    getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('diariCoreUser') || 'null');
        } catch (error) {
            return null;
        }
    }

    isGuestUser() {
        return DIARICORE_FORCE_EMPTY_STATE || !this.getCurrentUser();
    }

    applyCurrentUserIdentity() {
        const user = this.getCurrentUser();
        if (!user) {
            this.syncMobileTopbarProfile(null);
            return;
        }

        const sidebarName = document.querySelector('.user-name');
        const memberSinceEl = document.querySelector('.user-member-since');

        const fullName = [user.firstName, user.lastName]
            .filter((part) => typeof part === 'string' && part.trim())
            .map((part) => part.trim())
            .join(' ');
        const displayName = fullName || user.nickname || 'User';

        if (sidebarName) sidebarName.textContent = displayName;
        if (memberSinceEl) {
            const raw = user.createdAt || user.created_at || user.created || '';
            const d = new Date(raw);
            if (!Number.isNaN(d.getTime())) {
                const monthYear = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
                memberSinceEl.textContent = `Member since ${monthYear}`;
            } else {
                memberSinceEl.textContent = 'Member since --';
            }
        }

        this.applySidebarAvatar(user, displayName);

        this.syncMobileTopbarProfile(user);
    }

    profileInitialsFromDisplayName(displayName) {
        const parts = String(displayName || '')
            .split(/\s+/)
            .filter(Boolean);
        return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
    }

    applySidebarAvatar(user, displayName) {
        const avatarImg = this.sidebarElement && this.sidebarElement.querySelector('.avatar-img');
        const initialsEl = this.sidebarElement && this.sidebarElement.querySelector('.avatar-initials');
        if (!avatarImg || !initialsEl) return;

        const dataUrl =
            user && typeof user.avatarDataUrl === 'string' ? user.avatarDataUrl.trim() : '';
        if (dataUrl) {
            avatarImg.src = dataUrl;
            avatarImg.hidden = false;
            initialsEl.style.display = 'none';
            initialsEl.textContent = '';
            return;
        }

        avatarImg.removeAttribute('src');
        avatarImg.hidden = true;
        initialsEl.style.display = 'flex';
        initialsEl.textContent = this.profileInitialsFromDisplayName(displayName);
    }

    /**
     * Mobile header: show same avatar as desktop sidebar (uploaded photo or placeholder image).
     */
    syncMobileTopbarProfile(user) {
        if (!isMobileViewportForAvatar()) return;
        if (typeof window.syncMobileAvatarEarlyClass === 'function') {
            window.syncMobileAvatarEarlyClass();
        }
        hydrateMobileTopbarProfileFromStorage();
    }

    upsertGuestNotice(target, message) {
        if (!target) return;
        const existing = target.querySelector('.guest-empty-notice');
        if (existing) {
            existing.textContent = message;
            return;
        }
        const notice = document.createElement('div');
        notice.className = 'guest-empty-notice';
        notice.textContent = message;
        target.appendChild(notice);
    }

    applyGuestEmptyState() {
        if (!this.isGuestUser()) return;
        this.syncMobileTopbarProfile(null);
        document.body.classList.add('guest-empty-state');

        const sidebarName = document.querySelector('.user-name');
        const sidebarEmail = document.querySelector('.user-email');
        if (sidebarName) sidebarName.textContent = 'Guest user';
        if (sidebarEmail) sidebarEmail.textContent = 'No account logged in';

        switch (this.currentPage) {
            case 'dashboard':
                this.applyDashboardGuestEmptyState();
                break;
            case 'entries':
                this.applyEntriesGuestEmptyState();
                break;
            case 'insights':
                this.applyInsightsGuestEmptyState();
                break;
            case 'suggestions':
                this.applySuggestionsGuestEmptyState();
                break;
            case 'profile':
                this.applyProfileGuestEmptyState();
                break;
            case 'write-entry':
                this.applyWriteEntryGuestEmptyState();
                break;
            case 'voice-entry':
                this.applyVoiceEntryGuestEmptyState();
                break;
            default:
                break;
        }
    }

    applyDashboardGuestEmptyState() {
        const mainTitle = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        if (mainTitle) mainTitle.textContent = 'Welcome';
        if (subtitle) subtitle.textContent = 'No user logged in yet';

        const streakCount = document.querySelector('.streak-count');
        const streakNum = document.getElementById('floatingStreakNum');
        const streakHint = document.getElementById('floatingStreakHint');
        const streakWeek = document.getElementById('floatingStreakWeek');
        if (streakCount) streakCount.textContent = '0 days';
        if (streakNum) streakNum.textContent = '0';
        const streakDaysLbl = document.getElementById('floatingStreakDaysLabel');
        if (streakDaysLbl) streakDaysLbl.textContent = 'days';
        if (streakHint) streakHint.textContent = 'Journal today to start.';
        if (streakWeek) {
            const letters = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
            streakWeek.innerHTML = letters.map((L) => (
                `<li class="floating-streak-panel__dow floating-streak-panel__dow--idle"><span>${L}</span></li>`
            )).join('');
        }

        document.querySelectorAll('.stat-card .stat-value').forEach((el) => {
            el.textContent = 'No data yet';
        });
        document.querySelectorAll('.stat-card .stat-description').forEach((el) => {
            el.textContent = 'Log in to start generating insights';
        });

        const sectionsToHide = document.querySelectorAll('.mobile-smart-insights, .weekly-glance, .smart-insights');
        sectionsToHide.forEach((section) => section.classList.add('guest-empty-hide'));
        this.upsertGuestNotice(
            document.querySelector('.main-content'),
            'Dashboard is empty right now because no user is logged in.'
        );
    }

    applyEntriesGuestEmptyState() {
        const title = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        if (title) title.textContent = 'Entries';
        if (subtitle) subtitle.textContent = 'No user logged in yet';

        const content = document.querySelector('.entries-content');
        if (content) content.classList.add('entries-content--empty-results');

        const searchInput = document.querySelector('.search-input');
        if (searchInput) {
            searchInput.value = '';
            searchInput.placeholder = 'No entries available (guest mode)';
            searchInput.disabled = true;
        }

        document.querySelectorAll('.entries-section, .load-more-section').forEach((el) => {
            el.classList.add('guest-empty-hide');
        });

        const emptyTitleDesktop = document.querySelector('.entries-empty-state__title--desktop');
        const emptyHintDesktop = document.querySelector('.entries-empty-state__hint--desktop');
        const emptyTitleMobile = document.querySelector('.entries-empty-state__title--mobile');
        const emptyHintMobile = document.querySelector('.entries-empty-state__hint--mobile');
        if (emptyTitleDesktop) emptyTitleDesktop.textContent = 'No journal entries yet';
        if (emptyHintDesktop) emptyHintDesktop.textContent = 'This page is empty because no user is logged in.';
        if (emptyTitleMobile) emptyTitleMobile.textContent = 'No entries yet';
        if (emptyHintMobile) emptyHintMobile.textContent = 'Empty because no user is logged in.';
    }

    applyInsightsGuestEmptyState() {
        const title = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        if (title) title.textContent = 'Insights';
        if (subtitle) subtitle.textContent = 'No user logged in yet';

        document.querySelectorAll('.weekly-glance, .triggers-section, .weekly-mood-desktop, .charts-section').forEach((el) => {
            el.classList.add('guest-empty-hide');
        });

        this.upsertGuestNotice(
            document.querySelector('.insights-content'),
            'Insights are empty right now because no user is logged in.'
        );
    }

    applySuggestionsGuestEmptyState() {
        const title = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        if (title) title.textContent = 'Suggestions';
        if (subtitle) subtitle.textContent = 'No user logged in yet';

        document.querySelectorAll(
            '.emotional-support-header, .emotional-support-section, .activity-suggestions-header, .activity-suggestions-section, .content-recommendations-header, .content-recommendations-section, .daily-wellness-header, .daily-wellness-section'
        ).forEach((el) => {
            el.classList.add('guest-empty-hide');
        });

        this.upsertGuestNotice(
            document.querySelector('.suggestions-content'),
            'Suggestions are empty right now because no user is logged in.'
        );
    }

    applyProfileGuestEmptyState() {
        const profileName = document.querySelector('.profile-name');
        const profileEmail = document.querySelector('.profile-email');
        const memberSince = document.querySelector('.profile-member-since');
        if (profileName) profileName.textContent = 'Guest user';
        if (profileEmail) profileEmail.textContent = 'No account logged in';
        if (memberSince) memberSince.textContent = 'Member since --';

        document.querySelectorAll('.profile-stats .stat-number').forEach((el) => {
            el.textContent = '0';
        });
    }

    applyWriteEntryGuestEmptyState() {
        const title = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        const mobileTitle = document.querySelector('.mobile-title');
        if (title) title.textContent = 'Write Entry';
        if (subtitle) subtitle.textContent = 'No user logged in yet';
        if (mobileTitle) mobileTitle.textContent = 'Write Entry';

        document.querySelectorAll(
            '.feelings-section, .tags-section, .journal-input-section, .action-buttons-section'
        ).forEach((el) => {
            el.classList.add('guest-empty-hide');
        });

        this.upsertGuestNotice(
            document.querySelector('.main-content'),
            'Writing is unavailable because no user is logged in.'
        );
    }

    applyVoiceEntryGuestEmptyState() {
        const title = document.querySelector('.main-title');
        const subtitle = document.querySelector('.subtitle');
        const mobileTitle = document.querySelector('.mobile-title');
        if (title) title.textContent = 'Voice Entry';
        if (subtitle) subtitle.textContent = 'No user logged in yet';
        if (mobileTitle) mobileTitle.textContent = 'Voice Entry';

        document.querySelectorAll(
            '.voice-entry-container, .post-recording-container, .tips-container'
        ).forEach((el) => {
            el.classList.add('guest-empty-hide');
        });

        this.upsertGuestNotice(
            document.querySelector('.main-content'),
            'Voice entry is unavailable because no user is logged in.'
        );
    }

    toggleMobileMenu() {
        if (this.sidebarElement) {
            this.sidebarElement.classList.toggle('open');
            this.overlay.classList.toggle('show');
            
            // Prevent body scroll when sidebar is open
            if (this.sidebarElement.classList.contains('open')) {
                document.body.classList.add('sidebar-open');
            } else {
                document.body.classList.remove('sidebar-open');
            }
        }
    }

    closeMobileMenu() {
        if (this.sidebarElement) {
            this.sidebarElement.classList.remove('open');
        }
        if (this.overlay) {
            this.overlay.classList.remove('show');
        }
        document.body.classList.remove('sidebar-open');
    }

    handleNavClick(e) {
        const link = e.currentTarget;
        const href = link.getAttribute('href');
        
        // Close mobile menu if open (only if hamburger menu exists)
        if (window.innerWidth <= 768 && this.overlay) {
            this.closeMobileMenu();
        }

        // Handle external links or non-page links
        if (href === '#' || href.startsWith('http')) {
            e.preventDefault();
            // You can add modal or other functionality here
            this.showNotification('Feature coming soon!', 'info');
        }
    }

    handleResize() {
        if (window.innerWidth > 768) {
            this.closeMobileMenu();
        }
    }

    showNotification(message, type = 'info') {
        if (window.DiariToast && typeof window.DiariToast.show === 'function') {
            window.DiariToast.show(message, type, 3000);
            return;
        }
        // Remove existing notification
        const existingNotification = document.querySelector('.sidebar-notification');
        if (existingNotification) {
            existingNotification.remove();
        }

        // Create notification
        const notification = document.createElement('div');
        notification.className = 'sidebar-notification';
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
            background: #7FA7BF;
            color: white;
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

    // Public method to update active page
    updateActivePage(pageName) {
        this.currentPage = pageName;
        this.setActivePage();
    }

    // Public method to get current page
    getCurrentPageName() {
        return this.currentPage;
    }
}

// Initialize sidebar when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    window.sidebarComponent = new SidebarComponent();
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SidebarComponent;
}
