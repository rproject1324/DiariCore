// DiariCore Suggestions Page JavaScript

document.addEventListener('DOMContentLoaded', async function() {
    window.addEventListener('diari-offline-sync-complete', initializeEmotionalSupportFromData);
    window.addEventListener('diari-remote-state-refreshed', initializeEmotionalSupportFromData);
    if (window.DiariOffline?.registerPageRefreshHandler) {
        window.DiariOffline.registerPageRefreshHandler(initializeEmotionalSupportFromData);
    }
    if (window.DiariOffline?.wirePwaPageAutoSync) {
        window.DiariOffline.wirePwaPageAutoSync(initializeEmotionalSupportFromData);
    }

    try {
    initializeEmotionalSupportFromData();
    // Initialize components
    initializeSuggestions();
    initializeQuickActions();
    initializeInteractiveElements();
    animateProgressBars();
    initializeMobileCarousel();
    setTimeout(() => {
        void (async () => {
            try {
                if (window.DiariOffline?.awaitServerState) {
                    await window.DiariOffline.awaitServerState();
                    initializeEmotionalSupportFromData();
                }
            } catch (error) {
                console.warn('Suggestions background sync failed:', error);
            }
        })();
    }, 0);
    } finally {
        if (window.DiariShell && typeof window.DiariShell.release === 'function') {
            window.DiariShell.release();
        }
    }
});

function initializeEmotionalSupportFromData() {
    const entries = JSON.parse(localStorage.getItem('diariCoreEntries') || '[]');
    const supportText = document.querySelector('.emotional-support-section .support-text');
    if (!supportText) return;

    if (!Array.isArray(entries) || entries.length === 0) {
        supportText.textContent = 'Start by writing your first journal entry. Your emotional support suggestions will become more personal as we learn from your reflections.';
        return;
    }

    const latest = [...entries].filter((e) => e?.date).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const feeling = (latest?.feeling || '').toLowerCase();
    if (['anxious', 'stressed', 'sad', 'angry'].includes(feeling)) {
        supportText.textContent = 'You have been carrying a lot lately. Take one slow breath at a time, and remember that asking for support is a sign of strength.';
        return;
    }
    supportText.textContent = 'You are making steady progress through your journaling. Keep listening to your emotions and giving yourself space to recharge.';
}

// Initialize Suggestions
function initializeSuggestions() {
    // Add click handlers to suggestion cards
    const suggestionCards = document.querySelectorAll('.suggestion-card');
    suggestionCards.forEach(card => {
        card.addEventListener('click', function(e) {
            // Don't trigger if clicking on buttons
            if (!e.target.closest('button')) {
                const title = this.querySelector('.card-title').textContent;
                showNotification(`Opening ${title}...`, 'info');
                console.log('Suggestion card clicked:', title);
            }
        });
    });

    // Add click handlers to action buttons
    const actionButtons = document.querySelectorAll('.btn-action');
    actionButtons.forEach(button => {
        button.addEventListener('click', function(e) {
            e.stopPropagation();
            const cardTitle = this.closest('.suggestion-card').querySelector('.card-title').textContent;
            handleActionClick(cardTitle, this.textContent);
        });
    });

    // Add click handlers to recommendation items
    const recommendationItems = document.querySelectorAll('.recommendation-item, .content-item, .tip-item');
    // Exclude mobile carousel activity items to prevent toggling effect
    const desktopActivityItems = document.querySelectorAll('.activity-grid .activity-item');
    
    recommendationItems.forEach(item => {
        item.addEventListener('click', function() {
            const title = this.querySelector('h4')?.textContent || this.querySelector('h3')?.textContent;
            showNotification(`Opening: ${title}`, 'info');
            console.log('Recommendation clicked:', title);
        });
    });
    
    // Add click handlers only to desktop activity items
    desktopActivityItems.forEach(item => {
        item.addEventListener('click', function() {
            const title = this.querySelector('h3').textContent;
            showNotification(`Opening: ${title}`, 'info');
            console.log('Activity clicked:', title);
        });
    });
}

// Handle Action Button Clicks
function handleActionClick(cardTitle, actionText) {
    const actions = {
        'Emotional Support': {
            'View All Support Options': () => showSupportOptions()
        },
        'Activity Suggestions': {
            'Explore More Activities': () => showMoreActivities()
        },
        'Content Recommendations': {
            'Browse Library': () => showContentLibrary()
        },
        'Daily Wellness Tips': {
            'View Full Schedule': () => showWellnessSchedule()
        }
    };

    if (actions[cardTitle] && actions[cardTitle][actionText]) {
        actions[cardTitle][actionText]();
    } else {
        showNotification(`Action: ${actionText}`, 'info');
    }
}

// Show Support Options
function showSupportOptions() {
    showNotification('Loading support options...', 'info');
    // In a real app, this would open a modal or navigate to support page
    console.log('Opening support options');
}

// Show More Activities
function showMoreActivities() {
    showNotification('Loading more activities...', 'info');
    // In a real app, this would load more activities
    console.log('Loading more activities');
}

// Show Content Library
function showContentLibrary() {
    showNotification('Opening content library...', 'info');
    // In a real app, this would navigate to content library
    console.log('Opening content library');
}

