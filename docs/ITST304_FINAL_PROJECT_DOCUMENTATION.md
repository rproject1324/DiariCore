FINAL PROJECT DOCUMENTATION
ITST 304 Mobile Computing
2nd Semester AY 2025-2026

Project Title
DiariCore - Your Mindful Journal

Submitted by
Name
Name
Name

Date Submitted
Month Day, Year


CHAPTER 1 - INTRODUCTION

1.1 Background of the Project
Journaling is a common self-management habit, but many people use generic notes apps or social platforms that do not provide journaling-focused features such as mood tracking, entry organization, reminders, and privacy-aware onboarding. In a mobile computing context, users also expect fast loading, installable experiences, and support for unstable connectivity.

DiariCore was developed to provide a dedicated journaling application that works well on mobile devices and supports Progressive Web Application features. The system focuses on a private, account-based journaling workflow, with optional mood and sentiment analysis to help users reflect on patterns in their own writing. The project also integrates privacy consent at sign up and applies security controls suitable for sensitive personal information.

1.2 Purpose of the System
The purpose of DiariCore is to provide a secure journaling platform where users can create, view, edit, and delete journal entries with tags and optional images, and receive optional mood labeling and insights. The application is designed to be mobile-capable, installable as a PWA, and usable even when the internet connection is poor or temporarily unavailable.

1.3 Objectives of the Project

General Objective
To design and implement a mobile-capable journaling application that supports secure user accounts, entry management, optional mood analysis, PWA installability, offline-tolerant behavior, and push notifications.

Specific Objectives
1. Provide core journal entry features including create, read, update, delete, tagging, and image attachments.
2. Implement secure user authentication with hashed passwords, session management, and request protection for state-changing operations.
3. Add optional emotion and sentiment analysis to support user reflection and dashboard summaries.
4. Deliver a mobile-optimized user interface with responsive layouts and navigation suitable for small screens.
5. Implement Progressive Web Application features including a web app manifest, service worker caching, offline support, and installability.
6. Enable push notifications for reminders and follow-ups in supported browsers and installed PWA contexts.


CHAPTER 2 - PROJECT OVERVIEW

2.1 System Description
DiariCore is a web-based personal journal application with a mobile-first user experience. Users sign up, verify their account, and then manage journal entries over time. The system includes:

Main features
1. User registration and login with verification and security controls.
2. Journal entry creation with title, text body, tags, datetime, and optional photos.
3. Journal entry browsing and filtering by month, mood label, tags, and search terms.
4. Entry editing and deletion with immediate UI updates.
5. Dashboard summaries such as mood patterns and streak indicators.
6. Optional mood and sentiment analysis to support reflective insights.
7. Progressive Web Application support for installability and offline-tolerant usage.
8. Push notifications for reminders and follow-up prompts where supported.

User functions
1. Create an account and sign in.
2. Agree to the privacy notice and consent at sign up.
3. Write and save journal entries.
4. Add tags and optional images to entries.
5. View entry history and open entry details.
6. Edit or delete previous entries.
7. Configure notification preferences (when available) and receive reminders.

Modules and pages
1. Login and registration pages.
2. Dashboard page.
3. Entries page (list, filters, search, and month navigation).
4. Entry view page (detail view and editor).
5. Write entry page (new entry creation).
6. Insights page (reflection-oriented summaries).
7. Profile page (user preferences, theme, and related settings).

Purpose of the application
To support private journaling with structured organization, mobile usability, optional mood labeling, and engagement features such as reminders, while applying security and privacy practices appropriate for personal content.

2.2 Target Users
1. Students and individuals who want a private journaling tool on mobile and desktop.
2. Users who want light mood tracking and reflection summaries based on journal content.
3. Users who prefer installable app-like behavior without requiring native app installation.


CHAPTER 3 - TECHNOLOGIES USED

3.1 Programming Languages
1. Python for the backend API and server-side logic.
2. JavaScript for client-side behavior, PWA support, offline handling, and push notification integration.
3. HTML and CSS for the user interface and responsive layout.

Frameworks and Libraries
Backend
1. Flask for routing and JSON API endpoints.
2. Gunicorn as the production WSGI server.

Database
1. PostgreSQL for production deployment on Railway.
2. SQLite for local development and fallback.

Frontend
1. Vanilla JavaScript for UI logic and offline layer.
2. Bootstrap icons and responsive CSS patterns used across pages.

PWA and Notifications
1. Web App Manifest for installability.
2. Service Worker for caching and offline app shell support.
3. Web Push with VAPID keys for push notifications in supported browsers and installed PWAs.


CHAPTER 4 - MOBILE COMPUTING FEATURES

4.1 Mobile Application Integration
DiariCore is delivered as a mobile-capable web application and enhanced to behave like a mobile app through Progressive Web Application capabilities. The application supports installation to the home screen, standalone display mode, and service worker caching. Navigation is designed for touch interaction, and pages are structured to be usable within mobile viewport constraints.

4.2 Mobile User Experience
Responsive design
Layouts adapt to different screen sizes, including mobile phones and tablets. Key components such as navigation, entry cards, and forms use responsive CSS so that content remains readable and usable.

Navigation improvements
Mobile navigation emphasizes quick access to Dashboard, Entries, and Write Entry. Entry detail viewing is supported through a dedicated entry view experience, with controls sized for touch input.

Readability
Typography, spacing, and card-based layouts are used to keep journal text readable on small screens. The UI uses a consistent theme and supports a mobile-friendly structure for long text.

Mobile optimization
PWA standalone mode and offline caching reduce repeated static asset downloads. The UI avoids blocking dialogs for normal flows and uses toast-style notifications for feedback.

4.3 Program Design on Different Platforms
Label: Desktop browser
1. Full-width layout and larger chart views on Dashboard.
2. Entries list and filters shown with more visible controls.

Label: Mobile browser and installed PWA
1. Bottom navigation style and compact layouts.
2. Standalone display mode support through the manifest.
3. Offline-oriented UI states when connectivity is limited.


CHAPTER 5 - PROGRESSIVE WEB APPLICATION (PWA)

5.1 Introduction to PWA
A Progressive Web Application is a web application that provides app-like capabilities such as installability, offline support, and background features like push notifications. A PWA uses a web app manifest and a service worker to deliver these capabilities while remaining accessible through a normal browser.

5.2 Web App Manifest
Manifest features in DiariCore are defined in static/manifest.webmanifest.

App name
DiariCore

Icons
Multiple icon sizes are provided, including 192x192 and 512x512, with a maskable icon for better home screen presentation.

Theme color and background color
Theme color: #6F8F7F
Background color: #6F8F7F

Display mode
Standalone, with display override options (standalone, minimal-ui, browser).

Start URL and scope
Start URL: /dashboard.html
Scope: /

5.3 Sample Manifest Code with Explanation
File: static/manifest.webmanifest
Key fields
1. name and short_name define the installable app label.
2. start_url defines the initial page when launched from the home screen.
3. display set to standalone makes the app open without browser UI in installed mode.
4. icons define home screen and launcher icon resources.

5.4 PWA Installation
Installation process
1. Open the DiariCore website in a supported browser such as Chrome or Edge.
2. Use the browser install prompt or install button when available.
3. Confirm installation. The app appears on the home screen or app list.

Home screen integration and standalone behavior
After installation, DiariCore launches in standalone mode based on the manifest. Navigation and UI are optimized for this mode, and service worker caching supports offline access to the app shell.


CHAPTER 6 - SERVICE WORKER IMPLEMENTATION

6.1 Introduction to Service Workers
A service worker is a background script that can intercept network requests, cache resources, and provide offline behavior. Service workers enable PWAs to load reliably and improve performance for static assets.

6.2 Service Worker Registration
DiariCore registers the service worker from its PWA bootstrap logic in static/js/pwa.js. The registration uses /service-worker.js with scope / so it applies to the whole application.