// Show Wellness Schedule
function showWellnessSchedule() {
    showNotification('Loading wellness schedule...', 'info');
    // In a real app, this would show detailed schedule
    console.log('Loading wellness schedule');
}

// Initialize Quick Actions
function initializeQuickActions() {
    const quickActionButtons = document.querySelectorAll('.quick-action-btn');
    
    quickActionButtons.forEach(button => {
        button.addEventListener('click', function() {
            const action = this.textContent.trim();
            handleQuickAction(action);
        });
    });
}

// Handle Quick Actions
function handleQuickAction(action) {
    const actions = {
        'Emergency Support': () => handleEmergencySupport(),
        'Breathing Exercise': () => startBreathingExercise(),
        'Quick Journal': () => openQuickJournal(),
        'Calm Music': () => playCalmMusic()
    };

    if (actions[action]) {
        actions[action]();
    } else {
        showNotification(`Action: ${action}`, 'info');
    }
}

// Handle Emergency Support
function handleEmergencySupport() {
    // Show confirmation dialog
    const confirmed = confirm('Are you in need of immediate emergency support? This will connect you with crisis resources.');
    
    if (confirmed) {
        showNotification('Connecting to emergency support resources...', 'warning');
        // In a real app, this would show emergency contacts or crisis hotline
        setTimeout(() => {
            showNotification('Emergency resources loaded. Please reach out to: 988 (Crisis Line)', 'error');
        }, 2000);
    }
}

// Start Breathing Exercise
function startBreathingExercise() {
    showNotification('Starting breathing exercise...', 'info');
    createBreathingModal();
}

// Create Breathing Exercise Modal
function createBreathingModal() {
    // Remove existing modal if any
    const existingModal = document.querySelector('.breathing-modal');
    if (existingModal) {
        existingModal.remove();
    }

    const modal = document.createElement('div');
    modal.className = 'breathing-modal';
    modal.innerHTML = `
        <div class="breathing-overlay">
            <div class="breathing-content">
                <div class="breathing-close">
                    <button class="close-btn">&times;</button>
                </div>
                <h3>Breathing Exercise</h3>
                <div class="breathing-circle">
                    <div class="breathing-inner"></div>
                    <div class="breathing-text">Breathe In</div>
                </div>
                <div class="breathing-instructions">
                    <p>Follow the circle's rhythm. Inhale as it expands, exhale as it contracts.</p>
                    <p>Continue for 1 minute or until you feel calmer.</p>
                </div>
                <div class="breathing-timer">
                    <span class="timer-text">0:00</span>
                </div>
            </div>
        </div>
    `;

    // Add styles
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const overlay = modal.querySelector('.breathing-overlay');
    overlay.style.cssText = `
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.8);
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const content = modal.querySelector('.breathing-content');
    content.style.cssText = `
        background: white;
        border-radius: 16px;
        padding: 2rem;
        max-width: 400px;
        width: 90%;
        text-align: center;
        position: relative;
    `;

    const breathingCircle = modal.querySelector('.breathing-circle');
    breathingCircle.style.cssText = `
        width: 150px;
        height: 150px;
        border-radius: 50%;
        background: linear-gradient(135deg, #6F8F7F, #8FAF9F);
        margin: 2rem auto;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        animation: breathe 4s ease-in-out infinite;
    `;

    const breathingInner = modal.querySelector('.breathing-inner');
    breathingInner.style.cssText = `
        width: 120px;
        height: 120px;
        border-radius: 50%;
        background: white;
        display: flex;
        align-items: center;
        justify-content: center;
    `;

    const breathingText = modal.querySelector('.breathing-text');
    breathingText.style.cssText = `
        position: absolute;
        font-size: 16px;
        font-weight: 600;
        color: #6F8F7F;
    `;

    const instructions = modal.querySelector('.breathing-instructions');
    instructions.style.cssText = `
        margin-bottom: 1rem;
    `;

    const timer = modal.querySelector('.breathing-timer');
    timer.style.cssText = `
        font-size: 24px;
        font-weight: 600;
        color: #6F8F7F;
    `;

    // Add CSS animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes breathe {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.2); }
        }
    `;
    document.head.appendChild(style);

    // Add close handler
    const closeBtn = modal.querySelector('.close-btn');
    closeBtn.style.cssText = `
        position: absolute;
        top: 1rem;
        right: 1rem;
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
    `;

    closeBtn.addEventListener('click', () => {
        modal.remove();
        style.remove();
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            modal.remove();
            style.remove();
        }
    });

    document.body.appendChild(modal);

    // Start breathing animation
    startBreathingAnimation(modal);
    startBreathingTimer(modal);
}

// Start Breathing Animation
function startBreathingAnimation(modal) {
    const breathingText = modal.querySelector('.breathing-text');
    let phase = 0;
    
    setInterval(() => {
        phase = (phase + 1) % 4;
        switch(phase) {
            case 0:
                breathingText.textContent = 'Breathe In';
                break;
            case 1:
                breathingText.textContent = 'Hold';
                break;
            case 2:
                breathingText.textContent = 'Breathe Out';
                break;
            case 3:
                breathingText.textContent = 'Hold';
                break;
        }
    }, 1000);
}

// Start Breathing Timer
function startBreathingTimer(modal) {
    const timerText = modal.querySelector('.timer-text');
    let seconds = 0;
    
    const interval = setInterval(() => {
        seconds++;
        const minutes = Math.floor(seconds / 60);
        const secs = seconds % 60;
        timerText.textContent = `${minutes}:${secs.toString().padStart(2, '0')}`;
        
        if (seconds >= 60) {
            clearInterval(interval);
            setTimeout(() => {
                showNotification('Breathing exercise completed!', 'success');
            }, 1000);
        }
    }, 1000);
}

// Open Quick Journal
function openQuickJournal() {
    showNotification('Opening quick journal...', 'info');
    // In a real app, this would open a quick journal modal
    console.log('Opening quick journal');
}

// Play Calm Music
function playCalmMusic() {
    showNotification('Loading calm music playlist...', 'info');
    // In a real app, this would play music or open music player
    console.log('Playing calm music');
}

// Initialize Interactive Elements
function initializeInteractiveElements() {
    // Add hover effects to insight cards
    const insightCards = document.querySelectorAll('.insight-card');
    insightCards.forEach(card => {
        card.addEventListener('mouseenter', function() {
            this.style.transform = 'translateY(-4px)';
        });
        
        card.addEventListener('mouseleave', function() {
            this.style.transform = 'translateY(-2px)';
        });
    });

    // Add click handlers to insight cards
    insightCards.forEach(card => {
        card.addEventListener('click', function() {
            const title = this.querySelector('.insight-title').textContent;
            showNotification(`Viewing details for: ${title}`, 'info');
            console.log('Insight clicked:', title);
        });
    });
}

// Animate Progress Bars
function animateProgressBars() {
    const progressFills = document.querySelectorAll('.progress-fill');
    
    // Set initial width to 0
    progressFills.forEach(fill => {
        const targetWidth = fill.style.width;
        fill.style.width = '0%';
        
        // Animate to target width after a delay
        setTimeout(() => {
            fill.style.width = targetWidth;
        }, 500);
    });
}

// Show Notification
function showNotification(message, type = 'info') {
    if (window.DiariToast && typeof window.DiariToast.show === 'function') {
        window.DiariToast.show(message, type, 3000);
        return;
    }
    // Remove existing notification
    const existingNotification = document.querySelector('.suggestions-notification');
    if (existingNotification) {
        existingNotification.remove();
    }

    // Create notification
    const notification = document.createElement('div');
    notification.className = 'suggestions-notification';
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
        z-index: 10000;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
        transform: translateX(100%);
        transition: transform 0.3s ease;
        max-width: 400px;
        word-wrap: break-word;
        background: ${getNotificationColor(type)};
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

// Initialize Mobile Activity Carousel
function initializeMobileCarousel() {
    // Only initialize on mobile devices
    if (window.innerWidth > 768) return;
    
    // Initialize Activity Carousel
    const activityCarousel = document.querySelector('.mobile-activity-carousel');
    if (activityCarousel) {
        initializeCarousel(activityCarousel);
    }
    
    // Initialize Wellness Carousel
    const wellnessCarousel = document.querySelector('.mobile-wellness-carousel');
    if (wellnessCarousel) {
        initializeCarousel(wellnessCarousel);
    }
}

// Generic Carousel Initializer
function initializeCarousel(carousel) {
    const slides = carousel.querySelectorAll('.carousel-slide');
    const dots = carousel.querySelectorAll('.dot');
    let currentSlide = 0;
    
    // Function to show specific slide
    function showSlide(index) {
        // Hide all slides
        slides.forEach(slide => slide.classList.remove('active'));
        dots.forEach(dot => dot.classList.remove('active'));
        
        // Show current slide
        slides[index].classList.add('active');
        dots[index].classList.add('active');
        currentSlide = index;
    }
    
    // Add click handlers to dots
    dots.forEach((dot, index) => {
        dot.addEventListener('click', () => {
            showSlide(index);
        });
    });
    
    // Auto-advance carousel
    setInterval(() => {
        const nextSlide = (currentSlide + 1) % slides.length;
        showSlide(nextSlide);
    }, 5000); // Change slide every 5 seconds
    
    // Add touch/swipe support for mobile
    let touchStartX = 0;
    let touchEndX = 0;
    
    carousel.addEventListener('touchstart', (e) => {
        touchStartX = e.changedTouches[0].screenX;
    });
    
    carousel.addEventListener('touchend', (e) => {
        touchEndX = e.changedTouches[0].screenX;
        handleSwipe();
    });
    
    function handleSwipe() {
        const swipeThreshold = 50;
        const diff = touchStartX - touchEndX;
        
        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                // Swipe left - next slide
                const nextSlide = (currentSlide + 1) % slides.length;
                showSlide(nextSlide);
            } else {
                // Swipe right - previous slide
                const prevSlide = (currentSlide - 1 + slides.length) % slides.length;
                showSlide(prevSlide);
            }
        }
    }
}