Sample code location
File: static/js/pwa.js
Function: registerServiceWorker
The code checks browser support, registers the service worker, and waits for readiness before booting push notification registration in standalone mode.

6.3 Caching Strategy
File: static/service-worker.js

Static caching
The service worker precaches the application shell, including core HTML pages, CSS, and JavaScript assets listed in PRECACHE_URLS. This improves load speed after the first visit and supports offline access to the UI shell.

Dynamic caching
For navigation requests, the service worker uses a network-first approach with a cached fallback. For static assets, it caches responses to improve repeat load performance.

Asset management
The service worker uses a versioned cache name (CACHE_NAME) to control updates. On activation, older caches under the same prefix are removed.

Important note
API routes under /api/ are not cached to keep session and data operations current.


CHAPTER 7 - OFFLINE FUNCTIONALITY

7.1 Offline Support
DiariCore provides offline-tolerant behavior primarily for PWA installed contexts. The offline layer uses cached app shell resources and local storage for entry data. The core offline logic is implemented in static/js/diari-offline.js.

Cached pages and offline access
1. The service worker precaches the major application pages so the UI can open even without internet after the first load.
2. When offline, the app relies on locally stored entries and user state for display.

Resource management
1. Static resources are cached by the service worker.
2. Offline drafts and pending operations are stored using browser storage (localStorage and IndexedDB), then synced when connectivity returns.

7.2 Reliability Features
1. Cache-first rendering: pages display cached content quickly, then refresh from the server when available.
2. Reachability probing: the client checks /api/health to distinguish offline mode from temporary connectivity issues.
3. Sync endpoints: the system uses /api/sync/state and /api/sync/check to refresh local state and support cross-device updates.
4. Event-based refresh: the client listens for sync completion and cache updates to refresh UI modules without forcing full page reloads.


CHAPTER 8 - PUSH NOTIFICATIONS

8.1 Notification Workflow
Device registration
1. When the app is installed as a PWA and the user grants notification permission, the client registers a push subscription.
2. The subscription is sent to the server using POST /api/push/subscribe and stored in the database.

Permission requests
1. The browser prompts the user to allow notifications.
2. The app only attempts push subscription flows when service worker and push APIs are available.

Notification delivery
1. The server uses Web Push with VAPID keys to send notifications to stored subscriptions.
2. The service worker receives the push event and displays a notification even when the app is closed (subject to OS limits).
3. The service worker can optionally send a delivery acknowledgment to the server after showing the notification.

8.2 Sample Notification Code with Explanation
Service worker push handler
File: static/service-worker.js
Event: self.addEventListener('push', ...)
The handler parses the push payload, shows a notification, and then calls the delivery acknowledgment endpoint.

Client subscription flow
File: static/js/pwa-web-push.js
The client ensures the service worker is ready, reads the VAPID public key from the server, and calls PushManager.subscribe to create a subscription, then posts it to the server.


CHAPTER 9 - SCREENSHOTS AND EVIDENCE

9.1 Mobile Responsive View
Insert screenshot here
Suggested screenshots
1. Dashboard on mobile
2. Entries list on mobile with filters
3. Write entry page on mobile

9.2 PWA Installation
Insert screenshot here
Suggested screenshots
1. Install prompt
2. Home screen icon
3. Standalone launch view

9.3 Push Notification Example
Insert screenshot here
Suggested screenshots
1. Notification permission prompt
2. Sample reminder notification banner

9.4 Offline Functionality
Insert screenshot here
Suggested screenshots
1. Offline saved entry indicator
2. Offline mode UI state


APPENDICES

Appendix A - Source Code
Include important code snippets such as:
1. Manifest file (static/manifest.webmanifest)
2. Service worker caching logic (static/service-worker.js)
3. Offline layer sync functions (static/js/diari-offline.js)
4. Push subscription logic (static/js/pwa-web-push.js)

Appendix B - Additional Screenshots
Insert additional screenshots.

